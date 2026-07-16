import { error, json } from '@sveltejs/kit';
import { r2Slug, sharedAnimationKey } from '$lib/server/projectPaths';
import { putObjectText } from '$lib/server/r2';
import { saveAnimation } from '$lib/server/riggerLibrary';
import { gate } from '$lib/server/toolScope';
import type { SharedAnimationRefs } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Save one Rigger animation clip to the cross-project library (`_shared/animations/`).
 * The full entry (with the heavy `animation` subtree) is written to
 * `_shared/animations/<id>.json`; a lightweight catalog row is upserted into Postgres.
 * Re-saving the same id OVERWRITES (the client warns first). Gated by `rigger`; the id
 * is path-guarded via `r2Slug`.
 *
 * Body: `{ id?, name, animation, refs?, duration?, sourceRig? }`.
 */
const asStrings = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'missing name');

	const animation = body.animation;
	if (!animation || typeof animation !== 'object' || Array.isArray(animation)) {
		throw error(400, 'body.animation is not an object');
	}

	const id = r2Slug(typeof body.id === 'string' && body.id ? body.id : name);
	if (!id || id.includes('..') || id.includes('/')) throw error(400, 'bad id');

	const refsIn = (body.refs ?? {}) as Record<string, unknown>;
	const refs: SharedAnimationRefs = {
		bones: asStrings(refsIn.bones),
		slots: asStrings(refsIn.slots),
		events: asStrings(refsIn.events),
	};
	const duration = typeof body.duration === 'number' && body.duration >= 0 ? body.duration : 0;
	const sourceRig = typeof body.sourceRig === 'string' && body.sourceRig ? body.sourceRig : null;
	const savedAt = new Date().toISOString();
	const source = { client: clientKey, project: projectKey, rig: sourceRig };

	const entry = { schemaVersion: 1, id, name, savedAt, source, refs, duration, animation };
	// Blob BEFORE row — see the ordering note in `riggerLibrary.ts`.
	await putObjectText(sharedAnimationKey(id), JSON.stringify(entry), 'application/json');
	await saveAnimation({ id, name, savedAt, source, refs, duration });

	return json({ ok: true, id });
};
