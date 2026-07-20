import { error } from '@sveltejs/kit';
import { clipsToAnimationPlist, serializeAnimationPlist } from 'engine-flipbook';
import { loadFlipbookDoc } from '$lib/server/flipbookStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Download the project's clips as a cocos2d **animation plist** (design doc
 * `invisible-flipbook.md`). The counterpart of the page's import: clips are authored here, but
 * the animation plist is a format this project SHIPS, so it has to travel out as well as in.
 *
 * The emitted file stays loadable by a stock cocos2d `AnimationCache` — standard keys with the
 * types it requires, our `iw*` extensions only where it ignores them. `clipToAnimation` writes
 * frame names BARE because cocos resolves them from one global sprite-frame cache; the per-frame
 * sheet mapping a multipacked clip needs rides in `iwFrameSheets` so OUR re-import keeps it.
 *
 * A GET (not POST): it is a pure read that produces a file, so it can be a plain link.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
	});

	const doc = await loadFlipbookDoc(clientKey, projectKey);
	if (doc.clips.length === 0) {
		throw error(404, 'This project has no clips to export yet.');
	}

	// `spritesheets` lists the sheet plists a cocos runtime must load before these animations
	// resolve. We name every sheet the clips touch, converted from our manifest keys to the
	// `.plist` filenames a cocos project would actually ship.
	const sheets = new Set<string>();
	for (const clip of doc.clips) {
		if (clip.assetKey) sheets.add(clip.assetKey);
		for (const frame of clip.frames) {
			const at = frame.indexOf('::');
			if (at > 0) sheets.add(frame.slice(0, at));
		}
	}
	const spritesheets = [...sheets].map((key) => {
		const base = key.split('/').pop() ?? key;
		return `${base.replace(/^atlas_manifest_/, '').replace(/\.json$/i, '')}.plist`;
	});

	const xml = serializeAnimationPlist(clipsToAnimationPlist(doc.clips, spritesheets));
	return new Response(xml, {
		headers: {
			'content-type': 'application/x-plist; charset=utf-8',
			'content-disposition': `attachment; filename="${projectKey}-animations.plist"`,
			'cache-control': 'no-store',
		},
	});
};
