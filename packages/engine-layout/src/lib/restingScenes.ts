import { modeScenes, type SceneRole } from './sceneRole';
import type { Scene } from './types';

/**
 * Screens the game mounts only for a moment — a beat, a feature, a menu, a takeover — and never in
 * the idle base game. Mirrors the transient part of `apps/lines` `Game.svelte`'s reserved ids: each
 * is shown by its own gated mount (the buy modal, the free-spin intro, a win celebration) or by a
 * flow around its beat.
 */
const TRANSIENT_SCENE_IDS: ReadonlySet<string> = new Set([
	'loading',
	'winVisual',
	'freeSpinIntro',
	'freeSpinIntroVisual',
	'freeSpinCounter',
	'freeSpinOutro',
	'freeSpinOutroVisual',
	'specialBook',
	'featureIntro',
	'featureOutro',
	'wheel',
	'luckySpin',
	'jackpotWin',
	'buyFeature',
	'buyConfirm',
	'roundConfirm',
	'betMenu',
	'autoSpin',
]);

/** Roles whose screens mount only when their moment comes (a mode screen while its mode runs). */
const TRANSIENT_ROLES: ReadonlySet<SceneRole> = new Set([
	'loading',
	'buyFeature',
	'buyConfirm',
	'betMenu',
	'autoSpin',
	'mode',
]);

/**
 * Whether the idle base game shows `scene` — the Scene Editor's "In-game view" draws only these
 * (plus the screen being edited), so the canvas reads like the game at rest instead of every
 * popup, menu and feature screen stacked on one another. A screen gated by a `visibleSource` is
 * shown by its source, which is off at rest.
 */
export function isShownAtRest(scene: Scene): boolean {
	if (TRANSIENT_SCENE_IDS.has(scene.id)) return false;
	if (scene.role && TRANSIENT_ROLES.has(scene.role)) return false;
	return !scene.visibleSource;
}

/**
 * The game modes `scenes` has screens for (`role: 'mode'` with a `modeId`), in doc order — what the
 * Scene Editor's In-game view can show besides the base game.
 */
export function viewableModeIds(scenes: readonly Scene[]): string[] {
	const ids = new Set<string>();
	for (const scene of scenes) if (scene.role === 'mode' && scene.modeId) ids.add(scene.modeId);
	return [...ids];
}

/**
 * The screens to draw while the game plays `mode` (absent ⇒ the base game) and `active` is the one
 * being edited: the idle base game, plus the mode's screens that are not beat screens, plus `active`
 * itself. A mode's board, counter and total stay on screen for the whole feature, so they draw
 * whichever screen is being edited, the way the base game's screens do.
 */
export function inGameViewSceneIds(
	scenes: readonly Scene[],
	active: Scene | undefined,
	mode?: string,
): Set<string> {
	const ids = new Set(scenes.filter(isShownAtRest).map((scene) => scene.id));
	if (mode !== undefined) {
		for (const scene of modeScenes(scenes, mode)) {
			if (!TRANSIENT_SCENE_IDS.has(scene.id) && !scene.visibleSource) ids.add(scene.id);
		}
	}
	if (active) ids.add(active.id);
	return ids;
}
