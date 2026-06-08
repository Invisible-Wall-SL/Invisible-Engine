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
 * has a real number.
 */
export interface ValueSource {
	subscribe(run: (value: number) => void): () => void;
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
