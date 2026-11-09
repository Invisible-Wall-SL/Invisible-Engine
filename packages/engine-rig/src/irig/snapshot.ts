import {
	BoundingBoxAttachment,
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	PointAttachment,
	RegionAttachment,
} from '../attachments';
import type { AttachmentLoader } from '../atlas';
import { SkeletonJson } from '../skeletonJson';

/** Builds every attachment without an atlas, so a skeleton reads with no art. */
const stubLoader: AttachmentLoader = {
	newRegionAttachment: (_skin, name, path) => new RegionAttachment(name, path),
	newMeshAttachment: (_skin, name, path) => new MeshAttachment(name, path),
	newBoundingBoxAttachment: (_skin, name) => new BoundingBoxAttachment(name),
	newPathAttachment: (_skin, name) => new PathAttachment(name),
	newPointAttachment: (_skin, name) => new PointAttachment(name),
	newClippingAttachment: (_skin, name) => new ClippingAttachment(name),
};

/**
 * Everything the runtime builds from a skeleton (4.2 or irig), as text: two skeletons with equal
 * snapshots read into the same `SkeletonData`, so they pose and fire events the same, because the
 * same runtime animates both. Throws what the reader throws.
 *
 * Built in build order; a repeated object prints as a back-reference. A vertex attachment's `id` is
 * a process-wide counter, so it differs between any two reads: it is left out, and where a
 * timeline's property id embeds it (`28|slot|id`), it is renumbered in order of first appearance.
 */
export function skeletonDataSnapshot(json: object | string): string {
	const input = typeof json === 'string' ? json : structuredClone(json);
	const data = new SkeletonJson(stubLoader).readSkeletonData(input);
	const seen = new Map<object, number>();
	const ids = new Map<string, number>();
	return JSON.stringify(data, (key, value: unknown) => {
		if (key === 'id' && typeof value === 'number') return undefined;
		if (key === 'propertyIds' && Array.isArray(value))
			return value.map((p: string) => {
				const [kind, slot, id] = p.split('|');
				if (id === undefined) return p;
				if (!ids.has(id)) ids.set(id, ids.size);
				return `${kind}|${slot}|@${ids.get(id)}`;
			});
		if (!value || typeof value !== 'object') return value;
		if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
		const id = seen.get(value);
		if (id !== undefined) return `#${id}`;
		seen.set(value, seen.size);
		if (value instanceof Map) return [...value.entries()];
		return value;
	});
}
