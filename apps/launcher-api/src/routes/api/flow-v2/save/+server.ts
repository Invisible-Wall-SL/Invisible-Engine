import { error, json } from '@sveltejs/kit';
import { isFlowV2Doc, saveFlowV2Doc } from '$lib/server/flowV2Storage';
import { gate } from '$lib/server/toolScope';
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
 * Body: `{ doc: <FlowDoc v2> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flow',
		forbiddenMessage: 'Your role does not have access to Invisible Flow.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || !isFlowV2Doc(body.doc)) throw error(400, 'missing or malformed v2 doc');

	await saveFlowV2Doc(clientKey, projectKey, body.doc);
	return json({ ok: true, updatedAt: new Date().toISOString() });
};
