import { json } from '@sveltejs/kit';
import { listAllComponents } from '$lib/server/componentStorage';
import { requireEditorAccess } from '$lib/server/editorAccess';
import type { RequestHandler } from './$types';

/**
 * Every authored component across ALL projects + the shared library, each tagged
 * with its project key. Powers the Storybook "Authored Components" gallery (served
 * same-origin from the launcher, so the session cookie carries the auth).
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireEditorAccess(locals);
	const components = await listAllComponents();
	return json(components);
};
