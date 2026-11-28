import {
	PROP_INPUTS,
	propCellOf,
	type ArcadeProp,
	type ComponentDef,
	type ComponentParam,
	type LayoutNode,
	type PropCollider,
	type PropDepth,
	type PropLength,
	type PropSolid,
	type PropZone,
} from 'engine-layout';
import {
	PROP_MAX_SNAP,
	PROP_MAX_SOLIDS,
	PROP_SHAPE_DEFAULTS,
	compilePropShape,
	propShapeErrors,
	type PropShape,
} from 'engine-mechanics/src/propShape.js';
import {
	bridgeDeckAt,
	bridgeDecks,
	bridgeOccupancy,
	occupancySteps,
} from 'engine-mechanics/src/salmonsRules.js';
import type { RulesGame } from 'engine-mechanics/src/onlineRules.js';
import { CELL } from 'engine-mechanics/src/salmonsMap.js';

/**
 * THE PROP CARD'S AND THE PROP VIEW'S EDITS (`docs/design/arcade-prop-components.md` §7 P7): pure,
 * on the open draft in place (the Component Editor's pattern: `stateMachineEdit.ts`,
 * `listenerEdit.ts`), each returning whether it changed anything. The collider is the def's `prop`
 * block (`engine-layout` `types.ts`); what the rules make of it is `compilePropShape`'s, and the
 * stand-in character is lifted by the `bridges` rule's own `bridgeDeckAt`.
 */

/** The cell a prop's lengths count in: Salmons' grid cell, the one game with props. */
export const PROP_CELL = CELL;

/** The prop's zone params, the ones the runtime fills per zone (`fromZone`) and its scope. */
const ZONE_PARAMS: ComponentParam[] = [
	{ key: 'length', kind: 'number', default: 6, engineProvided: true, label: 'deck cells' },
	{ key: 'height', kind: 'number', default: 6, engineProvided: true, label: 'deck height, cells' },
	{ key: 'zone', kind: 'string', default: '', engineProvided: true, label: 'the zone it is on' },
];

/** A new prop's collider: today's bridge (it compiles to `{ from, zoneKind }`). */
const seedCollider = (): PropCollider => ({
	deck: { from: 0, to: { param: 'length', plus: -1 }, height: { param: 'height' } },
	snap: 0.5,
	ramps: { near: { length: 2 }, far: { length: 2 } },
	hole: 'deckAndRamps',
});

/**
 * **Make a prop**: give `def` a `prop` block (a bridge, today's collider), the zone params it
 * reads, its scope by zone (unless it has one) and the reserved prop inputs. What it already has is
 * kept. `false` when it is already a prop.
 */
export function makeProp(def: ComponentDef): boolean {
	if (def.prop) return false;
	const params = (def.params ??= []);
	for (const p of ZONE_PARAMS) if (!params.some((q) => q.key === p.key)) params.push({ ...p });
	def.signalScope ??= 'zone';
	const inputs = (def.inputs ??= []);
	for (const input of PROP_INPUTS) {
		if (!inputs.some((i) => i.id === input.id)) inputs.push({ ...input });
	}
	def.prop = {
		zoneKind: 'bridge',
		fromZone: { length: 'length', height: 'height' },
		collider: seedCollider(),
		preview: { length: 6, height: 6 },
	};
	return true;
}

/** Take the `prop` block away (its params and inputs stay: a node may read them). */
export function unmakeProp(def: ComponentDef): boolean {
	if (!def.prop) return false;
	delete def.prop;
	return true;
}

/** Whether input `id` is one the engine sets on a prop (`PROP_INPUTS`): its id and kind are
 *  locked while `def` is a prop. */
export const isLockedPropInput = (def: Pick<ComponentDef, 'prop'>, id: string): boolean =>
	!!def.prop && PROP_INPUTS.some((input) => input.id === id);

/** The collider's lengths the card edits, each a number or a param. */
export type PropLengthField = 'height' | 'near' | 'far';

const lengthOf = (c: PropCollider, field: PropLengthField): PropLength =>
	field === 'height' ? c.deck.height : c.ramps[field].length;
const setLength = (c: PropCollider, field: PropLengthField, value: PropLength): void => {
	if (field === 'height') c.deck.height = value;
	else c.ramps[field] = { length: value };
};
/** The author param a ramp follows when it is switched to a param (the height follows the zone's). */
const RAMP_PARAMS: Record<'near' | 'far', string> = { near: 'nearRamp', far: 'farRamp' };

/** A field's value in cells, a param read at its default (`propCellOf`). */
export function propLengthValue(def: ComponentDef, field: PropLengthField): number {
	const prop = def.prop;
	if (!prop) return 0;
	const defaults = Object.fromEntries((def.params ?? []).map((p) => [p.key, p.default]));
	return propCellOf(lengthOf(prop.collider, field), defaults);
}

/** Whether a field follows a param (the card's param toggle). */
export const propLengthIsParam = (def: ComponentDef, field: PropLengthField): boolean =>
	!!def.prop && typeof lengthOf(def.prop.collider, field) === 'object';

/**
 * Set a field's value in cells: a number field takes it; a param field sets its param's default
 * (the zone's height is the zone's: a height that follows it previews at `value`).
 */
export function setPropLength(def: ComponentDef, field: PropLengthField, value: number): boolean {
	const prop = def.prop;
	if (!prop || !Number.isFinite(value)) return false;
	const at = lengthOf(prop.collider, field);
	if (typeof at === 'number') {
		if (at === value) return false;
		setLength(prop.collider, field, value);
		return true;
	}
	if (field === 'height') return setPropPreview(def, 'height', value);
	const param = def.params?.find((p) => p.key === at.param);
	if (!param || param.default === value - (at.plus ?? 0)) return false;
	param.default = value - (at.plus ?? 0);
	return true;
}

/**
 * The param toggle: a number field follows a param (the height the zone's `fromZone.height`, a
 * ramp its own author param, made at the field's value), and a param field becomes the number it
 * reads as. A ramp param nothing else reads goes with it.
 */
export function togglePropLengthParam(def: ComponentDef, field: PropLengthField): boolean {
	const prop = def.prop;
	if (!prop) return false;
	const value = propLengthValue(def, field);
	const at = lengthOf(prop.collider, field);
	if (typeof at === 'object') {
		setLength(prop.collider, field, value);
		if (field !== 'height' && !JSON.stringify(def).includes(`"param":"${at.param}"`)) {
			def.params = def.params?.filter((p) => p.key !== at.param);
		}
		return true;
	}
	const key = field === 'height' ? prop.fromZone.height : RAMP_PARAMS[field];
	if (!key) return false;
	const params = (def.params ??= []);
	if (!params.some((p) => p.key === key)) {
		params.push({ key, kind: 'number', default: value, label: `${field} ramp, cells` });
	}
	setLength(prop.collider, field, { param: key });
	return true;
}

/** Set the editor-only preview's zone length or height (cells, whole, ≥ 1). */
export function setPropPreview(
	def: ComponentDef,
	key: 'length' | 'height',
	value: number,
): boolean {
	const prop = def.prop;
	const next = Math.max(1, Math.round(value));
	if (!prop || !Number.isFinite(value) || prop.preview?.[key] === next) return false;
	prop.preview = { ...(prop.preview ?? {}), [key]: next };
	return true;
}

/** Set the snap (cells, in (0, `PROP_MAX_SNAP`], to a hundredth). */
export function setPropSnap(def: ComponentDef, value: number): boolean {
	const prop = def.prop;
	if (!prop || !Number.isFinite(value)) return false;
	const next = Math.min(PROP_MAX_SNAP, Math.max(0.01, Math.round(value * 100) / 100));
	if (prop.collider.snap === next) return false;
	prop.collider.snap = next;
	return true;
}

/** Set the zone kind or the hole. */
export function setPropZoneKind(def: ComponentDef, kind: string): boolean {
	if (!def.prop || !kind || def.prop.zoneKind === kind) return false;
	def.prop.zoneKind = kind;
	return true;
}
export function setPropHole(def: ComponentDef, hole: PropCollider['hole']): boolean {
	if (!def.prop || def.prop.collider.hole === hole) return false;
	def.prop.collider.hole = hole;
	return true;
}

/** The owner's side-exit switch: on writes `sideExit: true`, off drops the field (the default). */
export function setPropSideExit(def: ComponentDef, on: boolean): boolean {
	const c = def.prop?.collider;
	if (!c || (c.sideExit === true) === on) return false;
	if (on) c.sideExit = true;
	else delete c.sideExit;
	return true;
}

// ---- the collider's handles on the prop view ---------------------------------------------------

/** A ramp handle dragged to `cells` off its deck end: whole cells, at least 1. A param ramp sets
 *  its param's default. */
export const dragRamp = (def: ComponentDef, end: 'near' | 'far', cells: number): boolean =>
	setPropLength(def, end, Math.max(1, Math.round(cells)));

/** The snap handle dragged to `cells` from the deck's row. */
export const dragSnap = (def: ComponentDef, cells: number): boolean =>
	setPropSnap(def, Math.abs(cells));

/** A solid's box, in cells of the deck's frame (`x` along the deck from its first cell's edge). */
export type SolidBox = Pick<PropSolid, 'x' | 'y' | 'w' | 'h'>;

/** Whether `def`'s collider has room for another solid (`PROP_MAX_SOLIDS`). */
export const canAddPropSolid = (def: ComponentDef): boolean =>
	!!def.prop && (def.prop.collider.solids?.length ?? 0) < PROP_MAX_SOLIDS;

/** Add a solid drawn as `box`, solid from every side; -1 when `def` is no prop or its collider
 *  holds {@link PROP_MAX_SOLIDS} already. */
export function addPropSolid(def: ComponentDef, box: SolidBox): number {
	const c = def.prop?.collider;
	if (!c || !canAddPropSolid(def)) return -1;
	const solids = (c.solids ??= []);
	solids.push({ ...roundBox(box), collide: 'solid' });
	return solids.length - 1;
}
/** Move or resize solid `i` to `box` (tenths of a cell; a side no smaller than a tenth). */
export function setPropSolidBox(def: ComponentDef, i: number, box: SolidBox): boolean {
	const s = def.prop?.collider.solids?.[i];
	if (!s) return false;
	const next = roundBox(box);
	if (s.x === next.x && s.y === next.y && s.w === next.w && s.h === next.h) return false;
	Object.assign(s, next);
	return true;
}
export function setPropSolid(
	def: ComponentDef,
	i: number,
	patch: Partial<Pick<PropSolid, 'collide' | 'side'>>,
): boolean {
	const s = def.prop?.collider.solids?.[i];
	if (!s) return false;
	if (patch.collide) s.collide = patch.collide;
	if (s.collide === 'oneWay') s.side = patch.side ?? s.side ?? 'below';
	else delete s.side;
	return true;
}
export function removePropSolid(def: ComponentDef, i: number): boolean {
	const c = def.prop?.collider;
	if (!c?.solids?.[i]) return false;
	c.solids.splice(i, 1);
	if (!c.solids.length) delete c.solids;
	return true;
}
const tenth = (v: number) => Math.round(v * 10) / 10;
function roundBox(box: SolidBox): SolidBox {
	const x0 = tenth(Math.min(box.x, box.x + box.w));
	const y0 = tenth(Math.min(box.y, box.y + box.h));
	return {
		x: x0,
		y: y0,
		w: Math.max(0.1, tenth(Math.abs(box.w))),
		h: Math.max(0.1, tenth(Math.abs(box.h))),
	};
}

// ---- a node's band ------------------------------------------------------------------------------

/** The band a node draws in: its own, else its nearest parent's, else `sorted` (§5's fold). */
export function propBandOf(root: LayoutNode, id: string): PropDepth | undefined {
	const walk = (node: LayoutNode, inherited: PropDepth): PropDepth | undefined => {
		const band = node.propDepth ?? inherited;
		if (node.id === id) return band;
		if (node.kind !== 'container') return undefined;
		for (const child of node.children) {
			const hit = walk(child, band);
			if (hit) return hit;
		}
		return undefined;
	};
	return walk(root, 'sorted');
}

/** Set (or, `undefined`, clear back to the parent's) a node's band, keeping a z offset only where a
 *  band reads one (`behind`, `sorted`). */
export function setNodePropDepth(node: LayoutNode, band: PropDepth | undefined): boolean {
	if (node.propDepth === band) return false;
	if (band) node.propDepth = band;
	else delete node.propDepth;
	if (band === 'water' || band === 'over') delete node.propZOffset;
	return true;
}
export function setNodePropZOffset(node: LayoutNode, value: number | undefined): boolean {
	if (value !== undefined && !Number.isFinite(value)) return false;
	if (node.propZOffset === value) return false;
	if (value === undefined) delete node.propZOffset;
	else node.propZOffset = value;
	return true;
}
/** Whether a node takes a `propCell`: a component instance at a prop's root (a piece of its own). */
export const propCellApplies = (def: ComponentDef, node: LayoutNode): boolean =>
	!!def.prop && node.kind === 'componentInstance' && def.root.children.includes(node);
/** Stand a root component instance at a ramp's foot (`near` / `far`, its `run` the ramp's), or
 *  back at its cell (`undefined`). */
export function setNodePropRamp(node: LayoutNode, ramp: 'near' | 'far' | undefined): boolean {
	if (node.propRamp === ramp) return false;
	if (ramp) node.propRamp = ramp;
	else delete node.propRamp;
	return true;
}
export function setNodePropCell(node: LayoutNode, cell: PropLength | undefined): boolean {
	if (JSON.stringify(node.propCell) === JSON.stringify(cell)) return false;
	if (cell === undefined) delete node.propCell;
	else node.propCell = cell;
	return true;
}

// ---- the preview zone and the stand-in character -----------------------------------------------

/** The zone the prop view draws the prop on: its preview length × one cell, at the origin. */
export function propPreviewZone(def: ComponentDef): PropZone {
	const preview = def.prop?.preview ?? {};
	const length = Math.max(1, Math.round(preview.length ?? 6));
	return { id: 'preview', x: 0, y: 0, w: length * CELL, h: CELL, height: preview.height ?? 6 };
}

/** What the rules play of the def, or `undefined` while it does not compile (`propShapeErrors`). */
export function propShapeOf(def: ComponentDef): PropShape | undefined {
	return def.prop && !propShapeErrors(def).length ? compilePropShape(def) : undefined;
}

/**
 * The rules' view of the preview zone: the zone and its rule as `salmons.js` `salmonsGeometry`
 * writes them for a bridge of `shape` (today's where it names nothing), as a room's game.
 */
export function propPreviewGame(def: ComponentDef, shape = propShapeOf(def)): RulesGame {
	const zone = propPreviewZone(def);
	const defaults = PROP_SHAPE_DEFAULTS.bridge;
	const characters = shape?.characters ?? [...defaults.characters];
	return {
		field: { w: zone.w, h: zone.h },
		zones: [{ ...zone, ...(shape?.height !== undefined ? { height: shape.height } : {}) }],
		online: {
			tickHz: 30,
			rules: {
				abilities: [],
				round: { nextRoundSeconds: 0, goalScore: 0 },
				zones: [
					{
						zone: zone.id,
						kind: 'bridge',
						characters: [...characters],
						...(shape?.ramp ? { ramp: { near: shape.ramp.near, far: shape.ramp.far } } : {}),
						...(shape?.snap !== undefined ? { snap: shape.snap } : {}),
						...(shape?.sideExit ? { sideExit: true } : {}),
					},
				],
			},
		},
	};
}

/** The stand-in character the prop view drops: a fisherman (the bridge's own) at world `x, y`. */
export type StandIn = { x: number; y: number; character: string };

/** Where the stand-in stands: how high (world px, the rule's `z`), on the deck's row when on it,
 *  and how many the prop carries (`occupied`, `bridgeOccupancy`'s count). */
export function standInOn(def: ComponentDef, at: StandIn) {
	const game = propPreviewGame(def);
	const decks = bridgeDecks(game);
	const on = bridgeDeckAt(decks, at, (d) => !d.characters || d.characters.includes(at.character));
	const z = on ? on.lift * CELL : 0;
	const row = on && !on.deck.sideExit ? on.deck.y + CELL / 2 : at.y;
	const occupied = bridgeOccupancy(game, [{ ...at, y: row, z }]).get(propPreviewZone(def).id) ?? 0;
	return { z, y: row, occupied };
}

/** The triggers a move of the stand-in fires: `stepOn` as `occupied` leaves 0, `stepOff` back. */
export function standInSteps(before: number, after: number): string[] {
	const { on, off } = occupancySteps(new Map([['z', before]]), new Map([['z', after]]));
	return [...(on.length ? ['stepOn'] : []), ...(off.length ? ['stepOff'] : [])];
}

/** The prop block, for a read that does not change it. */
export const propOfDef = (def: ComponentDef): ArcadeProp | undefined => def.prop;

/** A box on the ground, world px. */
export type GroundBox = { x: number; y: number; w: number; h: number };

/** Half a fisherman's box across the row (`salmons.js` `BODIES.fisherman`, 88 px tall): the water
 *  opens that far past the deck's row on each side (`originalBounds`' bridge holes). */
const FISHER_HALF = 44;

/**
 * The collider the prop view draws over the preview zone, world px: the deck, each ramp (from its
 * deck end's cell middle out), the snap band across the row over both, the hole the water opens
 * (as `salmons.js` `originalBounds` cuts it), each solid, and where the three handles sit.
 */
export function propColliderOverlay(def: ComponentDef) {
	const prop = def.prop;
	if (!prop) return undefined;
	const zone = propPreviewZone(def);
	const near = propLengthValue(def, 'near') * CELL;
	const far = propLengthValue(def, 'far') * CELL;
	const snap = prop.collider.snap * CELL;
	const from = zone.x + CELL / 2;
	const to = zone.x + zone.w - CELL / 2;
	const row = zone.y + CELL / 2;
	const open = prop.collider.hole === 'deck' ? { near: 0, far: 0 } : { near, far };
	const hole: GroundBox | undefined =
		prop.collider.hole === 'none'
			? undefined
			: {
					x: zone.x - open.near,
					y: zone.y - FISHER_HALF,
					w: zone.w + open.near + open.far,
					h: CELL + 2 * FISHER_HALF,
				};
	return {
		deck: { x: zone.x, y: zone.y, w: zone.w, h: zone.h } as GroundBox,
		ramps: {
			near: { x: from - near, y: zone.y, w: near, h: CELL } as GroundBox,
			far: { x: to, y: zone.y, w: far, h: CELL } as GroundBox,
		},
		snap: { x: from - near, y: row - snap, w: to - from + near + far, h: 2 * snap } as GroundBox,
		hole,
		solids: (prop.collider.solids ?? []).map((s): GroundBox => ({
			x: zone.x + s.x * CELL,
			y: zone.y + s.y * CELL,
			w: s.w * CELL,
			h: s.h * CELL,
		})),
		handles: {
			near: { x: from - near, y: row },
			far: { x: to + far, y: row },
			snap: { x: (from + to) / 2, y: row + snap },
		},
	};
}

/** A handle dragged to world `(x, y)`: the ramp lengths in whole cells, the snap from the row. */
export function dragColliderHandle(
	def: ComponentDef,
	handle: 'near' | 'far' | 'snap',
	at: { x: number; y: number },
): boolean {
	const zone = propPreviewZone(def);
	if (handle === 'snap') return dragSnap(def, (at.y - (zone.y + CELL / 2)) / CELL);
	const from = zone.x + CELL / 2;
	const to = zone.x + zone.w - CELL / 2;
	return dragRamp(def, handle, handle === 'near' ? (from - at.x) / CELL : (at.x - to) / CELL);
}

/** A solid's box from world px back to the deck's cells. */
export function solidBoxOf(def: ComponentDef, box: GroundBox): SolidBox {
	const zone = propPreviewZone(def);
	return {
		x: (box.x - zone.x) / CELL,
		y: (box.y - zone.y) / CELL,
		w: box.w / CELL,
		h: box.h / CELL,
	};
}
