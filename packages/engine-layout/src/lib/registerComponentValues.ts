/**
 * Engine value-feed registry (§13.2 step 2) — the render-time lookup that maps a
 * `componentInstance`'s `source` PARAM (`'balance'|'win'|'bet'|…`) to the game's
 * live value store. Sibling to `registerComponents` / `registerBoundComponents`:
 * the game registers its named value sources once at boot, and ANY component whose
 * resolved params carry that `source` binds to it — sources are keyed by SOURCE
 * NAME, not by component, so one `HudReadout` def serves balance/win/bet via three
 * instances with different `source` overrides.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls
 * in — pnpm gives each game its own copy, so no cross-game leakage). Svelte-free:
 * a value source is just a minimal Svelte-store-`subscribe` contract, so this
 * module is re-exported from the bare `engine-layout` (type-only) entry. The
 * engine `<ComponentInstance>` subscribes and feeds the latest number into the
 * param context as the `engineProvided` `value` param.
 *
 * B2 manual-verify recipe (if a story is impractical): (1) at boot call
 * `registerComponentValues({ balance: store })` where `store.subscribe(run)` emits
 * a number and returns an unsubscribe fn; (2) `registerComponents({ hudReadout:
 * def })` with `def.root` a `text` node carrying `paramBindings: { text: 'value' }`
 * and `params` including `{ key: 'source' }` + an `engineProvided` `{ key: 'value',
 * kind: 'number' }`; (3) place a `componentInstance` node `{ componentId:
 * 'hudReadout', params: { source: 'balance' } }` in a scene and render it through
 * `<LayoutScene>`. The text node then shows the live number; add `countUp: true` to
 * the instance params to tween on each change.
 */

/**
 * Minimal Svelte-store contract a value source must satisfy — kept to bare
 * `subscribe` so this module stays Svelte-free. Any Svelte `Readable<number>`
 * (e.g. a `derived(...)` selector that already drives a `UiLabel`) satisfies it,
 * as does a hand-rolled store. `subscribe` MUST invoke `run` synchronously with
 * the current value on subscribe (the Svelte store contract), so the first paint
 * has a real value.
 *
 * Values may be numbers (balance/win/bet — formatted, count-up capable) OR
 * strings (clock/player-name/project-name — rendered verbatim through the text
 * path). Method-position bivariance keeps an existing `Readable<number>` source
 * assignable unchanged.
 */
export interface ValueSource {
	subscribe(run: (value: number | string) => void): () => void;
	/**
	 * How a NUMERIC value should be rendered (e.g. `balance`/`bet` →
	 * `numberToCurrencyString`, `win` → `bookEventAmountToCurrencyString`). The
	 * formatter is intrinsic to the source — the game registers it alongside the
	 * store, so a PLAIN text node bound to the `value` param renders identically to
	 * the coded readout (`$5,000.00`) WITHOUT `engine-layout` knowing about currency
	 * or game state. `<ComponentInstance>` forwards it into the param context as
	 * `valueFormat`; absent ⇒ the readout falls back to a thousands-grouped integer.
	 * String sources ignore it (rendered verbatim).
	 */
	format?: (value: number) => string;
	/**
	 * The source's value is ALREADY a live animation (e.g. a count-up tween the game
	 * drives frame-by-frame — `winCountUpAmount` / `freeSpinOutroTotalWin`). When true, a
	 * numeric readout bound to it MUST NOT run its own `countUp` tween on top: it snaps to
	 * the live value each frame (which IS the smooth count-up) so there is no second,
	 * lagging animation. This is what makes a tap-to-skip / round-slam that snaps the
	 * underlying count-up show the final total INSTANTLY instead of the readout easing to it
	 * for another ~0.5s. A plain (non-animated) source leaves this unset ⇒ `countUp` works
	 * as before (parity). See `ParamReadoutText`.
	 */
	selfAnimated?: boolean;
}

const registry = new Map<string, ValueSource>();

export function registerComponentValues(sources: Record<string, ValueSource>): void {
	for (const [source, store] of Object.entries(sources)) {
		registry.set(source, store);
	}
}

export function getComponentValueSource(source: string): ValueSource | undefined {
	return registry.get(source);
}

export function clearComponentValues(): void {
	registry.clear();
}
