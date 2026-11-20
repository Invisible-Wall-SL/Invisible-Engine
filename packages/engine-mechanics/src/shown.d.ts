/**
 * Types for what a device's screen shows and who a nearby room sends it by that (`shown.js`,
 * `docs/design/realtime-multiplayer.md` §5, §11). The behaviour is pinned by
 * `scripts/check-room-bots.mjs`.
 */

export const SHOWN_SHAPE: Readonly<{ flat: 0; iso: 1 }>;
export const SHOWN_GRID: 32;
export const SHOWN_MAX: number;

/** What a device says its screen shows, as its input carries it. 0 × 0: nothing. */
export type Shown = {
	/** The world's x extent (`shownIso` 0) or the isometric screen's across extent, whole px. */
	shownW: number;
	/** The world's y extent or the isometric screen's down extent, whole px. */
	shownH: number;
	/** A {@link SHOWN_SHAPE}. */
	shownIso: number;
};

export function shownOf(view: {
	/** The window (the canvas), CSS px. */
	window: { w: number; h: number };
	/** CSS px a design px is drawn (the layout's main box scale). Default 1. */
	windowScale?: number;
	/** Design px a world px is drawn (`cameraZoom`). Default 1. */
	zoom?: number;
	/** An isometric screen: the sizes are its across and down extents. */
	iso?: boolean;
	/** Added on every side, px. */
	margin?: number;
	/** How far the window's centre is from the own player, in the sizes' px. */
	off?: { x: number; y: number };
}): Shown;

/** The limits of `|dx|`, `|dy|`, `|dx − dy|` and `|dx + dy|` a region holds a player within. */
export type NearbyRegion = { x: number; y: number; across: number; down: number };

/** A room's resolved `online.nearby`: the box, and how far a declared view brings players in. */
export type NearbyBox = { w: number; h: number; max?: { w: number; h: number } };

/** The box as a region, `past` further out on every side. */
export function boxRegion(nearby: NearbyBox, past?: number): NearbyRegion;

/** A declared view inside `max` as a region; `undefined` with no `max` or nothing declared. */
export function viewRegion(nearby: NearbyBox, shown?: Partial<Shown>): NearbyRegion | undefined;

export function pastRegion<R extends NearbyRegion | undefined>(region: R, past: number): R;

export function widestRegion(
	a: NearbyRegion | undefined,
	b: NearbyRegion | undefined,
): NearbyRegion | undefined;

/** A device's held view: the widest declared in the window before (`before`) and so far in this
 *  one (`widest`), the patches this window has `left`, and the `view` the room sends by. */
export type HeldView = {
	before: NearbyRegion | undefined;
	widest: NearbyRegion | undefined;
	left: number;
	view: NearbyRegion | undefined;
};

export function holdView(
	hold: HeldView | undefined,
	view: NearbyRegion | undefined,
	patches: number,
): HeldView;

export function regionHolds(region: NearbyRegion, dx: number, dy: number): boolean;

/** Whether a device is sent a player: in its `box` or in its `view` (none: the box alone). */
export function nearbyHolds(
	box: NearbyRegion,
	view: NearbyRegion | undefined,
	dx: number,
	dy: number,
): boolean;
