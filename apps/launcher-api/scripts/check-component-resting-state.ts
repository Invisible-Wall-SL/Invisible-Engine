/**
 * Guard that the editors draw a rig inside a component on the art its state machine rests on, as
 * the game does, offline.
 *
 * Run: `pnpm --filter launcher-api check:component-resting-state`
 *
 * WHY. The owner's Hold and Win "TotalWin Widget" (2026-10-23): the R_Widget jackpot frame rests on
 * its `Grand` animation, and the widget's state machine enters `mini`, whose timeline keys the
 * frame's `mini` tier. The game layers the state's animation strip over the rig's own animation
 * (`withTimelineScrub` in `LayoutNodeView`), so it drew the teal `mini` plate. Both editors drew
 * the gold `Grand` frame: they ignored the machine outside Animate.
 *
 * Load-bearing rules:
 *
 *  1. **A rig rests on its def's settled state** (`restingStateStrip`): the entry state's strip at
 *     its inputs' defaults, the state a default input moves the machine to, and nothing for a rig
 *     no state keys, a def with no machine, or timelines not loaded yet.
 *  2. **The rig layer previews that strip under a timeline preview** (source-scanned): every rig
 *     target, top-level and nested, is posed with its def's resting strip, a previewed timeline
 *     (Animate) wins over it, and the Component Editor hands the canvas its open draft so the
 *     draft's own machine rests the stage's rigs.
 */
import { readFileSync } from 'node:fs';

import type { CinematicDoc, ComponentDef, LayoutNode } from 'engine-layout';

const SP = await import('../src/lib/timeline/segmentPreview.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error('FAIL:', name);
	}
};

// ── 1. the resting strip ────────────────────────────────────────────────────────────────────────

const RIG = 'n_widget';
const rig = {
	id: RIG,
	label: 'R_Widget',
	kind: 'spine',
	x: 0,
	y: 0,
	assetKey: 'p/spines/R_Widget/',
	defaultAnimation: 'Grand',
	loop: true,
} as LayoutNode;
/** A looping tier timeline keying the frame's `tier` animation. */
const tierTimeline = (tier: string): CinematicDoc =>
	({
		...S.newComponentTimeline({ id: `t_${tier}`, name: tier, componentId: 'widget' }),
		duration: 2,
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target: 'R_Widget', place: {} }] },
		tracks: [
			{
				id: 'anim',
				kind: 'animation',
				actorId: 'a',
				strips: [{ id: 's', clip: { src: 'rig', name: tier }, start: 0, length: 2, clipIn: 0 }],
			},
		],
	}) as unknown as CinematicDoc;
const docs = [tierTimeline('mini'), tierTimeline('big')];
const widget = (contentDefault: number): ComponentDef => ({
	id: 'widget',
	name: 'TotalWin Widget',
	version: 1,
	scope: 'project',
	category: 'ui',
	root: { id: 'root', kind: 'container', x: 0, y: 0, children: [rig] },
	params: [],
	inputs: [{ id: 'Content', kind: 'number', default: contentDefault, source: 'featureTotal' }],
	stateMachine: {
		layers: [
			{
				id: 'main',
				name: 'Main',
				entry: 'mini',
				states: [
					{ id: 'mini', timeline: 't_mini' },
					{ id: 'big', timeline: 't_big' },
				],
				transitions: [
					{
						id: 'up',
						from: 'mini',
						to: 'big',
						conditions: [{ input: 'Content', op: '>', value: 5 }],
					},
				],
			},
		],
	},
});

check(
	'the entry state’s tier: a frame resting on Grand draws mini (what the game draws)',
	SP.restingStateStrip(widget(0), docs, {}, RIG)?.animation === 'mini',
);
check(
	'an input default past a threshold settles on that state’s tier',
	SP.restingStateStrip(widget(10), docs, {}, RIG)?.animation === 'big',
);
check(
	'a node no state keys rests on nothing',
	SP.restingStateStrip(widget(0), docs, {}, 'other') === undefined,
);
check(
	'a def with no state machine rests on nothing (its own animation shows)',
	SP.restingStateStrip({ ...widget(0), stateMachine: undefined }, docs, {}, RIG) === undefined,
);
check(
	'timelines not loaded yet rest on nothing',
	SP.restingStateStrip(widget(0), [], {}, RIG) === undefined,
);

// ── 2. the rig layer previews it (source-scanned) ───────────────────────────────────────────────

const editor = (file: string): string =>
	readFileSync(new URL(`../src/routes/(app)/editor/${file}`, import.meta.url), 'utf8');
const layer = editor('EditorRigLayer.svelte');
check(
	'a previewed timeline wins over the resting strip',
	/withTimelineScrub\(\s*boundScrubs\(node\.valueBindings, outputs\),\s*previewAnimTime\(node\) \?\? resting,\s*\)/.test(
		layer,
	),
);
check(
	'a top-level rig rests on the open def’s machine',
	layer.includes('pose: previewPose(n, restingStrip(componentNest.def, n.id, componentParams)),'),
);
check(
	'a nested rig rests on the machine of the def it is in',
	layer.includes(
		'pose: previewPose(node, restingStrip(stateDef, node.id, instanceParams ?? componentParams)),',
	) &&
		layer.includes(
			'out.push(nestedRigTarget(n, sc, nextChain, instanceParams, rigRests, stateDef));',
		),
);
check(
	'every walk into a def hands the def on, and a group passes its own on',
	/previewing\?\.animation,\s*def,\s*\);/.test(layer) &&
		/n\.spineRestOverrides,\s*undefined,\s*def,\s*\);/.test(layer) &&
		/undefined,\s*componentNest\.def,\s*\);/.test(layer) &&
		/undefined,\s*stateDef,\s*\);/.test(layer),
);
check('every rig pose goes through the resting strip', !/previewPose\((?:n|node)\)/.test(layer));
check(
	'the Component Editor hands the canvas its open draft',
	editor('ComponentWorkspace.svelte').includes(
		'componentNest={componentEditorNest(trail, componentDraft)}',
	),
);

console.log(`component resting state: ${passes} passed, ${fails} failed`);
if (fails > 0) process.exit(1);
