/**
 * Per-project component DEFAULTS registry (§14.2 B4.5) — the render-time source of
 * the author-set per-project param defaults (the B3 `component-defaults` sidecar).
 * Sibling to `registerComponents`/`registerComponentValues`: the standalone game
 * fetches the defaults map alongside its editor doc (`GET /api/editor/doc` →
 * `componentDefaults`) and registers it ONCE at boot; `<ComponentInstance>` reads
 * it as the `projectDefaults` layer in `resolveComponentParams` (instance override
 * ◁ project default ◁ def default).
 *
 * Module-scoped (private to the game's bundled copy of this package — pnpm gives
 * each game its own). Svelte-free plain data, re-exported from the bare
 * `engine-layout` entry. PARITY: with nothing registered, `getComponentDefaults`
 * returns `undefined`, so `resolveComponentParams` falls back to the def's own
 * param defaults exactly as before.
 */
const registry = new Map<string, Record<string, unknown>>();

export function registerComponentDefaults(map: Record<string, Record<string, unknown>>): void {
	for (const [id, params] of Object.entries(map)) {
		if (params && typeof params === 'object' && !Array.isArray(params)) {
			registry.set(id, params);
		}
	}
}

export function getComponentDefaults(componentId: string): Record<string, unknown> | undefined {
	return registry.get(componentId);
}

export function clearComponentDefaults(): void {
	registry.clear();
}
