import { json } from '@sveltejs/kit';
import { bearerToken } from '$lib/launcherGates';
import { validateSession } from '$lib/server/auth';
import {
	assignProjectToClient,
	clientExists,
	createClient,
	isValidClientKey,
} from '$lib/server/clients';
import { selectableGameKinds } from '$lib/server/gameKinds';
import { requireLauncherPublisher } from '$lib/server/launcherAuth';
import { launcherProfileFor } from '$lib/server/launcherProfile';
import {
	DEFAULT_PROJECT_KEY,
	accessibleProjectsWithClient,
	createProject,
	isValidProjectKey,
	projectClientKey,
	projectExists,
	projectKeyTaken,
	renameProject,
	setLauncherProfile,
} from '$lib/server/projects';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

// Reads `Authorization: Bearer <token>` (a session token from POST /api/launcher/login)
// and validates it like the web session cookie. NO role gate here: visibility IS the
// access rule — every signed-in user gets exactly the projects they may reach (scoped by
// `user_project_access` / `user_client_access` + the default `cloud`), grouped by client.
// Returns the accessible projects (each with its launcher profile + authored game kind)
// plus the distinct set of clients present among them so the desktop app can build a
// client selector. 401 no/invalid token. Never logs the body.
export const GET: RequestHandler = async ({ request }) => {
	const user = await validateSession(bearerToken(request.headers.get('authorization')));
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}

	const rows = await accessibleProjectsWithClient(user.id, user.role);
	const projects = rows.map((p) => ({
		key: p.key,
		name: p.name,
		clientKey: p.clientKey,
		clientName: p.clientName,
		// The project's authored game kind. The desktop launcher derives the mock RGS
		// protocol + symbol mapping from it instead of asking for a "template" it has no
		// way to keep in step with the kinds authored online.
		gameType: p.gameType,
		// The stored setup blob, or one DERIVED from the kind when the project was created
		// online and no desktop has ever published a profile for it (see launcherProfile.ts).
		// Also pins the engine submodule before the (frozen) install so a drifted machine
		// can't fail the build — applied on read so it reaches every launcher with no re-seed.
		//
		// The shared default `cloud` scope is excluded: every user can reach it, so deriving
		// a build recipe would put a ☁ Publish button that cannot work on every launcher.
		// Deciding which projects are real titles is this endpoint's job, not the shape
		// module's — see the note on `launcherProfileFor`.
		profile:
			p.key === DEFAULT_PROJECT_KEY
				? p.launcherProfile
				: launcherProfileFor(p.launcherProfile, {
						key: p.key,
						name: p.name,
						gameType: p.gameType,
					}),
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

// Gated on `gamePublish`, like every other step of a desktop publish: publishing a profile is
// what ⬆ Setup does on the way to shipping a game, so a role the owner granted the capability
// to must not hit a wall here. The desktop launcher calls this to publish a per-project
// "launcher profile" (an opaque, machine-independent JSON blob) up to the server. Upserts
// the project (creating its client row first if `clientKey` is given), then stores the
// profile. 401 no/invalid token, 403 missing the capability, 400 bad body. Never logs the body.
//
// An optional `gameType` is applied ON CREATE ONLY. A project scaffolded on the desktop
// used to arrive with no kind at all and default to `lines`, so a Book-of game was
// described as a payline slot by every kind-derived surface (the editor template, the
// online mock contract, the desktop's own kind row). Applying it on UPDATE too would be
// worse than not having it: the portal owns the kind once the project exists, and any
// ⬆ Setup from a machine would revert a kind changed online.
export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	let body: {
		key?: unknown;
		name?: unknown;
		clientKey?: unknown;
		gameType?: unknown;
		profile?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const key = typeof body.key === 'string' ? body.key.trim() : '';
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const clientKey = typeof body.clientKey === 'string' ? body.clientKey.trim() : '';
	const gameType = typeof body.gameType === 'string' ? body.gameType.trim() : '';
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
	// Validate against the SAME union the online create actions offer (built-ins + custom
	// kinds), so a launcher can't seed a kind no picker or scene set knows about.
	if (gameType && !(await selectableGameKinds()).some((k) => k.id === gameType)) {
		return json({ error: 'Unknown game kind' }, { status: 400, headers: NO_STORE });
	}

	const ownerClientKey = clientKey || null;

	// Ensure the owning client row exists before the project references it (FK).
	if (ownerClientKey && !(await clientExists(ownerClientKey))) {
		await createClient(ownerClientKey, ownerClientKey);
	}

	// A soft-deleted project reads as absent to `projectExists`, so the upsert below would
	// take the CREATE branch and hit a primary-key violation. Refuse with the real reason:
	// silently resurrecting a project someone deleted would be worse than either outcome.
	if (!(await projectExists(key)) && (await projectKeyTaken(key))) {
		return json(
			{ error: `Project "${key}" is deleted. Restore or purge it in /admin first.` },
			{ status: 409, headers: NO_STORE },
		);
	}

	// Upsert: rename an existing project (+ re-assign its client if it changed), else create.
	// The kind is seeded on create only — see the note above.
	if (await projectExists(key)) {
		await renameProject(key, name);
		if ((await projectClientKey(key)) !== ownerClientKey) {
			await assignProjectToClient(key, ownerClientKey);
		}
	} else {
		await createProject(key, name, ownerClientKey, gameType || undefined);
	}

	await setLauncherProfile(key, profile);

	return json({ ok: true, key }, { headers: NO_STORE });
};
