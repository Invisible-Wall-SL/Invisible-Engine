import { error, json } from '@sveltejs/kit';
import { EFFECT_BAKE_LIMITS, effectBakeFrameName, effectBakeSheetJson } from 'engine-fx';
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
 * reports (`effectBakeSheetJson`), never taken from the client — and answer the `assetKey` + frame
 * names the page stores in `doc.bake.result`. The doc itself is not written: the author saves it, and
 * that Save prunes every other bake of the effect.
 *
 * Body: `{ effectId, hash, projectKey?, frames, plan: { cellW, cellH, gap, cols, rows, width, height } }`.
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
	const raw = (body?.plan ?? {}) as Record<string, unknown>;
	const frames = posInt(body?.frames, EFFECT_BAKE_LIMITS.frames.max);
	const plan = {
		cellW: posInt(raw.cellW, side),
		cellH: posInt(raw.cellH, side),
		gap: typeof raw.gap === 'number' && Number.isInteger(raw.gap) && raw.gap >= 0 ? raw.gap : 0,
		cols: posInt(raw.cols, EFFECT_BAKE_LIMITS.frames.max),
		rows: posInt(raw.rows, EFFECT_BAKE_LIMITS.frames.max),
		width: posInt(raw.width, side),
		height: posInt(raw.height, side),
	};
	if (
		!frames ||
		!plan.cellW ||
		!plan.cellH ||
		!plan.cols ||
		!plan.rows ||
		!plan.width ||
		!plan.height ||
		plan.cols * plan.rows < frames ||
		plan.cols * plan.cellW + (plan.cols - 1) * plan.gap > plan.width ||
		plan.rows * plan.cellH + (plan.rows - 1) * plan.gap > plan.height
	) {
		throw error(400, 'Invalid bake sheet layout.');
	}

	const keys = fxBakeKeys(clientKey, projectKey, target.effectId, target.hash);
	assertAllowed(keys.json, prefixes);
	if (!(await headObject(keys.png))) throw error(409, 'The baked page did not reach storage.');

	const sheet = effectBakeSheetJson(
		{
			cellW: plan.cellW,
			cellH: plan.cellH,
			gap: plan.gap,
			cols: plan.cols,
			width: plan.width,
			height: plan.height,
		},
		frames,
		keys.image,
		target.hash,
	);
	await putObjectText(keys.json, JSON.stringify(sheet), 'application/json');
	return json({
		ok: true,
		assetKey: keys.json,
		frames: Array.from({ length: frames }, (_, i) => effectBakeFrameName(target.hash, i)),
	});
};
