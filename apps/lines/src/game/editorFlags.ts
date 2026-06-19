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
 * §17.4 step 4 (the editor-owned-overlay proof, HYBRID approach) — flip the `Transition`
 * overlay from a DIRECT coded `bind` to an editor-owned `componentInstance` that
 * POSITIONS the coded part. Must stay coherent across the two places that agree:
 *   1. the fallback `LayoutDoc` (`editor-scenes.ts`), which emits the `basegameOverlays`
 *      transition node as a `componentInstance(transition)` when ON (vs the direct
 *      `bind:Transition` when OFF), and
 *   2. `Transition.svelte` / `TransitionAnimation.svelte`, which render the wipe at
 *      CANVAS-CENTRE when OFF (today's hardcode) but at their LOCAL origin when ON, so
 *      the componentInstance node's transform places it. The animation lifecycle
 *      (event → play → spine `complete` → resolve the round) is UNCHANGED in both paths.
 *
 * DEFAULT OFF (parity gate): with this `false`, `apps/lines` renders byte-identically
 * to today — the coded `Transition` self-centres and the round blocks on its spine
 * `complete`. Flip to `true` to verify the editor-owned transition locally (drag/scale
 * the instance in the scene editor and watch the in-game wipe follow); once verified
 * online it can become the default and Borut's reference can opt in.
 */
export const TRANSITION_INSTANCE = false;
