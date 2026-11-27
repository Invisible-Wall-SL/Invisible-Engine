import type { ArtMount } from '../arcadeArt.svelte';
import type { InstanceLinkStyle } from '../arcadeMarks.svelte';
import { BRIDGE_PROP_DEF } from '../propComponents';
import type { PropZone } from '../propPieces';
import { riverElevation } from '../referenceLayouts/salmonsElevation';
import type { SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import type { CinematicDoc, ComponentDef } from '../types';
import { worldDrawing } from '../worldDrawing.svelte';
import { BLOOD, bloodOpacity, createBlood, type StainList } from './blood';
import { aloftDepth, aloftLift } from './bridge';
import { createFloats, type FloatAt } from './floats';
import { loadSalmonsTextures, type ProjectSheet } from './load';
import { createLookFactory, type CodeLook, type LookEvent, type LookFrame } from './looks';
import { mountSalmonsRiver, type RiverArt } from './river';
import { showSalmonsBridges, type BridgeGame, type SalmonsBridges } from './bridgeProps';
import {
	createSalmonsScreens,
	type CaughtShown,
	type LobbyShown,
	type RiverListing,
	type SalmonsScreenHost,
	type SalmonsScreens,
} from './screens';
import { createWading, type WadeDrawn, type WadeFrame } from './wade';
import { wadeSurface, warmWade } from './wadeFilter';
import { TINT_ALPHA, waterUnder } from './water';
import type { WinShown } from './winAnimation';
import type { RiverZoneArt, SalmonsZoneArt } from './zoneArt';

/**
 * SALMONS' ORIGINAL ART, BUILT IN (`engine-layout/salmons-art`): the river and the characters
 * drawn with the old game's own images, animated in code as its client animated them. Imported
 * lazily by the online runtime (`apps/lines` `game/online.ts`) only for a room whose config names
 * the `salmonsRiver` generator, so no other game loads a byte of it. Provenance: `README.md`.
 * One thing here is not the old client's: the bear wades (`wade.ts`, `wadeFilter.ts`), drawn half
 * under the water it stands in whatever draws it.
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
	SalmonsZoneArt,
	StainList,
	WadeDrawn,
	WadeFrame,
	WinShown,
};
export { BLOOD };
export { chooseSalmonsStart, type SalmonsStartHost, type StartChoice } from './startMenu';
export { placeSalmonsProp, type PlacedPiece } from './propPlacement';
export type { BridgePlayer, SalmonsBridges } from './bridgeProps';

/** How long a cast's line wiggles, ms, and its look (the old client's fishing line). */
const CAST_MS = 450;
const LINE = { width: 2, color: 0xddddaa, alpha: 0.9, dot: { r: 4, color: 0xffee88 } };

export type SalmonsArt = {
	/** The river drawn in art, as `<IsoWorld>` mounts it in place of the `river` node, with the
	 *  bloodstains over it (`blood.ts`). */
	river: ArtMount;
	/** A character's look by its character id, at its body's size; none for another. */
	look: (character: string, body: { w: number; h: number }) => CodeLook | undefined;
	/** The mount to publish for player `id` this frame, whose look (a code look, a sheet's rig or
	 *  its turned clip) is mounted by `look`: its own for a character that wades (the bear), which
	 *  draws it half under the water it stands in, else `look` itself (`wade.ts`). */
	wade: (id: string, look: ArtMount, frame: WadeFrame) => ArtMount;
	/** The players drawn this frame: the wading of any other is let go. */
	wadersDrawn: (drawn: (id: string) => boolean) => void;
	/** Raise `text` over player `id` (the catcher's "you catch NAME!"): it rises and fades. */
	float: (id: string, text: string, nowMs: number) => void;
	/** This frame's rising texts, each over where its player is drawn (`at`), however it is drawn. */
	floats: (nowMs: number, at: (id: string) => FloatAt | undefined) => void;
	/** The texts rising now, by player (the probe's). */
	floating: () => Record<string, string[]>;
	/** How far the ground at a world place is drawn raised by the waterfalls below it, screen px:
	 *  a character there is drawn as high (`referenceLayouts/salmonsElevation.ts`). */
	ground: (x: number, y: number) => number;
	/** How far over that ground a character the room has put `zPx` high (world px) is drawn, screen
	 *  px, by its place (a fisherman on a bridge's deck); 0 for a salmon, whose look draws its own
	 *  height (`bridge.ts` `aloftLift`). */
	aloft: (character: string, zPx: number) => number;
	/** The depth bias of a body drawn `lift` up by {@link aloft}: over the deck it stands on
	 *  (`bridge.ts` `aloftDepth`). */
	aloftDepth: (lift: number) => number;
	/** This frame's bloodstains (the room's `stains`), and the trail's fade, at `nowMs`. */
	stains: (stains: StainList | undefined, nowMs: number) => void;
	/** The fishing line's style, `sinceCastMs` after the cast, from a hand `fromDx` across. */
	line: (sinceCastMs: number, nowMs: number, fromDx: number) => InstanceLinkStyle;
	/** The screens drawn in code (the win animation, the death screen, the lobby's note, the
	 *  loading phrases), their buttons acting through `host`. */
	screens: (host: SalmonsScreenHost) => SalmonsScreens;
	/** Publish the room's bridges (`bridge<i>` zones of `game`) for spawn layer `layer`, drawn by
	 *  `def` (the room's prop component, `roomPropDef`), else the seed `bridgeProp`, on the river's
	 *  raised ground, before the river is drawn. The prop built-ins are registered once a page; their
	 *  timelines whenever a registration has dropped them, after the engine's and before the
	 *  project's as `projectTimelines()` gives them then. */
	bridges: (
		game: BridgeGame & { zones: readonly PropZone[] },
		layer: string,
		projectTimelines: () => readonly CinematicDoc[],
		def?: ComponentDef,
	) => SalmonsBridges;
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
	/** Each wading character whose look is mounted, by player: how deep, under which tint, at
	 *  which waterline, and whether through the filter (the probe's). */
	wading: () => Record<string, WadeDrawn>;
	destroy: () => void;
};

/**
 * Load the art and make the kit that draws `river` (a room's own, from its `seed`): each region
 * from the project's published sheets (`sheets`) when they ship it, else the built-in copy.
 * `stains` is how see-through the game's config draws the blood (`arcade.online.rules.stains`);
 * `zoneArt` the room's zone stamps and its trees' art (Game Config `arcade.zoneArt`), its rig
 * drawing loaded beside the textures when it names a rig; none ⇒ the built-in art alone.
 */
export async function loadSalmonsArt(
	river: SalmonsRiverDrawing,
	seed: number,
	sheets: readonly ProjectSheet[] = [],
	stains?: { opacity?: number; trailOpacity?: number },
	zoneArt?: SalmonsZoneArt,
): Promise<SalmonsArt> {
	// The rig drawing, when zone art names a rig, loads beside the textures.
	const [textures, rig] = await Promise.all([loadSalmonsTextures(sheets), zoneArt?.loadRig?.()]);
	const riverZoneArt: RiverZoneArt | undefined = zoneArt && {
		stamps: zoneArt.stamps,
		trees: zoneArt.trees,
		assets: zoneArt.assets,
		...(rig ? { rig } : {}),
	};
	const waterAt = (x: number, y: number) => waterUnder(river, x, y);
	const elevation = riverElevation(river.waterfalls);
	const blood = createBlood(
		(_x, y) => elevation.at(y),
		bloodOpacity(stains),
		() => worldDrawing().projector,
	);
	const looks = createLookFactory(textures, waterAt, TINT_ALPHA, blood);
	const floats = createFloats(() => worldDrawing().projector);
	const wading = createWading(waterAt, TINT_ALPHA, wadeSurface);
	let drawn: RiverArt | undefined;
	let live = 0;
	return {
		river: (into, app) => {
			const art = mountSalmonsRiver(
				into,
				app,
				textures,
				river,
				seed,
				worldDrawing().projector,
				riverZoneArt,
			);
			const stains = blood.mount(into, app);
			warmWade(app);
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
		wade: wading.mount,
		wadersDrawn: wading.keep,
		float: floats.add,
		floats: floats.frame,
		floating: floats.drawn,
		ground: (_x, y) => elevation.at(y),
		aloft: aloftLift,
		aloftDepth,
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
		bridges: (game, layer, projectTimelines, def = BRIDGE_PROP_DEF) =>
			showSalmonsBridges(def, game, layer, (y) => elevation.at(y), projectTimelines),
		regions: () => drawn?.regions() ?? {},
		rivers: () => ({ live, destroyed: drawn?.destroyed() ?? false, among: drawn?.among() }),
		blood: blood.drawn,
		wading: wading.drawn,
		destroy: () => {
			wading.destroy();
			looks.destroy();
			floats.destroy();
			blood.destroy();
		},
	};
}
