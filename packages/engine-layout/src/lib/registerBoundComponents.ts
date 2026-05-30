import type { Component } from 'svelte';

/**
 * A Svelte 5 component that a game wants to mount behind a `bind.component`
 * node (e.g. its `Win`, `Transition`, `FreeSpinIntro`). Props are intentionally
 * loose — each game knows what its own bound components accept; the registry
 * just routes by name.
 */
export type BoundComponent = Component<Record<string, unknown>>;

/**
 * The registry is module-scoped — i.e. private to whichever copy of this
 * package the importing game pulls in. In a pnpm workspace each game gets its
 * own bundled copy, so there is no cross-game leakage even though we use a
 * top-level `Map`. Games should call `registerBoundComponents` once at boot.
 */
const registry = new Map<string, BoundComponent>();

export function registerBoundComponents(map: Record<string, BoundComponent>): void {
	for (const [name, component] of Object.entries(map)) {
		registry.set(name, component);
	}
}

export function getBoundComponent(name: string): BoundComponent | undefined {
	return registry.get(name);
}

export function clearBoundComponents(): void {
	registry.clear();
}
