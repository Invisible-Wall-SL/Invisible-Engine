// THE BRIDGE IS THE SEED PROP, DRAWN AS THE CODE BRIDGE WAS (`engine-layout` `propComponents.ts`;
// docs/design/arcade-prop-components.md §5, §7 P5). The code-drawn bridge is deleted (P5, owner §8
// Q6): `salmonsArt/river.ts` draws the seed's water and behind pieces from what the arcade runtime
// publishes (`arcadeProps.svelte.ts`, `propPlacement.ts` `placeSalmonsBridges`), and `<SpawnProps>`
// the deck cells among the players. Held to the code bridge's drawing as it was RECORDED before the
// deletion (`CODE_BRIDGE`, at c63f0be, where this gate proved the seed equal to the code), on
// Salmons' own levels, mirrored (as Salmons is) and not, every piece with its instructions (each
// fill and stroke: its colour, alpha and width, and every point of its path, at its place on
// screen):
// - the river's water (reflections and the pillars' reflections, in the code's order) and its
//   upright pieces (pillars at `Z.pillar` 400 and slopes at `Z.slope` 500 of the code's `zOf`) are
//   the recorded code's, and the seed's pieces as the runtime places them;
// - the deck cells, one per cell of every bridge, at the code's `amongZ` (`Z.deck` 1100), are the
//   recorded ones, and the river draws none of them itself;
// - the reflections' sway is the code shimmer's, cell by cell, frame by frame;
// - painted art: a project's copy of a water piece and of a pillar, with an atlas region and a
//   clip in place of the seed's drawing, is drawn by the river in the same layers, places and
//   order: each sprite with its node's anchor, size, rotation, alpha and tint, the clip played,
//   a hidden node left out, the seed's drawing of the copy's own `PropGraphic` nodes unchanged;
// - the slopes follow the collider: a near ramp of 3 (a number, or its `nearRamp` param) stands the
//   near slope's foot 3 cells out, where the rule's ramp starts, and runs it to the deck's end;
// - a character on the deck (`z > 0`) sorts over the deck cell it stands on, and under an `over`
//   piece anywhere on that cell; one under the deck (`z` 0) sorts under the cell when behind it.
//
// Run: pnpm check:prop-depth

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import { sampleChannel } from '../packages/engine-cinematic/src/cinematicEval.js';
import {
	ISO_PROJECTOR,
	ISO_PROJECTOR_MIRRORED,
	isoDepthOrder,
} from '../packages/engine-layout/src/lib/projection.ts';
import {
	BRIDGE_PROP_DEF,
	BRIDGE_PROP_TIMELINES,
	PROP_COMPONENTS,
	PROP_TIMELINES,
	SWAY_PER_SECOND,
} from '../packages/engine-layout/src/lib/propComponents.ts';
import { drawPropGraphic, propScalar } from '../packages/engine-layout/src/lib/propGraphic.ts';
import { riverElevation } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsElevation.ts';
import { placeSalmonsProp } from '../packages/engine-layout/src/lib/salmonsArt/propPlacement.ts';
import { compilePropShape } from '../packages/engine-mechanics/src/propShape.js';
import { bridgeDecks } from '../packages/engine-mechanics/src/salmonsRules.js';
import { salmonsGeometry as geometryOf } from '../packages/engine-mechanics/src/salmons.js';
import { resolvePropGraphic } from '../packages/engine-layout/src/lib/propGraphic.ts';
import { aloftDepth, deckLift } from '../packages/engine-layout/src/lib/salmonsArt/bridge.ts';
import { CELL, K } from '../packages/engine-layout/src/lib/salmonsArt/scale.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIXI = createRequire(join(ROOT, 'packages/engine-layout/package.json')).resolve('pixi.js');
const { AnimatedSprite, Container, Graphics, Sprite, Texture, TextureSource } = await import(
	pathToFileURL(PIXI.replace(/index\.js$/, 'index.mjs')).href
);
registerHooks({
	resolve: (specifier, context, next) =>
		/\/(worldDrawing|arcadeProps)\.svelte$/.test(specifier)
			? next(`${specifier}.ts`, context)
			: next(specifier, context),
});
const { registerProjectedLayer } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/worldDrawing.svelte.ts')).href
);
const { SALMONS_FIELD_LAYER } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts')).href
);
const { mountSalmonsRiver } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/salmonsArt/river.ts')).href
);
const { clearSpawnProps, publishBridges } = await import('./salmons/art-fingerprint.mjs');
const { setSpawnProps } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/arcadeProps.svelte.ts')).href
);
const { registerComponents } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/registerComponents.ts')).href
);
const { registerFlipbooks } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/registerFlipbooks.ts')).href
);
const { editorArtTextureKey } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/editorArtKey.ts')).href
);
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed++;
	} catch (e) {
		console.error(`FAIL  ${name}\n      ${e.message}`);
		process.exitCode = 1;
	}
};

const named = (label) =>
	new Texture({ source: new TextureSource({ width: 64, height: 64 }), label });
const round = (v) => Math.round(v * 1000) / 1000 + 0;

/** A drawing's instructions at `at` on screen: each fill and stroke with every path point moved. */
function drawn(g, at) {
	const move = (p) => {
		const d = p.data;
		if (p.action === 'rect')
			return ['rect', round(d[0] + at.x), round(d[1] + at.y), round(d[2]), round(d[3])];
		if (p.action === 'poly') {
			return ['poly', d[0].map((v, i) => round(v + (i % 2 ? at.y : at.x)))];
		}
		if (p.action === 'moveTo' || p.action === 'lineTo') {
			return [p.action, round(d[0] + at.x), round(d[1] + at.y)];
		}
		throw new Error(`no reading for the path action "${p.action}"`);
	};
	return g.context.instructions.map((i) => [
		i.action,
		i.data?.style?.color,
		round(i.data?.style?.alpha ?? 1),
		i.action === 'stroke' ? i.data?.style?.width : undefined,
		i.data?.path?.instructions?.map(move),
	]);
}
const firstColor = (g) => g.context.instructions[0]?.data?.style?.color;

/** The bridge's pieces of `river` drawn by `river.ts` from the published seed: its water, upright
 *  and among pieces. */
function riverBridge(river, projector) {
	const app = {
		renderer: { generateTexture: () => named('made'), screen: { width: 1e7, height: 1e7 } },
		ticker: { add: () => {}, remove: () => {} },
	};
	const art = { region: (name) => named(name), face: named('face'), cliff: named('cliff') };
	const into = new Container();
	const layer = new Container();
	const unregister = registerProjectedLayer(SALMONS_FIELD_LAYER, layer);
	const from = Texture.from;
	Texture.from = (source) => (source?.getContext ? named('canvas') : from.call(Texture, source));
	let mounted;
	publishBridges(river);
	try {
		mounted = mountSalmonsRiver(into, app, art, river, river.seed, projector);
	} finally {
		Texture.from = from;
		clearSpawnProps();
	}
	const [, , , , reflections, upright] = into.children;
	const graphics = (c) => c.children.filter((g) => g instanceof Graphics);
	const of = (list, colors) =>
		list
			.filter((g) => colors.includes(firstColor(g)))
			.map((g) => ({ z: g.zIndex, draw: drawn(g, g.position) }));
	const out = {
		water: of(graphics(reflections), [0x4a3020, 0x3a2412]),
		behind: of(graphics(upright), [0x5b3a20, 0x7a4f2a]),
		sorted: of(graphics(layer), [0x5b3a20]),
	};
	mounted.teardown();
	unregister();
	return out;
}

const defOf = (id) => PROP_COMPONENTS.find((d) => d.id === id);
const timelineOf = (id) => PROP_TIMELINES.find((t) => t.id === id);
/** A def's machines after their first evaluation, with the piece's held inputs and params: the
 *  state each layer is in (`==` conditions, the only ones the seed's pillar layers use). */
function settledStates(def, inputs, params) {
	const holds = (c) =>
		c.op === '==' && inputs[c.input] === (c.param !== undefined ? params[c.param] : c.value);
	return (def.stateMachine?.layers ?? []).map((layer) => {
		const to = layer.transitions.find(
			(t) => t.from === layer.entry && t.conditions?.length && t.conditions.every(holds),
		)?.to;
		return layer.states.find((s) => s.id === (to ?? layer.entry));
	});
}
/** Whether node `label` shows in those states (a visibility key at 0; unkeyed ⇒ shown). */
function shows(states, label) {
	let shown = true;
	for (const state of states) {
		for (const track of timelineOf(state.timeline)?.tracks ?? []) {
			if (track.kind === 'visibility' && track.actorId === label) shown = track.keys[0].visible;
		}
	}
	return shown;
}

/** The seed's pieces of `river`, drawn as the runtime draws them. */
function seedBridge(river, projector) {
	const elevation = riverElevation(river.waterfalls);
	const out = { water: [], behind: [], sorted: [] };
	(river.bridges ?? []).forEach((bridge, b) => {
		const zone = { id: `bridge${b}`, ...bridge };
		const lift = elevation.at(bridge.y + CELL / 2);
		for (const piece of placeSalmonsProp(BRIDGE_PROP_DEF, zone, b, lift)) {
			const def = defOf(piece.componentId);
			const params = Object.fromEntries((def.params ?? []).map((p) => [p.key, p.default]));
			Object.assign(params, piece.params);
			const states = settledStates(def, piece.inputValues ?? {}, params);
			const place = projector.project(piece.x, piece.y);
			const scope = { project: projector.project, param: (k) => params[k] };
			for (const node of def.root.children) {
				if (node.bind?.component !== 'PropGraphic' || !shows(states, node.label)) continue;
				const g = drawPropGraphic(new Graphics(), node.bind.props.ops, scope);
				const at = {
					x: place.x + node.x + propScalar(node.bind.props.x ?? 0, scope),
					y: place.y - lift + node.y + propScalar(node.bind.props.y ?? 0, scope),
				};
				const z =
					piece.band === 'behind'
						? piece.zIndex
						: piece.band === 'sorted'
							? isoDepthOrder(piece.x, piece.y, 0, piece.bias)
							: 0;
				out[piece.band].push({ z, draw: drawn(g, at) });
			}
		}
	});
	return out;
}

const byDepth = (list) =>
	[...list].sort(
		(a, b) => a.z - b.z || JSON.stringify(a.draw).localeCompare(JSON.stringify(b.draw)),
	);
const RIVERS = [SALMONS_MAP_SEED, 2, 7].map((seed) => [seed, salmonsMapRiver(seed)]);
const PROJECTORS = [
	['mirrored', ISO_PROJECTOR_MIRRORED],
	['unmirrored', ISO_PROJECTOR],
];

/**
 * The code bridge's drawing, recorded at c63f0be (before its deletion) with this gate's readings:
 * the hash of its water pieces in their order, of its upright pieces by depth, and of the seed's
 * deck cells (then proven to hold every cell the code stood among the players), and the counts.
 */
const CODE_BRIDGE = {
	'1:mirrored': {
		water: '3a2f623cf64e86f84cf70730',
		behind: '129ad0a5b9ab1592985fc3df',
		sorted: '5ca3ba26b2858e3d30b694b4',
		counts: [103, 34],
	},
	'1:unmirrored': {
		water: '9625ce4b47b6a1825649b0c8',
		behind: 'e968779ee09023698a8e2899',
		sorted: 'af8c4adbab20f80a83dab743',
		counts: [103, 34],
	},
	'2:mirrored': {
		water: 'e57c3b46879c0efdb1c53873',
		behind: '3498111468720080e03031f2',
		sorted: '2b01e8cbb2ca61852ba6bfec',
		counts: [111, 36],
	},
	'2:unmirrored': {
		water: '48bd9b2b9571c0ba015d9b7e',
		behind: '5481505a1c59e35bcba7ad6d',
		sorted: 'ebc72ff3a0425c7ef5c62779',
		counts: [111, 36],
	},
	'7:mirrored': {
		water: 'e2d3ff4c66cb38de74281319',
		behind: 'cbf185050633ae2a45014fa2',
		sorted: '7d0fcf89136ff8deadbb8d50',
		counts: [95, 32],
	},
	'7:unmirrored': {
		water: 'c227a5e7e1f9e785eaac3934',
		behind: 'aee161112f85d4b2a6f682fe',
		sorted: '640355a56b49b21dda5ac918',
		counts: [95, 32],
	},
};
const hashOf = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
const cellsOf = (list) => [...list].map((p) => JSON.stringify(p)).sort();

for (const [seed, river] of RIVERS) {
	for (const [name, projector] of PROJECTORS) {
		const drawnRiver = riverBridge(river, projector);
		const seedArt = seedBridge(river, projector);
		const code = CODE_BRIDGE[`${seed}:${name}`];
		const label = `seed ${seed}, ${name}`;
		check(`${label}: there are bridges to compare`, () => {
			assert.ok(river.bridges?.length > 0);
			assert.ok(code, 'a recorded code bridge');
		});
		check(`${label}: the water is the code's, piece for piece and in its order`, () => {
			assert.equal(drawnRiver.water.length, code.counts[0]);
			assert.equal(hashOf(drawnRiver.water.map((p) => p.draw)), code.water, 'the river');
			assert.equal(hashOf(seedArt.water.map((p) => p.draw)), code.water, 'the seed placed');
		});
		check(`${label}: the pillars and slopes are the code's, at its depths`, () => {
			assert.equal(drawnRiver.behind.length, code.counts[1]);
			assert.equal(hashOf(byDepth(drawnRiver.behind)), code.behind, 'the river');
			assert.equal(hashOf(byDepth(seedArt.behind)), code.behind, 'the seed placed');
		});
		check(`${label}: the deck cells are the code's, among the players at its depths`, () => {
			const cells = river.bridges.reduce((n, b) => n + Math.max(1, Math.round(b.w / CELL)), 0);
			assert.equal(seedArt.sorted.length, cells);
			assert.equal(hashOf(cellsOf(seedArt.sorted)), code.sorted);
			assert.deepEqual(drawnRiver.sorted, [], 'the river stands no deck cell among the players');
		});
	}
}

check(
	'painted art: a copy’s sprites and clips draw in the water and behind, as the seed would',
	() => {
		const SHEET = 'invisible_wall/salmons/manifests/atlas_manifest_S_Bridge.json';
		const water = structuredClone(defOf('bridgePropWater'));
		water.id = 'myWater';
		water.root.children = [
			{
				id: 'paint',
				label: 'Reflection',
				kind: 'sprite',
				x: 0,
				y: 12,
				assetKey: SHEET,
				region: 'water_tile',
				anchor: { x: 0.5, y: 0.5 },
				width: 96,
				height: 48,
				rotation: 0.25,
				alpha: 0.5,
				tint: 0x88aaff,
			},
			{
				id: 'below',
				label: 'Pillar reflection',
				kind: 'flipbook',
				x: 0,
				y: 0,
				clipId: 'bridge_ripple',
				anchor: { x: 0.5, y: 0 },
			},
		];
		const pillar = structuredClone(defOf('bridgePropPillar'));
		pillar.id = 'myPillar';
		pillar.root.children = [
			{
				id: 'post',
				label: 'Pillar',
				kind: 'sprite',
				x: 0,
				y: 0,
				assetKey: SHEET,
				region: `${SHEET}::post`,
				anchor: { x: 0.5, y: 1 },
				scale: { x: 2, y: 2 },
			},
		];
		const bridge = structuredClone(BRIDGE_PROP_DEF);
		bridge.id = 'myBridge';
		for (const child of bridge.root.children) {
			if (child.label === 'Water') child.componentId = 'myWater';
			if (child.label === 'Pillars') child.componentId = 'myPillar';
		}
		registerComponents({ myWater: water, myPillar: pillar });
		registerFlipbooks([
			{ id: 'bridge_ripple', assetKey: SHEET, frames: ['ripple_0', 'ripple_1'], fps: 8 },
		]);
		const textures = {
			[editorArtTextureKey(SHEET, 'water_tile')]: named('water_tile'),
			[editorArtTextureKey(SHEET, 'post')]: named('post'),
			[editorArtTextureKey(SHEET, 'ripple_0')]: named('ripple_0'),
			[editorArtTextureKey(SHEET, 'ripple_1')]: named('ripple_1'),
		};
		const [, river] = RIVERS[0];
		const projector = ISO_PROJECTOR_MIRRORED;
		const elevation = riverElevation(river.waterfalls);
		const zones = (river.bridges ?? []).map((b, i) => ({ id: `bridge${i}`, ...b }));
		const pieces = zones.flatMap((zone, b) =>
			placeSalmonsProp(bridge, zone, b, elevation.at(zone.y + CELL / 2)),
		);
		setSpawnProps(SALMONS_FIELD_LAYER, pieces);
		const app = {
			renderer: { generateTexture: () => named('made'), screen: { width: 1e7, height: 1e7 } },
			ticker: { add: () => {}, remove: () => {} },
		};
		const art = { region: (name) => named(name), face: named('face'), cliff: named('cliff') };
		const into = new Container();
		const layer = new Container();
		const unregister = registerProjectedLayer(SALMONS_FIELD_LAYER, layer);
		const from = Texture.from;
		Texture.from = (source) => (source?.getContext ? named('canvas') : from.call(Texture, source));
		let mounted;
		try {
			mounted = mountSalmonsRiver(into, app, art, river, river.seed, projector, {
				stamps: [],
				assets: () => textures,
			});
		} finally {
			Texture.from = from;
			clearSpawnProps();
			registerComponents({});
		}
		const [, , , , reflections, upright] = into.children;
		const label = (v) => v.texture?.label;
		const painted = reflections.children.filter(
			(v) => v instanceof Sprite && label(v) === 'water_tile',
		);
		const ripples = reflections.children.filter((v) => v instanceof AnimatedSprite);
		const posts = upright.children.filter((v) => v instanceof Sprite && label(v) === 'post');
		const waterPieces = pieces.filter((p) => p.band === 'water');
		const pillarPieces = pieces.filter((p) => p.band === 'behind' && p.componentId === 'myPillar');
		const pillarCells = (n, i) => i === 0 || i === n - 1 || i % 3 === 0;
		const expectedPosts = pillarPieces.filter((p) => pillarCells(p.params.count, p.cell)).length;
		assert.equal(painted.length, waterPieces.length, 'a painted reflection per water cell');
		assert.equal(
			ripples.length,
			expectedPosts,
			'the clip on the pillar cells only (their machine)',
		);
		assert.equal(posts.length, expectedPosts, 'a painted pillar on the pillar cells only');
		const first = waterPieces[0];
		const at = projector.project(first.x, first.y);
		const sprite = painted[0];
		assert.deepEqual(
			[
				round(sprite.x),
				round(sprite.y),
				sprite.anchor.x,
				sprite.anchor.y,
				round(sprite.width),
				round(sprite.height),
				sprite.rotation,
				sprite.alpha,
				sprite.tint,
			],
			[round(at.x), round(at.y - first.lift + 12), 0.5, 0.5, 96, 48, 0.25, 0.5, 0x88aaff],
			'the sprite at its node’s place and transform',
		);
		assert.deepEqual(
			ripples[0].textures.map((t) => t.label),
			['ripple_0', 'ripple_1'],
			'the clip’s frames, played',
		);
		const post = posts[0];
		const postPiece = pillarPieces.find((p) => pillarCells(p.params.count, p.cell));
		assert.deepEqual(
			[post.zIndex, post.anchor.y, post.scale.x, post.scale.y],
			[postPiece.zIndex, 1, 2, 2],
			'the pillar sprite at its band’s Z, with its scale',
		);
		assert.equal(
			reflections.children.filter((v) => v instanceof Graphics && firstColor(v) === 0x4a3020)
				.length,
			0,
			'the copy replaced the seed’s drawn reflection',
		);
		mounted.teardown();
		unregister();
	},
);

check(
	'the slopes follow the collider: a near ramp of 3 stands its foot 3 cells out, as the rule',
	() => {
		const [, river] = RIVERS[0];
		const bridge = river.bridges[0];
		const zone = { id: 'bridge0', ...bridge };
		const lift = riverElevation(river.waterfalls).at(bridge.y + CELL / 2);
		const asNumber = structuredClone(BRIDGE_PROP_DEF);
		asNumber.prop.collider.ramps.near = { length: 3 };
		const asParam = structuredClone(BRIDGE_PROP_DEF);
		asParam.params.push({ key: 'nearRamp', kind: 'number', default: 3 });
		asParam.prop.collider.ramps.near = { length: { param: 'nearRamp' } };
		for (const [label, def] of [
			['a number', asNumber],
			['its param', asParam],
		]) {
			const shape = compilePropShape(def);
			assert.deepEqual(shape.ramp, { near: 3, far: 2 }, `${label}: the rule's ramps`);
			const geometry = geometryOf(river, { 'bridge#': shape });
			const deck = bridgeDecks({
				zones: geometry.zones,
				online: { rules: { zones: geometry.zoneRules } },
			}).find((d) => d.id === 'bridge0');
			const ruleFoot = deck.x + CELL / 2 - deck.ramp.near * CELL;
			const pieces = placeSalmonsProp(def, zone, 0, lift);
			const near = pieces.find((p) => p.id === 'bridge0:bridgeProp-nearSlope:-3');
			const far = pieces.find((p) => p.id.startsWith('bridge0:bridgeProp-farSlope:'));
			assert.ok(near, `${label}: the near slope stands at cell −3`);
			assert.equal(near.params.run, 3, `${label}: and runs 3 cells`);
			assert.equal(near.x, ruleFoot, `${label}: its foot is where the rule's ramp starts`);
			assert.equal(far.params.run, -2, `${label}: the far slope keeps 2`);
			const slope = defOf('bridgePropSlope');
			const params = Object.fromEntries(slope.params.map((p) => [p.key, p.default]));
			Object.assign(params, near.params);
			const [shapeDrawn] = resolvePropGraphic(slope.root.children[0].bind.props.ops, {
				project: ISO_PROJECTOR.project,
				param: (k) => params[k],
			});
			const top = ISO_PROJECTOR.project(3 * CELL, 0);
			assert.deepEqual(
				shapeDrawn.points.slice(4, 6).map(round),
				[
					round(top.x + ISO_PROJECTOR.project(0, CELL / 2).x),
					round(top.y + ISO_PROJECTOR.project(0, CELL / 2).y - deckLift(6)),
				],
				`${label}: its top is the deck's first cell, 3 cells along, at the deck's height`,
			);
		}
		const seedPieces = placeSalmonsProp(BRIDGE_PROP_DEF, zone, 0, lift);
		assert.deepEqual(
			seedPieces
				.filter((p) => p.componentId === 'bridgePropSlope')
				.map((p) => [p.cell, p.params.run]),
			[
				[-2, 2],
				[Math.round(bridge.w / CELL) + 1, -2],
			],
			'today’s bridge: the slopes as they were',
		);
	},
);

check("the reflections' sway is the code shimmer's, cell by cell, frame by frame", () => {
	const sway = timelineOf(BRIDGE_PROP_TIMELINES.sway);
	const track = sway.tracks.find((t) => t.kind === 'property');
	const water = defOf('bridgePropWater');
	const state = water.stateMachine.layers.find((l) => l.id === 'shimmer').states[0];
	assert.deepEqual([state.loop, state.offsetParam], [true, 'phase']);
	const [, river] = RIVERS[0];
	const pieces = placeSalmonsProp(BRIDGE_PROP_DEF, { id: 'bridge1', ...river.bridges[0] }, 1, 0);
	let worst = 0;
	for (const piece of pieces.filter((p) => p.band === 'water')) {
		const phase = 1 * 1.7 + piece.cell * 0.9;
		assert.equal(piece.params.phase, phase / SWAY_PER_SECOND);
		for (let frame = 0; frame < 4000; frame += 13) {
			const local = (frame / 60 + piece.params.phase) % sway.duration;
			const t = frame * 0.04 + phase;
			const x = (Math.sin(t) * 1.5 + Math.sin(1.7 * t) * 0.6) * K;
			const sx = 1 + Math.sin(t) * 0.04;
			worst = Math.max(
				worst,
				Math.abs(sampleChannel(track.channels.x, local) - x),
				Math.abs(sampleChannel(track.channels.scaleX, local) - sx) * 100,
			);
		}
	}
	assert.ok(worst < 0.01, `off by ${worst} px`);
});

check(
	'a character on the deck sorts over its cell; an over piece over him; under, under it',
	() => {
		const [, river] = RIVERS[0];
		const bridge = river.bridges[0];
		const zone = { id: 'bridge0', ...bridge };
		const over = {
			...BRIDGE_PROP_DEF,
			root: {
				...BRIDGE_PROP_DEF.root,
				children: [
					...BRIDGE_PROP_DEF.root.children,
					{
						id: 'arch',
						kind: 'componentInstance',
						x: 0,
						y: 0,
						componentId: 'bridgePropSlope',
						propDepth: 'over',
						propCell: 2,
					},
				],
			},
		};
		const pieces = placeSalmonsProp(over, zone, 0, 0);
		const deck = pieces.find((p) => p.band === 'sorted' && p.cell === 2);
		const arch = pieces.find((p) => p.band === 'over');
		const deckZ = isoDepthOrder(deck.x, deck.y, 0, deck.bias);
		const archZ = isoDepthOrder(arch.x, arch.y, 0, arch.bias);
		const aloft = aloftDepth(deckLift(bridge.height ?? 6));
		for (const dx of [-CELL / 2, 0, CELL / 2 - 1]) {
			const onDeck = isoDepthOrder(deck.x + dx, deck.y, 99, aloft);
			assert.ok(onDeck > deckZ, `on the deck at ${dx}: over the cell`);
			assert.ok(onDeck < archZ, `on the deck at ${dx}: under the over piece`);
		}
		const behindIt = isoDepthOrder(deck.x - CELL, deck.y - CELL, 99, 0);
		assert.ok(behindIt < deckZ, 'a character behind it on the ground is under the cell');
	},
);

const { spawnInstancesOf, spawnTargetStale } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/arcadeProps.svelte.ts')).href
);
check(
	'the deck cells follow a rebuilt spawn layer: a new layer, or a container gone, is found again',
	() => {
		const SPREAD = 1e6;
		const layerWith = () => {
			const layer = new Container();
			const wrapper = new Container();
			const instances = new Container();
			layer.addChild(wrapper);
			wrapper.addChild(instances);
			instances.addChild(Object.assign(new Container(), { zIndex: 2 * SPREAD }));
			instances.addChild(Object.assign(new Container(), { zIndex: 3 * SPREAD }));
			return { layer, instances };
		};
		const first = layerWith();
		const found = spawnInstancesOf(first.layer, SPREAD);
		assert.equal(found, first.instances);
		assert.equal(spawnTargetStale(first.layer, first.layer, found), false, 'still there: kept');
		const second = layerWith();
		assert.equal(
			spawnTargetStale(first.layer, second.layer, found),
			true,
			'a new layer: looked again',
		);
		assert.equal(spawnInstancesOf(second.layer, SPREAD), second.instances);
		first.instances.removeFromParent();
		assert.equal(
			spawnTargetStale(first.layer, first.layer, found),
			true,
			'taken off: looked again',
		);
		const gone = spawnInstancesOf(second.layer, SPREAD);
		gone.destroy();
		assert.equal(
			spawnTargetStale(second.layer, second.layer, gone),
			true,
			'destroyed: looked again',
		);
		assert.equal(spawnTargetStale(second.layer, second.layer, undefined), true, 'none yet');
	},
);

const { showSalmonsBridges } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/salmonsArt/bridgeProps.ts')).href
);
const { registerComponentTimelines, stateMachineTimelines } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/componentTimelines.ts')).href
);
const { salmonsGeometry } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-mechanics/src/salmons.js')).href
);
check('the prop timelines survive a later registration: made good on the next room state', () => {
	const g = salmonsGeometry(RIVERS[0][1]);
	const game = { zones: g.zones, online: { rules: { zones: g.zoneRules } } };
	const sway = defOf('bridgePropWater').stateMachine;
	const registered = () => stateMachineTimelines(sway).docs.length;
	const project = {
		id: 'projectOwn',
		schemaVersion: 1,
		name: 'p',
		duration: 1,
		fps: 60,
		markers: [],
		host: { kind: 'component', componentId: 'x' },
		stage: { sceneId: null, cast: [] },
		tracks: [],
	};
	const shown = showSalmonsBridges(
		BRIDGE_PROP_DEF,
		game,
		'field',
		() => 0,
		() => [project],
	);
	const all = registered();
	assert.ok(all > 0, 'registered with the bridges');
	registerComponentTimelines([project]); // a game's own registration, as a boot or a reload makes
	assert.equal(registered(), 0, 'dropped by it');
	shown.inputs([], 1);
	assert.equal(registered(), all, 'registered again on the next state');
	assert.equal(
		stateMachineTimelines({
			layers: [
				{
					id: 'p',
					name: 'p',
					entry: '',
					states: [{ id: 'p', timeline: 'projectOwn' }],
					transitions: [],
				},
			],
		}).docs.length,
		1,
		'with the project’s',
	);
	shown.drop();
});

// The spawn layer that sorts only on reorder (main's T4, `depthOrder.ts`): the deck cells stand in
// it with a fixed zIndex beside the players' kept depths, and a fisherman walking under, then onto,
// the deck is drawn under, then over, the cell it passes, frame by frame, as a layer setting every
// zIndex each frame draws him.
const { hasDepth, setDepth } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/depthOrder.ts')).href
);
check(
	'under the sort-only-on-reorder layer, a fisherman walking under then on the deck sorts right',
	() => {
		const [, river] = RIVERS[0];
		const zone = { id: 'bridge0', ...river.bridges[0] };
		const pieces = placeSalmonsProp(BRIDGE_PROP_DEF, zone, 0, 0).filter((p) => p.band === 'sorted');
		const layer = new Container();
		const cells = pieces.map((piece) => {
			const view = new Container();
			view.zIndex = isoDepthOrder(piece.x, piece.y, 0, piece.bias ?? 0);
			layer.addChild(view);
			return { piece, view };
		});
		const him = new Container();
		layer.addChild(him);
		/** A frame: his depth set, then the layer readied and sorted as Pixi renders it. */
		const frame = (x, y, z) => {
			const bias = z > 0 ? aloftDepth(deckLift(zone.height ?? 6)) : 0;
			const depth = isoDepthOrder(x, y, 7, bias);
			setDepth(him, depth);
			layer.onRender?.({});
			if (layer.sortDirty) layer.sortChildren();
			return depth;
		};
		frame(zone.x - 2 * CELL, zone.y - 2 * CELL, 0);
		assert.ok(hasDepth(him), 'the layer keeps his depth');
		const row = zone.y + CELL / 2;
		let checked = 0;
		// Under the deck (the water row behind it, as a bear passes under), then up the ramp onto it.
		const path = [
			...Array.from({ length: 12 }, (_, k) => [zone.x + k * (CELL / 4), row - CELL, 0]),
			...Array.from({ length: 12 }, (_, k) => [zone.x + k * (CELL / 4), row, 6 * CELL]),
		];
		for (const [x, y, z] of path) {
			const depth = frame(x, y, z);
			const at = layer.children.indexOf(him);
			for (const { view } of cells) {
				const over = layer.children.indexOf(view) < at;
				assert.equal(
					over,
					view.zIndex < depth,
					`at (${x}, ${y}, ${z}): drawn ${over ? 'over' : 'under'} a cell`,
				);
				checked++;
			}
			const order = layer.children.map((c) => (c === him ? depth : c.zIndex));
			assert.deepEqual(
				order,
				[...order].sort((a, b) => a - b),
				'the layer in depth order',
			);
		}
		assert.ok(checked > 100);
		const onDeck = frame(zone.x + 2 * CELL, row, 6 * CELL);
		assert.ok(
			cells.every(({ view }) => view.zIndex < onDeck),
			'on the deck: over every cell',
		);
		const under = frame(zone.x + 2 * CELL, row - CELL, 0);
		assert.ok(
			cells.some(({ view }) => view.zIndex > under),
			'under it, behind: a cell in front of him covers him',
		);
		// The layer's own container, `<LayoutNodeView>`'s wrapper, the instances', one player.
		const root = new Container();
		const wrapper = new Container();
		const instances = new Container();
		const only = new Container();
		root.addChild(wrapper);
		wrapper.addChild(instances);
		instances.addChild(only);
		setDepth(only, 5);
		assert.equal(
			spawnInstancesOf(root, 1e9),
			instances,
			'a lone kept instance is not searched into',
		);
	},
);

// Another player's place packed in 16 bits (main's T7: `px` / `py` × the room's `posScale`, no
// `x` / `y`), read as the runtime reads it (`online.ts` `applyState`: `placeOnWire`, main's own
// decoder): a fisherman who is not the device's own still occupies the deck, fires `stepOn` /
// `stepOff`, and is drawn lifted and over the deck cell he stands on.
const { packPosition, placeOnWire, positionScale } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-mechanics/src/online.js')).href
);
const { aloftLift } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-layout/src/lib/salmonsArt/bridge.ts')).href
);
const { bridgeOccupancy } = await import(
	pathToFileURL(join(ROOT, 'packages/engine-mechanics/src/salmonsRules.js')).href
);
check(
	"another player's packed place: he occupies the deck, fires its steps, and is drawn over it",
	() => {
		const [, river] = RIVERS[0];
		const g = geometryOf(river);
		const game = { zones: g.zones, online: { rules: { zones: g.zoneRules } } };
		const posScale = positionScale(river.world);
		const zone = g.zones.find((z) => z.id === 'bridge0');
		const row = zone.y + CELL / 2;
		/** A packed fisherman as a packed device is sent him: no `x` / `y`. */
		const packed = (x, y, z) => ({
			px: packPosition(x, posScale),
			py: packPosition(y, posScale),
			z,
			character: 'fisherman',
		});
		const read = (p) => ({ ...placeOnWire(p, posScale), z: p.z, character: p.character });
		const onDeck = packed(zone.x + zone.w / 2 + 0.3, row, 6 * CELL);
		assert.equal(onDeck.x, undefined, 'the wire sends no x');
		const at = read(onDeck);
		assert.ok(
			Math.abs(at.x - (zone.x + zone.w / 2 + 0.3)) <= 1 / posScale,
			'decoded within a step',
		);
		const shown = showSalmonsBridges(
			BRIDGE_PROP_DEF,
			game,
			'packed',
			() => 0,
			() => [],
		);
		shown.inputs([read(packed(zone.x - 4 * CELL, row, 0))], 1);
		shown.inputs([at], 2);
		shown.inputs([read(packed(zone.x - 4 * CELL, row, 0))], 3);
		const probe = shown.probe();
		shown.drop();
		assert.deepEqual(
			probe.fired.filter((f) => f.zone === 'bridge0').map((f) => `${f.signal}@${f.step}`),
			['stepOn@2', 'stepOff@3'],
		);
		assert.equal(bridgeOccupancy(game, [at]).get('bridge0'), 1, 'occupied by him');
		const lift = aloftLift('fisherman', at.z);
		assert.ok(lift > 0, 'drawn lifted');
		const deck = placeSalmonsProp(BRIDGE_PROP_DEF, zone, 0, 0).find(
			(p) => p.band === 'sorted' && p.cell === Math.floor((at.x - zone.x) / CELL),
		);
		assert.ok(
			isoDepthOrder(at.x, at.y, 9, aloftDepth(lift)) > isoDepthOrder(deck.x, deck.y, 0, deck.bias),
			'and over the deck cell he stands on',
		);
	},
);

console.log(
	process.exitCode ? 'check:prop-depth FAILED' : `check:prop-depth: all ${passed} checks pass`,
);
