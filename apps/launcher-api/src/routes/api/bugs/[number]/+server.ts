import { error, json } from '@sveltejs/kit';
import { actOnBug, getBug, parseBugNumber, requireBugAccess } from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 * One bug, on a bug the viewer may see (else 404, never saying whether it exists):
 *
 *   GET  /api/bugs/<n>   the bug in full: text, screenshots, linked pull requests, activity
 *   POST /api/bugs/<n>   (JSON) one action, answering the bug as it now stands:
 *        { action: 'edit', revision, title?, description?, area?, project?, pageUrl? }
 *                                       reporter or triager; 409 when the text moved on meanwhile
 *        { action: 'comment', text }    anyone who sees the bug
 *        { action: 'priority', priority: 'critical'|'high'|'medium'|'low'|null }   triage
 *        { action: 'status', status: 'open'|'working'|'resolved'|'wontFix' }         triage
 *        { action: 'send' } / { action: 'unsend' }   to / from Pipeline Changes        triage
 */
const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async ({ locals, params }) => {
	const access = await requireBugAccess(locals);
	return json(await getBug(access, parseBugNumber(params.number)), { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const access = await requireBugAccess(locals);
	const number = parseBugNumber(params.number);
	const body: unknown = await request.json().catch(() => {
		throw error(400, 'Expected a JSON body.');
	});
	return json(await actOnBug(access, number, body), { headers: NO_STORE });
};
