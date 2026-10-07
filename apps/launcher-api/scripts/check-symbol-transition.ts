/**
 * Contract check for the explosion → intro TRANSITION (Invisible Symbols State Machine → Transition):
 * what the doc persists, what it refuses, and that the asset a transition binds actually SHIPS.
 *
 * Four things, each over the REAL implementation rather than a re-typed copy of it:
 *   1. PARITY — `normalizeSymbolsDoc` writes NO `transition` for a doc that has none (byte-identical
 *      to before the field existed), round-trips a set one verbatim, and prunes the one default
 *      (`delayMs: 0`), so the page's dirty signature and the server agree on "unchanged".
 *   2. REJECTION — the `.strict()` + `.refine()` schema refuses a half-authored binding (a rig with
 *      no animation, a flipbook with no clip, an fx with no effect), the `sprite` kind, a negative or
 *      fractional delay — the shapes that would otherwise 400 a save silently
 *      (the publish double-fail).
 *   3. SHIPPING — `collectSymbolRefs` puts a rig bound ONLY as the transition into `rigKeys`,
 *      the set the exporter copies into `deploy/editor-symbols/` and lists in `index.spines`, which
 *      the game registers whole (`bakedSymbolAssets`). Rule 8, asserted rather than assumed.
 *   4. The CLIENT half — `setTransition` / `clearTransition` / `docSignature` mark and unmark dirty,
 *      and a zero-delay draft signs the same as the pruned doc the server hands back.
 *
 * Run:  pnpm --filter launcher-api check:symbol-transition
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build. Nothing the app builds uses that mapping.
 */

import { ZodError } from 'zod';
import { collectSymbolRefs } from '../src/lib/server/symbolExport.ts';
import { emptySymbolsDoc, normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	clearTransition,
	docSignature,
	setTransition,
	TRANSITION_KINDS,
	type SymbolsDoc,
	type SymbolTransition,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
/** Key-order-insensitive: Zod rebuilds a parsed object in SCHEMA key order, and the fixtures are
 *  written in reading order — the contract is the fields, not their sequence. */
const canon = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(canon)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.keys(value as Record<string, unknown>)
						.sort()
						.map((k) => [k, canon((value as Record<string, unknown>)[k])]),
				)
			: value;
const json = (value: unknown): string => JSON.stringify(canon(value));
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
// The SAVE path: a read drops an unknown enum value instead (docs/conventions/doc-readers.md).
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input, 'reject');
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};
/** An unknown key is IGNORED, not refused (`docs/conventions/doc-readers.md`): the doc normalizes as
 *  if it were absent, and the server warns naming it. */
const ignores = (label: string, input: unknown, known: unknown): void => {
	const warned: unknown[][] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => void warned.push(args);
	try {
		check(label, normalizeSymbolsDoc(input), normalizeSymbolsDoc(known));
	} finally {
		console.warn = warn;
	}
	check(`${label} — with a warning`, warned.length > 0, true);
};

const RIG = 'acme/splashy/spines/engine-splash/';
const rig: SymbolTransition = {
	kind: 'spine',
	assetKey: RIG,
	animationName: 'splash',
	delayMs: 250,
};
const flipbook: SymbolTransition = {
	kind: 'flipbook',
	clipId: 'splash',
	assetKey: 'acme/splashy/manifests/atlas_manifest_fx.json',
};
const fx: SymbolTransition = { kind: 'fx', effectId: 'splash-fx' };

// 1. PARITY
const empty = normalizeSymbolsDoc({});
check('an empty doc writes no transition', 'transition' in empty, false);
check('…and is byte-identical to the never-authored doc', json(empty), json(emptySymbolsDoc()));
const untouched = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { win: { type: 'spine', assetKey: RIG } } },
});
check('a doc that never set one round-trips without the key', 'transition' in untouched, false);
check(
	'a rig transition with a delay round-trips verbatim',
	normalizeSymbolsDoc({ transition: rig }).transition,
	rig,
);
check(
	'a delay of 0 is pruned — the default the engine applies when the field is absent',
	normalizeSymbolsDoc({ transition: { ...rig, delayMs: 0 } }).transition,
	{ kind: 'spine', assetKey: RIG, animationName: 'splash' },
);
check(
	'a flipbook transition round-trips (clip + its primary sheet)',
	normalizeSymbolsDoc({ transition: flipbook }).transition,
	flipbook,
);
check('an fx transition round-trips', normalizeSymbolsDoc({ transition: fx }).transition, fx);
const once = normalizeSymbolsDoc({ transition: rig });
check('normalising twice is a fixed point', json(normalizeSymbolsDoc(once)), json(once));
check('the client kind list is the server enum', TRANSITION_KINDS, ['spine', 'flipbook', 'fx']);

// 2. REJECTION
rejects('a rig with no animation', { transition: { kind: 'spine', assetKey: RIG } });
rejects('a flipbook with no clip', {
	transition: { kind: 'flipbook', assetKey: flipbook.assetKey },
});
rejects('an fx with no effect', { transition: { kind: 'fx' } });
rejects('the sprite kind — a frame has no duration', {
	transition: { kind: 'sprite', assetKey: 'h1.webp' },
});
rejects('a negative delay', { transition: { ...rig, delayMs: -1 } });
rejects('a fractional delay', { transition: { ...rig, delayMs: 12.5 } });
ignores(
	'an unknown key',
	{ transition: { ...rig, sizeRatios: { width: 1, height: 1 } } },
	{ transition: rig },
);

// 3. SHIPPING
const onlyHere = collectSymbolRefs(normalizeSymbolsDoc({ transition: rig }));
check(
	'a rig bound ONLY as the transition is in the exported rig set',
	onlyHere.rigKeys.has(RIG),
	true,
);
check(
	'…and nothing else was dragged in with it',
	[onlyHere.frameNames.size, onlyHere.spriteManifests.size, onlyHere.rigKeys.size],
	[0, 0, 1],
);
check('no transition ⇒ no rig ref', collectSymbolRefs(empty).rigKeys.size, 0);
const clipOnly = collectSymbolRefs(normalizeSymbolsDoc({ transition: flipbook }));
check(
	'a flipbook transition files no frame ref — its clip ships via the editor-art clip walk',
	[clipOnly.frameNames.size, clipOnly.spriteManifests.size, clipOnly.rigKeys.size],
	[0, 0, 0],
);

// 4. THE CLIENT HALF
const base: SymbolsDoc = { version: 1, symbols: {} };
const withTransition = setTransition(base, rig);
check(
	'setTransition marks the doc dirty',
	docSignature(withTransition) !== docSignature(base),
	true,
);
check(
	'clearTransition restores the signature',
	docSignature(clearTransition(withTransition)),
	docSignature(base),
);
check(
	'clearTransition on a doc without one returns it unchanged',
	clearTransition(base) === base,
	true,
);
const pruned = normalizeSymbolsDoc({ transition: { ...rig, delayMs: 0 } });
check(
	'a zero-delay draft signs the same as the pruned doc the server hands back',
	docSignature(setTransition(base, { kind: 'spine', assetKey: RIG, animationName: 'splash' })),
	docSignature({ ...base, transition: pruned.transition as SymbolTransition }),
);

console.log(
	failures === 0
		? `\nsymbol transition: OK (${checks} checks)`
		: `\nsymbol transition: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
