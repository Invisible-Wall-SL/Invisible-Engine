import { registerBoundComponents, resolveFlipbook, type LayoutDoc } from 'engine-layout';
import { ZONE_ART_RIG, withZoneArtNodes } from 'engine-layout/zone-art';
import {
	normalizeGameConfigDoc,
	usesSalmonsArt,
	zoneArtNamesRig,
	zoneArtOf,
	zoneArtStamps,
	type ArcadeZone,
	type ZoneArt,
	type ZoneArtScenery,
	type ZoneStamp,
} from 'game-config';

import ZoneArtRig from '../components/ZoneArtRig.svelte';
import { bakedGameConfig } from '../editor-scenes';

/**
 * ZONE ART, ON THE ARCADE RUNTIME (`docs/design/zone-art.md`): the stamps Game Config's
 * `arcade.zoneArt` (read off the baked config: the normalizer drops it) draws on the zones the game
 * plays, chosen by the room's seed (`0` offline), the
 * same on every device. Cosmetic: nothing here reaches the loop, a rule or the room.
 *
 * A game whose generator makes its zones draws them in its generator's own art (Salmons:
 * `online.ts` hands the room's stamps to the river); a game of its config's own zones draws them as
 * layout nodes under its play field's spawn layer ({@link withZoneArt}). A config with no zone art
 * changes nothing.
 * Reached only through the arcade family's seam, so no other runtime carries it.
 */

/** The stamps of `zones` in a room seeded `seed`; empty for a config with no zone art. */
export function zoneStampsOf(zones: readonly ArcadeZone[], seed: number | string): ZoneStamp[] {
	return zoneArtStamps(zones, zoneArtOf(bakedGameConfig()), seed);
}

/** What the config's zone art draws the generator's scenery `key` with (`@trees`); none ⇒ the
 *  built-in scenery. */
export const zoneSceneryOf = (key: ZoneArtScenery): ZoneArt | undefined =>
	zoneArtOf(bakedGameConfig())?.[key];

/** Whether the config's zone art names a rig: only then is the rig drawing loaded. */
export const zoneArtDrawsRig = (): boolean => zoneArtNamesRig(zoneArtOf(bakedGameConfig()));

/** A registered clip's Bounds box: a stamp of it keeps its ratio. */
const clipSize = (clipId: string) => {
	const bounds = resolveFlipbook(clipId)?.bounds;
	return bounds && bounds.w > 0 && bounds.h > 0 ? { w: bounds.w, h: bounds.h } : undefined;
};

/**
 * `doc` with its zone stamps as layout nodes, for a game whose zones are its config's own (the
 * arcade seam passes the loaded doc through it, `editor-scenes` `setRoomDocChange`): drawn under
 * the online room's layer, or offline the play field's. `doc` itself when nothing is drawn, and for
 * a game whose generator makes its zones: a room of one replaces this change with its own field
 * (`online.ts` `withRoomField`), whose art draws the stamps. A rig stamp's node binds
 * `ZoneArtRig.svelte`, registered here before the layout mounts, only when the zone art names a
 * rig.
 */
export function withZoneArt(doc: LayoutDoc): LayoutDoc {
	const baked = bakedGameConfig();
	const map = zoneArtOf(baked);
	if (!map) return doc;
	const config = normalizeGameConfigDoc(baked);
	const arcade = config?.arcade;
	if (!arcade || usesSalmonsArt(config) || arcade.online?.generator) return doc;
	if (zoneArtNamesRig(map)) registerBoundComponents({ [ZONE_ART_RIG]: ZoneArtRig });
	return withZoneArtNodes(doc, zoneArtStamps(arcade.zones ?? [], map, 0), {
		layer: arcade.online?.layer,
		clipSize,
	});
}
