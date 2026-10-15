/**
 * Guard how the Scene / Component Editor splits a screen into DEPTH SEGMENTS, offline.
 *
 * Run: `pnpm --filter launcher-api run check:depth-segments`
 *
 * WHY. The editor draws each kind on its own surface (2D → rig → text → FX), so inside one stack an
 * FX always draws over every sprite, rig and text. The game draws one scene graph in outline order.
 * `depthSegments` starts a new stack at the first node with other art after an FX, which puts that
 * art back above the FX. A wrong split is invisible in a build: too few segments and an FX covers
 * art the game draws over it, too many and a screen spends WebGL contexts it does not need.
 *
 * Load-bearing rules:
 *
 *  1. **A screen with no FX ahead of other art is ONE segment keyed by the scene id**, so its
 *     surfaces and report keys are exactly what they were before segments existed.
 *  2. **Only OTHER art after an FX splits.** Consecutive FX share a segment, and an FX that ends the
 *     outline adds none.
 *  3. **Nesting counts both ways.** A container or component instance that holds an FX makes the
 *     segment an FX one; one that holds only FX does not split from the FX before it.
 *  4. **A missing component def still draws** (its placeholder), so it splits like art.
 */
import type { ComponentDef, LayoutNode, Scene } from 'engine-layout';

import { depthSegments } from '../src/routes/(app)/editor/editorCanvas.helpers';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};

const sprite = (id: string): LayoutNode => ({ kind: 'sprite', id, x: 0, y: 0, assetKey: id });
const fx = (id: string): LayoutNode => ({ kind: 'effect', id, x: 0, y: 0, effectId: id });
const text = (id: string): LayoutNode => ({ kind: 'text', id, x: 0, y: 0, text: id });
const group = (id: string, children: LayoutNode[]): LayoutNode => ({
	kind: 'container',
	id,
	x: 0,
	y: 0,
	children,
});
const instance = (id: string, componentId: string): LayoutNode => ({
	kind: 'componentInstance',
	id,
	x: 0,
	y: 0,
	componentId,
});
const def = (id: string, children: LayoutNode[]): ComponentDef => ({
	id,
	name: id,
	version: 1,
	scope: 'project',
	category: 'scenery',
	root: { kind: 'container', id: `${id}_root`, x: 0, y: 0, children },
});

const scene = (nodes: LayoutNode[]): Scene => ({ id: 's', name: 's', nodes });
const defs = new Map<string, ComponentDef>([
	['glowOnly', def('glowOnly', [fx('g1'), fx('g2')])],
	['badge', def('badge', [sprite('b1'), fx('b2')])],
]);
/** Each segment's node ids, `|` between segments. */
const split = (nodes: LayoutNode[]): string =>
	depthSegments(scene(nodes), defs)
		.map((seg) => seg.nodes.map((n) => n.id).join(','))
		.join('|');

// 1. One segment, keyed by the scene id, whenever nothing is drawn after an FX.
const plain = depthSegments(scene([sprite('bg'), text('t'), fx('glow')]), defs);
check('FX last ⇒ one segment', plain.length === 1);
check('the one segment is keyed by the scene id', plain[0].key === 's');
check('the one segment is whole', plain[0].whole);
check('no FX ⇒ one segment', split([sprite('a'), text('b')]) === 'a,b');
check('an empty screen is one empty segment', split([]) === '');

// 2. Other art after an FX starts a new segment; FX runs and a trailing FX do not.
check(
	'art after an FX splits',
	split([sprite('bg'), fx('glow'), sprite('frame')]) === 'bg,glow|frame',
);
check(
	'consecutive FX share a segment',
	split([sprite('bg'), fx('f1'), fx('f2'), text('t')]) === 'bg,f1,f2|t',
);
check(
	'each FX followed by art splits again',
	split([fx('f1'), sprite('a'), fx('f2'), sprite('b'), fx('f3')]) === 'f1|a,f2|b,f3',
);
const two = depthSegments(scene([sprite('bg'), fx('glow'), sprite('frame')]), defs);
check('later segments are keyed <sceneId>#seg<i>', two[1]?.key === 's#seg1');
check(
	'a split screen has no whole segment',
	two.every((seg) => !seg.whole),
);
check(
	'every segment names its scene',
	two.every((seg) => seg.sceneId === 's'),
);

// 3. Nesting: FX inside a group or a component, and groups/components of FX only.
check(
	'a group holding an FX makes its segment an FX one',
	split([group('g', [sprite('in'), fx('inFx')]), sprite('after')]) === 'g|after',
);
check(
	'a group of FX only does not split from the FX before it',
	split([fx('f'), group('g', [fx('x'), fx('y')]), sprite('after')]) === 'f,g|after',
);
check(
	'a component of FX only does not split from the FX before it',
	split([fx('f'), instance('i', 'glowOnly'), sprite('after')]) === 'f,i|after',
);
check(
	'a component with art and an FX splits after an FX and carries one',
	split([fx('f'), instance('i', 'badge'), sprite('after')]) === 'f|i|after',
);
check(
	'a bound anchor draws its own preview, so it splits like art',
	split([fx('f'), { ...group('hud', []), bind: { component: 'balance' } }]) === 'f|hud',
);
check(
	'an empty group after an FX draws nothing, so it does not split',
	split([fx('f'), group('g', []), sprite('after')]) === 'f,g|after',
);

// 4. A missing def still draws its placeholder.
check(
	'a missing component def splits like art',
	split([fx('f'), instance('i', 'missing')]) === 'f|i',
);

if (fails > 0) {
	console.error(`\ncheck:depth-segments — ${fails} failure(s)`);
	process.exit(1);
}
console.log('check:depth-segments — OK');
