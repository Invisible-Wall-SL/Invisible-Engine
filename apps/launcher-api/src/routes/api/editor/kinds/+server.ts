import { json } from '@sveltejs/kit';
import { requireEditorAccess } from '$lib/server/editorAccess';
import { listKinds } from '$lib/server/kindStorage';
import type { RequestHandler } from './$types';

/**
 * List every author-created custom kind's `{ id, name }` for the picker (§21.3). Custom kinds are
 * GLOBAL (§21.2), so the gate is the `editor` tool alone, with no project scope.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireEditorAccess(locals);
	return json(await listKinds());
};
