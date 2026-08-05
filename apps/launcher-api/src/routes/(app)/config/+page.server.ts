import { error, redirect } from '@sveltejs/kit';
import { validateGameConfigDoc } from 'game-config';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { gameConfigDefaultFor, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Game Config (`/config`) — author the project's GAME MATH CONTRACT: the symbol
 * dictionary + paytable, paylines, grid, bet modes, identity/RTP, and the cosmetic reel strips.
 * It replaces the ONE compiled `apps/lines/src/game/config.ts` that every online project shares.
 *
 * The page opens on the RESOLVED config: the project's authored doc if it has one, otherwise its
 * game-type template default. `source` tells the author which they are looking at (so "edit" vs
 * "adopt the template" is never ambiguous), and `etag` is the save precondition — `null` when the
 * project has never authored, which correctly asks R2 to CREATE rather than overwrite on first save.
 *
 * See `docs/design/invisible-game-config.md`.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Defensive parity with the other tool routes: the parent layout already resolved the effective
	// manifest, but re-check with overrides so a per-user revoke is honoured.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Game Config.');
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const gameType = await projectGameType(projectKey);
	const [{ doc, source, etag }, name, components, assets] = await Promise.all([
		resolveGameConfig(clientKey, projectKey, gameType),
		projectName(projectKey),
		// The component palette (built-ins + shared + this project's, project shadowing shared) — the
		// SAME source the Scene Editor lists, so the per-mode "Card" picker offers exactly the ids a
		// scene can mount (e.g. the built-in `featureCard`). Read-only; slimmed to id/name so the page
		// never ships the whole authored trees.
		listComponents({ projectKey }),
		// The project's editor assets — same read-only source the Scene Editor uses — so the per-mode
		// "Card graphics" section can offer the SAME visual pickers: an art/region picker for `image`
		// params (atlas-manifest + sheet frames) and a spine-bundle picker for `spine` params. The R2
		// reads are the shared `listProjectAssets` helper; we slim the result to what the pickers need.
		listProjectAssets(clientKey, projectKey),
	]);

	// The template default the "Reset to template default" action restores. Sent even when the
	// project is already on it (source === 'template') so the button works after any edit without a
	// round-trip. Null only if the generated defaults are broken (see `gameConfigDefaults.ts`).
	const templateDefault = gameConfigDefaultFor(gameType);

	return {
		clientKey,
		projectKey,
		projectName: name,
		gameType,
		tools,
		doc,
		source,
		etag,
		templateDefault,
		// id/name/category + PARAMS — the dropdown needs id/name/category; the per-mode card-param editor
		// needs each component's declared params (key/kind/label/group/options/default/engineProvided) so
		// it can render a typed input per authorable param and write chosen values into `cardParams`. The
		// node trees are still dropped (never shipped to the page).
		components: components.map((c) => ({
			id: c.id,
			name: c.name,
			category: c.category,
			params: c.params ?? [],
		})),
		// The region-picker source for `image` card params: atlas MANIFESTS + sheets (atlas pages
		// aren't manifests). Mirrors the editor's `pickSheets` derivation; `{ key, name }` only.
		pickSheets: [
			...assets.atlases
				.filter((a) => a.kind === 'atlas-manifest')
				.map((a) => ({ key: a.key, name: a.name })),
			...assets.sheets.map((s) => ({ key: s.key, name: s.name })),
		],
		// The spine-bundle source for `spine` card params (project + shared bundles). `{ name, key,
		// shared }` — `name` is the value a `spine` param stores; `key` is the R2 prefix the animation
		// dropdown keys its `/api/editor/spine/meta` fetch by.
		spines: assets.spines.map((s) => ({ name: s.name, key: s.key, shared: s.shared })),
		// Validate server-side too, so the page shows issues on FIRST paint (before any edit fires
		// the client validator) — a pasted-in config that lies is visible immediately.
		issues: doc ? validateGameConfigDoc(doc) : [],
	};
};
