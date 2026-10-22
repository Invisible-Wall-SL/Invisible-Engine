/**
 * Guard that the Scene Editor draws a placed component, and the rigs inside it, the way the game
 * does, offline.
 *
 * Run: `pnpm --filter launcher-api check:editor-instance-parity`
 *
 * WHY. The owner's Jackpots bar (`commonoverlayproject`, 2026-10-22): four placements of one jackpot
 * frame rig (`R_Widget`, a tier animation each: Mini, Minor, Major, Grand) under the jackpot tiles'
 * texts. In the editor every frame looked alike and sat round its value; in the game each frame had
 * its tier's colours and parts, and sat about 15 px lower, under the value. Two causes:
 *  - the screen's placement pinned the component at v1 (rigs at y 19.5), while it had since been
 *    saved at v3 (rigs moved up to y 4 after the rig's origin was centred). The game draws the
 *    version a placement pins (`resolveComponent`, the bake ships it); every editor renderer
 *    resolved the instance by its bare id, so the latest def;
 *  - the rig layer held a rig that was not playing on its SETUP pose. The game never shows that
 *    pose for a rig with a resting animation: it plays it, and the tier animations key the frame's
 *    colours and which parts show. The rig layer also ignored a placement's `spineRestOverrides`
 *    and a param-bound `defaultAnimation`, which pick that animation in the game.
 *
 * Load-bearing rules:
 *
 *  1. **A pinned placement resolves its pinned version** (`instanceDef`) when the map holds it; a
 *     pin at the latest, no pin, or a pin the map lacks resolves the latest (the game's fallback).
 *  2. **The selection box and the depth split measure the pinned version** (`nodeBox`,
 *     `depthSegments`): the reported Jackpots frame at v1's rig, not v3's.
 *  3. **No renderer resolves a placement by its bare id** (source-scanned): every
 *     `componentMap.get(<node>.componentId)` left in the editor's renderers is a repeater's.
 *  4. **The page loads each older pinned version into the map**: the loader reads a pin once,
 *     hands on only the exact version, never asks again for one the store lacks and retries one
 *     whose read failed; the page asks for every older pin and maps it (source-scanned).
 *  5. **A rig rests on the game's animation** (`restingRigPose`): the placement's rest wins, then
 *     a param-bound one, then the node's; an empty or wrongly typed bound value falls through.
 *  6. **A still rig draws its resting pose** (`applyRestingPose`, over the real `engine-rig`): a
 *     loop at its first frame, a one-shot at its last; an unknown or absent animation leaves the
 *     setup pose; the undo returns the setup pose.
 *  7. **An outdated placement is flagged whatever its scope** (`componentUpdateAvailable`): the
 *     project's own components draw their pinned version too.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveTransform, type ComponentDef, type LayoutNode } from 'engine-layout';
import { AtlasAttachmentLoader, Skeleton, SkeletonJson, TextureAtlas } from 'engine-rig';

import { rigOriginAnchor, type RigBox } from 'constants-shared/rig';

import { componentUpdateAvailable } from '../src/lib/timeline/sharedTimelines';
import { createPinnedVersionLoader } from '../src/routes/(app)/editor/componentPins.client';
import {
	applyRestingPose,
	depthSegments,
	instanceDef,
	nodeBox,
	nodeCornersWorld,
	pinnedDefKey,
	restingRigPose,
	type NaturalSize,
} from '../src/routes/(app)/editor/editorCanvas.helpers';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error('FAIL:', name);
	}
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
/** World px through a chain of float transforms. */
const nearPx = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;

// ── The reported Jackpots bar, cut to one tier ─────────────────────────────────────────────────

type SpineNode = Extract<LayoutNode, { kind: 'spine' }>;
const frameRig = (y: number, extra: Partial<SpineNode> = {}): SpineNode => ({
	id: 'n_8ig0d18g',
	label: 'R_Widget',
	kind: 'spine',
	assetKey: 'invisible_wall/commonoverlayproject/spines/R_Widget/',
	x: -384,
	y,
	scale: { x: 0.2527039347315686, y: 0.2527039347315686 },
	defaultAnimation: 'Mini',
	loop: true,
	...extra,
});
const def = (id: string, version: number, children: LayoutNode[]): ComponentDef => ({
	id,
	name: id,
	version,
	scope: 'project',
	category: 'ui',
	root: { id: `${id}-root`, kind: 'container', x: 0, y: 0, children },
});
const V1 = def('c_crg7s0zv', 1, [frameRig(19.51)]);
const V3 = def('c_crg7s0zv', 3, [frameRig(3.9697142527484175)]);
const placement = (
	componentVersion?: number,
): Extract<LayoutNode, { kind: 'componentInstance' }> => ({
	id: 'n_h18wrtww',
	kind: 'componentInstance',
	label: 'Jackpots',
	componentId: 'c_crg7s0zv',
	...(componentVersion !== undefined ? { componentVersion } : {}),
	x: 960,
	y: 556.1752710587708,
	scale: { x: 0.7714226919794315, y: 0.7714226919794315 },
});

/** The map the page builds: the latest under the bare id, each older pin beside it. */
const pinnedMap = new Map<string, ComponentDef>([
	[V3.id, V3],
	[pinnedDefKey(V1.id, V1.version), V1],
]);
const latestOnly = new Map<string, ComponentDef>([[V3.id, V3]]);

// 1 ─ resolution
check('a v1 pin resolves v1 when the map holds it', instanceDef(pinnedMap, placement(1)) === V1);
check('a pin at the latest resolves the latest', instanceDef(pinnedMap, placement(3)) === V3);
check('an unpinned placement resolves the latest', instanceDef(pinnedMap, placement()) === V3);
check(
	'a pin the map lacks resolves the latest, as the game falls back',
	instanceDef(latestOnly, placement(1)) === V3 && instanceDef(pinnedMap, placement(2)) === V3,
);
check(
	'an unknown component resolves nothing',
	instanceDef(pinnedMap, { componentId: 'nope', componentVersion: 1 }) === undefined,
);
check('no map resolves nothing', instanceDef(undefined, placement(1)) === undefined);

// 2 ─ the box and the depth split measure the pinned def
/** R_Widget's authored box, centred on its origin. */
const WIDGET_BOX: RigBox = { x: -487.46, y: -255.8, width: 974.92, height: 511.61 };
const naturalSize = (node: LayoutNode): NaturalSize | null =>
	node.kind === 'spine'
		? { w: WIDGET_BOX.width, h: WIDGET_BOX.height, ...rigOriginAnchor(WIDGET_BOX) }
		: node.kind === 'sprite'
			? { w: 10, h: 10 }
			: null;
/** The placement's box top in world px. */
const boxTop = (node: LayoutNode, map: Map<string, ComponentDef>): number => {
	const t = resolveTransform(node, 'desktop');
	const box = nodeBox(node, t, naturalSize, map, 'desktop', undefined, undefined, {}, {});
	return Math.min(...nodeCornersWorld(t, box).map((p) => p.y));
};
const rigTop = (rigY: number): number =>
	556.1752710587708 + 0.7714226919794315 * (rigY - 0.2527039347315686 * (WIDGET_BOX.height / 2));
check(
	`the v1 placement selects at v1's rig (top ${boxTop(placement(1), pinnedMap).toFixed(2)}, want ${rigTop(19.51).toFixed(2)})`,
	nearPx(boxTop(placement(1), pinnedMap), rigTop(19.51)),
);
check(
	`an updated placement selects at v3's rig (top ${boxTop(placement(3), pinnedMap).toFixed(2)}, want ${rigTop(3.9697142527484175).toFixed(2)})`,
	nearPx(boxTop(placement(3), pinnedMap), rigTop(3.9697142527484175)),
);
// v1 drew an effect under its art, which splits the screen's depth; v2 dropped it.
const sparkle: LayoutNode = { id: 'fx', kind: 'effect', effectId: 'sparkle', x: 0, y: 0 };
const art: LayoutNode = { id: 'art', kind: 'sprite', assetKey: 'ui', x: 0, y: 0 };
const splitMap = new Map<string, ComponentDef>([
	['glow', def('glow', 2, [art])],
	[pinnedDefKey('glow', 1), def('glow', 1, [sparkle, art])],
]);
const segments = (componentVersion: number): number =>
	depthSegments(
		{
			id: 'jackpotBar',
			name: 'Jackpot bar',
			nodes: [
				{ id: 'g', kind: 'componentInstance', componentId: 'glow', componentVersion, x: 0, y: 0 },
			],
		},
		splitMap,
	).length;
check(
	`the depth split walks the pinned def (v1 ${segments(1)} segments, v2 ${segments(2)})`,
	segments(1) === 2 && segments(2) === 1,
);

// 3 ─ no renderer resolves a placement by its bare id
const EDITOR = fileURLToPath(new URL('../src/routes/(app)/editor/', import.meta.url));
const RENDERERS = [
	'EditorCanvas.svelte',
	'EditorRigLayer.svelte',
	'EditorTextLayer.svelte',
	'EditorEffectLayer.svelte',
	'editorCanvas.helpers.ts',
];
for (const file of RENDERERS) {
	const lines = readFileSync(EDITOR + file, 'utf8').split('\n');
	lines.forEach((line, i) => {
		if (!/componentMap\??\.get\(\s*(n|node)\.componentId\s*\)/.test(line)) return;
		const context = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
		// `instanceDef` itself reads the latest by the bare id.
		if (/export function instanceDef\(/.test(context)) return;
		check(
			`${file}:${i + 1} resolves a repeater, not a placement, by its bare id`,
			/repeater/i.test(context),
		);
	});
	check(
		`${file} resolves placements through instanceDef`,
		file === 'editorCanvas.helpers.ts' ||
			/instanceDef\(componentMap, (n|node)\)/.test(lines.join('\n')),
	);
}

// 4 ─ the page loads the pins into the map
/** A stand-in store: v1 of the Jackpots, a v2 it no longer holds, and one read that fails. */
const asked: string[] = [];
let failNext = false;
globalThis.fetch = (async (input: string | URL | Request) => {
	const url = new URL(String(input), 'http://launcher');
	asked.push(`${url.pathname}?${url.searchParams}`);
	const version = Number(url.searchParams.get('version'));
	if (failNext) {
		failNext = false;
		throw new TypeError('network');
	}
	if (version === 1) return Response.json(V1);
	if (version === 7) return Response.json(V3);
	return new Response('not found', { status: 404 });
}) as typeof fetch;
const loaded: ComponentDef[] = [];
const request = createPinnedVersionLoader('commonoverlayproject', (d) => loaded.push(d));
const settle = () => new Promise((r) => setTimeout(r, 0));
request('c_crg7s0zv', 1);
request('c_crg7s0zv', 1);
await settle();
check(
	`a pin is read once, from the project's store (${asked.join(', ')})`,
	asked.length === 1 &&
		asked[0] === '/api/editor/component?id=c_crg7s0zv&version=1&project=commonoverlayproject' &&
		loaded.length === 1 &&
		loaded[0].id === V1.id &&
		loaded[0].version === 1,
);
request('c_crg7s0zv', 2);
await settle();
request('c_crg7s0zv', 2);
await settle();
check('a version the store lacks is not asked again', asked.length === 2 && loaded.length === 1);
request('c_crg7s0zv', 7);
await settle();
check('a def that is not the version asked for is not handed on', loaded.length === 1);
failNext = true;
request('c_crg7s0zv', 5);
await settle();
request('c_crg7s0zv', 5);
await settle();
check('a read that failed is asked again', asked.length === 5);

const page = readFileSync(EDITOR + '+page.svelte', 'utf8');
check(
	'the page asks for every pin older than the latest',
	/collectComponentPins\(scenes/.test(page) &&
		/if \(latest !== pin\.version\) requestPinnedVersion\(pin\.id, pin\.version\)/.test(page),
);
check(
	'the page keeps each pinned version in the component map under pinnedDefKey',
	/m\.set\(pinnedDefKey\(def\.id, def\.version\), def\)/.test(page),
);

// 5 ─ the resting animation
const tile = frameRig(0, {
	defaultAnimation: 'Idle',
	loop: true,
	skin: 'gold',
	paramBindings: { defaultAnimation: 'tierAnim', loop: 'tierLoop' },
});
const same = (
	got: ReturnType<typeof restingRigPose>,
	want: ReturnType<typeof restingRigPose>,
): boolean => got.animation === want.animation && got.loop === want.loop && got.skin === want.skin;
check(
	'the node rests on its own animation',
	same(restingRigPose(tile, undefined, undefined), { animation: 'Idle', loop: true, skin: 'gold' }),
);
check(
	'a param-bound animation and loop win over the node',
	same(restingRigPose(tile, undefined, { tierAnim: 'Grand', tierLoop: false }), {
		animation: 'Grand',
		loop: false,
		skin: 'gold',
	}),
);
check(
	'the placement’s rest wins over the bound param',
	same(
		restingRigPose(
			tile,
			{ defaultAnimation: 'Red', loop: true, skin: 'blue' },
			{ tierAnim: 'Grand', tierLoop: false },
		),
		{ animation: 'Red', loop: true, skin: 'blue' },
	),
);
check(
	'an empty or wrongly typed bound value falls through to the node',
	same(restingRigPose(tile, undefined, { tierAnim: '', tierLoop: 'yes' }), {
		animation: 'Idle',
		loop: true,
		skin: 'gold',
	}),
);

// 6 ─ the still pose, over the real runtime
const RIG = {
	skeleton: { spine: '4.2', x: -50, y: -50, width: 100, height: 100 },
	bones: [{ name: 'root' }, { name: 'frame', parent: 'root' }],
	slots: [{ name: 'border', bone: 'frame' }],
	skins: [{ name: 'default', attachments: {} }],
	animations: {
		Mini: {
			slots: {
				border: {
					rgba: [
						{ time: 0, color: 'ff000000' },
						{ time: 1, color: 'ff0000ff' },
					],
				},
			},
			bones: { frame: { translate: [{ time: 0, x: 0, y: -40 }] } },
		},
		Intro: {
			slots: {
				border: {
					rgba: [
						{ time: 0, color: '00ff0000' },
						{ time: 2, color: '00ff00ff' },
					],
				},
			},
		},
	},
};
const skeleton = new Skeleton(
	new SkeletonJson(new AtlasAttachmentLoader(new TextureAtlas(''))).readSkeletonData(
		JSON.stringify(RIG),
	),
);
const border = () => skeleton.findSlot('border')!.color;
const frameBone = () => skeleton.findBone('frame')!;
skeleton.setToSetupPose();
check('the setup pose shows the border, white', border().a === 1 && border().g === 1);

let undo = applyRestingPose(skeleton, 'Mini', true);
check(
	'a looping rest holds its first frame: the tier hides the border and lowers the frame',
	border().a === 0 && border().r === 1 && border().g === 0 && frameBone().y === -40,
);
undo.forEach((u) => u());
check('the undo returns the setup pose', border().a === 1 && frameBone().y === 0);

undo = applyRestingPose(skeleton, 'Intro', false);
check(
	'a one-shot rest holds its last frame, where the game leaves it',
	near(border().a, 1) && border().r === 0 && border().g === 1,
);
undo.forEach((u) => u());

check(
	'no resting animation leaves the setup pose and undoes nothing',
	applyRestingPose(skeleton, undefined, true).length === 0 && border().a === 1,
);
check(
	'an animation the rig lacks leaves the setup pose and undoes nothing',
	applyRestingPose(skeleton, 'Grand', true).length === 0 && border().a === 1,
);

// 7 ─ the outdated flag
check(
	'a component pinned below its latest is flagged, whatever its scope',
	componentUpdateAvailable(1, { version: 3 }),
);
check(
	'a placement at the latest, or unpinned, is not',
	!componentUpdateAvailable(3, { version: 3 }) &&
		!componentUpdateAvailable(undefined, { version: 3 }),
);

console.log(`check:editor-instance-parity — ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
