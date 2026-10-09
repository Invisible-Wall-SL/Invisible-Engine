import { error, redirect } from '@sveltejs/kit';
import { kindCapabilities } from 'engine-layout';
import { projectAddOns } from '$lib/addOns';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { bigTiersOf, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
import { symbolsPageConfig } from '$lib/server/symbolsPageConfig';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { winTextRespinModes, winTextSpinsModes } from '$lib/winTextModes';
import { loadWinTextDocWithEtag } from '$lib/server/winTextStorage';
import type { PageServerLoad } from './$types';

/**
 * Invisible Win Text (`/win-text`) — author the TEMPLATES the game says about a win.
 *
 * The symbol list is `/symbols`' own rows (`symbolsPageConfig` over the resolved config), in the
 * order it draws them: the symbols Invisible Game Config does not badge unused, then a pots
 * overlay's coins. A symbol taken off every strip leaves both tools at once
 * (`check:symbols-follow-config`); its authored strings stay in the doc and come back with the row.
 *
 * See `docs/design/invisible-win-text.md`.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Defensive parity with the symbols/editor routes: the parent layout already resolved the
	// effective manifest, but re-check with overrides so a per-user revoke is honoured.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'winText', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Win Text.');
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const gameType = await projectGameType(projectKey);
	const [{ doc, etag }, config, published, symbolsDoc] = await Promise.all([
		loadWinTextDocWithEtag(clientKey, projectKey),
		// The RESOLVED config (authored ◁ the kind's template) — the game's own precedence, so the
		// jackpot tiers and win levels offered here are the ones the game will name.
		resolveGameConfig(clientKey, projectKey, gameType),
		loadPublishedSymbolDefaults(clientKey, projectKey),
		// The DISPLAY NAMES authored next door in `/symbols` — read-only here. This page previews
		// what a template will actually render, and `{symbolName}` is the one token whose value
		// lives in another tool's doc; without it the preview would show a bare token and the
		// author couldn't tell a named symbol from an unnamed one.
		loadSymbolsDoc(clientKey, projectKey),
	]);
	const { addOns, potIds } = projectAddOns(config.doc);
	const { symbols, coins } = symbolsPageConfig(
		gameType,
		published ?? symbolDefaultsFor(gameType),
		config,
	);

	return {
		clientKey,
		projectKey,
		projectName: await projectName(projectKey),
		gameType,
		tools,
		doc,
		// The precondition the page sends back on save, so a second author can't silently clobber
		// the whole doc. `null` = "there was no doc when I loaded".
		etag,
		// The rows `/symbols` lists, in the order it draws them: the symbols, then the coins.
		symbols: [...symbols.filter((name) => !coins.includes(name)), ...coins],
		/** The pots overlay's coins, in pot order. A coin drops over a cell and is never dealt on a
		 *  line, so it gets no win-line row. */
		coins,
		/** Symbol id → its authored name, straight from the symbols doc. Sparse — an absent id
		 *  is an unnamed symbol, which the shared resolver renders as the id itself. */
		symbolNames: symbolsDoc.names ?? {},
		/** The kind's capabilities with the config's add-ons — a Hold and Win bonus brings the
		 *  feature's lines, a pots overlay its pot lines. */
		capabilities: kindCapabilities(gameType, addOns),
		/** Every respin mode, the primary first: its jackpot tier names in config order and whether
		 *  it spins the pre-feature wheel (its wheel copy is offered only then). The primary's lines
		 *  are the doc's families; another mode's are `doc.modes[<id>]`. */
		respinModes: winTextRespinModes(config.doc),
		/** Every spins mode: its own win-line message and win-tier captions are `doc.modes[<id>]`. */
		spinsModes: winTextSpinsModes(config.doc),
		/** Every pot (meter) id the config declares, Hold and Win meters then overlay pots. */
		meterIds: potIds ?? [],
		/** The config's big-win tiers, which are the ones a caption can be drawn for. Empty when
		 *  the config authors none — the page then offers the coded `winLevelMap` aliases. */
		bigTiers: bigTiersOf(config.doc),
	};
};
