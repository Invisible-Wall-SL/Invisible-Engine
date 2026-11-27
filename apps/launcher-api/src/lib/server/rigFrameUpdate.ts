import { createHash } from 'node:crypto';
import type { FrameSourceDoc } from '../rigFrameSource';
import { drawOrderOf, offsetsOf } from '../rigSlotOrder';
import {
	HEAD_TURN_BONES,
	fitTemplate,
	frameWorld,
	type Affine,
	type RigFit,
} from './rigTemplateFit';
import type { RigTemplateControls } from './rigTemplateControls';
import {
	moduleChoiceProblem,
	templateWithModules,
	type RigModuleChoice,
} from './rigTemplateModules';
import {
	templateFitProblem,
	templateRig,
	type RigTemplate,
	type TemplateRegion,
} from './rigTemplates';

/**
 * 🔄 Update rig (docs/design/frame-to-rig.md §12 F2j): the parts a re-edited cut makes, swapped into
 * the rig made from it. Pure (no I/O): the route builds `fresh` (`templateRig` over the new sheet with
 * the new fit, as 🦴 Create rig does) and this merges it into the open rig.
 *
 * What the rig keeps: its skeleton (every bone the author added or moved, at its setup), every
 * animation and key, its constraints, skins, events, draw order and the slots it has beyond the cut's.
 * Every attachment the cut makes is rebuilt and skinned as a new rig's, then bound to the rig's own
 * bones: a weighted vertex names its bone by the bone's place in THIS rig (engine-rig reads the index,
 * so a user bone before it moves it), at the offset the cut gives the art on that bone, so the art sits
 * on its bones as on a new rig and moves with a bone the author moved, as their mesh did. A bone of the
 * new build the rig no longer has hands its share to its nearest ancestor the rig has, at the same
 * place in the build's bind pose. A link the template gained since (`links`: the neck's upper half)
 * is put in where the build has it, on the rig's own line between its parent and its child, every
 * weighted vertex renumbered and every key kept: the bones below it keep their places and poses.
 *
 * A part still made keeps its slot and attachment name, so its keys still apply; a part whose mesh
 * the author edited (its hash is not the one it was made with) is replaced unless listed in `keep`,
 * and its deform keys stay only while the new mesh deforms the same number of values. A new prop gets
 * its bone (appended, so no index the rig's meshes name moves) and its slot (drawn where the build
 * draws it). A prop or part the cut no longer makes is removed with everything that names it — its
 * keys, the constraints it is in, its draw-order keys — and its bone too when nothing else hangs from
 * it or is weighted to it; `references` lists those first, for the page to ask about.
 */

type Json = Record<string, unknown>;
interface Bone extends Json {
	name: string;
	parent?: string;
}
interface Slot extends Json {
	name: string;
	bone: string;
	attachment?: string;
}
interface Skin extends Json {
	name: string;
	attachments?: Record<string, Record<string, Json>>;
}
interface Doc extends Json {
	bones: Bone[];
	slots?: Slot[];
	skins?: Skin[];
	animations?: Record<string, Json>;
}

const isRecord = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const CONSTRAINT_KINDS = ['ik', 'transform', 'path', 'physics'] as const;
type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];
const KIND_WORD: Record<ConstraintKind, string> = {
	ik: 'IK',
	transform: 'transform',
	path: 'path',
	physics: 'physics',
};

// ---- an attachment's vertices ------------------------------------------------------------------

/** How many vertices an attachment has (a mesh by its UVs; a path, a clip or a box by `vertexCount`). */
function vertexCount(att: Json): number | null {
	if (Array.isArray(att.uvs)) return att.uvs.length / 2;
	return typeof att.vertexCount === 'number' ? att.vertexCount : null;
}

/** Its vertices as bone influences `[bone, x, y, weight]` per vertex, or null when unweighted. */
function influences(att: Json): [number, number, number, number][][] | null {
	const n = vertexCount(att);
	const v = att.vertices;
	if (n === null || !Array.isArray(v) || v.length <= n * 2) return null;
	const out: [number, number, number, number][][] = [];
	for (let i = 0; i < v.length;) {
		const k = v[i++] as number;
		const one: [number, number, number, number][] = [];
		for (let j = 0; j < k; j++, i += 4)
			one.push([v[i] as number, v[i + 1] as number, v[i + 2] as number, v[i + 3] as number]);
		out.push(one);
	}
	return out;
}

const flatten = (inf: [number, number, number, number][][]): number[] =>
	inf.flatMap((one) => [one.length, ...one.flat()]);

/** The values a deform key of `att` carries: two per influence when weighted, two per vertex else. */
function deformLength(att: Json): number | null {
	const inf = influences(att);
	if (inf) return inf.reduce((s, one) => s + one.length * 2, 0);
	const n = vertexCount(att);
	return n === null ? null : n * 2;
}

/** Every attachment of every skin, with where it is. */
function* attachmentsOf(
	doc: Doc,
): Generator<{ skin: Skin; slot: string; name: string; att: Json }> {
	for (const skin of doc.skins ?? [])
		for (const [slot, byName] of Object.entries(skin.attachments ?? {}))
			for (const [name, att] of Object.entries(byName))
				if (isRecord(att)) yield { skin, slot, name, att };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
function stable(v: unknown): string {
	if (typeof v === 'number') return String(round4(v));
	if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
	if (isRecord(v))
		return `{${Object.keys(v)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
			.join(',')}}`;
	return JSON.stringify(v);
}

/**
 * A hash of an attachment's shape: its geometry and, when weighted, its bones BY NAME (`boneNames`
 * is the rig's bone list), so a bone added before them, which renumbers them, is not an edit; the
 * image it names (`path`) and its tint are not its shape either.
 */
export function attachmentHash(att: Json, boneNames: readonly string[]): string {
	const shape: Json = {};
	for (const [k, v] of Object.entries(att)) if (k !== 'path' && k !== 'color') shape[k] = v;
	const inf = influences(att);
	if (inf) shape.vertices = inf.map((one) => one.map(([b, x, y, w]) => [boneNames[b], x, y, w]));
	return createHash('sha256').update(stable(shape)).digest('hex').slice(0, 24);
}

/** The attachments a build made, every one of its skins' (a fresh build has one, `default`). */
export function madeAttachments(fresh: Json): { slot: string; name: string; att: Json }[] {
	return [...attachmentsOf(fresh as Doc)].map(({ slot, name, att }) => ({ slot, name, att }));
}

// ---- bones by place ------------------------------------------------------------------------------

/**
 * Put the rig's bones in `order` (names; a bone left out is removed), renumbering every weighted
 * vertex of every skin to match. A vertex weighted to a removed bone is the caller's to have moved.
 */
function reorderBones(doc: Doc, order: readonly string[]): void {
	const was = new Map(doc.bones.map((b, i) => [b.name, i]));
	const byName = new Map(doc.bones.map((b) => [b.name, b]));
	const to = new Map(order.map((n, i) => [was.get(n)!, i]));
	doc.bones = order.map((n) => byName.get(n)!);
	for (const { att } of attachmentsOf(doc)) {
		const inf = influences(att);
		if (!inf) continue;
		att.vertices = flatten(inf.map((one) => one.map(([b, x, y, w]) => [to.get(b)!, x, y, w])));
	}
}

const mul = (p: Affine, l: Affine): Affine => [
	p[0] * l[0] + p[1] * l[2],
	p[0] * l[1] + p[1] * l[3],
	p[2] * l[0] + p[3] * l[2],
	p[2] * l[1] + p[3] * l[3],
	p[0] * l[4] + p[1] * l[5] + p[4],
	p[2] * l[4] + p[3] * l[5] + p[5],
];
const apply = (m: Affine, x: number, y: number): [number, number] => [
	m[0] * x + m[1] * y + m[4],
	m[2] * x + m[3] * y + m[5],
];
function invert(m: Affine): Affine {
	const det = m[0] * m[3] - m[1] * m[2];
	const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
	return [a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5])];
}

/** Each bone's setup world transform (no shear, inherited whole, as a template's bones are). */
export function setupWorld(bones: readonly Bone[]): Map<string, Affine> {
	const out = new Map<string, Affine>();
	const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
	for (const b of bones) {
		const r = (num(b.rotation, 0) * Math.PI) / 180;
		const [sx, sy] = [num(b.scaleX, 1), num(b.scaleY, 1)];
		const l: Affine = [
			Math.cos(r) * sx,
			-Math.sin(r) * sy,
			Math.sin(r) * sx,
			Math.cos(r) * sy,
			num(b.x, 0),
			num(b.y, 0),
		];
		const p = b.parent === undefined ? undefined : out.get(b.parent);
		out.set(b.name, p ? mul(p, l) : l);
	}
	return out;
}

// ---- what names a bone, a slot or an attachment ---------------------------------------------------

/** A thing the cut made that an update removes: a prop's bone and slot, or a part's attachment. */
export interface Removal {
	name: string;
	kind: 'prop' | 'part';
	slot: string;
	/** The prop's own bone, when it has one. */
	bone?: string;
}

const count = (v: unknown): number =>
	Array.isArray(v)
		? v.length
		: isRecord(v)
			? Object.values(v).reduce((s: number, x) => s + count(x), 0)
			: 0;

/** What in the rig names `r` — its keys, constraints, draw-order keys, bones hung from it, meshes weighted to it. */
export function references(doc: Doc, r: Removal): string[] {
	const out: string[] = [];
	const boneIdx = r.bone === undefined ? -1 : doc.bones.findIndex((b) => b.name === r.bone);
	for (const [anim, a] of Object.entries(doc.animations ?? {})) {
		if (!isRecord(a)) continue;
		const bones = isRecord(a.bones) ? a.bones : {};
		const slots = isRecord(a.slots) ? a.slots : {};
		if (r.kind === 'prop') {
			if (r.bone !== undefined && bones[r.bone])
				out.push(`“${anim}”: ${count(bones[r.bone])} keys on its bone`);
			if (slots[r.slot]) out.push(`“${anim}”: ${count(slots[r.slot])} keys on its slot`);
			const order = Array.isArray(a.drawOrder) ? a.drawOrder : [];
			const moved = order.filter(
				(k) =>
					isRecord(k) &&
					Array.isArray(k.offsets) &&
					k.offsets.some((o) => isRecord(o) && o.slot === r.slot),
			).length;
			if (moved) out.push(`“${anim}”: ${moved} draw-order keys move it`);
		} else {
			const shown = isRecord(slots[r.slot]) ? (slots[r.slot] as Json).attachment : undefined;
			const n = Array.isArray(shown)
				? shown.filter((k) => isRecord(k) && k.name === r.name).length
				: 0;
			if (n) out.push(`“${anim}”: ${n} keys show it`);
		}
		const deform = deformKeys(a, r.slot, r.name);
		if (deform) out.push(`“${anim}”: ${deform} deform keys on it`);
	}
	if (r.bone !== undefined) {
		for (const kind of CONSTRAINT_KINDS)
			for (const c of (doc[kind] as Json[] | undefined) ?? [])
				if (constraintNames(c, r.bone, r.slot))
					out.push(`${KIND_WORD[kind]} constraint “${String(c.name)}”`);
		for (const b of doc.bones) if (b.parent === r.bone) out.push(`bone “${b.name}” hangs from it`);
		for (const { slot, name, att } of attachmentsOf(doc))
			if (slot !== r.slot && influences(att)?.some((one) => one.some(([b]) => b === boneIdx)))
				out.push(`the mesh “${name}” is weighted to it`);
		for (const s of doc.slots ?? [])
			if (s.bone === r.bone && s.name !== r.slot) out.push(`slot “${s.name}” is on its bone`);
	}
	return out;
}

function deformKeys(a: Json, slot: string, name: string): number {
	const by = isRecord(a.attachments) ? a.attachments : isRecord(a.deform) ? a.deform : {};
	let n = 0;
	for (const skin of Object.values(by)) {
		const tl = isRecord(skin) && isRecord(skin[slot]) ? (skin[slot] as Json)[name] : undefined;
		if (!isRecord(tl)) continue;
		n += Array.isArray(tl.deform) ? tl.deform.length : count(tl);
	}
	return n;
}

/** Does a constraint name the bone (or, for a path, the slot)? */
function constraintNames(c: Json, bone: string, slot: string): boolean {
	return (
		c.target === bone ||
		c.bone === bone ||
		c.target === slot ||
		(Array.isArray(c.bones) && c.bones.includes(bone))
	);
}

/**
 * Remove `r` and everything that names it. Its bone goes too unless something else hangs from it, is
 * weighted to it or rides it (then it stays and the answer says so).
 */
function remove(doc: Doc, r: Removal): { keptBone: boolean } {
	const anims = Object.values(doc.animations ?? {}).filter(isRecord);
	for (const skin of doc.skins ?? []) {
		const by = skin.attachments?.[r.slot];
		if (!by) continue;
		delete by[r.name];
		if (r.kind === 'prop' || !Object.keys(by).length) delete skin.attachments![r.slot];
	}
	for (const a of anims) {
		for (const key of ['attachments', 'deform'] as const) {
			const by = a[key];
			if (!isRecord(by)) continue;
			for (const skin of Object.values(by)) {
				if (!isRecord(skin) || !isRecord(skin[r.slot])) continue;
				const tl = skin[r.slot] as Json;
				if (r.kind === 'prop') delete skin[r.slot];
				else delete tl[r.name];
				if (isRecord(skin[r.slot]) && !Object.keys(skin[r.slot] as Json).length)
					delete skin[r.slot];
			}
		}
		const slots = isRecord(a.slots) ? a.slots : null;
		if (slots && r.kind === 'prop') delete slots[r.slot];
		else if (slots && isRecord(slots[r.slot])) {
			const tl = slots[r.slot] as Json;
			if (Array.isArray(tl.attachment))
				tl.attachment = tl.attachment.filter((k) => !(isRecord(k) && k.name === r.name));
			if (Array.isArray(tl.attachment) && !tl.attachment.length) delete tl.attachment;
			if (!Object.keys(tl).length) delete slots[r.slot];
		}
	}
	if (r.kind === 'part') {
		const slot = doc.slots?.find((s) => s.name === r.slot);
		if (slot && slot.attachment === r.name) delete slot.attachment;
		return { keptBone: false };
	}
	// A prop: its slot (its draw-order keys are written again after the update, `keepDrawOrders`), its
	// constraints, then its bone if nothing needs it.
	doc.slots = (doc.slots ?? []).filter((s) => s.name !== r.slot);
	if (r.bone === undefined) return { keptBone: false };
	const bone = r.bone;
	const gone = new Map<ConstraintKind, Set<string>>();
	for (const kind of CONSTRAINT_KINDS) {
		const list = (doc[kind] as Json[] | undefined) ?? [];
		const kept: Json[] = [];
		for (const c of list) {
			if (c.target === bone || c.bone === bone || c.target === r.slot) {
				(gone.get(kind) ?? gone.set(kind, new Set()).get(kind)!).add(String(c.name));
				continue;
			}
			if (Array.isArray(c.bones) && c.bones.includes(bone)) {
				const left = (c.bones as unknown[]).filter((b) => b !== bone);
				c.bones = left;
				if (!left.length) {
					(gone.get(kind) ?? gone.set(kind, new Set()).get(kind)!).add(String(c.name));
					continue;
				}
			}
			kept.push(c);
		}
		if (doc[kind] !== undefined) doc[kind] = kept;
	}
	for (const a of anims)
		for (const [kind, names] of gone) {
			const tl = a[kind];
			if (isRecord(tl)) for (const n of names) delete tl[n];
		}
	for (const skin of doc.skins ?? [])
		for (const kind of CONSTRAINT_KINDS) {
			const names = gone.get(kind);
			if (names && Array.isArray(skin[kind]))
				skin[kind] = (skin[kind] as string[]).filter((n) => !names.has(n));
		}
	const idx = doc.bones.findIndex((b) => b.name === bone);
	const needed =
		idx < 0 ||
		doc.bones.some((b) => b.parent === bone) ||
		(doc.slots ?? []).some((s) => s.bone === bone) ||
		[...attachmentsOf(doc)].some(({ att }) =>
			influences(att)?.some((one) => one.some(([b]) => b === idx)),
		);
	if (needed) return { keptBone: idx >= 0 };
	for (const a of anims) if (isRecord(a.bones)) delete a.bones[bone];
	for (const skin of doc.skins ?? [])
		if (Array.isArray(skin.bones)) skin.bones = (skin.bones as string[]).filter((b) => b !== bone);
	reorderBones(
		doc,
		doc.bones.map((b) => b.name).filter((n) => n !== bone),
	);
	return { keptBone: false };
}

// ---- the update ----------------------------------------------------------------------------------

export interface FrameUpdateInput {
	/** The rig as the page holds it (irig v1). */
	current: Json;
	/** `templateRig(...).skeleton` over the new sheet with the new fit. */
	fresh: Json;
	/** The new build's bind pose: its bones in the frame's pose (`frameWorld`), for a bone the rig lacks. */
	freshBind: Map<string, Affine>;
	/** The rig's source as it was made (or last updated). */
	made: Pick<FrameSourceDoc, 'parts' | 'props'>;
	/** The new cut's props as kept with it: a prop whose bone or motion changed there is re-hung. */
	props: { name: string; bone?: string; motion: string }[];
	/** Parts whose hand-edited mesh the author keeps. */
	keep?: ReadonlySet<string>;
	/** The template's links (`RigTemplateBone.link`): a rig made before one gets it. */
	links?: readonly string[];
	/**
	 * Slots of the build the rig lacks that it gets, drawn where the build draws them, as a new prop's
	 * is (a sheet's region newly mapped: one slot per region, frame-to-rig §13.1h).
	 */
	newSlots?: ReadonlySet<string>;
}

export interface FrameUpdateReport {
	/** Parts and props whose attachment was rebuilt. */
	replaced: string[];
	/** Hand-edited meshes, and whether the author's was kept. */
	handEdited: { part: string; kept: boolean }[];
	/** Props new to the rig: a bone and a slot each. */
	added: string[];
	/** The head turn's bones new to the rig (frame-to-rig §13.1g), its head weighted to them. */
	turned: string[];
	/** The template's links new to the rig (the neck's upper half), each with the bone below it. */
	linked: { bone: string; below: string }[];
	/** What the cut no longer makes, removed, with what named it; `keptBone` when its bone stayed. */
	removed: (Removal & { references: string[]; keptBone: boolean })[];
	/** A prop the cut hangs from another bone now, or with another motion: its bone re-hung. */
	rehung: string[];
	/** Deform keys dropped: the rebuilt mesh deforms another number of values. */
	deformDropped: { part: string; keys: number }[];
	/** The build's bones the rig no longer has, and the ancestor that took their share. */
	foldedBones: { bone: string; into: string }[];
	/** Parts the rig has no slot for any more (the author deleted it): not updated. */
	slotless: string[];
}

type MergeInput = Pick<FrameUpdateInput, 'current' | 'fresh' | 'made' | 'props' | 'newSlots'>;

/** Whether the merge puts slot `name` of the build in: a prop's, or one of `newSlots`. */
const slotComes = (input: MergeInput, isProp: (name: string) => boolean) => (name: string) =>
	isProp(name) || !!input.newSlots?.has(name);

/**
 * Put the build's link `name` into the rig between its parent and the one bone the build hangs
 * from it, where the rig has them hung together: at the share of that bone's offset the build gives
 * the link (on the rig's own line, unturned), the bone below it moved by as much, the bones put in
 * order and every weighted vertex renumbered. Not where a constraint chains the two (an IK from the
 * parent to the bone would no longer be a chain). The bone below it, or null when not put in.
 */
function insertLink(doc: Doc, fresh: Doc, name: string): string | null {
	const fb = fresh.bones.find((b) => b.name === name);
	if (!fb?.parent || doc.bones.some((b) => b.name === name)) return null;
	const under = fresh.bones.filter((b) => b.parent === name);
	const kid = under.length === 1 ? doc.bones.find((b) => b.name === under[0].name) : undefined;
	if (!kid || kid.parent !== fb.parent || (fb.rotation ?? 0) !== 0) return null;
	const chained = CONSTRAINT_KINDS.some((kind) =>
		((doc[kind] as Json[] | undefined) ?? []).some(
			(c) => Array.isArray(c.bones) && c.bones.includes(kid.name) && c.bones.includes(fb.parent),
		),
	);
	if (chained) return null;
	const num = (v: unknown) => (typeof v === 'number' ? v : 0);
	const [lx, ly, kx, ky] = [num(fb.x), num(fb.y), num(under[0].x), num(under[0].y)];
	const share = Math.hypot(lx, ly) / Math.max(1e-9, Math.hypot(lx, ly) + Math.hypot(kx, ky));
	const [x, y] = [num(kid.x) * share, num(kid.y) * share];
	const link: Bone = { name, parent: fb.parent };
	if (round4(x)) link.x = round4(x);
	if (round4(y)) link.y = round4(y);
	kid.parent = name;
	for (const [k, v] of [
		['x', num(kid.x) - x],
		['y', num(kid.y) - y],
	] as const) {
		if (round4(v)) kid[k] = round4(v);
		else delete kid[k];
	}
	doc.bones.push(link);
	const order = doc.bones.map((b) => b.name).filter((n) => n !== name);
	order.splice(order.indexOf(kid.name), 0, name);
	reorderBones(doc, order);
	return kid.name;
}

/** Whether a name is a prop's: `prop_…`, or one the input names (a sheet's custom part, named freely). */
function propTest(input: Pick<FrameUpdateInput, 'made' | 'props'>): (name: string) => boolean {
	const named = new Set([...input.props, ...input.made.props].map((p) => p.name));
	return (name) => name.startsWith('prop_') || named.has(name);
}

/** What the rig was made with that the cut (its attachments `made`) no longer makes. */
function goneParts(
	input: Pick<FrameUpdateInput, 'made'>,
	made: { has(name: string): boolean },
	isProp: (name: string) => boolean,
): Removal[] {
	return Object.entries(input.made.parts)
		.filter(([name]) => !made.has(name))
		.map(([name, was]): Removal => ({
			name,
			kind: isProp(name) ? 'prop' : 'part',
			slot: was.slot,
		}));
}

/**
 * New props' slots, drawn where the build draws them (`fresh`, back to front): after the slot before
 * them there, else last. Each is spliced into `slots` at `at` in turn.
 */
function newSlotPlaces<S extends { name: string }>(
	slots: readonly { name: string }[],
	fresh: readonly S[],
	isProp: (name: string) => boolean,
): { at: number; slot: S }[] {
	const names = slots.map((s) => s.name);
	const out: { at: number; slot: S }[] = [];
	for (let i = 0; i < fresh.length; i++) {
		const s = fresh[i];
		if (!isProp(s.name) || names.includes(s.name)) continue;
		let at = names.length;
		for (let j = i - 1; j >= 0; j--) {
			const k = names.indexOf(fresh[j].name);
			if (k >= 0) {
				at = k + 1;
				break;
			}
		}
		names.splice(at, 0, s.name);
		out.push({ at, slot: s });
	}
	return out;
}

/**
 * The slots `frameRigUpdate` leaves the rig, by name, back to front: its own less each prop the cut
 * no longer makes, and each new prop's drawn where the build draws it. Reads only the rig's slots,
 * so `current` may be the rig's outline (its slots, and its skins' attachment names by slot).
 */
export function mergedSlots(input: MergeInput): string[] {
	const fresh = input.fresh as Doc;
	const isProp = propTest(input);
	const made = new Set(madeAttachments(fresh).map((m) => m.name));
	const drop = new Set(
		goneParts(input, made, isProp)
			.filter((r) => r.kind === 'prop')
			.map((r) => r.slot),
	);
	const slots = ((input.current as Doc).slots ?? []).filter((s) => !drop.has(s.name));
	const names = slots.map((s) => s.name);
	for (const { at, slot } of newSlotPlaces(slots, fresh.slots ?? [], slotComes(input, isProp)))
		names.splice(at, 0, slot.name);
	return names;
}

/** The rig with the new cut's parts in it, and what changed. Neither input is modified. */
export function frameRigUpdate(input: FrameUpdateInput): { doc: Json; report: FrameUpdateReport } {
	const doc = structuredClone(input.current) as Doc;
	const fresh = input.fresh as Doc;
	const report: FrameUpdateReport = {
		replaced: [],
		handEdited: [],
		added: [],
		turned: [],
		linked: [],
		removed: [],
		rehung: [],
		deformDropped: [],
		foldedBones: [],
		slotless: [],
	};
	const made = new Map(madeAttachments(fresh).map((m) => [m.name, m]));
	const freshBones = new Map(fresh.bones.map((b) => [b.name, b]));
	const freshNames = fresh.bones.map((b) => b.name);
	const reorder = keepDrawOrders(doc);
	const isProp = propTest(input);

	// What the cut no longer makes goes first, so the bones it frees do not stay numbered.
	for (const one of goneParts(input, made, isProp)) {
		const r: Removal =
			one.kind === 'prop' && doc.bones.some((b) => b.name === one.name)
				? { ...one, bone: one.name }
				: one;
		const refs = references(doc, r);
		const { keptBone } = remove(doc, r);
		report.removed.push({ ...r, references: refs, keptBone });
	}

	// The template's links the rig was made before, each between its bones (renumbering them).
	for (const name of input.links ?? []) {
		const below = insertLink(doc, fresh, name);
		if (below) report.linked.push({ bone: name, below });
	}

	// New props' bones and the head turn's, appended in the build's order (a parent before its
	// child), so nothing moves.
	const has = (n: string) => doc.bones.some((b) => b.name === n);
	const turning = new Set<string>(HEAD_TURN_BONES);
	const nearest = (n: string): string => {
		for (
			let b: Bone | undefined = freshBones.get(n);
			b;
			b = b.parent ? freshBones.get(b.parent) : undefined
		)
			if (has(b.name)) return b.name;
		return doc.bones[0].name;
	};
	for (const b of fresh.bones) {
		if (has(b.name) || !((isProp(b.name) && made.has(b.name)) || turning.has(b.name))) continue;
		doc.bones.push(placedOn(b, nearest(b.parent ?? b.name), fresh, doc));
		(turning.has(b.name) ? report.turned : report.added).push(b.name);
	}
	// A prop whose bone or motion the cut changed hangs where the new build hangs it.
	const before = new Map(input.made.props.map((p) => [p.name, p]));
	for (const p of input.props) {
		const was = before.get(p.name);
		const fb = freshBones.get(p.name);
		const i = doc.bones.findIndex((b) => b.name === p.name);
		if (!was || !fb || i < 0 || report.added.includes(p.name)) continue;
		if ((was.bone ?? '') === (p.bone ?? '') && was.motion === p.motion) continue;
		// A bone the author hung from it would come before its parent: it stays where it is.
		if (doc.bones.some((b) => b.parent === p.name)) continue;
		const parent = nearest(fb.parent ?? fb.name);
		const at = doc.bones.findIndex((b) => b.name === parent);
		doc.bones[i] = { ...placedOn(fb, parent, fresh, doc), ...keptBoneFields(doc.bones[i]) };
		if (at > i) {
			const order = doc.bones.map((b) => b.name).filter((n) => n !== p.name);
			order.splice(order.indexOf(parent) + 1, 0, p.name);
			reorderBones(doc, order);
		}
		report.rehung.push(p.name);
	}

	doc.slots ??= [];
	const freshSlots = fresh.slots ?? [];
	for (const { at, slot } of newSlotPlaces(doc.slots, freshSlots, slotComes(input, isProp)))
		doc.slots.splice(at, 0, { ...slot, bone: has(slot.bone) ? slot.bone : nearest(slot.bone) });

	// Every attachment the cut makes, bound to the rig's bones by name.
	doc.skins ??= [];
	if (!doc.skins.length) doc.skins.push({ name: 'default', attachments: {} });
	const skin = doc.skins.find((s) => s.name === 'default') ?? doc.skins[0];
	skin.attachments ??= {};
	const rigNames = () => doc.bones.map((b) => b.name);
	for (const { slot, name, att } of made.values()) {
		if (!doc.slots.some((s) => s.name === slot)) {
			report.slotless.push(name);
			continue;
		}
		const now = skin.attachments[slot]?.[name];
		const madeHash = input.made.parts[name]?.hash;
		const edited =
			isRecord(now) && madeHash !== undefined && attachmentHash(now, rigNames()) !== madeHash;
		if (edited) {
			const kept = input.keep?.has(name) ?? false;
			report.handEdited.push({ part: name, kept });
			if (kept) continue;
		}
		const next = bound(att, freshNames, input.freshBind, rigNames(), nearest, report);
		if (isRecord(now)) {
			const keys = dropDeforms(doc, slot, name, deformLength(now), deformLength(next));
			if (keys) report.deformDropped.push({ part: name, keys });
		}
		(skin.attachments[slot] ??= {})[name] = next;
		report.replaced.push(name);
		const s = doc.slots.find((x) => x.name === slot)!;
		const fs = freshSlots.find((x) => x.name === slot);
		if (s.attachment === undefined && fs?.attachment === name) s.attachment = name;
	}
	reorder();
	return { doc, report };
}

/**
 * Keep what every draw-order key draws in front of what while slots come and go: a key names each
 * moved slot by its offset from its SETUP place, so a slot added or removed before it moves every key
 * after it (and one moved to the top would point past the end). Each key is read now, as engine-rig
 * reads it (`skeletonJson`), into its whole order; the returned function writes it back over the slots
 * as they are then — a removed slot left out, a new one drawn just after the slot before it in setup.
 */
export function keepDrawOrders(doc: {
	slots?: { name: string }[];
	animations?: Record<string, unknown>;
}): () => void {
	const before = (doc.slots ?? []).map((s) => s.name);
	const keys: { key: Json; order: string[] }[] = [];
	for (const a of Object.values(doc.animations ?? {}))
		if (isRecord(a) && Array.isArray(a.drawOrder))
			for (const key of a.drawOrder)
				if (isRecord(key)) keys.push({ key, order: drawOrderOf(before, key.offsets) });
	return () => {
		const after = (doc.slots ?? []).map((s) => s.name);
		for (const { key, order } of keys) {
			const now = order.filter((n) => after.includes(n));
			after.forEach((n, i) => {
				if (now.includes(n)) return;
				now.splice(i === 0 ? 0 : now.indexOf(after[i - 1]) + 1, 0, n);
			});
			const offsets = offsetsOf(after, now);
			if (offsets.length) key.offsets = offsets;
			else delete key.offsets;
		}
	};
}

/** The build's bone `b` hung from the rig's `parent` at the same place in the build's setup. */
function placedOn(b: Bone, parent: string, fresh: Doc, doc: Doc): Bone {
	if (b.parent === parent) return structuredClone(b);
	const fw = setupWorld(fresh.bones);
	const rw = setupWorld(doc.bones);
	const local = mul(invert(rw.get(parent)!), fw.get(b.name)!);
	const out: Bone = { ...structuredClone(b), parent };
	const [x, y] = [local[4], local[5]];
	const rot = (Math.atan2(local[2], local[0]) * 180) / Math.PI;
	for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY']) delete out[k];
	if (round4(x)) out.x = round4(x);
	if (round4(y)) out.y = round4(y);
	if (round4(rot)) out.rotation = round4(rot);
	return out;
}

/** What of a bone the author may have set beyond where it hangs: its colour, its icon, its inherit. */
function keptBoneFields(b: Bone): Json {
	const out: Json = {};
	for (const k of ['color', 'icon', 'inherit', 'skin', 'visible', 'length'])
		if (b[k] !== undefined) out[k] = b[k];
	return out;
}

/**
 * The build's attachment with its weighted vertices naming the rig's bones: each influence's bone by
 * its place in the rig, or, for a bone the rig lacks, its nearest ancestor the rig has, the vertex
 * moved into that bone's frame in the build's bind pose (two influences landing on one bone merge).
 */
function bound(
	att: Json,
	freshNames: readonly string[],
	bind: Map<string, Affine>,
	rigNames: readonly string[],
	nearest: (n: string) => string,
	report: FrameUpdateReport,
): Json {
	const out = structuredClone(att);
	const inf = influences(att);
	if (!inf) return out;
	const index = new Map(rigNames.map((n, i) => [n, i]));
	const mapped = inf.map((one) => {
		const merged = new Map<number, [number, number, number]>();
		for (const [b, x, y, w] of one) {
			const name = freshNames[b];
			let to = name;
			let [lx, ly] = [x, y];
			if (!index.has(name)) {
				to = nearest(name);
				if (!report.foldedBones.some((f) => f.bone === name))
					report.foldedBones.push({ bone: name, into: to });
				const [wx, wy] = apply(bind.get(name)!, x, y);
				[lx, ly] = apply(invert(bind.get(to)!), wx, wy);
			}
			const i = index.get(to)!;
			const acc = merged.get(i);
			if (acc) merged.set(i, [acc[0] + lx * w, acc[1] + ly * w, acc[2] + w]);
			else merged.set(i, [lx * w, ly * w, w]);
		}
		return [...merged].map(([i, [sx, sy, w]]): [number, number, number, number] => [
			i,
			round4(sx / w),
			round4(sy / w),
			round4(w),
		]);
	});
	out.vertices = flatten(mapped);
	return out;
}

/** Drop the deform keys on `slot`/`name` when the rebuilt mesh deforms another number of values. */
function dropDeforms(
	doc: Doc,
	slot: string,
	name: string,
	was: number | null,
	now: number | null,
): number {
	if (was === now) return 0;
	let n = 0;
	for (const a of Object.values(doc.animations ?? {})) {
		if (!isRecord(a)) continue;
		for (const key of ['attachments', 'deform'] as const) {
			const by = a[key];
			if (!isRecord(by)) continue;
			for (const s of Object.values(by)) {
				const at = isRecord(s) && isRecord(s[slot]) ? (s[slot] as Json) : null;
				const tl = at && isRecord(at[name]) ? (at[name] as Json) : null;
				if (!at || !tl) continue;
				n += Array.isArray(tl.deform) ? tl.deform.length : count(tl);
				delete at[name];
				if (!Object.keys(at).length) delete (s as Json)[slot];
			}
		}
	}
	return n;
}

// ---- a rig's modules changed in place --------------------------------------------------------------

/** What a module change did to a rig (docs/design/rig-modules.md §4). */
export interface ModuleChangeReport {
	/** Bones taken out with their keys and constraints, a weighted vertex's share handed up. */
	bones: string[];
	/** Slots taken out with their attachments and keys. */
	slots: string[];
	/** Bones kept with nothing left on them (a bare wrist): their controls go too. */
	bared: string[];
	/** Constraints taken out: they named a bone that went. */
	constraints: string[];
	/** Keys taken out with them (bone, slot, attachment and deform keys). */
	keys: number;
	/** Bones and slots put in, where the build of the new set has them. */
	added: { bones: string[]; slots: string[] };
}

/** What a template has of a rig: its bones and slots by name. */
interface TemplateNames {
	bones: readonly { name: string }[];
	slots: readonly { name: string }[];
}

/**
 * Rig `current` (made with template `from`: its modules) with the module set of template `to`
 * (docs/design/rig-modules.md §4), in place: what `from` has and `to` lacks taken out — slots with
 * their attachments and keys, bones with their keys and the constraints naming them, a weighted
 * vertex's share of a bone that goes handed to the nearest bone kept above it where the vertex is at
 * setup, the bones renumbered, every draw-order key still drawing what it drew — and, with `fresh`
 * (`templateRig` of `to` over the rig's art, on its lengths), what `to` has and `from` lacks put in
 * where `fresh` has it, its art bound to the rig's bones. Refused when the author hung a bone or a
 * slot of their own on a bone that goes. Neither input is modified.
 */
export function changeModules(
	current: Json,
	from: TemplateNames,
	to: TemplateNames,
	fresh?: Json,
): { ok: true; doc: Json; report: ModuleChangeReport } | { ok: false; problem: string } {
	const doc = structuredClone(current) as Doc;
	const report: ModuleChangeReport = {
		bones: [],
		slots: [],
		bared: [],
		constraints: [],
		keys: 0,
		added: { bones: [], slots: [] },
	};
	const [fromBones, toBones, fromSlots, toSlots] = [from.bones, to.bones, from.slots, to.slots].map(
		(xs) => new Set(xs.map((x) => x.name)),
	);
	const goneBones = new Set(
		doc.bones.filter((b) => fromBones.has(b.name) && !toBones.has(b.name)).map((b) => b.name),
	);
	const goneSlots = new Set(
		(doc.slots ?? [])
			.filter((s) => fromSlots.has(s.name) && !toSlots.has(s.name))
			.map((s) => s.name),
	);
	const strayBone = doc.bones.find(
		(b) => b.parent && goneBones.has(b.parent) && !goneBones.has(b.name),
	);
	if (strayBone)
		return {
			ok: false,
			problem: `your bone "${strayBone.name}" hangs from "${strayBone.parent}", which the change takes out: hang it elsewhere first`,
		};
	const straySlot = (doc.slots ?? []).find((s) => goneBones.has(s.bone) && !goneSlots.has(s.name));
	if (straySlot)
		return {
			ok: false,
			problem: `your slot "${straySlot.name}" is on "${straySlot.bone}", which the change takes out: move it first`,
		};
	const anims = Object.values(doc.animations ?? {}).filter(isRecord);

	// The slots, their attachments and keys; every draw-order key re-read without them.
	const reorder = keepDrawOrders(doc);
	for (const skin of doc.skins ?? []) for (const s of goneSlots) delete skin.attachments?.[s];
	for (const a of anims) {
		for (const key of ['attachments', 'deform'] as const) {
			const by = a[key];
			if (!isRecord(by)) continue;
			for (const skin of Object.values(by))
				if (isRecord(skin))
					for (const s of goneSlots)
						if (skin[s] !== undefined) {
							report.keys += count(skin[s]);
							delete skin[s];
						}
		}
		if (isRecord(a.slots))
			for (const s of goneSlots)
				if (a.slots[s] !== undefined) {
					report.keys += count(a.slots[s]);
					delete a.slots[s];
				}
	}
	const emptied = new Set(
		(doc.slots ?? [])
			.filter((s) => goneSlots.has(s.name) && !goneBones.has(s.bone))
			.map((s) => s.bone),
	);
	doc.slots = (doc.slots ?? []).filter((s) => !goneSlots.has(s.name));
	reorder();
	report.slots.push(...goneSlots);
	report.bared.push(...[...emptied].filter((b) => !doc.slots!.some((s) => s.bone === b)));

	// The constraints naming a bone that goes, and their keys.
	const goneConstraints = new Map<ConstraintKind, Set<string>>();
	for (const kind of CONSTRAINT_KINDS) {
		const list = (doc[kind] as Json[] | undefined) ?? [];
		const kept = list.filter((c) => {
			const named = [c.target, c.bone, ...(Array.isArray(c.bones) ? c.bones : [])];
			if (!named.some((n) => typeof n === 'string' && goneBones.has(n))) return true;
			(goneConstraints.get(kind) ?? goneConstraints.set(kind, new Set()).get(kind)!).add(
				String(c.name),
			);
			report.constraints.push(String(c.name));
			return false;
		});
		if (doc[kind] !== undefined) doc[kind] = kept;
	}
	for (const a of anims)
		for (const [kind, names] of goneConstraints) {
			const tl = a[kind];
			if (isRecord(tl))
				for (const n of names) {
					report.keys += count(tl[n]);
					delete tl[n];
				}
		}
	for (const skin of doc.skins ?? []) {
		for (const kind of CONSTRAINT_KINDS) {
			const names = goneConstraints.get(kind);
			if (names && Array.isArray(skin[kind]))
				skin[kind] = (skin[kind] as string[]).filter((n) => !names.has(n));
		}
		if (Array.isArray(skin.bones))
			skin.bones = (skin.bones as string[]).filter((b) => !goneBones.has(b));
	}

	// The bones: their keys, a weighted vertex's share handed up, the rest renumbered.
	for (const a of anims)
		if (isRecord(a.bones))
			for (const b of goneBones)
				if (a.bones[b] !== undefined) {
					report.keys += count(a.bones[b]);
					delete a.bones[b];
				}
	if (goneBones.size) {
		const W = setupWorld(doc.bones);
		const byName = new Map(doc.bones.map((b) => [b.name, b]));
		const above = (n: string): string => {
			let b = byName.get(n);
			while (b && goneBones.has(b.name) && b.parent) b = byName.get(b.parent);
			return b?.name ?? doc.bones[0].name;
		};
		const index = new Map(doc.bones.map((b, i) => [b.name, i]));
		for (const { slot, name, att } of attachmentsOf(doc)) {
			const inf = influences(att);
			if (!inf || !inf.some((one) => one.some(([b]) => goneBones.has(doc.bones[b].name)))) continue;
			const before = deformLength(att);
			const folded = inf.map((one) => {
				const merged = new Map<number, [number, number, number]>();
				for (const [b, x, y, w] of one) {
					const n = doc.bones[b].name;
					let [i, lx, ly] = [b, x, y];
					if (goneBones.has(n)) {
						const to = above(n);
						[lx, ly] = apply(invert(W.get(to)!), ...apply(W.get(n)!, x, y));
						i = index.get(to)!;
					}
					const acc = merged.get(i);
					merged.set(i, acc ? [acc[0] + lx * w, acc[1] + ly * w, acc[2] + w] : [lx * w, ly * w, w]);
				}
				return [...merged].map(([i, [sx, sy, w]]): [number, number, number, number] => [
					i,
					round4(sx / w),
					round4(sy / w),
					round4(w),
				]);
			});
			att.vertices = flatten(folded);
			report.keys += dropDeforms(doc, slot, name, before, deformLength(att));
		}
		reorderBones(
			doc,
			doc.bones.map((b) => b.name).filter((n) => !goneBones.has(n)),
		);
		report.bones.push(...goneBones);
	}

	// What the new set adds, from its build over the rig's art.
	const made = fresh as Doc | undefined;
	if (made) {
		const has = (n: string) => doc.bones.some((b) => b.name === n);
		const madeBones = new Map(made.bones.map((b) => [b.name, b]));
		const nearest = (n: string): string => {
			for (let b = madeBones.get(n); b; b = b.parent ? madeBones.get(b.parent) : undefined)
				if (has(b.name)) return b.name;
			return doc.bones[0].name;
		};
		const adds = (n: string) => toBones.has(n) && !fromBones.has(n);
		for (const b of made.bones)
			if (adds(b.name) && !has(b.name)) {
				doc.bones.push(placedOn(b, nearest(b.parent ?? b.name), made, doc));
				report.added.bones.push(b.name);
			}
		doc.slots ??= [];
		const slotAdds = (n: string) =>
			toSlots.has(n) && !fromSlots.has(n) && !doc.slots!.some((s) => s.name === n);
		const places = newSlotPlaces(doc.slots, made.slots ?? [], slotAdds);
		for (const { at, slot } of places) doc.slots.splice(at, 0, structuredClone(slot));
		const madeSkin = (made.skins ?? []).find((s) => s.name === 'default') ?? made.skins?.[0];
		doc.skins ??= [];
		if (!doc.skins.length) doc.skins.push({ name: 'default', attachments: {} });
		const skin = doc.skins.find((s) => s.name === 'default') ?? doc.skins[0];
		skin.attachments ??= {};
		const madeNames = made.bones.map((b) => b.name);
		const bind = setupWorld(made.bones);
		const folding: FrameUpdateReport = {
			replaced: [],
			handEdited: [],
			added: [],
			turned: [],
			linked: [],
			removed: [],
			rehung: [],
			deformDropped: [],
			foldedBones: [],
			slotless: [],
		};
		for (const { slot } of places) {
			report.added.slots.push(slot.name);
			const atts = madeSkin?.attachments?.[slot.name];
			if (!atts) continue;
			skin.attachments[slot.name] = Object.fromEntries(
				Object.entries(atts).map(([n, att]) => [
					n,
					bound(
						att,
						madeNames,
						bind,
						doc.bones.map((b) => b.name),
						nearest,
						folding,
					),
				]),
			);
		}
		for (const kind of CONSTRAINT_KINDS) {
			const list = (made[kind] as Json[] | undefined) ?? [];
			for (const c of list) {
				const named = [c.target, c.bone, ...(Array.isArray(c.bones) ? c.bones : [])];
				const mine = ((doc[kind] as Json[] | undefined) ?? []).some((x) => x.name === c.name);
				if (mine || !named.some((n) => typeof n === 'string' && report.added.bones.includes(n)))
					continue;
				if (!named.every((n) => typeof n !== 'string' || has(n))) continue;
				doc[kind] = [...((doc[kind] as Json[] | undefined) ?? []), structuredClone(c)];
			}
		}
	}
	return { ok: true, doc, report };
}

/**
 * 🧩 Modules for a rig made with ＋ New rig (docs/design/rig-modules.md §4): rig `current`, made from
 * template `whole` with module set `was`, changed to `now` — what goes taken out, what comes made over
 * the rig's art (`regions`) on its fit (when it still fits the new set) and merged (`changeModules`).
 */
export function planModules(o: {
	whole: RigTemplate;
	was?: RigModuleChoice;
	now: RigModuleChoice;
	regions: readonly TemplateRegion[];
	fit?: RigFit | null;
	current: Json;
}):
	| { ok: true; doc: Json; report: ModuleChangeReport; controls?: RigTemplateControls }
	| { ok: false; problem: string } {
	const bad = moduleChoiceProblem(o.whole, o.now);
	if (bad) return { ok: false, problem: bad };
	const from = templateWithModules(o.whole, o.was);
	const to = templateWithModules(o.whole, o.now);
	const fit = o.fit && !templateFitProblem(to, o.fit) ? o.fit : undefined;
	const changed = changeModules(o.current, from, to, templateRig(to, o.regions, fit).skeleton);
	if (!changed.ok) return changed;
	return {
		ok: true,
		doc: changed.doc,
		report: changed.report,
		...(to.controls ? { controls: to.controls } : {}),
	};
}

// ---- the sidecar's record of what was made ------------------------------------------------------

/** A kept cut as the sidecar reads it (`rigFromFrame.StoredCut`'s fields it uses). */
export interface CutRecord {
	job: string;
	clip?: { id: string; frame: number };
	sources?: Record<string, string>;
	props: { name: string; take?: boolean; motion?: string; bone: string; boneSet?: boolean }[];
}

/** The `frame-source.json` of rig `rig` made (or updated) from `cut`, its parts hashed as made. */
export function frameSourceOf(o: {
	rig: string;
	template: { id: string; version: number };
	cut: CutRecord;
	cutEtag: string | null;
	frames: Record<string, number | null>;
	parts: Record<string, { slot: string; hash: string }>;
	art: string;
	artRevision: string;
	linked?: boolean;
}): FrameSourceDoc {
	return {
		frameSource: 1,
		rig: o.rig,
		template: { id: o.template.id, version: o.template.version },
		clip: o.cut.clip ? { id: o.cut.clip.id, frame: o.cut.clip.frame } : null,
		job: o.cut.job,
		cutEtag: o.cutEtag,
		sources: { ...(o.cut.sources ?? {}) },
		frames: { ...o.frames },
		props: o.cut.props.map((p) => ({
			name: p.name,
			take: p.take !== false,
			motion: p.motion ?? 'rides',
			...(p.boneSet ? { bone: p.bone } : {}),
		})),
		parts: o.parts,
		art: o.art,
		artRevision: o.artRevision,
		made: new Date().toISOString(),
		...(o.linked ? { linked: true as const } : {}),
	};
}

/** Each attachment the cut made, as the rig now holds it: its slot and hash (bones by name). */
export function madeParts(
	doc: Json,
	names: Iterable<string>,
): Record<string, { slot: string; hash: string }> {
	const d = doc as Doc;
	const boneNames = d.bones.map((b) => b.name);
	const want = new Set(names);
	const skin = (d.skins ?? []).find((s) => s.name === 'default') ?? d.skins?.[0];
	const out: Record<string, { slot: string; hash: string }> = Object.create(null);
	for (const [slot, by] of Object.entries(skin?.attachments ?? {}))
		for (const [name, att] of Object.entries(by))
			if (want.has(name) && isRecord(att))
				out[name] = { slot, hash: attachmentHash(att, boneNames) };
	return out;
}

/** A hand-edited mesh may be kept when its part's new image is this alike its old one… */
export const KEEP_IOU = 0.95;
/** …and its size within this many pixels of it: the kept mesh's UVs then still find the drawing. */
export const KEEP_PX = 2;

export interface UpdateInput {
	template: RigTemplate;
	/** The new sheet's regions. */
	regions: readonly TemplateRegion[];
	fit: RigFit;
	current: Json;
	made: Pick<FrameSourceDoc, 'parts' | 'props'>;
	/** The new cut's props. */
	props: CutRecord['props'];
	keep?: ReadonlySet<string>;
	/** The parts' images on the old sheet and the new one, to tell whether a hand-edited mesh may stay. */
	outlines?: { before: Map<string, AlphaImage>; after: Map<string, AlphaImage> };
	/** The template as the rig was made, when the update changes its module set (`changeModules` first). */
	from?: RigTemplate;
}

export interface UpdateResult {
	doc: Json;
	report: Omit<FrameUpdateReport, 'handEdited'> & {
		handEdited: { part: string; kept: boolean; canKeep: boolean; iou: number | null }[];
		/** The module set changed with the update: what went and what came (`changeModules`). */
		modules?: ModuleChangeReport;
	};
	/** The sidecar's record of the parts as made now (a kept mesh keeps the hash it was made with). */
	parts: Record<string, { slot: string; hash: string }>;
}

/**
 * 🔄 Update rig, whole: the parts built from the new sheet with the new fit as 🦴 Create rig builds
 * them, merged into the open rig (`frameRigUpdate`), a hand-edited mesh kept only where the author
 * asked and its part's drawing barely changed (`KEEP_IOU`, `KEEP_PX`). With `from`, the rig's module
 * set changes to the template's first (`changeModules`; thrown when the author's work stops it).
 */
export function updateFrameRig(o: UpdateInput): UpdateResult {
	const fresh = templateRig(o.template, o.regions, o.fit).skeleton;
	let current = o.current;
	let modules: ModuleChangeReport | undefined;
	if (o.from) {
		const changed = changeModules(o.current, o.from, o.template, fresh);
		if (!changed.ok) throw new Error(changed.problem);
		({ doc: current, report: modules } = changed);
	}
	const freshBind = frameWorld(fitTemplate(o.template, o.fit).bones, o.fit.frame);
	const props = o.props
		.filter((p) => p.take !== false)
		.map((p) => ({
			name: p.name,
			motion: p.motion ?? 'rides',
			...(p.boneSet ? { bone: p.bone } : {}),
		}));
	const links = o.template.bones.filter((b) => b.link).map((b) => b.name);
	const base = { current, fresh, freshBind, made: o.made, props, links };
	const looked = frameRigUpdate(base).report.handEdited;
	const verdict = new Map(
		looked.map(({ part }) => {
			const a = o.outlines?.before.get(part);
			const b = o.outlines?.after.get(part);
			const iou = a && b ? alphaIoU(a, b) : null;
			const near = !!a && !!b && Math.abs(a.w - b.w) <= KEEP_PX && Math.abs(a.h - b.h) <= KEEP_PX;
			return [part, { iou, canKeep: near && iou !== null && iou >= KEEP_IOU }];
		}),
	);
	const keep = new Set([...(o.keep ?? [])].filter((p) => verdict.get(p)?.canKeep));
	const { doc, report } = frameRigUpdate({ ...base, keep });
	const parts = madeParts(
		doc,
		madeAttachments(fresh).map((m) => m.name),
	);
	for (const p of keep) if (o.made.parts[p]) parts[p] = o.made.parts[p];
	// A part whose slot the module change took out went with it, not because the cut no longer makes it.
	const tookSlots = new Set(modules?.slots ?? []);
	return {
		doc,
		report: {
			...report,
			removed: report.removed.filter((r) => !tookSlots.has(r.slot)),
			handEdited: report.handEdited.map((h) => ({ ...h, ...verdict.get(h.part)! })),
			...(modules ? { modules } : {}),
		},
		parts,
	};
}

/** An image's alpha, one byte a pixel. */
export interface AlphaImage {
	data: Uint8Array;
	w: number;
	h: number;
}

/** How alike two images' outlines are: the IoU of their alpha above half, centred on each other. */
export function alphaIoU(a: AlphaImage, b: AlphaImage): number {
	// b's pixel (bx, by) lies at (bx - dx, by - dy) of a.
	const [dx, dy] = [Math.round((b.w - a.w) / 2), Math.round((b.h - a.h) / 2)];
	let both = 0;
	let either = 0;
	const x0 = Math.min(0, -dx);
	const y0 = Math.min(0, -dy);
	const x1 = Math.max(a.w, b.w - dx);
	const y1 = Math.max(a.h, b.h - dy);
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			const inA = x >= 0 && y >= 0 && x < a.w && y < a.h && a.data[y * a.w + x] > 127;
			const bx = x + dx;
			const by = y + dy;
			const inB = bx >= 0 && by >= 0 && bx < b.w && by < b.h && b.data[by * b.w + bx] > 127;
			if (inA && inB) both++;
			if (inA || inB) either++;
		}
	return either ? both / either : 1;
}
