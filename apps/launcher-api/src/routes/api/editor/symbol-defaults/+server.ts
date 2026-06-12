import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { savePublishedSymbolDefaults } from '$lib/server/symbolDefaults';
import type { RequestHandler } from './$types';

/**
 * Build-time publish: a game posts its coded `SYMBOL_INFO_MAP` (built into a
 * `SymbolDefaults` doc by `publish-symbol-defaults.mjs`) so the Invisible Symbols
 * State Machine grid is driven by each project's OWN symbol set instead of the
 * committed `lines.json` fallback. Stored at `symbols/defaults.json` in R2.
 *
 * Gated by the same shared deploy token as `/api/editor/export-art` (`?k=` vs the
 * `deployToken` app setting / `EDITOR_DOC_SECRET`) — a build runner has the token,
 * no launcher session. Idempotent; safe to re-run per build.
 */
export const PUT: RequestHandler = async ({ url, request }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Symbol-defaults publish is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Body must be JSON.');
	}

	try {
		const saved = await savePublishedSymbolDefaults(clientKey, projectKey, body);
		return json({ clientKey, projectKey, symbols: Object.keys(saved.symbols).length });
	} catch (e) {
		if (e instanceof Error && e.name === 'ZodError') {
			throw error(400, 'Invalid symbol-defaults payload.');
		}
		console.error('symbol-defaults publish failed:', e);
		throw error(502, 'Failed to publish the symbol defaults.');
	}
};
