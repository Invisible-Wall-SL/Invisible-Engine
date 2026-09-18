import { json } from '@sveltejs/kit';
import { GAME_PUBLISH_CAPABILITY } from '$lib/roles';
import { engineStalenessIndex } from '$lib/server/engineStaleness';
import { listGames } from '$lib/server/games';
import { userHasCapability } from '$lib/server/launcherAuth';
import { accessibleProjectsWithClient } from '$lib/server/projects';
import {
	PublishAllBusyError,
	currentPublishAllJob,
	requestPublishAllCancel,
	startPublishAllJob,
	type PublishAllJob,
} from '$lib/server/publishAllJob';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Bulk re-publish for the Invisible Game Maker — "the engine shipped, reconcile every game"
 * in one action instead of one project at a time.
 *
 *   POST   { scope: 'stale' | 'published', projects?: string[] }  → start (202 + job)
 *   GET                                                          → current/last job
 *   DELETE                                                       → ask the run to stop
 *
 * The run itself is a background job (see `publishAllJob.ts`); this route only resolves
 * WHICH games it covers. Gated exactly like the single-project publish (`gamePublish`), and
 * the target list is always intersected with the caller's accessible projects — an explicit
 * `projects` list narrows the scope, it can never widen it.
 */
async function canPublish(locals: App.Locals): Promise<boolean> {
	if (!locals.user) return false;
	return userHasCapability(locals.user, GAME_PUBLISH_CAPABILITY);
}

/** The job as the page reads it: items + a rolled-up progress line. */
function jobPayload(job: PublishAllJob | null) {
	if (!job) return { job: null };
	const done = job.items.filter((i) => i.status !== 'pending' && i.status !== 'running').length;
	return {
		job: {
			id: job.id,
			scope: job.scope,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt,
			startedBy: job.startedBy,
			cancelRequested: job.cancelRequested,
			running: job.finishedAt === null,
			total: job.items.length,
			done,
			ok: job.items.filter((i) => i.status === 'ok').length,
			failed: job.items.filter((i) => i.status === 'error').length,
			skipped: job.items.filter((i) => i.status === 'skipped').length,
			current: job.items.find((i) => i.status === 'running')?.key ?? null,
			items: job.items,
		},
	};
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (!(await canPublish(locals))) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}
	return json(jobPayload(currentPublishAllJob()), { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (!(await canPublish(locals))) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let body: { scope?: unknown; projects?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const scope = body.scope === 'published' ? 'published' : 'stale';
	const only =
		Array.isArray(body.projects) && body.projects.length > 0
			? new Set(body.projects.filter((p): p is string => typeof p === 'string'))
			: null;

	// Only PUBLISHED games can be re-published, so the candidate set is "accessible projects
	// that already have a registered game", narrowed by the scope. Staleness is resolved by the
	// same shared index the page's badge uses, so the button's count and the run always agree.
	const [accessible, games, staleness] = await Promise.all([
		accessibleProjectsWithClient(locals.user.id, locals.user.role),
		listGames(),
		engineStalenessIndex(),
	]);
	const publishedKeys = new Set(games.map((g) => g.key));

	const targets = accessible
		.filter((p) => publishedKeys.has(p.key))
		.filter((p) => !only || only.has(p.key))
		.filter((p) => scope === 'published' || staleness.for(p.key, true).stale)
		.map((p) => ({ key: p.key, name: p.name }));

	if (targets.length === 0) {
		return json(
			{ error: 'Nothing to republish — no published game matches that scope.' },
			{ status: 400, headers: NO_STORE },
		);
	}

	try {
		const job = startPublishAllJob({
			targets,
			scope,
			launcherOrigin: url.origin,
			startedBy: locals.user.email,
		});
		return json(jobPayload(job), { status: 202, headers: NO_STORE });
	} catch (e) {
		if (e instanceof PublishAllBusyError) {
			return json(
				{ error: e.message, ...jobPayload(currentPublishAllJob()) },
				{ status: 409, headers: NO_STORE },
			);
		}
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (!(await canPublish(locals))) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}
	// The game currently publishing runs to completion — a publish is a multi-step R2 + manifest
	// write, and aborting mid-way is how you get a half-registered game.
	const stopped = requestPublishAllCancel();
	return json({ ok: stopped, ...jobPayload(currentPublishAllJob()) }, { headers: NO_STORE });
};
