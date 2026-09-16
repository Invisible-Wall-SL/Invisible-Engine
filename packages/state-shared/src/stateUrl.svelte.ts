import { locales } from 'config-lingui';
import { page } from '$app/state';
import { getDeliveryProfile } from 'delivery-profile';

export type Language = (typeof locales)[number];

export type Key =
	// keys for play
	| 'sessionID'
	| 'rgs_url'
	| 'lang'
	| 'currency'
	| 'device'
	| 'quality'
	| 'social'
	| 'demo'
	// keys for replay
	| 'replay'
	| 'amount'
	| 'game'
	| 'mode'
	| 'version'
	| 'event';

const getUrlSearchParam = (key: Key) => page.url.searchParams.get(key) as string;

/** Read a param whose NAME is data rather than a compile-time key — the delivery profile's
 *  `session.param`, which is whatever the operator's embed page happens to use. */
const getRawSearchParam = (key: string) => page.url.searchParams.get(key) ?? '';

/** The placeholder session the Invisible Test Server bakes into every launch URL
 *  (`?sessionID=demo`). The mock RGS keys ALL state — balance + open round — by this
 *  id, so if every visitor kept `demo` they'd share ONE server-side wallet and collide
 *  mid-round. A real launch carries an opaque per-player token here, never this literal. */
const DEMO_SESSION = 'demo';
const DEMO_SESSION_STORAGE_KEY = 'ie_demo_session_id';

/** Mint (once) a unique demo session for THIS browser and persist it, so a reload keeps
 *  the same test wallet. Only used to replace the shared `demo` placeholder — a real
 *  sessionID is passed through untouched. Falls back to a per-load id when storage is
 *  unavailable (SSR / private mode). */
let demoSessionId: string | null = null;
const getDemoSessionId = () => {
	if (demoSessionId) return demoSessionId;
	const mint = () =>
		`demo-${(typeof crypto !== 'undefined' && crypto.randomUUID?.()) || Math.random().toString(36).slice(2)}`;
	try {
		const stored = localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
		demoSessionId = stored || mint();
		if (!stored) localStorage.setItem(DEMO_SESSION_STORAGE_KEY, demoSessionId);
	} catch {
		demoSessionId = mint();
	}
	return demoSessionId;
};

// params for play
const lang = () =>
	getUrlSearchParam('lang') === 'br' ? 'pt' : (getUrlSearchParam('lang') as Language) || 'en';
/**
 * The session token this launch is playing on.
 *
 * A delivery profile changes TWO things here: which param carries the token (an operator's embed
 * is likelier to say `sid` than `sessionID`), and what happens when it is absent. With
 * `session.required` the answer is the empty string — which the RGS facade turns into a visible
 * boot error — instead of a minted demo session. On a client's site a phantom wallet is the worst
 * available outcome: it looks exactly like a working game.
 *
 * `sessionID` stays readable as a fallback under every profile, so our own QA links keep working
 * against a delivery build.
 */
const sessionID = () => {
	const profile = getDeliveryProfile();
	const raw = getRawSearchParam(profile.session.param) || getRawSearchParam('sessionID');
	if (raw && raw !== DEMO_SESSION) return raw;
	if (profile.session.required) return '';
	// Give each browser its own mock wallet; never touch a real per-player session.
	return getDemoSessionId();
};

/**
 * The RGS this build talks to. `?rgs_url=` is how every launch URL we generate points a game at the
 * Invisible Test Server, so it still wins — but only while the profile allows it. A delivered build
 * pins its own RGS: the host page has no business repointing the wallet.
 */
const rgsUrl = () => {
	const profile = getDeliveryProfile();
	// A delivery PINS its RGS — the profile's answer stands even when it is empty (the same-origin
	// case). Falling through to `?rgs_url=` on an empty base would hand a same-origin delivery's
	// wallet straight back to the host page, which is exactly what `allowUrlOverride` denies.
	if (!profile.rgs.allowUrlOverride) return profile.rgs.baseUrl;
	return getUrlSearchParam('rgs_url') || profile.rgs.baseUrl;
};
const social = () => getUrlSearchParam('social') === 'true';
/** Texture-quality tier. `high` = load the uncompressed full-res art (arcade / kiosk /
 *  high-memory targets); anything else (default) = prefer the GPU-compressed KTX2
 *  variant when one was baked, which cuts VRAM 4–8× so the game fits iOS Safari's
 *  per-tab memory cap. The asset builders (`editor-scenes.ts`) read the same `quality`
 *  param directly at import time; this getter is the canonical reader for runtime code. */
const quality = () => (getUrlSearchParam('quality') === 'high' ? 'high' : 'auto');
/** Currency the launch declares the player is playing in — the code every amount on
 *  screen is formatted with (`numberToCurrencyString`). Empty when the URL carries
 *  none, in which case the RGS's own `balance.currency` stands (see `Authenticate`).
 *  Sanitised to a plain uppercase alphabetic code so a junk value can't reach
 *  `Intl.NumberFormat`, which THROWS on a malformed currency and would take the whole
 *  boot down. `XGC`/`XSC` (social-casino Gold/Sweeps coins) pass through here too and
 *  are special-cased downstream in `amount.ts`. */
const currency = () => {
	const raw = getUrlSearchParam('currency') || '';
	return /^[A-Za-z]{3,4}$/.test(raw) ? raw.toUpperCase() : '';
};

// params for replay
const replay = () => getUrlSearchParam('replay') === 'true';
const amount = () => Number(getUrlSearchParam('amount')) || 0;
const game = () => getUrlSearchParam('game') || '';
const version = () => getUrlSearchParam('version') || '';
const mode = () => getUrlSearchParam('mode') || '';
const event = () => getUrlSearchParam('event') || '';

export const stateUrlDerived = {
	// states for play
	lang,
	sessionID,
	rgsUrl,
	social,
	quality,
	currency,
	// states for replay
	replay,
	amount,
	game,
	mode,
	version,
	event,
};
