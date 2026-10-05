import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { verifyCallbackSignature, verifyCallbackToken } from '$lib/server/director/atlasCallback';
import { JOB_REF, callbackUrlFor, isTerminal, recordJobDone } from '$lib/server/director/atlasJobs';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 256 * 1024;

const answer = (status: number, body: object) => json(body, { status, headers: NO_STORE });

/**
 * atlas-tool's completion callback for a still render a Director run queued
 * (`services/atlas-tool/still_jobs.py` `deliver_callback`):
 *
 *   POST /api/director/atlas/callback?run=<runId>
 *     X-Atlas-Callback-Token: v1.<exp>.<mac>   minted by `atlas.queue_variants` for exactly this URL
 *     X-Atlas-Signature: t=<unix>,v1=<mac>     over the raw body
 *     { jobRef, status, variants, error? }
 *
 * Both are checked against `ATLAS_CALLBACK_SECRET`; a forged, mismatched or expired one is a 400.
 * Delivery is at-least-once, so the job is settled on `jobRef` exactly once and every redelivery
 * answers 200 without recording again. No session is read.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const secret = ENV.ATLAS_CALLBACK_SECRET;
	if (!secret)
		return answer(503, { error: 'disabled', message: 'ATLAS_CALLBACK_SECRET is not set.' });

	const runId = url.searchParams.get('run') ?? '';
	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
		return answer(413, { error: 'too_large' });
	}
	const body = await request.text();
	if (Buffer.byteLength(body) > MAX_BODY_BYTES) return answer(413, { error: 'too_large' });
	const signed =
		Boolean(runId) &&
		verifyCallbackToken(
			secret,
			callbackUrlFor(runId),
			request.headers.get('x-atlas-callback-token') ?? '',
		) &&
		verifyCallbackSignature(secret, body, request.headers.get('x-atlas-signature'));
	if (!signed)
		return answer(400, {
			error: 'bad_signature',
			message: 'The callback is not signed for this URL, or has expired.',
		});

	let msg: { jobRef?: unknown; status?: unknown };
	try {
		msg = JSON.parse(body) as typeof msg;
	} catch {
		return answer(400, { error: 'bad_request', message: 'The body is not JSON.' });
	}
	if (
		typeof msg.jobRef !== 'string' ||
		!new RegExp(JOB_REF).test(msg.jobRef) ||
		!isTerminal(msg.status)
	) {
		return answer(400, {
			error: 'bad_request',
			message: 'Expected { jobRef, status } with a final status.',
		});
	}

	const done = await recordJobDone({
		jobRef: msg.jobRef,
		runId,
		status: msg.status,
		result: msg,
		via: 'callback',
	});
	// An unknown job is a 404 so atlas-tool keeps it undelivered and redelivers it at its next boot.
	if (!done.recorded && done.reason === 'unknown_job') return answer(404, { error: 'unknown_job' });
	return answer(200, { recorded: done.recorded });
};
