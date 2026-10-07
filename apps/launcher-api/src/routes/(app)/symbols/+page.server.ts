import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listClips } from '$lib/server/flipbookStorage';
import { resolveEditorFonts } from '$lib/server/fonts';
import { resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { listEffects } from '$lib/server/fxStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
import { symbolsPageConfig } from '$lib/server/symbolsPageConfig';
import { loadSymbolsDocWithEtag } from '$lib/server/symbolsStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * The Invisible Symbols State Machine renders a live preview grid (canvas image
 * thumbs + a WebGL spine preview for the focused cell). Server-rendering that is
 * pointless and fragile — same rationale as the editor/font routes: `load` still
 * runs server-side and its data flows to the client; only the component render is
 * client-only.
 */
export const ssr = false;

export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Defensive parity with the editor route: the parent layout already resolved
	// the effective manifest, but re-check with overrides so a per-user revoke is
	// honoured even if the manifest were stale.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'symbols', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to the Invisible Symbols State Machine.');
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const gameTypeLoad = projectGameType(projectKey);
	const [loaded, assets, gameType, published, config, fonts, clips, effects] = await Promise.all([
		loadSymbolsDocWithEtag(clientKey, projectKey),
		listProjectAssets(clientKey, projectKey),
		gameTypeLoad,
		loadPublishedSymbolDefaults(clientKey, projectKey),
		// The config Invisible Game Config opens with — the project's own, else its kind's template —
		// read LIVE, so this page lists the symbols that page does not badge unused, and lights the
		// columns and sections from the switches that page shows.
		gameTypeLoad.then((type) => resolveGameConfig(clientKey, projectKey, type)),
		resolveEditorFonts(clientKey, projectKey),
		// Invisible Flipbook clips — the third binding kind a cell can take, alongside a
		// sprite frame and a spine animation. Rows only (id/name/frame count/primary sheet/
		// first frame); the clip's full ordered frame list is the /flipbook tool's business.
		listClips(clientKey, projectKey),
		// Invisible FX effects (id + name) — the fourth kind a Book-symbol VFX layer can take.
		// Same list the editor's effect-node picker uses (`/api/editor/effects`).
		listEffects(clientKey, projectKey),
	]);
	// Win-amount text is bitmap text, so the font dropdown lists the project's BITMAP
	// fonts (Font Maker output). The four engine builtins (gold/goldblur/silver/purple)
	// are hardcoded in each game's Game.svelte rather than in the R2 catalog, so the page
	// unions them in — here we just hand over the catalog names.
	const bitmapFonts = (fonts ?? [])
		.filter((f) => f.kind === 'bitmap')
		.map((f) => ({ id: f.id, name: f.name }));
	// `docEtag` guards the save against a concurrent author; null = never authored.
	const { doc, etag: docEtag } = loaded;

	return {
		clientKey,
		projectKey,
		docEtag,
		projectName: await projectName(projectKey),
		// The grid gates the two book-only state columns (`bookIntro`/`bookIdle`) on
		// this — they show only for a kind with the book reveal (`kindCapabilities`).
		gameType,
		doc,
		// The rows, their default art (the project's OWN published `SYMBOL_INFO_MAP`, else the
		// committed set for its kind) and every gate the Game Config drives.
		...symbolsPageConfig(gameType, published ?? symbolDefaultsFor(gameType), config),
		assets,
		fonts: bitmapFonts,
		clips,
		// id + name only — the Book-VFX FX picker is a plain select; the effect's layers live in /fx.
		effects: effects.map((e) => ({ id: e.id, name: e.name })),
	};
};
