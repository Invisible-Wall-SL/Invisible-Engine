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

/**
 * Max `componentInstance` nesting depth a renderer expands (root scene = depth 0).
 * Beyond this, expansion stops (§8.9 "Nesting", 1–2 levels for v1). Lives here —
 * a Svelte-free module re-exported from `index.ts` — so both renderers (the engine
 * `ComponentInstance` and the editor's own canvas) share ONE source of truth.
 */
export const MAX_COMPONENT_DEPTH = 2;

export function registerComponents(map: Record<string, ComponentDef>): void {
	for (const [id, def] of Object.entries(map)) {
		registry.set(id, def);
	}
}

/**
 * Outcome of resolving a `componentInstance`'s pinned version against the single
 * registered def (§8.9 "Versioning / migration", pin-by-default). `versionMismatch`
 * is `true` ONLY when the instance pinned a `version` that differs from the
 * registered def's `version` — the SAFE, non-destructive signal that the pin can't
 * be honoured exactly because v1 keeps one def per id (no historical store yet).
 */
export interface ComponentResolution {
	def: ComponentDef | undefined;
	/** The instance's requested pin (echoed back so a caller needn't re-read it). */
	pinnedVersion: number | undefined;
	/** The version actually available in the registry, or `undefined` if no def. */
	registeredVersion: number | undefined;
	/** `true` when `pinnedVersion` is set and ≠ `registeredVersion`. */
	versionMismatch: boolean;
}

/**
 * Resolve a registered {@link ComponentDef} for an instance, SAFELY surfacing a
 * version-pin mismatch instead of silently passing a different version off as the
 * pinned one (§8.9, owner decision 2026-06-05: pin-by-default, never auto-upgrade).
 *
 * v1 is a single-version store: there is exactly one def per id, so the only
 * non-destructive choice when the pin doesn't match is to return that one def AND
 * flag `versionMismatch` — the caller renders it (parity: the same def renders as
 * before this flag existed) but is no longer told it is the pinned version. The pin
 * on the instance node is NEVER mutated and the def is NEVER auto-upgraded here.
 *
 * TODO v2: keep historical versions in a multi-version store so a pinned instance
 * resolves the EXACT def it was authored against (true pin), and an explicit
 * per-instance "update to latest" rewrites the pin. Until then `versionMismatch`
 * is the conservative surface for "the pinned version is unavailable."
 */
export function resolveComponent(id: string, pinnedVersion?: number): ComponentResolution {
	const def = registry.get(id);
	const registeredVersion = def?.version;
	const versionMismatch =
		pinnedVersion !== undefined && registeredVersion !== undefined && registeredVersion !== pinnedVersion;
	return { def, pinnedVersion, registeredVersion, versionMismatch };
}

/**
 * Resolve a registered {@link ComponentDef}. A requested `version` is checked
 * against the registered def and warned about on mismatch, but the registered def
 * is still returned — v1 keeps a single def per id. Thin wrapper over
 * {@link resolveComponent} for callers that only need the def (the warning lives
 * here; the renderer uses `resolveComponent` to also gate on `versionMismatch`).
 */
export function getComponent(id: string, version?: number): ComponentDef | undefined {
	const { def, registeredVersion, versionMismatch } = resolveComponent(id, version);
	if (versionMismatch) {
		console.warn(
			`[engine-layout] component '${id}' pins version ${version} but the registered version is ${registeredVersion}; rendering the registered def (v1 single-version store — pin not honoured exactly, never auto-upgraded).`,
		);
	}
	return def;
}

export function clearComponents(): void {
	registry.clear();
}
