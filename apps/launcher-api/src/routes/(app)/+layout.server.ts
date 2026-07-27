import { redirect } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, manifestForRole, roleHasCapability } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { listClients } from '$lib/server/clients';
import {
	DEFAULT_PROJECT_KEY,
	accessibleProjects,
	ensureDefaultProject,
} from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { enginePending } from '$lib/server/engineSource';
import { engineDeployStatus, type EngineDeployStatus } from '$lib/server/testServerManifest';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');

	await ensureDefaultProject();

	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	const accessible = await accessibleProjects(locals.user.id, locals.user.role);
	const clients = await listClients();
	const clientNames = new Map(clients.map((c) => [c.key, c.name]));

	// Annotate each accessible project with its client's display name so the
	// header selector can group projects under <optgroup>s.
	const projects = accessible.map((p) => ({
		key: p.key,
		name: p.name,
		clientKey: p.clientKey,
		clientName: p.clientKey ? (clientNames.get(p.clientKey) ?? null) : null,
	}));

	// Resolve the session's active project; fall back to the default when unset
	// or no longer accessible (e.g. the project was deleted or access revoked).
	const stored = await getActiveProjectKey(cookies.get(SESSION_COOKIE));
	const activeProjectKey =
		stored && projects.some((p) => p.key === stored) ? stored : DEFAULT_PROJECT_KEY;

	// Which engine commit the live shared `lines` runtime bundle was built from + whether a release
	// is building right now (the bundle-vs-source axis). Best-effort + a single R2 read: a test-server
	// or R2 hiccup must never break the whole app shell, so any failure degrades to 'unknown'.
	let engine: EngineDeployStatus;
	try {
		engine = await engineDeployStatus('lines');
	} catch {
		engine = { status: 'unknown' };
	}

	// C2 (bundle-vs-source "release pending"): if the bundle is deployed with a known commit, compare
	// it against the engine repo's `main` HEAD. Best-effort + cached in `engineSource.ts`; a missing
	// token or any GitHub hiccup returns null → we merge nothing → the pill degrades to today's green.
	if (engine.status === 'deployed' && engine.commit && engine.commit !== 'unknown') {
		try {
			const p = await enginePending(engine.commit);
			if (p)
				engine = { ...engine, pending: p.pending, aheadBy: p.aheadBy, mainCommit: p.mainCommit };
		} catch {
			// ignore — the pill stays green
		}
	}

	return {
		user: locals.user,
		tools: manifestForRole(locals.user.role, roleOverrides, overrides),
		canAdmin: roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides, overrides),
		projects,
		activeProjectKey,
		engine,
	};
};
