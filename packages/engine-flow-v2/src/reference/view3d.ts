/**
 * Invisible Flow v2 — what a 3D game adds to its kind's vocabulary (`docs/design/3d-games.md`, step
 * T4). A 3D game is an arcade game drawn in the `arcade3d` runtime; its Flow is the arcade one plus
 * {@link VIEW_3D_ACTIONS}. Layered like `withOutcome` and `withAddOns`, wherever a project's
 * vocabulary is resolved: the `/flow-v2` editor and the publish gate (a project with an
 * `arcade.world3d` block) and the `arcade3d` seam. No 2D runtime imports this file.
 */

import type { ActionDecl, TemplateVocabulary } from '../types';

/** The 3D view's own actions. `openGraphics` opens its Graphics panel (Auto / Low / Medium /
 *  High / Ultra), which the shared Settings modal does not carry. */
export const VIEW_3D_ACTIONS: readonly ActionDecl[] = [
	{ name: 'openGraphics', params: [], category: 'command' },
];

/** The names of {@link VIEW_3D_ACTIONS}. */
export const VIEW_3D_ACTION_NAMES: readonly string[] = /* @__PURE__ */ VIEW_3D_ACTIONS.map(
	(a) => a.name,
);

/**
 * A vocabulary for a game drawn in 3D: `vocab` with {@link VIEW_3D_ACTIONS} added (any it already
 * has kept as they are). `view3d` false ⇒ `vocab` itself, identity included.
 */
export function withView3d(vocab: TemplateVocabulary, view3d: boolean): TemplateVocabulary {
	if (!view3d) return vocab;
	const have = new Set(vocab.actions.map((a) => a.name));
	const added = VIEW_3D_ACTIONS.filter((a) => !have.has(a.name));
	return added.length ? { ...vocab, actions: [...vocab.actions, ...added] } : vocab;
}
