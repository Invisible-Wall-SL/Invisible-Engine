import { error, json } from '@sveltejs/kit';
import { saveClip } from '$lib/server/flipbookStorage';
import { ConflictError } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Save one Invisible Flipbook clip to R2 (design doc `invisible-flipbook.md` step 4). Mirrors
 * `/api/fx/save` EXACTLY for auth + scope: the shared `gate` resolves the SESSION-bound
 * `(client, project)` and 403s unless the user is entitled to the `flipbook` tool — no
 * hand-rolled auth/scope/R2.
 *
 * `saveClip` writes ONE object, `<id>.clip.json`, with `normalizeFlipbookClip` as the gatekeeper
 * so editor-only state can never leak into the shipped doc. There is no `.meta` sidecar (unlike
 * FX): a clip has no camera or selection state — the ordered frame list IS the document.
 *
 * Guarded by `baseEtag` (Phase 1 of `docs/design/multi-user-concurrency.md`): a stale one answers
 * **409** rather than replacing a concurrent author's clip. `baseEtag: null` (a never-saved clip)
 * asserts the id is free — which is what stops the CREATE clobber, since a new clip's id is
 * slugged from its NAME.
 *
 * Body: `{ clip: <FlipbookClip>, projectKey?, baseEtag?: string | null, force? }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.clip !== 'object' || body.clip === null) {
		throw error(400, 'missing clip');
	}
	// `saveClip` rejects a clip with no source sheet by throwing, and the catch below only
	// handles ConflictError — so without this an author who hits Save before picking a sheet
	// would get a bare 500 instead of being told what's missing.
	const assetKey = (body.clip as Record<string, unknown>).assetKey;
	if (typeof assetKey !== 'string' || !assetKey.trim()) {
		throw error(400, 'Pick a source sheet before saving this clip.');
	}

	// SCOPE GUARD — this endpoint resolves the project from the SESSION while the /flipbook page
	// resolves it from `?project=`, so a tab can hold project X's clip while its save targets Y.
	// Refuse rather than write to the wrong project; `force` does not bypass this (overwriting
	// your own clip is a choice, another project's never is).
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
		const { id, clip, etag } = await saveClip(clientKey, projectKey, body.clip, baseEtag);
		return json({ ok: true, id, name: clip.name, frames: clip.frames.length, etag });
	} catch (e) {
		if (e instanceof ConflictError) {
			// A never-saved clip (baseEtag null) conflicts because the NAME is taken — say that,
			// rather than "someone saved while you were editing", which would be baffling for a
			// clip the author just created.
			const isCreate = baseEtag === null;
			return json(
				{
					ok: false,
					error: 'conflict',
					message: isCreate
						? 'A clip with that name already exists in this project. ' +
							'Rename yours, or overwrite theirs.'
						: 'Someone else saved this clip while you were editing. ' +
							'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		throw e;
	}
};
