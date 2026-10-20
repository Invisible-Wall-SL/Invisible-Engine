import { shownSceneIds, type FlowDoc } from 'engine-flow-v2';
import { SELF_MOUNTED_BANNER_SCREENS, sceneLayerZIndex, type Scene } from 'engine-layout';

import { modeSceneBaseId } from './respinModes';

/** A banner screen as the game mounts it: its scene and the z it stacks at. */
export type EngineBannerScreen = { scene: Scene; z: number };

/**
 * The banner screens the game mounts itself under a driven flow.
 *
 * A driven flow owns every screen, so a banner screen it never shows would never mount and the coded
 * banner would keep drawing over the artist's art. The game mounts each layout screen that:
 *  - is a self-mounted banner screen (`SELF_MOUNTED_BANNER_SCREENS`) or a respin mode's copy of one;
 *  - no `showContainer` of the flow shows (`shownSceneIds`). Declaring it does not count, since the
 *    `/flow-v2` editor declares every Scene-Editor screen; a flow that shows it anywhere owns it.
 *
 * Each is gated on its own banner's source, so mounted it draws only while its banner is up. A mode
 * screen mounts only while its mode is on screen (the caller's `sceneInActiveModes`), as on the coded
 * path's generic mount. The z is the screen's own `sceneLayerZIndex`, the resolver every flow
 * container uses. No driven flow ⇒ none: the coded path mounts them with the other author screens.
 */
export const engineBannerScreens = (
	doc: FlowDoc,
	scenes: Scene[],
	{ drivesScreens }: { drivesScreens: boolean },
): EngineBannerScreen[] => {
	if (!drivesScreens) return [];
	const shown = shownSceneIds(doc);
	return scenes.flatMap((scene) => {
		if (!SELF_MOUNTED_BANNER_SCREENS.includes(modeSceneBaseId(scene)) || shown.has(scene.id)) {
			return [];
		}
		const z = sceneLayerZIndex(scenes, scene.id);
		return z === undefined ? [] : [{ scene, z }];
	});
};
