/**
 * Engine action-feed registry (§16.2/§16.3) — the behaviour analogue of the
 * value-feed (`registerComponentValues`). It maps a button `componentInstance`'s
 * `action` PARAM (`'spin'|'menu'|'buyBonus'|…`) to the game's live behaviour:
 * what the button DOES when pressed, and the live `disabled`/`active` flags that
 * drive its visual state. Sibling to `registerComponents` / `registerComponentValues`:
 * the game registers its named actions once at boot, and ANY button instance whose
 * resolved params carry that `action` binds to it — actions are keyed by ACTION
 * NAME, not by component, so one `button` ComponentDef serves spin/menu/turbo/… via
 * many instances with different `action` overrides.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls
 * in — pnpm gives each game its own copy, so no cross-game leakage). Svelte-free:
 * an action is `onpress` (a plain callback) plus two optional `BoolSource`s — the
 * boolean sibling of `ValueSource`, the same minimal Svelte-store-`subscribe`
 * contract — so this module is re-exported from the bare `engine-layout`
 * (type-only) entry. The engine `<ComponentInstance>` subscribes the flags and
 * threads `onpress`/`disabled`/`active` into the param context, where `ButtonFrame`
 * reads them (the action analogue of `HudReadout` reading the `value` param).
 *
 * B6.2 manual-verify recipe (if a story is impractical): (1) at boot call
 * `registerComponentActions({ menu: { onpress, disabled, active } })` where each
 * `disabled`/`active` `subscribe(run)` emits a boolean and returns an unsubscribe
 * fn; (2) `registerComponents({ button: def })` with `def.root` `bind`ing a coded
 * `ButtonFrame` that reads `onpress`/`disabled`/`active` from its params + a
 * `params` set including `{ key: 'action' }`; (3) place a `componentInstance` node
 * `{ componentId: 'button', params: { action: 'menu' } }` in a scene. The button
 * then fires the registered `onpress` and reflects its live flags.
 */

/**
 * Minimal Svelte-store contract a boolean source must satisfy — the boolean
 * sibling of {@link ValueSource}, kept to bare `subscribe` so this module stays
 * Svelte-free. Any Svelte `Readable<boolean>` (e.g. a `derived(...)` selector
 * over `stateXstateDerived.isIdle()`) satisfies it, as does a hand-rolled store.
 * `subscribe` MUST invoke `run` synchronously with the current value on subscribe
 * (the Svelte store contract), so the first paint has a real flag.
 */
export interface BoolSource {
	subscribe(run: (value: boolean) => void): () => void;
}

/**
 * The STRING sibling of {@link BoolSource} — a live text source for a button's
 * dynamic LABEL (§16.4 B6.4). Same minimal Svelte-store `subscribe` contract, so
 * this module stays Svelte-free; `subscribe` MUST invoke `run` synchronously with
 * the current value on subscribe (the store contract), so the first paint has a
 * real label. Used by the spin button, whose caption flips between `bet()` and
 * `stop()` as the game leaves/returns to idle — the text analogue of the readout's
 * live `value`. Any Svelte `Readable<string>` (e.g. a `derived(...)` over
 * `stateXstateDerived.isIdle()` selecting `i18nDerived.bet()`/`i18nDerived.stop()`)
 * satisfies it, as does a hand-rolled store.
 */
export interface TextSource {
	subscribe(run: (value: string) => void): () => void;
}

/**
 * A named button behaviour. `onpress` is the click handler (read lazily by
 * `ButtonFrame` at click time, so a plain reference is enough). `disabled`/`active`/
 * `spinning` are OPTIONAL live flags: present only when the coded button being lifted
 * has them — when omitted the engine leaves the corresponding param to fall back to
 * the static map (false), exactly the value-feed parity discipline. `spinning` marks a
 * round-in-progress (the spin button's reels are rolling): `ButtonFrame` swaps to the
 * authored `imageSpinning` frame and rotates it until the flag clears. `label` is an
 * OPTIONAL live caption (§16.4 B6.4) — present only for a button whose text is
 * dynamic (the spin/stop flip); when omitted the static `label` param is untouched,
 * same parity discipline as `disabled`/`active`. When present it OVERRIDES the
 * static `label` param (see `ComponentInstance`), so `ButtonLabel` renders the live
 * caption (it reads `label` when no `icon` is set — which a spin instance has none).
 */
export interface ActionSource {
	onpress: () => void;
	disabled?: BoolSource;
	active?: BoolSource;
	spinning?: BoolSource;
	label?: TextSource;
}

const registry = new Map<string, ActionSource>();

export function registerComponentActions(actions: Record<string, ActionSource>): void {
	for (const [action, source] of Object.entries(actions)) {
		registry.set(action, source);
	}
}

export function getComponentAction(action: string): ActionSource | undefined {
	return registry.get(action);
}

export function clearComponentActions(): void {
	registry.clear();
}
