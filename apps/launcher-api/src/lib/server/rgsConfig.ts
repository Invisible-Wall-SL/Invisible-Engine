import { ENV } from './env';
import { listGamesOwnedByProject } from './games';
import type { TestServerManifest } from './testServerManifest';

/**
 * Reads of a game's boot `config` straight from its authoring RGS on the Invisible Test Server, for
 * the Invisible Game Config tool: the read-only Paylines preview and the paytable import.
 *
 * Why a global-reachable fetch is safe here: the target is OUR OWN Invisible Test Server
 * (`TEST_SERVER_URL`, default `games.invisiblewall.org`) — not the Cloudflare-challenged production
 * Play4Fun edge that bounces server-side fetches. An empty-body heartbeat is a read-only,
 * side-effect-free probe: no bet, no round.
 */

/**
 * Both readers are AUTHORING surfaces, so they ask the game's authoring mock — the one that deals the
 * SAVED config (`/api/<key>/authoring/…`, see `services/test-server/server.mjs`). The player mock
 * deals the last Publish, so reading it here showed the author their published paylines as the
 * server's, and offered to "import" the published prices over unpublished edits. A game with no
 * separate authoring mock (a desktop build, whose one mock already follows the saved config) is
 * served the same answer on this path.
 */
const serverBootConfigUrl = (base: string, gameKey: string, sid: string): string =>
	`${base.replace(/\/+$/, '')}/api/${encodeURIComponent(gameKey)}/authoring/rgs/engine?sid=${sid}&seq=0`;

/** How long the Paylines preview waits before falling back to the saved doc. */
const PREVIEW_TIMEOUT_MS = 3000;

interface RgsEngineResponse {
	events?: { event?: string; context?: unknown }[];
}

export type ServerBootConfig =
	| { ok: true; config: Record<string, unknown> }
	| { ok: false; reason: string };

/**
 * The boot `config` context `gameKey`'s RGS declares. Sends an empty-body heartbeat with a FRESH
 * `sid` per call, which both mocks answer with the `config` event — except a lines-family game that
 * sells an ante or a buy, which sends it only when asked. So a heartbeat without one is followed by
 * the non-stored `config` action on the same sid, the fallback the game's own facade uses. Never
 * throws — a failure names its cause.
 */
export async function fetchServerBootConfig(
	gameKey: string,
	timeoutMs: number,
): Promise<ServerBootConfig> {
	const sid = `cfg-read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const url = serverBootConfigUrl(ENV.TEST_SERVER_URL, gameKey, sid);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const post = async (body: string): Promise<RgsEngineResponse | string> => {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			signal: controller.signal,
		});
		if (!res.ok) return `the server answered HTTP ${res.status}`;
		try {
			return (await res.json()) as RgsEngineResponse;
		} catch {
			return 'the server did not answer with JSON';
		}
	};
	const configOf = (body: RgsEngineResponse) =>
		body.events?.find((e) => e.event === 'config')?.context;
	try {
		const probe = await post('[]');
		if (typeof probe === 'string') return { ok: false, reason: probe };
		let config = configOf(probe);
		if (!config) {
			const asked = await post('[{"action":"config"}]');
			if (typeof asked === 'string') return { ok: false, reason: asked };
			config = configOf(asked);
		}
		if (!config || typeof config !== 'object') {
			return { ok: false, reason: 'the server sent no boot config' };
		}
		return { ok: true, config: config as Record<string, unknown> };
	} catch (e) {
		return {
			ok: false,
			reason: controller.signal.aborted
				? `no answer within ${Math.round(timeoutMs / 1000)}s`
				: `the server could not be reached (${e instanceof Error ? e.message : String(e)})`,
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The server's paylines for `gameKey`, or `null` on any failure — the preview is a convenience, not
 * a hard dependency. The BOOK mock names the field `availablePayLines`; the LINES mock names it
 * `paylines` — read either. Empty ⇒ null so the page falls back to the saved doc rather than
 * previewing "0 lines".
 */
export async function fetchServerPaylines(gameKey: string): Promise<number[][] | null> {
	const boot = await fetchServerBootConfig(gameKey, PREVIEW_TIMEOUT_MS);
	if (!boot.ok) return null;
	const lines = boot.config.availablePayLines ?? boot.config.paylines ?? null;
	return Array.isArray(lines) && lines.length > 0 ? (lines as number[][]) : null;
}

/**
 * The test-server game keys whose RGS plays `projectKey`'s math, the online Game Maker's own
 * (`key = projectKey`, see `publishGame.ts`) first. A desktop-published title names its own key
 * (`waysofwavesbuild` is project `test6`), so the manifest's `projectKey` pin and the games table's
 * ownership count too. Only keys the manifest registers: the test server serves no other RGS.
 */
export async function projectServerGameKeys(
	projectKey: string,
	manifest: TestServerManifest,
): Promise<string[]> {
	const owned = new Set((await listGamesOwnedByProject(projectKey)).map((g) => g.key));
	const keys = Object.entries(manifest.games)
		.filter(([key, entry]) => entry.projectKey === projectKey || owned.has(key))
		.map(([key]) => key)
		.filter((key) => key !== projectKey)
		.sort();
	const own = manifest.games[projectKey];
	return own && (own.projectKey ?? projectKey) === projectKey ? [projectKey, ...keys] : keys;
}
