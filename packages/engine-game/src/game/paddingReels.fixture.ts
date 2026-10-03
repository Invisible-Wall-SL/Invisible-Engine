/**
 * Offline fixture for the cosmetic strips a reveal pads from (`createGameConfig().getPaddingReels`):
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/engine-game/src/game/paddingReels.fixture.ts
 *
 * Claims:
 *  1. Without a server config, every game type pads from the authored strips, as before.
 *  2. With one (the Play4Fun facade always publishes it), a BUILT-IN game type (`basegame`,
 *     `freegame`, `respin`) pads from the strips generated off the server's in-play set, as before.
 *  3. A game type of a reels mode of the project's own (an imported free spins,
 *     `docs/design/pots-overlay.md` §5 A) pads from its AUTHORED strips even then: the server declares
 *     only its own game, so those strips are the only ones that mode's symbols are on.
 */

import { createGameConfig } from './gameConfig.ts';

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

const strip = (...names: string[]) => names.map((name) => ({ name }));
const BASE = strip('A', 'B', 'C');
const IMPORTED = strip('X_2', 'Y_2', 'Z_2');
const config = {
	providerName: 'p',
	gameName: 'g',
	gameID: 'g',
	rtp: 0.96,
	numReels: 1,
	numRows: [3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 100 } },
	paylines: { '1': [1] },
	symbols: { A: {}, B: {}, C: {}, X_2: {}, Y_2: {}, Z_2: {} },
	paddingReels: { basegame: [BASE], freegame: [BASE], freegame_2: [IMPORTED] },
	modes: [{ id: 'freeSpins_2', board: 'reels', gameType: 'freegame_2' }],
};
const game = createGameConfig({ bakedConfig: () => null, compiledConfig: config });
const global = globalThis as { __IE_SERVER_CONFIG__?: unknown };

console.log('\n1. no server config');
check('basegame', game.getPaddingReels('basegame'), [BASE]);
check('the imported mode', game.getPaddingReels('freegame_2'), [IMPORTED]);

console.log('\n2–3. a server config');
global.__IE_SERVER_CONFIG__ = {
	symbols: ['A', 'B'],
	availablePayLines: [[1]],
	window: { reels: 1, rows: 3 },
};
const generated = game.getPaddingReels('basegame');
check('basegame pads from the generated strips', generated[0]?.[0], { name: 'A' });
check('freegame too', game.getPaddingReels('freegame'), generated);
check('the imported mode pads from its authored strips', game.getPaddingReels('freegame_2'), [
	IMPORTED,
]);
check('an unknown game type, generated as before', game.getPaddingReels('nope'), generated);
delete global.__IE_SERVER_CONFIG__;

console.log(failures === 0 ? '\nAll padding-reel assertions passed.' : `\n${failures} FAILED`);
if (failures > 0) throw new Error('padding-reel fixture failed');
