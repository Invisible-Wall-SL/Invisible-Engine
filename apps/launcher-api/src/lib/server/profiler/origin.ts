import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { requireTool, userGrants } from '../http';
import { requireLauncherPublisher } from '../launcherAuth';
import { clientKeyOf } from '../projectLookup';
import { canAccessProject, projectExists } from '../projects';
import { requireProjectScope } from '../toolScope';
import { captureSigningKey, PERF_SESSION_HEADER, verifyCaptureToken } from './captureToken';
import type { BuildOrigin } from './builds';
import type { ReportOrigin } from './store';

export const PROFILER_TOOL = 'profiler';
const LABEL = 'Invisible Profiler';

/**
 * Who is sending a reading to `POST /api/profiler/reports` (and `/uploads`), and for which project.
 *
 * - **A capture session** (`X-IW-Perf-Session`): the phone is not signed in, so the token is the
 *   whole authority. It is checked again against the person who opened the session as they are NOW
 *   — still active, still holding the Profiler and the project — so revoking someone ends their open
 *   sessions too.
 * - **A signed-in user** (Paste, no token): the Profiler grant and access to `?project=`, as any
 *   project tool. Only as JSON, which a page on another site can only send after a CORS preflight,
 *   and these routes never allow credentials.
 */
export async function reportOrigin(
	request: Request,
	locals: App.Locals,
	url: URL,
): Promise<ReportOrigin> {
	const token = request.headers.get(PERF_SESSION_HEADER);
	if (token) {
		const claims = verifyCaptureToken(captureSigningKey(), token);
		if (!claims) {
			throw error(401, 'This capture link has expired or is not valid — open a new one.');
		}
		const [opener] = await getDb()
			.select({ role: users.role, active: users.active, expiresAt: users.expiresAt })
			.from(users)
			.where(eq(users.id, claims.uid));
		const openerActive =
			opener?.active && (!opener.expiresAt || opener.expiresAt.getTime() > Date.now());
		if (
			!opener ||
			!openerActive ||
			!(await userGrants({ id: claims.uid, role: opener.role })).hasTool(PROFILER_TOOL) ||
			!(await canAccessProject(claims.uid, opener.role, claims.project))
		) {
			throw error(403, 'Whoever opened this capture can no longer send readings for this project.');
		}
		if (!(await projectExists(claims.project))) {
			throw error(410, 'This project has been deleted.');
		}
		return {
			clientKey: await clientKeyOf(claims.project),
			projectKey: claims.project,
			source: 'capture',
			session: claims.sid,
			label: claims.label,
			createdBy: claims.uid,
		};
	}
	const user = await requireTool(locals, PROFILER_TOOL, LABEL);
	const essence = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (essence !== 'application/json') {
		throw error(415, 'Send the report as application/json.');
	}
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const label = url.searchParams.get('label')?.trim().slice(0, 80) || null;
	return { clientKey, projectKey, source: 'paste', session: null, label, createdBy: user.id };
}

/**
 * Who is sending a build breakdown (`/api/profiler/uploads` with a bearer, `/api/profiler/builds`):
 * the desktop launcher, signed in with its portal token (`Authorization: Bearer`, as every publish
 * step), holding Build & publish games (`gamePublish`) and access to the project it built. Returns
 * the refusal to answer unchanged otherwise.
 */
export async function buildOrigin(
	request: Request,
	project: string | null,
): Promise<BuildOrigin | Response> {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;
	const projectKey = project?.trim() ?? '';
	if (!projectKey) return json({ error: 'Missing project' }, { status: 400 });
	if (
		!(await projectExists(projectKey)) ||
		!(await canAccessProject(auth.user.id, auth.user.role, projectKey))
	) {
		return json({ error: 'Unknown project, or you do not have access to it.' }, { status: 403 });
	}
	return { clientKey: await clientKeyOf(projectKey), projectKey, createdBy: auth.user.id };
}

/** Whether a request carries the desktop launcher's bearer rather than a capture token or a cookie. */
export const hasBearer = (request: Request): boolean =>
	/^Bearer\s/i.test(request.headers.get('authorization')?.trim() ?? '');
