import type { ArtMount } from '../arcadeArt.svelte';
import type { InstanceLinkStyle } from '../arcadeMarks.svelte';
import type { SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import { loadSalmonsTextures, type ProjectSheet } from './load';
import { riverElevation } from '../referenceLayouts/salmonsElevation';
import { createLookFactory, type CodeLook, type LookEvent, type LookFrame } from './looks';
import { mountSalmonsRiver, type RiverArt } from './river';

/**
 * SALMONS' ORIGINAL ART, BUILT IN (`engine-layout/salmons-art`): the river and the characters
 * drawn with the old game's own images, animated in code as its client animated them. Imported
 * lazily by the online runtime (`apps/lines` `game/online.ts`) only for a room whose config names
 * the `salmonsRiver` generator, so no other game loads a byte of it. Provenance: `README.md`.
 */

export type { CodeLook, LookEvent, LookFrame, ProjectSheet };

/** How long a cast's line wiggles, ms, and its look (the old client's fishing line). */
const CAST_MS = 450;
const LINE = { width: 2, color: 0xddddaa, alpha: 0.9, dot: { r: 4, color: 0xffee88 } };

export type SalmonsArt = {
	/** The river drawn in art, as `<IsoWorld>` mounts it in place of the `river` node. */
	river: ArtMount;
	/** A character's look by its character id, at its body's size; none for another. */
	look: (character: string, body: { w: number; h: number }) => CodeLook | undefined;
	/** How far the ground at a world place is drawn raised by the waterfalls below it, screen px:
	 *  a character there is drawn as high (`referenceLayouts/salmonsElevation.ts`). */
	ground: (x: number, y: number) => number;
	/** The fishing line's style, `sinceCastMs` after the cast, from a hand `fromDx` across. */
	line: (sinceCastMs: number, nowMs: number, fromDx: number) => InstanceLinkStyle;
	/** The river's pieces drawn with a Salmons texture, by region (the probe's). */
	regions: () => Record<string, number>;
	/** How many rivers are drawn now, and whether the last one drawn is destroyed (the probe's). */
	rivers: () => { live: number; destroyed: boolean };
	destroy: () => void;
};

/**
 * Load the art and make the kit that draws `river` (a room's own, from its `seed`): each region
 * from the project's published sheets (`sheets`) when they ship it, else the built-in copy.
 */
export async function loadSalmonsArt(
	river: SalmonsRiverDrawing,
	seed: number,
	sheets: readonly ProjectSheet[] = [],
): Promise<SalmonsArt> {
	const textures = await loadSalmonsTextures(sheets);
	const looks = createLookFactory(textures, river);
	const elevation = riverElevation(river.waterfalls);
	let drawn: RiverArt | undefined;
	let live = 0;
	return {
		river: (into, app) => {
			const art = mountSalmonsRiver(into, app, textures, river, seed);
			drawn = art;
			live += 1;
			return () => {
				art.teardown();
				live -= 1;
			};
		},
		look: looks.look,
		ground: (_x, y) => elevation.at(y),
		line: (sinceCastMs, nowMs, fromDx) => {
			const k = Math.min(1, Math.max(0, sinceCastMs / CAST_MS));
			return {
				...LINE,
				fromDx,
				...(k < 1 ? { wiggle: { amp: 14 * (1 - k), phase: nowMs * 0.018 } } : {}),
			};
		},
		regions: () => drawn?.regions() ?? {},
		rivers: () => ({ live, destroyed: drawn?.destroyed() ?? false }),
		destroy: looks.destroy,
	};
}
