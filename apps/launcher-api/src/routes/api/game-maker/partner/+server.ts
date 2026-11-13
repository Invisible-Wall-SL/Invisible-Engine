import { json } from '@sveltejs/kit';
import { parsePartnerLaunchInput } from '$lib/partnerLaunch';
import { GAME_PUBLISH_CAPABILITY } from '$lib/roles';
import { ENV } from '$lib/server/env';
import { userHasCapability } from '$lib/server/launcherAuth';
import { partnerProfileIds } from '$lib/server/partnerRgs';
import { revokeAllShareLinks } from '$lib/server/partnerShare';
import { canAccessProject, setPartnerLaunch } from '$lib/server/projects';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Set — or clear — which partner game a project is played as: Game Maker's "Partner…" on a card.
 *
 *   POST /api/game-maker/partner  { project, gameId, profile?, alias?, player? }   (gameId '' clears it)
 *   → 200 { ok, partner }   (`partner` null when cleared)
 *   → 404 when the project was deleted or renamed after the access check
 *
 * Same gate as Publish (the `gamePublish` capability + project access): it decides where the
 * card's ▶ Partner buttons send everyone who can see the card. Clearing it revokes the project's
 * share links (`partnerShare.ts`), which would otherwise wake up again for whatever is set next.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (!(await userHasCapability(locals.user, GAME_PUBLISH_CAPABILITY))) {
		return json(
			{ error: 'Setting a partner game needs the same access as Publish.' },
			{ status: 403, headers: NO_STORE },
		);
	}
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const project = typeof body.project === 'string' ? body.project.trim() : '';
	if (!project || !(await canAccessProject(locals.user.id, locals.user.role, project))) {
		return json(
			{ error: 'Unknown project, or you do not have access to it.' },
			{ status: 403, headers: NO_STORE },
		);
	}
	const parsed = parsePartnerLaunchInput(body, partnerProfileIds(ENV.PARTNER_RGS));
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400, headers: NO_STORE });
	if (!(await setPartnerLaunch(project, parsed.value))) {
		return json(
			{ error: 'That project no longer exists — it was deleted or renamed. Reload Game Maker.' },
			{ status: 404, headers: NO_STORE },
		);
	}
	const revoked = parsed.value
		? 0
		: await revokeAllShareLinks({ projectKey: project, userId: locals.user.id });
	console.info(
		`[partner] ${project}: ${locals.user.email} set partner game ${parsed.value ? `${parsed.value.profile}/${parsed.value.gameId}${parsed.value.player ? ` as ${parsed.value.player}` : ''}` : `(none; ${revoked} share link(s) revoked)`}`,
	);
	return json({ ok: true, partner: parsed.value }, { headers: NO_STORE });
};
