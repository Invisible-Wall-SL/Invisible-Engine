/**
 * Invisible Game Config decides which symbols Invisible Symbols lists — pinned for every game kind
 * and every setup a project can be in, so a symbol `/config` badges UNUSED never shows a row in
 * `/symbols`, and a symbol it badges in play (or a pots overlay token) always does.
 *
 *   1. THE RULE — `symbolUses` (`game-config`): a strip-dealt symbol is `inPlay`, a pots overlay's
 *      token is `token`, anything else in the dictionary is `unused`; `symbolsUsed` is the set the
 *      board can show. Without an overlay it IS the in-play gate, and an overlay never changes the
 *      gate itself (the mock's deal pool never deals a token).
 *   2. THE TWO TOOLS AGREE — for every kind (built-in and custom) × every setup (never saved, saved
 *      as the template, a symbol taken off or put on the reels, a dictionary-only symbol, each pots
 *      overlay and Hold and Win bonus preset, an imported bonus) × every defaults source (the
 *      committed set, a published set that predates the in-play filter, a published set missing
 *      symbols): `symbolGrid` over the config `/config` opens with lists exactly the symbols that page
 *      does not badge unused, each with a defaults entry, the published art kept.
 *   3. THE WIRING — both pages resolve the config through `resolveGameConfig` (the authored doc, else
 *      the kind's template), `/symbols` renders `symbolGrid`'s rows and nothing else, its stacked
 *      pictures list only those rows, and `/config` badges with `symbolUses`.
 *
 * Run:  pnpm --filter launcher-api check:symbols-follow-config
 */

import { fileURLToPath } from 'node:url';
import { GAME_KINDS } from 'constants-shared/gameKinds';
import {
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_PRESETS,
	POTS_OVERLAY_PRESET_IDS,
	addHoldAndWinBonus,
	addPotsOverlay,
	importBonus,
	normalizeGameConfigDoc,
	symbolsInPlay,
	symbolsUsed,
	symbolUses,
	type GameConfigDoc,
} from 'game-config';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults.ts';
import {
	symbolDefaultsFor,
	symbolGrid,
	type SymbolDefaults,
} from '../src/lib/server/symbolDefaults.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** What a save then a load does to a doc: the stored config is always the normalized one. */
const saved = (doc: GameConfigDoc): GameConfigDoc => {
	const out = normalizeGameConfigDoc(structuredClone(doc));
	if (!out) throw new Error('a setup config did not normalize');
	return out;
};

/** `/config`'s badge click on an in-play symbol: every cell of it off every strip, never emptying a
 *  reel (`toggleInPlay`). */
const takeOffReels = (doc: GameConfigDoc, name: string): GameConfigDoc => {
	const next = structuredClone(doc);
	for (const type of Object.keys(next.paddingReels)) {
		next.paddingReels[type] = next.paddingReels[type].map((reel) => {
			const kept = reel.filter((cell) => cell.name !== name);
			return kept.length ? kept : reel;
		});
	}
	return next;
};

/** …and on an unused one: one cell of it on every reel of every strip. */
const putOnReels = (doc: GameConfigDoc, name: string): GameConfigDoc => {
	const next = structuredClone(doc);
	for (const strips of Object.values(next.paddingReels))
		for (const reel of strips) reel.push({ name });
	return next;
};

const unusedOf = (doc: GameConfigDoc): string[] =>
	Object.entries(symbolUses(doc))
		.filter(([, use]) => use === 'unused')
		.map(([name]) => name);

// ── 1. the rule ─────────────────────────────────────────────────────────────────────────────────
const TEMPLATES: Record<string, GameConfigDoc> = {};
for (const kind of GAME_KINDS) {
	const template = gameConfigDefaultFor(kind);
	if (!template) throw new Error(`no committed template for ${kind}`);
	TEMPLATES[kind] = template;
}
for (const id of HOLD_AND_WIN_PRESET_IDS)
	TEMPLATES[`holdAndWin.${id}`] = saved(HOLD_AND_WIN_PRESETS[id]);

for (const [id, doc] of Object.entries(TEMPLATES)) {
	const inPlay = symbolsInPlay(doc);
	check(`${id} · no overlay: the used set IS the in-play gate`, symbolsUsed(doc), inPlay);
	for (const [name, use] of Object.entries(symbolUses(doc))) {
		check(
			`${id} · ${name} is badged by the strips`,
			use,
			inPlay.includes(name) ? 'inPlay' : 'unused',
		);
	}
}
const lines = TEMPLATES.lines;
check(
	'lines template · W is unused (in the dictionary, on no strip)',
	symbolUses(lines).W,
	'unused',
);

const threePots = addPotsOverlay(lines, 'threePots');
if (!threePots.ok) throw new Error(`threePots on lines: ${threePots.reason}`);
const potsDoc = saved(threePots.doc);
const tokens = potsDoc.potsOverlay?.pots.map((pot) => pot.token) ?? [];
check('threePots · three tokens', tokens.length, 3);
for (const token of tokens) {
	check(`threePots · ${token} is a token, never unused`, symbolUses(potsDoc)[token], 'token');
	check(`threePots · ${token} is used`, symbolsUsed(potsDoc).includes(token), true);
	check(`threePots · ${token} is not dealt`, symbolsInPlay(potsDoc).includes(token), false);
}
const freeSpinsPots = addPotsOverlay(lines, 'potsToFreeSpins');
if (!freeSpinsPots.ok) throw new Error(`potsToFreeSpins on lines: ${freeSpinsPots.reason}`);
check(
	'an overlay alone leaves the in-play gate (the deal pool) as it was',
	symbolsInPlay(saved(freeSpinsPots.doc)),
	symbolsInPlay(lines),
);
const tokenOnStrip = putOnReels(potsDoc, tokens[0]);
check('a token on a strip is dealt, so in play', symbolUses(tokenOnStrip)[tokens[0]], 'inPlay');

const stripOnly = putOnReels(lines, 'NEW');
check(
	'a strip symbol with no dictionary entry is still in play',
	symbolUses(stripOnly).NEW,
	'inPlay',
);
check('…and used', symbolsUsed(stripOnly).includes('NEW'), true);

const ghostToken = structuredClone(potsDoc);
ghostToken.potsOverlay!.pots[0].token = 'GHOST';
check(
	'a pot whose token is not in the dictionary still draws it',
	symbolUses(ghostToken).GHOST,
	'token',
);

const dictionaryOnly = structuredClone(lines);
dictionaryOnly.symbols.EXTRA = {};
check('a dictionary-only symbol is unused', symbolUses(dictionaryOnly).EXTRA, 'unused');
check('…and not used', symbolsUsed(dictionaryOnly).includes('EXTRA'), false);

// ── 2. the two tools agree ──────────────────────────────────────────────────────────────────────
/** Every setup a project of `kind` can be in: the doc `/config` opens with, or `null` when it was
 *  never saved (`/config` then opens on the kind's template). */
function setups(kind: string): Array<{ label: string; authored: GameConfigDoc | null }> {
	const template = gameConfigDefaultFor(kind);
	if (!template) throw new Error(`no template for ${kind}`);
	const out: Array<{ label: string; authored: GameConfigDoc | null }> = [
		{ label: 'never saved', authored: null },
		{ label: 'saved as the template', authored: saved(template) },
	];
	const inPlay = symbolsInPlay(template);
	const unused = unusedOf(template);
	out.push({
		label: `${inPlay[0]} taken off the reels`,
		authored: saved(takeOffReels(template, inPlay[0])),
	});
	for (const name of unused) {
		out.push({ label: `${name} put on the reels`, authored: saved(putOnReels(template, name)) });
	}
	const withExtra = structuredClone(template);
	withExtra.symbols.EXTRA = {};
	out.push({ label: 'a dictionary-only symbol', authored: saved(withExtra) });
	for (const id of POTS_OVERLAY_PRESET_IDS) {
		const result = addPotsOverlay(template, id);
		if (result.ok) out.push({ label: `pots overlay ${id}`, authored: saved(result.doc) });
	}
	for (const id of HOLD_AND_WIN_PRESET_IDS) {
		const result = addHoldAndWinBonus(template, id);
		if (result.ok) out.push({ label: `Hold and Win bonus ${id}`, authored: saved(result.doc) });
	}
	if (kind === 'holdAndWin') {
		for (const id of HOLD_AND_WIN_PRESET_IDS) {
			out.push({ label: `Hold and Win preset ${id}`, authored: saved(HOLD_AND_WIN_PRESETS[id]) });
		}
	}
	const host = addPotsOverlay(template, 'potsToFreeSpins');
	if (host.ok && !host.doc.holdAndWin) {
		const imported = importBonus(host.doc, HOLD_AND_WIN_PRESETS.classic, {
			project: 'source',
			mode: 'holdAndWin',
			at: '2026-10-07T00:00:00.000Z',
		});
		if (imported.ok)
			out.push({ label: 'imported Hold and Win bonus', authored: saved(imported.doc) });
	}
	return out;
}

/** Each defaults source the grid can be built from. */
function defaultsSources(kind: string): Array<{ label: string; defaults: SymbolDefaults }> {
	const committed = symbolDefaultsFor(kind);
	const anyRow = Object.values(committed.symbols)[0];
	const [first] = Object.keys(committed.symbols);
	return [
		{ label: 'committed defaults', defaults: committed },
		{
			// A project that published before the in-play filter, or whose game codes more symbols.
			label: 'a published set wider than the config',
			defaults: {
				...committed,
				symbols: { ...committed.symbols, W: anyRow, H5: anyRow, OLD: anyRow },
			},
		},
		{
			label: 'a published set missing symbols',
			defaults: { ...committed, symbols: { [first]: committed.symbols[first] } },
		},
	];
}

let combos = 0;
const kindsSeen = new Set<string>();
for (const kind of [...GAME_KINDS, 'myCustomKind']) {
	for (const { label, authored } of setups(kind)) {
		// `resolveGameConfig`'s precedence: the authored doc, else the kind's template (section 3 pins
		// that both pages go through it).
		const shown = authored ?? gameConfigDefaultFor(kind);
		if (!shown) throw new Error(`no config for ${kind} · ${label}`);
		const uses = symbolUses(shown);
		const badged = Object.keys(shown.symbols);
		for (const source of defaultsSources(kind)) {
			const at = `${kind} · ${label} · ${source.label}`;
			const grid = symbolGrid(source.defaults, shown);
			const rows = new Set(grid.symbols);
			combos += 1;
			kindsSeen.add(kind);
			check(
				`${at} · no row for a symbol /config badges unused`,
				badged.filter((name) => uses[name] === 'unused' && rows.has(name)),
				[],
			);
			check(
				`${at} · a row for every symbol /config badges in play or token`,
				badged.filter((name) => uses[name] !== 'unused' && !rows.has(name)),
				[],
			);
			check(
				`${at} · the rows are exactly what the board can show`,
				[...rows].sort(),
				symbolsUsed(shown),
			);
			check(`${at} · each row listed once`, grid.symbols.length, rows.size);
			check(
				`${at} · every row has a defaults entry for its cells to read`,
				grid.symbols.filter((name) => !grid.defaults.symbols[name]),
				[],
			);
			check(
				`${at} · a row with published art keeps it`,
				grid.symbols
					.filter((name) => source.defaults.symbols[name])
					.filter((name) => grid.defaults.symbols[name] !== source.defaults.symbols[name]),
				[],
			);
		}
	}
}
check('every kind ran', [...kindsSeen].sort(), [...GAME_KINDS, 'myCustomKind'].sort());

// The pots overlay and imported-bonus setups ran where the add-on applies.
const ran = (kind: string, label: string) => setups(kind).some((s) => s.label === label);
for (const kind of GAME_KINDS.filter((k) => k !== 'holdAndWin')) {
	check(`${kind} · the threePots overlay setup ran`, ran(kind, 'pots overlay threePots'), true);
	check(
		`${kind} · the Hold and Win bonus setup ran`,
		ran(kind, 'Hold and Win bonus classic'),
		true,
	);
	check(`${kind} · the imported bonus setup ran`, ran(kind, 'imported Hold and Win bonus'), true);
}
check('holdAndWin · a pots overlay setup ran', ran('holdAndWin', 'pots overlay threePots'), true);

// The cases that were wrong before this gate, by name.
const rowsFor = (
	kind: string,
	authored: GameConfigDoc | null,
	defaults = symbolDefaultsFor(kind),
) => symbolGrid(defaults, authored ?? gameConfigDefaultFor(kind)).symbols;
check(
	'scatter never saved · L4 (unused in its template) hidden, M (in play) listed',
	[rowsFor('scatter', null).includes('L4'), rowsFor('scatter', null).includes('M')],
	[false, true],
);
check(
	'ways never saved · H5 (in play) listed, L5 (not in its config) hidden',
	[rowsFor('ways', null).includes('H5'), rowsFor('ways', null).includes('L5')],
	[true, false],
);
check(
	'lines never saved, an old unfiltered publish · W and H5 hidden',
	rowsFor('lines', null, defaultsSources('lines')[1].defaults).filter(
		(n) => n === 'W' || n === 'H5',
	),
	[],
);
check(
	'a pots overlay · its tokens listed',
	tokens.filter((t) => !rowsFor('lines', potsDoc).includes(t)),
	[],
);
check(
	'no config at all · every default listed, as before',
	symbolGrid(symbolDefaultsFor('lines'), null).symbols,
	Object.keys(symbolDefaultsFor('lines').symbols),
);

// ── 3. the wiring ───────────────────────────────────────────────────────────────────────────────
const here = fileURLToPath(new URL('.', import.meta.url));
const read = (path: string): string => readLF(`${here}../src/routes/(app)/${path}`);
const configServer = read('config/+page.server.ts');
const configPage = read('config/+page.svelte');
const symbolsServer = read('symbols/+page.server.ts');
const symbolsPage = read('symbols/+page.svelte');
check(
	'/config opens the config through resolveGameConfig',
	/resolveGameConfig\(/.test(configServer),
	true,
);
check(
	'/symbols reads the SAME config: resolveGameConfig, never the authored-only loader',
	[/resolveGameConfig\(/.test(symbolsServer), /loadGameConfigDoc\b/.test(symbolsServer)],
	[true, false],
);
check(
	'/symbols builds its rows with symbolGrid over that config',
	/symbolGrid\(published \?\? symbolDefaultsFor\(gameType\), configDoc\)/.test(symbolsServer) &&
		/symbols: grid\.symbols/.test(symbolsServer),
	true,
);
check(
	'/symbols lists data.symbols as they come',
	/const symbolNames = \$derived\(data\.symbols\);/.test(symbolsPage),
	true,
);
check(
	'/symbols lists stacked pictures only for listed symbols',
	/stackedSymbols\(doc\)\.filter\(\(s\) => shownSymbols\.has\(s\.name\)\)/.test(symbolsPage),
	true,
);
check(
	'/config badges each symbol with symbolUses (a token is not unused)',
	/symbolUses\(snapshot\)/.test(configPage) && /uses\[name\] === 'token'/.test(configPage),
	true,
);

console.log(
	failures === 0
		? `\nsymbols follow config: OK (${checks} checks, ${combos} kind × setup × defaults combinations)`
		: `\nsymbols follow config: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
