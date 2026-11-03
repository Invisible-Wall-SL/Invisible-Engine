import { error, json } from '@sveltejs/kit';
import {
	EFFECT_BAKE_LIMITS,
	effectBakeGroupFrameNames,
	effectBakeSheetJson,
	effectBakeSheetSize,
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
 * 1, `upload-url`), write the sheet's TexturePacker JSON beside it — built HERE from the grid the page
 * reports (`effectBakeSheetJson`), never taken from the client — and answer the `assetKey` + each
 * blend group's frame names, which the page stores in `doc.bake.result`. The doc itself is not
 * written: the author saves it, and that Save prunes every other bake of the effect.
 *
 * Body: `{ effectId, hash, projectKey?, frames, groups?, plan: { cellW, cellH, gap, cols, rows,
 * width, height } }` — `frames` per blend group, `groups` of them (1 when absent), the cells laid
 * out group by group.
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
	const maxCells = EFFECT_BAKE_LIMITS.frames.max * EFFECT_BAKE_LIMITS.groups;
	const raw = (body?.plan ?? {}) as Record<string, unknown>;
	const frames = posInt(body?.frames, EFFECT_BAKE_LIMITS.frames.max);
	const groups = body?.groups === undefined ? 1 : posInt(body.groups, EFFECT_BAKE_LIMITS.groups);
	const cellW = posInt(raw.cellW, side);
	const cellH = posInt(raw.cellH, side);
	const gap =
		typeof raw.gap === 'number' && Number.isInteger(raw.gap) && raw.gap >= 0 ? raw.gap : 0;
	const cols = posInt(raw.cols, maxCells);
	const rows = posInt(raw.rows, maxCells);
	const width = posInt(raw.width, side);
	const height = posInt(raw.height, side);
	if (!frames || !groups || !cellW || !cellH || !cols || !rows || !width || !height) {
		throw error(400, 'Invalid bake sheet layout.');
	}
	const cells = frames * groups;
	const need = effectBakeSheetSize({ cellW, cellH, gap, cols, rows });
	if (cols * rows < cells || need.width > width || need.height > height) {
		throw error(400, 'Invalid bake sheet layout.');
	}

	const keys = fxBakeKeys(clientKey, projectKey, target.effectId, target.hash);
	assertAllowed(keys.json, prefixes);
	if (!(await headObject(keys.png))) throw error(409, 'The baked page did not reach storage.');

	const sheet = effectBakeSheetJson(
		{ cellW, cellH, gap, cols, width, height },
		cells,
		keys.image,
		target.hash,
	);
	await putObjectText(keys.json, JSON.stringify(sheet), 'application/json');
	return json({
		ok: true,
		assetKey: keys.json,
		groups: effectBakeGroupFrameNames(target.hash, frames, groups),
	});
};
