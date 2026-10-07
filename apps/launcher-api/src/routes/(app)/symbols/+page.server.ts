import { error, redirect } from '@sveltejs/kit';
import { kindCapabilities } from 'engine-layout';
import { resolveCascade, resolveReelBehaviour, symbolHoldAndWinRoles } from 'game-config';
import { overlayTokenPots, projectAddOns } from '$lib/addOns';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listClips } from '$lib/server/flipbookStorage';
import { resolveEditorFonts } from '$lib/server/fonts';
import { bigTiersOf, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { listEffects } from '$lib/server/fxStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import {
	loadPublishedSymbolDefaults,
	symbolDefaultsFor,
	symbolGrid,
} from '$lib/server/symbolDefaults';
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
	const configDoc = config.doc;
	// Win-amount text is bitmap text, so the font dropdown lists the project's BITMAP
	// fonts (Font Maker output). The four engine builtins (gold/goldblur/silver/purple)
	// are hardcoded in each game's Game.svelte rather than in the R2 catalog, so the page
	// unions them in — here we just hand over the catalog names.
	const bitmapFonts = (fonts ?? [])
		.filter((f) => f.kind === 'bitmap')
		.map((f) => ({ id: f.id, name: f.name }));
	// The defaults drive every cell's default binding; the doc above is the sparse override on top.
	// Prefer the project's OWN published `SYMBOL_INFO_MAP` (built from its coded map) so e.g. Book of
	// Borut shows its art; fall back to the committed coded set for an un-published project (or
	// `apps/lines` dev) resolved by game type. Which ROWS show is the config's call, never theirs:
	// `symbolGrid` lists exactly the symbols /config does not badge unused — hiding a published
	// symbol the config does not use, adding blank cells for a used one no default covers.
	const grid = symbolGrid(published ?? symbolDefaultsFor(gameType), configDoc);
	const { addOns, potIds } = projectAddOns(configDoc);
	// Each symbol's Hold and Win role(s) from the LIVE config's `special_properties` — chips on the
	// grid's row heads, so the author sees which row is the coin, the collector, the mystery. Only
	// for a kind with coin symbols; every other kind gets an empty map and renders as before.
	const holdAndWinRoles: Record<string, string[]> = {};
	if (configDoc && kindCapabilities(gameType, addOns).coinSymbols) {
		for (const [name, symbol] of Object.entries(configDoc.symbols)) {
			const roles = symbolHoldAndWinRoles(symbol);
			if (roles.length) holdAndWinRoles[name] = roles;
		}
	}
	// `docEtag` guards the save against a concurrent author; null = never authored.
	const { doc, etag: docEtag } = loaded;

	return {
		clientKey,
		projectKey,
		docEtag,
		// The project's config-authored BIG-win tiers drive the reel-anticipation panel: ONE FX column
		// per big tier, keyed by its alias — mirroring the same tiers the game arms (`activeBigTiers`),
		// so the panel grows/shrinks with `/config` rather than a fixed big/mega/massive triple.
		bigTiers: bigTiersOf(configDoc),
		projectName: await projectName(projectKey),
		// The grid gates the two book-only state columns (`bookIntro`/`bookIdle`) on
		// this — they show only for a kind with the book reveal (`kindCapabilities`).
		gameType,
		// Does this project tumble? Gates the `Clear reel` column, which only means anything to
		// a cascading game. Resolved (not the raw stored field) so the answer matches the one the game
		// itself acts on: absent ⇒ the win model's default, so a cluster/scatter project gets the
		// column without authoring anything and a lines project that switched the cascade ON in
		// /config gets it too.
		cascade: resolveCascade(configDoc ?? undefined),
		/**
		 * HOW this project's board arrives, resolved — the gate on the two columns that only mean
		 * something to a swapping board.
		 *
		 * `emerge` gates the `Intro` column: the state is only ever played by `swapStyle: 'emerge'`,
		 * and a column for an animation nothing fires is the exact failure this tool's gating exists
		 * to avoid.
		 *
		 * `clears` is the fix to a gap the clear step shipped with. `Clear reel` was gated on
		 * `cascade` alone, but a swap-in-place project with "Clear the board" ticked plays that very
		 * state on every round (`clearOutgoingSymbols`) — so a lines game authoring the sink half of
		 * an emerge was offered no column for it and had to reach the binding through `Explosion`'s
		 * inheritance without ever being told that is what it was doing.
		 */
		reelBehaviour: (() => {
			const resolved = resolveReelBehaviour(configDoc ?? undefined);
			return {
				emerge: resolved.swapInPlace && resolved.swapStyle === 'emerge',
				clears: resolved.clearBoard,
			};
		})(),
		doc,
		defaults: grid.defaults,
		// The rows the grid lists, in order — see `symbolGrid`.
		symbols: grid.symbols,
		holdAndWinRoles,
		// Each pots overlay token → the pots it fills: a chip on its row head. Empty without the block.
		tokenPots: overlayTokenPots(configDoc),
		// The add-on blocks the config carries — passed with the kind to `kindCapabilities`, so a
		// Hold and Win bonus or a pots overlay lights its own parts on any kind.
		addOns,
		// The Hold and Win jackpot tiers the Game Config declares — the rows of the coin label's
		// per-tier jackpot text. Empty ⇒ the page offers the four tiers the presets use.
		jackpotTiers: (configDoc?.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
		assets,
		fonts: bitmapFonts,
		clips,
		// id + name only — the Book-VFX FX picker is a plain select; the effect's layers live in /fx.
		effects: effects.map((e) => ({ id: e.id, name: e.name })),
		// Every meter the Game Config declares (`resolveMeters`: Hold and Win meters, then overlay
		// pots) — one `toMeter:<id>` row each in the Flights section, so a single pot can fly
		// differently from the rest.
		meterIds: potIds ?? [],
	};
};
