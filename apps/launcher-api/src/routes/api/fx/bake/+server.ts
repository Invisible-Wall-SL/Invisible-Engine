import { error, json } from '@sveltejs/kit';
import {
	EFFECT_BAKE_LIMITS,
	effectBakeGroupFrameNames,
	effectBakeSheetJson,
	packEffectBakeFrames,
} from 'engine-fx';
import { readBakeTarget } from '$lib/server/fxBake';
import { fxBakeKeys } from '$lib/server/projectPaths';
import { headObject, putObjectText } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const posInt = (v: unknown, max: number): number | undefined =>
	typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max ? v : undefined;

/**
 * Step 2 of "Bake now" in `/fx` (`invisible-fx.md` §"Baked effects"): once the page PNG is in R2 (step
 * 1, `upload-url`), write the sheet's TexturePacker JSON beside it — built HERE by re-packing the
 * trims the page reports (`packEffectBakeFrames`, the packer the page laid the PNG out with), never
 * taken from the client — and answer the `assetKey` + each blend group's frame names, which the page
 * stores in `doc.bake.result`. The doc itself is not written: the author saves it, and that Save
 * prunes every other bake of the effect.
 *
 * Body: `{ effectId, hash, projectKey?, frames, groups?, sheet: { cellW, cellH, width, height,
 * trims } }` — `frames` per blend group, `groups` of them (1 when absent), one trim (`{x,y,w,h}`
 * inside the cell) per cell, cells group by group; `width × height` is the page the PNG holds, and
 * must be the page the packer lays those trims out on.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const target = readBakeTarget(body, projectKey);
	if (target instanceof Response) return target;

	const side = EFFECT_BAKE_LIMITS.sheetSide;
	const raw = (body?.sheet ?? {}) as Record<string, unknown>;
	const frames = posInt(body?.frames, EFFECT_BAKE_LIMITS.frames.max);
	const groups = body?.groups === undefined ? 1 : posInt(body.groups, EFFECT_BAKE_LIMITS.groups);
	const cellW = posInt(raw.cellW, side);
	const cellH = posInt(raw.cellH, side);
	const width = posInt(raw.width, side);
	const height = posInt(raw.height, side);
	const trims = Array.isArray(raw.trims) ? raw.trims : [];
	if (!frames || !groups || !cellW || !cellH || !width || !height) {
		throw error(400, 'Invalid bake sheet layout.');
	}
	const layout =
		trims.length === frames * groups ? packEffectBakeFrames(cellW, cellH, trims) : undefined;
	if (!layout || layout.width !== width || layout.height !== height) {
		throw error(400, 'Invalid bake sheet layout.');
	}

	const keys = fxBakeKeys(clientKey, projectKey, target.effectId, target.hash);
	assertAllowed(keys.json, prefixes);
	if (!(await headObject(keys.png))) throw error(409, 'The baked page did not reach storage.');

	const sheet = effectBakeSheetJson(layout, keys.image, target.hash);
	await putObjectText(keys.json, JSON.stringify(sheet), 'application/json');
	return json({
		ok: true,
		assetKey: keys.json,
		groups: effectBakeGroupFrameNames(target.hash, frames, groups),
	});
};
