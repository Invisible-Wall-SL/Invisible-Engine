import { json } from '@sveltejs/kit';
import { partnerButtons } from '$lib/partnerLaunch';
import { parseShareExpiryDays, SHARE_PATH } from '$lib/partnerShare';
import { GAME_PUBLISH_CAPABILITY, type Role } from '$lib/roles';
import { ENV } from '$lib/server/env';
import { userHasCapability } from '$lib/server/launcherAuth';
import { partnerProfileIds } from '$lib/server/partnerRgs';
import { createShareLink, listShareLinks, revokeShareLink } from '$lib/server/partnerShare';
import { canAccessProject, getPartnerLaunch } from '$lib/server/projects';
import type { RequestEvent, RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * A project's no-login PARTNER SHARE LINKS — Game Maker's "Share link…" on a card.
 *
 *   GET    /api/game-maker/partner-share?project=<key>          → { links }   (live ones)
 *   POST   /api/game-maker/partner-share  { project, days }      → { url, id, expiresAt, links }
 *   DELETE /api/game-maker/partner-share?project=<key>&id=<id>  → { ok, links }
 *
 * Same gate as setting the partner game (the `gamePublish` capability + project access), and only
 * for a project with a partner launch this launcher can mint on — the card's ▶ Partner rule. The
 * link URL is answered ONCE, by the POST: only its hash is stored.
 */
async function publisher(event: RequestEvent): Promise<{ id: string; role: Role } | Response> {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (!(await userHasCapability(user, GAME_PUBLISH_CAPABILITY))) {
		return json(
			{ error: 'Sharing a partner link needs the same access as Publish.' },
			{ status: 403, headers: NO_STORE },
		);
	}
	return user;
}

const noAccess = (): Response =>
	json(
		{ error: 'Unknown project, or you do not have access to it.' },
		{ status: 403, headers: NO_STORE },
	);

/** A 409 unless the project has a partner launch this launcher can mint on. */
async function notShareable(project: string): Promise<Response | null> {
	const playable = partnerButtons({
		key: project,
		partner: await getPartnerLaunch(project),
		profiles: partnerProfileIds(ENV.PARTNER_RGS),
		published: true,
		latestDelivery: null,
	});
	return playable
		? null
		: json(
				{ error: 'Set the partner game on this card first ("Partner…").' },
				{ status: 409, headers: NO_STORE },
			);
}

export const GET: RequestHandler = async (event) => {
	const project = event.url.searchParams.get('project')?.trim() ?? '';
	const user = await publisher(event);
	if (user instanceof Response) return user;
	if (!project || !(await canAccessProject(user.id, user.role, project))) return noAccess();
	const refused = await notShareable(project);
	if (refused) return refused;
	return json({ links: await listShareLinks(project) }, { headers: NO_STORE });
};

export const POST: RequestHandler = async (event) => {
	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const project = typeof body.project === 'string' ? body.project.trim() : '';
	const user = await publisher(event);
	if (user instanceof Response) return user;
	if (!project || !(await canAccessProject(user.id, user.role, project))) return noAccess();
	const refused = await notShareable(project);
	if (refused) return refused;
	const days = parseShareExpiryDays(body.days);
	if (days === null) {
		return json({ error: 'Pick 1, 7 or 30 days.' }, { status: 400, headers: NO_STORE });
	}
	const made = await createShareLink({ projectKey: project, userId: user.id, days });
	console.info(
		`[partner-share] ${project}: ${event.locals.user?.email} made link ${made.id} for ${days} day(s)`,
	);
	return json(
		{
			id: made.id,
			url: `${event.url.origin}${SHARE_PATH}${made.token}`,
			expiresAt: made.expiresAt.toISOString(),
			links: await listShareLinks(project),
		},
		{ headers: NO_STORE },
	);
};

export const DELETE: RequestHandler = async (event) => {
	const project = event.url.searchParams.get('project')?.trim() ?? '';
	const id = event.url.searchParams.get('id')?.trim() ?? '';
	const user = await publisher(event);
	if (user instanceof Response) return user;
	if (!project || !(await canAccessProject(user.id, user.role, project))) return noAccess();
	const refused = await notShareable(project);
	if (refused) return refused;
	if (!(await revokeShareLink({ projectKey: project, id, userId: user.id }))) {
		return json(
			{ error: 'No live link with that id on this project.' },
			{ status: 404, headers: NO_STORE },
		);
	}
	console.info(`[partner-share] ${project}: ${event.locals.user?.email} revoked link ${id}`);
	return json({ ok: true, links: await listShareLinks(project) }, { headers: NO_STORE });
};
