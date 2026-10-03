import { shownSceneIds, type FlowDoc } from 'engine-flow-v2';
import { POTS_SCREEN, sceneLayerZIndex, type Scene } from 'engine-layout';

/** The add-on's Pots screen as the game mounts it: its scene and the z it stacks at. */
export type EnginePotsScreen = { scene: Scene; z: number };

/**
 * The Pots screen the game mounts itself under a driven flow, else `undefined`.
 *
 * A driven flow owns every screen, so a Pots screen it never shows never mounts. An authored Pot
 * Meter on it then never draws, and the coded pots draw at their own spot instead. The game mounts
 * the screen when ALL of these hold:
 *  - a Flow v2 doc drives the screens (it owns `load`);
 *  - no `showContainer` of the flow shows it (`shownSceneIds`). Declaring it does not count, since
 *    the `/flow-v2` editor declares every Scene-Editor screen. A flow that shows it anywhere owns it;
 *  - the layout has it;
 *  - the Game Config declares meters (`configuredMeters()`, what the coded pots draw).
 *
 * The z is the screen's own `sceneLayerZIndex`, the resolver every flow container and the coded
 * path's generic mount use, so it stacks where the Scene Editor shows it. The add-on merges it right
 * after `basegame` (and `jackpotBar`), which is above the board and below the HUD and the overlays.
 */
export const enginePotsScreen = (
	doc: FlowDoc,
	scenes: Scene[],
	{ drivesScreens, hasMeters }: { drivesScreens: boolean; hasMeters: boolean },
): EnginePotsScreen | undefined => {
	if (!drivesScreens || !hasMeters || shownSceneIds(doc).has(POTS_SCREEN)) return undefined;
	const scene = scenes.find((s) => s.id === POTS_SCREEN);
	const z = sceneLayerZIndex(scenes, POTS_SCREEN);
	return scene && z !== undefined ? { scene, z } : undefined;
};
