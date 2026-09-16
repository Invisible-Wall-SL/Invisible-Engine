import { DEFAULT_DELIVERY_PROFILE, type DeliveryProfile } from './types.ts';
import { mergeDeliveryProfile } from './normalize.ts';

/** Injected by `packages/config-vite` when `PUBLIC_DELIVERY_PROFILE` is set; left undeclared
 *  otherwise. `typeof` on an undeclared identifier is legal and does not throw, which is what lets
 *  the same module run in the browser, in a node script and in a fixture. */
declare const __IE_DELIVERY_PROFILE__: unknown;

export type DeliveryProfileSource = 'default' | 'baked' | 'config.json';

/** How long to wait on an operator's `config.json` before giving up and keeping the baked profile.
 *  A host that hangs must cost the boot three seconds, not the whole session. */
const CONFIG_TIMEOUT_MS = 3000;

const bakedProfile = (): unknown =>
	typeof __IE_DELIVERY_PROFILE__ === 'undefined' ? null : __IE_DELIVERY_PROFILE__;

/**
 * The baked profile is applied at MODULE INIT rather than inside {@link loadDeliveryProfile},
 * because it needs no IO and {@link getDeliveryProfile} is read synchronously from call sites that
 * cannot await (`stateUrlDerived.rgsUrl()`). Resolving it lazily would leave a window in which a
 * delivery build reports internal defaults.
 */
const initial = (() => {
	const baked = bakedProfile();
	if (baked === null) {
		return {
			profile: DEFAULT_DELIVERY_PROFILE,
			source: 'default' as DeliveryProfileSource,
			warnings: [] as string[],
		};
	}
	const merged = mergeDeliveryProfile(DEFAULT_DELIVERY_PROFILE, baked);
	return {
		profile: merged.profile,
		source: 'baked' as DeliveryProfileSource,
		warnings: merged.warnings.map((w) => `baked profile: ${w}`),
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
 * Apply the operator's `config.json` over the baked profile. Call once, before anything
 * authenticates — `components-shared/Authenticate.svelte` awaits it at the top of its `onMount`,
 * which is the one place EVERY app reaches (only `apps/lines` has a layout `load`).
 *
 * A build with no baked profile does NOTHING here: no fetch, no log, no change. That keeps an
 * internal build free of a guaranteed 404 on every boot, and is what makes the whole feature inert
 * until a delivery deliberately switches it on.
 */
export const loadDeliveryProfile = (): Promise<DeliveryProfile> => {
	if (loading) return loading;
	loading = (async () => {
		if (source === 'default') return resolved;

		const warnings = [...initial.warnings];
		const override = await fetchConfigJson(warnings);
		if (override !== null) {
			const merged = mergeDeliveryProfile(resolved, override, 'override');
			warnings.push(...merged.warnings.map((w) => `config.json: ${w}`));
			resolved = merged.profile;
			source = 'config.json';
		}

		for (const warning of warnings) console.warn(`[delivery] ${warning}`);
		console.info(
			`[delivery] profile "${resolved.id}" (${source}) → RGS ` +
				`${resolved.rgs.baseUrl || '(same origin)'}${resolved.rgs.endpoint}, ` +
				`session param "${resolved.session.param}"${resolved.session.required ? ' (required)' : ''}`,
		);
		return resolved;
	})();
	return loading;
};

/** The profile in force. Correct from the first tick for the baked half; reflects `config.json`
 *  only after {@link loadDeliveryProfile} has resolved. */
export const getDeliveryProfile = (): DeliveryProfile => resolved;
