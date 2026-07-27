import { error, fail, redirect } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability, roleHasTool } from '$lib/roles';
import { clientExists, listClients } from '$lib/server/clients';
import { selectableGameKinds } from '$lib/server/gameKinds';
import { listGames } from '$lib/server/games';
import { UNASSIGNED_CLIENT, editorDocKey } from '$lib/server/projectPaths';
import { scaffoldProject } from '$lib/server/projectScaffold';
import {
	accessibleProjectsWithClient,
	createProject,
	isValidProjectKey,
	projectExists,
} from '$lib/server/projects';
import { listAllObjects } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import {
	loadTestServerManifest,
	runtimeBundleReleasedAt,
} from '$lib/server/testServerManifest';
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

	// Which authoring tools the role can launch from the hub — drives which
	// per-project links the page renders (only tools the user actually has).
	const toolIds = new Set(tools.map((t) => t.id));

	// Engine-staleness signal: when was each referenced generic runtime bundle last
	// released (its `_runtime/<id>/index.html` mtime in R2). Resolved once per distinct
	// runtime id — normally just `lines` — and compared below against each game's own
	// last-publish time so the page can flag a game whose RUNNING engine is behind the
	// current one (the "republish + reconcile, don't chase a ghost" prompt).
	const runtimeIds = new Set<string>();
	for (const entry of Object.values(manifest.games)) {
		if (entry.runtime) runtimeIds.add(entry.runtime);
	}
	const runtimeReleasedAt = new Map<string, number | null>();
	await Promise.all(
		[...runtimeIds].map(async (id) => runtimeReleasedAt.set(id, await runtimeBundleReleasedAt(id))),
	);

	// Which projects already have a registered (published) game + its launch URL,
	// so the page can show "Re-publish" + the current play link.
	const gamesByKey = new Map(games.map((g) => [g.key, g]));
	const projects = await Promise.all(
		accessible.map(async (p) => {
			const game = gamesByKey.get(p.key);
			// Resolve the R2 client slug the same way every tool does (UNASSIGNED_CLIENT
			// when the project has no client) so the scenes-doc key matches the editor.
			const clientKey = p.clientKey ?? UNASSIGNED_CLIENT;

			// Compare the game's last publish (manifest `updatedAt`) against its runtime's
			// release time. Only runtime-served games (a `runtime` field) can drift this way;
			// desktop games pin their engine in their own bundle and aren't published here.
			// Missing/unparseable timestamps ⇒ can't compare ⇒ not flagged (no false alarm).
			const entry = manifest.games[p.key];
			const runtimeId = entry?.runtime ?? null;
			const publishedAt = entry?.updatedAt ? Date.parse(entry.updatedAt) : NaN;
			const releasedAt = runtimeId ? (runtimeReleasedAt.get(runtimeId) ?? null) : null;
			const canCompare =
				Boolean(game) && releasedAt !== null && Number.isFinite(publishedAt);
			const engineStale = canCompare && releasedAt! > publishedAt;

			return {
				key: p.key,
				name: p.name,
				clientName: p.clientName,
				published: Boolean(game),
				url: game?.url ?? null,
				// Publish-confirmation signal: when the project's scenes were last edited.
				scenesUpdatedAt: await scenesLastModified(clientKey, p.key),
				// Engine-staleness: true when a newer runtime shipped after this game's last
				// publish. `canCompare` distinguishes "up to date" from "unknown" for the UI.
				engineStale,
				engineComparable: canCompare,
				runtimeId,
				runtimeReleasedAt: releasedAt,
				publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
			};
		}),
	);

	return {
		clients: clients.map((c) => ({ key: c.key, name: c.name })),
		gameKinds,
		projects,
		canPurgeCache,
		// Per-project launch links are gated on these tool ids (the hub only links to
		// tools the role can open). Order here mirrors the row's button order.
		launchTools: {
			editor: toolIds.has('editor'),
			atlasTool: toolIds.has('atlasTool'),
			fontMaker: toolIds.has('fontMaker'),
			symbols: toolIds.has('symbols'),
			localization: toolIds.has('localization'),
		},
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
