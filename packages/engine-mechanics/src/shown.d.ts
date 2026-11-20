/**
 * Types for what a device's screen shows and the region a nearby room sends it by (`shown.js`,
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

export function nearbyRegion(
	nearby: { w: number; h: number; max?: { w: number; h: number } },
	shown?: Partial<Shown>,
	past?: number,
): NearbyRegion;

export function regionHolds(region: NearbyRegion, dx: number, dy: number): boolean;
