import { error, json } from '@sveltejs/kit';
import { SESSION_COOKIE, sessionIdFromToken } from '$lib/server/auth';
import { resolveEditorFonts } from '$lib/server/fonts';
import { FontSwapError, runFontSwap } from '$lib/server/fontSwap';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { gate } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const GATE = {
	tool: 'fontMaker',
	forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
	includeSharedFonts: true,
} as const;

/**
 * The fonts a swap chooses between: every font the project's game RENDERS (its own catalog plus
 * the shared library), which is wider than the View tab's catalog, so a project can swap a
 * library font it uses for one of its own.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const fonts = await resolveEditorFonts(
		clientKey,
		projectKey,
		(key) => '/api/fonts/asset?key=' + encodeURIComponent(key),
	);
	return json({ fonts: fonts ?? [] });
};

interface SwapRequest {
	from?: unknown;
	to?: unknown;
	apply?: unknown;
	/** The project the page loaded — the session's may have moved since (another tab). */
	projectKey?: unknown;
	/** How many references the caller confirmed from its dry run. */
	expect?: unknown;
}

/**
 * Swap one font for another across the active project's docs (`fontSwap.ts`). `apply: false`
 * (the default) is a dry run: it reports every reference it would rewrite and writes nothing.
 * `apply: true` rewrites them, doc by doc, through each doc's own conditional save; a doc whose
 * tool the caller's role lacks is reported and left alone, and a doc open in another author's
 * tab blocks the whole apply. A page whose project is no longer the session's is refused (409),
 * as `flow-v2/save` does: the swap would otherwise rewrite a project nobody looked at.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const sessionId = await sessionIdFromToken(cookies.get(SESSION_COOKIE));
	if (!sessionId) throw error(401, 'Not authenticated');

	let body: SwapRequest;
	try {
		body = (await request.json()) as SwapRequest;
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (typeof body.from !== 'string' || !body.from) throw error(400, 'Expected a `from` font id.');
	if (typeof body.to !== 'string' || !body.to) throw error(400, 'Expected a `to` font id.');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		throw error(
			409,
			`This tab is on "${body.projectKey}" but your active project is now "${projectKey}". Reload to continue.`,
		);
	}

	const user = locals.user!;
	try {
		const report = await runFontSwap({
			clientKey,
			projectKey,
			fromId: body.from,
			toId: body.to,
			apply: body.apply === true,
			expect: typeof body.expect === 'number' ? body.expect : undefined,
			sessionId,
			role: user.role,
			roleOverrides: await getRoleOverrides(user.role),
			userOverrides: await getToolOverrides(user.id),
		});
		return json(report);
	} catch (e) {
		if (e instanceof FontSwapError) throw error(400, e.message);
		throw e;
	}
};
