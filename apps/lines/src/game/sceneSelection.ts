import {
	authoredTransitionStatus,
	authoredTransitionSwapped,
	collectComponentIds,
	sceneByRole,
	withAuthoredTransition,
	withAuthoredWin,
	type LayoutDoc,
	type Scene,
	type TransitionCueStatus,
} from 'engine-layout';

/**
 * Which scene the game mounts for each screen it owns by id or role, given the loaded doc and the
 * reference layout it falls back to (`fallbackLayout.ts`). `Game.svelte` renders from these and the
 * stock-asset filter (`stockAssets.ts`) walks them, so the two cannot disagree about what is on
 * screen. Pure and Svelte-free; each returns the same objects the game always rendered.
 */

const fallbackScene = (fallback: LayoutDoc, id: string): Scene =>
	fallback.scenes.find((scene) => scene.id === id)!;

export const basegameSceneOf = (scenes: Scene[], fallback: LayoutDoc): Scene =>
	sceneByRole(scenes, 'basegame') ?? fallbackScene(fallback, 'basegame');

/**
 * Whether the doc places its OWN win VISUAL — a `win` componentInstance in ANY scene (the Win
 * Overlay component dropped on a flow screen, or the split's `winVisual` scene). When it does,
 * the coded `bind:Win` COMPOSER must not ALSO draw a visual: `Win` is the gate PLUS a param-less
 * `WinVisual`, so a second, unauthored big-win presentation renders board-centred over the
 * authored one — and, having no `componentInstance` params, at the component's DEFAULTS, which is
 * how a `showCoins: false` instance still rained coins. Degrading the node to its GATE half
 * (`bind:WinGate`) keeps the load-bearing part (count-up + `winState` + round-block, which the
 * authored visual READS) and drops the duplicate art. Recurses into container children, so a
 * win overlay nested inside an authored screen counts.
 */
const docPlacesWinVisual = (scenes: Scene[]): boolean =>
	collectComponentIds(scenes.flatMap((scene) => scene.nodes)).includes('win');

/**
 * The overlays scene, with that degrade applied. This is exactly the `WIN_INSTANCE`-ON shape the
 * gate/visual split was designed for — it was simply never reached by a doc that authors the
 * visual while leaving `basegameOverlays` at the reference default, or omitting the scene
 * entirely (then the fallback supplies `bind:Win`, and the game gets both halves twice).
 * No `Win` bind, or no authored win visual ⇒ the SAME scene object back ⇒ byte-identical (parity).
 *
 * `authoredWinOn` is the game's live `authoredWinRuntime.on`; `transitionCue` is the status the game
 * booted the `transition` cue with (a screen transition holds the Transition's swap back).
 */
export function basegameOverlaysSceneOf(
	doc: Pick<LayoutDoc, 'scenes' | 'settings'>,
	fallback: LayoutDoc,
	authoredWinOn: boolean,
	transitionCue: TransitionCueStatus = 'off',
): Scene {
	const fallbackOverlays = fallbackScene(fallback, 'basegameOverlays');
	// The AUTHORED Transition (Rive plan Phase 8a): the loaded doc's scenes were swapped once at
	// load (`withAuthoredTransitionDoc`); the reference overlays a doc without its own gets are
	// swapped here under the same flag. Off ⇒ the same scene object (parity).
	const swappedFallback = authoredTransitionSwapped(authoredTransitionStatus(doc), transitionCue)
		? withAuthoredTransition(fallbackOverlays)
		: fallbackOverlays;
	const scene =
		doc.scenes.find((s) => s.id === 'basegameOverlays') ??
		// The AUTHORED Win (Phase 8b) degrades the reference composer to its gate half the same
		// way; the loaded doc's own scenes were swapped at load (`withAuthoredWinDoc`).
		(authoredWinOn ? withAuthoredWin(swappedFallback) : swappedFallback);
	if (!docPlacesWinVisual(doc.scenes)) return scene;
	let degraded = false;
	const nodes = scene.nodes.map((node) => {
		if (node.bind?.component !== 'Win') return node;
		degraded = true;
		return { ...node, bind: { ...node.bind, component: 'WinGate' } };
	});
	return degraded ? { ...scene, nodes } : scene;
}

export const winVisualSceneOf = (scenes: Scene[], fallback: LayoutDoc): Scene | undefined =>
	scenes.find((scene) => scene.id === 'winVisual') ??
	fallback.scenes.find((scene) => scene.id === 'winVisual');

/** The free-spin counter scene for `screenId` (the base `freeSpinCounter`, or a spins mode's copy
 *  as `modeScreenFor` resolves it), else the fallback's. */
export const freeSpinCounterSceneOf = (
	scenes: Scene[],
	fallback: LayoutDoc,
	screenId: string,
): Scene =>
	scenes.find((scene) => scene.id === screenId) ?? fallbackScene(fallback, 'freeSpinCounter');

export const specialBookSceneOf = (scenes: Scene[], fallback: LayoutDoc): Scene =>
	scenes.find((scene) => scene.id === 'specialBook') ?? fallbackScene(fallback, 'specialBook');

export const buyFeatureSceneOf = (scenes: Scene[], fallback: LayoutDoc): Scene =>
	sceneByRole(scenes, 'buyFeature') ??
	scenes.find((scene) => scene.id === 'buyFeature') ??
	fallbackScene(fallback, 'buyFeature');

export const buyConfirmSceneOf = (scenes: Scene[], fallback: LayoutDoc): Scene =>
	sceneByRole(scenes, 'buyConfirm') ??
	scenes.find((scene) => scene.id === 'buyConfirm') ??
	fallbackScene(fallback, 'buyConfirm');
