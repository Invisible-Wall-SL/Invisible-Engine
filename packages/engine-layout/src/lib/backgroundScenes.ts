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

/**
 * Whether an authored book reveal should SUPPRESS the coded bundled `<SpecialBook>` shuffle —
 * true only when the `specialBook` scene carries REAL renderable content, i.e. at least one node
 * that isn't the coded `SpecialBook` bind anchor (counting that anchor would suppress the very
 * component it mounts). No `specialBook` scene / anchor-only scenes ⇒ `false` ⇒ the coded
 * `<SpecialBook>` renders unchanged (parity for un-authored / hybrid docs and for a game — e.g.
 * `apps/lines` dev — whose fallback ships only the coded anchor). Mirrors
 * {@link hasAuthoredBackground} for the board's book-reveal mechanic.
 */
export const hasAuthoredBookReveal = (scenes: Scene[]): boolean =>
	scenes
		.filter((scene) => scene.id === 'specialBook')
		.some((scene) => scene.nodes.some((node) => node.bind?.component !== 'SpecialBook'));

/** The scene an authored free-spin board glow lives in — `game` space, so `<LayoutScene>` self-wraps
 *  in its own `<MainContainer>` and the art lands in the same box as the reels. The game mounts it in
 *  the BELOW-reel slot (before the board's MainContainer), which is where the coded `<BoardFrame>`
 *  draws at `zIndex:-1`. Absent ⇒ `undefined` ⇒ nothing mounts (parity). */
export const boardGlowScene = (scenes: Scene[]): Scene | undefined =>
	scenes.find((scene) => scene.id === 'boardGlow');

/**
 * Whether an authored board glow should SUPPRESS the coded bundled `<BoardFrame>` — the pink
 * `reelhouse` glow spine behind the reels. True only when the `boardGlow` scene carries REAL
 * renderable content, i.e. at least one node that isn't the coded `BoardFrame` bind anchor (counting
 * the anchor would suppress the very spine it positions). No `boardGlow` scene / anchor-only scenes ⇒
 * `false` ⇒ the coded `<BoardFrame>` renders unchanged (parity for un-authored docs and for a game —
 * e.g. `apps/lines` dev — whose fallback ships only the coded anchor). Mirrors
 * {@link hasAuthoredBookReveal} for the board's free-spin backdrop.
 *
 * The glow's TIMING stays with the flow either way: the coded `BoardFrame` and an authored component
 * both react to the `boardFrameGlowShow`/`boardFrameGlowHide` signals (declared cues, so a `fireCue`
 * node drives them; the coded `freeSpinTrigger`/`freeSpinEnd` handlers fire them when un-owned).
 */
export const hasAuthoredBoardGlow = (scenes: Scene[]): boolean =>
	scenes
		.filter((scene) => scene.id === 'boardGlow')
		.some((scene) => scene.nodes.some((node) => node.bind?.component !== 'BoardFrame'));
