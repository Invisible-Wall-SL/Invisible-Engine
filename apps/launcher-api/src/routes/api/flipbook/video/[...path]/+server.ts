import { error } from '@sveltejs/kit';
import { BLUEPRINT_PUBLISH_CAPABILITY, roleHasCapability } from '$lib/roles';
import { ENV } from '$lib/server/env';
import { r2Slug } from '$lib/server/projectPaths';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { gate } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Proxy for the Flipbook **Video mode** (design `invisible-flipbook-video.md` step 2).
 *
 * Generation lives in `services/atlas-tool` — that one process already owns the blueprint
 * library, the generic runner, the RunPod Serverless transport and the packer. Rather than
 * re-implement any of it in Node, the `/flipbook` page calls these launcher routes and they
 * forward to the tool.
 *
 * The launcher stays the gate: the shared `gate` resolves the SESSION-bound `(client, project)`
 * and 403s unless the user is entitled to the `flipbook` tool — exactly as `/api/flipbook/save`
 * does. `ATLAS_TOOL_SECRET` is appended server-side and never reaches the browser.
 *
 * **The path is an explicit ALLOW-LIST, not a pass-through.** A `[...path]` rest route that
 * forwarded whatever it was given would hand any flipbook user the whole atlas-tool surface —
 * `/render`, `/deleteblueprint`, `/createatlas` — under a gate that never mentions them. Only the
 * routes below are reachable, and each one is named here.
 */
const GET_ROUTES: Record<string, string> = {
	blueprints: '/video/blueprints',
	sessions: '/video/sessions',
	status: '/video/status',
	file: '/video/file',
	// The source-image picker. `/fsbrowse` is the atlas-tool's own R2 picker and it already
	// returns paths in the exact form the runner resolves (`sheets/…`, `sheet_src/…`,
	// input-rooted `refs/…`) — a launcher-side picker would have to reproduce that mapping and
	// would drift from it. See docs/ui-inventory.md §1.
	refs: '/fsbrowse',
	// Frame count / size / fps / has-alpha for one variation, so the trim panel can
	// show a cost (and warn about opaque frames) before anything is packed.
	probe: '/video/probe',
	// Diagnostic for the empty-list case — see `library_status` in blueprints.py.
	library: '/video/library',
};

const POST_ROUTES: Record<string, string> = {
	generate: '/video/generate',
	cancel: '/video/cancel',
	delete: '/video/delete',
	// Per-variation editing, all four scoped to one session's own grid: re-roll a
	// slot in place (optionally against a changed prompt or a held seed), drop one
	// render, append more rolls of the same recipe to the session, or run one
	// slot's recipe again as a NEW slot with any of its settings changed.
	regen: '/video/regen',
	discard: '/video/discard',
	add: '/video/add',
	duplicate: '/video/duplicate',
	// Extract → trim → pack → write sheet(s). Runs inline in the tool (seconds of
	// Pillow work), so this request is slow-ish but synchronous.
	toclip: '/video/toclip',
	// Publish a blueprint to the SHARED library. Gated twice over — see `forward`.
	publish: '/uploadblueprint',
	// A node's REAL input contract from ComfyUI's `/object_info` — the ranges and option
	// lists the importer records on a param, and the Generate panel re-reads live. A POST
	// because it carries either `classes[]` (the importer's graph) or `blueprint` (the panel).
	nodespecs: '/video/nodespecs',
};

/** Query params the proxy forwards. Anything else is dropped rather than relayed. */
const PASS_PARAMS = ['session', 'v', 'path', 'key'];

async function forward(
	locals: App.Locals,
	cookies: Parameters<typeof gate>[1],
	route: string | undefined,
	table: Record<string, string>,
	url: URL,
	body?: string,
): Promise<Response> {
	const target = table[(route ?? '').trim()];
	if (!target) throw error(404, 'not found');

	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
	});

	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (!base) throw error(503, 'The Atlas Maker service is not configured (ATLAS_TOOL_URL).');

	const params = new URLSearchParams();
	if (ENV.ATLAS_TOOL_SECRET) params.set('k', ENV.ATLAS_TOOL_SECRET);
	params.set('client', clientKey);
	params.set('project', projectKey);
	// Per-user ComfyUI routing (docs/design/per-user-comfyui-routing.md) — same slug the
	// `/atlas` handoff and the tool itself use, so all three agree on the key.
	if (locals.user?.id) params.set('user', r2Slug(locals.user.id));
	for (const p of PASS_PARAMS) {
		const v = url.searchParams.get(p);
		if (v !== null) params.set(p, v);
	}

	// Publishing writes to the library EVERY project reads, so it carries its own
	// capability on top of the tool gate — the same `blueprintPublish` check the
	// /atlas handoff makes. The gate is by KNOWLEDGE OF THE SECRET, not a
	// forgeable flag: every flipbook user already holds `?k=`, so `bp` is appended
	// only for a holder, and the tool refuses to publish without it.
	let outgoing = body;
	if (target === '/uploadblueprint') {
		if (!ENV.ATLAS_BLUEPRINT_SECRET) {
			throw error(503, 'Blueprint publishing is not configured (ATLAS_BLUEPRINT_SECRET).');
		}
		// `gate` above throws 401 without a session, so a user exists here — but say
		// so in the types rather than coercing a Role to '' and hoping.
		const user = locals.user;
		if (!user) throw error(401, 'Not signed in.');
		const [roleOverrides, userOverrides] = await Promise.all([
			getRoleOverrides(user.role),
			getToolOverrides(user.id),
		]);
		if (!roleHasCapability(user.role, BLUEPRINT_PUBLISH_CAPABILITY, roleOverrides, userOverrides)) {
			throw error(403, "You don't have permission to publish blueprints. Ask an admin.");
		}
		params.set('bp', ENV.ATLAS_BLUEPRINT_SECRET);
		// This is the VIDEO tool's uploader, so what it publishes is a video
		// blueprint — decided here rather than trusted from the client, which
		// would let this route quietly publish into the Atlas Maker's picker.
		try {
			outgoing = JSON.stringify({ ...JSON.parse(body ?? '{}'), kind: 'video' });
		} catch {
			throw error(400, 'Request body was not valid JSON.');
		}
	}

	let res: Response;
	try {
		res = await fetch(`${base}${target}?${params.toString()}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: outgoing,
		});
	} catch (e) {
		// A generation session is long-running and the tool cold-starts on Railway, so an
		// unreachable tool is a normal-ish condition — say which service, not "fetch failed".
		throw error(502, `Could not reach the Atlas Maker service: ${(e as Error).message}`);
	}

	// Stream the body through untouched: `/video/file` returns image/webp bytes, everything
	// else JSON. Re-encoding either would be pure loss.
	return new Response(res.body, {
		status: res.status,
		headers: {
			'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
			// Variations are immutable once written (a re-roll is a new index), so let the grid
			// keep them; a session's JSON must never be cached or the poll sees a stale status.
			'Cache-Control': target === '/video/file' ? 'private, max-age=300' : 'no-store',
		},
	});
}

export const GET: RequestHandler = async ({ params, url, locals, cookies }) =>
	forward(locals, cookies, params.path, GET_ROUTES, url);

export const POST: RequestHandler = async ({ params, url, locals, cookies, request }) =>
	forward(locals, cookies, params.path, POST_ROUTES, url, await request.text());
