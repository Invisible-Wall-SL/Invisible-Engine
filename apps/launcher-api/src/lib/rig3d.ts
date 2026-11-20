/**
 * A 2.5D rig's sidecar, `rig3d.json` (docs/design/rig-2p5d.md §3): its schema, how a rig's `.irig`
 * and its sidecar become the bake's input (`Rig3d`, `Clip3d`), and how the bake's output goes back
 * into the irig. Pure (no R2, no DOM), so the save path (`server/rigger3d.ts`) and the Rigger page
 * can run the same code. No game, export or runtime reads the sidecar: games play the baked irig.
 */
import {
	bakedBonesOf,
	type Bake2p5d,
	type Bone3d,
	type BoneKeys3d,
	type Card,
	type Clip3d,
	type Constraint3d,
	type Drawing,
	type Inherit,
	type Key1,
	type Key2,
	type MixKey,
	type Rig3d,
	type Slot3d,
	type Turnaround,
} from './rig2p5d';

export const RIG3D_SIDECAR = 'rig3d.json';
export const RIG3D_VERSION = 1;
/** Earlier bakes of a clip remembered, so a tab still holding one is not taken for a 2D edit. */
export const RIG3D_EARLIER = 8;

/** What the save last baked into the irig's clip, and what of the clip that is. */
export interface Rig3dBaked {
	/** Hash of the clip's baked parts as written (`bakedParts`). */
	hash: string;
	/** The hashes of earlier bakes of the clip, newest first. */
	earlier?: string[];
	/** Hash of the bake's input: the same input and the same parts mean the bake is current. */
	input: string;
	at?: string;
	/** Runs the bake could not bring within the tolerance. */
	unmet?: number;
	/** The bones whose timelines it owns (and a follower's setup)… */
	bones: string[];
	/** …and the slots whose attachment keys it owns. It owns the clip's draw order too. */
	slots: string[];
}

export interface Rig3dClip {
	/** At least this long; otherwise as long as its last key. */
	duration?: number;
	bones: Record<string, BoneKeys3d>;
	/** Written by the save; what a client sends here is ignored. */
	baked?: Rig3dBaked;
}

export interface Rig3dBone {
	/** z in the parent's frame, toward the viewer. */
	depth?: number;
	/** Drawn on this bone in 3D, keyed against its 2D parent. */
	follow?: string;
}

export interface Rig3dView {
	turnAxis?: 'y';
	margin?: number;
	hold?: number;
	drawings: Drawing[];
}

export interface Rig3dDoc {
	rig3d: number;
	/** The stem of the `.irig` in this folder that the sidecar belongs to. */
	rig: string;
	/** The mark of the `.irig` text it was written with (set by the save, `pairMark`). */
	irig?: string;
	tolerance?: number;
	floor?: number;
	hysteresis?: number;
	/** Fixed once set (§11.2): the art and every clip's drawing keys depend on it. */
	turnaround?: Turnaround;
	bones?: Record<string, Rig3dBone>;
	views?: Record<string, Rig3dView>;
	/**
	 * Draw-order layers: each one's slots move in the draw order as one, at their mean depth, in their
	 * setup order (a face's parts, a hand's fingers). Next to each other in the setup order.
	 */
	layers?: Record<string, string[]>;
	clips?: Record<string, Rig3dClip>;
}

// ── Schema ──────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
type Check = (v: unknown, at: string, out: string[]) => void;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const num =
	(least?: number, above = false): Check =>
	(v, at, out) => {
		if (!finite(v)) out.push(`${at} must be a number`);
		else if (least !== undefined && (above ? v <= least : v < least))
			out.push(`${at} must be ${above ? 'above' : 'at least'} ${least}`);
	};
const name: Check = (v, at, out) => {
	if (typeof v !== 'string' || !v) out.push(`${at} must be a name`);
};
const text: Check = (v, at, out) => {
	if (typeof v !== 'string') out.push(`${at} must be text`);
};
const lit =
	(...values: string[]): Check =>
	(v, at, out) => {
		if (typeof v !== 'string' || !values.includes(v))
			out.push(`${at} must be ${values.map((x) => `'${x}'`).join(' or ')}`);
	};
const list =
	(item: Check): Check =>
	(v, at, out) => {
		if (!Array.isArray(v)) out.push(`${at} must be a list`);
		else v.forEach((x, i) => item(x, `${at}[${i}]`, out));
	};
const map =
	(item: Check): Check =>
	(v, at, out) => {
		if (!isObj(v)) out.push(`${at} must be an object`);
		else for (const [k, x] of Object.entries(v)) item(x, `${at}.${k}`, out);
	};
const obj =
	(fields: Record<string, Check>, required: string[] = []): Check =>
	(v, at, out) => {
		if (!isObj(v)) {
			out.push(`${at} must be an object`);
			return;
		}
		for (const k of required) if (!Object.hasOwn(v, k)) out.push(`${at}.${k} is missing`);
		for (const [k, x] of Object.entries(v)) {
			const field = Object.hasOwn(fields, k) ? fields[k] : undefined;
			if (field) field(x, `${at}.${k}`, out);
			else out.push(`${at}.${k} is not a rig3d field`);
		}
	};
const curve: Check = (v, at, out) => {
	if (v !== 'stepped' && !(Array.isArray(v) && v.every(finite)))
		out.push(`${at} must be 'stepped' or a list of numbers`);
};
const quat: Check = (v, at, out) => {
	if (!(Array.isArray(v) && v.length === 4 && v.every(finite) && Math.hypot(...v) > 1e-9))
		out.push(`${at} must be a quaternion [w, x, y, z]`);
};
const key1 = list(obj({ time: num(0), value: num(), curve }));
const key2 = list(obj({ time: num(0), x: num(), y: num(), curve }));
const SIDECAR = obj(
	{
		rig3d: num(),
		rig: name,
		irig: name,
		tolerance: num(0, true),
		floor: num(0),
		hysteresis: num(0),
		turnaround: lit('side', 'full'),
		bones: map(obj({ depth: num(), follow: name })),
		views: map(
			obj(
				{
					turnAxis: lit('y'),
					margin: num(0),
					hold: num(0),
					drawings: list(obj({ attachment: name, turn: num() }, ['attachment', 'turn'])),
				},
				['drawings'],
			),
		),
		layers: map(list(name)),
		clips: map(
			obj(
				{
					duration: num(0, true),
					bones: map(
						obj({
							orient: list(obj({ time: num(0), value: quat, curve }, ['value'])),
							rotate: key1,
							depth: key1,
							translate: key2,
							scale: key2,
						}),
					),
					baked: obj(
						{
							hash: name,
							earlier: list(name),
							input: name,
							at: text,
							unmet: num(0),
							bones: list(name),
							slots: list(name),
						},
						['hash', 'input', 'bones', 'slots'],
					),
				},
				['bones'],
			),
		),
	},
	['rig3d', 'rig'],
);

/** Why `value` is not a `rig3d.json` this launcher reads, or `[]`: every field known and well typed. */
export function rig3dDocProblems(value: unknown): string[] {
	const out: string[] = [];
	SIDECAR(value, RIG3D_SIDECAR, out);
	if (out.length) return out;
	const v = (value as Rig3dDoc).rig3d;
	if (v > RIG3D_VERSION)
		out.push(`${RIG3D_SIDECAR} is version ${v}, newer than this launcher reads (${RIG3D_VERSION})`);
	else if (v !== RIG3D_VERSION) out.push(`${RIG3D_SIDECAR}.rig3d must be ${RIG3D_VERSION}`);
	return out;
}

// ── The irig, read as the bake needs it ─────────────────────────────────────────────────────────

const objects = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const numOr = (v: unknown, fallback: number): number => (finite(v) ? v : fallback);
const bonesOf = (irig: Json) => objects(irig.bones);
const slotsOf = (irig: Json) => objects(irig.slots);
/** Skins as a list (4.x), or the older name → attachments map. */
const skinsOf = (irig: Json): Json[] =>
	Array.isArray(irig.skins)
		? objects(irig.skins)
		: isObj(irig.skins)
			? Object.entries(irig.skins).map(([n, attachments]) => ({ name: n, attachments }))
			: [];
export const animationOf = (irig: Json, clip: string): Json | undefined => {
	const all = irig.animations;
	if (!isObj(all) || !Object.hasOwn(all, clip)) return undefined;
	const a = all[clip];
	return isObj(a) ? a : undefined;
};

/** Why the sidecar does not fit the rig beside it (names it keys that the irig lacks), or `[]`. */
export function rig3dIrigProblems(doc: Rig3dDoc, irig: Json): string[] {
	const out: string[] = [];
	const bones = new Set(bonesOf(irig).map((b) => str(b.name)));
	const slots = new Map(slotsOf(irig).map((s) => [str(s.name), str(s.bone)]));
	for (const [b, setup] of Object.entries(doc.bones ?? {})) {
		if (!bones.has(b)) out.push(`3D bone ${b} is not a bone of the rig`);
		if (setup.follow !== undefined && !bones.has(setup.follow))
			out.push(`3D bone ${b} follows ${setup.follow}, which is not a bone of the rig`);
	}
	const has = new Map<string, Set<string>>();
	for (const skin of skinsOf(irig))
		for (const [slot, byName] of Object.entries(isObj(skin.attachments) ? skin.attachments : {}))
			if (isObj(byName))
				for (const a of Object.keys(byName)) has.set(slot, (has.get(slot) ?? new Set()).add(a));
	for (const [slot, view] of Object.entries(doc.views ?? {})) {
		if (!slots.has(slot)) {
			out.push(`slot ${slot} has drawings by angle but is not a slot of the rig`);
			continue;
		}
		for (const d of view.drawings)
			if (!has.get(slot)?.has(d.attachment))
				out.push(`slot ${slot}: drawing ${d.attachment} is not one of its attachments`);
	}
	const layered = new Map<string, string>();
	for (const [layer, members] of Object.entries(doc.layers ?? {}))
		for (const slot of members) {
			if (!slots.has(slot)) out.push(`layer ${layer}: ${slot} is not a slot of the rig`);
			const other = layered.get(slot);
			if (other !== undefined) out.push(`slot ${slot} is in layers ${other} and ${layer}`);
			layered.set(slot, layer);
		}
	for (const [clip, c] of Object.entries(doc.clips ?? {}))
		for (const b of Object.keys(c.bones))
			if (!bones.has(b))
				out.push(`clip ${clip} keys bone ${b} in 3D, which is not a bone of the rig`);
	return out;
}

/** Where a bone's art lies in its own space: every attachment drawn on it, and every weight on it. */
function cardsOf(irig: Json): Map<string, Card> {
	const names = bonesOf(irig).map((b) => str(b.name) ?? '');
	const slotBone = new Map(slotsOf(irig).map((s) => [str(s.name), str(s.bone)]));
	const points = new Map<string, number[]>();
	const add = (bone: string | undefined, x: number, y: number) => {
		if (bone === undefined || !finite(x) || !finite(y)) return;
		const p = points.get(bone) ?? [Infinity, -Infinity, 0];
		points.set(bone, [Math.min(p[0], x), Math.max(p[1], x), Math.max(p[2], Math.abs(y))]);
	};
	for (const skin of skinsOf(irig))
		for (const [slot, byName] of Object.entries(isObj(skin.attachments) ? skin.attachments : {})) {
			const bone = slotBone.get(slot);
			if (!isObj(byName)) continue;
			for (const a of Object.values(byName)) {
				if (!isObj(a)) continue;
				const type = a.type ?? 'region';
				if (type === 'region') {
					const w = numOr(a.width, 32) * numOr(a.scaleX, 1);
					const h = numOr(a.height, 32) * numOr(a.scaleY, 1);
					const [u, v] = Array.isArray(a.pivot) ? a.pivot.map((n) => numOr(n, 0.5)) : [0.5, 0.5];
					const r = (numOr(a.rotation, 0) * Math.PI) / 180;
					for (const px of [-u * w, (1 - u) * w])
						for (const py of [-(1 - v) * h, v * h])
							add(
								bone,
								numOr(a.x, 0) + px * Math.cos(r) - py * Math.sin(r),
								numOr(a.y, 0) + px * Math.sin(r) + py * Math.cos(r),
							);
				} else if (type === 'mesh') {
					const v = Array.isArray(a.vertices) ? a.vertices.map((n) => numOr(n, NaN)) : [];
					const uvs = Array.isArray(a.uvs) ? a.uvs.length : 0;
					if (v.length === uvs) for (let i = 0; i + 1 < v.length; i += 2) add(bone, v[i], v[i + 1]);
					// Weighted: per vertex its influence count, then (bone index, x, y, weight) per
					// influence, each point in that bone's own space.
					else
						for (let i = 0; i < v.length;) {
							const n = v[i++];
							if (!Number.isInteger(n) || n < 0) break;
							for (let k = 0; k < n && i + 2 < v.length; k++, i += 4)
								add(names[v[i]], v[i + 1], v[i + 2]);
						}
				}
			}
		}
	const cards = new Map<string, Card>();
	for (const [bone, [x0, x1, h]] of points)
		if (Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), h) > 1e-6) cards.set(bone, { x0, x1, h });
	return cards;
}

/** The largest of a constraint's mixes, 4.2's defaults filled in. */
function mixesOf(kind: string, c: Json): number {
	const one = (f: string, d: number) => numOr(c[f], d);
	if (kind === 'ik') return one('mix', 1);
	if (kind === 'physics') return one('mix', 1);
	const mixX = one('mixX', 1);
	const pair = [one('mixRotate', 1), mixX, one('mixY', mixX)];
	if (kind === 'path') return Math.max(...pair);
	const mixScaleX = one('mixScaleX', 1);
	return Math.max(...pair, mixScaleX, one('mixScaleY', mixScaleX), one('mixShearY', 1));
}
const KINDS = ['ik', 'transform', 'path', 'physics'] as const;

/** The bones listed parents and followed bones first, otherwise in the irig's order. */
function ordered(bones: Bone3d[]): Bone3d[] {
	const byName = new Map(bones.map((b) => [b.name, b]));
	const out: Bone3d[] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (b: Bone3d) => {
		if (state.get(b.name)) return;
		state.set(b.name, 'visiting');
		for (const dep of [b.parent, b.follow]) {
			const d = dep === undefined ? undefined : byName.get(dep);
			if (d && !state.get(d.name)) visit(d);
		}
		state.set(b.name, 'done');
		out.push(b);
	};
	bones.forEach(visit);
	return out;
}

/** The bake's rig: the irig's skeleton, the sidecar's depths, followers, drawings and settings. */
export function rigOf(irig: Json, doc: Rig3dDoc): Rig3d {
	const cards = cardsOf(irig);
	const bones = bonesOf(irig).map((b): Bone3d => {
		const n = str(b.name) ?? '';
		const side = doc.bones?.[n];
		const bone: Bone3d = { name: n };
		const parent = str(b.parent);
		if (parent !== undefined) bone.parent = parent;
		if (finite(b.length)) bone.length = b.length;
		if (side?.follow !== undefined) bone.follow = side.follow;
		// A follower's 2D setup is the bake's to derive (where its 3D setup projects): what the irig
		// holds is the last bake's, so it is not read back as input.
		else {
			if (finite(b.x)) bone.x = b.x;
			if (finite(b.y)) bone.y = b.y;
			if (finite(b.rotation)) bone.rotate = b.rotation;
			if (finite(b.scaleX)) bone.scaleX = b.scaleX;
			if (finite(b.scaleY)) bone.scaleY = b.scaleY;
		}
		if (finite(b.shearX)) bone.shearX = b.shearX;
		if (finite(b.shearY)) bone.shearY = b.shearY;
		if (typeof b.inherit === 'string') bone.inherit = b.inherit as Inherit;
		if (side?.depth !== undefined) bone.depth = side.depth;
		const card = cards.get(n);
		if (card) bone.card = card;
		return bone;
	});
	const layerOf = new Map<string, string>();
	for (const [layer, members] of Object.entries(doc.layers ?? {}))
		for (const slot of members) layerOf.set(slot, layer);
	const slots = slotsOf(irig).map((s): Slot3d => {
		const n = str(s.name) ?? '';
		const slot: Slot3d = { name: n, bone: str(s.bone) ?? '' };
		const layer = layerOf.get(n);
		if (layer !== undefined) slot.layer = layer;
		const attachment = str(s.attachment);
		if (attachment !== undefined) slot.attachment = attachment;
		const view = doc.views?.[n];
		if (view) {
			slot.drawings = view.drawings.map((d) => ({ attachment: d.attachment, turn: d.turn }));
			if (view.margin !== undefined) slot.margin = view.margin;
			if (view.hold !== undefined) slot.hold = view.hold;
		}
		return slot;
	});
	const constraints: Constraint3d[] = [];
	for (const kind of KINDS)
		for (const c of objects(irig[kind]))
			constraints.push({
				name: `${kind} ${str(c.name) ?? ''}`,
				bones:
					kind === 'physics'
						? [str(c.bone) ?? '']
						: (Array.isArray(c.bones) ? c.bones : []).filter((b) => typeof b === 'string'),
				mix: mixesOf(kind, c),
			});
	const rig: Rig3d = { bones: ordered(bones), slots, constraints };
	if (doc.tolerance !== undefined) rig.tolerance = doc.tolerance;
	if (doc.floor !== undefined) rig.floor = doc.floor;
	if (doc.hysteresis !== undefined) rig.hysteresis = doc.hysteresis;
	if (doc.turnaround !== undefined) rig.turnaround = doc.turnaround;
	return rig;
}

/** A 3D clip as the bake takes it, and what the bake owns of the irig's clip. */
export interface ClipPlan {
	clip: Clip3d;
	/** Bones whose timelines the bake writes: every bone it keys and every bone the sidecar keys. */
	owned: string[];
	/** Slots whose attachment keys it writes: those with drawings by angle. */
	slots: string[];
	/** What the irig's clip keys that the bake cannot read. */
	problems: string[];
}

/** The 4.2 timelines a bone the bake hangs from may carry; the bake reads no others. */
const CARRIED_TIMELINES = new Set(['rotate', 'translate', 'scale']);

/**
 * The bake's input for clip `name`: the sidecar's 3D keys, and the irig's own 2D keys on every bone
 * the baked bones hang from (their parents as played). Never the irig's keys on a bone the bake
 * owns: those are the last bake's output, not input.
 */
export function clipOf(rig: Rig3d, irig: Json, doc: Rig3dDoc, name: string): ClipPlan {
	const side = doc.clips?.[name] ?? { bones: {} };
	const anim = animationOf(irig, name);
	const keyed = new Set([
		...bakedBonesOf(rig, { name, duration: 1, bones: side.bones }),
		...Object.keys(side.bones),
	]);
	const owned = rig.bones.map((b) => b.name).filter((b) => keyed.has(b));
	const parentOf = new Map(rig.bones.map((b) => [b.name, b.parent]));
	const carried = new Set<string>();
	for (const b of owned)
		for (let p = parentOf.get(b); p !== undefined && !keyed.has(p); p = parentOf.get(p))
			carried.add(p);
	const bones: Record<string, BoneKeys3d> = { ...side.bones };
	const problems: string[] = [];
	const irigBones = isObj(anim?.bones) ? anim.bones : {};
	for (const b of carried) {
		const t = irigBones[b];
		if (!isObj(t)) continue;
		for (const k of Object.keys(t))
			if (!CARRIED_TIMELINES.has(k))
				problems.push(
					`clip ${name}: bone ${b} carries bones baked from 3D and keys ${k} in 2D (the bake reads only rotate, translate and scale on the bones it hangs from)`,
				);
		const keys: BoneKeys3d = {};
		if (Array.isArray(t.rotate)) keys.rotate = t.rotate as Key1[];
		if (Array.isArray(t.translate)) keys.translate = t.translate as Key2[];
		if (Array.isArray(t.scale)) keys.scale = t.scale as Key2[];
		bones[b] = keys;
	}
	let duration = side.duration ?? 0;
	for (const keys of Object.values(bones))
		for (const ks of Object.values(keys) as { time?: number }[][])
			for (const k of ks) if (finite(k.time)) duration = Math.max(duration, k.time);
	const constraints: Record<string, MixKey[]> = {};
	for (const kind of KINDS) {
		const keyedBy = isObj(anim?.[kind]) ? (anim[kind] as Json) : {};
		for (const [c, value] of Object.entries(keyedBy)) {
			const keys = kind === 'ik' || kind === 'transform' ? value : isObj(value) ? value.mix : null;
			if (!Array.isArray(keys)) continue;
			const mixKeys = objects(keys).map((k): MixKey => ({
				time: numOr(k.time, 0),
				mix: kind === 'physics' ? numOr(k.value, 0) : mixesOf(kind, k),
			}));
			const targets =
				kind === 'physics' && c === '' ? objects(irig.physics).map((p) => str(p.name) ?? '') : [c];
			for (const t of targets)
				if (!(kind === 'physics' && c === '' && constraints[`${kind} ${t}`]))
					constraints[`${kind} ${t}`] = mixKeys;
		}
	}
	return {
		clip: { name, duration, bones, constraints },
		owned,
		slots: rig.slots.filter((s) => s.drawings?.length).map((s) => s.name),
		problems,
	};
}

/** The rig's followers: bones drawn on another bone in 3D, whose 2D setup the bake derives. */
export const followersOf = (doc: Rig3dDoc): string[] =>
	Object.entries(doc.bones ?? {})
		.filter(([, b]) => b.follow !== undefined)
		.map(([n]) => n);

/**
 * The irig with clip `name` replaced by its bake where the bake owns it — its bones' timelines, the
 * draw order, the drawing slots' attachment keys — and every follower's derived setup. The rest of
 * the clip (slot colours, deform, events, other bones) is left as it was.
 */
export function withBake(
	irig: Json,
	name: string,
	plan: Pick<ClipPlan, 'owned' | 'slots'>,
	bake: Pick<Bake2p5d, 'animation' | 'setup'>,
	followers: string[],
): Json {
	const out = structuredClone(irig);
	const all = isObj(out.animations) ? out.animations : (out.animations = {});
	const anim = isObj(all[name]) ? all[name] : (all[name] = {});
	const bones = isObj(anim.bones) ? anim.bones : (anim.bones = {});
	for (const b of plan.owned) {
		const t = bake.animation.bones[b];
		if (t && Object.keys(t).length) bones[b] = t;
		else delete bones[b];
	}
	if (!Object.keys(bones).length) delete anim.bones;
	delete anim.draworder;
	if (bake.animation.drawOrder?.length) anim.drawOrder = bake.animation.drawOrder;
	else delete anim.drawOrder;
	const slots = isObj(anim.slots) ? anim.slots : (anim.slots = {});
	for (const s of plan.slots) {
		const own = isObj(slots[s]) ? slots[s] : (slots[s] = {});
		const keys = bake.animation.slots?.[s]?.attachment;
		if (keys?.length) own.attachment = keys;
		else delete own.attachment;
		if (!Object.keys(own).length) delete slots[s];
	}
	if (!Object.keys(slots).length) delete anim.slots;
	const follows = new Set(followers);
	for (const b of objects(out.bones)) {
		const n = str(b.name);
		const s = n === undefined ? undefined : bake.setup[n];
		if (!s || !follows.has(n ?? '')) continue;
		b.x = s.x;
		b.y = s.y;
		b.rotation = s.rotation;
		if (s.scaleX !== 1) b.scaleX = s.scaleX;
		else delete b.scaleX;
		if (s.scaleY !== 1) b.scaleY = s.scaleY;
		else delete b.scaleY;
	}
	return out;
}

// ── What the bake owns of a clip, comparable across a load and a save ──────────────────────────

/** A key's omitted values, as the Rigger fills them on load (`KEY_DEFAULTS` in view.html). */
const BONE_KEY_DEFAULTS: Record<string, [string, number][]> = {
	rotate: [['value', 0]],
	translate: [
		['x', 0],
		['y', 0],
	],
	translatex: [['value', 0]],
	translatey: [['value', 0]],
	scale: [
		['x', 1],
		['y', 1],
	],
	scalex: [['value', 1]],
	scaley: [['value', 1]],
	shear: [
		['x', 0],
		['y', 0],
	],
	shearx: [['value', 0]],
	sheary: [['value', 0]],
};

const normalKeys = (keys: unknown, defaults: [string, number][] = []): unknown[] | null => {
	if (!Array.isArray(keys) || !keys.length) return null;
	return keys.map((k) => {
		if (!isObj(k)) return k;
		const o: Json = { ...k, time: k.time ?? 0 };
		for (const [f, d] of defaults) if (o[f] === undefined) o[f] = d;
		if (o.curve === 'linear' || o.curve === undefined) delete o.curve;
		return o;
	});
};
const normalBone = (t: unknown): Json | null => {
	if (!isObj(t)) return null;
	const out: Json = {};
	for (const [k, keys] of Object.entries(t)) {
		const n = normalKeys(keys, BONE_KEY_DEFAULTS[k]);
		if (n) out[k] = n;
	}
	return Object.keys(out).length ? out : null;
};

/**
 * The parts of clip `name` a bake owns (`scope`), as one comparable value: its bones' timelines, its
 * draw order, its drawing slots' attachment keys and its followers' setup, with omitted key values
 * filled as the Rigger fills them on load — so a rig opened and saved unchanged compares equal.
 */
export function bakedParts(
	irig: Json,
	name: string,
	scope: { bones: string[]; slots: string[] },
	followers: string[],
): Json {
	const anim = animationOf(irig, name);
	const bones: Json = {};
	const animBones = isObj(anim?.bones) ? anim.bones : {};
	for (const b of [...scope.bones].sort()) bones[b] = normalBone(animBones[b]);
	const slots: Json = {};
	const animSlots = isObj(anim?.slots) ? anim.slots : {};
	for (const s of [...scope.slots].sort())
		slots[s] = normalKeys(isObj(animSlots[s]) ? animSlots[s].attachment : undefined);
	const setup: Json = {};
	const inScope = new Set(scope.bones);
	for (const b of bonesOf(irig)) {
		const n = str(b.name) ?? '';
		if (!followers.includes(n) || !inScope.has(n)) continue;
		setup[n] = [
			numOr(b.x, 0),
			numOr(b.y, 0),
			numOr(b.rotation, 0),
			numOr(b.scaleX, 1),
			numOr(b.scaleY, 1),
		];
	}
	return {
		clip: anim !== undefined,
		bones,
		drawOrder: normalKeys(anim?.drawOrder ?? anim?.draworder),
		slots,
		setup,
	};
}

/** Which of two `bakedParts` differ, by name: bones, `draw order`, slots and setups. */
export function partsDiffer(a: Json, b: Json): string[] {
	const same = (x: unknown, y: unknown) => canonicalJson(x) === canonicalJson(y);
	const out: string[] = [];
	if (a.clip !== b.clip) return ['the whole clip'];
	for (const group of ['bones', 'slots', 'setup'] as const) {
		const x = isObj(a[group]) ? a[group] : {};
		const y = isObj(b[group]) ? b[group] : {};
		for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
			if (!same(x[k], y[k]))
				out.push(group === 'bones' ? k : group === 'slots' ? `slot ${k}` : `${k}'s setup`);
	}
	if (!same(a.drawOrder, b.drawOrder)) out.push('draw order');
	return out;
}

/** JSON with every object's keys sorted: the same value always writes the same text. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_k, v: unknown) =>
		isObj(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]]),
				)
			: v,
	);
}
