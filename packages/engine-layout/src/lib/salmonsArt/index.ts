import type { ArtMount } from '../arcadeArt.svelte';
import type { InstanceLinkStyle } from '../arcadeMarks.svelte';
import { riverElevation } from '../referenceLayouts/salmonsElevation';
import type { SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import { worldDrawing } from '../worldDrawing.svelte';
import { BLOOD, bloodOpacity, createBlood, type StainList } from './blood';
import { createFloats, type FloatAt } from './floats';
import { loadSalmonsTextures, type ProjectSheet } from './load';
import { createLookFactory, type CodeLook, type LookEvent, type LookFrame } from './looks';
import { mountSalmonsRiver, TINT_ALPHA, waterUnder, type RiverArt } from './river';
import {
	createSalmonsScreens,
	type CaughtShown,
	type LobbyShown,
	type RiverListing,
	type SalmonsScreenHost,
	type SalmonsScreens,
} from './screens';
import type { WinShown } from './winAnimation';

/**
 * SALMONS' ORIGINAL ART, BUILT IN (`engine-layout/salmons-art`): the river and the characters
 * drawn with the old game's own images, animated in code as its client animated them. Imported
 * lazily by the online runtime (`apps/lines` `game/online.ts`) only for a room whose config names
 * the `salmonsRiver` generator, so no other game loads a byte of it. Provenance: `README.md`.
 */

export type {
	CaughtShown,
	CodeLook,
	FloatAt,
	LookEvent,
	LobbyShown,
	LookFrame,
	ProjectSheet,
	RiverListing,
	SalmonsScreenHost,
	SalmonsScreens,
	StainList,
	WinShown,
};
export { BLOOD };
export { chooseSalmonsStart, type SalmonsStartHost, type StartChoice } from './startMenu';

/** How long a cast's line wiggles, ms, and its look (the old client's fishing line). */
const CAST_MS = 450;
const LINE = { width: 2, color: 0xddddaa, alpha: 0.9, dot: { r: 4, color: 0xffee88 } };

export type SalmonsArt = {
	/** The river drawn in art, as `<IsoWorld>` mounts it in place of the `river` node, with the
	 *  bloodstains over it (`blood.ts`). */
	river: ArtMount;
	/** A character's look by its character id, at its body's size; none for another. */
	look: (character: string, body: { w: number; h: number }) => CodeLook | undefined;
	/** Raise `text` over player `id` (the catcher's "you catch NAME!"): it rises and fades. */
	float: (id: string, text: string, nowMs: number) => void;
	/** This frame's rising texts, each over where its player is drawn (`at`), however it is drawn. */
	floats: (nowMs: number, at: (id: string) => FloatAt | undefined) => void;
	/** The texts rising now, by player (the probe's). */
	floating: () => Record<string, string[]>;
	/** How far the ground at a world place is drawn raised by the waterfalls below it, screen px:
	 *  a character there is drawn as high (`referenceLayouts/salmonsElevation.ts`). */
	ground: (x: number, y: number) => number;
	/** This frame's bloodstains (the room's `stains`), and the trail's fade, at `nowMs`. */
	stains: (stains: StainList | undefined, nowMs: number) => void;
	/** The fishing line's style, `sinceCastMs` after the cast, from a hand `fromDx` across. */
	line: (sinceCastMs: number, nowMs: number, fromDx: number) => InstanceLinkStyle;
	/** The screens drawn in code (the win animation, the death screen, the lobby's note, the
	 *  loading phrases), their buttons acting through `host`. */
	screens: (host: SalmonsScreenHost) => SalmonsScreens;
	/** The river's pieces drawn with a Salmons texture, by region (the probe's). */
	regions: () => Record<string, number>;
	/** How many rivers are drawn now, whether the last one drawn is destroyed, and how many of its
	 *  pieces stand among the players (the probe's). */
	rivers: () => {
		live: number;
		destroyed: boolean;
		among: { drawn: number; layer: boolean } | undefined;
	};
	/** How many stains and trail puffs are drawn (the probe's). */
	blood: () => { stains: number; trail: number };
	destroy: () => void;
};

/**
 * Load the art and make the kit that draws `river` (a room's own, from its `seed`): each region
 * from the project's published sheets (`sheets`) when they ship it, else the built-in copy.
 * `stains` is how see-through the game's config draws the blood (`arcade.online.rules.stains`).
 */
export async function loadSalmonsArt(
	river: SalmonsRiverDrawing,
	seed: number,
	sheets: readonly ProjectSheet[] = [],
	stains?: { opacity?: number; trailOpacity?: number },
): Promise<SalmonsArt> {
	const textures = await loadSalmonsTextures(sheets);
	const waterAt = (x: number, y: number) => waterUnder(river, x, y);
	const elevation = riverElevation(river.waterfalls);
	const blood = createBlood(
		(_x, y) => elevation.at(y),
		bloodOpacity(stains),
		() => worldDrawing().projector,
	);
	const looks = createLookFactory(textures, waterAt, TINT_ALPHA, blood);
	const floats = createFloats(() => worldDrawing().projector);
	let drawn: RiverArt | undefined;
	let live = 0;
	return {
		river: (into, app) => {
			const art = mountSalmonsRiver(into, app, textures, river, seed, worldDrawing().projector);
			const stains = blood.mount(into, app);
			// The swimming salmon, and the trail and the stains on the water over it: over the tinted
			// ground, under the bridges' reflections and every upright piece of the river.
			art.aboveWater();
			drawn = art;
			live += 1;
			return () => {
				stains();
				art.teardown();
				live -= 1;
			};
		},
		look: looks.look,
		float: floats.add,
		floats: floats.frame,
		floating: floats.drawn,
		ground: (_x, y) => elevation.at(y),
		stains: blood.frame,
		line: (sinceCastMs, nowMs, fromDx) => {
			const k = Math.min(1, Math.max(0, sinceCastMs / CAST_MS));
			return {
				...LINE,
				fromDx,
				...(k < 1 ? { wiggle: { amp: 14 * (1 - k), phase: nowMs * 0.018 } } : {}),
			};
		},
		screens: (host) =>
			createSalmonsScreens(
				{ golden: textures.region('salmon_golden'), pink: textures.region('salmon_pink') },
				host,
			),
		regions: () => drawn?.regions() ?? {},
		rivers: () => ({ live, destroyed: drawn?.destroyed() ?? false, among: drawn?.among() }),
		blood: blood.drawn,
		destroy: () => {
			looks.destroy();
			floats.destroy();
			blood.destroy();
		},
	};
}
