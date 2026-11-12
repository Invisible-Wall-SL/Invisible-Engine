import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import {
	OLDEST_UPGRADABLE,
	exportVersion,
	isUpgradableSpine3,
	upgradeSpine38Json,
} from '$lib/server/spine38Upgrade';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Upgrade a 3.8 skeleton export to the 4.2 format (`upgradeSpine38Json`) and answer it, so the
 * Rigger can check the result through its own loader before `/api/rigger/import` writes anything.
 * Writes nothing. `rigger`-gated.
 *
 * Body: `{ skeleton }`. Answers `{ ok, skeleton, from }`, `from` being the export's version.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	const skeleton = body?.skeleton;
	if (!skeleton || typeof skeleton !== 'object' || Array.isArray(skeleton))
		throw error(400, 'the skeleton is not a JSON object');
	const doc = skeleton as Record<string, unknown>;
	if (!isUpgradableSpine3(doc)) {
		const v = exportVersion(doc);
		throw error(
			422,
			v
				? `a ${v.join('.')} export is not upgraded; only ${OLDEST_UPGRADABLE.join('.')} and later 3.x ones are`
				: 'the skeleton does not say which version exported it',
		);
	}
	const from = (doc.skeleton as Record<string, unknown>).spine;
	return json({ ok: true, skeleton: upgradeSpine38Json(doc), from });
};
