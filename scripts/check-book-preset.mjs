// The Book of Thermopylae PRESET (game-config `bookOfThermopylaePreset`) and the captured numbers the
// book mock deals (`BOOK_OF_THERMOPYLAE` in `mock-rgs-server-book.mjs`) say the same game, through
// the facade's `bookMapping` (docs/design/book-feature.md §3.5). Two copies of a capture are fine as
// long as one gate holds them equal; this is it.
//
//   pnpm check:book-preset   (part of check:rgs)

import {
	bookOfThermopylaePreset,
	DEFAULT_FREE_SPINS_TRIGGER_COUNT,
	normalizeGameConfigDoc,
	resolveExpandingSymbol,
	resolveFreeSpins,
	symbolsInPlay,
	validateGameConfigDoc,
} from '../packages/game-config/index.ts';
import { bookMapping } from '../packages/rgs-translator-eagaming/src/gameMappings.ts';
import { BOOK_OF_THERMOPYLAE as CAPTURE } from './mock-rgs-server-book.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const client = (server) => bookMapping.symbols[server] ?? server;
/** `[{ '3': 5 }, …]` as `{ 3: 5, … }`. */
const rowOf = (paytable = []) =>
	Object.fromEntries(paytable.flatMap((row) => Object.entries(row)).map(([n, v]) => [n, v]));

const preset = normalizeGameConfigDoc(bookOfThermopylaePreset());

console.log('\nthe preset is a clean config');
check(Boolean(preset), 'it normalizes');
check(same(normalizeGameConfigDoc(preset), preset), 'it is a normalize fixed point');
const issues = validateGameConfigDoc(preset);
check(issues.length === 0, 'it has no issues', issues.length ? ` (${JSON.stringify(issues)})` : '');
check(
	same(bookOfThermopylaePreset(), bookOfThermopylaePreset()) &&
		bookOfThermopylaePreset() !== bookOfThermopylaePreset(),
	'each call is a fresh copy',
);

console.log('\nthe preset says what the book mock deals');
check(
	preset.numReels === CAPTURE.window.reels &&
		preset.numRows.every((rows) => rows === CAPTURE.window.rows),
	`the board is ${CAPTURE.window.reels}×${CAPTURE.window.rows}`,
);
check(same(Object.values(preset.paylines), CAPTURE.paylines), 'the ten paylines, in order');
for (const [server, row] of Object.entries(CAPTURE.payTableLine)) {
	const name = client(server);
	check(
		same(rowOf(preset.symbols[name]?.paytable), row),
		`${name} (${server}) pays its captured line row`,
	);
}
const book = client('SCAT');
check(
	same(preset.symbols[book]?.special_properties, ['scatter', 'wild']),
	`${book} (SCAT) is the book: scatter and wild`,
);
check(
	same(rowOf(preset.symbols[book]?.paytable), CAPTURE.scatterPay),
	`${book} declares the captured scatter row`,
);
check(
	same(
		[...symbolsInPlay(preset)].sort(),
		[...Object.keys(CAPTURE.payTableLine), 'SCAT'].map(client).sort(),
	),
	'the strips deal exactly the captured symbols',
);

const base = Object.values(preset.betModes).filter((mode) => !mode.buyBonus);
const buys = Object.values(preset.betModes).filter((mode) => mode.buyBonus);
check(base.length === 1 && base[0].cost === 1, 'one base mode at cost 1');
check(
	buys.length === CAPTURE.betOptions.length - 1 &&
		buys.every((mode, i) => mode.cost === CAPTURE.betOptions[i + 1] / CAPTURE.betOptions[0]),
	`one buy per captured option, priced ${CAPTURE.betOptions.slice(1).map((o) => o / CAPTURE.betOptions[0])}×`,
);
check(
	Object.values(preset.betModes).every((mode) => mode.max_win === CAPTURE.maxWinMp),
	`every mode caps at ${CAPTURE.maxWinMp}×`,
);

const freeSpins = resolveFreeSpins(preset);
check(
	freeSpins.triggerCount === CAPTURE.triggerMin &&
		freeSpins.triggerSymbol === book &&
		CAPTURE.triggerMin === DEFAULT_FREE_SPINS_TRIGGER_COUNT,
	`free spins trigger on ${CAPTURE.triggerMin}+ ${book}`,
);
check(
	same(freeSpins.awards, [{ count: CAPTURE.triggerMin, spins: CAPTURE.totalFreeSpins }]),
	`entering awards ${CAPTURE.totalFreeSpins}`,
);
check(
	same(freeSpins.retriggerAwards, [
		{ count: CAPTURE.triggerMin, spins: CAPTURE.retriggerFreeSpins },
	]),
	`a retrigger adds ${CAPTURE.retriggerFreeSpins} — on a lines game too, whose default is +5`,
);

const special = resolveExpandingSymbol(preset);
check(
	same(
		special?.candidates.map((c) => [c.symbol, c.weight]),
		Object.entries(CAPTURE.specialWeights).map(([server, weight]) => [client(server), weight]),
	),
	'the expanding special is drawn from the captured weights',
);
check(
	same(
		special?.candidates.map((c) => [c.symbol, c.minReels]),
		Object.keys(CAPTURE.specialWeights).map((server) => [
			client(server),
			CAPTURE.specialMinReels[server] ?? CAPTURE.specialDefaultMinReels,
		]),
	),
	'…and expands at the captured reel counts',
);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
