/**
 * The Component Editor's prop edits and prop view (`docs/design/arcade-prop-components.md` §7 P7):
 *   pnpm --filter launcher-api check:component-prop-editor
 *
 *  1. Make a prop: a bridge with today's collider (it compiles to `{ from, zoneKind }`), the zone
 *     params, the zone scope and the reserved inputs, what the def had kept; and back;
 *  2. the locked inputs: `occupied` / `stepOn` / `stepOff` on a prop only;
 *  3. the card's numbers and param toggles: snap (clamped), the ramps and the height (a number, or
 *     a param — a ramp's own, the height the zone's), round trips;
 *  4. the collider handles: a ramp dragged to whole cells, the snap across the row, solids drawn,
 *     moved, resized and removed; the overlay's boxes;
 *  5. the side exit: on writes `sideExit: true` and the compile and the save keep it, off drops it;
 *  6. the depth fold: a node's band its own, else its parent's, else `sorted`; a z offset dropped
 *     where the band reads none; a cell only on a root component instance;
 *  7. the stand-in: its height and `occupied` are the room's, cell for cell — the preview game is
 *     `salmonsGeometry`'s bridge for the same shape on a real level, read by `bridgeOccupancy`,
 *     today's and an edited collider; its moves fire `stepOn` / `stepOff`;
 *  8. the prop view draws the seed's pieces in the game's order, the stand-in on the deck over
 *     its cell and under it on the ground behind.
 *
 * What it cannot prove: the canvas drawing and the drags in a browser — the owner's check.
 */
import { BRIDGE_PROP_DEF, type ComponentDef, type LayoutNode } from 'engine-layout';
import { compilePropShape, propShapeErrors } from 'engine-mechanics/src/propShape.js';
import { salmonsGeometry } from 'engine-mechanics/src/salmons.js';
import { salmonsMapRiver } from 'engine-mechanics/src/salmonsMap.js';
import { bridgeDeckAt, bridgeDecks, bridgeOccupancy } from 'engine-mechanics/src/salmonsRules.js';

import { normalizeProp } from '../src/lib/server/componentProp';
import {
	PROP_CELL,
	addPropSolid,
	dragColliderHandle,
	isLockedPropInput,
	makeProp,
	propBandOf,
	propCellApplies,
	propColliderOverlay,
	propLengthIsParam,
	propLengthValue,
	removePropSolid,
	setNodePropCell,
	setNodePropDepth,
	setNodePropZOffset,
	setPropPreview,
	setPropSideExit,
	setPropSnap,
	setPropSolidBox,
	standInOn,
	standInSteps,
	togglePropLengthParam,
	unmakeProp,
} from '../src/lib/editor/propEdit';
import { propStageItems } from '../src/lib/editor/propStage';
import { BUILTIN_LIBRARY_COMPONENTS, BUILTIN_LIBRARY_TIMELINES } from 'engine-layout';

let passed = 0;
let failed = 0;
const eq = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) passed++;
	else {
		failed++;
		console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
	}
};
const CELL = PROP_CELL;
const blank = (): ComponentDef => ({
	id: 'myBridge',
	name: 'My bridge',
	version: 3,
	scope: 'project',
	category: 'scenery',
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'grp',
				kind: 'container',
				x: 0,
				y: 0,
				propDepth: 'behind',
				children: [{ id: 'inner', kind: 'rect', x: 0, y: 0, width: 1, height: 1 }],
			},
			{ id: 'piece', kind: 'componentInstance', x: 0, y: 0, componentId: 'p' },
		],
	},
	params: [{ key: 'height', kind: 'number', default: 4, engineProvided: true }],
	inputs: [{ id: 'hover', kind: 'bool' }],
});

// ---- 1. Make a prop ----------------------------------------------------------------------------
{
	const def = blank();
	eq('Make a prop makes it a prop', makeProp(def), true);
	eq('…a second time changes nothing', makeProp(def), false);
	eq(
		'…it compiles to today’s bridge, at the height its own height param says',
		compilePropShape(def),
		{
			from: { component: 'myBridge', version: 3 },
			zoneKind: 'bridge',
			height: 4,
		},
	);
	eq(
		'…its zone params added, the def’s own kept',
		def.params?.map((p) => [p.key, p.default, p.engineProvided ?? false]),
		[
			['height', 4, true],
			['length', 6, true],
			['zone', '', true],
		],
	);
	eq('…scoped by its zone', def.signalScope, 'zone');
	eq(
		'…the reserved inputs after its own',
		def.inputs?.map((i) => [i.id, i.kind]),
		[
			['hover', 'bool'],
			['occupied', 'number'],
			['stepOn', 'trigger'],
			['stepOff', 'trigger'],
		],
	);
	eq('…the save keeps the block whole', normalizeProp(def.prop), def.prop);
	eq(
		'Stop being a prop drops the block only',
		[unmakeProp(def), !!def.prop, def.inputs?.length],
		[true, false, 4],
	);
}

// ---- 2. the locked inputs ----------------------------------------------------------------------
{
	const def = blank();
	makeProp(def);
	eq(
		'occupied / stepOn / stepOff are locked on a prop, nothing else',
		['occupied', 'stepOn', 'stepOff', 'hover'].map((id) => isLockedPropInput(def, id)),
		[true, true, true, false],
	);
	eq('…and none off a prop', isLockedPropInput(blank(), 'occupied'), false);
}

// ---- 3. the card's numbers and toggles ---------------------------------------------------------
{
	const def = blank();
	makeProp(def);
	eq(
		'the snap clamps to at most a cell',
		[setPropSnap(def, 3), def.prop?.collider.snap],
		[true, 1],
	);
	setPropSnap(def, 0.5);
	eq('…the same value changes nothing', setPropSnap(def, 0.5), false);
	eq('the height follows the zone’s height param', propLengthIsParam(def, 'height'), true);
	eq('…read at the preview height default', propLengthValue(def, 'height'), 4);
	togglePropLengthParam(def, 'height');
	eq('…toggled off it is the number it read as', def.prop?.collider.deck.height, 4);
	togglePropLengthParam(def, 'height');
	eq('…and back on, the zone’s', def.prop?.collider.deck.height, { param: 'height' });
	togglePropLengthParam(def, 'near');
	eq(
		'a ramp toggled to a param gets its own, at its value',
		[def.prop?.collider.ramps.near, def.params?.find((p) => p.key === 'nearRamp')?.default],
		[{ length: { param: 'nearRamp' } }, 2],
	);
	dragColliderHandle(def, 'near', { x: CELL / 2 - 3.4 * CELL, y: CELL / 2 });
	eq(
		'…a drag of its handle sets the param, in whole cells',
		[def.params?.find((p) => p.key === 'nearRamp')?.default, propLengthValue(def, 'near')],
		[3, 3],
	);
	eq('…which compiles to an asymmetric ramp', compilePropShape(def).ramp, { near: 3, far: 2 });
	togglePropLengthParam(def, 'near');
	eq(
		'…toggled back it is a number and the param it made is gone',
		[def.prop?.collider.ramps.near, def.params?.some((p) => p.key === 'nearRamp')],
		[{ length: 3 }, false],
	);
	eq(
		'the preview length is whole cells, at least 1',
		[setPropPreview(def, 'length', 0.2), def.prop?.preview?.length],
		[true, 1],
	);
}

// ---- 4. the handles and the overlay ------------------------------------------------------------
{
	const def = blank();
	makeProp(def);
	const zoneW = 6 * CELL;
	dragColliderHandle(def, 'far', { x: zoneW - CELL / 2 + 0.6 * CELL, y: 0 });
	eq('a far ramp dragged short stops at one cell', def.prop?.collider.ramps.far, { length: 1 });
	dragColliderHandle(def, 'snap', { x: 0, y: CELL / 2 - 0.3 * CELL });
	eq('the snap handle sets the snap from the row, either side', def.prop?.collider.snap, 0.3);
	const overlay = propColliderOverlay(def)!;
	eq(
		'the overlay’s ramps and snap band follow',
		[overlay.ramps.near.w, overlay.ramps.far.w, overlay.snap.h, overlay.handles.far.x],
		[2 * CELL, CELL, 0.6 * CELL, zoneW - CELL / 2 + CELL],
	);
	eq('the hole is the deck and its ramps, padded by the body', overlay.hole, {
		x: -2 * CELL,
		y: -44,
		w: zoneW + 3 * CELL,
		h: CELL + 88,
	});
	const i = addPropSolid(def, { x: 1, y: -0.2, w: 4, h: 0.2 });
	eq('a drawn solid is added, solid from every side', def.prop?.collider.solids, [
		{ x: 1, y: -0.2, w: 4, h: 0.2, collide: 'solid' },
	]);
	eq('…and compiles', propShapeErrors(def), []);
	setPropSolidBox(def, i, { x: 1.04, y: -0.2, w: -0.01, h: 0.2 });
	eq('…resized past nothing keeps a tenth of a cell', def.prop?.collider.solids?.[0], {
		x: 1,
		y: -0.2,
		w: 0.1,
		h: 0.2,
		collide: 'solid',
	});
	eq('…drawn on the overlay in world px', propColliderOverlay(def)?.solids, [
		{ x: CELL, y: -0.2 * CELL, w: 0.1 * CELL, h: 0.2 * CELL },
	]);
	removePropSolid(def, i);
	eq('…removed, the list goes', 'solids' in (def.prop?.collider ?? {}), false);
}

// ---- 5. the side exit --------------------------------------------------------------------------
{
	const def = blank();
	makeProp(def);
	eq('the side exit is off by default', 'sideExit' in (def.prop?.collider ?? {}), false);
	setPropSideExit(def, true);
	eq(
		'on: the collider, the compile and the save keep it',
		[
			def.prop?.collider.sideExit,
			compilePropShape(def).sideExit,
			normalizeProp(def.prop)?.collider.sideExit,
		],
		[true, true, true],
	);
	setPropSideExit(def, false);
	eq(
		'off: no field, and the shape is today’s again',
		['sideExit' in (def.prop?.collider ?? {}), compilePropShape(def)],
		[false, { from: { component: 'myBridge', version: 3 }, zoneKind: 'bridge', height: 4 }],
	);
}

// ---- 6. the depth fold -------------------------------------------------------------------------
{
	const def = blank();
	makeProp(def);
	const [grp, piece] = def.root.children as [
		Extract<LayoutNode, { kind: 'container' }>,
		LayoutNode,
	];
	const inner = grp.children[0];
	eq(
		'a node’s band is its own, else its parent’s, else sorted',
		['grp', 'inner', 'piece'].map((id) => propBandOf(def.root, id)),
		['behind', 'behind', 'sorted'],
	);
	setNodePropDepth(inner, 'over');
	eq('…its own wins', propBandOf(def.root, 'inner'), 'over');
	setNodePropZOffset(grp, 400);
	setNodePropDepth(grp, 'water');
	eq('a band that reads no z offset drops it', 'propZOffset' in grp, false);
	setNodePropDepth(grp, undefined);
	eq('cleared, it is its parent’s again', propBandOf(def.root, 'grp'), 'sorted');
	eq(
		'a cell is for a component instance at the root only',
		[propCellApplies(def, piece), propCellApplies(def, grp), propCellApplies(def, inner)],
		[true, false, false],
	);
	setNodePropCell(piece, { param: 'length', plus: 1 });
	eq('…set and kept by the save', normalizeProp(def.prop) && piece.propCell, {
		param: 'length',
		plus: 1,
	});
}

// ---- 7. the stand-in is the room's --------------------------------------------------------------
{
	const river = salmonsMapRiver(1);
	const bridge = river.bridges![0];
	const cells = Math.round(bridge.w / CELL);
	const shapes: [string, (def: ComponentDef) => void][] = [
		['today’s collider', () => undefined],
		[
			'an edited one (near 3, snap 0.3, side exit)',
			(def) => {
				dragColliderHandle(def, 'near', { x: CELL / 2 - 3 * CELL, y: 0 });
				setPropSnap(def, 0.3);
				setPropSideExit(def, true);
			},
		],
	];
	for (const [label, edit] of shapes) {
		const def = blank();
		makeProp(def);
		setPropPreview(def, 'length', cells);
		setPropPreview(def, 'height', bridge.height ?? 6);
		def.params!.find((p) => p.key === 'height')!.default = bridge.height ?? 6;
		edit(def);
		const shape = compilePropShape(def);
		const geometry = salmonsGeometry(river, { 'bridge#': shape });
		const game = {
			zones: geometry.zones,
			online: { rules: { zones: geometry.zoneRules } },
		} as unknown as Parameters<typeof bridgeDecks>[0];
		const decks = bridgeDecks(game).filter((d) => d.id === 'bridge0');
		let mismatches = 0;
		let onDeck = 0;
		for (let gx = -5; gx <= cells + 5; gx += 0.25) {
			for (const dy of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) {
				const at = { x: gx * CELL, y: CELL / 2 + dy * CELL, character: 'fisherman' };
				const mine = standInOn(def, at);
				const world = { x: at.x + bridge.x, y: at.y + bridge.y };
				const on = bridgeDeckAt(decks, world, () => true);
				const z = on ? on.lift * CELL : 0;
				const y = on && !on.deck.sideExit ? on.deck.y + CELL / 2 : world.y;
				const occupied =
					bridgeOccupancy(game, [{ ...world, y, z, character: 'fisherman' }]).get('bridge0') ?? 0;
				if (Math.abs(mine.z - z) > 1e-9 || mine.occupied !== occupied) mismatches++;
				if (mine.occupied) onDeck++;
			}
		}
		eq(`stand-in, ${label}: its height and occupied are the room’s everywhere`, mismatches, 0);
		eq(`…and it stood on the prop somewhere`, onDeck > 0, true);
		eq(
			`…a bear is carried by nothing`,
			standInOn(def, { x: CELL, y: CELL / 2, character: 'bear' }).occupied,
			0,
		);
	}
	eq(
		'stepping on fires stepOn, off fires stepOff, a move on none',
		[standInSteps(0, 1), standInSteps(1, 0), standInSteps(1, 1)],
		[['stepOn'], ['stepOff'], []],
	);
}

// ---- 8. the prop view ---------------------------------------------------------------------------
{
	const defs = new Map(BUILTIN_LIBRARY_COMPONENTS.map((d) => [d.id, d]));
	const docs = (id: string) =>
		BUILTIN_LIBRARY_TIMELINES.filter(
			(t) =>
				t.host?.kind === 'component' &&
				(t.host.componentId === id || t.playOnComponents?.includes(id)),
		);
	const items = propStageItems(BRIDGE_PROP_DEF, (id) => defs.get(id), docs);
	const bands = items.map((i) => ('kind' in i ? 'standIn' : i.band));
	const order = bands.map((b) => ['water', 'behind', 'sorted'].indexOf(b));
	eq(
		'the seed draws in the game’s order: water, behind, among',
		[...order].sort((a, b) => a - b),
		order,
	);
	eq(
		'…its six cells: 6 reflections and 3 pillar reflections, 3 pillars and 2 slopes, 6 deck cells',
		['water', 'behind', 'sorted'].map((b) => bands.filter((x) => x === b).length),
		[9, 5, 6],
	);
	const deckZ = 2.5 * CELL;
	const onDeck = propStageItems(BRIDGE_PROP_DEF, (id) => defs.get(id), docs, {
		x: deckZ,
		y: CELL / 2,
		character: 'fisherman',
		z: 6 * CELL,
	});
	const at = onDeck.findIndex((i) => 'kind' in i);
	eq('a stand-in on the deck draws after every deck cell', at, onDeck.length - 1);
	const under = propStageItems(BRIDGE_PROP_DEF, (id) => defs.get(id), docs, {
		x: deckZ,
		y: -CELL,
		character: 'fisherman',
		z: 0,
	});
	eq(
		'…on the ground behind it, before the cells in front of him',
		under
			.slice(under.findIndex((i) => 'kind' in i) + 1)
			.some((i) => !('kind' in i) && i.band === 'sorted'),
		true,
	);
}

console.log(`\n${failed ? '❌' : '✅'} component prop editor: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
