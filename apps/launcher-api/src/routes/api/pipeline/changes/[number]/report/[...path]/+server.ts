import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { getReportEntry, parseChangeNumber } from '$lib/server/pipelineChanges';
import type { RequestHandler } from './$types';

/**
 * One image of a change's current-games report (a changed screen before, after or as a diff),
 * streamed out of the run's full artifact by byte range — the launcher never holds the artifact.
 * Same access as the change's detail. The path must be one the report itself lists; anything
 * else is a 404, so nothing in the archive but the screens is reachable. `?artifact=<id>` names
 * the full artifact the caller read the report from: the answer is then cacheable (that artifact
 * never changes), and a re-run that replaced it is a 409 rather than another run's image.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	await requirePipelineAccess(locals);
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	const artifactParam = url.searchParams.get('artifact');
	let artifact: number | null = null;
	if (artifactParam !== null) {
		artifact = Number(artifactParam);
		if (!Number.isInteger(artifact) || artifact <= 0) {
			throw error(400, 'artifact must be a positive integer.');
		}
	}
	try {
		const entry = await getReportEntry({ number, path: params.path, artifact });
		return new Response(entry.body, {
			headers: {
				'content-type': entry.contentType,
				'cache-control':
					artifact === null ? 'private, no-store' : 'private, max-age=259200, immutable',
				// The bytes are a branch's: never a document, never a script, whatever they claim.
				'content-security-policy': "default-src 'none'; sandbox",
				'x-content-type-options': 'nosniff',
			},
		});
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
