import { error, json } from '@sveltejs/kit';
import { assertReach, cinematicGate } from '$lib/server/cinematicAccess';
import { isCinematicDoc, loadCinematic, saveCinematic } from '$lib/server/cinematicStorage';
import { ConflictError } from '$lib/server/r2';
import { scopeMismatch } from '$lib/server/scopeGuard';
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
 *
 * A Scene Editor-only caller (`access: 'hosted'`) may write a screen or component timeline over
 * one of those or nothing; see {@link hostedPrecondition}.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, access } = await cinematicGate(locals, cookies);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || !isCinematicDoc(body.doc)) throw error(400, 'missing or malformed cinematic doc');

	// SCOPE GUARD — `force` deliberately does NOT bypass it: overwriting YOUR doc is a choice,
	// overwriting SOMEONE ELSE'S project never is (`scopeMismatch`).
	const mismatch = scopeMismatch(body.projectKey, projectKey);
	if (mismatch) return mismatch;

	let baseEtag = writeBaseEtagJson(body);
	// `json({error})`, never `error()` — the latter surfaces as an opaque 502 and hides the cause
	// ([[gotcha_publish_502_flowv2_nodes_guard]]).
	const conflict = () =>
		json(
			{
				ok: false,
				error: 'conflict',
				message:
					'Someone else saved this cinematic while you were editing. ' +
					'Your changes are still here — reload to get their version first.',
			},
			{ status: 409 },
		);

	if (access === 'hosted') {
		assertReach(access, body.doc);
		const stored = await loadCinematic(clientKey, projectKey, body.doc.id);
		if (stored.etag !== null) assertReach(access, stored.doc);
		const pinned = hostedPrecondition(baseEtag, stored.etag);
		if (pinned === 'conflict') return conflict();
		baseEtag = pinned;
	}

	try {
		const { etag, id } = await saveCinematic(clientKey, projectKey, body.doc, baseEtag);
		return json({ ok: true, id, etag, updatedAt: new Date().toISOString() });
	} catch (e) {
		if (e instanceof ConflictError) return conflict();
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

/**
 * The precondition a `hosted` save writes under: ALWAYS the version the host check just read
 * (`storedEtag`, `null` = absent ⇒ create-only), never an unconditional put — so a rig cinematic
 * written under the same id between the check and the put makes this save fail rather than
 * overwrite it. `force` (`baseEtag` undefined) still overwrites, but only that checked version. A
 * caller's own `baseEtag` that no longer matches it is the ordinary conflict.
 */
function hostedPrecondition(
	baseEtag: string | null | undefined,
	storedEtag: string | null,
): string | null | 'conflict' {
	if (baseEtag !== undefined && baseEtag !== storedEtag) return 'conflict';
	return storedEtag;
}
