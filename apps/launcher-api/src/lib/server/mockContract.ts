/**
 * The MATH CONTRACT the Invisible Test Server's mock RGS deals a project with — protocol, cascade
 * and grid (dimensions, paylines, in-play symbol pool, wild, cluster/scatter shape) — derived from
 * that project's own Invisible Game Config.
 *
 * It lives here, apart from `publishGame.ts`, because it is resolved on TWO paths and the two must
 * never disagree:
 *
 *   - **publish** (`publishGame`) snapshots it into the test-server manifest (`test_server/games.json`),
 *     which is what an offline/degraded test server falls back to;
 *   - **on demand** (`GET /api/game-config/mock`), so the running mock re-reads the project and
 *     deals the board its CLIENT draws without anyone remembering to republish.
 *
 * WHICH config that is depends on who is playing, and the answer changed with published runtime
 * snapshots (#841). A PLAYER boot reads the Game Config frozen into the project's published snapshot
 * (`publishedRuntime.ts`); an AUTHORING boot (`ie_authoring=1`) reads the live one. A mock that
 * followed the live config therefore dealt an unpublished 8×4 into a published 5×3 client — the very
 * client/server split this module was written to close, re-opened from the other side. So there are
 * two {@link MockContractSource}s, each read from exactly what the matching client boots:
 * `published` from the snapshot (falling back to live only where the runtime endpoint does too — a
 * game with no snapshot yet), `live` from the authoring data. The test server asks for each on its
 * own mock (see `refreshContract` in `services/test-server/server.mjs`).
 *
 * A REAL RGS is still authoritative — that direction is a certification requirement, not a choice,
 * and `game/gameConfig.ts`'s `__IE_SERVER_CONFIG__` overlay implements it. This module only makes
 * OUR mock derive its answer from the project instead of from a stale copy of it.
 */
import {
	holdAndWinMockInputs,
	isScatterSymbol,
	normalizeGameConfigDoc,
	resolveBetModes,
	resolveWinModel,
	symbolsInPlay,
	type GameConfigDoc,
	type PaytableRow,
} from 'game-config';
import {
	bookMapping,
	linesMapping,
	mapSymbol,
	type GameMapping,
} from 'rgs-translator-eagaming/game-mappings';
import { loadGameConfigDoc } from './gameConfigStorage';
import { protocolFor } from './mockProtocol';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { projectClientKey, projectGameType } from './projects';
import { currentPointer, readSnapshotBundle } from './publishedRuntime';
import type { RuntimeBundle } from './runtimeBundle';
import { loadSymbolsDoc } from './symbolsStorage';
import type { MockProtocol, TestServerGameEntry } from './testServerManifest';

/**
 * The two facts the contract needs from a project's SYMBOLS rather than its config: is the
 * stacked-picture mode on, and does a symbol have resting (`static`) art. Read from the symbols doc
 * for a live contract and from the snapshot's baked symbols for a published one, so each answers
 * for the art its own client renders.
 */
interface SymbolFacts {
	stacked: boolean;
	hasStaticArt: (symbol: string) => boolean;
}

const NO_SYMBOL_FACTS: SymbolFacts = { stacked: false, hasStaticArt: () => false };

/**
 * From the live symbols doc. `stacked` uses the SAME master toggle the symbol bake reads
 * (`stackedPictures.enabled` + ≥1 authored symbol), so it matches {@link bundleSymbolFacts} for a
 * snapshot of the same doc. Best-effort: an unreadable doc ⇒ no stacked deal, no multipliers.
 */
async function liveSymbolFacts(clientKey: string, projectKey: string): Promise<SymbolFacts> {
	try {
		const doc = await loadSymbolsDoc(clientKey, projectKey);
		return {
			stacked:
				doc.stackedPictures?.enabled === true && (doc.stackedPictures.symbols?.length ?? 0) > 0,
			hasStaticArt: (symbol) => Boolean(doc.symbols?.[symbol]?.static),
		};
	} catch {
		return NO_SYMBOL_FACTS;
	}
}

/** From a snapshot's baked symbols: `stacked` is only baked when the toggle is on and non-empty,
 *  and `map` is the doc's `symbols` passed through verbatim. */
function bundleSymbolFacts(symbols: RuntimeBundle['symbols'] | undefined): SymbolFacts {
	return {
		stacked: Boolean(symbols?.stacked),
		hasStaticArt: (symbol) => Boolean(symbols?.map?.[symbol]?.static),
	};
}

/** Flatten a symbol's `[{ '5': 20 }, { '3': 5 }]` paytable rows to an `{ occurs: multiplier }` map. */
function paytableToOccursMap(rows: PaytableRow[]): Record<string, number> {
	const map: Record<string, number> = {};
	for (const row of rows) {
		for (const [occurs, mult] of Object.entries(row)) {
			if (typeof mult === 'number' && Number.isFinite(mult)) map[occurs] = mult;
		}
	}
	return map;
}

/**
 * The project's IN-PLAY wild, in the shape the mock wants (`{ paytable: occurs→multiplier }`), or
 * `undefined`. Keyed off the SAME in-play gate as the paytable, roll and `/symbols`: a symbol counts
 * only once it's ON THE STRIPS (`symbolsInPlay`) — a wild that merely sits in the dictionary with a
 * paytable but is never dealt stays wild-less, which is why an authored-but-unused `W` doesn't pay.
 * The lines facade maps the mock's `WILD` to the game symbol `W`, so the in-play wild is expected to
 * be `W`.
 */
function projectWild(doc: GameConfigDoc): { paytable: Record<string, number> } | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	const entry = Object.entries(doc.symbols).find(
		([name, sym]) =>
			inPlay.has(name) && sym.special_properties?.includes('wild') && sym.paytable?.length,
	);
	const paytable = entry?.[1].paytable;
	return paytable ? { paytable: paytableToOccursMap(paytable) } : undefined;
}

/**
 * The project's IN-PLAY line-symbol pool in the mock's SERVER vocabulary (`PIC*`/`SCAT`), or
 * `undefined` only when it is EMPTY (a misconfig). Keyed off the SAME `symbolsInPlay` gate as the
 * paytable/roll/wild. It is stated even when it equals the default set — the mock recognises that
 * case itself (`sameAsDefaultPool`) and keeps the weighted deal, so the answer no longer depends on
 * a mapping-table size that changes when the table grows.
 *
 * The space mismatch is the reason this lives HERE: `symbolsInPlay` answers in CLIENT symbol names
 * (`H1`, `L1`, `S`, …) but the mock deals SERVER names (`PIC1`, `PIC5`, `SCAT`, …). We translate with
 * the lines facade's own `linesMapping` — keep each server symbol whose mapped client name is in play
 * — so the mock consumes a plain server-space array with ZERO mapping knowledge (no table duplicated
 * into the `.mjs`). `SCAT` rides along only when its client symbol (`S`) is in play. `WILD` is
 * intentionally excluded: the existing `wild` field already governs whether the mock deals a wild.
 * An empty pool (misconfig) ⇒ `undefined` ⇒ the mock keeps its full default (never deals a blank board).
 */
/**
 * The project's in-play MULTIPLIER symbol, by name, or `undefined`.
 *
 * Gated on `symbolsInPlay` for the same reason `projectWild` is: a symbol that merely sits in
 * the dictionary but appears on no strip can never be dealt.
 */
function projectMultiplierSymbol(doc: GameConfigDoc): string | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	return Object.entries(doc.symbols).find(
		([name, sym]) => inPlay.has(name) && sym.special_properties?.includes('multiplier'),
	)?.[0];
}

/**
 * Should the mock deal multiplier cells at this project?
 *
 * Two conditions, and the second one is the one that cost a live game. The config DECLARING a
 * multiplier symbol is not enough: the symbol also has to be RENDERABLE, i.e. bound to art in
 * the Symbols tool. `test5` declared `M` on its strips with no art behind it, so the moment a
 * `MULT` cell landed the board threw "Cannot read properties of undefined (reading 'static')"
 * and the player lost the reels.
 *
 * The engine no longer crashes on that (a symbol with no art renders nothing now), but dealing
 * an invisible symbol is still wrong — a blank cell that pays is worse than no cell at all. So
 * the mock is told to deal them only when the project can actually show one.
 *
 * `static` specifically, because that is the state a resting board renders and the exact one
 * that threw. Best-effort: an unreadable symbols doc ⇒ `false` ⇒ no multipliers, never a crash.
 */
function projectMultiplier(doc: GameConfigDoc, symbols: SymbolFacts): boolean {
	const name = projectMultiplierSymbol(doc);
	return name ? symbols.hasStaticArt(name) : false;
}

function projectLineSymbols(doc: GameConfigDoc): string[] | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	// `WILD` and `MULT` are excluded because neither is a LINE symbol: each has its own switch
	// (`wild`, `multiplier`) deciding whether the mock deals it at all. This pool is built from
	// the MAPPING TABLE's keys, so any entry added there for a special symbol lands in the deal
	// pool unless it is named here — which is exactly how `MULT` started being dealt as an
	// ordinary board symbol, valueless, on every reveal.
	const NON_LINE_SERVER_SYMBOLS = new Set(['WILD', 'MULT']);
	const serverPool = Object.keys(linesMapping.symbols).filter(
		(server) => !NON_LINE_SERVER_SYMBOLS.has(server),
	);
	const allowed = serverPool.filter((server) => inPlay.has(mapSymbol(linesMapping, server)));
	// STATED ALWAYS, not only when it is a strict subset. The old shortcut ("everything is in play ⇒
	// omit ⇒ the mock keeps its full default") read as a parity nicety and was actually load-bearing
	// in the wrong direction: it compared against the MAPPING's size, and the mapping now reaches
	// three symbols (`PIC8`/`PIC9`/`PIC10` → `H5`/`L3`/`L4`) that the mock's default pool does not
	// contain. A project with all ten line symbols in play would therefore have sent nothing and been
	// dealt the captured seven — losing exactly the symbols this mapping was extended to reach. The
	// mock now recognises a pool equal to its own default and keeps the weighted deal for it
	// (`sameAsDefaultPool`), so stating the pool is free and the answer is no longer inferred from a
	// table size that can change.
	if (!allowed.length) return undefined;
	return allowed;
}

/**
 * The project's per-symbol paytable in the mock's SERVER vocabulary, as `{ PIC1: { 8: 3, … } }`.
 *
 * Sent for EVERY win model, so the mock prices what `/config` authored instead of its captured Hot
 * Fruits values. `scatter` is simply where it matters most: that model prices by HOW MANY of a symbol
 * are on the board (8, 9, 10, 13+ …), while the mock's own table is keyed by payline RUN LENGTHS
 * (3/4/5), so clamping a count of 12 into a 5-run row would make every scatter win pay the same
 * number. Cluster reads its rows as thresholds for the same reason.
 *
 * `WILD` and `SCAT` are both excluded — each is paid by its own pass in the mock (the `wild` field
 * and `evaluateScatters`), and giving the scatter a LINE price row made a scatter run pay twice.
 *
 * In-play gate + client→server translation, same as `projectLineSymbols`. `mapping` is the
 * protocol's vocabulary: `bookMapping` for the book mock (`PIC1`…`PIC4`, `ACE`…`TEN`), the lines
 * facade's table for everything else.
 */
function projectSymbolPaytable(
	doc: GameConfigDoc,
	mapping: GameMapping,
): Record<string, Record<string, number>> | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	const out: Record<string, Record<string, number>> = {};
	for (const server of Object.keys(mapping.symbols)) {
		// NEITHER SPECIAL GETS A LINE PRICE ROW. `WILD` was already excluded because the `wild` field
		// governs it. `SCAT` has to be excluded for the same reason and was not: the mock pays scatters
		// through its own `evaluateScatters` pass (from `projectScatterPaytable` when one is authored),
		// and a scatter's own `paytable` is its SCATTER pay, so once this table started feeding the
		// LINE evaluator a scatter run would have paid TWICE — once as
		// the feature trigger and again as an ordinary left-to-right line win, because
		// `evaluatePaylines` reads its base symbol off the board and `payRowOf` now found a row for it.
		// Harmless while only the `scatter` model received this table (that model never runs the payline
		// evaluator); a real double-pay the moment every model does.
		if (server === 'WILD' || server === 'SCAT') continue;
		const client = mapSymbol(mapping, server);
		if (!inPlay.has(client)) continue;
		const rows = doc.symbols[client]?.paytable;
		if (!rows?.length) continue;
		out[server] = paytableToOccursMap(rows);
	}
	return Object.keys(out).length ? out : undefined;
}

/** Projects already told they author more than one base mode, so a contract re-read every few
 *  seconds says it once per process. */
const warnedManyBases = new Set<string>();

/**
 * The project's bet modes for the lines mock's `betOptions` table, BASE FIRST, or `undefined` when it
 * authors nothing beyond the base bet.
 *
 * Only a game that SELLS something needs a table. The partner's line games (Hot Fruits) declare none
 * and read `bet [lines, betPerLine]`; their games with an ante or a buy (Stargate: 20 lines,
 * `betOptions: [20, 25, 2000]`) declare one and read `bet [option, M]`. Without it the lines mock
 * could not sell the feature at all: a buy went out as a line bet, was charged the base stake and
 * dealt a base spin, while the card advertised the authored price.
 *
 * Ordered by the MATH (`betModes` key order), not by `resolveBetModes`' presentation order: the
 * index is the wire's option number, and reordering cards in `/config` must not renumber it.
 * Exactly one base, or nothing: a second one is an ante nobody marked, and whichever sorted first
 * would silently become the price every other option is a multiple of.
 */
function projectBetModes(
	doc: GameConfigDoc,
	projectKey: string,
): NonNullable<TestServerGameEntry['grid']>['betModes'] {
	const keyOrder = Object.keys(doc.betModes);
	const modes = resolveBetModes(doc)
		.filter((mode) => Number.isFinite(mode.costMultiplier) && mode.costMultiplier > 0)
		.sort((a, b) => keyOrder.indexOf(a.mode) - keyOrder.indexOf(b.mode));
	const bases = modes.filter((mode) => mode.kind === 'base');
	const extras = modes.filter((mode) => mode.kind !== 'base');
	if (bases.length > 1 && extras.length && !warnedManyBases.has(projectKey)) {
		warnedManyBases.add(projectKey);
		console.warn(
			`[mock-contract] '${projectKey}' has ${bases.length} base bet modes ` +
				`(${bases.map((mode) => mode.mode).join(', ')}), so its mock sells none of its extras. ` +
				`Mark the ante's kind in /config.`,
		);
	}
	if (bases.length !== 1 || !extras.length) return undefined;
	const base = bases[0];
	return [base, ...extras].map((mode) => ({
		mode: mode.mode,
		cost: mode.costMultiplier,
		kind: mode.kind,
	}));
}

/**
 * The scatter pays the project AUTHORED — its in-play scatter symbol's own `paytable`, count →
 * × total stake — or `undefined`, which leaves the mock on its placeholder table, undeclared, exactly
 * as before scatter pays had an authored home. The same symbol `shownPaytable` puts on the info page.
 */
function projectScatterPaytable(doc: GameConfigDoc): Record<string, number> | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	const name = Object.keys(doc.symbols).find(
		(id) => inPlay.has(id) && isScatterSymbol(doc.symbols[id]),
	);
	const rows = name ? doc.symbols[name].paytable : undefined;
	return rows?.length ? paytableToOccursMap(rows) : undefined;
}

/**
 * The project's OWN cascade answer, or `undefined` when it never stated one.
 *
 * Deliberately reads the stored field rather than `resolveCascade`: the resolved value would be a
 * boolean for EVERY project, and the test server treats a boolean as authoritative — which would
 * pin every unauthored game and break the `CASCADE_GAMES` escape hatch on lines games.
 */
function projectCascade(doc: GameConfigDoc | null): boolean | undefined {
	return typeof doc?.cascade === 'boolean' ? doc.cascade : undefined;
}

/**
 * Resolve a project's board grid from its authored Game Config, in the shape the test-server mock
 * wants (`{ reels, rows, paylines: rows[][], wild?, … }`). Mirrors the test-server's own `linesGrid`
 * derivation so the mock deals the SAME dimensions the client draws, plus the in-play wild so `W`
 * can pay. Best-effort: no authored doc / odd config ⇒ `undefined` ⇒ the mock keeps its shared
 * default. `numRows` is the per-reel array, so `rows` is its max (a stepped board is a rectangle
 * tall enough to hold it).
 */
function projectGrid(
	protocol: MockProtocol,
	doc: GameConfigDoc | null,
	symbolFacts: SymbolFacts,
	projectKey: string,
): TestServerGameEntry['grid'] {
	// EVERY protocol that runs on the lines mock needs its grid — that mock's board dimensions are the
	// grid. `ways` was excluded here on the reasoning that it "needs nothing beyond the board", which
	// is backwards: the board IS what it needs, and without it a ways project silently fell back to
	// the shared `apps/lines` 5×3 no matter what it authored (the live `test3` drew 8×4 against a 5×3
	// deal). `cluster`/`scatter` additionally carry their `minCluster`/`adjacency`/`minCount` shape.
	//
	// `book` is the one real exception: it runs `createBookMock`, which owns its own board and
	// paylines, and reads only `symbolPaytable` — so that is all it gets beyond the shape the test
	// server's `validGrid` requires. Without it the book mock paid and DECLARED its captured table
	// whatever `/config` authored, so the info page and the payouts could disagree.
	try {
		if (!doc) return undefined;
		const reels = Math.max(1, Math.round(Number(doc.numReels)));
		const rowsList = Array.isArray(doc.numRows) && doc.numRows.length ? doc.numRows : [3];
		const rows = Math.max(1, Math.round(Math.max(...rowsList)));
		// Per-column heights, padded to `reels` the way the config's own resolver does. Sent ONLY when
		// the columns actually differ, so a rectangular project's manifest entry is byte-identical to
		// before — the same discipline the config doc uses for every optional block.
		const perReel = Array.from({ length: reels }, (_unused, i) =>
			Math.max(1, Math.round(Number(rowsList[i] ?? rowsList[rowsList.length - 1]))),
		);
		const rowsPerReel = perReel.some((r) => r !== perReel[0]) ? perReel : undefined;
		const paylines = Object.values(doc.paylines ?? {});
		// A `cluster`, `scatter` or `ways` game legitimately has NO paylines, so the payline requirement
		// applies only where paylines are what pays. Requiring them everywhere is what would have made
		// such a project fall back to the shared lines grid and pay line wins. The mock generates a
		// full-coverage set from the dimensions for its own reveal shape; the evaluator ignores it.
		if (!Number.isFinite(reels)) return undefined;
		if (protocol === 'book') {
			// No authored table ⇒ no grid ⇒ the contract is exactly what it was before this existed.
			const symbolPaytable = projectSymbolPaytable(doc, bookMapping);
			return symbolPaytable ? { reels, rows, paylines, symbolPaytable } : undefined;
		}
		if ((protocol === 'lines' || protocol === 'holdAndWin') && !paylines.length) return undefined;
		// `holdAndWin` runs its own mock, which deals from the block and the project's OWN symbol names
		// — none of the lines mock's server-vocabulary fields below apply. Its base game pays lines, so
		// it takes the board, the lines and the bet table like a lines game. No block ⇒ no inputs, and
		// the test server deals the base game as lines (and says so).
		if (protocol === 'holdAndWin') {
			const holdAndWin = holdAndWinMockInputs(doc);
			const betModes = projectBetModes(doc, projectKey);
			return {
				reels,
				rows,
				...(rowsPerReel ? { rowsPerReel } : {}),
				paylines,
				...(betModes ? { betModes } : {}),
				...(holdAndWin ? { holdAndWin } : {}),
			};
		}
		const wild = projectWild(doc);
		// `stacked`: does this project have the stacked-picture reel mode ON? Gated on the SAME master
		// toggle the symbol bake reads (`stackedPictures.enabled` + ≥1 authored symbol) so the mock deals
		// tall-symbol runs — incl. guaranteed edge cutoffs — only for a project that actually stacks
		// pictures. Best-effort: a missing/empty symbols doc ⇒ no flag ⇒ the normal weighted deal.
		const stacked = symbolFacts.stacked;
		// `symbols`: the in-play line-symbol pool in the mock's SERVER vocabulary (PIC*/SCAT), so a
		// symbol the project marks UNUSED (off the strips) truly never lands against our own mock — and a
		// symbol it DOES use reaches the deal even when only the extended names can carry it.
		const symbols = projectLineSymbols(doc);
		// The cluster shape the mock evaluates against, straight from the project's declared win
		// model — so the mock pays the geometry `/config` says it pays, not a hardcoded guess.
		const model = resolveWinModel(doc);
		// Scatter is the only model that collects multipliers today, so the flag rides only for it —
		// a lines game declaring a multiplier symbol should not start dealing them.
		const multiplier = model.type === 'scatter' && projectMultiplier(doc, symbolFacts);
		const cluster =
			model.type === 'cluster'
				? { minCluster: model.minCluster, adjacency: model.adjacency }
				: undefined;
		// Scatter pays by COUNT anywhere, so the mock needs its threshold on top of the shared table.
		const scatter = model.type === 'scatter' ? { minCount: model.minCount } : undefined;
		// The project's own paytable, for EVERY win model. It used to ride with `scatter` alone, on
		// the reasoning that only a count-priced game needed values the mock's run-length table could
		// not stand in for. True as far as it went, but it left every lines/ways/cluster game paying
		// the mock's captured Hot Fruits numbers whatever `/config` authored — and it left the three
		// newly-mapped symbols (`H5`/`L3`/`L4` → `PIC8`/`PIC9`/`PIC10`) with no price row at all,
		// since the mock's own table has none for them. Same gap, one fix: the mock prices what the
		// project authored, and falls back to its own table per-symbol for anything unpriced.
		const symbolPaytable = projectSymbolPaytable(doc, linesMapping);
		const scatterPaytable = projectScatterPaytable(doc);
		const betModes = projectBetModes(doc, projectKey);
		return {
			reels,
			rows,
			...(rowsPerReel ? { rowsPerReel } : {}),
			paylines,
			...(wild ? { wild } : {}),
			...(stacked ? { stacked: true } : {}),
			...(symbols ? { symbols } : {}),
			...(multiplier ? { multiplier: true } : {}),
			...(cluster ?? {}),
			...(scatter ?? {}),
			...(symbolPaytable ? { symbolPaytable } : {}),
			...(scatterPaytable ? { scatterPaytable } : {}),
			...(betModes ? { betModes } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * Everything the test server's mock RGS needs to deal THIS project's game, as the manifest entry
 * carries it. `grid`/`cascade` are omitted — not defaulted — when the project never stated them, so
 * "un-authored" keeps meaning "the mock's own shared default decides", exactly as it did when this
 * was only ever computed at publish.
 */
export interface MockContract {
	protocol: MockProtocol;
	cascade?: boolean;
	grid?: TestServerGameEntry['grid'];
}

/**
 * Which client a contract is for. `published`: a player boot, which reads the project's published
 * snapshot. `live`: an authoring boot (`ie_authoring=1`) — and a standalone build, whose config was
 * baked from live data — which read the current authoring data.
 */
export type MockContractSource = 'published' | 'live';

/**
 * A resolved contract plus what it was actually read from, mirroring `/api/editor/runtime`'s
 * `X-IE-Runtime-Source`: `snapshot` (with its id), `live`, or `live-fallback` — a `published` ask for
 * a game with no readable snapshot, answered from live data exactly as that game's players are.
 */
export interface ResolvedMockContract extends MockContract {
	source: 'snapshot' | 'live' | 'live-fallback';
	snapshot?: string;
}

function deriveMockContract(
	protocol: MockProtocol,
	doc: GameConfigDoc | null,
	symbolFacts: SymbolFacts,
	projectKey: string,
): MockContract {
	const grid = projectGrid(protocol, doc, symbolFacts, projectKey);
	const cascade = projectCascade(doc);
	return {
		protocol,
		...(grid ? { grid } : {}),
		...(cascade === undefined ? {} : { cascade }),
	};
}

/**
 * The contract of one assembled runtime bundle — the config and symbols its client boots. Publish
 * calls this on the bundle it is about to freeze, so the manifest's fallback copy describes the
 * snapshot players are switched to, not whatever the live data says a moment later.
 */
export function mockContractOfBundle(
	protocol: MockProtocol,
	bundle: Pick<RuntimeBundle, 'config' | 'symbols'>,
	projectKey: string,
): MockContract {
	// Normalized like the live read (`loadGameConfigDoc`) and the client (`getActiveGameConfig`): a
	// snapshot keeps the stored shape of its day, and a later migration in `normalize.ts` must reach
	// the mock the same way it reaches the game drawing it.
	return deriveMockContract(
		protocol,
		bundle.config ? (normalizeGameConfigDoc(bundle.config) ?? null) : null,
		bundleSymbolFacts(bundle.symbols),
		projectKey,
	);
}

async function liveMockContract(
	protocol: MockProtocol,
	clientKey: string,
	projectKey: string,
): Promise<MockContract> {
	const doc = await loadGameConfigDoc(clientKey, projectKey).catch(() => null);
	const symbolFacts = doc ? await liveSymbolFacts(clientKey, projectKey) : NO_SYMBOL_FACTS;
	return deriveMockContract(protocol, doc, symbolFacts, projectKey);
}

/**
 * Resolve a project's mock contract for `source`. The ONE derivation — `/api/game-config/mock` serves
 * what this returns and `publishGame` snapshots the same derivation of the bundle it freezes, so the
 * fallback copy cannot describe a different game from the on-demand answer.
 *
 * `published` reads the snapshot through the SAME pointer + bundle caches the player boot uses
 * (`currentPointer` / `readSnapshotBundle`), so a republish or rollback reaches the mock on the same
 * clock it reaches players. An R2 failure throws rather than falling back to live: dealing the
 * unpublished board to players is the defect this exists to prevent, and the test server keeps its
 * current mock on an error.
 */
export async function resolveMockContract(
	projectKey: string,
	source: MockContractSource,
): Promise<ResolvedMockContract> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const protocol = protocolFor(await projectGameType(projectKey));
	if (source === 'published') {
		const pointer = await currentPointer(clientKey, projectKey);
		const bundle = pointer
			? await readSnapshotBundle(clientKey, projectKey, pointer.current)
			: null;
		if (pointer && bundle) {
			return {
				...mockContractOfBundle(protocol, bundle, projectKey),
				source: 'snapshot',
				snapshot: pointer.current,
			};
		}
	}
	return {
		...(await liveMockContract(protocol, clientKey, projectKey)),
		source: source === 'live' ? 'live' : 'live-fallback',
	};
}
