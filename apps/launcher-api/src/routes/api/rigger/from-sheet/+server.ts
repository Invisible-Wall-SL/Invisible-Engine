import { error, json } from '@sveltejs/kit';
import { SHEET_SIDECAR } from '$lib/rigSheetMap';
import { conflictResponse } from '$lib/server/conflict';
import { jsonObjectOrNull } from '$lib/server/http';
import { getObjectTextWithEtag, headObject, precondition, putObjectText } from '$lib/server/r2';
import { riggerBundlePrefix } from '$lib/server/riggerBundle';
import { irigTarget, scopeMismatch } from '$lib/server/riggerIrigWrite';
import { requestSheet } from '$lib/server/riggerNewRig';
import { bundlePrefixOf, liveArtKey } from '$lib/server/rigFrameSourceStore';
import { parseSheetMapping } from '$lib/server/rigSheetFit';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const GATE = {
	tool: 'rigger',
	forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
} as const;

/**
 * The sheet mapping a rig was made from (🗺 From my sheet, docs/design/frame-to-rig.md §13), so the
 * Rigger opens it again: GET `?dir=<b64 bundle dir>` → `{ sheet, etag }`, `sheet` null when the bundle
 * has no `sheet.json` or it no longer reads. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const bundle = riggerBundlePrefix(clientKey, projectKey, url.searchParams.get('dir') ?? '');
	const read = await getObjectTextWithEtag(`${bundle}/${SHEET_SIDECAR}`);
	const parsed = read === null ? null : readMapping(read.text);
	return json({
		sheet: parsed && 'mapping' in parsed ? parsed.mapping : null,
		etag: read?.etag ?? null,
	});
};

/**
 * The mapping 🔄 Update rig left the rig with (§13.1b), stored once the rig is: PUT `{ dir, stem,
 * projectKey, sheet, baseEtag }`, conditional on the `sheet.json` the page read (a 409 when another
 * tab updated it since). Only beside an existing rig, and of the sheet it draws from. Answers
 * `{ ok, etag }`.
 */
export const PUT: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey)
		return scopeMismatch(body.projectKey, projectKey);
	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);
	if (!(await headObject(target.key))) throw error(404, `There is no rig "${target.stem}".`);
	const mapping = requestSheet(body.sheet);
	if (!mapping) throw error(400, 'No mapping was sent.');
	if (mapping.manifestKey !== (await liveArtKey(bundlePrefixOf(target))))
		throw error(422, "A rig's mapping is of the sheet it draws from.");
	const baseEtag = body.baseEtag;
	if (baseEtag !== null && typeof baseEtag !== 'string')
		throw error(400, 'baseEtag is the sheet.json read, or null when there was none.');
	try {
		const etag = await putObjectText(
			`${bundlePrefixOf(target)}/${SHEET_SIDECAR}`,
			JSON.stringify(mapping),
			'application/json',
			precondition(baseEtag),
		);
		return json({ ok: true, etag });
	} catch (e) {
		const conflict = conflictResponse(
			e,
			`Someone else updated the sheet mapping of "${target.stem}" since you opened it: reload the rig, then 🗺 Edit mapping again.`,
		);
		if (conflict) return conflict;
		throw e;
	}
};

/** A kept `sheet.json` read strictly; null when it is not JSON. */
function readMapping(text: string): ReturnType<typeof parseSheetMapping> | null {
	try {
		return parseSheetMapping(JSON.parse(text));
	} catch {
		return null;
	}
}
