import type { Scene } from './types';

/**
 * Persistent authored-background selection (§ persistent-bg-scene). An author's
 * "New background screen" is a Scene with `space: 'background'` carrying full-bleed
 * art (a sprite, a componentInstance, …). A game renders these as a persistent layer
 * BEHIND everything, across the whole session, via `<LayoutScene>` (whose
 * `space:'background'` path cover-fits each node to the canvas).
 *
 * Selection is by SPACE, not by id — so a fresh-id authored scene (e.g. `s_bgeiqt79`)
 * mounts, unlike the coded `background`-id / `space:'canvas'` spine anchor that drives
 * the bundled `<Background>` (that one keeps its dedicated `bg`-node / cover path).
 * Returns the matches in the doc's scene order (lowest first), so multiple background
 * scenes stack predictably.
 */
export const backgroundScenes = (scenes: Scene[]): Scene[] =>
	scenes.filter((scene) => scene.space === 'background');

/**
 * Whether an authored background should SUPPRESS the coded bundled `<Background>` — true
 * only when some `space:'background'` scene carries REAL renderable content, i.e. at
 * least one node that isn't the coded `Background` bind anchor (counting that anchor
 * would suppress the very spine it mounts). No background scene / anchor-only scenes ⇒
 * `false` ⇒ the coded `<Background>` renders unchanged (parity for un-authored / hybrid
 * docs, and for any game — e.g. `apps/lines` — whose fallback ships no background scene).
 */
export const hasAuthoredBackground = (scenes: Scene[]): boolean =>
	backgroundScenes(scenes).some((scene) =>
		scene.nodes.some((node) => node.bind?.component !== 'Background'),
	);
