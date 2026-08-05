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

/** Per-id record: the LATEST registered def + every registered version by number. */
interface VersionedEntry {
	/** The most-recently registered def for this id — the latest-resolution result. */
	latest: ComponentDef;
	/**
	 * `true` when `latest` came from a BUILT-IN registration — the lowest-precedence
	 * layer (built-in ◁ shared/project). A baked/project def (non-builtin) always wins,
	 * and a built-in registration replaces `latest` ONLY when the current `latest` is
	 * itself a built-in — so a built-in registered LATER in boot (e.g. the shared
	 * `registerBuyFeature` `featureCard`, which runs after `registerBakedComponents`)
	 * can never clobber the project's edited def (§8 "project shadows shared").
	 */
	latestFromBuiltin: boolean;
	/** Every registered version keyed by `def.version`, for true pin resolution (§8.9 v2). */
	byVersion: Map<number, ComponentDef>;
	/**
	 * The versions in `byVersion` whose snapshot came from a BUILT-IN registration. A
	 * built-in must not overwrite a non-builtin snapshot of the SAME version number (a
	 * project edit that kept version 1), or a pinned instance would resolve the built-in
	 * instead of the project def. Non-builtin snapshots always overwrite.
	 */
	builtinVersions: Set<number>;
}

/** Options for {@link registerComponents}. */
export interface RegisterComponentsOptions {
	/**
	 * Mark this batch as ENGINE BUILT-IN defs (`BUILTIN_COMPONENTS`) — the lowest
	 * precedence. A built-in SEEDS an id that has no def yet, but never overrides a def
	 * already registered from a higher-precedence source (a baked/project def), whatever
	 * the boot order. Omit (default `false`) for baked/project/story registrations, which
	 * always take precedence — so `registerBakedComponents(...)`'s project `featureCard`
	 * survives the shared `registerBuyFeature()` built-in registration that runs later.
	 */
	builtin?: boolean;
}

const registry = new Map<string, VersionedEntry>();

/**
 * Max `componentInstance` nesting depth a renderer expands (root scene = depth 0).
 * Beyond this, expansion stops (§8.9 "Nesting", 1–2 levels for v1). Lives here —
 * a Svelte-free module re-exported from `index.ts` — so both renderers (the engine
 * `ComponentInstance` and the editor's own canvas) share ONE source of truth.
 */
export const MAX_COMPONENT_DEPTH = 2;

/**
 * Register component defs (§8.9 v2 multi-version store). Each call SETS the id's
 * `latest` to the supplied def AND retains it in the id's per-version map keyed by
 * `def.version`, so a pinned instance can resolve the EXACT version it was authored
 * against. Registering several versions of the same id (latest LAST) keeps every
 * one resolvable while `latest` follows the final registration — the game's boot
 * `registerComponents(BUILTIN…, { builtin: true })` runs first, then
 * `registerBakedComponents()` overrides `latest` with the project's edited/pinned defs
 * (and adds their versions), exactly as before for the single-version case.
 *
 * PRECEDENCE (`options.builtin`, §8 "project shadows shared"): a batch flagged
 * `builtin` is the lowest layer — it seeds an id but never overrides a def already
 * registered from a higher-precedence (baked/project) source, so boot order can't let a
 * built-in clobber the project's edit. A non-builtin batch always wins. Unflagged calls
 * behave exactly as before (parity for stories/tests).
 */
export function registerComponents(
	map: Record<string, ComponentDef>,
	options: RegisterComponentsOptions = {},
): void {
	const builtin = options.builtin === true;
	for (const [id, def] of Object.entries(map)) {
		const entry = registry.get(id);
		if (!entry) {
			registry.set(id, {
				latest: def,
				latestFromBuiltin: builtin,
				byVersion: new Map([[def.version, def]]),
				builtinVersions: builtin ? new Set([def.version]) : new Set(),
			});
			continue;
		}
		// A built-in never overrides a higher-precedence (baked/project) `latest`; a
		// non-builtin always wins, and a built-in replaces only another built-in.
		if (!builtin || entry.latestFromBuiltin) {
			entry.latest = def;
			entry.latestFromBuiltin = builtin;
		}
		// Same rule per version snapshot: a built-in must not overwrite a non-builtin
		// snapshot of the same version (a project edit that kept its version number), or a
		// pinned instance would resolve the built-in instead of the project def.
		const slotIsBuiltin = entry.builtinVersions.has(def.version);
		if (!entry.byVersion.has(def.version) || !builtin || slotIsBuiltin) {
			entry.byVersion.set(def.version, def);
			if (builtin) entry.builtinVersions.add(def.version);
			else entry.builtinVersions.delete(def.version);
		}
	}
}

/**
 * Outcome of resolving a `componentInstance`'s pinned version against the
 * multi-version registry (§8.9 "Versioning / migration", pin-by-default).
 * `versionMismatch` is `true` ONLY when the instance pinned a `version` that is NOT
 * present in the registry AND differs from the registered latest — the SAFE,
 * non-destructive signal that the exact pin can't be honoured, so the latest def is
 * rendered as a fallback rather than silently passing it off as the pinned one.
 */
export interface ComponentResolution {
	def: ComponentDef | undefined;
	/** The instance's requested pin (echoed back so a caller needn't re-read it). */
	pinnedVersion: number | undefined;
	/** The version of the def actually resolved (the pin when honoured, else latest). */
	registeredVersion: number | undefined;
	/** `true` when `pinnedVersion` is set, unavailable, AND ≠ the resolved version. */
	versionMismatch: boolean;
}

/**
 * Resolve a registered {@link ComponentDef} for an instance, honouring a version
 * pin EXACTLY when that version is registered, and SAFELY surfacing a mismatch when
 * it isn't — never silently passing a different version off as the pinned one (§8.9,
 * owner decision 2026-06-05: pin-by-default, never auto-upgrade).
 *
 * v2 multi-version store: the registry keeps every registered version per id, so a
 * pinned instance resolves the EXACT def it was authored against (`versionMismatch`
 * stays `false` — the pin IS honoured). When the pinned version isn't registered
 * (e.g. a game that bundled only the latest def, or a pin authored against a version
 * never shipped), it falls back to the latest def AND flags `versionMismatch` — the
 * caller renders the fallback (parity: same as before history existed) but is told
 * the exact pin was unavailable. The pin on the instance node is NEVER mutated and
 * the def is NEVER auto-upgraded here. No pin ⇒ latest, no mismatch (back-compat).
 */
export function resolveComponent(id: string, pinnedVersion?: number): ComponentResolution {
	const entry = registry.get(id);
	if (!entry) {
		return { def: undefined, pinnedVersion, registeredVersion: undefined, versionMismatch: false };
	}
	const pinned = pinnedVersion !== undefined ? entry.byVersion.get(pinnedVersion) : undefined;
	const def = pinned ?? entry.latest;
	const registeredVersion = def.version;
	const versionMismatch =
		pinnedVersion !== undefined && pinned === undefined && registeredVersion !== pinnedVersion;
	return { def, pinnedVersion, registeredVersion, versionMismatch };
}

/**
 * Resolve a registered {@link ComponentDef}. A requested `version` is honoured
 * exactly when registered; when it isn't, the latest def is returned and a mismatch
 * is warned about. Thin wrapper over {@link resolveComponent} for callers that only
 * need the def (the warning lives here; the renderer uses `resolveComponent` to also
 * gate on `versionMismatch`).
 */
export function getComponent(id: string, version?: number): ComponentDef | undefined {
	const { def, registeredVersion, versionMismatch } = resolveComponent(id, version);
	if (versionMismatch) {
		console.warn(
			`[engine-layout] component '${id}' pins version ${version} but that version is not registered (latest is ${registeredVersion}); rendering the latest def — pin not honoured exactly, never auto-upgraded.`,
		);
	}
	return def;
}

export function clearComponents(): void {
	registry.clear();
}
