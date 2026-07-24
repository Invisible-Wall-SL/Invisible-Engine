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
	symbolsInPlay,
	symbolsInPlayForGameType,
	symbolFrequencies,
	validateGameConfigDoc,
	gameConfigErrors,
	isSymbolInPlay,
	type GameConfigDoc,
} from 'game-config';

import templateConfig from '../../apps/lines/src/game/config';

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
const derived = { ...template };
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

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
