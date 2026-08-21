/**
 * The MATH CONTRACT the Invisible Test Server's mock RGS deals a project with — protocol, cascade
 * and grid (dimensions, paylines, in-play symbol pool, wild, cluster/scatter shape) — derived from
 * that project's own Invisible Game Config.
 *
 * It lives here, apart from `publishGame.ts`, because it is now resolved on TWO paths and the two
 * must never disagree:
 *
 *   - **publish** (`publishGame`) snapshots it into the test-server manifest (`test_server/games.json`),
 *     which is what an offline/degraded test server falls back to;
 *   - **live** (`GET /api/game-config/mock`) serves it on demand, so the running mock re-reads the
 *     project's config and deals the CURRENT board.
 *
 * The live path exists because the snapshot alone was a lie by design: `/config` is fetched LIVE by
 * the client (its `numReels`/`numRows` resize the board immediately) while the mock kept dealing
 * whatever the last publish froze. Change the grid without republishing and the client drew 8×4
 * against a server still dealing 5×3 — every cell outside the server board empty, wins scored on a
 * board nobody was looking at. The config decides the game; the mock has no math of its own to
 * defend, so it follows.
 *
 * A REAL RGS is still authoritative — that direction is a certification requirement, not a choice,
 * and `game/gameConfig.ts`'s `__IE_SERVER_CONFIG__` overlay implements it. This module only makes
 * OUR mock derive its answer from the project instead of from a stale copy of it.
 */
import { resolveWinModel, symbolsInPlay, type GameConfigDoc, type PaytableRow } from 'game-config';
import { linesMapping, mapSymbol } from 'rgs-translator-eagaming/game-mappings';
import { loadGameConfigDoc } from './gameConfigStorage';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { projectClientKey, projectGameType } from './projects';
import { loadSymbolsDoc } from './symbolsStorage';
import type { MockProtocol, TestServerGameEntry } from './testServerManifest';

/**
 * Map an authored game kind to its mock RGS protocol. Book-of games use the `book` mock
 * (buy-feature + free spins); `ways` uses the lines mock with its ways win evaluator (Phase D of
 * `docs/design/game-type-templates.md`); everything else uses the plain `lines` mock.
 */
function protocolFor(gameType: string): MockProtocol {
	if (gameType === 'bookOf') return 'book';
	if (gameType === 'ways') return 'ways';
	// `cluster` reuses the lines mock too, swapping only how wins are DECIDED (a flood fill instead of
	// a payline walk). It is TEST infrastructure — the mock's paytable is keyed by payline run lengths,
	// so a cluster's payout is approximated; see `evaluateClusters`.
	if (gameType === 'cluster') return 'cluster';
	// `scatter` likewise — a count-anywhere evaluator, and the only one that also ships the project's
	// own paytable because its pricing is by count, not by run length. See `projectSymbolPaytable`.
	if (gameType === 'scatter') return 'scatter';
	return 'lines';
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
 * `undefined` when it equals the full default set (so an all-in-play project stays byte-identical —
 * the field is simply omitted). Keyed off the SAME `symbolsInPlay` gate as the paytable/roll/wild.
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
async function projectMultiplier(
	doc: GameConfigDoc,
	clientKey: string,
	projectKey: string,
): Promise<boolean> {
	const name = projectMultiplierSymbol(doc);
	if (!name) return false;
	try {
		const symbols = await loadSymbolsDoc(clientKey, projectKey);
		return Boolean(symbols.symbols?.[name]?.static);
	} catch {
		return false;
	}
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
	if (!allowed.length || allowed.length === serverPool.length) return undefined;
	return allowed;
}

/**
 * The project's per-symbol paytable in the mock's SERVER vocabulary, as `{ PIC1: { 8: 3, … } }`.
 *
 * Only the `scatter` model needs this, and it needs it for a concrete reason: a scatter game prices
 * by HOW MANY of a symbol are on the board (8, 9, 10, 13+ …), while the mock's own table is keyed by
 * payline RUN LENGTHS (3/4/5). Clamping a count of 12 into a 5-run row would make every scatter win
 * pay the same number — degenerate enough to be useless for testing. The authored table already has
 * the right shape, so it travels instead of being approximated. (Cluster has no such table to send,
 * which is why it clamps and says so.)
 *
 * In-play gate + client→server translation, same as `projectLineSymbols`.
 */
function projectSymbolPaytable(
	doc: GameConfigDoc,
): Record<string, Record<string, number>> | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	const out: Record<string, Record<string, number>> = {};
	for (const server of Object.keys(linesMapping.symbols)) {
		if (server === 'WILD') continue;
		const client = mapSymbol(linesMapping, server);
		if (!inPlay.has(client)) continue;
		const rows = doc.symbols[client]?.paytable;
		if (!rows?.length) continue;
		out[server] = paytableToOccursMap(rows);
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * The project's OWN cascade answer, or `undefined` when it never stated one.
 *
 * Deliberately reads the stored field rather than `resolveCascade`: the resolved value would be a
 * boolean for EVERY project, and the test server treats a boolean as authoritative — which would
 * pin every unauthored game and break the `CASCADE_GAMES` escape hatch on lines games.
 */
async function projectCascade(clientKey: string, projectKey: string): Promise<boolean | undefined> {
	try {
		const doc = await loadGameConfigDoc(clientKey, projectKey);
		return typeof doc?.cascade === 'boolean' ? doc.cascade : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolve a project's board grid from its authored Game Config, in the shape the test-server mock
 * wants (`{ reels, rows, paylines: rows[][], wild?, … }`). Mirrors the test-server's own `linesGrid`
 * derivation so the mock deals the SAME dimensions the client draws, plus the in-play wild so `W`
 * can pay. Best-effort: no authored doc / odd config ⇒ `undefined` ⇒ the mock keeps its shared
 * default. `numRows` is the per-reel array, so `rows` is its max (a stepped board is a rectangle
 * tall enough to hold it).
 */
async function projectGrid(
	protocol: MockProtocol,
	clientKey: string,
	projectKey: string,
): Promise<TestServerGameEntry['grid']> {
	// EVERY protocol that runs on the lines mock needs its grid — that mock's board dimensions are the
	// grid. `ways` was excluded here on the reasoning that it "needs nothing beyond the board", which
	// is backwards: the board IS what it needs, and without it a ways project silently fell back to
	// the shared `apps/lines` 5×3 no matter what it authored (the live `test3` drew 8×4 against a 5×3
	// deal). `cluster`/`scatter` additionally carry their `minCluster`/`adjacency`/`minCount` shape.
	//
	// `book` is the one real exception: it runs `createBookMock`, which owns its own board and is
	// handed no grid at all, so deriving one for it would be dead data.
	if (protocol === 'book') return undefined;
	try {
		const doc = await loadGameConfigDoc(clientKey, projectKey);
		if (!doc) return undefined;
		const reels = Math.max(1, Math.round(Number(doc.numReels)));
		const rowsList = Array.isArray(doc.numRows) && doc.numRows.length ? doc.numRows : [3];
		const rows = Math.max(1, Math.round(Math.max(...rowsList)));
		const paylines = Object.values(doc.paylines ?? {});
		// A `cluster`, `scatter` or `ways` game legitimately has NO paylines, so the payline requirement
		// applies only where paylines are what pays. Requiring them everywhere is what would have made
		// such a project fall back to the shared lines grid and pay line wins. The mock generates a
		// full-coverage set from the dimensions for its own reveal shape; the evaluator ignores it.
		if (!Number.isFinite(reels)) return undefined;
		if (protocol === 'lines' && !paylines.length) return undefined;
		const wild = projectWild(doc);
		// `stacked`: does this project have the stacked-picture reel mode ON? Gated on the SAME master
		// toggle the symbol bake reads (`stackedPictures.enabled` + ≥1 authored symbol) so the mock deals
		// tall-symbol runs — incl. guaranteed edge cutoffs — only for a project that actually stacks
		// pictures. Best-effort: a missing/empty symbols doc ⇒ no flag ⇒ the normal weighted deal.
		const stacked = await projectStacked(clientKey, projectKey);
		// `symbols`: the in-play line-symbol pool in the mock's SERVER vocabulary (PIC*/SCAT), so a
		// symbol the project marks UNUSED (off the strips) truly never lands against our own mock.
		// Omitted for an all-in-play project ⇒ the mock deals its full default pool (byte-identical).
		const symbols = projectLineSymbols(doc);
		// The cluster shape the mock evaluates against, straight from the project's declared win
		// model — so the mock pays the geometry `/config` says it pays, not a hardcoded guess.
		const model = resolveWinModel(doc);
		// Scatter is the only model that collects multipliers today, so the flag rides only for it —
		// a lines game declaring a multiplier symbol should not start dealing them.
		const multiplier =
			model.type === 'scatter' && (await projectMultiplier(doc, clientKey, projectKey));
		const cluster =
			model.type === 'cluster'
				? { minCluster: model.minCluster, adjacency: model.adjacency }
				: undefined;
		// Scatter pays by COUNT anywhere, so the mock needs the threshold and — unlike cluster — the
		// project's own count-keyed paytable, which the mock's run-length table cannot stand in for.
		const scatter =
			model.type === 'scatter'
				? { minCount: model.minCount, symbolPaytable: projectSymbolPaytable(doc) }
				: undefined;
		return {
			reels,
			rows,
			paylines,
			...(wild ? { wild } : {}),
			...(stacked ? { stacked: true } : {}),
			...(symbols ? { symbols } : {}),
			...(multiplier ? { multiplier: true } : {}),
			...(cluster ?? {}),
			...(scatter ?? {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * True when the project has the stacked-picture reel mode enabled in its symbols doc (the SAME
 * `stackedPictures.enabled` master toggle `symbolExport` gates the baked `stacked` config on). Used to
 * tell the test-server mock to deal stacked boards. Best-effort — any read/parse failure ⇒ `false`.
 */
async function projectStacked(clientKey: string, projectKey: string): Promise<boolean> {
	try {
		const doc = await loadSymbolsDoc(clientKey, projectKey);
		return doc.stackedPictures?.enabled === true && (doc.stackedPictures.symbols?.length ?? 0) > 0;
	} catch {
		return false;
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
 * Resolve a project's live mock contract. The ONE derivation — `publishGame` snapshots what this
 * returns into the manifest, and `/api/game-config/mock` serves it verbatim, so a config change is
 * picked up by the running mock without a republish and the fallback snapshot cannot describe a
 * different game from the live answer.
 */
export async function resolveMockContract(projectKey: string): Promise<MockContract> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const protocol = protocolFor(await projectGameType(projectKey));
	const grid = await projectGrid(protocol, clientKey, projectKey);
	const cascade = await projectCascade(clientKey, projectKey);
	return {
		protocol,
		...(grid ? { grid } : {}),
		...(cascade === undefined ? {} : { cascade }),
	};
}
