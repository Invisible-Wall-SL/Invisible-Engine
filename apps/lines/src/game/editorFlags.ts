/**
 * Engine-flip flags for the `apps/lines` HUD (§16.4 B6.4). A single module
 * constant the whole app reads, so the button-as-`componentInstance` flip stays
 * coherent across the two places that must agree:
 *   1. the fallback `LayoutDoc` (`editor-scenes.ts` → `defaultLayout('lines', …)`),
 *      which emits the 7 buttons as `componentInstance(button)` nodes when ON, and
 *   2. the replacement Space hotkey in `Game.svelte`, which must mount ONLY when ON
 *      (the flip suppresses the coded `ButtonBet`'s own `<OnHotkey>`, so the
 *      replacement would double-fire if it ran while the coded buttons are live).
 *
 * DEFAULT OFF (parity gate): the spin behaviour is re-implemented from
 * `ButtonBetProvider`/`ButtonBet` and needs online verification before it becomes
 * the default. With this `false`, `apps/lines` renders byte-identically to today —
 * the coded `bind` buttons + their coded hotkey. Flip to `true` to verify the
 * parametric cluster locally; once verified the constant (or its seed) becomes the
 * default and Borut's reference (`bookof.ts`) can opt in too.
 */
export const HUD_BUTTON_INSTANCES = false;

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
