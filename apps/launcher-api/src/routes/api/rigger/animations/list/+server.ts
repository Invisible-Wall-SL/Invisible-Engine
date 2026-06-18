import { json } from '@sveltejs/kit';
import { sharedAnimationsIndexKey } from '$lib/server/projectPaths';
import { getObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the cross-project animation library (`_shared/animations/index.json`). One GET
 * returns the lightweight catalog rows (no heavy `animation` bodies), sorted by name.
 * Empty array when no index exists yet. Gated by `rigger`.
 */
interface AnimRow {
	id: string;
	name: string;
	savedAt?: string;
	source?: { client: string; project: string; rig: string | null };
	refs?: { bones: string[]; slots: string[]; events: string[] };
	duration?: number;
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const raw = await getObjectText(sharedAnimationsIndexKey);
	let animations: AnimRow[] = [];
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as { animations?: AnimRow[] };
			if (parsed && Array.isArray(parsed.animations)) animations = parsed.animations;
		} catch {
			animations = [];
		}
	}
	animations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
	return json({ animations });
};
