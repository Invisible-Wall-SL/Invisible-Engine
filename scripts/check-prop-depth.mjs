// THE SEED BRIDGE DRAWS AS THE CODE BRIDGE (`engine-layout` `propComponents.ts` against
// `salmonsArt/river.ts`; docs/design/arcade-prop-components.md §5, §7 P5): both drawn in Node with
// no GPU, as `salmons/art-fingerprint.mjs` draws the river, on Salmons' own levels, mirrored (as
// Salmons is) and not:
// - every piece of the code bridge has its seed piece, drawn with the same instructions (each fill
//   and stroke: its colour, alpha and width, and every point of its path, at its place on screen):
//   the water (reflections and the pillars' reflections, in the code's order), the pillars and the
//   slopes (the upright layer), the deck cells (among the players: each one the code stands in its
//   view, one seed cell per cell of every bridge);
// - each seed piece sorts where the code's sorts: the pillars and slopes at the code's `zOf`
//   (`Z.pillar` 400, `Z.slope` 500), the deck cells at its `amongZ` (`Z.deck` 1100);
// - the reflections' sway is the code shimmer's, cell by cell, frame by frame (the piece's looping
//   timeline from its `phase`);
// - a character on the deck (`z > 0`) sorts over the deck cell it stands on, and under an `over`
//   piece anywhere on that cell; one under the deck (`z` 0) sorts under the cell when behind it.
//
// Run: pnpm check:prop-depth

import assert from 'node:assert/strict';
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
import { aloftDepth, deckLift } from '../packages/engine-layout/src/lib/salmonsArt/bridge.ts';
import { CELL, K } from '../packages/engine-layout/src/lib/salmonsArt/scale.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIXI = createRequire(join(ROOT, 'packages/engine-layout/package.json')).resolve('pixi.js');
const { Container, Graphics, Texture, TextureSource } = await import(
	pathToFileURL(PIXI.replace(/index\.js$/, 'index.mjs')).href
);
registerHooks({
	resolve: (specifier, context, next) =>
		specifier.endsWith('/worldDrawing.svelte')
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

/** The code bridge's pieces of `river` drawn by `river.ts`: its water, upright and among pieces. */
function codeBridge(river, projector) {
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
		mounted = mountSalmonsRiver(into, app, art, river, river.seed, projector);
	} finally {
		Texture.from = from;
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

for (const [seed, river] of RIVERS) {
	for (const [name, projector] of PROJECTORS) {
		const code = codeBridge(river, projector);
		const seedArt = seedBridge(river, projector);
		const label = `seed ${seed}, ${name}`;
		check(`${label}: there are bridges to compare`, () => {
			assert.ok(river.bridges?.length > 0);
			assert.ok(code.sorted.length >= river.bridges.length);
		});
		check(`${label}: the water is the code's, piece for piece and in its order`, () => {
			assert.equal(seedArt.water.length, code.water.length);
			assert.deepEqual(
				seedArt.water.map((p) => p.draw),
				code.water.map((p) => p.draw),
			);
		});
		check(`${label}: the pillars and slopes are the code's, at its depths`, () => {
			assert.equal(seedArt.behind.length, code.behind.length);
			assert.deepEqual(byDepth(seedArt.behind), byDepth(code.behind));
		});
		check(`${label}: the deck cells are the code's, among the players at its depths`, () => {
			// The code stands only the cells in its view among the players; each is the seed's.
			const cells = river.bridges.reduce((n, b) => n + Math.max(1, Math.round(b.w / CELL)), 0);
			assert.equal(seedArt.sorted.length, cells);
			const seedCells = new Set(seedArt.sorted.map((p) => JSON.stringify(p)));
			const missing = code.sorted.filter((p) => !seedCells.has(JSON.stringify(p)));
			assert.deepEqual(missing, [], `${missing.length} of the code's ${code.sorted.length}`);
		});
	}
}

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

console.log(
	process.exitCode ? 'check:prop-depth FAILED' : `check:prop-depth: all ${passed} checks pass`,
);
