import type { ComponentDef } from './types';

/**
 * Component-def registry — the render-time lookup that resolves a
 * {@link ComponentDef} for a `componentInstance` node. The real runtime flow
 * fetches defs from R2 (see `docs/design/invisible-editor.md` §8.3); for the
 * engine render path the game/storybook supplies the resolved defs once at boot,
 * exactly as `registerBoundComponents` supplies coded components by name.
 *
 * Module-scoped — i.e. private to whichever copy of this package the importing
 * game pulls in. In a pnpm workspace each game gets its own bundled copy, so
 * there is no cross-game leakage even though we use a top-level `Map`. Games
 * should call `registerComponents` once at boot.
 */
const registry = new Map<string, ComponentDef>();

export function registerComponents(map: Record<string, ComponentDef>): void {
	for (const [id, def] of Object.entries(map)) {
		registry.set(id, def);
	}
}

/**
 * Resolve a registered {@link ComponentDef}. A requested `version` is checked
 * against the registered def and warned about on mismatch, but the registered
 * def is still returned — v1 keeps a single def per id.
 *
 * TODO v2: multi-version store — pin instances to exact `componentVersion` and
 * resolve the matching def (§8.9 "Versioning / migration", pin-by-default).
 */
export function getComponent(id: string, version?: number): ComponentDef | undefined {
	const def = registry.get(id);
	if (def && version !== undefined && def.version !== version) {
		console.warn(
			`[engine-layout] component '${id}' requested version ${version} but registered version is ${def.version}; using registered (v1 single-version store).`,
		);
	}
	return def;
}

export function clearComponents(): void {
	registry.clear();
}
