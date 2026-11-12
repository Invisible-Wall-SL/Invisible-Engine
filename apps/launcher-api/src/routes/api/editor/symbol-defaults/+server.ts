import { error, json } from '@sveltejs/kit';
import { requireDeployToken } from '$lib/server/deployToken';
import { readJson } from '$lib/server/http';
import { clientKeyOf, projectParam } from '$lib/server/projectLookup';
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
	await requireDeployToken(url, 'Symbol-defaults publish is not configured.');

	const projectKey = projectParam(url);
	const clientKey = await clientKeyOf(projectKey);

	const body = await readJson(request, 'Body must be JSON.');

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
