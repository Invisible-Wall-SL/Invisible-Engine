/**
 * Renames in an irig document, every reference following, as the Rigger's own rename does (Setup's
 * ✎ on a bone or a slot): 🔄 Update rig moves a sheet rig onto one slot per region with it
 * (docs/design/frame-to-rig.md §13.1h), each slot keeping its keys under its new name. All renames
 * apply at once, so two names may trade places. Pure: the caller checks no two land on one name.
 */

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const CONSTRAINT_KINDS = ['ik', 'transform', 'path', 'physics'] as const;

export interface RigRenames {
	bones?: ReadonlyMap<string, string>;
	slots?: ReadonlyMap<string, string>;
	/** Attachments by the slot they are in (its name before `slots` renames it): old → new. */
	attachments?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** `o` with its keys renamed by `m` (in place of their order: the object is rebuilt). */
function rekeyed(o: Json, m: ReadonlyMap<string, string> | undefined): Json {
	if (!m?.size || !Object.keys(o).some((k) => m.has(k))) return o;
	return Object.fromEntries(Object.entries(o).map(([k, v]) => [m.get(k) ?? k, v]));
}

/** Rename in `doc` (an irig document), in place. */
export function renameInRig(doc: Json, r: RigRenames): void {
	const bone = (n: unknown) => (typeof n === 'string' ? (r.bones?.get(n) ?? n) : n);
	const slot = (n: unknown) => (typeof n === 'string' ? (r.slots?.get(n) ?? n) : n);
	const att = (s: string, n: unknown) =>
		typeof n === 'string' ? (r.attachments?.get(s)?.get(n) ?? n) : n;
	/** Each slot's attachments by the slot's new name. */
	const atts = new Map([...(r.attachments ?? [])].map(([s, m]) => [String(slot(s)), m]));

	for (const b of (doc.bones ?? []) as Json[]) {
		b.name = bone(b.name);
		if (b.parent !== undefined) b.parent = bone(b.parent);
	}
	for (const s of (doc.slots ?? []) as Json[]) {
		const was = String(s.name);
		s.name = slot(s.name);
		s.bone = bone(s.bone);
		if (s.attachment !== undefined) s.attachment = att(was, s.attachment);
	}
	for (const kind of CONSTRAINT_KINDS)
		for (const c of (doc[kind] ?? []) as Json[]) {
			if (Array.isArray(c.bones)) c.bones = c.bones.map(bone);
			if (c.bone !== undefined) c.bone = bone(c.bone);
			if (c.target !== undefined) c.target = kind === 'path' ? slot(c.target) : bone(c.target);
		}
	const skins = (Array.isArray(doc.skins) ? doc.skins : []) as Json[];
	for (const skin of skins) {
		if (Array.isArray(skin.bones)) skin.bones = skin.bones.map(bone);
		if (!isRecord(skin.attachments)) continue;
		const by = rekeyed(skin.attachments, r.slots);
		for (const [s, list] of Object.entries(by)) {
			if (!isRecord(list)) continue;
			const m = atts.get(s);
			by[s] = rekeyed(list, m);
			// A linked mesh names the mesh it follows in its slot.
			if (m)
				for (const a of Object.values(by[s] as Json))
					if (isRecord(a) && typeof a.parent === 'string') a.parent = m.get(a.parent) ?? a.parent;
		}
		skin.attachments = by;
	}
	for (const a of Object.values((doc.animations ?? {}) as Json)) {
		if (!isRecord(a)) continue;
		if (isRecord(a.bones)) a.bones = rekeyed(a.bones, r.bones);
		if (isRecord(a.slots)) {
			a.slots = rekeyed(a.slots, r.slots);
			for (const [s, tls] of Object.entries(a.slots as Json)) {
				const m = atts.get(s);
				if (!m || !isRecord(tls) || !Array.isArray(tls.attachment)) continue;
				for (const k of tls.attachment)
					if (isRecord(k) && k.name !== undefined) k.name = att(s, k.name);
			}
		}
		for (const key of ['attachments', 'deform'] as const) {
			if (!isRecord(a[key])) continue;
			for (const [skinName, bySlot] of Object.entries(a[key] as Json)) {
				if (!isRecord(bySlot)) continue;
				const out = rekeyed(bySlot, r.slots);
				for (const [s, byAtt] of Object.entries(out))
					if (isRecord(byAtt)) out[s] = rekeyed(byAtt, atts.get(s));
				(a[key] as Json)[skinName] = out;
			}
		}
		if (Array.isArray(a.drawOrder))
			for (const k of a.drawOrder)
				if (isRecord(k) && Array.isArray(k.offsets))
					for (const o of k.offsets) if (isRecord(o)) o.slot = slot(o.slot);
	}
}
