import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import {
	DEFAULT_PROJECT_KEY,
	projectAllowsRead,
	projectClientKey,
	projectName,
} from '$lib/server/projects';
import { currentPointer, readSnapshotBundle } from '$lib/server/publishedRuntime';
import { getRuntimeBundle } from '$lib/server/runtimeBundleCache';
import type { RequestHandler } from './$types';

/**
 * Generic-runtime boot endpoint (Invisible Game Maker, Phase 0). Returns — in ONE
 * payload — everything a prebuilt "generic engine runtime" needs to boot an
 * arbitrary project purely from a live fetch: the layout doc, its referenced
 * ComponentDefs + per-project param defaults, and the project's editor-art / fonts
 * / symbols / localization assets. The logical shape matches the build-time
 * `BakedBundle` the game's `editor-scenes.ts` consumes (the canonical contract),
 * PLUS an `assetBase` — the absolute URL prefix the runtime prepends to every asset
 * file ref below, resolving to THIS launcher's `/api/deploy` for this project+token.
 *
 * This is the LIVE equivalent of `scripts/bake-editor-doc.mjs`'s build-time freeze
 * (`runtimeBundle.ts` extracts the shared assembly), so changing a project's doc /
 * art / fonts / strings / symbols re-publishes with no rebuild.
 *
 * A deployed runtime runs on its own origin with no launcher session, so this is
 * NOT cookie-authed: it is gated by the SAME shared read token (`?k=` vs
 * `getDeployToken()`) as `/api/editor/doc` + `/api/deploy`. When the secret is
 * unset the endpoint refuses to serve (503) so it is never public. CORS is open
 * because the token, not the origin, is the gate.
 *
 *   GET /api/editor/runtime?project=<projectKey>&k=<token>
 *
 * `project` is the BARE launcher project key (the client is DB-resolved), matching
 * `/api/editor/doc` — NOT `<client>/<project>`.
 *
 * TWO SOURCES, chosen by who is asking (`X-IE-Runtime-Source` says which one answered):
 *  - `snapshot` — a PLAYER boot (no `authoring=1`) gets the immutable snapshot the last Publish
 *    froze (`publishedRuntime.ts`): no exporters, two small R2 reads (both cached in memory), and an
 *    `ETag` so a reload revalidates to a 304. `assetBase` points at that snapshot's frozen files.
 *  - `live` — an AUTHORING boot (`authoring=1`, launcher links only) assembles from the current
 *    authoring data, as every boot used to. Also `live-fallback` for a game published before
 *    snapshots existed: it keeps working exactly as before, and the log names it so it can be
 *    republished (Game Maker → Republish all creates the snapshot).
 */
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	// `Server-Timing` is not a CORS-safelisted response header, so a cross-origin reader (the game,
	// or DevTools on a game tab) cannot see it unless it is EXPOSED. Without this the header ships
	// and is invisible exactly where it is most useful. Same for the source + ETag.
	'Access-Control-Expose-Headers': 'Server-Timing, X-IE-Runtime-Source, ETag',
	'Cache-Control': 'no-store',
};

/**
 * `If-None-Match` against a snapshot id. A compressing proxy weakens a strong ETag to `W/"…"` and
 * the browser echoes that back, so compare the opaque part only.
 */
function etagMatches(header: string | null, id: string): boolean {
	if (!header) return false;
	return header
		.split(',')
		.map((t) => t.trim().replace(/^W\//, ''))
		.some((t) => t === '*' || t === `"${id}"`);
}

/**
 * The published snapshot for a player boot, or null when the game has none yet. `no-cache` (not
 * `no-store`) so the browser keeps the body and revalidates it: a republish or rollback changes the
 * pointer, hence the ETag, and the very next boot gets it.
 */
async function snapshotResponse(
	request: Request,
	url: URL,
	clientKey: string,
	projectKey: string,
	token: string,
): Promise<Response | null> {
	const pointer = await currentPointer(clientKey, projectKey);
	if (!pointer) return null;
	const bundle = await readSnapshotBundle(clientKey, projectKey, pointer.current);
	if (!bundle) {
		console.error(
			`[runtime] "${projectKey}": published pointer names snapshot ${pointer.current} but its ` +
				'runtime.json is missing — serving the LIVE assemble instead. Republish to repair.',
		);
		return null;
	}
	const etag = `"${pointer.current}"`;
	const headers = {
		...CORS_HEADERS,
		'Cache-Control': 'no-cache',
		ETag: etag,
		'X-IE-Runtime-Source': 'snapshot',
	};
	if (etagMatches(request.headers.get('if-none-match'), pointer.current)) {
		return new Response(null, { status: 304, headers });
	}
	const assetBase =
		`${url.origin}/api/published/f/${encodeURIComponent(token)}` +
		`/${encodeURIComponent(projectKey)}/${pointer.current}/`;
	const name = (await projectName(projectKey)) ?? projectKey;
	const meta = pointer.snapshots.find((s) => s.id === pointer.current);
	return json(
		{
			assetBase,
			name,
			...bundle,
			published: { id: pointer.current, createdAt: meta?.createdAt ?? null },
		},
		{ headers },
	);
}

/**
 * The assemble's per-step breakdown as a `Server-Timing` header, so "which exporter cost the 33
 * seconds" is readable from a browser instead of only from the launcher's console.
 *
 * This exists because the cost is real and growing: `bookofborutremake` assembles in ~33s and its
 * FIRST request 502s at the gateway (the game survives only because `fetchRuntimeWithRetry` joins
 * the in-flight run), while a near-empty project answers in under 5s. The difference is per-project
 * CONTENT walked by the exporters on every read, so every project trends toward the slow number as
 * it fills up. Fixing that means moving exports off the read path — and this header is the data that
 * says which exporter to move first (see `runtimeBundleCache`'s "THE REAL FIX" note).
 *
 * Empty in, nothing out: a cache hit or an in-flight join did no work, and reporting someone else's
 * numbers would be worse than reporting none.
 */
function serverTimingHeader(timings: Record<string, number>): Record<string, string> {
	const entries = Object.entries(timings);
	if (!entries.length) return {};
	const value = entries
		// Step names are internal labels (`cinematics:load`), and `Server-Timing` names must be
		// tokens — so anything outside the token charset becomes `_` rather than emitting a header
		// a parser will reject and a reader will never see.
		.map(
			([name, ms]) => `${name.replace(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, '_')};dur=${Math.round(ms)}`,
		)
		.join(', ');
	return { 'Server-Timing': value };
}

export const GET: RequestHandler = async ({ url, request }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Runtime endpoint is not configured.');
	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	// Accept the shared deploy token (build CI) OR this project's own read token —
	// so a public Game Maker game URL embeds the per-project read-only token, never
	// the shared build/deploy secret (design doc gap #3).
	const token = url.searchParams.get('k') ?? '';
	if (!(await projectAllowsRead(projectKey, token))) throw error(401, 'Invalid or missing token.');

	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	// `authoring=1` — sent only by a game booted from a launcher link (`ie_authoring=1`), never by
	// a published player URL — gets the live assemble (with UNREVIEWED translations, so an author can
	// see machine output before vetting it). Everyone else gets what was published.
	const authoring = url.searchParams.get('authoring') === '1';

	if (!authoring) {
		try {
			const published = await snapshotResponse(request, url, clientKey, projectKey, token);
			if (published) return published;
		} catch (e) {
			console.error(`[runtime] "${projectKey}": published snapshot read failed:`, e);
			throw error(502, 'Failed to read the published game.');
		}
		console.warn(
			`[runtime] "${projectKey}": no published snapshot — LIVE assemble for a player boot ` +
				'(legacy publish). Republish it to serve a snapshot.',
		);
	}

	try {
		// Single-flighted + briefly cached: assembling this re-runs every exporter (~20-26s in
		// production), so a per-request assemble made concurrent boots pile up and 502. See
		// `runtimeBundleCache`. The player-facing variant stays reviewed-only.
		// Per-step assemble timings, surfaced as `Server-Timing` below. Stays EMPTY when this request
		// did not assemble (a cache hit, or a join onto someone else's in-flight run) — which is the
		// honest answer for those requests rather than someone else's numbers.
		const timings: Record<string, number> = {};
		const bundle = await getRuntimeBundle(projectKey, authoring, timings);

		// Absolute PATH prefix the runtime prepends to every deploy-relative asset
		// path (`json`/`file`/`atlas`/`skeleton` below). MUST be the path form
		// (`/api/deploy/f/<token>/<client>/<project>/`) — NOT the query form — so a
		// sub-file named inside a parent (rig atlas page, spritesheet page, bitmap
		// font page) resolves correctly when the runtime loads it RELATIVE to the
		// parent's URL. The token + project survive as leading path segments; the
		// query form would drop them on relative resolution. Ends with `/` so the
		// runtime appends the relative path directly.
		const assetBase =
			`${url.origin}/api/deploy/f/${encodeURIComponent(token)}` +
			`/${encodeURIComponent(clientKey)}/${encodeURIComponent(projectKey)}/`;

		// The launcher's project display name, so the boot loading screen can show the real
		// game title (e.g. "Book of Borut") instead of the bare slug. Falls back to the key.
		const name = (await projectName(projectKey)) ?? projectKey;

		return json(
			{ assetBase, name, ...bundle },
			{
				headers: {
					...CORS_HEADERS,
					...serverTimingHeader(timings),
					'X-IE-Runtime-Source': authoring ? 'live' : 'live-fallback',
				},
			},
		);
	} catch (e) {
		console.error('runtime bundle failed:', e);
		throw error(502, 'Failed to assemble the runtime bundle.');
	}
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
