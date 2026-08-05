import { ENV } from './env';

/**
 * Best-effort read of a game's REAL paylines straight from its mock RGS, for the Invisible Game
 * Config tool's read-only Paylines preview. The game is server-authoritative for paylines at
 * runtime (it reads its active lines from the RGS), so the tool showing the SAVED doc's lines (e.g.
 * 20 authored) can disagree with what the server actually deals (e.g. Book of Borut = 10). This
 * fetches the live set so the panel reflects the server.
 *
 * Why a global-reachable fetch is safe here: the target is OUR OWN Invisible Test Server
 * (`TEST_SERVER_URL`, default `games.invisiblewall.org`) — not the Cloudflare-challenged production
 * Play4Fun edge that bounces server-side fetches. And it DEGRADES GRACEFULLY: a fresh heartbeat is
 * a read-only, side-effect-free probe, and ANY failure (network, timeout, 404, non-JSON, no config
 * event) returns `null` so the page falls back to rendering the saved doc — the preview is additive,
 * never load-bearing.
 */

/** How long to wait on the RGS before giving up and falling back to the saved doc. */
const FETCH_TIMEOUT_MS = 3000;

interface RgsConfigContext {
	availablePayLines?: number[][];
	paylines?: number[][];
}

interface RgsEngineResponse {
	events?: { event?: string; context?: RgsConfigContext }[];
}

/**
 * Fetch the server's paylines for `gameKey` (== the launcher project key; see `publishGame.ts`,
 * where the game key is the project key verbatim). Sends an empty-body heartbeat with a FRESH `sid`
 * per call: both mocks emit the boot `config` event on a session's first call (the lines mock ONLY
 * then), so a never-seen sid guarantees the config comes back. The BOOK mock names the field
 * `availablePayLines`; the LINES mock names it `paylines` — read either.
 *
 * Returns `null` on any failure — this is a preview convenience, not a hard dependency.
 */
export async function fetchServerPaylines(gameKey: string): Promise<number[][] | null> {
	const base = ENV.TEST_SERVER_URL.replace(/\/+$/, '');
	const sid = `cfg-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const url = `${base}/api/${encodeURIComponent(gameKey)}/rgs/engine?sid=${sid}&seq=0`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '[]',
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const body = (await res.json()) as RgsEngineResponse;
		const config = body.events?.find((e) => e.event === 'config')?.context;
		if (!config) return null;
		const lines = config.availablePayLines ?? config.paylines ?? null;
		// Empty ⇒ null so the page falls back to the saved doc rather than previewing "0 lines".
		return Array.isArray(lines) && lines.length > 0 ? lines : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
