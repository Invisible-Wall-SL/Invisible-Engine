import { json } from '@sveltejs/kit';
import { sharedRigsIndexKey } from '$lib/server/projectPaths';
import { getObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the cross-project rig library (`_shared/rigs/index.json`). One GET returns the
 * lightweight catalog rows (no heavy `skeleton` bodies), sorted by name. Empty array
 * when no index exists yet. Gated by `rigger`.
 */
interface RigRow {
	id: string;
	name: string;
	savedAt?: string;
	source?: { client: string; project: string; rig: string | null };
	stats?: { bones: number; slots: number; skins: number; animations: string[] };
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const raw = await getObjectText(sharedRigsIndexKey);
	let rigs: RigRow[] = [];
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as { rigs?: RigRow[] };
			if (parsed && Array.isArray(parsed.rigs)) rigs = parsed.rigs;
		} catch {
			rigs = [];
		}
	}
	rigs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
	return json({ rigs });
};
