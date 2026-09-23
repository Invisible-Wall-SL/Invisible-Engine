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
};

/** Every scene role, in the order the editor lists them. Derived from {@link SCENE_ROLE_LABELS}. */
export const SCENE_ROLES = Object.keys(SCENE_ROLE_LABELS) as SceneRole[];

/** Whether `value` is a known scene role — the guard the editor writer and the save whitelist share. */
export function isSceneRole(value: unknown): value is SceneRole {
	return typeof value === 'string' && (SCENE_ROLES as string[]).includes(value);
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
