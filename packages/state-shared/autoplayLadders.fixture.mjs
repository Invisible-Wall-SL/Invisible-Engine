// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
/**
 * The AUTOPLAY LADDERS an operator's page can declare (`autoplaySpins` / `lossLimits` /
 * `singleWinLimits`) and what `state-shared` offers, stores and arms from them.
 *
 *   node --experimental-strip-types packages/state-shared/autoplayLadders.fixture.mjs
 *
 * Runs the REAL `.svelte.ts` modules through the same load hook as
 * `scripts/verify-jurisdiction-state.mjs` (Svelte's `compileModule`, server output).
 *
 * FIVE claims:
 *
 *  1. NOTHING DECLARED, NOTHING CHANGED. With no operator list the menu offers the constant ladders
 *     — the same texts in the same order — opens on `10` rounds with no limits, and every option
 *     arms the number its constant map always gave. This ships to every online game.
 *  2. A DECLARED LADDER IS OFFERED EXACTLY, spelled like the defaults: `-1` (the partner's
 *     "unlimited") reads `∞`, counts read bare, limits read as stake multiples (`0.5×`).
 *  3. A PICK THE LIVE LADDER DOES NOT OFFER IS ITS FIRST OPTION — whoever stored it, including the
 *     buy-bonus confirm's `∞` against a list with no `∞`.
 *  4. THE SETTERS VALIDATE AGAINST THE LIVE LADDER: a default option the operator did not declare is
 *     refused; a declared one the defaults never had is accepted.
 *  5. LIMITS RESOLVE OFF THE STAKE FOR ANY DECLARED MULTIPLE — `0.5×` at a bet of 2 is 1, `∞` is no
 *     limit — and the ladders return to the defaults when the declaration goes.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
	'data:text/javascript,' +
		encodeURIComponent(`
			import { readFile } from 'node:fs/promises';
			import { createRequire, stripTypeScriptTypes } from 'node:module';
			import { fileURLToPath } from 'node:url';

			export async function resolve(specifier, context, next) {
				try {
					return await next(specifier, context);
				} catch (err) {
					if (!specifier.startsWith('.')) throw err;
					for (const ext of ['.ts', '/index.ts']) {
						try {
							return await next(specifier + ext, context);
						} catch {}
					}
					throw err;
				}
			}

			export async function load(url, context, next) {
				if (!url.endsWith('.svelte.ts')) return next(url, context);
				const path = fileURLToPath(url);
				const { compileModule } = createRequire(path)('svelte/compiler');
				const js = stripTypeScriptTypes(await readFile(path, 'utf8'));
				const { js: out } = compileModule(js, { filename: path, generate: 'server' });
				return { format: 'module', source: out.code, shortCircuit: true };
			}
		`),
	pathToFileURL('./'),
);

const src = new URL('./src/', import.meta.url);
const { NEUTRAL_OPERATOR_SETTINGS, readOperatorSettings } = await import('delivery-profile');
const {
	AUTO_SPINS_TEXT_OPTIONS,
	AUTO_SPINS_TEXT_OPTION_MAP,
	LOSS_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP,
	SINGLE_WIN_LIMIT_TEXT_OPTIONS,
	AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP,
} = await import('constants-shared/autoSpins');
const { adoptOperatorSettings } = await import(new URL('stateOperator.svelte.ts', src));
const { stateBet } = await import(new URL('stateBet.svelte.ts', src));
const ui = await import(new URL('stateUi.svelte.ts', src));

let failures = 0;
const check = (label, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** JSON has no Infinity; spell it so a check can compare it. */
const n = (value) => (value === Infinity ? 'Infinity' : value);
const picks = () => [
	ui.selectedAutoSpinsOption(),
	ui.selectedLossLimitOption(),
	ui.selectedSingleWinLimitOption(),
];
const armed = () => {
	ui.armAutoSpins();
	return [
		n(stateBet.autoSpinsCounter),
		n(stateBet.autoSpinsLossLimitAmount),
		n(stateBet.autoSpinsSingleWinLimitAmount),
	];
};

stateBet.betAmount = 2;

console.log('1. nothing declared, nothing changed');
adoptOperatorSettings({ ...NEUTRAL_OPERATOR_SETTINGS });
check('rounds: the constant ladder', ui.autoSpinsOptions(), AUTO_SPINS_TEXT_OPTIONS);
check('loss limit: the constant ladder', ui.lossLimitOptions(), LOSS_LIMIT_TEXT_OPTIONS);
check('single-win limit: the constant ladder', ui.singleWinLimitOptions(), SINGLE_WIN_LIMIT_TEXT_OPTIONS); // prettier-ignore
check('opens on 10 rounds, no limits', picks(), ['10', '∞', '∞']);
check('arms 10 rounds, no limits', armed(), [10, 'Infinity', 'Infinity']);
for (const [options, map] of [
	[AUTO_SPINS_TEXT_OPTIONS, AUTO_SPINS_TEXT_OPTION_MAP],
	[LOSS_LIMIT_TEXT_OPTIONS, AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP],
	[SINGLE_WIN_LIMIT_TEXT_OPTIONS, AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP],
]) {
	check(
		`every default option means what its map says (${options.join(' ')})`,
		options.map((o) => n(ui.autoSpinsOptionValue(o))),
		options.map((o) => n(map[o])),
	);
}

console.log('\n2. a declared ladder is offered exactly');
adoptOperatorSettings(
	readOperatorSettings({
		autoplaySpins: [20, 5, -1],
		lossLimits: [10, 0.5, 2],
		singleWinLimits: [1, -1],
	}),
);
check('rounds, sorted, -1 as ∞', ui.autoSpinsOptions(), ['5', '20', '∞']);
check('loss limits as stake multiples', ui.lossLimitOptions(), ['0.5×', '2×', '10×']);
check('single-win limits', ui.singleWinLimitOptions(), ['1×', '∞']);
check('only the declared ladder moves', (adoptOperatorSettings(readOperatorSettings({ lossLimits: [3] })), [ui.autoSpinsOptions(), ui.lossLimitOptions()]), [AUTO_SPINS_TEXT_OPTIONS, ['3×']]); // prettier-ignore

console.log('\n3. a pick the live ladder does not offer is its first option');
adoptOperatorSettings(
	readOperatorSettings({
		autoplaySpins: [20, 5, -1],
		lossLimits: [10, 0.5, 2],
		singleWinLimits: [1, -1],
	}),
);
check('stored 10 / ∞ / ∞ read as 5 / 0.5× / ∞', picks(), ['5', '0.5×', '∞']);
ui.stateUi.autoSpinsSingleWinLimitText = '∞';
ui.stateUi.autoSpinsLossLimitText = '∞';
check("the buy confirm's ∞ against a list without one is the first", ui.selectedLossLimitOption(), '0.5×'); // prettier-ignore

console.log('\n4. the setters validate against the live ladder');
ui.setAutoSpinsOption('10');
check('a default option the operator did not declare is refused', ui.stateUi.autoSpinsText, '10');
check('...and the pick still reads as the first', ui.selectedAutoSpinsOption(), '5');
ui.setAutoSpinsOption('20');
check('a declared option is accepted', ui.selectedAutoSpinsOption(), '20');
ui.setAutoSpinsLossLimitOption('5×');
check('a default limit the operator did not declare is refused', ui.stateUi.autoSpinsLossLimitText, '∞'); // prettier-ignore
ui.setAutoSpinsLossLimitOption('2×');
ui.setAutoSpinsSingleWinLimitOption('1×');
check('declared limits are accepted', picks(), ['20', '2×', '1×']);

console.log('\n5. limits resolve off the stake for any declared multiple');
ui.setAutoSpinsLossLimitOption('0.5×');
ui.setAutoSpinsSingleWinLimitOption('∞');
check('0.5× at a bet of 2 is 1; ∞ is no limit', armed(), [20, 1, 'Infinity']);
ui.setAutoSpinsOption('∞');
ui.setAutoSpinsLossLimitOption('10×');
ui.setAutoSpinsSingleWinLimitOption('1×');
check('∞ rounds, 10× is 20, 1× is 2', armed(), ['Infinity', 20, 2]);
adoptOperatorSettings();
check('no page ⇒ the defaults again', [ui.autoSpinsOptions(), ui.lossLimitOptions()], [AUTO_SPINS_TEXT_OPTIONS, LOSS_LIMIT_TEXT_OPTIONS]); // prettier-ignore
check('...a pick both ladders offer stands; a declared-only one reads as the first', picks(), ['∞', '10×', '5×']); // prettier-ignore

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
