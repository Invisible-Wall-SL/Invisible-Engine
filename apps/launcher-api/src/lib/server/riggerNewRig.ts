import { error } from '@sveltejs/kit';
import { r2Slug, sharedRigKey } from './projectPaths';
import { getObjectText } from './r2';

/** The minimal blank skeleton both `new` and `upload` write when no rig is applied. */
function blankSkeleton(): Record<string, unknown> {
	return {
		skeleton: { spine: '4.2' },
		bones: [{ name: 'root' }],
		slots: [],
		skins: [{ name: 'default', attachments: {} }],
		animations: {},
	};
}

/**
 * Resolve the `.irig` body to write when creating a new rig. When `rigId` is empty the
 * result is a blank skeleton (existing behavior, unchanged). When supplied it is the
 * deep-cloned `skeleton` of the saved library rig at `_shared/rigs/<id>.json`, with its
 * Spine version forced to 4.2. The applied skeleton's attachment region names are NOT
 * remapped to the new atlas — they intentionally stay as authored and won't resolve
 * until the user re-attaches the new object's art (documented behavior); the bones,
 * animations, and constraints come over intact. Throws 404 when the rig is missing.
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
	const cloned = JSON.parse(JSON.stringify(skel)) as Record<string, unknown>;
	const skelBlock = (cloned.skeleton ?? {}) as Record<string, unknown>;
	cloned.skeleton = { ...skelBlock, spine: '4.2' };
	return cloned;
}
