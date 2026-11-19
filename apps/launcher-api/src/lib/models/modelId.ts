/**
 * The model id rule, in one place for the server (`modelStorage.ts`, which re-exports it, and the
 * `/api/models*` routes) and for the Invisible Model Viewer's upload dialog: the page refuses an id
 * with the very function the register step refuses it with. Pure and import-free.
 */

/**
 * A model id, kept EXACTLY as given (case included): the Blender export's own asset id, the name it
 * writes as `<id>.glb` and as `extras.ie.id` (`CH_brawler`, `WP_sword`, `PR_crate`;
 * `docs/conventions/blender-3d-assets.md` "Names"). A letter, then letters, digits and underscores.
 * The game names a model by this exact string (`modelId`), so it is never normalised.
 */
export const MODEL_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const isModelId = (v: unknown): v is string => typeof v === 'string' && MODEL_ID.test(v);
export const MODEL_ID_RULE =
	'a letter, then letters, digits or underscores (64 at most), e.g. CH_brawler or WP_sword';

/**
 * Why `id` cannot be a new model beside `existing`, or null. Two ids that differ only in case are
 * refused: their files (`deploy/models/<id>.glb`) would collide when a build pulls them onto a
 * case-insensitive disk (Windows, macOS), and one would silently replace the other.
 */
export function modelIdRefusal(id: string, existing: readonly string[]): string | null {
	if (!isModelId(id)) return `"${id}" is not a model id: ${MODEL_ID_RULE}.`;
	const clash = existing.find((e) => e !== id && e.toLowerCase() === id.toLowerCase());
	return clash
		? `"${id}" differs from the existing model "${clash}" only in case; use "${clash}" or another id.`
		: null;
}
