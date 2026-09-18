// THE STUB-SET GUARD — shared by every offline fixture that compiles sliced component source with
// `new Function`.
//
// WHY IT EXISTS. Several of this repo's guards cannot import what they test: the modules are Svelte
// components and runes files that Node will not load. So they SLICE the shipped source and compile
// it with `new Function`, whose parameters stand in for the modules the slice imports and the
// fixture does not run. That parameter list is hand-written, and it DRIFTS — the component grows a
// call, the list does not follow.
//
// The failure mode is the reason this is SHARED rather than repaired one name at a time. `new
// Function` compiles a free identifier happily; it only throws when the line RUNS, which in these
// fixtures is inside an async cue handler several awaits deep. The whole file then dies on a bare
// `ReferenceError` naming one symbol and nothing else, every check after that point asserts
// nothing, and the guard sits red on `main` looking like someone else's problem. Each of these was
// found by a person noticing a red run and adding the one name that run happened to hit:
//
//   - `verify-win-explode-pop.mjs`       — `resolveWinBeatBudget is not defined` (the win-beat
//                                          budget work), taking parts 2-11 down with it.
//   - `verify-swap-in-place-mode.mjs`    — `bakedArrivalReleaseEnabled is not defined` (the arrival
//                                          release), taking parts 9-onward down with it; and #622
//                                          and #625 before it, the same file, the same shape.
//   - `verify-reelgrid-perspective-roundtrip.mjs` — the same shape again (#613).
//
// Adding the name is not the fix, and the proof is that this guard found TWO MORE the hour it was
// wired in — `overlayShown` and `settleBoard`, free in `Board.svelte`'s `boardSettle` /
// `tumbleBoardShow` / `tumbleBoardHide` handlers, sitting latent on a green `main` waiting for the
// first case that drove one of those cues.
//
// WHAT IT DOES. Type-checks the body a fixture is about to compile, with the stub set declared
// ambient, and reports the "this name does not exist" family BEFORE the first case runs. A missing
// stub becomes a message naming the fixture, the identifier and what to do, instead of a
// `ReferenceError` from the middle of a handler.
//
// The technique — `tsc --noResolve`, filtered to three diagnostic codes — is lifted from
// `scripts/check-undefined-names.mjs`, which exists for the same bug one layer out (an identifier
// that only a runtime would notice). `--noResolve` is what makes it cheap and honest: nothing is
// loaded across module boundaries, and a compiled fixture body has no imports left in it anyway.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The `tsc` codes that mean "this name does not exist" — the same three `check-undefined-names`
 *  owns. Everything else the compiler has to say about a fixture's spliced-together body (duplicate
 *  declarations, an implicit `any`, a `this` it cannot type) is noise this guard does not own. */
const UNDEFINED_NAME_CODES = new Set(['TS2304', 'TS2552', 'TS18004']);

const NAME_PATTERNS = [
	/error (TS2304|TS2552): Cannot find name '([^']+)'/,
	/error (TS18004): No value exists in scope for the shorthand property '([^']+)'/,
];

/**
 * Fail loudly if the compiled body reaches for a name the stub set does not provide.
 *
 * @param {object} options
 * @param {string} options.what       The fixture, for the message — e.g. `verify-win-explode-pop`.
 * @param {string} options.body       The exact text about to be handed to `new Function`.
 * @param {string[]} options.stubNames The parameter names that text will be compiled with.
 */
export const assertStubSetIsComplete = ({ what, body, stubNames }) => {
	const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/lib/tsc.js');
	const tmp = mkdtempSync(join(tmpdir(), 'stub-set-'));
	// The body is wrapped in a function so its `return` is legal, and the stub set is declared
	// outside it — exactly the shape `new Function` gives the same text.
	const ambient = stubNames.map((name) => `declare const ${name}: any;`).join('\n');
	writeFileSync(join(tmp, 'body.ts'), `${ambient}\nfunction __fixture() {\n${body}\n}\n`);
	writeFileSync(
		join(tmp, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				noEmit: true,
				skipLibCheck: true,
				noResolve: true,
				allowJs: false,
				target: 'es2022',
				// `dom` for the host globals a fixture body reaches for (`console`, `setTimeout`);
				// without it they report as undefined names and the guard cries wolf on its first run.
				lib: ['es2022', 'dom'],
				module: 'esnext',
				moduleResolution: 'bundler',
			},
			files: ['body.ts'],
		}),
	);
	const run = spawnSync(process.execPath, [tsc, '-p', join(tmp, 'tsconfig.json')], {
		cwd: tmp,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	rmSync(tmp, { recursive: true, force: true });

	const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
	// tsc exits 0 clean and 1/2 with diagnostics. Anything else means it did not COMPLETE, and an
	// unfinished check must never read as a passing one — the OOM trap `check-undefined-names` hit.
	if (run.error || ![0, 1, 2].includes(run.status)) {
		throw new Error(
			`${what}: the stub-set guard could not run tsc ` +
				`(${run.error?.message ?? `exit ${run.status}`}).\n` +
				output.split(/\r?\n/).slice(0, 12).join('\n'),
		);
	}

	const missing = [
		...new Set(
			output.split(/\r?\n/).flatMap((line) => {
				for (const pattern of NAME_PATTERNS) {
					const match = pattern.exec(line);
					if (match && UNDEFINED_NAME_CODES.has(match[1])) return [match[2]];
				}
				return [];
			}),
		),
	].sort();

	if (!missing.length) return;

	throw new Error(
		`${what}: the stub set is ${missing.length} name(s) behind the shipped source — ` +
			`${missing.join(', ')}.\n` +
			'    The sliced component calls these and nothing provides them, so this fixture would die\n' +
			'    with a ReferenceError partway through a handler and every check after it would assert\n' +
			"    nothing. Add each to the fixture's `stubs` object — or SLICE it, if it is real\n" +
			'    behaviour the fixture should be exercising rather than faking.\n' +
			'    See scripts/lib/stub-set-guard.mjs.',
	);
};
