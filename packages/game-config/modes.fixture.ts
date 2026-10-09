/**
 * Offline fixture for the GAME MODES registry (`docs/design/hold-and-win.md` §4.5). Run through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/modes.fixture.ts
 *
 * Claims:
 *  1. PARITY. A config that never mentions modes resolves to the base game and free spins, free
 *     spins keep the game type `freegame` every mock and facade writes, and every committed default
 *     config normalizes with NO `modes` block but its declared respin mode — `apps/lines` is the
 *     shared runtime, so a default that leaked into storage would reach every online game.
 *  2. A legacy `holdAndWin` block brings the respin mode with it, on the respin board and the
 *     `respin` padding the Phase 2 presets deal (bonus-games: declared, not built in).
 *  3. Overrides merge field by field; a field that restates the built-in is not stored; the
 *     project's own modes are kept in authored order; half-typed entries are dropped.
 *  4. `gameType` ↔ mode id round-trips both ways, including `freegame` → `freeSpins`.
 *  5. The validator refuses a base game off the reels and warns on a reels mode with no strips.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBonusGames } from './src/bonusGames.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import {
	builtinGameModes,
	gameModeById,
	gameTypeForMode,
	modeIdForGameType,
	normalizeGameModes,
	resolveGameModes,
} from './src/modes.ts';
import { validateGameConfigDoc } from './src/validate.ts';
import type { GameConfigDoc } from './src/types.ts';

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

const ids = (doc: Parameters<typeof resolveGameModes>[0]) => resolveGameModes(doc).map((m) => m.id);

console.log('\n1. parity — no block means the two-value world the engine always ran');
check('no doc', ids(undefined), ['basegame', 'freeSpins']);
check('a doc with no modes', ids({}), ['basegame', 'freeSpins']);
check(
	'free spins keep the game type every mock writes',
	gameTypeForMode(gameModeById({}, 'freeSpins')!),
	'freegame',
);
check(
	'the base game is its own game type',
	gameTypeForMode(gameModeById({}, 'basegame')!),
	'basegame',
);

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = join(ROOT, '../../apps/launcher-api/src/lib/data/gameConfig');
const defaults = readdirSync(DEFAULTS).filter((name: string) => name.endsWith('.json'));
check('there are committed default configs to check', defaults.length > 0, true);
for (const name of defaults) {
	const doc = normalizeGameConfigDoc(JSON.parse(readFileSync(join(DEFAULTS, name), 'utf8')));
	check(
		`${name} stores no modes block but its declared respin mode`,
		doc?.modes?.map((m) => [m.id, m.board, Boolean(m.holdAndWin)]),
		name.startsWith('holdAndWin.') ? [['holdAndWin', 'respinBoard', true]] : undefined,
	);
	check(
		`${name} raises no mode issue`,
		doc && validateGameConfigDoc(doc).filter((i) => i.path.startsWith('modes')),
		[],
	);
}

console.log('\n2. a holdAndWin block brings its mode');
const hw = normalizeBonusGames({ holdAndWin: {} });
check('ids', ids(hw), ['basegame', 'freeSpins', 'holdAndWin']);
const { holdAndWin: hwRules, ...hwMode } = gameModeById(hw, 'holdAndWin') ?? {};
check("it carries the block's rules", Boolean(hwRules), true);
check('respin board, respin padding', hwMode, {
	id: 'holdAndWin',
	board: 'respinBoard',
	gameType: 'respin',
	counter: 'respins',
	label: 'Hold and Win',
	values: ['total', 'respinsLeft'],
});

console.log('\n3. overrides, own modes, normalization');
const authored = normalizeGameModes([
	{ id: 'freeSpins', board: 'reels', gameType: 'freegame', music: 'fsTheme' },
	{ id: 'basegame', board: 'reels', label: 'Base game' },
	{ id: 'wheel', board: 'wheel', hud: 'hud_wheel', values: ['prize', 'prize', ''] },
	{ id: 'pick', board: 'none' },
	{ id: 'wheel', board: 'none' },
	{ id: '', board: 'reels' },
	{ id: '9lives', board: 'reels' },
	{ id: 'bogus', board: 'hexagons' },
	'junk',
]);
check('restatements dropped, departures kept, own modes in order, junk dropped', authored, [
	{ id: 'freeSpins', board: 'reels', music: 'fsTheme' },
	{ id: 'wheel', board: 'wheel', hud: 'hud_wheel', values: ['prize'] },
	{ id: 'pick', board: 'none' },
]);
check('an override keeps the built-in fields', gameModeById({ modes: authored }, 'freeSpins'), {
	id: 'freeSpins',
	board: 'reels',
	gameType: 'freegame',
	counter: 'freeSpins',
	label: 'Free spins',
	music: 'fsTheme',
});
check('own modes resolve after the built-ins', ids({ modes: authored }), [
	'basegame',
	'freeSpins',
	'wheel',
	'pick',
]);
check(
	'nothing authored is undefined',
	normalizeGameModes([{ id: 'basegame', board: 'reels' }]),
	undefined,
);
check('not a list is undefined', normalizeGameModes({ freeSpins: {} }), undefined);
const once = normalizeGameModes(authored);
check('idempotent', normalizeGameModes(once), once);

console.log('\n4. gameType <-> mode id');
check('freegame is the free-spins mode', modeIdForGameType({}, 'freegame'), 'freeSpins');
check('basegame is the base game', modeIdForGameType({}, 'basegame'), 'basegame');
check('respin is Hold and Win', modeIdForGameType(hw, 'respin'), 'holdAndWin');
check('a mode id reads as itself', modeIdForGameType({ modes: authored }, 'wheel'), 'wheel');
check('an unknown game type is its own id', modeIdForGameType({}, 'superspin'), 'superspin');

console.log('\n5. validator');
const strips = [['H1', 'H1', 'H1']];
const base = {
	numReels: 1,
	numRows: [3],
	paylines: { '0': [0] },
	symbols: { H1: { name: 'H1' } },
	paddingReels: { basegame: strips, freegame: strips },
	betModes: {},
};
const issuesOf = (modes: unknown) =>
	validateGameConfigDoc(normalizeGameConfigDoc({ ...base, modes }) as GameConfigDoc)
		.filter((i) => i.path.startsWith('modes'))
		.map((i) => `${i.severity} ${i.path}`);
check('the built-ins are clean', issuesOf(undefined), []);
check('a base game off the reels is an error', issuesOf([{ id: 'basegame', board: 'none' }]), [
	'error modes.basegame.board',
]);
check('an own reels mode with no strips warns', issuesOf([{ id: 'bonusReels', board: 'reels' }]), [
	'warning modes.bonusReels.gameType',
]);
check(
	'...and is clean once it pads from a strip set',
	issuesOf([{ id: 'bonusReels', board: 'reels', gameType: 'freegame' }]),
	[],
);
check('a wheel needs no strips', issuesOf([{ id: 'wheel', board: 'wheel' }]), []);
check('built-ins list as before', builtinGameModes().length, 2);

console.log(failures === 0 ? '\nAll game-mode assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
