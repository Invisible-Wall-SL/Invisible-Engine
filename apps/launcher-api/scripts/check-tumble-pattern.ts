/**
 * Contract check for the CASCADE EXPLOSION PATTERN (Invisible Symbols State Machine → Explosion
 * pattern): what the doc persists, what it refuses, and that the pick reaches BOTH bundle paths.
 *
 * Four things, each over the REAL implementation rather than a re-typed copy of it:
 *   1. PARITY — `normalizeSymbolsDoc` writes NO `tumblePattern` for a project that never picked one
 *      AND for one left on "all at once" (byte-identical to before the field existed), round-trips a
 *      real pick, and prunes the default step, so the page's dirty signature and the server agree on
 *      what "unchanged" looks like.
 *   2. REJECTION — the `.strict()` schema refuses an unknown pattern name, a fractional/negative/
 *      over-ceiling step and an unknown key: the shapes that would otherwise 400 a save silently.
 *   3. BOTH BUNDLE PATHS — the field is carried by the runtime exporter AND by the bake whitelist
 *      (`scripts/bake-editor-doc.mjs`) AND forwarded by `/api/editor/export-symbols`, which the bake
 *      reads it off. This repo has shipped the same bug three times (`winCycle`, `holdAfterBigWin`,
 *      the anticipation sounds): a doc global that reaches the live runtime bundle and is dropped by
 *      the bake, so the game behaves differently depending on which bundle booted it.
 *   4. The CLIENT HALF — `setTumblePattern` / `setTumbleStepMs` / `clearTumblePattern` and
 *      `docSignature` mark and unmark dirty. Without the signature line, picking a pattern would
 *      leave Save disabled and the pick would be silently unsaveable.
 *
 * The ORDERING itself — which seat pops on which wave, and that the real explode step staggers by it
 * — is proven on a virtual clock by `node scripts/verify-tumble-pattern.mjs`.
 *
 * Run:  pnpm --filter launcher-api check:tumble-pattern
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';
import { ZodError } from 'zod';
import { TUMBLE_PATTERNS, TUMBLE_STEP_MS_DEFAULT, TUMBLE_STEP_MS_MAX } from 'engine-layout';
import { emptySymbolsDoc, normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	clearTumblePattern,
	docSignature,
	setTumblePattern,
	setTumbleStepMs,
	tumblePatternName,
	tumbleStepMs,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
/** Source with LF newlines whatever the checkout uses. Every assertion from here down is about the
 *  CODE, and a Windows working copy (`core.autocrlf`) would otherwise fail patterns that name a line
 *  break for reasons that have nothing to do with the claim. */
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input);
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

// 1. PARITY
const empty = normalizeSymbolsDoc({});
check('an empty doc writes no tumblePattern', 'tumblePattern' in empty, false);
check('…and is byte-identical to the never-authored doc', json(empty), json(emptySymbolsDoc()));
check(
	'"all at once" is the default and persists NOTHING — the panel can be opened and closed freely',
	'tumblePattern' in normalizeSymbolsDoc({ tumblePattern: { pattern: 'all' } }),
	false,
);
check(
	'…even carrying a step, which the engine would never read under `all`',
	'tumblePattern' in normalizeSymbolsDoc({ tumblePattern: { pattern: 'all', stepMs: 200 } }),
	false,
);
check(
	'an empty object persists nothing either',
	'tumblePattern' in normalizeSymbolsDoc({ tumblePattern: {} }),
	false,
);
check(
	'a real pattern with a real step round-trips verbatim',
	normalizeSymbolsDoc({ tumblePattern: { pattern: 'columnsLeft', stepMs: 120 } }).tumblePattern,
	{ pattern: 'columnsLeft', stepMs: 120 },
);
check(
	'the default step is pruned — the engine applies it when the field is absent',
	normalizeSymbolsDoc({
		tumblePattern: { pattern: 'radial', stepMs: TUMBLE_STEP_MS_DEFAULT },
	}).tumblePattern,
	{ pattern: 'radial' },
);
check(
	'a zero step is KEPT — it is a deliberate "one frame, but keep my pattern" answer',
	normalizeSymbolsDoc({ tumblePattern: { pattern: 'rowsTop', stepMs: 0 } }).tumblePattern,
	{ pattern: 'rowsTop', stepMs: 0 },
);
{
	const once = normalizeSymbolsDoc({ tumblePattern: { pattern: 'sequential', stepMs: 40 } });
	check('normalising twice is a fixed point', json(normalizeSymbolsDoc(once)), json(once));
}
check(
	'every pattern the tool offers survives the schema',
	TUMBLE_PATTERNS.filter(
		(pattern) =>
			pattern !== 'all' &&
			normalizeSymbolsDoc({ tumblePattern: { pattern, stepMs: 40 } }).tumblePattern?.pattern !==
				pattern,
	),
	[],
);

// 2. REJECTION
rejects('an unknown pattern name', { tumblePattern: { pattern: 'spiral' } });
rejects('a fractional step, which would reach a setTimeout', {
	tumblePattern: { pattern: 'rowsTop', stepMs: 12.5 },
});
rejects('a negative step', { tumblePattern: { pattern: 'rowsTop', stepMs: -1 } });
rejects('a step over the shared ceiling, which could stall a round', {
	tumblePattern: { pattern: 'rowsTop', stepMs: TUMBLE_STEP_MS_MAX + 1 },
});
rejects('an unknown key', { tumblePattern: { pattern: 'rowsTop', easing: 'backOut' } });
rejects('a non-object', { tumblePattern: 'rowsTop' });

// 3. BOTH BUNDLE PATHS
{
	const exporter = read('apps/launcher-api/src/lib/server/symbolExport.ts');
	check(
		'the runtime exporter carries the field into the bundle',
		/\.\.\.\(tumblePattern \? \{ tumblePattern \} : \{\}\)/.test(exporter),
		true,
	);
	const bake = read('apps/launcher-api/scripts/bake-editor-doc.mjs');
	check(
		'the BAKE whitelist rebuilds it — the half that has been silently dropped three times',
		bake.includes('const tumblePattern = (() => {'),
		true,
	);
	check(
		'…and assembles it into the baked `symbols` block',
		/\n\t\t\t\ttumblePattern,\n/.test(bake),
		true,
	);
	const endpoint = read('apps/launcher-api/src/routes/api/editor/export-symbols/+server.ts');
	check(
		'…which it can only do because the export endpoint forwards it',
		(endpoint.match(/\n\t\t\ttumblePattern,/g) ?? []).length,
		2,
	);
	const scenes = read('apps/lines/src/editor-scenes.ts');
	check(
		'the game reads it through one accessor, runtime bundle first',
		scenes.includes('export function bakedTumblePattern()'),
		true,
	);
}

// 4. THE CLIENT HALF
{
	const base: SymbolsDoc = { version: 1, symbols: {} };
	check('an untouched doc reads as "all at once"', tumblePatternName(base), 'all');
	check('…at the default gap', tumbleStepMs(base), TUMBLE_STEP_MS_DEFAULT);

	const picked = setTumblePattern(base, 'columnsLeft');
	check('setTumblePattern marks the doc dirty', docSignature(picked) !== docSignature(base), true);
	check('…and the page reads the pick back', tumblePatternName(picked), 'columnsLeft');

	const retuned = setTumbleStepMs(picked, 200);
	check(
		'setTumbleStepMs marks it dirty again',
		docSignature(retuned) !== docSignature(picked),
		true,
	);
	check('…and keeps the pattern', tumblePatternName(retuned), 'columnsLeft');
	check(
		'a step over the ceiling is clamped by the client too, so the save can never 400',
		setTumbleStepMs(picked, 9_999).tumblePattern?.stepMs,
		TUMBLE_STEP_MS_MAX,
	);
	check(
		'a fractional step is floored by the client too',
		setTumbleStepMs(picked, 33.7).tumblePattern?.stepMs,
		33,
	);
	check(
		'a step picked while on "all at once" is declined — it would persist a section the engine never reads',
		setTumbleStepMs(base, 200) === base,
		true,
	);

	check(
		'picking "all at once" again restores the untouched signature',
		docSignature(setTumblePattern(retuned, 'all')),
		docSignature(base),
	);
	check(
		'clearTumblePattern does the same',
		docSignature(clearTumblePattern(retuned)),
		docSignature(base),
	);
	check(
		'clearTumblePattern on a doc without one returns it unchanged',
		clearTumblePattern(base) === base,
		true,
	);
	check(
		'a default-step draft signs the same as the pruned doc the server hands back',
		docSignature(setTumbleStepMs(setTumblePattern(base, 'radial'), TUMBLE_STEP_MS_DEFAULT)),
		docSignature({
			...base,
			tumblePattern: normalizeSymbolsDoc({
				tumblePattern: { pattern: 'radial', stepMs: TUMBLE_STEP_MS_DEFAULT },
			}).tumblePattern,
		}),
	);
}

console.log(
	failures === 0
		? `\ntumble pattern: OK (${checks} checks)`
		: `\ntumble pattern: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
