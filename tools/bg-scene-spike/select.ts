/**
 * Persistent-background selection (§ persistent-bg-scene) headless harness for the PURE
 * scene-selection + suppression logic (`engine-layout/backgroundScenes`). The live WebGL
 * pixels (the authored full-bleed art behind the game) are not browser-verifiable here, so
 * — exactly as the sibling spikes do — we cover the selection contract OFFLINE, in Node:
 *
 *   pnpm --filter bg-scene-spike run select
 *
 * Proves: (1) `apps/lines`' `defaultLayout('lines')` ships NO `space:'background'` scene ⇒
 * empty selection + no suppression ⇒ the coded `<Background>` stays (apps/lines PARITY);
 * (2) the coded id-`background` / `space:'canvas'` spine-anchor scene (bookof reference) is
 * NOT selected and does NOT suppress (the existing coded-spine cover path keeps working);
 * (3) an authored `space:'background'` scene with a real sprite IS selected AND suppresses
 * the coded background; (4) multiple background scenes return in doc order (lowest first);
 * (5) an anchor-only `space:'background'` scene (only a `Background` bind) is selected but
 * does NOT suppress (it has no real content to replace the spine).
 */

// Import the source modules directly (not the `engine-layout` barrel) so tsx resolves
// pure-TS deps only — the barrel re-exports `constants-shared/layout`, whose subpath
// raw-TS export tsx can't load without transpile (the fx-spike dodges this the same way).
import {
	backgroundScenes,
	hasAuthoredBackground,
} from '../../packages/engine-layout/src/lib/backgroundScenes';
import type { LayoutDoc, Scene } from '../../packages/engine-layout/src/lib/types';
import { defaultLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/lines';
import { bookofReferenceLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/bookof';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

// ---------------------------------------------------------------------------
// 1. apps/lines parity — the reference doc ships no background scene.
// ---------------------------------------------------------------------------
console.log('bg-scene — apps/lines parity (defaultLayout("lines"))');
const lines: LayoutDoc = defaultLayout('lines');
assert(backgroundScenes(lines.scenes).length === 0, 'no `space:"background"` scene selected');
assert(!hasAuthoredBackground(lines.scenes), 'no suppression ⇒ coded <Background> stays (parity)');

// ---------------------------------------------------------------------------
// 2. Coded id-`background` spine anchor (space:'canvas') is NOT a persistent bg.
// ---------------------------------------------------------------------------
console.log('bg-scene — coded `background`-id / canvas spine anchor is not selected');
const bookof: LayoutDoc = bookofReferenceLayout();
const codedBg = bookof.scenes.find((s) => s.id === 'background');
assert(!!codedBg, 'bookof reference HAS a `background`-id scene');
assert(codedBg?.space === 'canvas', '…and it is `space:"canvas"` (drives the coded <Background>)');
assert(
	backgroundScenes(bookof.scenes).length === 0,
	'the canvas anchor is NOT selected as a persistent background',
);
assert(
	!hasAuthoredBackground(bookof.scenes),
	'the canvas anchor does NOT suppress the coded background (coded cover path keeps working)',
);

// ---------------------------------------------------------------------------
// 3. Authored `space:'background'` sprite scene IS selected + suppresses.
// ---------------------------------------------------------------------------
console.log('bg-scene — authored background sprite scene');
const authoredSprite: Scene = {
	id: 's_bgeiqt79',
	name: 'New background screen',
	space: 'background',
	nodes: [{ id: 'art', kind: 'sprite', assetKey: 'my_bg.png', x: 0, y: 0 }],
};
const docWithBg: LayoutDoc = { ...lines, scenes: [authoredSprite, ...lines.scenes] };
assert(backgroundScenes(docWithBg.scenes).length === 1, 'the authored bg scene is selected');
assert(
	backgroundScenes(docWithBg.scenes)[0].id === 's_bgeiqt79',
	'selection is the authored scene',
);
assert(hasAuthoredBackground(docWithBg.scenes), 'real content ⇒ suppresses the coded <Background>');

// ---------------------------------------------------------------------------
// 4. Multiple background scenes return in doc order (lowest first).
// ---------------------------------------------------------------------------
console.log('bg-scene — multiple background scenes keep doc order');
const second: Scene = {
	id: 's_bg_second',
	name: 'Second background',
	space: 'background',
	nodes: [{ id: 'art2', kind: 'sprite', assetKey: 'b.png', x: 0, y: 0 }],
};
const multi: LayoutDoc = { ...lines, scenes: [authoredSprite, second, ...lines.scenes] };
const picked = backgroundScenes(multi.scenes).map((s) => s.id);
assert(
	picked.length === 2 && picked[0] === 's_bgeiqt79' && picked[1] === 's_bg_second',
	'two background scenes selected in doc order (lowest first)',
);

// ---------------------------------------------------------------------------
// 5. Anchor-only background scene is selected but does NOT suppress.
// ---------------------------------------------------------------------------
console.log('bg-scene — anchor-only background scene does not suppress');
const anchorOnly: Scene = {
	id: 's_bg_anchor',
	name: 'Anchor-only',
	space: 'background',
	nodes: [
		{ id: 'bg', kind: 'container', x: 0, y: 0, bind: { component: 'Background' }, children: [] },
	],
};
const anchorDoc: LayoutDoc = { ...lines, scenes: [anchorOnly, ...lines.scenes] };
assert(backgroundScenes(anchorDoc.scenes).length === 1, 'anchor-only scene IS selected');
assert(
	!hasAuthoredBackground(anchorDoc.scenes),
	'anchor-only scene does NOT suppress (no real content to replace the spine)',
);

// ---------------------------------------------------------------------------
console.log('');
if (failures === 0) {
	console.log('bg-scene — ALL GREEN');
} else {
	console.error(`bg-scene — ${failures} FAILURE(S)`);
	process.exit(1);
}
