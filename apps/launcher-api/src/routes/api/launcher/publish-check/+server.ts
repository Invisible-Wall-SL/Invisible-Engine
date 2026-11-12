import { json } from '@sveltejs/kit';
import { requireDeployToken } from '$lib/server/deployToken';
import { requireLauncherPublisher } from '$lib/server/launcherAuth';
import { canAccessProject } from '$lib/server/projects';
import { runPublishChecks } from '$lib/server/publishChecks';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

// GET ?project=<bare project key> — the publish checks the online Publish runs (draft sounds, flow
// errors, a family the runtime cannot play), as `{ project, ok, checked, failed[], publishAnyway }`
// (`$lib/server/publishChecks.ts`). Read-only: it runs the gates and writes nothing.
//
// A route of its own rather than a field on `GET /api/launcher/game-upload`: that route takes the
// GAME key (often `<project>build`, never the project), writes R2 through its PUT/POST, and answers
// only a session. This one answers the two callers of a desktop publish:
//  - the desktop launcher: `Authorization: Bearer <session>` with `gamePublish`, held to the
//    projects the caller can reach, exactly like `register-game`;
//  - the build itself (`bake-editor-doc.mjs`): `?k=<deploy token>`, the token `/api/deploy` and
//    the exports take, which spans every project like theirs. The key resolves as `/api/editor/doc`
//    resolves it (`clientKeyOf`), so the checks read exactly the tree the bake bakes.
// A bearer header that fails is refused; it never falls back to `?k=`.
export const GET: RequestHandler = async ({ request, url }) => {
	const project = url.searchParams.get('project')?.trim() ?? '';
	if (request.headers.has('authorization')) {
		const auth = await requireLauncherPublisher(request);
		if (!auth.ok) return auth.response;
		if (!project) return json({ error: 'Missing project' }, { status: 400, headers: NO_STORE });
		if (!(await canAccessProject(auth.user.id, auth.user.role, project))) {
			return json(
				{ error: 'Unknown project, or you do not have access to it.' },
				{ status: 403, headers: NO_STORE },
			);
		}
	} else {
		await requireDeployToken(url, 'Publish checks are not configured.');
		if (!project) return json({ error: 'Missing project' }, { status: 400, headers: NO_STORE });
	}
	return json(await runPublishChecks(project), { headers: NO_STORE });
};
