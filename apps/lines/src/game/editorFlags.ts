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

/**
 * Split the WIN overlay (big-win presentation) into a full-screen coded GATE (dim + count-up
 * driver + WinCoins + press + round-await, stays a `canvas` bind) and an editor-positioned VISUAL
 * (the tier spine + count number as a `game`-space `componentInstance(win)`), mirroring
 * `FREE_SPIN_OVERLAY_INSTANCES`. Gates the `basegameOverlays` Win node shape:
 *   OFF — the single composer `bind:Win` (board-centred), byte-identical to today.
 *   ON  — a `canvas` `bind:WinGate` (the full-screen gate) + a `game`-space
 *         `componentInstance(win)` VISUAL (defaulted to board-centre; drag in the editor to move it).
 *
 * DEFAULT OFF (parity gate). Flip to `true` to verify locally; Book of Borut opts in by authoring
 * the `win` component in the editor (the shared `WIN_DEF` carries `boundToInstance:true`).
 */
export const WIN_INSTANCE = false;

/**
 * Render the buy-bonus SELECT step as the in-canvas `buyFeature` Pixi scene (a `repeater`
 * of `featureCard`s over a dimmed backdrop) INSTEAD of the shared HTML `ModalBuyBonus`.
 * The scene is seeded in `defaultLayout` (so it ships in the fallback doc + a fresh editor
 * project) and mounted as a canvas-space takeover by `Game.svelte`.
 *
 * DEFAULT ON in `apps/lines` so the feature is testable end-to-end. When ON, `Game.svelte`
 * redirects the buy-bonus SELECT modal at the app level — it keeps `stateModal` OUT of the
 * `buyBonus` name (which the unconditionally-mounted shared `<Modals>` switcher keys the HTML
 * `ModalBuyBonus` on) and shows the Pixi scene as the sole SELECT surface, so the two never
 * double. The CONFIRM step (`buyBonusConfirm` → HTML `ModalBuyBonusConfirm`) is untouched;
 * its back button returns to this scene.
 *
 * Set to `false` to fall back to the shared HTML buy-bonus modal — byte-identical to today
 * (the redirect + the Pixi mount are both inert, and the seeded scene simply never mounts).
 */
export const BUY_FEATURE_SCENE = true;
