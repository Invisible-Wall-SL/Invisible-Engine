/**
 * A DELIVERY PROFILE describes the one thing a built game cannot discover for itself: which RGS it
 * talks to, and how the page hosting it hands over a session.
 *
 * Our own builds never needed one. They are only ever launched by a card WE write
 * (`publishGame.ts`), so `rgs_url` and `sessionID` arrive as query params. A build handed to a
 * partner is launched by THEIR page, which knows nothing of our params — and the failure is silent
 * rather than loud: `rgsUrl()` falls back to `''` and the game POSTs at the operator's own host,
 * while `sessionID()` mints a throwaway `demo-<uuid>`. The result boots, looks fine, and is playing
 * against nothing. The profile exists to make those two answers travel inside the build.
 *
 * Resolution order, later winning:
 *   1. {@link DEFAULT_DELIVERY_PROFILE} — reproduces the pre-profile behaviour exactly, so an
 *      internal build that bakes no profile is byte-identical to before.
 *   2. The profile baked at build time — `PUBLIC_DELIVERY_PROFILE=<name>` injects the JSON as
 *      `__IE_DELIVERY_PROFILE__` (see `packages/config-vite`).
 *   3. `config.json` served next to `index.html`, read only when a profile was baked. This is what
 *      lets an operator repoint a delivered build (staging <-> production) without us rebuilding
 *      and re-shipping it — which matters because the same artifact goes to many hosts.
 *   4. URL params, only while {@link DeliveryProfileRgs.allowUrlOverride} is true.
 */

export interface DeliveryProfileRgs {
	/** Origin of the partner's RGS (`https://gs.2-complex.science`). A bare host is accepted and
	 *  gets `https://` (`localhost`/`127.0.0.1` get `http://`) by the transport's own `buildBaseUrl`.
	 *  May carry a path prefix — our test server's per-game proxy is `<host>/api/<key>`. Empty means
	 *  same-origin, which only makes sense when the game is served by the RGS host itself. */
	baseUrl: string;
	/** Engine endpoint path on that host. Ours is `/rgs/engine`; the 2-complex node serves the same
	 *  protocol at `/webnode/engine.js`. Always stored with a leading slash. */
	endpoint: string;
	/** Send cookies with RGS calls.
	 *
	 *  FALSE for a delivered build, and that is the field that makes the whole cross-origin story
	 *  work: the session token in the query string IS the credential, and credentialed CORS forbids
	 *  a wildcard `Access-Control-Allow-Origin`, forcing the RGS to echo each caller's exact origin.
	 *  Our frontends are hosted by clients and aggregators — an open-ended, growing set of domains
	 *  nobody will remember to register. Uncredentialed, the partner answers `*` once and every
	 *  future host works. TRUE only for the captured same-origin case this protocol came from. */
	withCredentials: boolean;
	/**
	 * Post the action array as a CORS **simple request** (`text/plain;charset=UTF-8`) instead of
	 * `application/json`. The body is byte-identical JSON either way — only the header changes.
	 *
	 * A simple request is not preflighted at all, which buys two things against a partner RGS:
	 * it works when the server answers `Access-Control-Allow-Origin: *` but no
	 * `Access-Control-Allow-Headers` (the 2-complex node, verified 2026-09-16 — a JSON content type
	 * is refused at the preflight), and it removes an OPTIONS round-trip from EVERY SPIN.
	 *
	 * False by default: a server that wants a JSON content type must keep getting one.
	 */
	simpleRequest: boolean;
	/** Let `?rgs_url=` repoint the game. True for our own builds — the Invisible Test Server relies
	 *  on it, and every launch URL we generate carries one. False for a delivery: which RGS the game
	 *  talks to is not the host page's business, and a support ticket about a game "showing wrong
	 *  balances" is much cheaper to answer when the answer cannot be "someone edited the URL". */
	allowUrlOverride: boolean;
}

export interface DeliveryProfileSession {
	/**
	 * Where the session token comes from.
	 *
	 * `param` — a query param on our own URL. Every launch WE generate, and the only source that
	 * existed before an operator hosted us.
	 * `host` — `params.GameSettings.token` on the operator's embed page (see `host.ts`). Their
	 * wrapper resolves the session server-side and never puts it in the game's URL, so a delivery
	 * that waits for a query param would sit there forever.
	 *
	 * `host` still falls back to the param when the page carries no token, which is what keeps our
	 * own QA links working against a delivery build.
	 */
	source: 'param' | 'host';

	/** Query-param name the host page carries the session token in. Ours is `sessionID`; a partner
	 *  minting sessions through their own platform is likelier to use `sid`. */
	param: string;
	/** Refuse to boot without a token instead of minting a throwaway demo session.
	 *
	 *  A delivered build MUST set this. The demo fallback exists so `apps/lines` and the test server
	 *  are playable with no platform behind them, and it is exactly wrong on a client's site: a
	 *  mis-wired embed would show a funded-looking wallet and take spins against a session the
	 *  operator has never heard of. Loud beats plausible. */
	required: boolean;
}

export interface DeliveryProfile {
	/** Names this delivery in the boot log — the first question on any support ticket is which build
	 *  the operator is actually running. */
	id: string;
	rgs: DeliveryProfileRgs;
	session: DeliveryProfileSession;
}

/**
 * The profile an internal build runs with. Every value here restates what the code did before
 * profiles existed, so a build that bakes nothing behaves identically: same endpoint, same
 * credentialed fetch, same `sessionID` param, same demo-session fallback, `?rgs_url=` still king.
 *
 * Nothing about it is a recommendation for a delivery — a delivery profile overrides all of it.
 */
export const DEFAULT_DELIVERY_PROFILE: DeliveryProfile = {
	id: 'internal',
	// Frozen because this exact object is what `getDeliveryProfile()` hands out when nothing is
	// baked: a consumer that wrote through it would move the default for every other reader.
	rgs: Object.freeze({
		baseUrl: '',
		endpoint: '/rgs/engine',
		withCredentials: true,
		simpleRequest: false,
		allowUrlOverride: true,
	}),
	session: Object.freeze({
		param: 'sessionID',
		source: 'param',
		required: false,
	}),
};

Object.freeze(DEFAULT_DELIVERY_PROFILE);
