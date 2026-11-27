import type {
	ArcadeProp,
	ContainerNode,
	LayoutNode,
	PropCollider,
	PropDepth,
	PropLength,
	PropSolid,
} from 'engine-layout';
import { PROP_DEPTHS } from 'engine-layout';
import {
	PROP_HOLES,
	PROP_MAX_SOLIDS,
	PROP_SOLID_COLLIDES,
	PROP_SOLID_SIDES,
} from 'engine-mechanics/src/propShape.js';

/**
 * A PROP component's blocks as the launcher saves them (`docs/design/arcade-prop-components.md`
 * §2): the def's `prop` and each node's `propDepth` / `propZOffset`. Shape only, with the kind lists
 * imported from where they are defined; what the rules can PLAY is `compilePropShape`'s to say.
 */

const PROP_DEPTH_SET = new Set<PropDepth>(PROP_DEPTHS);
const HOLES = new Set<PropCollider['hole']>(PROP_HOLES);
const SOLID_COLLIDES = new Set<PropSolid['collide']>(PROP_SOLID_COLLIDES);
const SOLID_SIDES = new Set<NonNullable<PropSolid['side']>>(PROP_SOLID_SIDES);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const propLength = (v: unknown): PropLength | undefined => {
	if (finite(v)) return v;
	if (!isRecord(v) || typeof v.param !== 'string' || !v.param) return undefined;
	return finite(v.plus) ? { param: v.param, plus: v.plus } : { param: v.param };
};

const characterIds = (v: unknown): string[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const ids = [...new Set(v.filter((c): c is string => typeof c === 'string' && !!c))];
	return ids.length ? ids : undefined;
};

function normalizePropSolid(v: unknown): PropSolid | undefined {
	if (!isRecord(v) || ![v.x, v.y, v.w, v.h].every(finite)) return undefined;
	if (!SOLID_COLLIDES.has(v.collide as PropSolid['collide'])) return undefined;
	const out: PropSolid = {
		x: v.x as number,
		y: v.y as number,
		w: v.w as number,
		h: v.h as number,
		collide: v.collide as PropSolid['collide'],
	};
	if (SOLID_SIDES.has(v.side as NonNullable<PropSolid['side']>)) {
		out.side = v.side as PropSolid['side'];
	}
	const characters = characterIds(v.characters);
	if (characters) out.characters = characters;
	return out;
}

/**
 * A def's `prop` as saved: its known fields of the right shape, or `undefined` when it lacks a zone
 * kind, the zone's length param, a deck, both ramps, a snap or a known hole, or holds more than
 * `PROP_MAX_SOLIDS` solids (a save refuses such a
 * block, `validateComponent`; a stored one reads as no prop and a save puts it back whole,
 * `withUnknownComponentFields`). The values are kept as authored: what the rules can play is the
 * compile's to say. A zone kind this build does not know is kept, like an input's `source`;
 * malformed solids, characters and preview entries drop.
 */
export function normalizeProp(input: unknown): ArcadeProp | undefined {
	if (!isRecord(input) || typeof input.zoneKind !== 'string' || !input.zoneKind) return undefined;
	const fromZone = isRecord(input.fromZone) ? input.fromZone : {};
	if (typeof fromZone.length !== 'string' || !fromZone.length) return undefined;
	const c = isRecord(input.collider) ? input.collider : {};
	const deck = isRecord(c.deck) ? c.deck : {};
	const ramps = isRecord(c.ramps) ? c.ramps : {};
	const [from, to, height] = [deck.from, deck.to, deck.height].map(propLength);
	const near = propLength(isRecord(ramps.near) ? ramps.near.length : undefined);
	const far = propLength(isRecord(ramps.far) ? ramps.far.length : undefined);
	if (from === undefined || to === undefined || height === undefined) return undefined;
	if (near === undefined || far === undefined || !finite(c.snap)) return undefined;
	if (!HOLES.has(c.hole as PropCollider['hole'])) return undefined;
	const characters = characterIds(c.characters);
	const collider: PropCollider = {
		...(characters ? { characters } : {}),
		deck: { from, to, height },
		snap: c.snap,
		ramps: { near: { length: near }, far: { length: far } },
		hole: c.hole as PropCollider['hole'],
	};
	if (Array.isArray(c.solids) && c.solids.length > PROP_MAX_SOLIDS) return undefined;
	if (Array.isArray(c.solids)) {
		const solids = c.solids.map(normalizePropSolid).filter((s): s is PropSolid => !!s);
		if (solids.length) collider.solids = solids;
	}
	if (c.sideExit === true) collider.sideExit = true;
	const prop: ArcadeProp = {
		zoneKind: input.zoneKind,
		fromZone:
			typeof fromZone.height === 'string' && fromZone.height
				? { length: fromZone.length, height: fromZone.height }
				: { length: fromZone.length },
		collider,
	};
	if (isRecord(input.preview)) {
		const preview = Object.fromEntries(
			Object.entries(input.preview).filter((e): e is [string, number] => finite(e[1])),
		);
		if (Object.keys(preview).length) prop.preview = preview;
	}
	return prop;
}

/**
 * A node's prop band, depth offset and cell, kept only of the right shape (a band `PROP_DEPTHS`
 * lists, a finite offset, a `PropLength` cell). A tree without a malformed one is the same object.
 */
export function normalizePropDepths(root: ContainerNode): ContainerNode {
	const walk = (node: LayoutNode): LayoutNode => {
		if (!isRecord(node)) return node;
		const kids = node.kind === 'container' && Array.isArray(node.children) ? node.children : [];
		const children = kids.map(walk);
		const badDepth = 'propDepth' in node && !PROP_DEPTH_SET.has(node.propDepth as PropDepth);
		const badOffset = 'propZOffset' in node && !finite(node.propZOffset);
		const badCell = 'propCell' in node && propLength(node.propCell) === undefined;
		const moved = children.some((c, i) => c !== kids[i]);
		if (!badDepth && !badOffset && !badCell && !moved) return node;
		const next: Record<string, unknown> = { ...node };
		if (badDepth) delete next.propDepth;
		if (badOffset) delete next.propZOffset;
		if (badCell) delete next.propCell;
		if (moved) next.children = children;
		return next as unknown as LayoutNode;
	};
	return walk(root) as ContainerNode;
}
