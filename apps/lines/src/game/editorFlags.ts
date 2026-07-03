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
 * animation lifecycle (event → play → spine `complete` → resolve the round) is unchanged.
 *
 * DEFAULT OFF (parity gate): with this `false`, `apps/lines` renders byte-identically
 * to today — the direct `bind:Transition` self-centres. Flip to `true` to verify the
 * editor-owned transition locally (drag/scale the instance in the scene editor and watch
 * the in-game wipe follow). Book of Borut opts in by placing the `transition` component
 * in the editor (no flag — it's editor-doc-driven; the shared def carries the prop).
 */
export const TRANSITION_INSTANCE = false;

/**
 * §17 Phase 3 — split the free-spin INTRO/OUTRO into a full-screen coded GATE (dim +
 * press-to-continue + round-await, stays a `canvas` bind) and an editor-positioned VISUAL
 * (`freeSpinIntroVisual`/`freeSpinOutroVisual` `game`-space componentInstance). Gates the
 * `defaultLayout` scene shapes:
 *   OFF — the `freeSpinIntro`/`freeSpinOutro` scenes mount the single composer
 *         `bind:FreeSpinIntro`/`bind:FreeSpinOutro` (board-centred), byte-identical to today.
 *   ON  — those scenes mount the GATE bind (`FreeSpinIntroGate`/`FreeSpinOutroGate`), and a
 *         separate `freeSpinIntroVisual`/`freeSpinOutroVisual` `game`-space scene mounts the
 *         positionable visual (defaulted to board-centre; drag in the editor to move it).
 *
 * DEFAULT OFF (parity gate). Flip to `true` to verify locally; Book of Borut opts in by
 * authoring the visual component in the editor (the shared defs carry `boundToInstance`).
 */
export const FREE_SPIN_OVERLAY_INSTANCES = false;
