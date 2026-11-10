/**
 * Offline fixture for the ante SWITCH and the ante FILLER STRIPS (Phase 14c of
 * `docs/design/hold-and-win-enhancements.md`). Run through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/betModeHud.fixture.ts
 *
 * Claims:
 *  1. PARITY. Every committed default config normalizes with neither field, and a mode that never
 *     mentions them resolves to `toggle: false` and `fillerSymbols: []` — `apps/lines` is the shared
 *     runtime, so a default that leaked here would change every online game's HUD or reels.
 *  2. The fields are sparse: `toggle: false` and an empty or blank symbol list are not stored, and a
 *     symbol listed twice is stored once.
 *  3. `toggle` only means something on an ante: a buy marked `toggle` resolves to `false` (it stays
 *     a card) and the validator warns. `refusable` (a server refusal is a message, not an error) is
 *     kept only when set, and never resolves true on the base mode.
 *  4. A filler symbol the dictionary lacks is an error (the reels would roll a symbol nothing draws).
 *  5. `fillerStrips` keeps each reel's own listed symbols, cycled back to the reel's length, and a
 *     reel that keeps none rolls the listed symbols instead of going empty.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillerStrips, resolveBetModes } from './src/betModes.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import type { GameConfigDoc } from './src/types.ts';
import { validateGameConfigDoc } from './src/validate.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const defaults = join(here, '../../apps/launcher-api/src/lib/data/gameConfig');

console.log('1. parity');
for (const file of readdirSync(defaults).filter((name) => name.endsWith('.json'))) {
	const doc = normalizeGameConfigDoc(JSON.parse(readFileSync(join(defaults, file), 'utf8')));
	const stored = Object.values(doc?.betModePresentation ?? {}).filter(
		(entry) => 'toggle' in entry || 'fillerSymbols' in entry || 'refusable' in entry,
	);
	check(`${file} stores no ante switch or filler symbols`, stored.length, 0);
	const resolved = doc ? resolveBetModes(doc) : [];
	check(
		`${file} resolves every mode to no switch and the base strips`,
		resolved.every((mode) => !mode.toggle && !mode.refusable && mode.fillerSymbols.length === 0),
		true,
	);
}

const raw = {
	numReels: 3,
	numRows: [3, 3, 3],
	symbols: {
		COIN: { paytable: [] },
		COLLECT: { paytable: [] },
		BLANK: { paytable: [] },
		H1: { paytable: [{ '3': 10 }] },
	},
	paylines: { '1': [1, 1, 1] },
	paddingReels: {
		basegame: [
			[{ name: 'COIN' }, { name: 'H1' }, { name: 'BLANK' }, { name: 'H1' }],
			[{ name: 'H1' }, { name: 'COLLECT' }, { name: 'H1' }, { name: 'H1' }],
			[{ name: 'H1' }, { name: 'H1' }, { name: 'H1' }],
		],
	},
	betModes: {
		base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
		powerup: { cost: 5, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
		goldstrike: { cost: 100, feature: true, buyBonus: true, rtp: 0.96, max_win: 5000 },
	},
	betModePresentation: {
		powerup: {
			kind: 'ante',
			toggle: true,
			refusable: true,
			text: { title: 'POWER' },
			fillerSymbols: [' COIN ', 'COLLECT', 'COIN', '', 7, 'BLANK'],
		},
		goldstrike: { kind: 'buy', toggle: true, fillerSymbols: [] },
		base: { toggle: false, refusable: true },
	},
};

console.log('2. sparse storage');
const doc = normalizeGameConfigDoc(raw) as GameConfigDoc;
check('the ante keeps its switch', doc.betModePresentation?.powerup?.toggle, true);
check(
	'filler symbols are trimmed, de-duplicated, blanks and non-strings dropped',
	doc.betModePresentation?.powerup?.fillerSymbols,
	['COIN', 'COLLECT', 'BLANK'],
);
check(
	'an empty symbol list is not stored',
	'fillerSymbols' in (doc.betModePresentation?.goldstrike ?? {}),
	false,
);
check('the ante keeps refusable', doc.betModePresentation?.powerup?.refusable, true);
check('toggle: false is not stored', doc.betModePresentation?.base?.toggle, undefined);

console.log('3. toggle is an ante-only switch');
const byMode = Object.fromEntries(resolveBetModes(doc).map((mode) => [mode.mode, mode]));
check('the ante resolves as the HUD switch', byMode.powerup.toggle, true);
check('a buy marked toggle stays a card', byMode.goldstrike.toggle, false);
check('the ante resolves refusable', byMode.powerup.refusable, true);
check('the base bet is never refusable', byMode.base.refusable, false);
check(
	'an unmarked buy is not refusable (a refusal stays an error)',
	byMode.goldstrike.refusable,
	false,
);
check('the ante resolves its filler symbols', byMode.powerup.fillerSymbols, [
	'COIN',
	'COLLECT',
	'BLANK',
]);
const issues = (config: GameConfigDoc) =>
	validateGameConfigDoc(config)
		.filter((issue) => issue.path.startsWith('betModePresentation'))
		.map((issue) => `${issue.severity} ${issue.path}`);
check('a buy marked toggle warns', issues(doc), ['warning betModePresentation.goldstrike.toggle']);

console.log('4. a filler symbol must exist');
const unknown = normalizeGameConfigDoc({
	...raw,
	betModePresentation: {
		powerup: { kind: 'ante', text: { title: 'P' }, fillerSymbols: ['GHOST'] },
	},
}) as GameConfigDoc;
check('an unknown filler symbol is an error', issues(unknown), [
	'error betModePresentation.powerup.fillerSymbols',
]);

console.log('5. fillerStrips');
const names = (strips: { name: string }[][]) => strips.map((reel) => reel.map((cell) => cell.name));
check(
	'each reel keeps its own listed symbols at its own length; an empty reel rolls the list',
	names(fillerStrips(doc.paddingReels.basegame, ['COIN', 'COLLECT', 'BLANK'])),
	[
		['COIN', 'BLANK', 'COIN', 'BLANK'],
		['COLLECT', 'COLLECT', 'COLLECT', 'COLLECT'],
		['COIN', 'COLLECT', 'BLANK'],
	],
);
check(
	'a reel shorter than the list still rolls every listed symbol',
	names(fillerStrips([[{ name: 'H1' }]], ['COIN', 'COLLECT'])),
	[['COIN', 'COLLECT']],
);

console.log(failures === 0 ? '\nAll bet-mode HUD assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
