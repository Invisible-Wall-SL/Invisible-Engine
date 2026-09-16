/**
 * Mint a session on a PARTNER RGS, server-side.
 *
 * A partner's session endpoint is an ADMIN one — it takes a username and password and will create a
 * session for any player id. Those credentials can never reach a browser: anything in the bundle is
 * readable by anyone who opens devtools, and with them a player could mint sessions for other
 * players. So the launcher holds them, mints on the user's behalf, and hands the game only the
 * resulting token. That split is the whole reason this module exists.
 *
 * Config lives in ONE env var, `PARTNER_RGS`, a JSON map keyed by the delivery-profile id the game
 * will be launched with:
 *
 *   PARTNER_RGS={"2complex":{"baseUrl":"https://gs.2-complex.science",
 *                            "adminPath":"/webnode/api/admin.js",
 *                            "user":"…","pass":"…","gameId":"2"}}
 *
 * One var rather than one per partner per field, so adding a partner is a single secret to set and
 * nothing to deploy.
 *
 * The raw value is PASSED IN rather than read from `ENV` here, so this module is plain functions
 * over a string and a `fetch` — testable offline, which config parsing that guards credentials
 * ought to be. `$env/dynamic/private` is a SvelteKit virtual module and importing it would make
 * every one of these paths reachable only through a running server.
 */

export interface PartnerRgsConfig {
	/** Origin of the partner RGS, e.g. `https://gs.2-complex.science`. */
	baseUrl: string;
	/** Path of the admin endpoint that creates sessions. */
	adminPath: string;
	user: string;
	pass: string;
	/** The partner's game id. Optional here so a caller can name a different game per launch. */
	gameId?: string;
	/** Player ids the partner has ALREADY created. This partner refuses an unknown `remote_id`
	 *  ("player not found"), so we cannot mint one per launcher user — we can only spread users
	 *  across the pool it was given. Empty ⇒ a partner that creates players on demand, and the id is
	 *  derived from the user instead. */
	players?: string[];
	/** The query param the token rides in. MUST match the delivery profile's `session.param` — the
	 *  launcher decides where to PUT the token, the game decides where to READ it, and a
	 *  disagreement is a game that refuses to boot. Defaults to `sid`. */
	sessionParam?: string;
}

export class PartnerRgsError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = 'PartnerRgsError';
	}
}

/** Parse `PARTNER_RGS`. A malformed value is a configuration error worth naming precisely — but
 *  never by echoing the value, which holds credentials. */
export function partnerRgsRegistry(raw: string): Record<string, PartnerRgsConfig> {
	if (!raw) return {};

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new PartnerRgsError('PARTNER_RGS is not valid JSON', 500);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new PartnerRgsError('PARTNER_RGS must be a JSON object keyed by profile id', 500);
	}

	const out: Record<string, PartnerRgsConfig> = {};
	for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
		const entry = value as Partial<PartnerRgsConfig>;
		const missing = (['baseUrl', 'adminPath', 'user', 'pass'] as const).filter(
			(k) => typeof entry?.[k] !== 'string' || !entry[k],
		);
		if (missing.length) {
			throw new PartnerRgsError(`PARTNER_RGS["${id}"] is missing: ${missing.join(', ')}`, 500);
		}
		out[id] = {
			baseUrl: entry.baseUrl!.replace(/\/+$/, ''),
			adminPath: entry.adminPath!.startsWith('/') ? entry.adminPath! : `/${entry.adminPath!}`,
			user: entry.user!,
			pass: entry.pass!,
			...(typeof entry.gameId === 'string' && entry.gameId ? { gameId: entry.gameId } : {}),
			...(Array.isArray(entry.players) && entry.players.length
				? { players: entry.players.filter((p): p is string => typeof p === 'string' && !!p) }
				: {}),
			sessionParam:
				typeof entry.sessionParam === 'string' && entry.sessionParam ? entry.sessionParam : 'sid',
		};
	}
	return out;
}

export function partnerRgsConfig(raw: string, profileId: string): PartnerRgsConfig {
	const config = partnerRgsRegistry(raw)[profileId];
	if (!config) {
		throw new PartnerRgsError(`No partner RGS configured for profile "${profileId}"`, 404);
	}
	return config;
}

/**
 * Which player id on the partner's side this launcher user plays as.
 *
 * Never a fixed literal: the test server once shipped `?sessionID=demo` to everyone, so every
 * visitor shared ONE server-side wallet and collided mid-round. A partner wallet is money-shaped
 * state, so two people testing at once must not land on the same one.
 *
 * But we cannot simply invent an id either — this partner answers "player not found" for a
 * `remote_id` it did not create (and does so with HTTP 200, see {@link partnerErrorText}). So when
 * the config names a POOL of pre-created players we spread users across it deterministically: the
 * same user always gets the same player, which keeps a wallet stable between launches, and
 * different users collide only once there are more of us than the pool has room for. With no pool
 * configured we derive the id, for a partner that creates players on demand.
 */
export function partnerRemoteId(userId: string, players?: string[]): string {
	if (!players?.length) return `iw-${userId}`;
	// FNV-1a, so the assignment is stable across processes and deployments — a per-boot random or a
	// counter would move a user's wallet from launch to launch.
	let hash = 0x811c9dc5;
	for (let i = 0; i < userId.length; i++) {
		hash ^= userId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return players[hash % players.length];
}

/**
 * The partner's own error text, when it answered with one.
 *
 * It reports failures as **HTTP 200** with an error-shaped body (`{"response":"player not found:
 * …","code":-1,"status":500}`), so `response.ok` proves nothing and a caller that only looked for a
 * token would raise a generic "no session token" — hiding the one sentence that says what is
 * actually wrong.
 */
function partnerErrorText(body: CreateSessionResponse): string {
	if (typeof body.error === 'string' && body.error) return body.error;
	const inner = body.response;
	if (typeof inner === 'string' && inner) return inner;
	return '';
}

interface CreateSessionResponse {
	status?: number;
	code?: number;
	/** An object on success; the partner puts its ERROR MESSAGE here as a plain string on failure. */
	response?: string | { token?: unknown; game_url?: unknown; gameName?: unknown };
	error?: unknown;
}

/** How long to wait on the partner before giving up. A launch that hangs should fail with a
 *  readable error, not a spinner. */
const MINT_TIMEOUT_MS = 10_000;

/**
 * Create a session and return its token.
 *
 * The credentials travel in the query string because that is the interface the partner exposes;
 * they never leave this process, and neither the token request nor its failures are logged with the
 * URL attached — a stray log line is the likeliest way a secret escapes.
 */
export async function mintPartnerSession(options: {
	config: PartnerRgsConfig;
	profileId: string;
	userId: string;
	gameId?: string;
	/** Force a specific partner player id, bypassing the pool assignment. */
	player?: string;
	fetchImpl?: typeof fetch;
}): Promise<{ token: string; gameName: string }> {
	const { config } = options;
	const gameId = options.gameId ?? config.gameId;
	if (!gameId) {
		throw new PartnerRgsError(
			`No game id for profile "${options.profileId}" — pass ?game= or set gameId in PARTNER_RGS`,
			400,
		);
	}

	const url = new URL(`${config.baseUrl}${config.adminPath}`);
	url.searchParams.set('action', 'create_session');
	url.searchParams.set(
		'remote_id',
		options.player ?? partnerRemoteId(options.userId, config.players),
	);
	url.searchParams.set('game_id', gameId);
	url.searchParams.set('usr', config.user);
	url.searchParams.set('passw', config.pass);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);
	let body: CreateSessionResponse;
	try {
		const response = await (options.fetchImpl ?? fetch)(url, {
			method: 'GET',
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new PartnerRgsError(`Partner RGS answered ${response.status} when creating a session`, 502); // prettier-ignore
		}
		body = (await response.json()) as CreateSessionResponse;
	} catch (error) {
		if (error instanceof PartnerRgsError) throw error;
		// Deliberately does NOT include the request URL: it carries the credentials.
		throw new PartnerRgsError(
			`Could not reach the partner RGS for profile "${options.profileId}"`,
			502,
		);
	} finally {
		clearTimeout(timer);
	}

	const partnerError = partnerErrorText(body);
	if (partnerError) {
		throw new PartnerRgsError(`Partner RGS refused the session: ${partnerError}`, 502);
	}

	const inner = typeof body.response === 'object' && body.response !== null ? body.response : null;
	const token = inner?.token;
	if (typeof token !== 'string' || !token) {
		throw new PartnerRgsError('Partner RGS returned no session token', 502);
	}
	const gameName = typeof inner?.gameName === 'string' ? inner.gameName : '';
	return { token, gameName };
}

/**
 * Point an existing launcher launch URL at a partner instead of our own RGS.
 *
 * Built by REWRITING the game's stored card URL rather than composing a fresh one, so everything
 * that makes an online game work — `runtime=1`, `project`, the read token `k` — is carried over
 * untouched and cannot drift from `publishGame`'s construction. Only the RGS half is swapped:
 * `rgs_url` and `sessionID` are ours and are dropped, `rgs_profile` and the partner's session param
 * take their place.
 */
export function partnerLaunchUrl(options: {
	cardUrl: string;
	profileId: string;
	token: string;
	/** The query param the delivery profile says the token rides in. */
	sessionParam: string;
	/** The query the launcher put on ITS link — see {@link forwardLaunchParams}. */
	from?: URLSearchParams;
}): string {
	const url = new URL(options.cardUrl);
	url.searchParams.delete('rgs_url');
	url.searchParams.delete('sessionID');
	url.searchParams.set('rgs_profile', options.profileId);
	url.searchParams.set(options.sessionParam, options.token);
	if (options.from) forwardLaunchParams(url, options.from);
	return url.toString();
}

/**
 * Carry the launcher's own click-time params across the redirect, so a partner card behaves like
 * every other card.
 *
 * The launcher home appends `project`, `k` and `ie_authoring=1` and SETS `lang`/`currency` when you
 * click a game (`(app)/+page.svelte` → `gameUrl`). On a partner card those land on THIS endpoint
 * instead of on the game, and without forwarding they would simply be lost.
 *
 * `ie_authoring=1` is the one that matters: it is what makes the game show a red banner when it
 * falls back to its last baked snapshot instead of rendering stale data silently. Losing it on the
 * card used to exercise real money-shaped flows is exactly backwards.
 *
 * The two halves are forwarded differently, to match what a normal card already does:
 *  - `lang`/`currency` are SET, because the launcher sets them too.
 *  - `project`/`k` are added ONLY IF ABSENT. The stored card URL carries the values `publishGame`
 *    wrote for that published game, and a normal card lets those win (the game reads the first
 *    occurrence of a repeated param). Overriding them here would make a partner card resolve its
 *    authoring data differently from the card it is a copy of.
 */
function forwardLaunchParams(target: URL, from: URLSearchParams): void {
	for (const key of ['lang', 'currency', 'ie_authoring'] as const) {
		const value = from.get(key);
		if (value) target.searchParams.set(key, value);
	}
	for (const key of ['project', 'k'] as const) {
		const value = from.get(key);
		if (value && !target.searchParams.has(key)) target.searchParams.set(key, value);
	}
}
