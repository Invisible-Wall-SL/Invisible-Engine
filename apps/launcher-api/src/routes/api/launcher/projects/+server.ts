import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import {
	assignProjectToClient,
	clientExists,
	createClient,
	isValidClientKey,
} from '$lib/server/clients';
import {
	accessibleProjectsWithClient,
	createProject,
	isValidProjectKey,
	projectClientKey,
	projectExists,
	renameProject,
	setLauncherProfile,
} from '$lib/server/projects';
import type { RequestHandler } from './$types';

// Same gate as the other desktop-launcher bearer endpoints (models/nodes/register-game):
// only the owner role may publish a launcher profile.
const REGISTER_ROLE = 'admin';

const NO_STORE = { 'cache-control': 'no-store' };

function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1];
}

// Reads `Authorization: Bearer <token>` (a session token from POST /api/launcher/login)
// and validates it like the web session cookie. NO role gate here: visibility IS the
// access rule — every signed-in user gets exactly the projects they may reach (scoped by
// `user_project_access` / `user_client_access` + the default `cloud`), grouped by client.
// Returns the accessible projects (each with its opaque launcher profile) plus the distinct
// set of clients present among them so the desktop app can build a client selector.
// 401 no/invalid token. Never logs the body.
export const GET: RequestHandler = async ({ request }) => {
	const token = bearer(request.headers.get('authorization'));
	const user = await validateSession(token);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}

	const rows = await accessibleProjectsWithClient(user.id, user.role);
	const projects = rows.map((p) => ({
		key: p.key,
		name: p.name,
		clientKey: p.clientKey,
		clientName: p.clientName,
		profile: p.launcherProfile,
	}));

	// Distinct clients present among the accessible projects (skip the null/unassigned bucket).
	const seen = new Map<string, { key: string; name: string }>();
	for (const p of rows) {
		if (p.clientKey === null || seen.has(p.clientKey)) continue;
		seen.set(p.clientKey, { key: p.clientKey, name: p.clientName ?? p.clientKey });
	}
	const clients = [...seen.values()];

	return json({ projects, clients }, { headers: NO_STORE });
};

// Owner-only (REGISTER_ROLE). The desktop launcher calls this to publish a per-project
// "launcher profile" (an opaque, machine-independent JSON blob) up to the server. Upserts
// the project (creating its client row first if `clientKey` is given), then stores the
// profile. 401 no/invalid token, 403 wrong role, 400 bad body. Never logs the body.
export const POST: RequestHandler = async ({ request }) => {
	const token = bearer(request.headers.get('authorization'));
	const user = await validateSession(token);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}
	if (user.role !== REGISTER_ROLE) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let body: { key?: unknown; name?: unknown; clientKey?: unknown; profile?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const key = typeof body.key === 'string' ? body.key.trim() : '';
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const clientKey = typeof body.clientKey === 'string' ? body.clientKey.trim() : '';
	const profile = body.profile;

	if (!isValidProjectKey(key)) {
		return json({ error: 'Invalid project key' }, { status: 400, headers: NO_STORE });
	}
	if (!name) {
		return json({ error: 'Missing name' }, { status: 400, headers: NO_STORE });
	}
	if (clientKey && !isValidClientKey(clientKey)) {
		return json({ error: 'Invalid client key' }, { status: 400, headers: NO_STORE });
	}

	const ownerClientKey = clientKey || null;

	// Ensure the owning client row exists before the project references it (FK).
	if (ownerClientKey && !(await clientExists(ownerClientKey))) {
		await createClient(ownerClientKey, ownerClientKey);
	}

	// Upsert: rename an existing project (+ re-assign its client if it changed), else create.
	if (await projectExists(key)) {
		await renameProject(key, name);
		if ((await projectClientKey(key)) !== ownerClientKey) {
			await assignProjectToClient(key, ownerClientKey);
		}
	} else {
		await createProject(key, name, ownerClientKey);
	}

	await setLauncherProfile(key, profile);

	return json({ ok: true, key }, { headers: NO_STORE });
};
