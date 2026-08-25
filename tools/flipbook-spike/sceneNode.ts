/**
 * Invisible Flipbook — headless harness for the `flipbook` SCENE NODE (design doc
 * `invisible-flipbook.md`, build-plan step 6, the Scene Editor consumer):
 *
 *   pnpm --filter flipbook-spike run scene-node
 *
 * Imported by PATH, not through the `engine-layout` barrel — that barrel pulls in Svelte
 * components and pixi, which Node cannot resolve (see [[gotcha_constants_shared_not_node_resolvable]]).
 *
 * WHY this fixture exists at all: every wiring point below is invisible to the build.
 * `pnpm --filter launcher-api build` is a bare `vite build` with no `svelte-check`, so a type error
 * ships green — and the two failures guarded here are both SILENT:
 *
 *  1. A kind missing from the doc normalizer's accepted set is DROPPED on save. The editor draws
 *     the node, the round-trip erases it, nothing goes red. That is the `COMPONENT_PARAM_KINDS`
 *     failure mode this repo already paid for twice, so `LAYOUT_NODE_KINDS` is now the single
 *     source and this fixture asserts the union is fully covered — the direction `satisfies`
 *     cannot check.
 *  2. A kind missing from `resolveTransform`'s SIZED list silently ignores `width`/`height`: the
 *     author sizes the node in the editor and the game draws it at native size instead.
 */

import {
	LAYOUT_NODE_KINDS,
	type FlipbookNode,
	type LayoutNode,
	type Scene,
} from '../../packages/engine-layout/src/lib/types';
import { resolveTransform } from '../../packages/engine-layout/src/lib/resolveTransform';
import { sceneAnimationDurationMs } from '../../packages/engine-layout/src/lib/sceneDuration';
import {
	clearFlipbooks,
	flipbookCycleMs,
	registerFlipbooks,
} from '../../packages/engine-layout/src/lib/registerFlipbooks';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const SHEET = 'borut/book_of_borut/manifests/atlas_manifest_fx.json';
const node = (over: Partial<FlipbookNode> = {}): FlipbookNode => ({
	id: 'n_clip',
	kind: 'flipbook',
	clipId: 'boom',
	x: 100,
	y: 200,
	...over,
});

console.log('flipbook scene node — the doc normalizer accepts the kind');
// The ONE list `editorStorage.ts` builds its accepted-kind Set from. A union member missing here is
// a node kind that vanishes on save, so assert every kind we ship is present.
const kinds = new Set<string>(LAYOUT_NODE_KINDS);
for (const kind of [
	'container',
	'sprite',
	'spine',
	'text',
	'rect',
	'componentInstance',
	'reelGrid',
	'effect',
	'flipbook',
	'repeater',
]) {
	assert(kinds.has(kind), `LAYOUT_NODE_KINDS carries "${kind}"`);
}
assert(kinds.size === LAYOUT_NODE_KINDS.length, 'LAYOUT_NODE_KINDS has no duplicate entries');

console.log('flipbook scene node — resolveTransform surfaces the SIZE box');
{
	const sized = resolveTransform(node({ width: 320, height: 180 }), 'desktop');
	assert(sized.width === 320 && sized.height === 180, 'base width/height reach the transform');
	const unsized = resolveTransform(node(), 'desktop');
	assert(
		unsized.width === undefined && unsized.height === undefined,
		'an unsized clip stays unsized (renders at the frames native size)',
	);
	const overridden = resolveTransform(
		node({ width: 320, overrides: { portrait: { width: 160 } } }),
		'portrait',
	);
	assert(overridden.width === 160, 'a per-layoutType width override wins');
	const tinted = resolveTransform(node({ tint: 0xff0000 }), 'desktop');
	assert(tinted.tint === 0xff0000, 'tint reaches the transform (the sprite path)');
}

console.log('flipbook scene node — cycle length + the loop rule');
clearFlipbooks();
registerFlipbooks([
	{ id: 'boom', name: 'Boom', assetKey: SHEET, frames: ['f1', 'f2', 'f3'], fps: 30, loop: false },
	{ id: 'flame', name: 'Flame', assetKey: SHEET, frames: ['a', 'b'], fps: 20 },
]);
assert(flipbookCycleMs('boom') === 100, 'a one-shot clip reports frames/fps in ms (3 @ 30fps)');
assert(
	flipbookCycleMs('flame') === undefined,
	'a LOOPING clip reports nothing — a loop has no end to wait for',
);
assert(
	flipbookCycleMs('flame', false) === 100,
	"a placement's loop:false override makes a looping clip measurable (2 @ 20fps)",
);
assert(
	flipbookCycleMs('boom', true) === undefined,
	"a placement's loop:true override silences a one-shot clip",
);
assert(flipbookCycleMs('nope') === undefined, 'a dangling clipId reports nothing, never throws');

console.log('flipbook scene node — the scene duration walk reaches it');
{
	const scene: Scene = {
		id: 's1',
		name: 'Screen',
		nodes: [
			node({ id: 'top', clipId: 'boom', loop: false }),
			{
				id: 'group',
				kind: 'container',
				x: 0,
				y: 0,
				children: [node({ id: 'nested', clipId: 'flame', loop: false })],
			} as LayoutNode,
		],
	};
	const ms = sceneAnimationDurationMs(scene, {
		spineClipMs: () => undefined,
		effectMs: () => undefined,
		flipbookMs: flipbookCycleMs,
		resolveComponent: () => undefined,
	});
	assert(ms === 100, 'the LONGEST placed clip defines the screen (nested ones counted too)');

	// The seam is optional — a game that never supplies it must not crash the walk.
	const noResolver = sceneAnimationDurationMs(scene, {
		spineClipMs: () => undefined,
		effectMs: () => undefined,
		resolveComponent: () => undefined,
	});
	assert(noResolver === 0, 'a missing flipbookMs resolver degrades to 0, not a throw');

	const loopingOnly: Scene = { id: 's2', name: 'Ambient', nodes: [node({ clipId: 'flame' })] };
	assert(
		sceneAnimationDurationMs(loopingOnly, {
			spineClipMs: () => undefined,
			effectMs: () => undefined,
			flipbookMs: flipbookCycleMs,
			resolveComponent: () => undefined,
		}) === 0,
		'an ambient looping clip never becomes the screens animation length',
	);
}

clearFlipbooks();

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK SCENE NODE: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK SCENE NODE: PASSED');
