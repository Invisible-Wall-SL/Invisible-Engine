/**
 * Offline fixture for the REEL BEHAVIOUR block — how a round presents: roll or swap in place, which
 * swap style, the per-column stagger, and the clear step. This package's internal imports are
 * extensionless (bundler resolution), which bare `node` cannot resolve, so run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/reelBehaviour.fixture.ts
 *
 * FOUR claims, each of which has already cost this repo something somewhere:
 *
 *  1. PARITY. Every default is what the engine did before the block existed — the reels roll, a swap
 *     drops the whole board in at once, nothing clears — and a config that switches nothing on
 *     stores NO block at all. `apps/lines` is the shared `_runtime/lines` bundle every online game
 *     runs, so a default that leaked into storage would change every one of them.
 *  2. THE DEPENDENCIES ARE ANSWERED ONCE. `clearBoard` needs `swapInPlace` AND the `dropIn` style (a
 *     column cascade already empties each column by draining it, so a clear there would be two
 *     clears for one round). Resolving it honestly and re-gating it at the consumer would be the
 *     same rule written twice, which is how one of the two eventually gets it wrong.
 *  3. ...but the STORED value survives its preconditions being turned off. Ticking "clear the
 *     board", then switching style to compare, must not silently discard the tick — a tool that
 *     loses an author's setting on a round-trip is worse than one that never offered it.
 *  4. `columnStaggerMs` RESOLVES TO `number | undefined`, never to a defaulted number. `0` is a
 *     legal authored value ("every column at once") and absent means "the presentation's own
 *     default", so collapsing the two here would make a 0 unauthorable.
 */

import { normalizeGameConfigDoc } from './src/normalize.ts';
import {
	REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS,
	normalizeReelBehaviour,
	resolveReelBehaviour,
} from './src/reelBehaviour.ts';
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

const OFF = {
	swapInPlace: false,
	swapStyle: 'dropIn',
	columnStaggerMs: undefined,
	clearBoard: false,
};

console.log('\nresolveReelBehaviour — absent means the board behaves exactly as it always has');
check('no doc at all', resolveReelBehaviour(undefined), OFF);
check('a doc with no block', resolveReelBehaviour({}), OFF);
check('an empty block', resolveReelBehaviour({ reelBehaviour: {} }), OFF);

console.log('\n...and only a real `true` counts, because the block is authored data');
for (const value of [false, undefined, 'true', 1, null] as unknown[]) {
	check(
		`swapInPlace=${JSON.stringify(value)} is not the mode`,
		resolveReelBehaviour({ reelBehaviour: { swapInPlace: value } as never }).swapInPlace,
		false,
	);
}

console.log('\nswapStyle — only the recognised literals, anything else is the shipped drop-in');
const styleOf = (swapStyle: unknown) =>
	resolveReelBehaviour({ reelBehaviour: { swapStyle } as never }).swapStyle;
check('dropIn stays dropIn', styleOf('dropIn'), 'dropIn');
check('columnCascade is honoured', styleOf('columnCascade'), 'columnCascade');
check('absent is dropIn', styleOf(undefined), 'dropIn');
check('a future vocabulary falls back to dropIn', styleOf('sweep'), 'dropIn');
check('a typo falls back to dropIn', styleOf('columncascade'), 'dropIn');
check('a non-string falls back to dropIn', styleOf(2), 'dropIn');

console.log('\nclearBoard needs the mode AND the drop-in style — the resolver owns both');
const clearOf = (reelBehaviour: unknown) =>
	resolveReelBehaviour({ reelBehaviour } as never).clearBoard;
check('clearBoard alone resolves OFF', clearOf({ clearBoard: true }), false);
check(
	'clearBoard + swapInPlace resolves ON (dropIn is the default style)',
	clearOf({ clearBoard: true, swapInPlace: true }),
	true,
);
check(
	'clearBoard + swapInPlace + dropIn resolves ON',
	clearOf({ clearBoard: true, swapInPlace: true, swapStyle: 'dropIn' }),
	true,
);
// A column cascade DRAINS each column, which is already that column emptying.
check(
	'clearBoard under a column cascade resolves OFF — the drain is the clear',
	clearOf({ clearBoard: true, swapInPlace: true, swapStyle: 'columnCascade' }),
	false,
);
check('swapInPlace alone does not imply a clear', clearOf({ swapInPlace: true }), false);

console.log('\ncolumnStaggerMs — a finite `>= 0`, clamped; anything else is "use the default"');
const staggerOf = (columnStaggerMs: unknown) =>
	resolveReelBehaviour({ reelBehaviour: { columnStaggerMs } as never }).columnStaggerMs;
check('140 ms is 140 ms', staggerOf(140), 140);
// The claim that makes a 0 authorable at all: it must NOT collapse into "absent".
check('0 is a legal authored value, not absent', staggerOf(0), 0);
check('absent stays absent, so the presentation picks', staggerOf(undefined), undefined);
check('negative is absent', staggerOf(-50), undefined);
check('NaN is absent', staggerOf(Number.NaN), undefined);
check('Infinity is absent', staggerOf(Number.POSITIVE_INFINITY), undefined);
check('a string is absent', staggerOf('140'), undefined);
check(
	'above the ceiling is clamped, not rejected',
	staggerOf(99999),
	REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS,
);

console.log('\nnormalizeReelBehaviour — store only what DEPARTS from the default');
check('nothing switched on ⇒ no block', normalizeReelBehaviour({}), undefined);
check('every switch off ⇒ no block', normalizeReelBehaviour({ swapInPlace: false }), undefined);
check('garbage ⇒ no block', normalizeReelBehaviour('swap'), undefined);
check('null ⇒ no block', normalizeReelBehaviour(null), undefined);
// `dropIn` IS the default, so storing it would add a field to every doc that picked the default.
check('the default style ⇒ dropped', normalizeReelBehaviour({ swapStyle: 'dropIn' }), undefined);
check('an unrecognised style ⇒ dropped', normalizeReelBehaviour({ swapStyle: 'sweep' }), undefined);
check('the mode ⇒ kept', normalizeReelBehaviour({ swapInPlace: true }), { swapInPlace: true });
check('the cascade style ⇒ kept', normalizeReelBehaviour({ swapStyle: 'columnCascade' }), {
	swapStyle: 'columnCascade',
});
check('a stagger ⇒ kept, rounded', normalizeReelBehaviour({ columnStaggerMs: 90.4 }), {
	columnStaggerMs: 90,
});
check(
	'a zero stagger ⇒ kept, because it is authorable',
	normalizeReelBehaviour({ columnStaggerMs: 0 }),
	{
		columnStaggerMs: 0,
	},
);
check('a stagger above the ceiling ⇒ clamped', normalizeReelBehaviour({ columnStaggerMs: 9000 }), {
	columnStaggerMs: REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS,
});
// The one deliberate exception to "only what departs": `clearBoard` is a SETTING, and dropping it
// while its preconditions are off would mean a round-trip through the tool undid the author's tick.
check('clearBoard is kept even with the mode off', normalizeReelBehaviour({ clearBoard: true }), {
	clearBoard: true,
});

console.log('\nround-trip through the real normalizer');
const base = {
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	paylines: { '0': [0, 0, 0, 0, 0] },
	symbols: { H1: { name: 'H1' } },
	paddingReels: {
		BR: [
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
		],
	},
	betModes: {},
};

const untouched = normalizeGameConfigDoc({ ...base }) as GameConfigDoc;
check('a doc that never mentioned the block is unchanged', 'reelBehaviour' in untouched, false);
check('...and the board rolls', resolveReelBehaviour(untouched), OFF);

const sweeping = normalizeGameConfigDoc({
	...base,
	reelBehaviour: { swapInPlace: true, swapStyle: 'columnCascade', columnStaggerMs: 140 },
}) as GameConfigDoc;
check('an authored block survives the normalizer', sweeping.reelBehaviour, {
	swapInPlace: true,
	swapStyle: 'columnCascade',
	columnStaggerMs: 140,
});
check('...and resolves whole', resolveReelBehaviour(sweeping), {
	swapInPlace: true,
	swapStyle: 'columnCascade',
	columnStaggerMs: 140,
	clearBoard: false,
});
check(
	'normalizing twice is idempotent',
	(normalizeGameConfigDoc(sweeping) as GameConfigDoc).reelBehaviour,
	sweeping.reelBehaviour,
);

const clearing = normalizeGameConfigDoc({
	...base,
	reelBehaviour: { swapInPlace: true, clearBoard: true },
}) as GameConfigDoc;
check('a clearing drop-in resolves whole', resolveReelBehaviour(clearing), {
	swapInPlace: true,
	swapStyle: 'dropIn',
	columnStaggerMs: undefined,
	clearBoard: true,
});

// The tick that outlives its preconditions — claim 3, end to end.
const modeOff = normalizeGameConfigDoc({
	...base,
	reelBehaviour: { clearBoard: true },
}) as GameConfigDoc;
check('unticking the mode keeps the clear tick STORED', modeOff.reelBehaviour, {
	clearBoard: true,
});
check('...while resolving inert', resolveReelBehaviour(modeOff).clearBoard, false);

console.log('\nthe validator says what saves-but-does-nothing');
const pathsOf = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc)
		.filter((issue) => issue.path.startsWith('reelBehaviour'))
		.map((issue) => `${issue.severity} ${issue.path}`)
		.sort();

check('a rolling, un-authored config raises nothing here', pathsOf(untouched), []);
check('a clear with the mode off is warned about', pathsOf(modeOff), [
	'warning reelBehaviour.clearBoard',
]);
check(
	'a style with the mode off is warned about',
	pathsOf(
		normalizeGameConfigDoc({
			...base,
			reelBehaviour: { swapStyle: 'columnCascade' },
		}) as GameConfigDoc,
	),
	['warning reelBehaviour.swapStyle'],
);
check('a clearing drop-in raises nothing', pathsOf(clearing), []);
check('a modest sweep raises nothing', pathsOf(sweeping), []);
check(
	'a clear under a column cascade is warned about — the drain already clears',
	pathsOf(
		normalizeGameConfigDoc({
			...base,
			reelBehaviour: { swapInPlace: true, swapStyle: 'columnCascade', clearBoard: true },
		}) as GameConfigDoc,
	),
	['warning reelBehaviour.clearBoard'],
);
check(
	'a stagger on the drop-in style is warned about — nothing staggers there',
	pathsOf(
		normalizeGameConfigDoc({
			...base,
			reelBehaviour: { swapInPlace: true, columnStaggerMs: 140 },
		}) as GameConfigDoc,
	),
	['warning reelBehaviour.columnStaggerMs'],
);

const slow = normalizeGameConfigDoc({
	...base,
	reelBehaviour: { swapInPlace: true, swapStyle: 'columnCascade', columnStaggerMs: 400 },
}) as GameConfigDoc;
const slowIssue = validateGameConfigDoc(slow).find(
	(issue) => issue.path === 'reelBehaviour.columnStaggerMs',
);
check('a sweep that costs over a second is warned about', slowIssue?.severity, 'warning');
check('...and names the number the LAST column pays', slowIssue?.message.includes('1600 ms'), true);

console.log(
	failures === 0 ? '\nAll reel-behaviour assertions passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
