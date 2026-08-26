import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { ConflictError } from '$lib/server/r2';
import { requireSoundAccess, resolveSoundScope } from '$lib/server/soundAccess';
import { loadSoundsDocWithEtag, saveSoundsDoc } from '$lib/server/soundsStorage';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Sound (`/sound`) library doc.
 *
 * Session-gated (logged-in + entitled to the `sound` tool, role + per-user overrides applied) —
 * the SAME entitlement gate the `/sound` page uses, NOT the deploy-token gate (that is the
 * sibling `/api/editor/export-sounds` route, for the build-time bake). REST rather than form actions
 * because the client is a rich `$state` doc, mirroring `/api/win-text` and `/api/editor/symbols`.
 *
 * The gate + scope live in `soundAccess.ts` — shared with the sibling `/api/sounds/file` route, so
 * a second route cannot ship a slightly different gate.
 *
 * See `docs/design/invisible-sound.md`.
 */

/** Read a project's sound library + its ETag (empty valid doc when never authored). The ETag is
 *  the precondition the client sends back on save. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await requireSoundAccess(locals);
	const { clientKey, projectKey } = await resolveSoundScope(url.searchParams.get('project'));
	try {
		const { doc, etag } = await loadSoundsDocWithEtag(clientKey, projectKey);
		return json({ clientKey, projectKey, doc, etag });
	} catch {
		throw error(502, 'Failed to load the sound library.');
	}
};

/**
 * Validate + persist a project's sound library to R2.
 *
 * Body: `{ doc, baseEtag?, force? }` — mirrors `/api/win-text`. `baseEtag` is the ETag the client
 * loaded; the write is conditional on it, so two authors on one project can't silently clobber each
 * other's whole library. `force: true` drops the precondition ("overwrite with mine").
 *
 * The returned `doc` is the NORMALIZED one, and the client must render it rather than its own
 * payload: `normalizeSoundsDoc` DROPS entries that could not name a playable sound (no file, an
 * invalid name, a duplicate), so a page that assumed its payload persisted would show a library the
 * project does not have.
 */
export const PUT: RequestHandler = async ({ request, url, locals }) => {
	await requireSoundAccess(locals);
	const { clientKey, projectKey } = await resolveSoundScope(url.searchParams.get('project'));
	let body: { doc?: unknown; baseEtag?: unknown; force?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { doc, etag } = await saveSoundsDoc(clientKey, projectKey, body.doc, baseEtag);
		return json({ clientKey, projectKey, doc, etag });
	} catch (e) {
		if (e instanceof ConflictError) {
			// `json({error})`, never `error()` — the latter surfaces as an opaque 502 and hides the
			// cause. This branch MUST precede the catch-all below for that reason.
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this sound library while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		if (e instanceof ZodError) throw error(400, 'Invalid sound library document.');
		throw error(502, 'Failed to save the sound library.');
	}
};
