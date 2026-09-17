/**
 * What the OPERATOR'S EMBED PAGE told the game.
 *
 * A partner launches our client from a server-rendered wrapper that resolves the session and the
 * game's settings server-side and hands the browser one object:
 *
 *   var params = {
 *     GameAPI: "/webnode/engine?sid=S0001e",
 *     GameSettings: { token: "S0001e", service: "webnode/engine", config: { … } },
 *     UrlHistory: "…", TournUrl: "…", RemoteID: "…",
 *   }
 *   BaseGameLoader.InitGame(params, "Slot", "Hyper")
 *
 * `config` is the operator's declaration of what this launch may do — the bet ladder, the
 * denomination, whether turbo and autoplay are allowed, whether it is a demo. Everything the RGS
 * facade used to INVENT.
 *
 * ONE reader, here in the leaf package, because three unrelated consumers need it and a second
 * implementation would drift: the session token (`state-shared`), the bet ladder
 * (`rgs-translator-eagaming/betOptions`), and the jurisdiction flags (the facade). It reads the
 * page defensively and returns null everywhere else — no embed, no behaviour change.
 */

export interface HostGameSettings {
	/** The session token the operator minted. Empty when the page did not carry one. */
	token: string;
	/** The RGS endpoint the operator wants used, as they spelled it. */
	service: string;
	/** The operator's per-launch settings. Deliberately untyped here: the leaf package must not
	 *  decide what a bet ladder or a jurisdiction flag means — its consumers do. */
	config: Record<string, unknown>;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const readParams = (scope: unknown): HostGameSettings | null => {
	const params = asRecord((scope as { params?: unknown } | undefined)?.params);
	const settings = asRecord(params?.GameSettings);
	if (!settings) return null;
	return {
		token: typeof settings.token === 'string' ? settings.token : '',
		service: typeof settings.service === 'string' ? settings.service : '',
		config: asRecord(settings.config) ?? {},
	};
};

/**
 * Read `params.GameSettings` from this window, then from the parent.
 *
 * The parent is checked because a delivered client may run in an iframe the embed page hosts, where
 * `params` lives on the OUTER document. Cross-origin parents throw on property access, which is
 * exactly the case where we have no business reading it — so the throw is swallowed and treated as
 * "no host settings".
 */
export const readHostGameSettings = (): HostGameSettings | null => {
	if (typeof window === 'undefined') return null;

	const own = readParams(window);
	if (own) return own;

	try {
		if (window.parent && window.parent !== window) return readParams(window.parent);
	} catch {
		/* cross-origin parent — nothing to read */
	}
	return null;
};

/** A positive finite number from the host config, or null. */
export const hostNumber = (key: string): number | null => {
	const value = readHostGameSettings()?.config[key];
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
};

/** A boolean the host config actually STATED. Null when absent, so a caller can tell "the operator
 *  said no" from "the operator said nothing" — the difference between overriding a default and
 *  leaving it alone. */
export const hostBoolean = (key: string): boolean | null => {
	const value = readHostGameSettings()?.config[key];
	return typeof value === 'boolean' ? value : null;
};
