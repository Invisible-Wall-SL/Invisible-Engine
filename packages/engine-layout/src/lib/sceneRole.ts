import type { Scene } from './types';

/**
 * Screen identity by ROLE — the id-independent way the game boot resolves which scene is
 * the loading splash / the persistent base, so scene ids stay free-form and renameable
 * (see `Scene.role`). Resolution: the scene tagged with the role, else the legacy scene
 * whose `id` equals the role name (parity for un-migrated docs that carry no role). Pure —
 * no flow, no runtime state — which is why it fixes the CODED boot (no shipped game loads a
 * FlowDoc yet). A flow still drives the screen by authoring that same scene id.
 *
 * Absent role + a scene id'd `loading`/`basegame` ⇒ exactly today's selection, byte-identical.
 */
export type SceneRole = NonNullable<Scene['role']>;

/**
 * Every scene role, with the label the editor's role dropdown shows — THE single runtime list, so
 * adding a role can't reach one surface and miss another. Typed `Record<SceneRole, string>`, which
 * makes a newly declared role a COMPILE error here until it is listed.
 *
 * This exists because the role literal used to be hand-copied into three places that each drop or
 * hide a role they don't know: the editor's dropdown, the editor's `setSceneRole` writer, and the
 * launcher's `normalizeScene` save whitelist — where an unlisted role is silently discarded on save
 * (a reported bug). All three now derive from this.
 */
export const SCENE_ROLE_LABELS: Record<SceneRole, string> = {
	loading: 'loading (splash)',
	basegame: 'base game',
	buyFeature: 'buy feature',
	buyConfirm: 'buy confirm',
	betMenu: 'bet menu',
	autoSpin: 'auto spin',
	mode: 'game mode',
};

/** Every scene role, in the order the editor lists them. Derived from {@link SCENE_ROLE_LABELS}. */
export const SCENE_ROLES = Object.keys(SCENE_ROLE_LABELS) as SceneRole[];

/** Whether `value` is a known scene role — the guard the editor writer and the save whitelist share. */
export function isSceneRole(value: unknown): value is SceneRole {
	return typeof value === 'string' && (SCENE_ROLES as string[]).includes(value);
}

/**
 * The screens that belong to game mode `modeId` (`role: 'mode'`), in doc order. Unlike the other
 * roles there are many per doc and several per mode, so there is no legacy-id fallback.
 */
export function modeScenes(scenes: readonly Scene[], modeId: string): Scene[] {
	return scenes.filter((scene) => scene.role === 'mode' && scene.modeId === modeId);
}

/** Whether a screen is a mode screen — mounted by the mode stack, never as an always-on overlay. */
export function isModeScene(scene: Scene): boolean {
	return scene.role === 'mode';
}

/**
 * Whether a screen may mount while the modes in `activeModeIds` are on the mode stack: every
 * non-mode screen may, and a mode screen only while its own mode is there.
 */
export function sceneInActiveModes(scene: Scene, activeModeIds: ReadonlySet<string>): boolean {
	return scene.role !== 'mode' || (scene.modeId !== undefined && activeModeIds.has(scene.modeId));
}

/**
 * The HUD screens to show for the mode on screen. A mode that names its own HUD (`GameModeDecl.hud`,
 * a `hud_*` screen id) REPLACES the HUD while it is on top; a screen some mode names as its HUD is
 * that mode's alone and never shows in another. No override, or one naming a screen the doc lacks ⇒
 * every other HUD screen, exactly as before modes existed.
 */
export function hudScenesForMode(
	hudScenes: readonly Scene[],
	modeHudIds: ReadonlySet<string>,
	activeHudId: string | undefined,
): Scene[] {
	if (activeHudId && hudScenes.some((scene) => scene.id === activeHudId)) {
		return hudScenes.filter((scene) => scene.id === activeHudId);
	}
	return hudScenes.filter((scene) => !modeHudIds.has(scene.id));
}

export function sceneByRole(scenes: readonly Scene[], role: SceneRole): Scene | undefined {
	// Prefer the CANONICAL scene whose id AND role both equal the role name. This disambiguates a
	// doc that erroneously tags SEVERAL scenes with the same role (a bulk-tag/migration artifact):
	// the scene whose id IS the role is the real one, so the reel's board gate no longer locks onto
	// the wrong first-tagged scene. Then fall back to any role-tagged scene (well-formed single-tag
	// docs — byte-identical to before), then the legacy id-only match (un-migrated docs).
	return (
		scenes.find((scene) => scene.id === role && scene.role === role) ??
		scenes.find((scene) => scene.role === role) ??
		scenes.find((scene) => scene.id === role)
	);
}

/** The loading splash scene id — role-resolved, falling back to the legacy `loading` id. */
export function loadingSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'loading')?.id ?? 'loading';
}

/** The persistent base scene id — role-resolved, falling back to the legacy `basegame` id. */
export function basegameSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'basegame')?.id ?? 'basegame';
}

/** The buy-bonus SELECT scene id — role-resolved, falling back to the legacy `buyFeature` id. */
export function buyFeatureSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'buyFeature')?.id ?? 'buyFeature';
}

/** The buy-bonus CONFIRM scene id — role-resolved, falling back to the legacy `buyConfirm` id. */
export function buyConfirmSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'buyConfirm')?.id ?? 'buyConfirm';
}

/** The bet-amount menu scene id — role-resolved, falling back to the legacy `betMenu` id. */
export function betMenuSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'betMenu')?.id ?? 'betMenu';
}

/** The auto-spin menu scene id — role-resolved, falling back to the legacy `autoSpin` id. */
export function autoSpinSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'autoSpin')?.id ?? 'autoSpin';
}
