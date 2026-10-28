// The FAIRY CLOVER preset (game-config `fairyCloverPreset`) against the reference it starts from,
// Slotmotion's Fairy's Charm (`docs/reference/fairys-charm-capture.json`), through the capture's own
// `symbolMap` — and the committed `lines.fairyClover.json` against the preset. The same pattern as
// `check:book-preset`: two copies of a capture, one gate holding them equal.
//
//   pnpm check:fairy-clover-preset   (part of check:rgs)

import { readFileSync } from 'node:fs';
import {
	fairyCloverPreset,
	normalizeGameConfigDoc,
	resolveFreeSpins,
	retriggerSpinsPerSpin,
	MAX_RETRIGGER_SPINS_PER_SPIN,
	symbolsInPlay,
	validateGameConfigDoc,
} from '../packages/game-config/index.ts';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const CAPTURE = json('../docs/reference/fairys-charm-capture.json');
const COMMITTED = json('../apps/launcher-api/src/lib/data/gameConfig/lines.fairyClover.json');
const LINES = json('../apps/launcher-api/src/lib/data/gameConfig/lines.json');

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ours = (name) => CAPTURE.symbolMap[name];
/** `[{ '3': 5 }, …]` as `{ 3: 5, … }`. */
const rowOf = (paytable = []) => Object.fromEntries(paytable.flatMap((row) => Object.entries(row)));
const captureRow = ({ on, pay }) =>
	Object.fromEntries(on.occurs.map((n, i) => [String(n), pay[i]]));
const names = (strips) => strips.map((strip) => strip.map((cell) => cell.name));

const preset = normalizeGameConfigDoc(fairyCloverPreset());

console.log('\nthe preset is a clean config');
check(Boolean(preset), 'it normalizes');
check(same(normalizeGameConfigDoc(preset), preset), 'it is a normalize fixed point');
const issues = validateGameConfigDoc(preset);
check(issues.length === 0, 'it has no issues', issues.length ? ` (${JSON.stringify(issues)})` : '');
check(
	same(fairyCloverPreset(), fairyCloverPreset()) && fairyCloverPreset() !== fairyCloverPreset(),
	'each call is a fresh copy',
);

console.log('\nthe preset says what Fairy’s Charm says');
check(
	preset.numReels === CAPTURE.grid.reels && preset.numRows.every((r) => r === CAPTURE.grid.rows),
	`the board is ${CAPTURE.grid.reels}×${CAPTURE.grid.rows}`,
);
check(same(Object.values(preset.paylines), CAPTURE.paylines), `the ${CAPTURE.paylines.length} paylines, in order`); // prettier-ignore
for (const row of CAPTURE.paytable.line) {
	const name = ours(row.on.of);
	check(same(rowOf(preset.symbols[name]?.paytable), captureRow(row)), `${name} (${row.on.of}) pays its line row`); // prettier-ignore
}
const [scatterRow] = CAPTURE.paytable.scatter;
check(
	same(rowOf(preset.symbols.S?.paytable), captureRow(scatterRow)) &&
		same(preset.symbols.S?.special_properties, ['scatter']),
	`S (SCAT) is the scatter, paying ${JSON.stringify(captureRow(scatterRow))} × the total bet`,
);
for (const wild of ['FAIRY', 'CLOVER']) {
	const symbol = preset.symbols[ours(wild)];
	check(same(symbol?.special_properties, ['wild']) && !symbol?.paytable, `${ours(wild)} (${wild}) is a wild with no paytable`); // prettier-ignore
}
check(same(names(preset.paddingReels.basegame), CAPTURE.bootConfigReels.map((r) => r.map(ours))), 'basegame is the boot-config reel set'); // prettier-ignore
const freeSet = CAPTURE.reelSets.filter((set) => set.mode === 'FS');
check(freeSet.length === 1 && same(names(preset.paddingReels.freegame), freeSet[0].reels.map((r) => r.map(ours))), 'freegame is the free-spin reel set'); // prettier-ignore
const dealt = new Set([...CAPTURE.bootConfigReels, ...freeSet[0].reels].flat().map(ours));
check(same(symbolsInPlay(preset), [...dealt].sort()), 'the strips deal exactly the symbols those sets carry'); // prettier-ignore

const freeSpins = resolveFreeSpins(preset);
check(
	freeSpins.triggerSymbol === 'S' && freeSpins.triggerCount === 2,
	'free spins trigger on 2+ S',
);
check(same(freeSpins.awards, [{ count: 2, spins: CAPTURE.freeSpins.awards }]), `entering awards ${CAPTURE.freeSpins.awards}`); // prettier-ignore
check(same(freeSpins.retriggerAwards, [{ count: 2, spins: 10 }]), 'a retrigger adds 10');
const growth = retriggerSpinsPerSpin(preset);
check(growth !== undefined && growth < MAX_RETRIGGER_SPINS_PER_SPIN, 'the freegame strips show the feature ends', ` (+${growth?.toFixed(3)} spins per spin)`); // prettier-ignore
const modes = Object.values(preset.betModes);
check(
	modes.length === 1 && modes[0].cost === 1 && !modes[0].buyBonus,
	'one base mode at cost 1, no buy',
);

console.log('\nthe committed default is the preset');
const { winLevels, ...rest } = COMMITTED;
check(same(normalizeGameConfigDoc({ ...fairyCloverPreset(), winLevels }), normalizeGameConfigDoc(COMMITTED)), 'lines.fairyClover.json is the preset'); // prettier-ignore
check(same(winLevels, LINES.winLevels), '…with the lines template’s win levels');
check(!('updatedAt' in rest), '…and no save stamp');

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
