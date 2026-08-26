import { json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { latestImageBuild, triggerImageBuild } from '$lib/server/podImage';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * READ the pod image's latest CI build. Any ComfyUI user may look — knowing whether a build
 * is running is exactly the thing that stops two people starting one.
 *
 * Its own endpoint rather than a field on `/comfyui/status`: status is polled every 5s by
 * every open panel, and hanging a GitHub call off that would burn the authed rate limit for
 * a number that changes every few minutes. The page polls this one only while a build runs.
 *
 * NOTE ON THE PATH: this directory is called `build`, which `.gitignore` used to match with
 * an unanchored `build` rule — so the file was never committed and the route 404'd in
 * production while working locally. The rule is now negated for anything under a `src/`
 * tree; if you add a route whose name collides with a build-output directory, check
 * `git check-ignore -v` before trusting a green commit.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);
	return json(await latestImageBuild(), { headers: NO_STORE });
};

/**
 * DISPATCH a rebuild. Admin-only: it spends shared CI minutes.
 *
 * Refuses while one is already running, because two builds racing to push the same
 * `:latest` tag is a coin toss over which one wins — and the second is pure waste.
 */
export const POST: RequestHandler = async ({ locals }) => {
	await requireComfyAdmin(locals);

	const current = await latestImageBuild(true);
	const running = current.latest?.status === 'queued' || current.latest?.status === 'in_progress';
	if (running) {
		return json(
			{ ...current, error: 'A build is already running — wait for it rather than stacking one.' },
			{ headers: NO_STORE },
		);
	}

	const result = await triggerImageBuild();
	if (!result.ok) return json({ ...current, error: result.error }, { headers: NO_STORE });

	// The run does not appear instantly, so report what we know: the dispatch was accepted.
	// The page polls GET until the new run shows up rather than pretending it is already there.
	return json({ ...(await latestImageBuild(true)), dispatched: true }, { headers: NO_STORE });
};
