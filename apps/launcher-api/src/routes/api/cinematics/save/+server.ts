import { error, json } from '@sveltejs/kit';
import { isCinematicDoc, saveCinematic } from '$lib/server/cinematicStorage';
import { ConflictError } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Save one cinematic to `<client>/<project>/cinematics/<id>.json`.
 *
 * Guarded by the caller's `baseEtag` precondition (`docs/design/multi-user-concurrency.md`
 * Phase 1): a stale one answers **409** instead of overwriting whoever saved first.
 * `force: true` is the author's explicit "overwrite theirs" from the conflict prompt.
 *
 * Body: `{ doc: <CinematicDoc>, baseEtag?: string | null, force?: boolean, projectKey?: string }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || !isCinematicDoc(body.doc)) throw error(400, 'missing or malformed cinematic doc');

	// SCOPE GUARD — this endpoint resolves the project from the SESSION, but the tab that loaded
	// the doc resolved it when it opened. Switching project in another tab leaves this one holding
	// project X's cinematic while its save now targets Y. Unguarded that is a silent cross-project
	// clobber; with `If-Match` alone it would masquerade as an ordinary conflict and invite the
	// author to "overwrite" — destroying an unrelated project's work. `force` deliberately does
	// NOT bypass this: overwriting YOUR doc is a choice, overwriting SOMEONE ELSE'S never is.
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
		const { etag, id } = await saveCinematic(clientKey, projectKey, body.doc, baseEtag);
		return json({ ok: true, id, etag, updatedAt: new Date().toISOString() });
	} catch (e) {
		if (e instanceof ConflictError) {
			// `json({error})`, never `error()` — the latter surfaces as an opaque 502 and hides the
			// cause ([[gotcha_publish_502_flowv2_nodes_guard]]).
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this cinematic while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		// Anything else (an R2 credential/permission problem, a bucket misconfiguration, a network
		// fault) would otherwise become SvelteKit's opaque HTML 500, which reaches the author as
		// "save failed (500)" and nothing more. Report the real reason instead: the tool shows it in
		// its error bar, so a failed save is self-diagnosing rather than a silent "still unsaved".
		console.error('[cinematics/save] failed:', e);
		return json(
			{
				ok: false,
				error: 'save-failed',
				message: `Could not write the cinematic to storage: ${e instanceof Error ? e.message : String(e)}`,
			},
			{ status: 500 },
		);
	}
};
