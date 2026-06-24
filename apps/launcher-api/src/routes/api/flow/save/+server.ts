import { error, json } from '@sveltejs/kit';
import { saveFlowDoc } from '$lib/server/flowStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Save the authored Invisible Flow document to R2 as `<client>/<project>/editor/flow.json`
 * (sibling of the Scene Editor's `scenes.json`). Mirrors `/api/rigger/save` EXACTLY for
 * auth + scope: the shared `gate` resolves the SESSION-bound `(client, project)` and 403s
 * unless the user is entitled to the tool — no hand-rolled auth/scope/R2. The FlowDoc is
 * normalized server-side (the `engine-flow` `normalizeFlowDoc` contract), so a malformed
 * body can never corrupt the stored doc (parity rule §7).
 *
 * Body: `{ doc: <FlowDoc> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flow',
		forbiddenMessage: 'Your role does not have access to Invisible Flow.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.doc !== 'object' || body.doc === null) throw error(400, 'missing doc');

	const saved = await saveFlowDoc(clientKey, projectKey, body.doc);
	return json({ ok: true, updatedAt: saved.updatedAt });
};
