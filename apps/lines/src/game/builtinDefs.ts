import {
	BUTTON_DEF,
	EXPANDING_SYMBOL_DEF,
	FREE_SPIN_COUNTER_DEF,
	FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF,
	FREE_SPIN_INTRO_VISUAL_DEF,
	FREE_SPIN_OUTRO_VISUAL_DEF,
	HOLD_AND_WIN_COMPONENTS,
	HUD_READOUT_DEF,
	INFO_BAR_DEF,
	LOADING_BAR_DEF,
	LOADING_INTRO_DEF,
	TAP_TO_CONTINUE_DEF,
	TEXT_BOX_DEF,
	TRANSITION_DEF,
	WIN_DEF,
	type ComponentDef,
} from 'engine-layout';

/**
 * The engine defs `Game.svelte` registers as BUILT-INS, before `registerBakedComponents()` lets the
 * project's own defs shadow them. Its own module so the build-time stock-asset plan
 * (`stockAssetBuild.ts`) seeds the registry with exactly what a boot seeds it with.
 *
 * Batch B / B4.4 — register the parametric HUD readout def + its live value
 * sources. The three HUD bar nodes (balance/win/bet) are now `componentInstance`
 * nodes of `hudReadout` (see `referenceLayouts/hud.ts`), so this powers the live
 * HUD: the def mounts the coded `HudReadout`, fed `value` from these sources.
 * `BUTTON_DEF` (§16.3 B6.3) is registered beside it so `getComponent('button')`
 * resolves — required for any `button` componentInstance to expand into its
 * `ButtonFrame`/`ButtonLabel` parts. No live scene carries a button instance yet
 * (B6.4 converts the HUD cluster), so this is pure registration — no render change.
 */
export const GAME_BUILTIN_DEFS: Record<string, ComponentDef> = {
	[HUD_READOUT_DEF.id]: HUD_READOUT_DEF,
	[BUTTON_DEF.id]: BUTTON_DEF,
	[TEXT_BOX_DEF.id]: TEXT_BOX_DEF,
	// The FreeSpinCounter decomposition: registering the def makes
	// `getComponent('freeSpinCounter')` resolve so the `freeSpinCounter` scene's
	// `componentInstance` (see `referenceLayouts/lines.ts`) expands into its
	// frame/caption/value nodes. This IS the live render — the coded `FreeSpinCounter`
	// stays registered only as a fallback (no longer referenced by the scene).
	[FREE_SPIN_COUNTER_DEF.id]: FREE_SPIN_COUNTER_DEF,
	// The InfoBar decomposition: registering the def makes `getComponent('infoBar')`
	// resolve so an `infoBar` componentInstance expands into its background + message
	// nodes. The editor-native replacement for the coded HTML `MessageToast`; fed by
	// the `message` value source + gated on `messageShow` (registered below).
	[INFO_BAR_DEF.id]: INFO_BAR_DEF,
	// The loading/intro splash decomposition: registering the def makes
	// `getComponent('loadingIntro')` resolve so a `loadingIntro` componentInstance
	// expands into its logo + bound `LoadingBar` + percentage nodes. A placeable
	// building block for composing the splash in the editor; the coded
	// `LoadingScreen` still owns the press-to-continue/transition flow + `onloaded`.
	[LOADING_INTRO_DEF.id]: LOADING_INTRO_DEF,
	// §17.4 step 4 — the Transition migrated off its direct coded `bind` to an
	// editor-owned `componentInstance`. Registering the def makes
	// `getComponent('transition')` resolve so a `transition` instance an author placed
	// expands into its bound coded `Transition` part, positioned by the editor node. Pure
	// registration otherwise (no scene references it ⇒ no render change — parity).
	[TRANSITION_DEF.id]: TRANSITION_DEF,
	// §17 Phase 3 — makes `getComponent('freeSpinIntroVisual')` resolve so an
	// author-placed `freeSpinIntroVisual` instance expands into its bound
	// `FreeSpinIntroVisual` part, positioned by the editor node.
	[FREE_SPIN_INTRO_VISUAL_DEF.id]: FREE_SPIN_INTRO_VISUAL_DEF,
	// §17 Phase 3 — same for the outro's positionable visual.
	[FREE_SPIN_OUTRO_VISUAL_DEF.id]: FREE_SPIN_OUTRO_VISUAL_DEF,
	// Makes `getComponent('win')` resolve so a `win` instance an author placed (e.g. in a
	// `winVisual` scene) expands into its bound `WinVisual` part, positioned by the editor node.
	// Pure registration otherwise (no scene references it ⇒ no render change — the composer
	// `bind:Win` renders unchanged). Book of Borut places the `win` component in the editor (the
	// shared def carries `boundToInstance:true`).
	[WIN_DEF.id]: WIN_DEF,
	// Book-reveal authoring — makes `getComponent('expandingSymbol')` resolve so an
	// `expandingSymbol` instance expands into its bound `ExpandingSymbol` part (the chosen
	// symbol's art), positioned by the editor node. Placeable so an author renders the landed
	// symbol inside their own reveal; the coded `SpecialBook` shuffle stays as the fallback.
	[EXPANDING_SYMBOL_DEF.id]: EXPANDING_SYMBOL_DEF,
	// Book-reveal authoring — makes `getComponent('freeSpinIntroSymbolReveal')` resolve so a
	// `freeSpinIntroSymbolReveal` instance expands into its bound `FreeSpinIntroSymbolReveal`
	// part: the author-picked intro rig with the chosen symbol ridden on a bone. Placing it in
	// the `specialBook` scene flips book-reveal ownership ⇒ the coded shuffle is suppressed.
	[FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF.id]: FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF,
	// Invisible Flow §6.2 — the droppable full-screen tap-to-continue overlay. A
	// minimal empty-root `overlay` def: an author can drop it on ANY Flow screen from
	// the palette to get a full-screen tap-to-continue. Its behaviour + per-instance
	// dim come from the SHARED `tapToContinue` capability (mounts the coded
	// `TapToContinue` bind), so a freshly-placed instance starts transparent until the
	// author flips the toggle and raises the dim — parity otherwise.
	[TAP_TO_CONTINUE_DEF.id]: TAP_TO_CONTINUE_DEF,
	// Flow-driven-game §1 — the droppable LOADING BAR. A minimal `overlay` def that
	// mounts the proven coded `LoadingBar` part and carries `completeOnLoaded: true` (seeded
	// on drop), so dropping it on the `loading` screen makes the flow's `complete` edge fire
	// when boot loading finishes. Inert until a doc references it (parity).
	[LOADING_BAR_DEF.id]: LOADING_BAR_DEF,
	// The kind-gated Hold and Win components (respin counter, jackpot bar / tile, total win
	// bar, pot meter, letters strip, wheel). Inert until a doc places one (parity).
	...Object.fromEntries(HOLD_AND_WIN_COMPONENTS.map((def) => [def.id, def])),
	// BUILT-IN (lowest precedence): these SEED the engine defs, but `registerBakedComponents()`
	// (below) must be free to override any id with the project's EDITED def — so the built-in
	// never shadows a baked/project def, whatever the boot order (§8 "project shadows shared").
};
