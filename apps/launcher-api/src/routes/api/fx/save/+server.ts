import { error, json } from '@sveltejs/kit';
import { saveEffect } from '$lib/server/fxStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Save an Invisible FX effect to R2 (design doc `invisible-fx.md` §6 / §8). Mirrors
 * `/api/rigger/save` + `/api/flow/save` EXACTLY for auth + scope: the shared `gate`
 * resolves the SESSION-bound `(client, project)` and 403s unless the user is entitled to
 * the `fx` tool — no hand-rolled auth/scope/R2.
 *
 * `saveEffect` writes TWO separate objects — the canonicalized `<id>.fx.json` EffectDoc and
 * the editor-only `<id>.fx.meta.json` sidecar — running `normalizeEffectDoc` as the
 * gatekeeper so editor-only state can never leak into the shipped doc (§4).
 *
 * Body: `{ doc: <EffectDoc>, meta?: <FxMeta> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.doc !== 'object' || body.doc === null) throw error(400, 'missing doc');

	const { id, doc } = await saveEffect(clientKey, projectKey, body.doc, body.meta);
	return json({ ok: true, id, name: doc.name, layers: doc.layers.length });
};
