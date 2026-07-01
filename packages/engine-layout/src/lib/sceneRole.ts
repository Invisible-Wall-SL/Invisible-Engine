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

export function sceneByRole(scenes: readonly Scene[], role: SceneRole): Scene | undefined {
	return scenes.find((scene) => scene.role === role) ?? scenes.find((scene) => scene.id === role);
}

/** The loading splash scene id — role-resolved, falling back to the legacy `loading` id. */
export function loadingSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'loading')?.id ?? 'loading';
}

/** The persistent base scene id — role-resolved, falling back to the legacy `basegame` id. */
export function basegameSceneId(scenes: readonly Scene[]): string {
	return sceneByRole(scenes, 'basegame')?.id ?? 'basegame';
}
