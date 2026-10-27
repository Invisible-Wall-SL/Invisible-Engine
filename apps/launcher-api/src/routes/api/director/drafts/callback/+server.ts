import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { DRAFT_TOKEN_SCOPE, verifyCallbackToken } from '$lib/server/director/atlasCallback';
import { DRAFT_JOB_REF } from '$lib/server/director/drafts';
import { draftCallbackUrl, playResultOf, recordDraftDone } from '$lib/server/director/draftJobs';
import { SIGNATURE_HEADER, verifyDraftRequest } from '$lib/server/director/draftSigning';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 256 * 1024;

const answer = (status: number, body: object) => json(body, { status, headers: NO_STORE });

/**
 * The draft player's completion callback for a QA play (ADR-0010 §3; `server.mjs` `postCallback`):
 *
 *   POST /api/director/drafts/callback?run=<runId>
 *     Authorization: Bearer v1.<exp>.<mac>   minted by `build.play_draft` for exactly this URL,
 *                                            under its own scope (an atlas token does not pass)
 *     X-Draft-Signature: t=<unix>,v1=<mac>   over "<t>\nPOST <path+query>\n<raw body>"
 *     { jobRef, status: 'finished' | 'failed', report?, error? }
 *
 * Both are checked against `DRAFT_PLAYER_SECRET`; a forged, mismatched or expired one is a 400.
 * Delivery is at-least-once, so the play is settled on `jobRef` exactly once and every redelivery
 * answers 200 without recording again. No session is read.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const secret = ENV.DRAFT_PLAYER_SECRET;
	if (!secret)
		return answer(503, { error: 'disabled', message: 'DRAFT_PLAYER_SECRET is not set.' });

	const runId = url.searchParams.get('run') ?? '';
	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
		return answer(413, { error: 'too_large' });
	}
	const body = await request.text();
	if (Buffer.byteLength(body) > MAX_BODY_BYTES) return answer(413, { error: 'too_large' });
	const bearer = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	const signed =
		Boolean(runId) &&
		verifyCallbackToken(secret, draftCallbackUrl(runId), bearer, Date.now(), DRAFT_TOKEN_SCOPE) &&
		verifyDraftRequest(
			secret,
			'POST',
			url.pathname + url.search,
			body,
			request.headers.get(SIGNATURE_HEADER),
		);
	if (!signed)
		return answer(400, {
			error: 'bad_signature',
			message: 'The callback is not signed for this URL, or has expired.',
		});

	let msg: { jobRef?: unknown; status?: unknown; report?: unknown; error?: unknown };
	try {
		msg = JSON.parse(body) as typeof msg;
	} catch {
		return answer(400, { error: 'bad_request', message: 'The body is not JSON.' });
	}
	if (
		typeof msg.jobRef !== 'string' ||
		!new RegExp(DRAFT_JOB_REF).test(msg.jobRef) ||
		(msg.status !== 'finished' && msg.status !== 'failed')
	) {
		return answer(400, {
			error: 'bad_request',
			message: "Expected { jobRef, status: 'finished' | 'failed' }.",
		});
	}

	const done = await recordDraftDone({
		jobRef: msg.jobRef,
		runId,
		status: msg.status,
		result: playResultOf(msg as { status: string; report?: unknown; error?: unknown }),
		via: 'callback',
	});
	// An unknown job is a 404. The player treats any 4xx as final and does not resend it: there is no
	// row here to settle, so nothing is lost by that.
	if (!done.recorded && done.reason === 'unknown_job') return answer(404, { error: 'unknown_job' });
	return answer(200, { recorded: done.recorded });
};
