/**
 * Generic doc-driven scene mounting (§20.1) headless harness for the PURE scene-selection
 * logic (`engine-layout/genericMountScenes`). The live WebGL pixels (an author's new screen
 * appearing in the shipped game) are not browser-verifiable here, so — exactly as the sibling
 * spikes do (bg-scene/fx/flow) — we cover the selection contract OFFLINE, in Node:
 *
 *   pnpm --filter generic-mount-spike run select
 *
 * Proves: (1) `apps/lines`' `defaultLayout('lines')` with the FULL reserved-id set →
 * `extraMountScenes` is EMPTY (apps/lines PARITY: nothing extra mounts, byte-identical to
 * main); (2) an authored extra scene (custom id, non-background space) IS selected; (3) a
 * reserved id is NOT selected; (4) a `space:'background'` scene is NOT selected (handled by
 * `backgroundScenes`); (5) doc order is preserved across multiple extras.
 */

// Import the source module directly (not the `engine-layout` barrel) so tsx resolves pure-TS
// deps only — the barrel re-exports `constants-shared/layout`, whose subpath raw-TS export
// tsx can't load without transpile (the sibling spikes dodge this the same way).
import { extraMountScenes } from '../../packages/engine-layout/src/lib/genericMountScenes';
import type { LayoutDoc, Scene } from '../../packages/engine-layout/src/lib/types';
import { defaultLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/lines';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

// The reserved set Game.svelte uses: every scene id the game already mounts/handles by
// hard-coded id (incl. the coded `background` anchor + the HUD scenes), kept in sync with
// `RESERVED_SCENE_IDS` in apps/lines/src/components/Game.svelte.
const RESERVED = new Set<string>([
	'basegame',
	'basegameOverlays',
	'freeSpinIntro',
	'freeSpinIntroVisual',
	'freeSpinCounter',
	'freeSpinOutro',
	'freeSpinOutroVisual',
	'specialBook',
	'hudBar',
	'hudCorners',
	'loading',
	'background',
]);

// ---------------------------------------------------------------------------
// 1. apps/lines parity — the reference doc mounts no EXTRA scene.
// ---------------------------------------------------------------------------
console.log('generic-mount — apps/lines parity (defaultLayout("lines"))');
const lines: LayoutDoc = defaultLayout('lines');
const linesExtra = extraMountScenes(lines.scenes, RESERVED);
assert(
	linesExtra.length === 0,
	`no extra scene selected (all ids reserved) → got [${linesExtra.map((s) => s.id).join(', ')}]`,
);

// ---------------------------------------------------------------------------
// 2. An authored extra scene (custom id, non-background space) IS selected.
// ---------------------------------------------------------------------------
console.log('generic-mount — authored extra screen is selected');
const authored: Scene = {
	id: 'hud_xxk3a9',
	name: 'New HUD screen',
	space: 'game',
	nodes: [{ id: 'art', kind: 'sprite', assetKey: 'badge.png', x: 0, y: 0 }],
};
const docWithExtra: LayoutDoc = { ...lines, scenes: [...lines.scenes, authored] };
const extra = extraMountScenes(docWithExtra.scenes, RESERVED);
assert(extra.length === 1 && extra[0].id === 'hud_xxk3a9', 'the authored extra scene is selected');

// ---------------------------------------------------------------------------
// 3. A reserved id is NOT selected (even if duplicated in the doc).
// ---------------------------------------------------------------------------
console.log('generic-mount — reserved id is not selected');
const reservedExtra: Scene = {
	id: 'basegame',
	name: 'basegame dup',
	space: 'game',
	nodes: [],
};
const docWithReserved: LayoutDoc = { ...lines, scenes: [...lines.scenes, reservedExtra] };
assert(
	extraMountScenes(docWithReserved.scenes, RESERVED).every((s) => s.id !== 'basegame'),
	'a reserved id (basegame) is never selected',
);

// ---------------------------------------------------------------------------
// 4. A `space:'background'` scene is NOT selected (handled by backgroundScenes).
// ---------------------------------------------------------------------------
console.log('generic-mount — background-space scene is not selected');
const bg: Scene = {
	id: 's_bgeiqt79',
	name: 'New background screen',
	space: 'background',
	nodes: [{ id: 'art', kind: 'sprite', assetKey: 'my_bg.png', x: 0, y: 0 }],
};
const docWithBg: LayoutDoc = { ...lines, scenes: [...lines.scenes, bg] };
assert(
	extraMountScenes(docWithBg.scenes, RESERVED).every((s) => s.space !== 'background'),
	'a `space:"background"` scene is excluded (handled elsewhere)',
);

// ---------------------------------------------------------------------------
// 5. Doc order is preserved across multiple extras.
// ---------------------------------------------------------------------------
console.log('generic-mount — multiple extras keep doc order');
const first: Scene = { id: 'extra_a', name: 'A', space: 'game', nodes: [] };
const second: Scene = { id: 'extra_b', name: 'B', space: 'canvas', nodes: [] };
const third: Scene = { id: 'extra_c', name: 'C', space: 'standard', nodes: [] };
// Interleave with a background + a reserved id to prove they're filtered out without
// disturbing the surviving order.
const docMulti: LayoutDoc = {
	...lines,
	scenes: [first, bg, second, reservedExtra, third, ...lines.scenes],
};
const order = extraMountScenes(docMulti.scenes, RESERVED).map((s) => s.id);
assert(
	order.length === 3 && order[0] === 'extra_a' && order[1] === 'extra_b' && order[2] === 'extra_c',
	`three extras returned in doc order → [${order.join(', ')}]`,
);

// ---------------------------------------------------------------------------
console.log('');
if (failures === 0) {
	console.log('generic-mount — ALL GREEN');
} else {
	console.error(`generic-mount — ${failures} FAILURE(S)`);
	process.exit(1);
}
