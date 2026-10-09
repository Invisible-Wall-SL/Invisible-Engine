/**
 * The LINES presets (`docs/design/book-feature.md` Phase 5a/5c): the Book of Thermopylae is offered
 * by `/config`'s "Reset to preset" and seeded by Game Maker's Create — and nothing else moves. A
 * lines project created without a preset is still un-authored, and every other kind offers and
 * seeds what it did.
 *
 *   pnpm --filter launcher-api check:lines-presets
 */
import {
	bookOfThermopylaePreset,
	gameConfigErrors,
	HOLD_AND_WIN_PRESET_IDS,
	normalizeGameConfigDoc,
	resolveExpandingSymbol,
	type GameConfigDoc,
} from 'game-config';
import {
	gameConfigDefaultFor,
	gameConfigPresetsFor,
	gameConfigSeedFor,
	isLinesPresetId,
} from '../src/lib/server/gameConfigDefaults.ts';

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

const presets = gameConfigPresetsFor('lines');
check(
	'lines offers the Book of Thermopylae',
	presets.map((p) => [p.id, p.label]),
	[['bookOfThermopylae', 'Book of Thermopylae']],
);
const doc = presets[0]?.doc as GameConfigDoc;
check('…a config that saves (no blocking issue)', gameConfigErrors(doc).length, 0);
check(
	'…dealing the captured special',
	resolveExpandingSymbol(doc),
	resolveExpandingSymbol(normalizeGameConfigDoc(bookOfThermopylaePreset()) as GameConfigDoc),
);
check('…with the book as scatter and wild', doc.symbols.S?.special_properties, ['scatter', 'wild']);
check(
	'every other kind offers what it did',
	['ways', 'scatter', 'cluster', 'bookOf', undefined].map((k) => gameConfigPresetsFor(k).length),
	[0, 0, 0, 0, 0],
);
check(
	'Hold and Win offers the plain template (jackpots on / off), then its three',
	gameConfigPresetsFor('holdAndWin').map((p) => p.id),
	['holdAndWin.plain', 'holdAndWin.plainNoJackpots', ...HOLD_AND_WIN_PRESET_IDS],
);
check('a lines project with no preset stays un-authored', gameConfigSeedFor('lines'), null);
check(
	'…and with the Book of Thermopylae starts from it',
	gameConfigSeedFor('lines', 'bookOfThermopylae'),
	doc,
);
check(
	'the lines default is not the preset',
	JSON.stringify(gameConfigDefaultFor('lines')) === JSON.stringify(doc),
	false,
);
check('only a lines preset id is one', [isLinesPresetId('bookOfThermopylae'), isLinesPresetId('pots'), isLinesPresetId(undefined)], [true, false, false]); // prettier-ignore
check(
	'a Hold and Win preset still seeds its kind',
	HOLD_AND_WIN_PRESET_IDS.every((id) => gameConfigSeedFor('holdAndWin', id) !== null),
	true,
);
check('a lines preset is no Hold and Win preset', gameConfigSeedFor('holdAndWin', 'bookOfThermopylae') === gameConfigSeedFor('holdAndWin'), true); // prettier-ignore

console.log(failures === 0 ? '\nAll lines-preset checks passed.' : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
