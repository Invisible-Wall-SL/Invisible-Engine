import { error, json } from '@sveltejs/kit';
import type { CinematicDoc } from 'engine-layout';
import { canPublishSharedTimeline, cinematicGate } from '$lib/server/cinematicAccess';
import { isCinematicDoc } from '$lib/server/cinematicStorage';
import { ConflictError } from '$lib/server/r2';
import { SharedPointerCorruptError, promoteSharedCinematic } from '$lib/server/sharedCinematics';
import { linkOf, sharedTimelineId, toSharedContent } from '$lib/timeline/sharedTimelines';
import type { RequestHandler } from './$types';

/**
 * Promote a project timeline to the shared library as the next version of `_shared/cinematics/<id>`
 * (Rive plan Phase 9d). Gated on the `componentPublish` capability, like *Promote to shared* for
 * components. The project timeline itself is not touched: it stays the project's own.
 *
 * Body: `{ doc, name, sharedId?, baseEtag: string | null }`. `baseEtag` is REQUIRED — the latest
 * pointer's ETag as the promoter read it (`null` = the id is new): a stale one answers **409**
 * instead of replacing someone else's version. `sharedId` defaults to a slug of `name`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	await cinematicGate(locals, cookies);
	if (!(await canPublishSharedTimeline(locals)))
		throw error(403, 'Your role cannot publish to the shared timeline library.');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || !isCinematicDoc(body.doc)) throw error(400, 'missing or malformed timeline');
	if (linkOf(body.doc)) {
		throw error(400, 'This timeline is a link to a shared one already — detach it first.');
	}
	if (!('baseEtag' in body) || (body.baseEtag !== null && typeof body.baseEtag !== 'string'))
		throw error(400, 'This promote did not send its baseEtag precondition.');
	const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : body.doc.name;
	// Always through `sharedTimelineId`, so a promote can never land on (and shadow) a starter.
	const sharedId = sharedTimelineId(
		typeof body.sharedId === 'string' && body.sharedId ? body.sharedId : name,
	);
	const content = toSharedContent(body.doc as unknown as CinematicDoc, sharedId, name, 1);
	if (!content.stage.cast.length)
		throw error(400, 'This timeline animates nothing yet — key a node before promoting it.');
	try {
		const { id, version, etag } = await promoteSharedCinematic(content, body.baseEtag);
		return json({ ok: true, id, version, etag });
	} catch (e) {
		if (e instanceof SharedPointerCorruptError) {
			return json({ ok: false, error: 'corrupt', message: e.message }, { status: 409 });
		}
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message: `Someone else promoted "${name}" to the shared library meanwhile. Reload it, then promote again on top.`,
				},
				{ status: 409 },
			);
		}
		console.error('[cinematics/shared/promote] failed:', e);
		return json(
			{
				ok: false,
				error: 'save-failed',
				message: `Could not write the shared timeline: ${e instanceof Error ? e.message : String(e)}`,
			},
			{ status: 500 },
		);
	}
};
