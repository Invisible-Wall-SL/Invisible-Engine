/**
 * Types for `propShape.js`: a prop component's collider compiled for the rules
 * (`docs/design/arcade-prop-components.md` §2–§3). Pinned by `scripts/check-prop-shape.mjs`.
 */

export const PROP_ZONE_KINDS: readonly ['bridge'];
export const PROP_HOLES: readonly ['deckAndRamps', 'deck', 'none'];
export const PROP_SOLID_COLLIDES: readonly ['solid', 'oneWay'];
export const PROP_SOLID_SIDES: readonly ['below', 'above', 'left', 'right'];
export const PROP_MAX_SNAP: 1;
/** The most solids, character ids per list, and letters an id, a prop's collider holds. */
export const PROP_MAX_SOLIDS: 8;
export const PROP_MAX_CHARACTERS: 8;
export const PROP_MAX_ID: 32;

export type PropZoneKind = (typeof PROP_ZONE_KINDS)[number];
export type PropShapeHole = (typeof PROP_HOLES)[number];

/** A length in cells: a number, or a param of the def plus an offset. */
export type PropShapeLength = number | { param: string; plus?: number };

export type PropShapeSolid = {
	x: number;
	y: number;
	w: number;
	h: number;
	collide: (typeof PROP_SOLID_COLLIDES)[number];
	side?: (typeof PROP_SOLID_SIDES)[number];
	characters?: string[];
};

/** What the compile reads of a component def: structurally `engine-layout`'s `ComponentDef`. */
export type PropShapeInput = {
	id: string;
	version: number;
	params?: readonly { key: string; kind: string; default?: unknown; engineProvided?: boolean }[];
	prop?: {
		zoneKind: string;
		fromZone: { length: string; height?: string };
		collider: {
			characters?: readonly string[];
			deck: { from: PropShapeLength; to: PropShapeLength; height: PropShapeLength };
			snap: number;
			ramps: { near: { length: PropShapeLength }; far: { length: PropShapeLength } };
			hole: string;
			solids?: readonly PropShapeSolid[];
			sideExit?: boolean;
		};
	};
};

/** The compiled shape: plain JSON, what the server and the generator read. A field is present
 *  only when it differs from {@link PROP_SHAPE_DEFAULTS}. */
export type PropShape = {
	from: { component: string; version: number };
	zoneKind: PropZoneKind;
	characters?: string[];
	/** Cells, the deck's height when a level names none. */
	height?: number;
	/** Cells. */
	snap?: number;
	/** Cells, both ends (present when either differs). */
	ramp?: { near: number; far: number };
	hole?: PropShapeHole;
	solids?: PropShapeSolid[];
	/** A body moving across the row is not held on it (present only when on). */
	sideExit?: true;
};

export const PROP_SHAPE_DEFAULTS: Readonly<
	Record<
		PropZoneKind,
		Readonly<{
			characters: readonly string[];
			height: number;
			snap: number;
			ramp: Readonly<{ near: number; far: number }>;
			hole: PropShapeHole;
			sideExit: false;
		}>
	>
>;

export class PropShapeError extends Error {
	readonly errors: string[];
	constructor(errors: string[]);
}

/** The problems that stop `def` compiling; `[]` when it compiles. */
export function propShapeErrors(def: PropShapeInput): string[];
/** `def.prop` as the rules read it. Throws a {@link PropShapeError} when it does not compile. */
export function compilePropShape(def: PropShapeInput): PropShape;

/** Compiled shapes by zone family, read from anything (a room's state, a config), defaults and
 *  unplayable fields dropped; `undefined` for none. */
export function readPropShapes(raw: unknown): Readonly<Record<string, PropShape>> | undefined;
