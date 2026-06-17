import { error, fail, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { clientExists, listClients } from '$lib/server/clients';
import { selectableGameKinds } from '$lib/server/gameKinds';
import { listGames } from '$lib/server/games';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { scaffoldProject } from '$lib/server/projectScaffold';
import {
	accessibleProjectsWithClient,
	createProject,
	isValidProjectKey,
	projectExists,
} from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { Actions, PageServerLoad } from './$types';

/** Auth + role gate for the actions (the loader reuses the parent layout's `tools`). */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameMaker', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Game Maker.');
	}
}

export const load: PageServerLoad = async ({ locals, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'gameMaker')) {
		throw error(403, 'Your role does not have access to Invisible Game Maker.');
	}

	const [clients, gameKinds, accessible, games] = await Promise.all([
		listClients(),
		selectableGameKinds(),
		accessibleProjectsWithClient(locals.user.id, locals.user.role),
		listGames(),
	]);

	// Which projects already have a registered (published) game + its launch URL,
	// so the page can show "Re-publish" + the current play link.
	const gamesByKey = new Map(games.map((g) => [g.key, g]));
	const projects = accessible.map((p) => {
		const game = gamesByKey.get(p.key);
		return {
			key: p.key,
			name: p.name,
			clientName: p.clientName,
			published: Boolean(game),
			url: game?.url ?? null,
		};
	});

	return {
		clients: clients.map((c) => ({ key: c.key, name: c.name })),
		gameKinds,
		projects,
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		await gate(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '')
			.toLowerCase()
			.trim();
		const name = String(data.get('name') ?? '').trim();
		const rawClient = String(data.get('clientKey') ?? '').trim();
		const clientKey = rawClient === '' ? null : rawClient;
		const rawGameType = String(data.get('gameType') ?? '').trim();

		if (!isValidProjectKey(key)) {
			return fail(400, { action: 'create', error: 'Key must match a-z, 0-9, _ or - (max 64).' });
		}
		if (!name) return fail(400, { action: 'create', error: 'Name is required.' });
		const known = new Set((await selectableGameKinds()).map((k) => k.id));
		if (rawGameType !== '' && !known.has(rawGameType)) {
			return fail(400, { action: 'create', error: 'Unknown game kind.' });
		}
		if (await projectExists(key)) {
			return fail(400, { action: 'create', error: 'A project with that key exists.' });
		}
		if (clientKey !== null && !(await clientExists(clientKey))) {
			return fail(400, { action: 'create', error: 'Unknown client.' });
		}

		await createProject(key, name, clientKey, rawGameType !== '' ? rawGameType : undefined);
		await scaffoldProject(clientKey ?? UNASSIGNED_CLIENT, key);
		return { action: 'create', ok: `Created project ${key}.`, createdKey: key };
	},
};
