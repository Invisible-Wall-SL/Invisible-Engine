import { error } from '@sveltejs/kit';
import { AuthoredOverlayLockedError } from './authoredOverlayGuard';
import { assertRawEditorDocWriteUnlocked, isEditorDocKey } from './editorStorage';
import { getObjectText } from './r2';

/**
 * The file browser writes R2 keys raw, past `saveDoc`, so a layout doc uploaded or moved over a
 * project's `editor/scenes.json` meets the authored-overlay lock here: a 403 when the bytes would
 * switch a locked pilot on. Any other key, or a doc that switches nothing on, passes.
 */
export async function lockedOverlayRefusal(key: string, text: string): Promise<void> {
	try {
		await assertRawEditorDocWriteUnlocked(key, text);
	} catch (e) {
		if (e instanceof AuthoredOverlayLockedError) throw error(403, e.message);
		throw e;
	}
}

/** {@link lockedOverlayRefusal} for a move: the bytes are the source object's. */
export async function lockedOverlayMoveRefusal(from: string, to: string): Promise<void> {
	if (!isEditorDocKey(to)) return;
	const text = await getObjectText(from);
	if (text !== null) await lockedOverlayRefusal(to, text);
}
