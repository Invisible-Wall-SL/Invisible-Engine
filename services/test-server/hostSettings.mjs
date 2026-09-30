/**
 * OPERATOR HOST SETTINGS for the Invisible Test Server.
 *
 * A partner's embed page hands the game `window.params.GameSettings.config` — what THIS launch may
 * do (a minimum spin duration, an autoplay ladder, a lobby link, …). Our games are launched from
 * here, not from an operator's page, so nothing declares any of it and every one of those behaviours
 * sits at its neutral default. To test them without the partner, this server can play the operator:
 *
 *   - PER PROJECT: `hostSettings: { … }` on the game's entry in `test_server/games.json`;
 *   - PER LAUNCH:  `?host={"minSpinDuration":3000}` on the game URL (JSON, URL-encoded), merged over
 *     the project's — honoured only on a URL that also carries the project's read token (`k`), i.e.
 *     one of our own authoring/test links, so a crafted link cannot point a game's HOME button or
 *     money symbol somewhere else.
 *
 * Either one injects a real `window.params` into the served page, exactly the object the partner's
 * page builds, so the game reads it through the same path it reads theirs. Neither ⇒ the page is
 * served byte-for-byte. The field contract is `docs/reference/play4fun-protocol.md` § Host settings.
 */

const HOST_PARAM = 'host';

const isPlainObject = (value) =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const validHostSettings = (raw, key) => {
	if (raw === undefined || raw === null) return null;
	if (!isPlainObject(raw)) {
		console.warn(`[test-server] '${key}' hostSettings is not an object — ignored`);
		return null;
	}
	return Object.keys(raw).length ? raw : null;
};

/** The `?host=` override, or null. A malformed one is refused with a warning, never half-applied. */
export const hostOverride = (url) => {
	const raw = url.searchParams.get(HOST_PARAM);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (isPlainObject(parsed)) return parsed;
	} catch {
		/* fall through */
	}
	console.warn(`[test-server] ?${HOST_PARAM}= is not a JSON object — ignored`);
	return null;
};

/** The operator config a launch of `meta` declares: the project's, then the URL's on top. */
export const hostConfigFor = (meta, url) => {
	const trusted = Boolean(meta.readToken) && url.searchParams.get('k') === meta.readToken;
	const override = url.searchParams.has(HOST_PARAM)
		? trusted
			? hostOverride(url)
			: (console.warn(`[test-server] ?${HOST_PARAM}= ignored — the URL carries no read token`),
				null)
		: null;
	const config = { ...(meta.hostSettings ?? {}), ...(override ?? {}) };
	return Object.keys(config).length ? config : null;
};

/**
 * `html` with `window.params` set before any other script runs. `<` is escaped so no value can close
 * the script element it is written into.
 */
export const injectHostSettings = (html, config) => {
	const params = { GameSettings: { token: '', service: '', config } };
	const json = JSON.stringify(params).replace(/</g, '\\u003c');
	const tag = `<script>window.params=${json};</script>`;
	const head = html.match(/<head[^>]*>/i);
	return head ? html.replace(head[0], () => `${head[0]}${tag}`) : `${tag}${html}`;
};
