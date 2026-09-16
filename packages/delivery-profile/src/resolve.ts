import { DEFAULT_DELIVERY_PROFILE, type DeliveryProfile } from './types.ts';
import { mergeDeliveryProfile } from './normalize.ts';

/** Injected by `packages/config-vite` when `PUBLIC_DELIVERY_PROFILE` is set; left undeclared
 *  otherwise. `typeof` on an undeclared identifier is legal and does not throw, which is what lets
 *  the same module run in the browser, in a node script and in a fixture. */
declare const __IE_DELIVERY_PROFILE__: unknown;

/** Injected when `PUBLIC_DELIVERY_PROFILES` is set — the registry the launch URL may choose
 *  between. Undeclared for a build that did not opt in. */
declare const __IE_DELIVERY_PROFILES__: unknown;

export type DeliveryProfileSource = 'default' | 'baked' | 'selected' | 'config.json';

/** How long to wait on an operator's `config.json` before giving up and keeping the baked profile.
 *  A host that hangs must cost the boot three seconds, not the whole session. */
const CONFIG_TIMEOUT_MS = 3000;

/** The launch-URL param that picks a compiled profile. */
const SELECT_PARAM = 'rgs_profile';

/** The reserved id for the built-in default — our own RGS, reached through `?rgs_url=`. Naming it
 *  is how a launch URL asks for development mode on a bundle that also carries partner profiles. */
const INTERNAL_ID = 'internal';

const bakedProfile = (): unknown =>
	typeof __IE_DELIVERY_PROFILE__ === 'undefined' ? null : __IE_DELIVERY_PROFILE__;

const compiledProfiles = (): Record<string, unknown> | null => {
	if (typeof __IE_DELIVERY_PROFILES__ === 'undefined') return null;
	const registry = __IE_DELIVERY_PROFILES__;
	return typeof registry === 'object' && registry !== null
		? (registry as Record<string, unknown>)
		: null;
};

const selectedId = (): string => {
	if (typeof window === 'undefined') return '';
	try {
		return new URLSearchParams(window.location.search).get(SELECT_PARAM)?.trim() ?? '';
	} catch {
		return '';
	}
};

/**
 * Resolve the profile at MODULE INIT rather than inside {@link loadDeliveryProfile}, because it
 * needs no IO and {@link getDeliveryProfile} is read synchronously from call sites that cannot
 * await (`stateUrlDerived.rgsUrl()`). Resolving it lazily would leave a window in which a delivery
 * build reports internal defaults.
 *
 * Precedence, and the reasoning behind the order:
 *
 *  1. A BAKED profile wins outright. That build is a delivery, pinned to one RGS on purpose, so a
 *     `?rgs_profile=` in the URL is refused rather than honoured — otherwise the host page could
 *     repoint a wallet the delivery deliberately fixed.
 *  2. Else `?rgs_profile=<id>` against the compiled REGISTRY. This is the shared-runtime switch:
 *     one bundle that reaches our test server for development and a partner's RGS for real play.
 *     It is a whitelist — the URL picks among hosts we shipped, it can never name one — and an
 *     unknown id refuses loudly rather than quietly playing somewhere unintended.
 *  3. Else the built-in default: our RGS through `?rgs_url=`, exactly as before profiles existed.
 */
const initial = (() => {
	const asDefault = (warnings: string[] = []) => ({
		profile: DEFAULT_DELIVERY_PROFILE,
		source: 'default' as DeliveryProfileSource,
		warnings,
	});

	const baked = bakedProfile();
	if (baked !== null) {
		const merged = mergeDeliveryProfile(DEFAULT_DELIVERY_PROFILE, baked);
		const wanted = selectedId();
		const warnings = merged.warnings.map((w) => `baked profile: ${w}`);
		if (wanted && wanted !== merged.profile.id) {
			warnings.push(
				`?${SELECT_PARAM}=${wanted} ignored — this build is pinned to "${merged.profile.id}"`,
			);
		}
		return { profile: merged.profile, source: 'baked' as DeliveryProfileSource, warnings };
	}

	const wanted = selectedId();
	if (!wanted) return asDefault();
	if (wanted === INTERNAL_ID) return asDefault();

	const registry = compiledProfiles();
	const picked = registry?.[wanted];
	if (picked === undefined) {
		return asDefault([
			`?${SELECT_PARAM}=${wanted} is not a profile this build carries — using the default ` +
				`(ours). Available: ${[INTERNAL_ID, ...Object.keys(registry ?? {})].join(', ')}`,
		]);
	}

	const merged = mergeDeliveryProfile(DEFAULT_DELIVERY_PROFILE, picked);
	return {
		profile: merged.profile,
		source: 'selected' as DeliveryProfileSource,
		warnings: merged.warnings.map((w) => `profile "${wanted}": ${w}`),
	};
})();

let resolved: DeliveryProfile = initial.profile;
let source: DeliveryProfileSource = initial.source;
let loading: Promise<DeliveryProfile> | null = null;

const fetchConfigJson = async (warnings: string[]): Promise<unknown> => {
	if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

	// Page-RELATIVE, so a build dropped at `https://casino.example/games/stargate/` reads its own
	// config and not the host's root. `no-store` because the file exists to be edited: an operator
	// moving a title from staging to production must not be fighting a CDN copy of the old target.
	const url = new URL('config.json', window.location.href).href;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
	try {
		const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
		// Absent is the NORMAL case — a delivery that needs no override ships without the file.
		if (response.status === 404) return null;
		if (!response.ok) {
			warnings.push(`config.json → HTTP ${response.status} — ignored`);
			return null;
		}
		try {
			return await response.json();
		} catch {
			warnings.push('config.json is not valid JSON — ignored');
			return null;
		}
	} catch {
		// Unreachable or timed out. The baked profile is still a complete, working answer — but say
		// so, because the operator who wrote the file has no other way to learn it never applied.
		warnings.push(
			`config.json could not be read (unreachable or slower than ${CONFIG_TIMEOUT_MS}ms)`,
		);
		return null;
	} finally {
		clearTimeout(timer);
	}
};

/**
 * Settle the profile and say which one is in force. Call once, before anything authenticates —
 * `components-shared/Authenticate.svelte` awaits it at the top of its `onMount`, which is the one
 * place EVERY app reaches (only `apps/lines` has a layout `load`).
 *
 * Only a BAKED profile reads `config.json`. A SELECTED one deliberately does not: the shared
 * runtime bundle is one artifact serving many games, so a `config.json` beside it would be a single
 * file silently repointing all of them. A selected profile is repointed by shipping a new profile
 * and doing a runtime release, which is the reviewable path.
 *
 * A plain internal build with nothing to say stays SILENT — no fetch, no log, no change — which is
 * what keeps the whole feature inert until a build opts in.
 */
export const loadDeliveryProfile = (): Promise<DeliveryProfile> => {
	if (loading) return loading;
	loading = (async () => {
		const warnings = [...initial.warnings];

		if (source === 'baked') {
			const override = await fetchConfigJson(warnings);
			if (override !== null) {
				const merged = mergeDeliveryProfile(resolved, override, 'override');
				warnings.push(...merged.warnings.map((w) => `config.json: ${w}`));
				resolved = merged.profile;
				source = 'config.json';
			}
		}

		// Warnings are logged even on the default path: a `?rgs_profile=` this build does not carry
		// falls back to our RGS, and that must never be silent — the game would look fine while
		// playing somewhere other than the launch intended.
		for (const warning of warnings) console.warn(`[delivery] ${warning}`);
		if (source !== 'default' || warnings.length) {
			console.info(
				`[delivery] profile "${resolved.id}" (${source}) → RGS ` +
					`${resolved.rgs.baseUrl || '(launch URL / same origin)'}${resolved.rgs.endpoint}, ` +
					`session param "${resolved.session.param}"${resolved.session.required ? ' (required)' : ''}`,
			);
		}
		return resolved;
	})();
	return loading;
};

/** The profile in force. Correct from the first tick for the baked half; reflects `config.json`
 *  only after {@link loadDeliveryProfile} has resolved. */
export const getDeliveryProfile = (): DeliveryProfile => resolved;
