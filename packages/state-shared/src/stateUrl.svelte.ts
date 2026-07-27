import { locales } from 'config-lingui';
import { page } from '$app/state';

export type Language = (typeof locales)[number];

export type Key =
	// keys for play
	| 'sessionID'
	| 'rgs_url'
	| 'lang'
	| 'currency'
	| 'device'
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
const sessionID = () => {
	const raw = getUrlSearchParam('sessionID') || '';
	// Give each browser its own mock wallet; never touch a real per-player session.
	return raw && raw !== DEMO_SESSION ? raw : getDemoSessionId();
};
const rgsUrl = () => getUrlSearchParam('rgs_url') || '';
const social = () => getUrlSearchParam('social') === 'true';

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
	// states for replay
	replay,
	amount,
	game,
	mode,
	version,
	event,
};
