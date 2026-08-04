import { error, json } from '@sveltejs/kit';
import { isFlowV2Doc, saveFlowV2Doc } from '$lib/server/flowV2Storage';
import { ConflictError } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Save the authored Invisible Flow **v2** document to R2 as
 * `<client>/<project>/editor/flow-v2.json` (sibling of v1's `flow.json`). Mirrors
 * `/api/flow/save` EXACTLY for auth + scope: the shared `gate` resolves the SESSION-bound
 * `(client, project)` and 403s unless the user is entitled to the `flow` tool (`/flow-v2` is a
 * dev route with no registry entry, so it reuses v1 Flow's entitlement) — no hand-rolled
 * auth/scope/R2. The body is shape-checked as a v2 `FlowDoc` server-side so a malformed body
 * can never corrupt the stored doc.
 *
 * Guarded by the caller's `baseEtag` (Phase 1 of `docs/design/multi-user-concurrency.md`):
 * a stale one answers **409** rather than overwriting whoever saved first. `force: true`
 * is the author's explicit "overwrite theirs" from the conflict banner.
 *
 * Body: `{ doc: <FlowDoc v2>, baseEtag?: string | null, force?: boolean }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flow',
		forbiddenMessage: 'Your role does not have access to Invisible Flow.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || !isFlowV2Doc(body.doc)) throw error(400, 'missing or malformed v2 doc');

	// SCOPE GUARD — this endpoint resolves the project from the SESSION, but the page
	// that loaded the doc resolved it from `?project=` (which `resolveToolScope` syncs
	// INTO the session). So switching project in another tab leaves this tab holding
	// project X's doc while its save now targets Y. Unguarded that is a silent
	// cross-project clobber; with `If-Match` it would masquerade as an ordinary
	// conflict and invite the author to "overwrite" — destroying an unrelated project.
	// Refuse instead, and note `force` deliberately does NOT bypass this: overwriting
	// YOUR doc is a choice, overwriting SOMEONE ELSE'S project never is.
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return json(
			{
				ok: false,
				error: 'scope-mismatch',
				message:
					`This tab is editing "${body.projectKey}" but your active project is now ` +
					`"${projectKey}". Reload to continue — saving here would write to the wrong project.`,
			},
			{ status: 409 },
		);
	}

	const baseEtag = writeBaseEtagJson(body);

	try {
		const { etag } = await saveFlowV2Doc(clientKey, projectKey, body.doc, baseEtag);
		return json({ ok: true, updatedAt: new Date().toISOString(), etag });
	} catch (e) {
		if (e instanceof ConflictError) {
			// `json({error})`, never `error()` — the latter surfaces as an opaque 502 and
			// hides the cause ([[gotcha_publish_502_flowv2_nodes_guard]]).
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this flow while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		throw e;
	}
};
