import { Rectangle, type Application, type Container, type Filter } from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import { underTint } from './leap';
import type { WaterAt } from './looks';

/**
 * THE BEAR WADES (owner, 2026-11-25: "it looks like it is walking on water … half of the bear body
 * is underwater, so it takes a 'water overlay' colour"; "a curved line … so it follows the round
 * shape of the bear body"). While a bear's place is on open water that has a tint (`water.ts`
 * `waterUnder`: not a bank, a sandbank, a rock or the sea), what draws it is drawn through one
 * filter pass (`wadeFilter.ts`): below a waterline its own pixels are mixed to that cell's tint
 * exactly as the swimming salmon's are (`leap.ts` `underTint`), above it they are as they were.
 *
 * THE WATERLINE is the front arc of the ellipse a round body cuts in the water plane, about the
 * character's place (its feet; x right, y down), upright on the screen whatever turns or mirrors
 * the look inside it: `y(x) = level + sag · √(1 − (x / reach)²)`, lowest in the middle, rising to
 * `level` at both ends and staying there beyond them. A thin lighter rim lies along it and it bobs
 * a little. Stepping in and out is eased: the line rises from under the look to its level and
 * falls back, and on land the look has no filter at all.
 *
 * WHOEVER DRAWS THE BEAR: the wading is the player's, not its look's. It wraps the mount the
 * runtime publishes for the player (`arcadeArt.svelte.ts`: its code look's, its sheet's rig's or
 * its clip's turned by its sheet), so the filter is on the container that mount draws into. A clip
 * published as a clip has no mount and is not covered (`docs/status/salmons.md`).
 */
export const WADE = Object.freeze({
	/** How high the waterline's ends stand, as a share of how high the look's middle is: a little
	 *  over it, so that with the dip about half the body is under. */
	depth: 1.1,
	/** The arc's half-width, as a share of the width the look is drawn at: its ends, where it
	 *  meets the level line at a corner, are at the picture's sides and not inside the body. */
	reach: 0.5,
	/** How far the arc dips in its middle, as a share of its half-width (an isometric circle's
	 *  front arc dips 0.5), and no further than `sagMax` of how high its ends stand: a low, wide
	 *  look (the bear seen from above) keeps its lower half under. */
	sag: 0.4,
	sagMax: 0.35,
	/** The lighter band along the line: how far it fades to each side, px, and how white. */
	rim: Object.freeze({ width: 3, alpha: 0.35 }),
	/** The line's slow rise and fall: how far, px, and how long a cycle, ms. */
	bob: Object.freeze({ px: 1.2, ms: 2400 }),
	/** How long stepping in, or out, takes. */
	easeMs: 250,
	/** The room the pass is given round the look's box, as a share of its longer side (and no
	 *  less than `marginMin` px), so a limb that swings out of the box is not cut. */
	margin: 0.25,
	marginMin: 8,
});

/** Who wades. The salmon swims under the water (`looks.ts`); the fisherman is over it only on a
 *  bridge's deck. */
const WADERS: ReadonlySet<string> = new Set(['bear']);

export const wades = (character: string): boolean => WADERS.has(character);

/** The tint a character stands half under: that of the water at its place ({@link WaterAt}), for
 *  one that wades; `undefined` for any other, and off the tinted water. */
export const wadingTint = (character: string, water: ReturnType<WaterAt>): number | undefined =>
	wades(character) ? water?.tint : undefined;

/** How far in a wader is `dtMs` later, 0 (on land) to 1 (in the water): {@link WADE}`.easeMs` to
 *  step in, and as long to step out. */
export const wadeProgress = (progress: number, inWater: boolean, dtMs: number): number =>
	Math.min(1, Math.max(0, progress + ((inWater ? 1 : -1) * Math.max(0, dtMs)) / WADE.easeMs));

/** How deep a wader stands at a progress, 0 to 1: eased at both ends. */
export const wadeDepth = (progress: number): number => progress * progress * (3 - 2 * progress);

/** A waterline about a character's place, px (x right, y down): `level` at its ends and beyond
 *  them, `sag` lower in its middle, `reach` its half-width. */
export type Waterline = { level: number; sag: number; reach: number };

/** How far down from the character's place the waterline is, `x` px right of it. */
export const waterlineAt = (line: Waterline, x: number): number => {
	const across = Math.min(1, Math.abs(x) / line.reach);
	return line.level + line.sag * Math.sqrt(1 - across * across);
};

/** How a wader stands on its place, px: how high its middle is drawn, how wide it is drawn, and
 *  how far below its place its look reaches. */
export type WadeBody = { middle: number; width: number; bottom: number };

/**
 * The waterline of a body `depth` in (0 to 1) at `atMs`: from under the look (its `bottom`) up to
 * {@link WADE}`.depth` of its middle, the arc opening and the bob growing as it rises.
 */
export function waterlineOf(depth: number, body: WadeBody, atMs: number): Waterline {
	const reach = Math.max(1, WADE.reach * body.width);
	const high = WADE.depth * body.middle;
	const bob = WADE.bob.px * Math.sin((atMs / WADE.bob.ms) * 2 * Math.PI);
	return {
		level: body.bottom + (bob - high - body.bottom) * depth,
		sag: Math.min(WADE.sag * reach, WADE.sagMax * high) * depth,
		reach,
	};
}

/** What draws a wader's water: a filter for the container its look is mounted in. */
export type WadeSurface = {
	readonly filter: Filter;
	/** Draw `look` under the colour matrix `under` ({@link underTint}) below `line`, which is about
	 *  the look's own place. */
	draw(look: Container, line: Waterline, under: readonly number[]): void;
	destroy(): void;
};

/** What the wading is told of a player each frame: who it is, where its place is (world px),
 *  when, and how its look stands on it (px as drawn: how high its middle is, how wide it is). */
export type WadeFrame = {
	character: string;
	x: number;
	y: number;
	atMs: number;
	middle: number;
	width: number;
};

export type WadeDrawn = {
	/** How deep it stands, 0 (on land) to 1. */
	depth: number;
	/** The tint it is half under, and its waterline; `null` on land. */
	tint: number | null;
	line: Waterline | null;
	/** Whether its look is drawn through the filter now. */
	filtered: boolean;
};

export type Wading = {
	/**
	 * The mount to publish for player `id` this frame, whose look is mounted by `look`: `look`
	 * itself for a character that does not wade, else one of the player's own that mounts the look
	 * and draws it half under the water it stands in. That mount is the same from frame to frame
	 * while `look` is: whoever keys on it does not mount the look again.
	 */
	mount: (id: string, look: ArtMount, frame: WadeFrame) => ArtMount;
	/** Let go of every player `drawn` does not hold: its filter with it. */
	keep: (drawn: (id: string) => boolean) => void;
	/** Each wading character whose look is mounted, as it is drawn now (the probe's). */
	drawn: () => Record<string, WadeDrawn>;
	destroy: () => void;
};

type Wader = {
	look: ArtMount;
	mount: ArtMount;
	/** The container its look is mounted in, and the app that draws it, while it is. */
	into: Container | undefined;
	app: Application | undefined;
	/** The container its filter is on, and the box the pass covers there. */
	filtered: Container | undefined;
	area: Rectangle;
	progress: number;
	inWater: boolean;
	atMs: number;
	/** The tint of the water it is in, or was last in, and its colour matrix. */
	tint: number;
	under: readonly number[];
	bottom: number;
	line: Waterline | undefined;
	/** Its filter, made when it first wades; `null` when it cannot be drawn. */
	surface: WadeSurface | null | undefined;
};

/**
 * The wading of a room: `waterAt` is the river's water at a place, `tintAlpha` how strongly its
 * tint covers what is under it, and `surface` makes the filter that draws it (none when the GPU
 * refuses it: the character is then drawn as on land).
 */
export function createWading(
	waterAt: WaterAt,
	tintAlpha: number,
	surface: (app: Application) => WadeSurface | undefined,
): Wading {
	const waders = new Map<string, Wader>();

	const bare = (wader: Wader) => {
		if (wader.filtered) {
			wader.filtered.filters = [];
			wader.filtered.filterArea = undefined;
		}
		wader.filtered = undefined;
	};
	/**
	 * Put the wader's water on the container its look is in, or take it off on land. The pass
	 * covers the look's box as it is this frame: Pixi's own measure for a filter finds no size in
	 * a rig (`engine-rig` `RigView` is measured through a part that is not drawn), and would skip
	 * the pass.
	 */
	const draw = (wader: Wader) => {
		const { into, app, line } = wader;
		if (!into || !app || !line) return bare(wader);
		const box = into.getLocalBounds();
		if (!(box.width > 0 && box.height > 0)) return bare(wader);
		if (wader.surface === undefined) wader.surface = surface(app) ?? null;
		if (!wader.surface) return;
		const margin = Math.max(WADE.marginMin, WADE.margin * Math.max(box.width, box.height));
		wader.area.x = box.minX - margin;
		wader.area.y = box.minY - margin;
		wader.area.width = box.width + 2 * margin;
		wader.area.height = box.height + 2 * margin;
		wader.surface.draw(into, line, wader.under);
		if (wader.filtered === into) return;
		bare(wader);
		into.filterArea = wader.area;
		into.filters = [wader.surface.filter];
		wader.filtered = into;
	};
	const bottomOf = (into: Container | undefined) =>
		into ? Math.max(0, into.getLocalBounds().maxY) : 0;
	const mountOf =
		(wader: Wader, look: ArtMount): ArtMount =>
		(into, app) => {
			const unmount = look(into, app);
			wader.into = into;
			wader.app = app;
			wader.bottom = bottomOf(into);
			draw(wader);
			return () => {
				if (wader.into === into) {
					wader.into = undefined;
					wader.app = undefined;
				}
				if (wader.filtered === into) bare(wader);
				unmount();
			};
		};
	const drop = (id: string) => {
		const wader = waders.get(id);
		if (!wader) return;
		bare(wader);
		wader.surface?.destroy();
		wader.surface = undefined;
		wader.line = undefined;
		waders.delete(id);
	};

	return {
		mount: (id, look, frame) => {
			if (!wades(frame.character)) {
				drop(id);
				return look;
			}
			const tint = wadingTint(frame.character, waterAt(frame.x, frame.y));
			const inWater = tint !== undefined;
			let wader = waders.get(id);
			if (!wader) {
				// First seen where it stands: in the water already, it does not step in.
				const made: Wader = {
					look,
					mount: look,
					into: undefined,
					app: undefined,
					filtered: undefined,
					area: new Rectangle(),
					progress: inWater ? 1 : 0,
					inWater,
					atMs: frame.atMs,
					tint: 0,
					under: [],
					bottom: 0,
					line: undefined,
					surface: undefined,
				};
				made.mount = mountOf(made, look);
				waders.set(id, made);
				wader = made;
			} else if (wader.look !== look) {
				wader.look = look;
				wader.mount = mountOf(wader, look);
			}
			if (inWater && (tint !== wader.tint || !wader.under.length)) {
				wader.tint = tint;
				wader.under = underTint(tint, tintAlpha);
			}
			if (inWater !== wader.inWater) {
				wader.inWater = inWater;
				wader.bottom = bottomOf(wader.into);
			}
			wader.progress = wadeProgress(wader.progress, inWater, frame.atMs - wader.atMs);
			wader.atMs = frame.atMs;
			const depth = wadeDepth(wader.progress);
			wader.line =
				depth > 0
					? waterlineOf(
							depth,
							{ middle: frame.middle, width: frame.width, bottom: wader.bottom },
							frame.atMs,
						)
					: undefined;
			draw(wader);
			return wader.mount;
		},
		keep: (drawn) => {
			for (const id of [...waders.keys()]) if (!drawn(id)) drop(id);
		},
		drawn: () =>
			Object.fromEntries(
				[...waders].flatMap(([id, wader]): [string, WadeDrawn][] =>
					wader.into
						? [
								[
									id,
									{
										depth: wadeDepth(wader.progress),
										tint: wader.line ? wader.tint : null,
										line: wader.line ?? null,
										filtered: (wader.into.filters?.length ?? 0) > 0,
									},
								],
							]
						: [],
				),
			),
		destroy: () => {
			for (const id of [...waders.keys()]) drop(id);
		},
	};
}
