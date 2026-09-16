/**
 * The SPIN-BUTTON CELEBRATION LOCK rule — pure, so the decision can be asserted headlessly
 * (`tools/flow-spike/celebrationLock.ts`) instead of only by playing a live game.
 *
 * `stateUi.celebrationLock` says a non-skippable celebration owns the screen. `utils-shared/spinStop`
 * ORs its three fields through `hasCelebrationOverlay()` and every read of that greys chrome and kills
 * a press: the spin button renders an inert `stop_disabled`, `runSpinOrSlamStop` early-returns, and the
 * TURBO button greys on the same read. So a field stuck true is not cosmetic — it disables the HUD.
 *
 * THE TWO AUTHORING MODELS. The lock was originally keyed off the flow's MOUNTED containers
 * (`activeScreenIds`), because a flow-v2 doc can drive its intro/outro purely with
 * `showContainer`/`hideContainer` and broadcast no `freeSpinIntroShow` cue at all — verified live on
 * the Book-of-Borut remake, where a cue subscription stayed deaf for the intro's full duration. But
 * the canonical `drivenSeed`, and therefore every project seeded from it, authors the OPPOSITE model:
 * it shows `freeSpinIntro`/`freeSpinOutro` ONCE at start-up, never hides them, and toggles their
 * internal visibility with the `*Show`/`*Hide` cues their bound components already subscribe to. There
 * the mount is true for the whole session, so a mount-only lock latches at boot and never clears.
 *
 * That is exactly what shipped: on `invisible_wall/test6` the turbo button was greyed from the first
 * frame, slam-stop was dead for the entire session, and a rolling spin rendered a greyed STOP —
 * because its flow's boot chain ran `… → show_14 (freeSpinIntro) → show_15 (freeSpinOutro) → …` and
 * the doc contains no `hideContainer` for either.
 *
 * THE RULE. Pick the test PER CONTAINER off the doc's static `hideContainerIds` read:
 *
 *   - the doc HIDES it   ⇒ mounted means on screen. Judge by the mount (Borut, unchanged).
 *   - the doc NEVER hides it ⇒ the mount says nothing. Judge by the visibility CUE.
 *   - NEITHER hide nor cue  ⇒ never locks. Correct: the bound overlay needs the cue to draw anything,
 *                             so there is no celebration on screen to protect.
 *
 * Both signals are still required together (`mounted && shown`), so a cue left raised by an asymmetric
 * `*Show` with no matching `*Hide` cannot outlive its container. Under the coded / v1 path
 * (`flowV2DrivesScreens` false) the rule collapses to the bare mount test ⇒ byte-identical.
 */

import { FREE_SPIN_STEPS } from './freeSpinOwnership';

/** The engine's canonical big-win flow screen id (`flowDoc.ts`) — the coded / v1 celebration. */
const BIG_WIN_SCREEN = 'bigWin';

export type CelebrationLockInput = {
	/** The flow containers currently MOUNTED, in render order. */
	activeScreenIds: readonly string[];
	/** Is a v2 flow the sole screen renderer? False ⇒ coded / v1 path (parity). */
	flowV2DrivesScreens: boolean;
	/** Container ids the doc ever `hideContainer`s (`hideContainerIds`). */
	flowHideTargets: ReadonlySet<string>;
	/** Container ids a `showContainer{awaitComplete}` node targets (`awaitCompleteContainerIds`). */
	winAwaitTargets: ReadonlySet<string>;
	/** Is the free-spin intro cue-visible (`freeSpinIntroShow` seen, no `freeSpinIntroHide` since)? */
	introCueShown: boolean;
	/** Is the free-spin outro cue-visible (`freeSpinOutroShow` seen, no `freeSpinOutroHide` since)? */
	outroCueShown: boolean;
};

export type CelebrationLockState = {
	intro: boolean;
	outro: boolean;
	win: boolean;
	/**
	 * The HELD clause on its own, WITHOUT the coded `bigWin` id — published to `winState` so the win
	 * GATE can tell whether the flow already holds the presentation after the count-up. A v1 / coded
	 * `bigWin` screen holds nothing (it is a mounted scene, not a `showContainer{awaitComplete}`), so
	 * folding the id in here would suppress the gate's own hold on exactly the path that needs it.
	 * `win` below still ORs both — a coded `bigWin` must grey the spin button as it always has.
	 */
	flowHoldsPresentation: boolean;
};

export const resolveCelebrationLock = ({
	activeScreenIds,
	flowV2DrivesScreens,
	flowHideTargets,
	winAwaitTargets,
	introCueShown,
	outroCueShown,
}: CelebrationLockInput): CelebrationLockState => {
	const mounted = new Set(activeScreenIds);
	// A container the doc never takes down is mounted for the whole session, so its mount carries no
	// information — see THE TWO AUTHORING MODELS above.
	const mountMeansShown = (screenId: string) =>
		!flowV2DrivesScreens || flowHideTargets.has(screenId);
	const locks = (screenId: string, cueShown: boolean) =>
		mounted.has(screenId) && (mountMeansShown(screenId) || cueShown);

	// NAME-AGNOSTIC WIN (design doc §14, the win-overlay twin of the FS-7 outro) — under a v2 flow an
	// author names their win / celebration container ANYTHING, so the literal `bigWin` no longer covers
	// it. Lock while any `showContainer{awaitComplete}`-held container is shown: such a container holds
	// the round on its tap, so the spin button must not slam-skip it. This also covers the count-up
	// window BEFORE the authored tap arms (its `tapToContinue` + `PressToContinue` only claim the press
	// via `continuePressCount` once armed). No `mountMeansShown` split here: an await target is by
	// definition shown and hidden around its hold, never mounted-once.
	const flowHoldsPresentation =
		flowV2DrivesScreens && activeScreenIds.some((id) => winAwaitTargets.has(id));

	return {
		intro: locks(FREE_SPIN_STEPS.intro.screen, introCueShown),
		outro: locks(FREE_SPIN_STEPS.outro.screen, outroCueShown),
		win: mounted.has(BIG_WIN_SCREEN) || flowHoldsPresentation,
		flowHoldsPresentation,
	};
};
