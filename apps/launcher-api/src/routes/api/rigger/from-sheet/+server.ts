import { json } from '@sveltejs/kit';
import { SHEET_SIDECAR } from '$lib/rigSheetMap';
import { riggerBundlePrefix } from '$lib/server/riggerBundle';
import { getObjectText } from '$lib/server/r2';
import { parseSheetMapping } from '$lib/server/rigSheetFit';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The sheet mapping a rig was made from (🗺 From my sheet, docs/design/frame-to-rig.md §13), so the
 * Rigger opens it again: GET `?dir=<b64 bundle dir>` → `{ sheet }`, null when the bundle has no
 * `sheet.json` or it no longer reads. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const bundle = riggerBundlePrefix(clientKey, projectKey, url.searchParams.get('dir') ?? '');
	const text = await getObjectText(`${bundle}/${SHEET_SIDECAR}`);
	const parsed = text === null ? null : readMapping(text);
	return json({ sheet: parsed && 'mapping' in parsed ? parsed.mapping : null });
};

/** A kept `sheet.json` read strictly; null when it is not JSON. */
function readMapping(text: string): ReturnType<typeof parseSheetMapping> | null {
	try {
		return parseSheetMapping(JSON.parse(text));
	} catch {
		return null;
	}
}
