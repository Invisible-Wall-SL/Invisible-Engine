import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { loadWinTextDocWithEtag } from '$lib/server/winTextStorage';
import type { PageServerLoad } from './$types';

/**
 * Invisible Win Text (`/win-text`) — author the TEMPLATES the game says about a win.
 *
 * The symbol list is taken from the SAME source `/symbols` uses (the project's published
 * `SYMBOL_INFO_MAP`, falling back to the committed coded set by game type), so the grid's rows
 * are the project's real symbols rather than a hardcoded list — and the two tools can never
 * disagree about what a symbol is.
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

	const [{ doc, etag }, gameType, published, symbolsDoc] = await Promise.all([
		loadWinTextDocWithEtag(clientKey, projectKey),
		projectGameType(projectKey),
		loadPublishedSymbolDefaults(clientKey, projectKey),
		// The DISPLAY NAMES authored next door in `/symbols` — read-only here. This page previews
		// what a template will actually render, and `{symbolName}` is the one token whose value
		// lives in another tool's doc; without it the preview would show a bare token and the
		// author couldn't tell a named symbol from an unnamed one.
		loadSymbolsDoc(clientKey, projectKey),
	]);
	const defaults = published ?? symbolDefaultsFor(gameType);

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
		// `defaults.symbols` — NOT `defaults`, which is the wrapper doc (`version`/`gameType`/
		// `symbols`/`highlight`) and would label the grid's rows with those keys. `Object.keys` on
		// the wrapper type-checks fine, so only the rendered grid shows the mistake.
		symbols: Object.keys(defaults.symbols),
		/** Symbol id → its authored name, straight from the symbols doc. Sparse — an absent id
		 *  is an unnamed symbol, which the shared resolver renders as the id itself. */
		symbolNames: symbolsDoc.names ?? {},
	};
};
