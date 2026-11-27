/**
 * Offline fixture for the `?perf=1` scene sample (`sceneProbe.ts`) — run with:
 *   pnpm check:all --only sceneProbe
 *
 * Pins: nodes, renderables, drawn and culled counted by top-level layer; a node hidden by
 * `visible` or `renderable` hides everything under it; filters and render groups counted; a
 * render-group layer carries its cost and the stage's own share is the frame's less theirs; the
 * walk reads the tree without recursion (a 60,000-sprite layer).
 */

import { sampleScene, type SceneCost, type SceneNode } from './sceneProbe.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

class Container {
	constructor(
		public label = '',
		public children: SceneNode[] = [],
		props: Partial<SceneNode> = {},
	) {
		Object.assign(this, props);
	}
	visible = true;
	renderable = true;
}
class Sprite extends Container {
	renderPipeId = 'sprite';
	constructor(visible = true) {
		super();
		this.visible = visible;
	}
}
const sprites = (n: number, hiddenEvery = 0) =>
	Array.from({ length: n }, (_, i) => new Sprite(!hiddenEvery || i % hiddenEvery !== 0));

const river = new Container('river', sprites(1000, 4), { isRenderGroup: true });
const hiddenGroup = new Container('', [new Sprite(), new Sprite()], { visible: false });
const bodies = new Container('bodies', [new Sprite(), hiddenGroup, new Sprite()], {
	filters: [{}],
});
const stage = new Container('stage', [river, bodies, new Container()]);

const none = new Map<SceneNode, SceneCost>();
const frame: SceneCost = { draws: 50, passes: 9, filterPasses: 6, targetSwitches: 14 };
let clock = 0;
const s = sampleScene(stage, none, frame, () => (clock += 0.4));

const layer = (label: string) => s.layers.find((l) => l.label === label);
check(
	'a layer is counted by its nodes, renderables, drawn and culled',
	layer('river')?.nodes === 1001 &&
		layer('river')?.renderables === 1000 &&
		layer('river')?.visible === 750 &&
		layer('river')?.culled === 250,
	JSON.stringify(layer('river')),
);
check(
	'a hidden node hides what is under it',
	layer('bodies')?.renderables === 4 &&
		layer('bodies')?.visible === 2 &&
		layer('bodies')?.culled === 2,
	JSON.stringify(layer('bodies')),
);
check(
	'filters and render groups are counted',
	layer('bodies')?.filters === 1 && s.renderGroups === 1,
);
check(
	'a layer with no label is named by its place',
	s.layers[2].label === 'layer 2',
	JSON.stringify(s.layers[2]),
);
check(
	'the totals add up, the stage counted too',
	s.nodes === 1 + 1001 + 6 + 1 && s.renderables === 1004 && s.visible === 752 && s.culled === 252,
	JSON.stringify(s),
);
check('the walk is timed', s.walkMs === 0.4);
check(
	'with no layer cost, the stage’s own share is the whole frame',
	s.rest?.draws === 50 && s.rest.passes === 9 && s.layers.every((l) => !l.cost),
);

const costs = new Map<SceneNode, SceneCost>([
	[river, { draws: 12, passes: 1, filterPasses: 0, targetSwitches: 0 }],
]);
const withCost = sampleScene(stage, costs, frame, () => 0);
check(
	'a render-group layer carries its cost; the stage’s share is the frame’s less theirs',
	withCost.layers[0].cost?.draws === 12 &&
		withCost.rest?.draws === 38 &&
		withCost.rest.passes === 8 &&
		withCost.rest.filterPasses === 6,
	JSON.stringify(withCost),
);

const big = new Container('big', [new Container('', sprites(60000))]);
const huge = sampleScene(new Container('s', [big]), none, frame, () => 0);
check('a 60,000-sprite layer is walked without recursion', huge.renderables === 60000);

const off = new Container('off', sprites(3), { renderable: false });
const offSample = sampleScene(new Container('s', [off]), none, frame, () => 0);
check(
	'renderable false hides a layer too',
	offSample.layers[0].culled === 3 && offSample.visible === 0,
);

if (failures) throw new Error(`sceneProbe.fixture: ${failures} check(s) failed`);
console.log('\nsceneProbe.fixture: all ok');
