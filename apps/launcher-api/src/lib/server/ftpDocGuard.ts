import { error } from '@sveltejs/kit';
import { AuthoredOverlayLockedError } from './authoredOverlayGuard';
import { assertRawEditorDocWriteUnlocked, isEditorDocKey } from './editorStorage';
import { getObjectText } from './r2';

/**
 * The file browser writes R2 keys raw, past `saveDoc`, so a layout doc uploaded or moved over a
 * project's `editor/scenes.json` meets the authored-overlay lock here: a 403 when the bytes would
 * switch a locked pilot on. Any other key is not read or decoded.
 */
async function refuse(check: () => Promise<void>): Promise<void> {
	try {
		await check();
	} catch (e) {
		if (e instanceof AuthoredOverlayLockedError) throw error(403, e.message);
		throw e;
	}
}

/** An upload of `bytes` to `key`. */
export async function lockedOverlayRefusal(key: string, bytes: Uint8Array): Promise<void> {
	if (!isEditorDocKey(key)) return;
	await refuse(() => assertRawEditorDocWriteUnlocked(key, new TextDecoder().decode(bytes)));
}

/** A move of `from` to `to`: the bytes are the source's; a new destination keeps the source's state. */
export async function lockedOverlayMoveRefusal(from: string, to: string): Promise<void> {
	if (!isEditorDocKey(to)) return;
	const text = await getObjectText(from);
	if (text !== null) await refuse(() => assertRawEditorDocWriteUnlocked(to, text, text));
}
