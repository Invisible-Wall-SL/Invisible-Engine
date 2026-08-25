import { json } from '@sveltejs/kit';
import { loadFlipbookDoc } from '$lib/server/flipbookStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the project's authored Invisible Flipbook clips so the Scene Editor's Library can drop a
 * `flipbook` node that references one, the Properties panel can re-target it, and the 2D canvas can
 * PLAY it in place. The sibling of `/api/editor/effects` (the Effects section's list).
 *
 * Returns the FULL clips — frame lists included — not `listClips`' lightweight rows. The canvas
 * draws the ordered frames itself (each is an atlas region it already knows how to resolve), so a
 * frame count alone would leave a placed clip as a chip. The payload is tiny: a clip is a name list
 * plus two numbers, which is also why the export ships every clip rather than pruning.
 *
 * Deliberately `loadFlipbookDoc`, NOT a raw read: it runs the same atlas-ref repair the ship path
 * runs, so a clip stored with a bare manifest basename or a Sheet-Maker output prefix resolves
 * against the SAME full manifest key here as it does in the game. Without that the editor would
 * fall back to the flat bare-name cache where every sheet's `frame_0000…` collide — the exact
 * cross-sheet mix-up that made one symbol play another's animation.
 *
 * Gated on `editor` (the Scene + Component editors) with the `flipbook` author as an alt-tool,
 * mirroring how `/api/editor/effects` admits `fx`/`rigger`. Scope bound to the SESSION's project.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['flipbook'],
		forbiddenMessage: 'Your role does not have access to the project flipbook clips.',
	});

	const doc = await loadFlipbookDoc(clientKey, projectKey);
	return json({ clips: doc.clips });
};
