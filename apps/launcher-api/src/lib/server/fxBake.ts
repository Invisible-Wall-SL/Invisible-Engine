import { error, json } from '@sveltejs/kit';
import { deleteObjects, listAllKeys } from './r2';
import { fxBakePrefix } from './projectPaths';

/**
 * Server half of BAKED effects (`invisible-fx.md` §"Baked effects"): the request check shared by the
 * two `/api/fx/bake` endpoints, and the pruning Save and Delete run over `fx-bakes/<id>/`.
 */

/** `/fx`'s id for a never-saved effect (`fxModel.client.ts`), which has no folder to bake into. */
const UNTITLED = 'untitled-effect';

/**
 * A saved effect's id and the 8-hex-digit hash its sheet is named by, both checked before any key is
 * built from them, and the save endpoint's scope guard (the tab's project must be the session's).
 */
export function readBakeTarget(
	body: Record<string, unknown> | null,
	projectKey: string,
): { effectId: string; hash: string } | Response {
	if (!body) throw error(400, 'Invalid JSON body.');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return json(
			{
				ok: false,
				error: 'scope-mismatch',
				message:
					`This tab is editing "${body.projectKey}" but your active project is now ` +
					`"${projectKey}". Reload to continue.`,
			},
			{ status: 409 },
		);
	}
	const effectId = typeof body.effectId === 'string' ? body.effectId : '';
	if (!effectId || effectId === UNTITLED) throw error(400, 'Save the effect before baking it.');
	const hash = typeof body.hash === 'string' ? body.hash : '';
	if (!/^[0-9a-f]{8}$/.test(hash)) throw error(400, 'Invalid bake hash.');
	return { effectId, hash };
}

/**
 * Delete every bake of an effect except the one `keep` names (its JSON and the page beside it) — all
 * of them when `keep` is absent. Best-effort: a bake is a cache, so a failed prune costs bytes, never
 * work.
 */
export async function pruneEffectBakes(
	clientKey: string,
	projectKey: string,
	id: string,
	keep?: string,
): Promise<void> {
	const kept = new Set<string>();
	if (keep?.endsWith('.json')) kept.add(keep).add(`${keep.slice(0, -'.json'.length)}.png`);
	try {
		const keys = await listAllKeys(fxBakePrefix(clientKey, projectKey, id));
		await deleteObjects(keys.filter((k) => !kept.has(k)));
	} catch (err) {
		console.warn(`[fx] pruning the bakes of "${id}" failed`, err);
	}
}
