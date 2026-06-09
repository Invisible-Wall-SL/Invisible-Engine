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
