import { error, redirect } from '@sveltejs/kit';
import { symbolsInPlay } from 'game-config';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listClips } from '$lib/server/flipbookStorage';
import { resolveEditorFonts } from '$lib/server/fonts';
import { loadGameConfigDoc } from '$lib/server/gameConfigStorage';
import { resolveBigTiers } from '$lib/server/gameConfigDefaults';
import { listEffects } from '$lib/server/fxStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
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
	const [loaded, assets, gameType, published, configDoc, fonts, clips, effects] = await Promise.all([
		loadSymbolsDocWithEtag(clientKey, projectKey),
		listProjectAssets(clientKey, projectKey),
		projectGameType(projectKey),
		loadPublishedSymbolDefaults(clientKey, projectKey),
		// The LIVE game config — its in-play strips are unioned into the grid below so a symbol just
		// put in play in Invisible Game Config shows here on reload (the published defaults are baked).
		loadGameConfigDoc(clientKey, projectKey),
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
	// The defaults drive the grid's symbol list, the 6 states, and every cell's
	// default binding; the doc above is the sparse override on top. Prefer the
	// project's OWN published `SYMBOL_INFO_MAP` (built from its coded map) so e.g.
	// Book of Borut shows its symbols; fall back to the committed coded set for an
	// un-published project (or `apps/lines` dev) resolved by game type.
	const baseDefaults = published ?? symbolDefaultsFor(gameType);
	// The published/coded defaults are BAKED at engine-build time, so a symbol the author just put IN
	// PLAY in Invisible Game Config (e.g. a wild `W`) would not appear in this grid until the next
	// build — the recurring "I added it but /symbols doesn't update" gap. Union the LIVE config's
	// in-play set (the strips, the same gate the paytable/roll use) into the grid list; a symbol with
	// no baked state map gets an empty one (blank, authorable cells). Never REMOVES a baked symbol —
	// purely additive, so a symbol mid-authoring can't vanish.
	const inPlayNames = configDoc ? symbolsInPlay(configDoc) : [];
	const mergedSymbols = { ...baseDefaults.symbols };
	for (const name of inPlayNames) {
		if (!mergedSymbols[name]) mergedSymbols[name] = {} as (typeof mergedSymbols)[string];
	}
	const defaults = { ...baseDefaults, symbols: mergedSymbols };
	// The project's config-authored BIG-win tiers drive the reel-anticipation panel: ONE FX column per
	// big tier, keyed by its alias — mirroring the same tiers the game arms (`activeBigTiers`), so the
	// panel grows/shrinks with `/config` rather than a fixed big/mega/massive triple. Resolved after
	// the batch since it needs the resolved `gameType`.
	const bigTiers = await resolveBigTiers(clientKey, projectKey, gameType);
	// `docEtag` guards the save against a concurrent author; null = never authored.
	const { doc, etag: docEtag } = loaded;

	return {
		clientKey,
		projectKey,
		docEtag,
		bigTiers,
		projectName: await projectName(projectKey),
		// The grid gates the two book-only state columns (`bookIntro`/`bookIdle`) on
		// this — they show only for a book game (`gameType === 'bookOf'`).
		gameType,
		doc,
		defaults,
		assets,
		fonts: bitmapFonts,
		clips,
		// id + name only — the Book-VFX FX picker is a plain select; the effect's layers live in /fx.
		effects: effects.map((e) => ({ id: e.id, name: e.name })),
	};
};
