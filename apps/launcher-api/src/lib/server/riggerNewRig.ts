import { error } from '@sveltejs/kit';
import { IRIG_VERSION } from 'engine-rig';
import { r2Slug, sharedRigKey } from './projectPaths';
import { getObjectText } from './r2';
import { asIrigDocument, irigDocProblem } from './riggerIrig';

/** The minimal blank rig both `new` and `upload` write when no rig is applied, as irig v1. */
function blankSkeleton(): Record<string, unknown> {
	return {
		irig: IRIG_VERSION,
		skeleton: {},
		bones: [{ name: 'root' }],
		slots: [],
		skins: [{ name: 'default', attachments: {} }],
		animations: {},
	};
}

/**
 * Resolve the `.irig` body to write when creating a new rig: irig v1 (docs/design/irig-format.md,
 * Phase 3). When `rigId` is empty the result is a blank rig. When supplied it is the deep-cloned
 * `skeleton` of the saved library rig at `_shared/rigs/<id>.json`, imported when it is a 4.2
 * skeleton. An import that would change a value (a wrong type the 4.2 reader coerces) keeps the 4.2
 * skeleton instead, with its Rig version forced to 4.2, so the rig loads as it always has; an import
 * that only drops keys the 4.2 reader ignores changes nothing. The applied skeleton's attachment
 * region names are NOT
 * remapped to the new atlas — they intentionally stay as authored and won't resolve
 * until the user re-attaches the new object's art (documented behavior); the bones,
 * animations, and constraints come over intact. Throws 404 when the rig is missing, and 422
 * when it would not load — a library rig can predate the checks on the library save, and must
 * not become a new `.irig` that opens as "Load failed".
 */
export async function resolveRigSkeletonBody(rigId: string): Promise<Record<string, unknown>> {
	const id = rigId ? r2Slug(rigId) : '';
	if (!id) return blankSkeleton();
	if (id.includes('..') || id.includes('/')) throw error(400, 'bad rigId');

	const raw = await getObjectText(sharedRigKey(id));
	if (raw === null) throw error(404, 'saved rig not found');
	let entry: { skeleton?: unknown };
	try {
		entry = JSON.parse(raw) as { skeleton?: unknown };
	} catch {
		throw error(500, 'saved rig is not valid JSON');
	}
	const skel = entry.skeleton;
	if (!skel || typeof skel !== 'object' || Array.isArray(skel)) {
		throw error(500, 'saved rig has no skeleton');
	}
	const cloned = asIrig(JSON.parse(JSON.stringify(skel)) as Record<string, unknown>);
	const problem = irigDocProblem(cloned);
	if (problem) {
		throw error(422, `The saved rig "${id}" would not load (${problem}), so no rig was created.`);
	}
	return cloned;
}

function asIrig(skel: Record<string, unknown>): Record<string, unknown> {
	const irig = asIrigDocument(skel);
	if (irig) return irig;
	const skelBlock = (skel.skeleton ?? {}) as Record<string, unknown>;
	return { ...skel, skeleton: { ...skelBlock, spine: '4.2' } };
}
