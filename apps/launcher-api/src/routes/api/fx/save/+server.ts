import { error, json } from '@sveltejs/kit';
import { saveEffect } from '$lib/server/fxStorage';
import { ConflictError, jsonBaseEtag } from '$lib/server/r2';
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
 * Guarded by `baseEtag` (Phase 1 of `docs/design/multi-user-concurrency.md`): a stale one
 * answers **409** rather than replacing a concurrent author's effect. `baseEtag: null`
 * (a never-saved effect) asserts the id is free — which is what stops the CREATE clobber,
 * since a new effect's id is slugged from its NAME.
 *
 * Body: `{ doc: <EffectDoc>, meta?: <FxMeta>, projectKey?, baseEtag?: string | null, force? }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.doc !== 'object' || body.doc === null) throw error(400, 'missing doc');

	// SCOPE GUARD — this endpoint resolves the project from the SESSION while the /fx page
	// resolves it from `?project=`, so a tab can hold project X's effect while its save
	// targets Y. Refuse rather than write to the wrong project; `force` does not bypass
	// this (overwriting your own effect is a choice, another project's never is).
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

	const baseEtag = body.force === true ? undefined : jsonBaseEtag(body.baseEtag);

	try {
		const { id, doc, etag } = await saveEffect(
			clientKey,
			projectKey,
			body.doc,
			body.meta,
			baseEtag,
		);
		return json({ ok: true, id, name: doc.name, layers: doc.layers.length, etag });
	} catch (e) {
		if (e instanceof ConflictError) {
			// A never-saved effect (baseEtag null) conflicts because the NAME is taken —
			// say that, rather than "someone saved while you were editing", which would be
			// baffling for an effect the author just created.
			const isCreate = baseEtag === null;
			return json(
				{
					ok: false,
					error: 'conflict',
					message: isCreate
						? 'An effect with that name already exists in this project. ' +
							'Rename yours, or overwrite theirs.'
						: 'Someone else saved this effect while you were editing. ' +
							'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		throw e;
	}
};
