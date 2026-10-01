import { SvelteMap } from 'svelte/reactivity';

/**
 * Which component defs have an instance MOUNTED right now, by id — reactive. A coded default asks
 * {@link isComponentMounted} to step aside for an authored twin only while that twin is really on
 * screen: under a driven flow a screen the flow never shows is in the doc but not mounted, so asking
 * the doc would leave neither drawn. Each `<ComponentInstance>` counts itself in on mount and out on
 * destroy; nothing reads the count unless a coded default asks, so it costs every other game nothing.
 */
const mounted = new SvelteMap<string, number>();

/** Count one instance of `componentId` in; the returned function counts it back out. */
export function trackComponentMount(componentId: string): () => void {
	mounted.set(componentId, (mounted.get(componentId) ?? 0) + 1);
	return () => {
		const left = (mounted.get(componentId) ?? 1) - 1;
		if (left > 0) mounted.set(componentId, left);
		else mounted.delete(componentId);
	};
}

/** Whether at least one instance of `componentId` is mounted. */
export function isComponentMounted(componentId: string): boolean {
	return (mounted.get(componentId) ?? 0) > 0;
}
