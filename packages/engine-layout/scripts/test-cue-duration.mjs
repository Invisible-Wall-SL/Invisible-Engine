// Verify `cueAnimationDurationMs` — what Invisible Flow v2's "Wait for this cue to finish" waits
// for when the cue is one the AUTHOR named in the Scene Editor.
//
//   node scripts/test-cue-duration.mjs
//
// Those cues travel the open component-signal bus, a bare `subscribe(run)` contract with no
// completion channel (see test-cue-signal-bus.mjs) — so a spine it drives cannot report that it
// finished, awaiting the emitter broadcast alone returned in the same microtask, and the tick was a
// silent no-op. Measuring the clip the cue starts is the completion the bus cannot carry, so these
// assertions pin the measurement: what counts, what is deliberately skipped, and the two rules that
// keep it from hanging a round (only MOUNTED scenes are passed in; an unresolved asset waits 0).
//
// Same esbuild-bundle trick as test-cue-signal-bus.mjs: bundle the pure (Svelte-free) module into
// one ESM file Node can run, then assert against the real implementation.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export { cueAnimationDurationMs } from '../src/lib/cueDuration.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-cue-duration.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `cue-duration-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};

const { cueAnimationDurationMs } = mod;

// A stand-in for the game's `spineClipMs`: the loaded skeleton's clip durations, in ms.
const CLIPS = { hero: { idle: 1000, spin: 2500, celebrate: 4000 }, pet: { wag: 600 } };
const spineClipMs = (assetKey, animation) => (animation ? CLIPS[assetKey]?.[animation] : undefined);
const flipbookCycleMs = (clipId) => ({ sparkle: 750 })[clipId];
const noComponents = { spineClipMs, flipbookCycleMs, resolveComponent: () => undefined };

const scene = (...nodes) => [{ id: 's1', nodes }];
const spine = (over = {}) => ({
	id: 'n1',
	kind: 'spine',
	assetKey: 'hero',
	defaultAnimation: 'idle',
	...over,
});

// --- 1. The basic measurement ---
console.info('\n1. The clip a cue starts is the wait');
assert(
	cueAnimationDurationMs(
		scene(spine({ cues: [{ signal: 'characterSpin', animation: 'spin' }] })),
		'characterSpin',
		noComponents,
	) === 2500,
	'a one-shot cue measures its own clip',
);
assert(
	cueAnimationDurationMs(
		scene(spine({ cues: [{ signal: 'characterSpin', animation: 'spin', loop: true }] })),
		'characterSpin',
		noComponents,
	) === 2500,
	'a LOOPING cue measures ONE CYCLE — the author ticked the box on this node, and a loop has no other finite answer',
);
assert(
	cueAnimationDurationMs(
		scene(spine({ cues: [{ signal: 'characterSpin', animation: 'spin' }] })),
		'characterIdle',
		noComponents,
	) === 0,
	'a different cue name measures nothing',
);
assert(
	cueAnimationDurationMs(scene(spine({ cues: [] })), '', noComponents) === 0,
	'an empty cue name measures nothing (never matches a blank authored signal)',
);

// --- 2. The no-hang rules ---
console.info('\n2. The rules that keep an authored wait from hanging a round');
assert(
	cueAnimationDurationMs(
		scene(spine({ cues: [{ signal: 'characterSpin', animation: 'notInTheSkeleton' }] })),
		'characterSpin',
		noComponents,
	) === 0,
	'an unresolved clip waits 0 — a cue fired before its skeleton loaded must not hold the chain',
);
assert(
	cueAnimationDurationMs([], 'characterSpin', noComponents) === 0,
	'no scenes (nothing mounted) waits 0 — the open bus has no replay, so an unmounted screen never played it',
);
assert(
	cueAnimationDurationMs(
		scene(spine({ cues: [{ signal: 'characterSpin', animation: '' }] })),
		'characterSpin',
		noComponents,
	) === 0,
	'a half-authored cue (blank animation) waits 0 — it is skipped at both subscribe seams, so it must contribute nothing here',
);
assert(
	cueAnimationDurationMs(
		scene(spine({ cues: [{ signal: '', animation: 'spin' }] })),
		'characterSpin',
		noComponents,
	) === 0,
	'a cue with no signal name waits 0',
);

// --- 3. The MAX across everything the cue starts ---
console.info('\n3. Several nodes may answer one cue — the longest wins');
assert(
	cueAnimationDurationMs(
		scene(
			spine({ id: 'a', cues: [{ signal: 'go', animation: 'spin' }] }),
			spine({ id: 'b', assetKey: 'hero', cues: [{ signal: 'go', animation: 'celebrate' }] }),
		),
		'go',
		noComponents,
	) === 4000,
	'the MAX over every cued node — the beat is not done until the longest clip is',
);
assert(
	cueAnimationDurationMs(
		scene({
			id: 'box',
			kind: 'container',
			children: [spine({ cues: [{ signal: 'go', animation: 'spin' }] })],
		}),
		'go',
		noComponents,
	) === 2500,
	'the walk descends into containers',
);
assert(
	cueAnimationDurationMs(
		[
			{ id: 's1', nodes: [spine({ cues: [{ signal: 'go', animation: 'spin' }] })] },
			{
				id: 's2',
				nodes: [spine({ id: 'n2', cues: [{ signal: 'go', animation: 'celebrate' }] })],
			},
		],
		'go',
		noComponents,
	) === 4000,
	'…and across every scene passed in (a cue reaches every mounted screen at once)',
);

// --- 4. Flipbook cues ---
console.info('\n4. A flipbook cue swaps a clip, and that clip is the wait');
assert(
	cueAnimationDurationMs(
		scene({
			id: 'f',
			kind: 'flipbook',
			clipId: 'idle',
			cues: [{ signal: 'go', clipId: 'sparkle' }],
		}),
		'go',
		noComponents,
	) === 750,
	'a flipbook cue measures one cycle of the clip it swaps to',
);
assert(
	cueAnimationDurationMs(
		scene({ id: 'f', kind: 'flipbook', clipId: 'idle', cues: [{ signal: 'go', clipId: 'ghost' }] }),
		'go',
		noComponents,
	) === 0,
	'an unregistered clip id waits 0',
);
assert(
	cueAnimationDurationMs(
		scene({
			id: 'f',
			kind: 'flipbook',
			clipId: 'idle',
			cues: [{ signal: 'go', clipId: 'sparkle' }],
		}),
		'go',
		{ spineClipMs, resolveComponent: () => undefined },
	) === 0,
	'no flipbook resolver supplied ⇒ skipped, never a crash',
);

// --- 5. Component instances, and the rebind that would otherwise measure the wrong cue ---
console.info('\n5. Prefab expansion + per-placement signal rebinding');
const def = {
	root: {
		id: 'root',
		kind: 'container',
		children: [spine({ id: 'inner', cues: [{ signal: 'defSignal', animation: 'spin' }] })],
	},
};
const withComponent = {
	spineClipMs,
	flipbookCycleMs,
	resolveComponent: (id) => (id === 'character' ? def : undefined),
};
assert(
	cueAnimationDurationMs(
		scene({ id: 'i', kind: 'componentInstance', componentId: 'character' }),
		'defSignal',
		withComponent,
	) === 2500,
	'the walk expands a componentInstance and measures the cue inside it',
);
assert(
	cueAnimationDurationMs(
		scene({
			id: 'i',
			kind: 'componentInstance',
			componentId: 'character',
			cueSignalOverrides: { inner: { defSignal: 'characterSpin' } },
		}),
		'characterSpin',
		withComponent,
	) === 2500,
	'`cueSignalOverrides` is applied before matching — exactly as <ComponentInstance> applies it before subscribing',
);
assert(
	cueAnimationDurationMs(
		scene({
			id: 'i',
			kind: 'componentInstance',
			componentId: 'character',
			cueSignalOverrides: { inner: { defSignal: 'characterSpin' } },
		}),
		'defSignal',
		withComponent,
	) === 0,
	'…so a REBOUND cue no longer answers under the def name (without this, the placement measures 0 and the def name waits for a cue nothing fires)',
);
assert(
	cueAnimationDurationMs(
		scene({ id: 'i', kind: 'componentInstance', componentId: 'unknownDef' }),
		'defSignal',
		withComponent,
	) === 0,
	'an unknown def is skipped, never a crash',
);

// A def containing an instance of ITSELF must terminate.
const cyclic = {
	root: {
		id: 'root',
		kind: 'container',
		children: [
			spine({ id: 'inner', cues: [{ signal: 'go', animation: 'spin' }] }),
			{ id: 'self', kind: 'componentInstance', componentId: 'loopy' },
		],
	},
};
assert(
	cueAnimationDurationMs(
		scene({ id: 'i', kind: 'componentInstance', componentId: 'loopy' }),
		'go',
		{ spineClipMs, flipbookCycleMs, resolveComponent: () => cyclic },
	) === 2500,
	'a self-containing def terminates via the cycle guard (and still measures its own cue)',
);

// --- 6. Node kinds with no cues ---
console.info('\n6. Everything else contributes nothing');
assert(
	cueAnimationDurationMs(
		scene(
			{ id: 'sp', kind: 'sprite', assetKey: 'hero' },
			{ id: 'tx', kind: 'text', text: 'hi' },
			{ id: 'fx', kind: 'effect', effectId: 'burst' },
		),
		'go',
		noComponents,
	) === 0,
	'sprite / text / effect carry no cues, so they never lengthen a cue wait',
);

console.info('');
if (failures > 0) {
	console.error(`${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('all cue-duration assertions passed');
