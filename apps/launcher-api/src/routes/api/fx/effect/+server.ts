import { error, json } from '@sveltejs/kit';
import { loadEffect } from '$lib/server/fxStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Read ONE Invisible FX effect — the read half of `/api/fx/save`, so switching effects inside
 * the tool costs one R2 GET (plus its sidecar) instead of a whole page load.
 *
 * The `/fx` loader still seeds a COLD open of `?effect=<id>`, but it also derives the project's
 * atlas list (`loadRegionSet` per manifest — several sequential R2 round-trips each), the
 * LayoutDoc and the Flow v2 graph, purely to build the region picker and the trigger vocabulary.
 * None of that changes when the author picks a different effect, and reloading the document
 * additionally tears down and rebuilds the stage's WebGL context. This returns exactly what an
 * in-memory swap needs.
 *
 * Auth + scope are the same `gate` the save/delete siblings use (SESSION-bound
 * `(client, project)`, `fx` entitlement). `?project=` is a MISMATCH ASSERTION, not a selector:
 * a disagreement answers 409 rather than handing back a different project's effect that happens
 * to share the id.
 *
 * `GET /api/fx/effect?id=<id>[&project=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});

	const id = url.searchParams.get('id')?.trim() ?? '';
	if (!id) throw error(400, 'missing id');

	const claimed = url.searchParams.get('project')?.trim();
	if (claimed && claimed !== projectKey) {
		return json(
			{
				ok: false,
				error: 'scope-mismatch',
				message:
					`This tab is editing "${claimed}" but your active project is now "${projectKey}". ` +
					'Reload to continue — opening here would show the wrong project.',
			},
			{ status: 409 },
		);
	}

	// `loadEffect` normalizes a missing doc to an EMPTY effect with a null etag rather than
	// failing — the same value the loader hands the page for an unknown `?effect=`, so the swap
	// behaves identically to the navigation it replaces. `etag: null` then makes the next save
	// take the create path, which is correct for an id with nothing stored behind it.
	const { doc, meta, docEtag } = await loadEffect(clientKey, projectKey, id);
	return json({ ok: true, doc, meta, etag: docEtag });
};
