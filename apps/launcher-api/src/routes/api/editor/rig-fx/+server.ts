import { error, json } from '@sveltejs/kit';
import { getObjectText } from '$lib/server/r2';
import { fxTimelineFromSkeleton, type RigFxTimeline } from '$lib/server/rigFxExport';
import { resolveEditorSpine } from '$lib/server/spine';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Resolve a spine bundle's `assetKey` to its rig→FX-binding TIMELINE — `event.fx = { effectId, bone? }`
 * grouped by animation and carrying each keyframe's `time`. The Symbols State-Machine live FX overlay
 * (`SymbolSpineStage.svelte`) reads this to fire an effect on the beat of a symbol's animation, at the
 * bound bone, mirroring the Rigger's `view.html`.
 *
 * WHY a server endpoint (not client-side parsing): spine-pixi discards the custom `event.fx` field on
 * parse, so the compiled `SpineSkeletonData` the stage already holds can't surface it — the RAW
 * skeleton JSON must be read. Doing that here (server-side, via the SAME `resolveEditorSpine` the
 * descriptor endpoint uses + `fxTimelineFromSkeleton`) keeps the payload tiny (just the fx timeline)
 * instead of re-downloading + re-parsing a whole multi-MB skeleton on the client per bundle.
 *
 * Gated exactly like `/api/editor/spine` (the SAME endpoint the stage already loads skeletons through),
 * scope bound to the session's active project, shared spines opted in. Defensive by design: an unknown
 * bundle, a binary `.skel` (which can't carry the field), or a parse error returns empty bindings —
 * never a 500 (the preview then simply renders the spine with no FX, byte-identical to today).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedSpines: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');

	let animations: RigFxTimeline = {};
	try {
		const descriptor = await resolveEditorSpine(clientKey, projectKey, key, false);
		// Only JSON-format skeletons carry the custom `event.fx` field (a binary `.skel` never does).
		if (descriptor && descriptor.format === 'json') {
			const text = await getObjectText(descriptor.skeletonKey);
			if (text) animations = fxTimelineFromSkeleton(JSON.parse(text));
		}
	} catch (e) {
		console.error('[editor/rig-fx] resolve failed', key, e);
		return json({ found: false, animations: {} });
	}

	return json({ found: true, animations });
};
