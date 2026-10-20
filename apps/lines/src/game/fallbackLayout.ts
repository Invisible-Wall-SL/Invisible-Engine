import type { LayoutDoc } from 'engine-layout';

import { defaultLayout } from './defaultLayout';
import {
	AUTHORED_TRANSITION,
	AUTHORED_WIN,
	AUTHORED_FREE_SPINS,
	AUTHORED_BUTTONS,
	HUD_BUTTON_INSTANCES,
	TRANSITION_INSTANCE,
	WIN_INSTANCE,
} from './editorFlags';

/**
 * Offline fallback / checked-in stand-in for the editor document the Invisible
 * Editor would write to R2 at `editor/lines/<project>/scenes.json` (see
 * `apps/launcher-api/src/lib/server/projectPaths.ts#editorDocKey`). It is now
 * produced by the template-shaped generator `defaultLayout('lines')` rather
 * than a hand-written literal — the engine-truth "import" of the current
 * basegame (`docs/design/invisible-editor.md` §7.2) — so it round-trips cleanly
 * through `normalizeDoc` and stays in lock-step with `BoardFrame.svelte`.
 *
 * The animated reelhouse glow rig stays coded in `BoardFrame.svelte` by DEFAULT — the
 * `boardGlow` scene ships only its bind anchor, so an un-authored game keeps the coded
 * start→idle→exit chain. Put real art in that scene and the coded rig steps aside
 * (`hasAuthoredBoardGlow`); its enter/exit then rides the `boardGlowShow`/`boardGlowHide`
 * component signals. The `basegame` scene draws
 * INSIDE `<MainContainer>`; `basegameOverlays` (the coded `Win` / `Transition`
 * `mount` slots) draws OUTSIDE it, since those components self-position in
 * canvas coords.
 *
 * Its own module, free of `editor-scenes.ts`'s runtime imports, so the offline stock-asset fixture
 * (`stockAssets.fixture.ts`) reads the very scenes the game falls back to.
 */
export const fallbackEditorScenes: LayoutDoc = defaultLayout('lines', {
	buttons: HUD_BUTTON_INSTANCES,
	transition: TRANSITION_INSTANCE,
	winInstance: WIN_INSTANCE,
	authoredTransition: AUTHORED_TRANSITION,
	authoredWin: AUTHORED_WIN,
	authoredFreeSpins: AUTHORED_FREE_SPINS,
	authoredButtons: AUTHORED_BUTTONS,
});
