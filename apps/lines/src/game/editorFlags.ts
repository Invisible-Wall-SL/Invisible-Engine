/**
 * Engine-flip flags for the `apps/lines` HUD (§16.4 B6.4). A single module
 * constant the whole app reads, so the button-as-`componentInstance` flip stays
 * coherent across the two places that must agree:
 *   1. the fallback `LayoutDoc` (`editor-scenes.ts` → `defaultLayout('lines', …)`),
 *      which emits the 7 buttons as `componentInstance(button)` nodes when ON, and
 *   2. the replacement Space hotkey in `Game.svelte`, which mounts when ON — OR when
 *      an authored HUD suppresses the coded `<UI>` (`suppressCodedHud`); either way
 *      the coded `ButtonBet`'s own `<OnHotkey>` is gone, so this is the sole binding.
 *
 * DEFAULT ON (§16 B6.4 flipped 2026-07-03): `apps/lines`' own default HUD renders the
 * parametric `componentInstance(button)` cluster — the spin/stop machine + disabled +
 * active + spinning + label + config-feature gates are all lifted from the coded
 * `ButtonBetProvider`/`ButtonBet`/`UIDefault`. Set to `false` to fall back to the coded
 * `bind` buttons + their coded hotkey (byte-identical to pre-flip). Book of Borut's
 * reference (`bookof.ts`) still opts in separately via `hudScenes({ buttons: true })`.
 */
export const HUD_BUTTON_INSTANCES = true;

/**
 * §17.4 step 4 (the editor-owned-overlay proof, HYBRID approach) — choose the shape of
 * the `apps/lines` FALLBACK doc's `basegameOverlays` transition node: a DIRECT coded
 * `bind:Transition` (OFF, parity) vs an editor-owned `componentInstance(transition)` (ON)
 * placed `canvas`-centred via `screenAnchor`. This flag ONLY selects the node shape in
 * `editor-scenes.ts` / `defaultLayout`; the coded part keys off the def, not this flag —
 * `TRANSITION_DEF`'s bind child passes `boundToInstance:true`, so when expanded the coded
 * `Transition` renders at LOCAL origin and THIS node's transform places the wipe. The
 * animation lifecycle (event → play → rig `complete` → resolve the round) is unchanged.
 *
 * DEFAULT OFF (parity gate): with this `false`, `apps/lines` renders byte-identically
 * to today — the direct `bind:Transition` self-centres. Flip to `true` to verify the
 * editor-owned transition locally (drag/scale the instance in the scene editor and watch
 * the in-game wipe follow). Book of Borut opts in by placing the `transition` component
 * in the editor (no flag — it's editor-doc-driven; the shared def carries the prop).
 */
export const TRANSITION_INSTANCE = false;

/**
 * Split the WIN overlay (big-win presentation) into a full-screen coded GATE (dim + count-up
 * driver + WinCoins + press + round-await, stays a `canvas` bind) and an editor-positioned VISUAL
 * (the tier rig + count number as a `game`-space `componentInstance(win)`). Gates the
 * `basegameOverlays` Win node shape:
 *   OFF — the single composer `bind:Win` (board-centred), byte-identical to today.
 *   ON  — a `canvas` `bind:WinGate` (the full-screen gate) + a `game`-space
 *         `componentInstance(win)` VISUAL (defaulted to board-centre; drag in the editor to move it).
 *
 * DEFAULT OFF (parity gate). Flip to `true` to verify locally; Book of Borut opts in by authoring
 * the `win` component in the editor (the shared `WIN_DEF` carries `boundToInstance:true`).
 */
export const WIN_INSTANCE = false;

/**
 * Rive plan Phase 8a — the `apps/lines` DEV PILOT of the authored Transition: with this on, the
 * fallback doc (`editor-scenes.ts` → `defaultLayout('lines', …)`) carries
 * `settings.authoredOverlays.transition: true`, the per-project switch a live project sets in the
 * Scene Editor's Game Settings. The game then swaps the overlays scene's coded `bind:Transition`
 * for the built-in `transitionWipe` instance (`authoredOverlays.ts`) and retires the coded part.
 *
 * DEFAULT OFF (parity gate): the dev build renders the coded wipe, byte-identical to today. The
 * parity gate (`scripts/transition-parity`) never flips this: it serves the game a doc with the
 * flag set, the way a published project would. No URL opt-in exists.
 */
export const AUTHORED_TRANSITION = false;

/**
 * Rive plan Phase 8b — the `apps/lines` DEV PILOT of the authored Win: with this on, the fallback
 * doc carries `settings.authoredOverlays.win: true`, the per-project switch a live project sets in
 * the Scene Editor's Game Settings. The game then degrades the overlays scene's `bind:Win` to its
 * gate half, places the built-in `winPresentation` instance where the coded visual drew
 * (`authoredOverlays.ts`), generates its per-tier timelines from the loaded `bigwin` skeleton, and
 * retires the coded `WinVisual`; `WinGate` conducts the tiers through their holds.
 *
 * DEFAULT OFF (parity gate): the dev build renders the coded visual, byte-identical to today. The
 * parity gate serves the game a doc with the flag set, as a published project would. No URL
 * opt-in exists.
 */
export const AUTHORED_WIN = false;

/**
 * Rive plan Phase 8c — the `apps/lines` DEV PILOT of the authored free-spin intro / outro: with this
 * on, the fallback doc carries `settings.authoredOverlays.freeSpins: true`. The game then swaps the
 * screens' coded `bind:FreeSpinIntroVisual` / `bind:FreeSpinOutroVisual` for the built-in
 * presentations (`authoredOverlays.ts`) and retires the coded visuals; the outro driver, the taps
 * and the holds stay coded.
 *
 * DEFAULT OFF (parity gate): the dev build renders the coded visuals, byte-identical to today. The
 * parity gate serves the game a doc with the flag set, as a published project would. No URL
 * opt-in exists.
 */
export const AUTHORED_FREE_SPINS = false;
