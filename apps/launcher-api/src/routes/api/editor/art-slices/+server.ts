import { error, json } from '@sveltejs/kit';
import {
	ConflictError,
	loadArtSlicesDocWithEtag,
	saveArtSlicesDoc,
} from '$lib/server/artSlicesStorage';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * The project's ART SLICES — per-region 9-slice insets (`<assetKey>::<region>` →
 * `{left,top,right,bottom}`). Gated and scoped exactly like `/api/editor/art-bounds`: the insets
 * describe the ART, and they ship folded into the TexturePacker JSON as each frame's `borders`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['flipbook', 'fx', 'rigger'],
		forbiddenMessage: 'Your role does not have access to the project art slices.',
	});
	const mismatch = scopeMismatch(url.searchParams.get('projectKey'), projectKey, {
		required: true,
	});
	if (mismatch) return mismatch;
	const { doc, etag } = await loadArtSlicesDocWithEtag(clientKey, projectKey);
	return json({ slices: doc.slices, etag });
};

/**
 * Replace the whole map, guarded by `baseEtag` (409 through `json()` on a lost race).
 *
 * Body: `{ slices: Record<string, {left,top,right,bottom}>, baseEtag: string | null, projectKey }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['flipbook', 'fx', 'rigger'],
		forbiddenMessage: 'Your role does not have access to the project art slices.',
	});
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw error(400, 'Body must be an object.');
	}
	const mismatch = scopeMismatch((body as Record<string, unknown>).projectKey, projectKey, {
		required: true,
	});
	if (mismatch) return mismatch;
	const slices = (body as Record<string, unknown>).slices;
	if (typeof slices !== 'object' || slices === null || Array.isArray(slices)) {
		throw error(400, '`slices` must be a plain object.');
	}
	const baseEtag = writeBaseEtagJson(body);
	try {
		const saved = await saveArtSlicesDoc(clientKey, projectKey, { slices }, baseEtag);
		return json({ ok: true, etag: saved.etag, slices: saved.doc.slices });
	} catch (e) {
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else changed this project’s 9-slice insets while you were editing. ' +
						'Reload to get theirs, then re-apply your slice.',
				},
				{ status: 409 },
			);
		}
		throw error(400, e instanceof Error ? e.message : 'Invalid art slices.');
	}
};
