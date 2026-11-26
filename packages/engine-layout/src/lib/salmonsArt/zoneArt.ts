import { DEFAULT_FLIPBOOK_FPS, resolveClipFrames } from 'engine-flipbook';
import type { ZoneArt, ZoneArtSource, ZoneStamp } from 'game-config';
import type { Texture } from 'pixi.js';

import { editorArtTextureKey } from '../editorArtKey';
import { resolveFlipbook } from '../registerFlipbooks';
import type { ZoneRigDraw } from '../zoneArtRig';

/**
 * THE ZONE ART A SALMONS RIVER IS DRAWN WITH (`docs/design/zone-art.md`): the room's zone stamps
 * (`game-config` `zoneArtStamps` of the room's own zones), the scenery's art (`@trees`) and the
 * game's loaded assets, read when the river mounts. `river.ts` draws a rock or a whirlpool whose
 * zone has a stamp with the stamp's picture in the built-in one's place, any other stamp upright on
 * its zone, and every tree with one of the trees' pictures in place of `tree_N`. A zone with no
 * stamp, a tree with no art, or one whose picture is not loaded (a rig too, or one with no rig
 * drawing), draws as the built-in art does.
 */
export type SalmonsZoneArt = {
	stamps: readonly ZoneStamp[];
	/** What every scattered and forest tree is drawn with (`arcade.zoneArt['@trees']`). */
	trees?: ZoneArt;
	/** The game's loaded assets (`pixi-svelte` `stateApp.loadedAssets`). */
	assets: () => Record<string, unknown> | undefined;
	/** Loads the rig drawing (`engine-layout/zone-art-rig`), handed by the runtime only when the
	 *  art names a rig, so this chunk never imports it; `undefined` when it did not load. The art
	 *  loads it beside its textures (`loadSalmonsArt`). */
	loadRig?: () => Promise<ZoneRigDraw | undefined>;
};

/** The zone art as the river draws it: the rig drawing loaded. Absent ⇒ a rig picture draws the
 *  built-in piece. */
export type RiverZoneArt = Omit<SalmonsZoneArt, 'loadRig'> & { rig?: ZoneRigDraw };

/** A stamp's picture as the river draws it: its frames (one for a sheet's frame) and their rate. */
export type ZoneFrames = { textures: Texture[]; fps: number };

/** `source`'s frames among `assets`, or `undefined` while any is missing (the built-in draws);
 *  none for a rig, which is drawn by the rig drawing. */
export function zoneFrames(
	source: ZoneArtSource,
	assets: Record<string, unknown> | undefined,
): ZoneFrames | undefined {
	if (source.kind === 'sprite') {
		const at = source.region.indexOf('::');
		const texture = assets?.[
			editorArtTextureKey(source.region.slice(0, at), source.region.slice(at + 2))
		] as Texture | undefined;
		return texture ? { textures: [texture], fps: 0 } : undefined;
	}
	if (source.kind !== 'flipbook') return undefined;
	const clip = resolveFlipbook(source.clip);
	if (!clip) return undefined;
	const { textures, missing } = resolveClipFrames(clip, assets);
	if (missing.length || !textures.length) return undefined;
	return {
		textures: textures as Texture[],
		fps: source.fps ?? clip.fps ?? DEFAULT_FLIPBOOK_FPS,
	};
}
