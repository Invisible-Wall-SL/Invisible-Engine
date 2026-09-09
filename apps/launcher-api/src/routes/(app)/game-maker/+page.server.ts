import { error, fail, redirect } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability, roleHasTool } from '$lib/roles';
import { clientExists, listClients } from '$lib/server/clients';
import { resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { selectableGameKinds } from '$lib/server/gameKinds';
import { buildGameProfile } from '$lib/server/gameProfile';
import { listGames } from '$lib/server/games';
import { UNASSIGNED_CLIENT, editorDocKey } from '$lib/server/projectPaths';
import { scaffoldProject } from '$lib/server/projectScaffold';
import {
	accessibleProjectsWithClient,
	createProject,
	isValidProjectKey,
	projectExists,
	projectKeyTaken,
} from '$lib/server/projects';
import { listAllObjects } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { engineStalenessIndex } from '$lib/server/engineStaleness';
import { loadTestServerManifest } from '$lib/server/testServerManifest';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { Actions, PageServerLoad } from './$types';

/**
 * Last-modified epoch ms of a project's `editor/scenes.json`, or `null` when it
 * doesn't exist yet. One list call per project (the prefix IS the full object key,
 * so it returns at most that single object) — cheap enough for the hub's project
 * list. Drives the publish confirmation's "scenes last edited …" line so a stale
 * publish is obvious. Never throws: an R2 hiccup degrades to `null` (unknown).
 */
async function scenesLastModified(clientKey: string, projectKey: string): Promise<number | null> {
	try {
		const key = editorDocKey(clientKey, projectKey);
		const objs = await listAllObjects(key);
		const hit = objs.find((o) => o.key === key);
		return hit && hit.lastModified > 0 ? hit.lastModified : null;
	} catch {
		return null;
	}
}

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

	const [clients, gameKinds, accessible, games, manifest, roleOverrides, toolOverrides] =
		await Promise.all([
			listClients(),
			selectableGameKinds(),
			accessibleProjectsWithClient(locals.user.id, locals.user.role),
			listGames(),
			loadTestServerManifest(),
			getRoleOverrides(locals.user.role),
			getToolOverrides(locals.user.id),
		]);

	// The "purge edge cache" fallback lever lives in /admin — only surface the link
	// to users who can actually use it (the same admin-panel capability publish needs).
	const canPurgeCache = roleHasCapability(
		locals.user.role,
		ADMIN_PANEL_CAPABILITY,
		roleOverrides,
		toolOverrides,
	);

	// Kind id → display name, for the profile's "what kind of game is this" chip.
	const kindNames = new Map(gameKinds.map((k) => [k.id, k.name]));

	// Engine-staleness signal: each game's last publish vs. the release time of the shared
	// runtime bundle it is served from — the "republish + reconcile, don't chase a ghost"
	// prompt. Resolved through the SHARED index so this badge and the bulk republish endpoint
	// (`/api/game-maker/publish-all`) can never disagree about which games are stale.
	const staleness = await engineStalenessIndex(manifest);

	// Which projects already have a registered (published) game + its launch URL,
	// so the page can show "Re-publish" + the current play link.
	const gamesByKey = new Map(games.map((g) => [g.key, g]));
	const projects = await Promise.all(
		accessible.map(async (p) => {
			const game = gamesByKey.get(p.key);
			// Resolve the R2 client slug the same way every tool does (UNASSIGNED_CLIENT
			// when the project has no client) so the scenes-doc key matches the editor.
			const clientKey = p.clientKey ?? UNASSIGNED_CLIENT;

			const entry = manifest.games[p.key];
			const engine = staleness.for(p.key, Boolean(game));

			// The card's "what IS this game" summary. Two extra R2 reads per project (the config +
			// the symbols doc); everything else is already in hand. Both loaders degrade to a
			// usable value rather than throwing, so one unreadable doc costs a chip, not the page.
			const [config, symbols] = await Promise.all([
				resolveGameConfig(clientKey, p.key, p.gameType),
				loadSymbolsDoc(clientKey, p.key),
			]);
			const profile = buildGameProfile({
				gameTypeId: p.gameType,
				gameTypeName: kindNames.get(p.gameType) ?? p.gameType,
				config: config.doc,
				configSource: config.source,
				symbols,
				runtimeId: engine.runtimeId,
				protocol: entry?.protocol ?? null,
			});

			return {
				key: p.key,
				name: p.name,
				clientKey: p.clientKey,
				clientName: p.clientName,
				gameType: p.gameType,
				profile,
				published: Boolean(game),
				url: game?.url ?? null,
				// Publish-confirmation signal: when the project's scenes were last edited.
				scenesUpdatedAt: await scenesLastModified(clientKey, p.key),
				// Engine-staleness: true when a newer runtime shipped after this game's last
				// publish. `engineComparable` distinguishes "up to date" from "unknown" for the UI.
				engineStale: engine.stale,
				engineComparable: engine.comparable,
				runtimeId: engine.runtimeId,
				runtimeReleasedAt: engine.runtimeReleasedAt,
				publishedAt: engine.publishedAt,
			};
		}),
	);

	return {
		clients: clients.map((c) => ({ key: c.key, name: c.name })),
		gameKinds,
		projects,
		canPurgeCache,
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
		// A soft-deleted row still holds the primary key — insert would 500. Say why.
		if (await projectKeyTaken(key)) {
			return fail(400, {
				action: 'create',
				error: `"${key}" is a deleted project. An admin can restore or purge it in /admin.`,
			});
		}
		if (clientKey !== null && !(await clientExists(clientKey))) {
			return fail(400, { action: 'create', error: 'Unknown client.' });
		}

		await createProject(key, name, clientKey, rawGameType !== '' ? rawGameType : undefined);
		await scaffoldProject(clientKey ?? UNASSIGNED_CLIENT, key);
		return { action: 'create', ok: `Created project ${key}.`, createdKey: key };
	},
};
