import { projectPrefix } from './projectPaths';
import { copyObject, deleteObjects, getObjectText, headObject, listAllObjects } from './r2';

/**
 * The Rigger's `.irig` document — its save-time structural check and its ROLLING BACKUPS.
 *
 * `/api/rigger/save` overwrites `<spines>/<dir>/<stem>.irig` in place, and R2 object versioning
 * is not enabled on the bucket, so before this module a save was the last word: a bad edit, a
 * wrong rig saved over the right one, or an accepted "overwrite theirs" left nothing to go back
 * to. The design mirrors `docBackups.ts` (read it for the full argument); the points that
 * carry over unchanged:
 *
 *  - The copy is taken BEFORE the PUT (afterwards there are no previous bytes left to copy).
 *  - The key is derived from the clock + the ETag of the bytes being copied — never recomputed
 *    from what backups already exist — so a lost CAS leaves an inert orphan, not a key every
 *    later save collides with. Backup writes carry no precondition.
 *  - `headObject` returns null ONLY for a genuine 404 and rethrows anything else, so "the read
 *    failed" can never pass for "there is nothing to back up".
 *  - Retention is pruned AFTER a successful PUT, best-effort.
 *
 * What differs: a Rigger save is an explicit click (plus the text panel's save-before-bake), not
 * a 1.2 s autosave, so there is no coalescing window — every overwrite is backed up. Backups
 * live OUTSIDE `spines/`: the skeleton scan indexes every `.json`/`.irig` under that prefix and
 * would list them as rigs.
 */

/** Backups kept per rig. A rig is tens to a few hundred KB, so the ceiling is a few MB. */
export const IRIG_BACKUP_KEEP = 20;

/** `irig-<YYYYMMDDTHHMMSSmmmZ>-<8 hex of the preserved ETag | noetag>` — sorts chronologically. */
export const IRIG_BACKUP_ID_RE = /^irig-(\d{8}T\d{9}Z)-(?:[0-9a-f]{8}|noetag)$/;

export interface IrigBackup {
	/** Opaque handle a client passes back to restore. */
	id: string;
	/** When the preserved bytes were the live `.irig` (ISO 8601). */
	savedAt: string;
	size: number;
}

/**
 * `<client>/<project>/rigger-backups/<dir as base64url | _root>/<stem>/`. The dir is re-encoded
 * so an arbitrary bundle path becomes ONE safe key segment and two bundles can never share a
 * backup folder.
 */
export function irigBackupsPrefix(
	clientKey: string,
	projectKey: string,
	dir: string,
	stem: string,
): string {
	const dirSeg = dir ? Buffer.from(dir, 'utf8').toString('base64url') : '_root';
	return `${projectPrefix(clientKey, projectKey)}/rigger-backups/${dirSeg}/${stem}/`;
}

export function irigBackupId(at: Date, etag: string | null): string {
	const stamp = at.toISOString().replace(/[-:.]/g, '');
	const hex = (etag ?? '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
	return `irig-${stamp}-${hex ? hex.slice(0, 8).padEnd(8, '0') : 'noetag'}`;
}

export function irigBackupSavedAt(id: string): string | null {
	const m = IRIG_BACKUP_ID_RE.exec(id);
	if (!m) return null;
	const s = m[1];
	const time = `${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}`;
	return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${time}Z`;
}

/**
 * Copy the current `.irig` at `irigKey` aside. Returns the backup id, or null when there is
 * provably nothing to preserve (a create) or the write that follows is already doomed. MUST be
 * awaited before the PUT; throws what R2 throws.
 *
 * `baseEtag` is the precondition the PUT will carry. When the stored object already fails it, the
 * PUT will 409 and overwrite nothing, so copying would only add a duplicate of the CURRENT bytes —
 * and retention counts copies, so a run of refused saves would push genuinely older versions out
 * of the history. (The check is a HEAD, so a write racing in between can still slip one duplicate
 * through; that is the harmless direction.)
 */
export async function backupIrigBeforeOverwrite(
	irigKey: string,
	backupsPrefix: string,
	baseEtag: string | null | undefined,
	now = new Date(),
): Promise<string | null> {
	const head = await headObject(irigKey);
	if (!head) return null;
	if (baseEtag === null || (baseEtag !== undefined && head.etag !== baseEtag)) return null;
	const id = irigBackupId(now, head.etag);
	const copied = await copyObject(irigKey, `${backupsPrefix}${id}.json`, 'application/json');
	return copied ? id : null;
}

/** Newest-first backups of one rig. */
export async function listIrigBackups(backupsPrefix: string): Promise<IrigBackup[]> {
	const objects = await listAllObjects(backupsPrefix);
	const out: IrigBackup[] = [];
	for (const obj of objects) {
		const id = obj.key.slice(backupsPrefix.length).replace(/\.json$/, '');
		const savedAt = irigBackupSavedAt(id);
		if (savedAt) out.push({ id, savedAt, size: obj.size });
	}
	out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
	return out;
}

/** One backup's text, or null when the id is malformed or the object is gone. */
export async function readIrigBackup(backupsPrefix: string, id: string): Promise<string | null> {
	if (!IRIG_BACKUP_ID_RE.test(id)) return null;
	return getObjectText(`${backupsPrefix}${id}.json`);
}

/** Drop everything past the newest {@link IRIG_BACKUP_KEEP}. Call only after the PUT landed. */
export async function pruneIrigBackups(backupsPrefix: string): Promise<string[]> {
	const stale = (await listIrigBackups(backupsPrefix)).slice(IRIG_BACKUP_KEEP);
	if (stale.length === 0) return [];
	await deleteObjects(stale.map((b) => `${backupsPrefix}${b.id}.json`));
	return stale.map((b) => b.id);
}

/**
 * Why `doc` would not load as a Spine 4.2 skeleton, or null when it would.
 *
 * Mirrors the references `SkeletonJson.readSkeletonData` resolves by NAME and throws on when one
 * is missing — a parent bone, a slot's bone, a constraint's bones/target, a skin's slot, a linked
 * mesh's skin and parent, an animation's bone/slot and the skin/slot/attachment its deform and
 * sequence keys name — and, for those last two, that the attachment found is one the loader can
 * read (a mesh parent, vertices to deform, a declared sequence). A doc that fails any of them opens
 * as "Load failed" in the Rigger and blanks the rig in every game that binds it. It deliberately
 * does NOT validate field values: the client re-parses through the real loader before posting, and
 * a stricter schema here would refuse documents a newer Rigger wrote.
 */
export function irigDocProblem(doc: unknown): string | null {
	if (!isRecord(doc)) return 'the skeleton is not a JSON object';
	if (doc.skeleton !== undefined && !isRecord(doc.skeleton)) return '"skeleton" is not an object';
	if (!Array.isArray(doc.bones) || doc.bones.length === 0) return 'the skeleton has no bones';

	const bones = new Set<string>();
	for (const [i, b] of doc.bones.entries()) {
		if (!isRecord(b) || typeof b.name !== 'string' || !b.name) return `bone #${i} has no name`;
		if (bones.has(b.name)) return `two bones are named "${b.name}"`;
		if (b.parent != null) {
			if (typeof b.parent !== 'string') return `bone "${b.name}" has a malformed parent`;
			if (!bones.has(b.parent)) {
				return `bone "${b.name}" names parent "${b.parent}", which is not defined before it`;
			}
		}
		bones.add(b.name);
	}

	const slots = new Set<string>();
	if (doc.slots !== undefined) {
		if (!Array.isArray(doc.slots)) return '"slots" is not a list';
		for (const [i, s] of doc.slots.entries()) {
			if (!isRecord(s) || typeof s.name !== 'string' || !s.name) return `slot #${i} has no name`;
			if (slots.has(s.name)) return `two slots are named "${s.name}"`;
			if (typeof s.bone !== 'string' || !bones.has(s.bone)) {
				return `slot "${s.name}" is on bone "${String(s.bone)}", which does not exist`;
			}
			slots.add(s.name);
		}
	}

	for (const kind of ['ik', 'transform', 'path', 'physics'] as const) {
		const list = doc[kind];
		if (list === undefined) continue;
		if (!Array.isArray(list)) return `"${kind}" is not a list`;
		for (const [i, c] of list.entries()) {
			if (!isRecord(c) || typeof c.name !== 'string') return `${kind} constraint #${i} has no name`;
			if (kind !== 'physics' && !Array.isArray(c.bones)) {
				return `${kind} constraint "${c.name}" has no bones list`;
			}
			const refs = kind === 'physics' ? [c.bone] : (c.bones as unknown[]);
			for (const r of refs) {
				if (typeof r !== 'string' || !bones.has(r)) {
					return `${kind} constraint "${c.name}" names bone "${String(r)}", which does not exist`;
				}
			}
			if (kind === 'path' && (typeof c.target !== 'string' || !slots.has(c.target))) {
				return `path constraint "${c.name}" targets slot "${String(c.target)}", which does not exist`;
			}
			if (
				(kind === 'ik' || kind === 'transform') &&
				(typeof c.target !== 'string' || !bones.has(c.target))
			) {
				return `${kind} constraint "${c.name}" targets bone "${String(c.target)}", which does not exist`;
			}
		}
	}

	// SkeletonJson looks a skin up by name as the FIRST one with it, but its default skin is the
	// LAST one named "default" (each reassigns it).
	const skins: Skin[] = [];
	const findSkin = (name: string) => skins.find((s) => s.name === name);
	let defaultSkin: Skin | undefined;
	if (doc.skins !== undefined) {
		if (!Array.isArray(doc.skins)) return '"skins" is not a list (Spine 4.x writes an array)';
		for (const [i, sk] of doc.skins.entries()) {
			if (!isRecord(sk) || typeof sk.name !== 'string' || !sk.name) return `skin #${i} has no name`;
			const attachments = sk.attachments === undefined ? {} : sk.attachments;
			if (!isRecord(attachments)) return `skin "${sk.name}" has malformed attachments`;
			for (const slotName of Object.keys(attachments)) {
				if (!slots.has(slotName)) {
					return `skin "${sk.name}" has attachments for slot "${slotName}", which does not exist`;
				}
			}
			const skin = { name: sk.name, attachments };
			skins.push(skin);
			if (skin.name === 'default') defaultSkin = skin;
		}
	}

	// A linked mesh's parent is found by name on the linked mesh's OWN slot, in the skin its `skin`
	// names — an absent (or empty) one means the default skin, not the skin the linked mesh sits in.
	for (const sk of skins) {
		for (const [slotName, entries] of Object.entries(sk.attachments)) {
			if (!isRecord(entries)) continue;
			for (const [name, a] of Object.entries(entries)) {
				if (!isRecord(a) || !isMeshType(a.type) || !a.parent) continue;
				const where = `linked mesh "${name}" (skin "${sk.name}", slot "${slotName}")`;
				const parentName = a.parent;
				const skinName = a.skin || null;
				if (typeof parentName !== 'string') return `${where} has a malformed parent`;
				if (skinName !== null && typeof skinName !== 'string') {
					return `${where} has a malformed skin`;
				}
				const parentSkin = skinName === null ? defaultSkin : findSkin(skinName);
				if (!parentSkin) {
					return skinName === null
						? `${where} names no skin, so its parent is looked up in skin "default", which does not exist`
						: `${where} names skin "${skinName}" for its parent, which does not exist`;
				}
				const parent = skinAttachment(parentSkin, slotName, parentName);
				if (!parent) {
					return `${where} names parent "${parentName}", which skin "${parentSkin.name}" does not have on that slot`;
				}
				const type = attachmentType(parent);
				if (!isMeshType(type)) {
					return `${where} names parent "${parentName}", which is a ${type}, not a mesh`;
				}
			}
		}
	}

	if (doc.animations !== undefined) {
		if (!isRecord(doc.animations)) return '"animations" is not an object';
		for (const [name, anim] of Object.entries(doc.animations)) {
			if (!isRecord(anim)) return `animation "${name}" is not an object`;
			if (isRecord(anim.bones)) {
				for (const b of Object.keys(anim.bones)) {
					if (!bones.has(b)) return `animation "${name}" keys bone "${b}", which does not exist`;
				}
			}
			if (isRecord(anim.slots)) {
				for (const s of Object.keys(anim.slots)) {
					if (!slots.has(s)) return `animation "${name}" keys slot "${s}", which does not exist`;
				}
			}
			if (isRecord(anim.attachments)) {
				for (const [skinName, bySlot] of Object.entries(anim.attachments)) {
					const skin = findSkin(skinName);
					if (!skin) {
						return `animation "${name}" keys attachments in skin "${skinName}", which does not exist`;
					}
					if (!isRecord(bySlot)) continue;
					for (const [slotName, byName] of Object.entries(bySlot)) {
						if (!slots.has(slotName)) {
							return `animation "${name}" keys attachments on slot "${slotName}", which does not exist`;
						}
						if (!isRecord(byName)) continue;
						for (const [attachment, timelines] of Object.entries(byName)) {
							const reads = timelinesReading(timelines);
							if (reads.length === 0) continue;
							const where = `animation "${name}" keys attachment "${attachment}" on slot "${slotName}"`;
							const target = skinAttachment(skin, slotName, attachment);
							if (!target) return `${where}, which skin "${skinName}" does not have`;
							const type = attachmentType(target);
							if (reads.includes('deform') && !VERTEX_TYPES.has(type)) {
								return `${where} with deform keys, but it is a ${type}, which has no vertices`;
							}
							if (
								reads.includes('sequence') &&
								(target.sequence == null || !(type === 'region' || isMeshType(type)))
							) {
								return `${where} with sequence keys, but it has no sequence`;
							}
						}
					}
				}
			}
		}
	}
	return null;
}

interface Skin {
	name: string;
	/** Slot name → attachment name → attachment. */
	attachments: Record<string, unknown>;
}

/** What `Skin.getAttachment` finds under `name` on `slot`. */
function skinAttachment(
	skin: Skin,
	slot: string,
	name: string,
): Record<string, unknown> | undefined {
	const entries = Object.hasOwn(skin.attachments, slot) ? skin.attachments[slot] : undefined;
	if (!isRecord(entries) || !Object.hasOwn(entries, name)) return undefined;
	const a = entries[name];
	return isRecord(a) ? a : undefined;
}

/**
 * An attachment's type as SkeletonJson reads it: only an ABSENT `type` defaults to region, and an
 * entry of any type it does not know (`null` included) is skipped, so nothing finds it.
 */
function attachmentType(a: Record<string, unknown>): string {
	return a.type === undefined ? 'region' : String(a.type);
}

/** A mesh, linked or not — SkeletonJson reads a `parent` on either type as a linked mesh. */
function isMeshType(type: unknown): boolean {
	return type === 'mesh' || type === 'linkedmesh';
}

/** The attachment types a deform key can offset: Spine's `VertexAttachment`s. */
const VERTEX_TYPES = new Set(['mesh', 'linkedmesh', 'boundingbox', 'path', 'point', 'clipping']);

/**
 * The timelines in an animation's keys for one attachment that make SkeletonJson read the
 * attachment: a deform or sequence timeline, and only one whose first key is present.
 */
function timelinesReading(timelines: unknown): ('deform' | 'sequence')[] {
	if (!isRecord(timelines)) return [];
	return (['deform', 'sequence'] as const).filter((t) => {
		const keys = timelines[t];
		return Array.isArray(keys) && Boolean(keys[0]);
	});
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
