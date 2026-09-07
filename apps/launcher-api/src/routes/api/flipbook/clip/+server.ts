import { error, json } from '@sveltejs/kit';
import { loadClip } from '$lib/server/flipbookStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Read ONE Invisible Flipbook clip — the read half of `/api/flipbook/save`, so switching clips
 * inside the tool costs a single R2 GET instead of a whole page load.
 *
 * The `/flipbook` loader still seeds a COLD open of `?clip=<id>`, but it also derives the
 * project's atlas list — `loadRegionSet` per manifest, several sequential R2 round-trips each —
 * and NOTHING about picking a different clip invalidates any of that. Re-running the loader to
 * fetch one small JSON doc was the entire cost of opening a clip. This returns exactly what an
 * in-memory swap needs: the doc, plus the ETag its next save must compare-and-swap against.
 *
 * Auth + scope are the same `gate` the save/delete siblings use (SESSION-bound
 * `(client, project)`, `flipbook` entitlement). `?project=` is a MISMATCH ASSERTION, not a
 * selector: it states which project the tab believes it is in, and a disagreement answers 409
 * rather than handing back a different project's clip that happens to share the id.
 *
 * `GET /api/flipbook/clip?id=<id>[&project=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
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

	const { clip, etag } = await loadClip(clientKey, projectKey, id);
	// `loadClip` returns a null clip for a missing OR unusable doc — both mean "there is nothing
	// to open", which the page must report rather than silently present as a blank clip.
	if (!clip) {
		return json(
			{
				ok: false,
				error: 'not-found',
				message: 'That clip could not be read — it may have been deleted.',
			},
			{ status: 404 },
		);
	}
	return json({ ok: true, clip, etag });
};
