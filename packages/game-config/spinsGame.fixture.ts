/**
 * Offline fixture for BONUS GAMES Phase 8a — the spins bonus mode's contract (`./src/spinsGame.ts`,
 * `docs/design/bonus-games.md` §0 layer 3).
 *   pnpm check:all --only spinsGame.fixture
 *
 * Pins:
 *  1. PARITY. No committed default normalizes to a mode with `spins`, and a doc without one is a
 *     normalize fixed point exactly as before.
 *  2. A spins mode survives normalize, the split form (`splitFormOf`) and the compat mirror
 *     (`withLegacyPair`) unchanged; normalizing it twice changes nothing.
 *  3. Normalization is sparse: `spins` only on a `reels` mode of the project's own; the grid both or
 *     neither; `lines` stored when stated; a bad count falls back to the free-spins award; a huge one
 *     is capped at the round's maximum.
 *  4. The view fills every gap from the host and lays the mode's pays over the dictionary.
 *  5. Validation: a mode's strips are measured against its own grid (the host's reel count does not
 *     apply to them), a game that cannot pay is an error, and so is a lines game with no paylines.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFormOf, withLegacyPair } from './src/bonusGames.ts';
import { gameModeById, normalizeGameModes } from './src/modes.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { normalizeSpinsGame, spinsGameView } from './src/spinsGame.ts';
import type { GameConfigDoc } from './src/types.ts';
import { validateGameConfigDoc } from './src/validate.ts';
import { CLUSTER_BONUS, WAYS_BONUS, withSpinsModes } from './spinsGame.sample.ts';

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

const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = join(ROOT, '../../apps/launcher-api/src/lib/data/gameConfig');
const read = (name: string): GameConfigDoc =>
	normalize(JSON.parse(readFileSync(join(DEFAULTS, name), 'utf8')));

console.log('\n1. parity — no committed default carries a spins mode');
for (const name of readdirSync(DEFAULTS).filter((n: string) => n.endsWith('.json'))) {
	const doc = read(name);
	check(`${name}: no spins mode`, (doc.modes ?? []).filter((m) => m.spins).length, 0);
	check(`${name}: a normalize fixed point`, normalize(clone(doc)), doc);
}

console.log('\n2. a spins mode survives normalize, the split form and the mirror');
const host = read('lines.json');
const doc = normalize(withSpinsModes(host));
check(
	'the ways mode keeps its game',
	gameModeById(doc, WAYS_BONUS)?.spins,
	withSpinsModes(host).modes!.find((m) => m.id === WAYS_BONUS)!.spins,
);
check('the cluster mode keeps its own pays', gameModeById(doc, CLUSTER_BONUS)?.spins?.paytable, {
	H1: [{ '5': 2 }, { '8': 10 }, { '12': 50 }],
});
check('normalize is idempotent', normalize(clone(doc)), doc);
check('the split form keeps the modes', normalize(splitFormOf(doc)).modes, doc.modes);
check('the legacy pair keeps the modes', normalize(withLegacyPair(clone(doc))).modes, doc.modes);
check('the base game keeps its width', doc.numReels, 5);
const noWidth = clone(withSpinsModes(host)) as Partial<GameConfigDoc>;
delete noWidth.numReels;
check('an undeclared width ignores a spins mode’s strips', normalize(noWidth).numReels, 5);

console.log('\n3. normalization is sparse');
const modesOf = (entry: Record<string, unknown>) => normalizeGameModes([entry]);
check(
	'not on a built-in mode',
	modesOf({ id: 'freeSpins', board: 'reels', label: 'X', spins: { spins: 3 } }),
	[{ id: 'freeSpins', board: 'reels', label: 'X' }],
);
check('not on a respin mode', modesOf({ id: 'hw', board: 'respinBoard', spins: { spins: 3 } }), [
	{ id: 'hw', board: 'respinBoard' },
]);
check('a bare block plays the free-spins award', normalizeSpinsGame({}), { spins: 10 });
check('a huge count is capped', normalizeSpinsGame({ spins: 999 }), { spins: 200 });
check(
	'lines is stored when stated',
	normalizeSpinsGame({ spins: 3, winModel: { type: 'lines' } }),
	{
		spins: 3,
		winModel: { type: 'lines' },
	},
);
check('rows alone give the width', normalizeSpinsGame({ spins: 3, numRows: [4, 4, 4] }), {
	spins: 3,
	numReels: 3,
	numRows: [4, 4, 4],
});
check('a width alone gets rows', normalizeSpinsGame({ spins: 3, numReels: 4 }), {
	spins: 3,
	numReels: 4,
	numRows: [3, 3, 3, 3],
});
check(
	'garbage pays and paylines are dropped',
	normalizeSpinsGame({ spins: 3, paylines: { 1: ['x'] }, paytable: { H1: 'x', '': [{ 3: 1 }] } }),
	{ spins: 3 },
);

console.log('\n4. the view fills the gaps from the host');
const hostView = spinsGameView(doc, { spins: 7 });
check(
	'host grid, model and paylines',
	[hostView.numReels, hostView.numRows, hostView.winModel],
	[5, [3, 3, 3, 3, 3], { type: 'lines' }],
);
check('host paylines', hostView.paylines, doc.paylines);
const clusterView = spinsGameView(doc, gameModeById(doc, CLUSTER_BONUS)!.spins!);
check('own grid', [clusterView.numReels, clusterView.numRows.length], [7, 7]);
check('own pay over the dictionary', clusterView.symbols.H1.paytable, [
	{ '5': 2 },
	{ '8': 10 },
	{ '12': 50 },
]);
check('the rest of the dictionary', clusterView.symbols.H2, doc.symbols.H2);

console.log('\n5. validation');
const messages = (d: GameConfigDoc) =>
	validateGameConfigDoc(d)
		.filter((i) => i.severity === 'error')
		.map((i) => `${i.path}: ${i.message}`);
check('the sample has no errors', messages(doc), messages(host));
const shortStrips = clone(doc);
shortStrips.paddingReels.waysBonus = shortStrips.paddingReels.waysBonus.slice(0, 5);
check(
	'strips measured against the mode’s grid',
	messages(shortStrips).filter((m) => m.startsWith('paddingReels.waysBonus')),
	['paddingReels.waysBonus: waysBonus has 5 reel strips but the mode waysBonus is 6 reels wide.'],
);
const unpayable = clone(doc);
unpayable.modes = unpayable.modes!.map((m) =>
	m.id === WAYS_BONUS
		? { ...m, spins: { ...m.spins!, winModel: { type: 'ways', direction: 'ltr', minKind: 7 } } }
		: m,
);
check(
	'a game that cannot pay',
	messages(unpayable).filter((m) => m.startsWith(`modes.${WAYS_BONUS}`)),
	[
		`modes.${WAYS_BONUS}.spins.winModel.minKind: Ways wins need 7 adjacent reels but the grid is only 6 wide, so nothing can ever pay.`,
	],
);
const linesNoPaylines = clone(doc);
linesNoPaylines.paylines = {};
linesNoPaylines.modes = linesNoPaylines.modes!.map((m) =>
	m.id === CLUSTER_BONUS ? { ...m, spins: { ...m.spins!, winModel: { type: 'lines' } } } : m,
);
check(
	'a lines game with no paylines',
	messages(linesNoPaylines).filter((m) => m.startsWith(`modes.${CLUSTER_BONUS}`)),
	[`modes.${CLUSTER_BONUS}.spins.paylines: A lines game needs paylines, so nothing can ever pay.`],
);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
