/**
 * Engine visibility-feed registry — the show/hide sibling of the value-feed
 * (`registerComponentValues`) and action-feed (`registerComponentActions`). It
 * maps a `componentInstance`'s `visibleSource` PARAM to the game's live boolean
 * store: when that store is false the engine `<ComponentInstance>` hides the
 * WHOLE instance (e.g. `stateUi.freeSpinCounterShow`, true only during free
 * spins). Sibling to `registerComponents` / `registerComponentValues`: the game
 * registers its named visibility sources once at boot, and ANY instance whose
 * resolved params carry that `visibleSource` binds to it — sources are keyed by
 * SOURCE NAME, not by component, so one source can gate many instances.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls
 * in — pnpm gives each game its own copy, so no cross-game leakage). Svelte-free:
 * a visibility source is just a {@link BoolSource} (the same minimal Svelte-store
 * `subscribe` contract the action feed uses), so this module is re-exported from
 * the bare `engine-layout` (type-only) entry. `<ComponentInstance>` subscribes it
 * and hides the rendered subtree when the latest value is false; with NO source
 * the instance renders byte-identically to today (parity).
 */
import type { BoolSource } from './registerComponentActions';

const registry = new Map<string, BoolSource>();

export function registerComponentVisibility(sources: Record<string, BoolSource>): void {
	for (const [key, source] of Object.entries(sources)) {
		registry.set(key, source);
	}
}

export function getComponentVisibility(key: string): BoolSource | undefined {
	return registry.get(key);
}

export function clearComponentVisibility(): void {
	registry.clear();
}
