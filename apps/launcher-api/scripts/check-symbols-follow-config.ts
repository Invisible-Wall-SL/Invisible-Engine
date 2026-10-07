/**
 * Invisible Game Config decides which symbols Invisible Symbols lists — pinned for every game kind
 * and every setup a project can be in, so a symbol `/config` badges UNUSED never shows a row in
 * `/symbols`, and a symbol it badges in play (or a pots overlay token) always does.
 *
 *   1. THE RULE — `symbolUses` (`game-config`): a strip-dealt symbol is `inPlay`, a pots overlay's
 *      token is `token`, anything else in the dictionary is `unused`; `symbolsUsed` is the set the
 *      board can show. Without an overlay it IS the in-play gate, and an overlay never changes the
 *      gate itself (the mock's deal pool never deals a token).
 *   2. THE TWO TOOLS AGREE — for every kind (built-in and custom) × every setup (never saved, an
 *      unreadable `config.json`, saved as the template, a symbol taken off or put on the reels, a
 *      dictionary-only symbol, each pots overlay and Hold and Win bonus preset, an imported bonus) ×
 *      every defaults source (the committed set, a published set that predates the in-play filter,
 *      a published set missing symbols): the page's own composition (`symbolsPageConfig`) over the
 *      config `resolveGameConfig` gives (`resolvedGameConfigFrom`, its precedence) lists exactly the
 *      symbols `/config` does not badge unused over that same doc, each with a defaults entry, the
 *      published art kept, tokens in pot order — and nothing it shows depends on whether the config
 *      was saved.
 *      The pots overlay's coins (its tokens) are a section of their own in `/config`, with no badge,
 *      and the same coins are `/symbols`' coin group.
 *   3. THE WIRING — both pages resolve the config through `resolveGameConfig`, `/symbols` builds its
 *      data with `symbolsPageConfig` and renders its rows and nothing else, its stacked pictures list
 *      only those rows, `/config` badges with `symbolUses` — the symbols only, the coins in their own
 *      unbadged section — and `/symbols` draws its coin rows as a group of their own.
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
import {
	gameConfigDefaultFor,
	resolvedGameConfigFrom,
} from '../src/lib/server/gameConfigDefaults.ts';
import { symbolDefaultsFor, type SymbolDefaults } from '../src/lib/server/symbolDefaults.ts';
import { symbolsPageConfig } from '../src/lib/server/symbolsPageConfig.ts';

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

/** What a save then a load does to a config: the stored doc is always the normalized one. */
const saved = (raw: unknown): GameConfigDoc => {
	const out = normalizeGameConfigDoc(structuredClone(raw));
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

const templateOf = (kind: string): GameConfigDoc => {
	const template = gameConfigDefaultFor(kind);
	if (!template) throw new Error(`no committed template for ${kind}`);
	return template;
};

// ── 1. the rule ─────────────────────────────────────────────────────────────────────────────────
const TEMPLATES: Record<string, GameConfigDoc> = {};
for (const kind of GAME_KINDS) TEMPLATES[kind] = templateOf(kind);
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	TEMPLATES[`holdAndWin.${id}`] = saved(HOLD_AND_WIN_PRESETS[id]);
}

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
	check(`threePots · ${token} is not dealt`, symbolsInPlay(potsDoc).includes(token), false);
}
check('threePots · used: the strips, then the tokens in pot order', symbolsUsed(potsDoc), [
	...symbolsInPlay(potsDoc),
	...tokens,
]);
const freeSpinsPots = addPotsOverlay(lines, 'potsToFreeSpins');
if (!freeSpinsPots.ok) throw new Error(`potsToFreeSpins on lines: ${freeSpinsPots.reason}`);
check(
	'an overlay alone leaves the in-play gate (the deal pool) as it was',
	symbolsInPlay(saved(freeSpinsPots.doc)),
	symbolsInPlay(lines),
);
const tokenOnStrip = putOnReels(potsDoc, tokens[0]);
check('a token on a strip is dealt, so in play', symbolUses(tokenOnStrip)[tokens[0]], 'inPlay');
check('…and used once', symbolsUsed(tokenOnStrip).filter((name) => name === tokens[0]).length, 1);

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
/** A stored `config.json` as `loadGameConfigDocWithEtag` reads it: `doc: null` when there is none,
 *  or it does not parse. */
type Stored = { doc: GameConfigDoc | null; etag: string | null };

/** Every setup a project of `kind` can be in, as the stored config it leaves behind. */
function setups(kind: string): Array<{ label: string; stored: Stored }> {
	const template = templateOf(kind);
	const savedAs = (doc: GameConfigDoc): Stored => ({ doc: saved(doc), etag: '"e"' });
	const out: Array<{ label: string; stored: Stored }> = [
		{ label: 'never saved', stored: { doc: null, etag: null } },
		{ label: 'an unreadable config.json', stored: { doc: null, etag: '"corrupt"' } },
		{ label: 'saved as the template', stored: savedAs(template) },
	];
	const inPlay = symbolsInPlay(template);
	out.push({
		label: `${inPlay[0]} taken off the reels`,
		stored: savedAs(takeOffReels(template, inPlay[0])),
	});
	for (const name of unusedOf(template)) {
		out.push({ label: `${name} put on the reels`, stored: savedAs(putOnReels(template, name)) });
	}
	const withExtra = structuredClone(template);
	withExtra.symbols.EXTRA = {};
	out.push({ label: 'a dictionary-only symbol', stored: savedAs(withExtra) });
	for (const id of POTS_OVERLAY_PRESET_IDS) {
		const result = addPotsOverlay(template, id);
		if (result.ok) out.push({ label: `pots overlay ${id}`, stored: savedAs(result.doc) });
	}
	for (const id of HOLD_AND_WIN_PRESET_IDS) {
		const result = addHoldAndWinBonus(template, id);
		if (result.ok) out.push({ label: `Hold and Win bonus ${id}`, stored: savedAs(result.doc) });
	}
	if (kind === 'holdAndWin') {
		for (const id of HOLD_AND_WIN_PRESET_IDS) {
			out.push({
				label: `Hold and Win preset ${id}`,
				stored: savedAs(saved(HOLD_AND_WIN_PRESETS[id])),
			});
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
			out.push({ label: 'imported Hold and Win bonus', stored: savedAs(imported.doc) });
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
	for (const { label, stored } of setups(kind)) {
		// What BOTH pages get from `resolveGameConfig` (section 3 pins that both call it).
		const config = resolvedGameConfigFrom(stored, kind);
		const shown = config.doc;
		if (!shown) throw new Error(`no config for ${kind} · ${label}`);
		const uses = symbolUses(shown);
		const badged = Object.keys(shown.symbols);
		const overlayTokens = shown.potsOverlay?.pots.map((pot) => pot.token) ?? [];
		for (const source of defaultsSources(kind)) {
			const at = `${kind} · ${label} · ${source.label}`;
			const page = symbolsPageConfig(kind, source.defaults, config);
			const rows = new Set(page.symbols);
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
				[...symbolsUsed(shown)].sort(),
			);
			check(`${at} · each row listed once`, page.symbols.length, rows.size);
			check(
				`${at} · every row has a defaults entry for its cells to read`,
				page.symbols.filter((name) => !page.defaults.symbols[name]),
				[],
			);
			check(
				`${at} · a row with published art keeps it`,
				page.symbols
					.filter((name) => source.defaults.symbols[name])
					.filter((name) => page.defaults.symbols[name] !== source.defaults.symbols[name]),
				[],
			);
			check(
				`${at} · tokens without published art follow pot order`,
				page.symbols.filter(
					(name) => overlayTokens.includes(name) && !source.defaults.symbols[name],
				),
				overlayTokens.filter((name) => !source.defaults.symbols[name] && rows.has(name)),
			);
			check(
				`${at} · the /symbols coin group is the overlay's coins, in pot order`,
				[page.coins, [...page.coins].sort()],
				[
					[...new Set(overlayTokens)].filter((name) => uses[name] === 'token'),
					page.symbols.filter((name) => uses[name] === 'token').sort(),
				],
			);
			check(
				`${at} · nothing shown depends on whether the config was saved`,
				symbolsPageConfig(kind, source.defaults, { ...config, source: 'authored' }),
				symbolsPageConfig(kind, source.defaults, { ...config, source: 'template' }),
			);
		}
	}
}
check('every kind ran', [...kindsSeen].sort(), [...GAME_KINDS, 'myCustomKind'].sort());

// The add-on setups ran where the add-on applies.
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
const rowsFor = (kind: string, stored: Stored, defaults = symbolDefaultsFor(kind)) =>
	symbolsPageConfig(kind, defaults, resolvedGameConfigFrom(stored, kind)).symbols;
const neverSaved: Stored = { doc: null, etag: null };
check(
	'scatter never saved · L4 (unused in its template) hidden, M (in play) listed',
	[rowsFor('scatter', neverSaved).includes('L4'), rowsFor('scatter', neverSaved).includes('M')],
	[false, true],
);
check(
	'ways never saved · H5 (in play) listed, L5 (not in its config) hidden',
	[rowsFor('ways', neverSaved).includes('H5'), rowsFor('ways', neverSaved).includes('L5')],
	[true, false],
);
check(
	'lines never saved, an old unfiltered publish · W and H5 hidden',
	rowsFor('lines', neverSaved, defaultsSources('lines')[1].defaults).filter(
		(name) => name === 'W' || name === 'H5',
	),
	[],
);
check(
	'a pots overlay · its tokens listed, in pot order',
	rowsFor('lines', { doc: potsDoc, etag: '"e"' }).filter((name) => tokens.includes(name)),
	tokens,
);
{
	// Published art that lists the coins backwards does not reorder the Coins group.
	const committed = symbolDefaultsFor('lines');
	const anyRow = Object.values(committed.symbols)[0];
	const backwards: SymbolDefaults = {
		...committed,
		symbols: {
			...committed.symbols,
			...Object.fromEntries([...tokens].reverse().map((token) => [token, anyRow])),
		},
	};
	check(
		'a pots overlay · the coin group keeps pot order whatever order published art lists',
		symbolsPageConfig(
			'lines',
			backwards,
			resolvedGameConfigFrom({ doc: potsDoc, etag: '"e"' }, 'lines'),
		).coins,
		tokens,
	);
}

// ── 3. the wiring ───────────────────────────────────────────────────────────────────────────────
const here = fileURLToPath(new URL('.', import.meta.url));
const read = (path: string): string => readLF(`${here}../src/routes/(app)/${path}`);
const configServer = read('config/+page.server.ts');
const configPage = read('config/+page.svelte');
const symbolsServer = read('symbols/+page.server.ts');
const symbolsPage = read('symbols/+page.svelte');
/** Does `source` hold `code`, whitespace aside? A re-wrap never breaks a pin; a change of code does. */
const holds = (source: string, code: string): boolean =>
	source.replace(/\s+/g, '').includes(code.replace(/\s+/g, ''));
check(
	'/config opens the config through resolveGameConfig',
	holds(configServer, 'resolveGameConfig('),
	true,
);
check(
	'/symbols reads the SAME config: resolveGameConfig, and no loader that skips the template',
	[
		holds(
			symbolsServer,
			'gameTypeLoad.then((type) => resolveGameConfig(clientKey, projectKey, type))',
		),
		/loadGameConfigDoc/.test(symbolsServer),
	],
	[true, false],
);
check(
	'/symbols builds everything config-driven with symbolsPageConfig over that resolution',
	holds(
		symbolsServer,
		'...symbolsPageConfig(gameType, published ?? symbolDefaultsFor(gameType), config)',
	),
	true,
);
check(
	'/symbols lists data.symbols as they come',
	holds(symbolsPage, 'const symbolNames = $derived(data.symbols);'),
	true,
);
check(
	'/symbols lists stacked pictures only for listed symbols',
	holds(symbolsPage, 'stackedSymbols(doc).filter((s) => shownSymbols.has(s.name))'),
	true,
);
check(
	'/config badges with symbolUses — only the symbols that are not coins',
	holds(configPage, 'symbolUses(snapshot)') &&
		holds(
			configPage,
			"const reelSymbolNames = $derived(symbolNames.filter((name) => uses[name] !== 'token'));",
		) &&
		holds(configPage, '{#each reelSymbolNames as name (name)}'),
	true,
);
const coinsAt = configPage.indexOf('<h2>Coins</h2>');
const coinsSection =
	coinsAt < 0 ? '' : configPage.slice(coinsAt, configPage.indexOf('</section>', coinsAt));
check(
	'/config lists the coins in a section of their own, in pot order, with no in play / unused badge',
	holds(
		configPage,
		"const coinNames = $derived(symbolsUsed(snapshot).filter((name) => uses[name] === 'token'",
	) &&
		holds(coinsSection, '{#each coinNames as name (name)}') &&
		!/class="badge/.test(coinsSection),
	true,
);
check(
	'/symbols draws its coin rows, in pot order, as a group of their own',
	holds(symbolsPage, 'const coinRows = $derived(data.coins);') &&
		holds(symbolsPage, '{#each coinRows as symbol (symbol)}'),
	true,
);

console.log(
	failures === 0
		? `\nsymbols follow config: OK (${checks} checks, ${combos} kind × setup × defaults combinations)`
		: `\nsymbols follow config: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
