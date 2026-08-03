/**
 * Invisible Game Config — headless harness for the `GameConfigDoc` contract
 * (`packages/game-config`). The `/config` page will be a launcher-authed surface (not
 * browser-verifiable here), so — exactly as the sibling tools do — we verify the data contract
 * the tool stands on OFFLINE, in Node:
 *
 *   pnpm --filter game-config-spike run doc
 *
 * It runs against the REAL `apps/lines/src/game/config.ts`, not a hand-written stub, so the
 * fixture fails the day the template config stops satisfying the contract the tool assumes.
 *
 * Proves: (1) the shipped template normalizes to a valid doc with no ERRORS — it must, since an
 * un-authored project ships it verbatim; (2) the in-play GATE reads the strips, not the dictionary
 * — the `W` bug, asserted directly; (3) garbage and half-configs return `undefined` (fall through
 * to the template) rather than an empty config that would blank the board; (4) the Stake wire shape
 * (`special_properties`, `max_win`, single-entry paytable rows) round-trips byte-compatibly;
 * (5) the validator catches a payline pointing off the grid and a strip dealing an undrawable
 * symbol; (6) normalization is IDEMPOTENT (the save→reload fixed point); (7) the COMMITTED template
 * default a new project inherits has not drifted from the config it is generated from.
 */

import { readFileSync } from 'node:fs';

import {
	GAME_CONFIG_DOC_VERSION,
	normalizeGameConfigDoc,
	resolveWinLevel,
	resolveWinLevelChain,
	resolveWinLevels,
	symbolsInPlay,
	symbolsInPlayForGameType,
	symbolFrequencies,
	validateGameConfigDoc,
	gameConfigErrors,
	isSymbolInPlay,
	winLevelMapToTiers,
	winLevelType,
	type GameConfigDoc,
} from 'game-config';

import templateConfig from '../../apps/lines/src/game/config';
import { winLevelMap } from '../../apps/lines/src/game/winLevelMap';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. The shipped template IS a valid config.
// ---------------------------------------------------------------------------
console.log('game config — the lines template');
const template = normalizeGameConfigDoc(templateConfig);
assert(template !== undefined, 'apps/lines config.ts normalizes to a usable doc');
if (!template) {
	console.error('\nTemplate config is unusable — nothing else can be checked.');
	process.exit(1);
}
assert(template.version === GAME_CONFIG_DOC_VERSION, 'version is stamped');
assert(template.numReels === 5 && eq(template.numRows, [3, 3, 3, 3, 3]), 'grid is 5×3');
assert(Object.keys(template.paylines).length === 20, '20 paylines survive');
assert(
	Object.keys(template.betModes).join(',') === 'base,bonus',
	'both bet modes survive (base + bonus)',
);
assert(template.gameID === '0_0_lines' && template.rtp === 0.97, 'identity + RTP round-trip');

const templateErrors = gameConfigErrors(template);
assert(
	templateErrors.length === 0,
	`template has no blocking errors${templateErrors.length ? ` — ${templateErrors.map((e) => e.path).join(', ')}` : ''}`,
);

// ---------------------------------------------------------------------------
// 2. THE GATE — the strips answer "does this game have symbol X?", not the dictionary.
// ---------------------------------------------------------------------------
console.log('\nthe in-play gate (the W bug)');
const inPlay = symbolsInPlay(template);
const dictionary = Object.keys(template.symbols).sort();
console.log(`  dictionary: ${dictionary.join(', ')}`);
console.log(`  in play:    ${inPlay.join(', ')}`);
assert(dictionary.includes('W'), 'W is still in the DICTIONARY (it has art + a paytable)');
assert(!inPlay.includes('W'), 'W is NOT in play — no strip deals it (959b85a)');
assert(!isSymbolInPlay(template, 'W'), 'isSymbolInPlay agrees — one answer, not two');
assert(inPlay.includes('S'), 'the scatter IS in play');
assert(
	inPlay.length === dictionary.length - 1,
	'the in-play set is the dictionary minus exactly the wild',
);
const templateWarnings = validateGameConfigDoc(template).filter((i) => i.severity === 'warning');
assert(
	templateWarnings.some((w) => w.path.startsWith('symbols.W')),
	'the validator WARNS that W advertises an unwinnable payout',
);

const baseOnly = symbolsInPlayForGameType(template, 'basegame');
assert(baseOnly.length > 0 && !baseOnly.includes('W'), 'per-game-type gate works for basegame');
assert(
	symbolsInPlayForGameType(template, 'nosuchmode').length === 0,
	'an undeclared game type yields none rather than throwing',
);

const freq = symbolFrequencies(template);
assert(
	freq.basegame.length === template.numReels && freq.basegame[0].S > 0,
	'symbol frequencies are per game type, per reel',
);

// ---------------------------------------------------------------------------
// 3. Unusable input falls THROUGH to the template — it never becomes an empty config.
// ---------------------------------------------------------------------------
console.log('\nfall-through, not blank board');
assert(normalizeGameConfigDoc(undefined) === undefined, 'undefined → undefined');
assert(normalizeGameConfigDoc('nope') === undefined, 'a string → undefined');
assert(normalizeGameConfigDoc({}) === undefined, 'an empty object → undefined');
assert(
	normalizeGameConfigDoc({ symbols: { H1: {} } }) === undefined,
	'a dictionary with no strips → undefined (nothing is dealt)',
);
assert(
	normalizeGameConfigDoc({ paddingReels: { basegame: [[{ name: 'H1' }]] } }) === undefined,
	'strips with no dictionary → undefined (nothing is drawable)',
);

// ---------------------------------------------------------------------------
// 4. The Stake wire shape survives verbatim — paste-in from the math team is the flow.
// ---------------------------------------------------------------------------
console.log('\nStake wire shape');
const pasted = normalizeGameConfigDoc({
	providerName: 'acme',
	gameName: 'acme_book',
	gameID: '0_0_acme',
	rtp: 0.96,
	numReels: 3,
	numRows: 3,
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { '1': [0, 0, 0] },
	symbols: {
		H1: { paytable: [{ '3': 10 }, { '2': 2 }] },
		SCAT: { special_properties: ['scatter', 'wild'] },
	},
	paddingReels: {
		basegame: [
			['H1', 'SCAT', 'H1'],
			[{ name: 'H1' }, { name: 'H1' }, { name: 'SCAT' }],
			['SCAT', 'H1', 'H1'],
		],
	},
});
assert(pasted !== undefined, 'a hand-pasted Stake-shaped config normalizes');
if (pasted) {
	assert(
		eq(pasted.symbols.SCAT.special_properties, ['scatter', 'wild']),
		'snake_case special_properties survives (not renamed)',
	);
	assert(pasted.betModes.base.max_win === 5000, 'snake_case max_win survives');
	assert(eq(pasted.symbols.H1.paytable, [{ '2': 2 }, { '3': 10 }]), 'paytable rows sort ascending');
	assert(eq(pasted.numRows, [3, 3, 3]), 'a scalar numRows expands to one entry per reel');
	assert(
		eq(pasted.paddingReels.basegame[0], [{ name: 'H1' }, { name: 'SCAT' }, { name: 'H1' }]),
		'bare-string strip cells lift to { name }',
	);
	assert(gameConfigErrors(pasted).length === 0, 'the pasted config has no blocking errors');

	// A multi-key paytable object means the same thing as one row per key.
	const merged = normalizeGameConfigDoc({
		...pasted,
		symbols: { ...pasted.symbols, H1: { paytable: [{ '3': 10, '2': 2 }] } },
	});
	assert(
		merged !== undefined && eq(merged.symbols.H1.paytable, pasted.symbols.H1.paytable),
		'a multi-key paytable object normalizes to the same rows as single-entry rows',
	);
}

// ---------------------------------------------------------------------------
// 5. The validator is loud about what normalization deliberately keeps.
// ---------------------------------------------------------------------------
console.log('\nvalidation');
const broken = normalizeGameConfigDoc({
	numReels: 3,
	numRows: [3, 3, 3],
	betModes: { base: { cost: 1 } },
	paylines: { '1': [0, 1, 2], '2': [0, 1, 5], '3': [0, 1] },
	symbols: { H1: { paytable: [{ '3': 10 }] } },
	paddingReels: {
		basegame: [
			['H1', 'H1', 'H1'],
			['H1', 'GHOST', 'H1'],
			['H1', 'H1', 'H1'],
		],
	},
});
assert(broken !== undefined, 'a wrong-but-interpretable config still normalizes (no data loss)');
if (broken) {
	assert(eq(broken.paylines['2'], [0, 1, 5]), 'the off-grid payline is KEPT, not silently deleted');
	const issues = validateGameConfigDoc(broken);
	assert(
		issues.some((i) => i.severity === 'error' && i.path === 'paylines.2'),
		'payline pointing at row 6 of a 3-row reel is an ERROR',
	);
	assert(
		issues.some((i) => i.severity === 'error' && i.path === 'paylines.3'),
		'payline covering 2 of 3 reels is an ERROR',
	);
	assert(
		issues.some((i) => i.severity === 'error' && i.path === 'symbols.GHOST'),
		'a strip dealing a symbol absent from the dictionary is an ERROR',
	);
}

// ---------------------------------------------------------------------------
// 6. Idempotence — the save→reload fixed point.
// ---------------------------------------------------------------------------
console.log('\nidempotence');
const reloaded = normalizeGameConfigDoc(JSON.parse(JSON.stringify(template))) as GameConfigDoc;
assert(eq(reloaded, template), 'normalize(normalize(x)) === normalize(x) for the template');
assert(
	eq(normalizeGameConfigDoc(JSON.parse(JSON.stringify(pasted))), pasted),
	'…and for a pasted config',
);

// ---------------------------------------------------------------------------
// 7. The committed template default has not DRIFTED from the config it derives from.
//
// `$lib/data/gameConfig/lines.json` is what a project inherits until it authors its own config,
// and it is generated by `generate-game-config-defaults.ts`. A generator nobody runs is a
// generator that lies, so the check lives here too: this re-derives the file from the real
// config module and compares the bytes. Edit the config without regenerating and this fails.
// ---------------------------------------------------------------------------
console.log('\ncommitted template default');
const DEFAULT_PATH = new URL(
	'../../apps/launcher-api/src/lib/data/gameConfig/lines.json',
	import.meta.url,
);
// The generator attaches the template's default win tiers from its own coded winLevelMap, then
// re-normalizes — mirror that here so the drift check compares like for like.
const derivedWithTiers = normalizeGameConfigDoc({
	...template,
	winLevels: winLevelMapToTiers(winLevelMap),
});
const derived = { ...(derivedWithTiers ?? template) };
delete derived.updatedAt;
let committedRaw: string | null = null;
try {
	committedRaw = readFileSync(DEFAULT_PATH, 'utf8');
} catch {
	committedRaw = null;
}
assert(committedRaw !== null, 'lines.json exists');
if (committedRaw !== null) {
	assert(
		committedRaw === `${JSON.stringify(derived, null, 2)}\n`,
		'lines.json is byte-identical to the config it derives from (run gen:game-config-defaults)',
	);
	const parsed = normalizeGameConfigDoc(JSON.parse(committedRaw));
	assert(parsed !== undefined && eq(parsed, derived), 'and it re-normalizes to the same doc');
	assert(
		parsed !== undefined && !symbolsInPlay(parsed).includes('W'),
		'so a project seeded from the template inherits the gate, not the wild',
	);
}

// ---------------------------------------------------------------------------
// 8. The /config PAGE's field parsers. The Svelte page can't be rendered without the launcher's
// DB + R2 + a login session, but the transforms it runs on every keystroke are pure and testable:
// the "count:×" paytable field, the whitespace-separated strip editor, and the raw-JSON paste. If
// these round-trip through the real package the page edits a valid doc; the DOM around them is the
// only unverified part. Kept in lockstep with `+page.svelte` (setPaytable / setStrip / applyRaw).
// ---------------------------------------------------------------------------
console.log('\n/config page field parsers');

// setPaytable: "5:20, 4:10, 3:5" → canonical single-entry rows, and paytableText back.
const parsePaytable = (text: string) =>
	text
		.split(',')
		.map((pair) => pair.trim())
		.filter(Boolean)
		.flatMap((pair) => {
			const [count, pay] = pair.split(':').map((s) => s.trim());
			const c = Number(count);
			const p = Number(pay);
			return Number.isFinite(c) && c > 0 && Number.isFinite(p) ? [{ [String(c)]: p }] : [];
		});
const paytableRows = parsePaytable('5:20, 4:10, 3:5');
assert(
	eq(paytableRows, [{ '5': 20 }, { '4': 10 }, { '3': 5 }]),
	'paytable field "5:20, 4:10, 3:5" parses to single-entry rows',
);
assert(eq(parsePaytable('garbage, 3:x, 0:5'), []), 'a nonsense paytable field parses to nothing');

// setStrip: free text (spaces / commas / newlines) → { name }[].
const parseStrip = (text: string) =>
	text
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((name) => ({ name }));
assert(
	eq(parseStrip('H1 H2\nSCAT, H1'), [
		{ name: 'H1' },
		{ name: 'H2' },
		{ name: 'SCAT' },
		{ name: 'H1' },
	]),
	'strip field splits on spaces, commas and newlines and keeps order + duplicates',
);

// The whole page edits a doc built from these parsers; feed one through normalize as the save would.
const pageEdited = normalizeGameConfigDoc({
	providerName: 'p',
	gameName: 'g',
	gameID: 'id',
	rtp: 0.95,
	numReels: 3,
	numRows: [3, 3, 3],
	betModes: { base: { cost: 1, feature: false, buyBonus: false, rtp: 0.95, max_win: 500 } },
	paylines: { '1': [0, 0, 0] },
	symbols: {
		H1: { paytable: paytableRows },
		SCAT: { special_properties: 'scatter'.split(',').map((s) => s.trim()) },
	},
	paddingReels: {
		basegame: [parseStrip('H1 SCAT H1'), parseStrip('SCAT, H1, H1'), parseStrip('H1\nH1\nSCAT')],
	},
});
assert(
	pageEdited !== undefined && gameConfigErrors(pageEdited).length === 0,
	'a doc assembled from the page parsers normalizes with no errors',
);

// applyRaw is just normalizeGameConfigDoc on JSON.parse — proven above; assert the failure path the
// modal shows.
assert(
	normalizeGameConfigDoc(JSON.parse('{"symbols":{"H1":{}}}')) === undefined,
	'raw-JSON apply rejects a config with no strips (the modal error path)',
);

// ---------------------------------------------------------------------------
// 9. Config-authored WIN TIERS (big-win levels) + sequential escalation.
//
// The owner authors an ordered tier list (name/alias/threshold/type/animation) and an escalation
// flag; the facade emits a level by walking the thresholds and the big-win component reads the tier.
// The load-bearing contract is the FALLBACK: an un-authored config (the template) routes NOTHING
// through here and keeps its coded winLevelMap + coded ladder — byte-identical to before.
// ---------------------------------------------------------------------------
console.log('\nwin tiers — the un-authored fallback is byte-identical');
// The shipped template authors NO win tiers, so every resolver returns undefined and normalize adds
// nothing — the exact signal that keeps the coded path in force.
assert(template.winLevels === undefined, 'the template authors no win tiers (fallback in force)');
assert(resolveWinLevels(template) === undefined, 'resolveWinLevels(template) is undefined');
assert(resolveWinLevel(template, 12) === undefined, 'resolveWinLevel(template, …) is undefined');
assert(
	resolveWinLevelChain(template, 3) === undefined,
	'no escalation chain for an un-authored doc',
);
assert(winLevelType(template, 6) === undefined, 'winLevelType(template, …) is undefined');
// Byte-identical proof: adding the OPTIONAL fields to the schema must not change a doc that omits
// them. Re-normalizing the template yields the same doc, with none of the new keys present.
const reNormalized = normalizeGameConfigDoc(JSON.parse(JSON.stringify(template))) as GameConfigDoc;
assert(
	!('winLevels' in reNormalized) &&
		!('escalateTiers' in reNormalized) &&
		!('escalateFrom' in reNormalized),
	'an un-authored doc gains no winLevels/escalateTiers/escalateFrom keys (byte-identical)',
);

console.log('\nwin tiers — an authored 3-tier config');
const authored = normalizeGameConfigDoc({
	...JSON.parse(JSON.stringify(template)),
	winLevels: [
		{ alias: 'win', name: 'WIN', threshold: 0, type: 'small' },
		{
			alias: 'big',
			name: 'BIG WIN',
			threshold: 10,
			type: 'big',
			animation: { intro: 'big_intro', idle: 'big_idle', outro: 'big_outro' },
			spineKey: 'bigwin',
			durationMs: 6000,
		},
		{
			alias: 'mega',
			name: 'MEGA WIN',
			threshold: 40,
			type: 'big',
			animation: { intro: 'mega_intro', idle: 'mega_idle', outro: 'mega_outro' },
		},
	],
	escalateTiers: true,
}) as GameConfigDoc;
assert(authored.winLevels?.length === 3, 'three authored tiers survive normalize');
assert(authored.escalateTiers === true, 'escalateTiers survives');
const tiers = resolveWinLevels(authored)!;
assert(tiers[0].level === 1 && tiers[2].level === 3, 'levels are 1-based positional');
// The threshold ladder — the facade emits these levels.
assert(resolveWinLevel(authored, 0) === 1, 'a zero win → tier 1');
assert(resolveWinLevel(authored, 5) === 1, 'below the big threshold → tier 1');
assert(resolveWinLevel(authored, 10) === 2, 'at the big threshold → tier 2');
assert(resolveWinLevel(authored, 39) === 2, 'below mega → tier 2');
assert(resolveWinLevel(authored, 100) === 3, 'at/over mega → tier 3');
// The big-win gate keys off type === 'big', NOT a magic >= 6 — tier 2 of 3 triggers big-win.
assert(winLevelType(authored, 1) === 'small', 'tier 1 is small (no big-win)');
assert(winLevelType(authored, 2) === 'big', 'tier 2 is big — the gate fires on a 3-tier config');
// Escalation chain: a win on tier 3 (mega) plays the big→mega chain; the default start is the first
// big tier (level 2), so tier 1 is NOT replayed.
const chain = resolveWinLevelChain(authored, 3)!;
assert(
	chain.map((t) => t.level).join(',') === '2,3',
	'escalation chain from first big tier up to N',
);
assert(
	resolveWinLevelChain(authored, 1)!
		.map((t) => t.alias)
		.join(',') === 'win',
	'a below-start win plays only its own tier',
);

console.log('\nwin tiers — escalation OFF and escalateFrom');
const noEscalate = normalizeGameConfigDoc({
	...JSON.parse(JSON.stringify(authored)),
	escalateTiers: false,
}) as GameConfigDoc;
assert(!('escalateTiers' in noEscalate), 'escalateTiers:false is dropped (sparse)');
assert(
	resolveWinLevelChain(noEscalate, 3) === undefined,
	'escalation off ⇒ no chain (single-tier path)',
);
const fromMega = normalizeGameConfigDoc({
	...JSON.parse(JSON.stringify(authored)),
	escalateFrom: 'mega',
}) as GameConfigDoc;
assert(
	resolveWinLevelChain(fromMega, 3)!
		.map((t) => t.alias)
		.join(',') === 'mega',
	'escalateFrom names the start tier',
);

console.log('\nwin tiers — validation + idempotence');
const badTiers = normalizeGameConfigDoc({
	...JSON.parse(JSON.stringify(template)),
	winLevels: [
		{ alias: 'a', threshold: 10, type: 'small' },
		{ alias: 'b', threshold: 5, type: 'big' },
	],
	escalateFrom: 'ghost',
}) as GameConfigDoc;
const tierIssues = validateGameConfigDoc(badTiers);
assert(
	tierIssues.some((i) => i.severity === 'error' && i.path === 'winLevels.2.threshold'),
	'a descending threshold is an ERROR',
);
assert(
	tierIssues.some((i) => i.severity === 'warning' && i.path === 'winLevels.2.animation'),
	'a big tier with no animation WARNS',
);
assert(
	tierIssues.some((i) => i.severity === 'error' && i.path === 'escalateFrom'),
	'escalateFrom naming no real tier is an ERROR',
);
assert(badTiers.winLevels?.[0].name === 'a', 'a tier with no name defaults its name to its alias');
assert(
	eq(normalizeGameConfigDoc(JSON.parse(JSON.stringify(authored))), authored),
	'normalize is idempotent with authored win tiers',
);

console.log('\nwin tiers — per-template default (winLevelMapToTiers → the "Load default tiers" seed)');
// The default the tool seeds is the TEMPLATE's own tiers, converted from that template's coded
// winLevelMap. It must be a valid, error-free ladder, and its resolver must reproduce the coded
// facade ladder (stakeFacade computeWinLevel) — otherwise a template-seeded project would behave
// differently from the un-authored fallback it mirrors. `seeded` uses the SAME converter the
// generator does, so this also covers the /config "Load default tiers" button (it clones these).
const seededTiers = winLevelMapToTiers(winLevelMap);
const seeded = normalizeGameConfigDoc({
	...JSON.parse(JSON.stringify(template)),
	winLevels: seededTiers,
}) as GameConfigDoc;
assert(
	validateGameConfigDoc(seeded).every((i) => i.severity !== 'error'),
	'the template default tiers have no blocking errors',
);
assert(seededTiers.length === 10, 'the lines template seeds its coded 10 tiers');
assert(
	seededTiers.filter((t) => t.type === 'big').length === 5,
	'five big tiers carry animations',
);
assert(
	seededTiers.filter((t) => t.type === 'big').every((t) => !!t.animation && !!t.sound?.bgm),
	'every big tier has an intro/idle/outro set + a bgm',
);
// The regenerated lines.json (what the tool actually loads as the template default) carries them.
assert(
	(derived.winLevels?.length ?? 0) === 10,
	'the committed lines.json template default ships the 10 tiers',
);
// The coded facade ladder (stakeFacade.computeWinLevel), sample → expected level:
const codedLadder: Array<[number, number]> = [
	[0, 1], // no win → zero
	[0.5, 2], // < 1.5 → standard
	[1.5, 3], // < 3 → small
	[3, 4], // < 6 → nice
	[6, 5], // < 10 → substantial
	[10, 6], // < 20 → big
	[20, 7], // < 40 → super
	[40, 8], // < 70 → mega
	[70, 9], // < 120 → epic
	[120, 10], // ≥ 120 → max
	[999, 10],
];
for (const [x, level] of codedLadder) {
	assert(
		resolveWinLevel(seeded, x) === level,
		`the template default resolves ${x}× bet → level ${level} (matches the coded facade ladder)`,
	);
}
// The default is opt-in: the raw compiled config (config.ts) has NO tiers — they come only from the
// generator merging in the winLevelMap, and an un-authored project ships nothing.
assert(
	resolveWinLevels(template) === undefined,
	'the raw compiled config (un-authored) still has NO win tiers — the default is opt-in',
);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
