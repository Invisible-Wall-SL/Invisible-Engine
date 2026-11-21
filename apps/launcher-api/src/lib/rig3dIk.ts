/**
 * Limbs in a 2.5D rig (docs/design/rig-controls.md §6.2, K4): a limb whose IK is one of
 * `rig3d.json`'s `ik` entries, solved in 3D by the bake. What K2's Limb card does on a 2D rig's native
 * IK, on the 3D data: ⇄ To IK and ⇄ To FK at a time or matched over a range, ⇄ Space, and making the
 * IK. Every switch writes plain keys — the control's and the pole's place, the FK bones' `orient`, the
 * IK's mix in the sidecar; the spaces' mixes on the irig's transforms — measured on the 3D pose the
 * bake bakes (`pose3d` of `clipOf`), so the bake carries the match to the game. Pure, so the page
 * (through `vendor/rigger-2p5d.js`) and the gate (`tools/rigger-spike/rig-ik3d.mjs`) run the same
 * code. A limb here is controls.json's (`ControlLimb`, with `ik3d`).
 */
import {
	boneKeysAt,
	ik3dProblems,
	pose3d,
	solveIk3d,
	type BoneKeys3d,
	type Curve,
	type Frame3d,
	type Ik3d,
	type IkMixKey,
	type Key1,
	type Key2,
	type QuatKey,
	type Rig3d,
} from './rig2p5d';
import { animationOf, clipOf, rigOf, type Rig3dDoc, type Rig3dIk } from './rig3d';
import { orientFromRotate } from './rig3dImport';
import { across, inverse3, unit, type V3 } from './rig3dMath';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A limb as controls.json keeps it (§4.3): its IK, FK bones, control, pole and spaces. */
export interface Limb3d {
	ik: string;
	fk: string[];
	control?: string;
	pole?: string;
	spaces?: Record<string, { bone: string; constraint: string }>;
}

/** Two key times closer than this are one. */
const EPS = 1e-4;
/** How long before a switch the old curves are held (K2's `LIMB_HOLD`). */
export const LIMB3D_HOLD = 1e-3;
const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;

// ── The rig's 3D IKs ────────────────────────────────────────────────────────────────────────────

/** The 3D IK `name` of a sidecar, or undefined. */
export const ik3dOf = (doc: Rig3dDoc | null, name: string): Rig3dIk | undefined =>
	doc?.ik?.find((e) => e.name === name);

type Bone = { name: string; parent?: string; length?: number };
const bonesOf = (irig: Json): Bone[] =>
	(Array.isArray(irig.bones) ? irig.bones : []).filter(isObj) as unknown as Bone[];

/** `name` and the bones above it, nearest first. */
function lineage(irig: Json, name: string): string[] {
	const by = new Map(bonesOf(irig).map((b) => [b.name, b]));
	const out: string[] = [];
	for (
		let b = by.get(name);
		b && !out.includes(b.name);
		b = b.parent ? by.get(b.parent) : undefined
	)
		out.push(b.name);
	return out;
}

/**
 * The 3D IK a two-bone chain ending at bone `lower` makes, reaching control `target`: its upper bone
 * is `lower`'s parent and its end the child of `lower` that sits off its origin (a template's wrist),
 * or the lower's own tip when it has a length. Null, with why, when it cannot be one.
 */
export function ik3dFor(
	irig: Json,
	doc: Rig3dDoc,
	lower: string,
	target: string,
	name = `${lower}_ik3d`,
): { ik: Rig3dIk } | { error: string } {
	const bones = bonesOf(irig);
	const l = bones.find((b) => b.name === lower);
	if (!l || !l.parent) return { error: `${lower} is not a bone under another` };
	const end = bones.find(
		(b) =>
			b.parent === lower &&
			Math.hypot(Number((b as Json).x ?? 0), Number((b as Json).y ?? 0)) > 1e-6,
	);
	const ik: Rig3dIk = { name, bones: [l.parent, lower], target };
	if (!((l.length ?? 0) > 0)) {
		if (!end) return { error: `${lower} has no length and no child at its end (a wrist)` };
		ik.end = end.name;
	}
	if (doc.ik?.some((e) => e.name === name)) return { error: `there is already a 3D IK ${name}` };
	const why = ik3dProblems(rigOf(irig, doc), ik as Ik3d)[0];
	return why ? { error: why.replace(/^3D IK [^:]*: /, '') } : { ik };
}

/** Why limb `limb` (a 3D one) of the rig cannot be switched, or null. */
export function limb3dProblem(irig: Json, doc: Rig3dDoc | null, limb: Limb3d): string | null {
	const e = ik3dOf(doc, limb.ik);
	if (!e) return `its 3D IK "${limb.ik}" is gone`;
	if (e.target !== limb.control)
		return `its 3D IK now reaches "${e.target}", not its control "${limb.control}" — forget the limb and make it again`;
	if (!e.bones.every((b) => limb.fk.includes(b)))
		return "its 3D IK's chain is not among its FK bones — forget the limb and make it again";
	const names = new Set(bonesOf(irig).map((b) => b.name));
	for (const n of [...e.bones, e.target, e.pole, e.end, ...limb.fk])
		if (n !== undefined && !names.has(n)) return `its bone "${n}" is gone`;
	for (const [s, sp] of Object.entries(limb.spaces ?? {}))
		if (
			!names.has(sp.bone) ||
			!(Array.isArray(irig.transform) ? irig.transform : []).some(
				(c) => isObj(c) && c.name === sp.constraint,
			)
		)
			return `its space "${s}" lost its bone or constraint`;
	return null;
}

// ── Keys on a curve ─────────────────────────────────────────────────────────────────────────────

/** The cubic (t1, v1) (cx1, cy1) (cx2, cy2) (t2, v2) split where its time is `at` (de Casteljau). */
function splitAt(c: number[], t1: number, v1: number, t2: number, v2: number, at: number) {
	const [cx1, cy1, cx2, cy2] = c;
	const X = (q: number) => {
		const u = 1 - q;
		return u * u * u * t1 + 3 * u * u * q * cx1 + 3 * u * q * q * cx2 + q * q * q * t2;
	};
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 48; i++) {
		const m = (lo + hi) / 2;
		if (X(m) < at) lo = m;
		else hi = m;
	}
	const q = (lo + hi) / 2;
	const L = (a: number, b: number) => a + (b - a) * q;
	const [ax, ay, bx, by, kx, ky] = [
		L(t1, cx1),
		L(v1, cy1),
		L(cx1, cx2),
		L(cy1, cy2),
		L(cx2, t2),
		L(cy2, v2),
	];
	const [dx, dy, ex, ey] = [L(ax, bx), L(ay, by), L(bx, kx), L(by, ky)];
	return { before: [ax, ay, dx, dy], after: [ex, ey, kx, ky], value: L(dy, ey) };
}

type ValueKey = { time?: number; curve?: Curve } & Record<string, unknown>;

/**
 * A key at `at` that changes nothing the channel plays (or the key already there): before its first
 * key the setup `rest` held to it (stepped); on a linear or stepped run a point of it; inside an eased
 * one the cubic split, each half drawing the curve. `fields` are the key's values in the curve's order.
 */
function onCurve<K extends ValueKey>(
	keys: K[],
	at: number,
	fields: string[],
	rest: Record<string, number>,
): K {
	const have = keys.find((k) => Math.abs((k.time ?? 0) - at) < EPS);
	if (have) return have;
	let i = keys.length;
	while (i > 0 && (keys[i - 1].time ?? 0) > at) i--;
	const prev = keys[i - 1];
	const next = keys[i];
	const key = { time: round(at) } as K;
	const val = (k: K | undefined, f: string): number => {
		const v = k?.[f];
		return typeof v === 'number' ? v : rest[f];
	};
	for (const f of fields) (key as Json)[f] = prev ? val(prev, f) : rest[f];
	if (!prev) {
		if (next) key.curve = 'stepped';
	} else if (next && prev.curve === 'stepped') key.curve = 'stepped';
	else if (next) {
		const t1 = prev.time ?? 0;
		const t2 = next.time ?? 0;
		const u = (at - t1) / (t2 - t1);
		const eased = Array.isArray(prev.curve);
		const before = eased ? (prev.curve as number[]).slice() : [];
		const after: number[] = [];
		fields.forEach((f, vi) => {
			const v1 = val(prev, f);
			const v2 = val(next, f);
			const c = before.slice(vi * 4, vi * 4 + 4);
			if (eased && c.length === 4) {
				const sp = splitAt(c, t1, v1, t2, v2, at);
				before.splice(vi * 4, 4, ...sp.before);
				after.push(...sp.after);
				(key as Json)[f] = sp.value;
			} else {
				const v = v1 + (v2 - v1) * u;
				(key as Json)[f] = v;
				if (eased) {
					const d = t2 - at;
					after.push(at + d / 3, v + (v2 - v) / 3, at + (2 * d) / 3, v + (2 * (v2 - v)) / 3);
				}
			}
		});
		if (eased) {
			prev.curve = before;
			key.curve = after;
		}
	}
	keys.splice(i, 0, key);
	return key;
}

/** An `orient` key at `at` that changes nothing its run plays (the slerp's progress split there). */
function orientOnCurve(keys: QuatKey[], at: number): QuatKey {
	const have = keys.find((k) => Math.abs((k.time ?? 0) - at) < EPS);
	if (have) return have;
	let i = keys.length;
	while (i > 0 && (keys[i - 1].time ?? 0) > at) i--;
	const prev = keys[i - 1];
	const next = keys[i];
	const value = boneKeysAt({ orient: keys }, at).orient;
	const key: QuatKey = { time: round(at), value };
	if (!prev) {
		if (next) key.curve = 'stepped';
	} else if (next && prev.curve === 'stepped') key.curve = 'stepped';
	else if (next && Array.isArray(prev.curve) && prev.curve.length >= 4) {
		const t1 = prev.time ?? 0;
		const t2 = next.time ?? 0;
		const sp = splitAt(prev.curve.slice(0, 4), t1, 0, t2, 1, at);
		const p = sp.value;
		// Each half's progress runs 0 → 1 over its own part of the arc (slerp is linear in angle).
		const b = sp.before;
		const a = sp.after;
		prev.curve = p > 1e-9 ? [b[0], b[1] / p, b[2], b[3] / p] : undefined;
		key.curve = p < 1 - 1e-9 ? [a[0], (a[1] - p) / (1 - p), a[2], (a[3] - p) / (1 - p)] : undefined;
		if (prev.curve === undefined) delete prev.curve;
		if (key.curve === undefined) delete key.curve;
	}
	keys.splice(i, 0, key);
	return key;
}

/** Hold what a channel played just before a switch at `t` (a stepped key `LIMB3D_HOLD` before it). */
function holdBefore(
	keys: ValueKey[] | QuatKey[],
	t: number,
	orient: boolean,
	fields: string[],
	rest: Record<string, number>,
): void {
	const at = t - LIMB3D_HOLD;
	if (at <= EPS || keys.some((k) => (k.time ?? 0) > at - EPS && (k.time ?? 0) < t - EPS)) return;
	const k = orient
		? orientOnCurve(keys as QuatKey[], at)
		: onCurve(keys as ValueKey[], at, fields, rest);
	k.curve = 'stepped';
}

/** Put `key` at its time in `keys` (replacing one there), stepped to the next when `stepped`. */
function upsert<K extends { time?: number; curve?: Curve }>(keys: K[], key: K): K {
	const at = keys.findIndex((k) => Math.abs((k.time ?? 0) - (key.time ?? 0)) < EPS);
	if (at >= 0) {
		const curve = keys[at].curve;
		keys[at] = { ...key, ...(curve === undefined || key.curve !== undefined ? {} : { curve }) };
		return keys[at];
	}
	let i = keys.length;
	while (i > 0 && (keys[i - 1].time ?? 0) > (key.time ?? 0)) i--;
	keys.splice(i, 0, key);
	return key;
}

// ── Measuring and keying the 3D pose ────────────────────────────────────────────────────────────

interface Clip3dEdit {
	irig: Json;
	doc: Rig3dDoc;
	clip: string;
}

/** The clip's 3D pose at any time, as the bake bakes it; `mix0`: with 3D IK `mix0` off. */
function poserOf(x: Clip3dEdit, mix0?: string) {
	const rig: Rig3d = rigOf(x.irig, x.doc);
	const plan = clipOf(rig, x.irig, x.doc, x.clip);
	const clip = mix0
		? { ...plan.clip, ik: { ...plan.clip.ik, [mix0]: [{ time: 0, mix: 0 }] } }
		: plan.clip;
	const solved = solveIk3d(rig, clip);
	return { rig, plan, solved, at: (t: number) => pose3d(rig, solved, t) };
}

/** The sidecar node of bone `name` in the clip, made — and its 2D keys lifted from the irig — when new. */
function nodeOf(x: Clip3dEdit, owned: Set<string>, name: string): BoneKeys3d {
	const side = x.doc.clips?.[x.clip];
	if (!side) throw new Error(`${x.clip} is not a 3D clip`);
	const have = side.bones[name];
	if (have) return have;
	const node: BoneKeys3d = {};
	if (!owned.has(name)) {
		const t = animationOf(x.irig, x.clip)?.bones;
		const own = isObj(t) && isObj(t[name]) ? t[name] : {};
		if (Array.isArray(own.rotate)) node.rotate = structuredClone(own.rotate) as Key1[];
		if (Array.isArray(own.translate)) node.translate = structuredClone(own.translate) as Key2[];
		if (Array.isArray(own.scale)) node.scale = structuredClone(own.scale) as Key2[];
	}
	side.bones[name] = node;
	return node;
}

/**
 * Key bone `name` at `t` so its origin lands at world point `p` under its parent's frame `parent`
 * (the 3D pose at t): its translate and depth, from its setup. `hold`: a switch, which keeps what
 * played before t.
 */
function keyPlace(
	x: Clip3dEdit,
	owned: Set<string>,
	name: string,
	parent: Frame3d | undefined,
	p: readonly number[],
	t: number,
	hold: boolean,
): boolean {
	const b = bonesOf(x.irig).find((n) => n.name === name) as (Bone & Json) | undefined;
	if (!b) return false;
	const inv = parent ? inverse3(parent.m) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
	if (!inv) return false;
	const d = parent ? [p[0] - parent.o[0], p[1] - parent.o[1], p[2] - parent.o[2]] : [...p];
	const o = [0, 1, 2].map((r) => inv[r * 3] * d[0] + inv[r * 3 + 1] * d[1] + inv[r * 3 + 2] * d[2]);
	const node = nodeOf(x, owned, name);
	const depth0 = x.doc.bones?.[name]?.depth ?? 0;
	node.translate = node.translate ?? [];
	node.depth = node.depth ?? [];
	if (hold) {
		holdBefore(node.translate as ValueKey[], t, false, ['x', 'y'], { x: 0, y: 0 });
		holdBefore(node.depth as ValueKey[], t, false, ['value'], { value: 0 });
	}
	upsert(node.translate, {
		time: t,
		x: round(o[0] - Number(b.x ?? 0)),
		y: round(o[1] - Number(b.y ?? 0)),
	});
	upsert(node.depth, { time: t, value: round(o[2] - depth0) });
	return true;
}

/** Key 3D IK `name`'s mix at `t`: a switch (held before, stepped to the next key) or a matched key. */
function keyMix(x: Clip3dEdit, name: string, t: number, mix: number, first: boolean): void {
	const side = x.doc.clips?.[x.clip];
	if (!side) return;
	const all = (side.ik = side.ik ?? {});
	const keys = (all[name] = all[name] ?? []);
	const rest = { mix: ik3dOf(x.doc, name)?.mix ?? 0 };
	if (first) holdBefore(keys as unknown as ValueKey[], t, false, ['mix'], rest);
	const k = onCurve(keys as unknown as ValueKey[], t, ['mix'], rest) as unknown as IkMixKey;
	k.mix = mix;
	if (first) {
		if (keys.some((o) => (o.time ?? 0) > t + EPS)) k.curve = 'stepped';
		else delete k.curve;
	}
}

/** The 3D IK `name`'s mix at `t` in the clip (its setup mix before its first key). */
export function ik3dMixAt(doc: Rig3dDoc, clip: string, name: string, t: number): number {
	const keys = doc.clips?.[clip]?.ik?.[name];
	const rest = ik3dOf(doc, name)?.mix ?? 0;
	if (!keys?.length || t < (keys[0].time ?? 0)) return rest;
	return boneKeysAt({ depth: keys.map((k) => ({ time: k.time, value: k.mix, curve: k.curve })) }, t)
		.depth;
}

/** Every 3D IK's mix at `t` (for the stage's held pose). */
export function ik3dMixesAt(doc: Rig3dDoc | null, clip: string, t: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const e of doc?.ik ?? []) out[e.name] = ik3dMixAt(doc as Rig3dDoc, clip, e.name, t);
	return out;
}

/**
 * One value of a 4.2 key list at `t` — field `field`, eased by its own part of each key's curve (the
 * `at`-th value's four numbers) — and `rest` before the first key, as the runtime reads it.
 */
function keyedAt(
	keys: Json[],
	field: (k: Json) => number,
	at: number,
	rest: number,
	t: number,
): number {
	if (!keys.length || t < Number(keys[0].time ?? 0)) return rest;
	return boneKeysAt(
		{
			depth: keys.map((k) => ({
				time: Number(k.time ?? 0),
				value: field(k),
				curve: Array.isArray(k.curve)
					? k.curve.slice(at * 4, at * 4 + 4)
					: (k.curve as Curve | undefined),
			})),
		},
		t,
	).depth;
}

/** The space limb `limb`'s control follows at `t` (its transform at full mix), or null. */
export function limb3dSpaceAt(irig: Json, clip: string, limb: Limb3d, t: number): string | null {
	const keyed = animationOf(irig, clip)?.transform;
	for (const [name, sp] of Object.entries(limb.spaces ?? {})) {
		const c = (Array.isArray(irig.transform) ? irig.transform : []).find(
			(x) => isObj(x) && x.name === sp.constraint,
		) as Json | undefined;
		if (!c) continue;
		const keys =
			isObj(keyed) && Array.isArray(keyed[sp.constraint]) ? (keyed[sp.constraint] as Json[]) : [];
		// Its rotate and translate mixes, each eased by its own curve (a key's values: mixRotate, mixX,
		// mixY, …), as the runtime plays them; it is followed when all three are full.
		const mixX = (k: Json) => Number(k.mixX ?? 1);
		const mix = Math.min(
			keyedAt(keys, (k) => Number(k.mixRotate ?? 1), 0, Number(c.mixRotate ?? 1), t),
			keyedAt(keys, mixX, 1, Number(c.mixX ?? 1), t),
			keyedAt(keys, (k) => Number(k.mixY ?? mixX(k)), 2, Number(c.mixY ?? c.mixX ?? 1), t),
		);
		if (mix >= 0.999) return name;
	}
	return null;
}

/** The bone whose keys place limb `limb`'s control at `t`: the space bone it follows, else itself. */
export function limb3dCarrierAt(
	irig: Json,
	clip: string,
	limb: Limb3d,
	t: number,
): string | undefined {
	const sp = limb3dSpaceAt(irig, clip, limb, t);
	return sp ? limb.spaces?.[sp].bone : limb.control;
}

/** The times in [t0, t1] a switch of `limb` is matched at: t0, t1 and every key of what moves either side. */
export function limb3dMatchTimes(
	irig: Json,
	doc: Rig3dDoc,
	clip: string,
	limb: Limb3d,
	t0: number,
	t1: number,
): number[] {
	const e = ik3dOf(doc, limb.ik);
	const watched = new Set<string>();
	for (const n of [
		...limb.fk,
		limb.control,
		e?.pole,
		...Object.values(limb.spaces ?? {}).map((s) => s.bone),
	])
		if (n !== undefined) for (const b of lineage(irig, n)) watched.add(b);
	const times = [t0, t1];
	const add = (keys: unknown) => {
		if (Array.isArray(keys)) for (const k of keys) if (isObj(k)) times.push(Number(k.time ?? 0));
	};
	const anim = animationOf(irig, clip);
	const side = doc.clips?.[clip];
	for (const b of watched) {
		for (const keys of Object.values(side?.bones[b] ?? {})) add(keys);
		const own = isObj(anim?.bones) ? (anim.bones as Json)[b] : undefined;
		if (isObj(own)) for (const keys of Object.values(own)) add(keys);
	}
	add(side?.ik?.[limb.ik]);
	const tr = anim?.transform;
	for (const sp of Object.values(limb.spaces ?? {})) add(isObj(tr) ? tr[sp.constraint] : undefined);
	const out: number[] = [];
	for (const t of times.map((v) => round(v)).sort((a, b) => a - b))
		if (t >= t0 - EPS && t <= t1 + EPS && !(out.length && t - out[out.length - 1] < EPS))
			out.push(t);
	return out;
}

const sub = (a: readonly number[], b: readonly number[]): V3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];

/**
 * ⇄ To IK / ⇄ To FK on 3D limb `limb` at `t0`, matched at every `limb3dMatchTimes` up to `t1`, with no
 * jump. To IK keys the control (or the space bone it follows) on the FK wrist, the pole off the FK
 * elbow on its side of the shoulder → wrist line, and steps the mix to 1: the solve then reaches the
 * FK pose. To FK keys the FK bones' turn (and scale, when the IK stretches) at the solved pose and
 * steps the mix to 0. Returns the edited sidecar and the times, or why not (nothing is written then).
 */
export function switchLimb3d(
	x: Clip3dEdit & { limb: Limb3d; to: 'ik' | 'fk'; t0: number; t1?: number | null },
): { doc: Rig3dDoc; times: number[] } | { error: string } {
	const why = limb3dProblem(x.irig, x.doc, x.limb);
	if (why) return { error: why };
	if (!x.doc.clips?.[x.clip] || x.doc.clips[x.clip].transition)
		return { error: `${x.clip} is not a 3D clip` };
	const e = ik3dOf(x.doc, x.limb.ik) as Rig3dIk;
	const edit: Clip3dEdit = { irig: x.irig, doc: structuredClone(x.doc), clip: x.clip };
	const t0 = round(x.t0);
	const times = limb3dMatchTimes(
		x.irig,
		edit.doc,
		x.clip,
		x.limb,
		t0,
		x.t1 == null ? t0 : Math.max(t0, round(x.t1)),
	);
	const parentOf = new Map(bonesOf(x.irig).map((b) => [b.name, b.parent]));
	if (x.to === 'ik') {
		// The chain's 2D keys (an arm keyed only in 2D, on a clip just made 3D) go into the 3D data
		// first, as the next bake would put them: the FK wrist is measured as it plays.
		const before = new Set(poserOf(edit, e.name).plan.owned);
		const keyed2d = animationOf(x.irig, x.clip)?.bones;
		for (const n of [...e.bones, e.end])
			if (n !== undefined && isObj(keyed2d) && isObj(keyed2d[n]) && Object.keys(keyed2d[n]).length)
				nodeOf(edit, before, n);
		const fk = poserOf(edit, e.name);
		const owned = new Set(fk.plan.owned);
		const len = bonesOf(x.irig).find((b) => b.name === e.bones[1])?.length ?? 0;
		const measured = times.map((t) => {
			const w = fk.at(t);
			const lower = w.get(e.bones[1]) as Frame3d;
			const wrist = e.end
				? (w.get(e.end) as Frame3d).o
				: [0, 3, 6].map((r, i) => lower.m[r] * len + lower.o[i]);
			return { t, w, root: (w.get(e.bones[0]) as Frame3d).o, elbow: lower.o, wrist };
		});
		for (const m of measured) {
			const first = m.t === times[0];
			const carrier = limb3dCarrierAt(x.irig, x.clip, x.limb, m.t) ?? e.target;
			keyPlace(edit, owned, carrier, m.w.get(parentOf.get(carrier) ?? ''), m.wrist, m.t, first);
			if (e.pole) {
				const u = unit(sub(m.wrist, m.root));
				const side = u && across(sub(m.elbow, m.root), u);
				if (side) {
					const reach = Math.hypot(...sub(m.elbow, m.root));
					const at = m.elbow.map((v, i) => v + side[i] * reach);
					keyPlace(edit, owned, e.pole, m.w.get(parentOf.get(e.pole) ?? ''), at, m.t, first);
				}
			}
			keyMix(edit, e.name, m.t, 1, first);
		}
		return { doc: edit.doc, times };
	}
	const ik = poserOf(edit);
	const owned = new Set(ik.plan.owned);
	const solved = times.map((t) => ({
		t,
		bones: e.bones.map((n) => ({ n, v: boneKeysAt(ik.solved.bones[n] ?? {}, t) })),
	}));
	const grown = new Set(
		e.bones.filter((n) =>
			solved.some((m) =>
				m.bones.some((b) => {
					if (b.n !== n) return false;
					const fk = boneKeysAt(ik.plan.clip.bones[n] ?? {}, m.t);
					return Math.abs(b.v.scaleX - fk.scaleX) > 1e-6 || Math.abs(b.v.scaleY - fk.scaleY) > 1e-6;
				}),
			),
		),
	);
	const grows = (n: string) => grown.has(n);
	for (const m of solved) {
		const first = m.t === times[0];
		keyMix(edit, e.name, m.t, 0, first);
		for (const { n, v } of m.bones) {
			const node = nodeOf(edit, owned, n);
			if (!node.orient?.length) {
				node.orient = orientFromRotate(node.rotate ?? []);
				delete node.rotate;
			}
			if (first) holdBefore(node.orient, m.t, true, [], {});
			upsert(node.orient, { time: m.t, value: v.orient });
			if (grows(n)) {
				node.scale = node.scale ?? [];
				if (first) holdBefore(node.scale as ValueKey[], m.t, false, ['x', 'y'], { x: 1, y: 1 });
				upsert(node.scale, { time: m.t, x: round(v.scaleX, 6), y: round(v.scaleY, 6) });
			}
		}
	}
	return { doc: edit.doc, times };
}

/** The mixes K2's spaces key: the control takes its space bone's turn and place, never its scale. */
const SPACE_MIXES = (v: number) => ({
	mixRotate: v,
	mixX: v,
	mixY: v,
	mixScaleX: 0,
	mixScaleY: 0,
	mixShearY: 0,
});
const TC_FIELDS = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];

/**
 * ⇄ Space on 3D limb `limb` at `t`: from t its control follows space `to` (or its own keys, null)
 * where it is — the new carrier keyed at the control's 3D place at t — and the spaces' mixes step on
 * the irig's transforms, the new one to 1 and the one it followed to 0. Returns the edited sidecar
 * and irig, or why not.
 */
export function switchLimb3dSpace(
	x: Clip3dEdit & { limb: Limb3d; to: string | null; t: number },
): { doc: Rig3dDoc; irig: Json; carrier: string } | { error: string } {
	const why = limb3dProblem(x.irig, x.doc, x.limb);
	if (why) return { error: why };
	if (!x.doc.clips?.[x.clip] || x.doc.clips[x.clip].transition)
		return { error: `${x.clip} is not a 3D clip` };
	const spaces = x.limb.spaces ?? {};
	if (x.to !== null && !spaces[x.to]) return { error: `the limb has no space "${x.to}"` };
	const t = round(x.t);
	const now = limb3dSpaceAt(x.irig, x.clip, x.limb, t);
	if (now === x.to)
		return {
			error:
				x.to === null
					? 'it already follows its own keys here'
					: `it already follows "${x.to}" here`,
		};
	const control = x.limb.control as string;
	const edit: Clip3dEdit = {
		irig: structuredClone(x.irig),
		doc: structuredClone(x.doc),
		clip: x.clip,
	};
	const at = poserOf(edit);
	const w = at.at(t);
	const rig = at.rig;
	const where = placeIn(rig, at.solved, w, control, t);
	const carrier = x.to === null ? control : spaces[x.to].bone;
	const parentOf = new Map(bonesOf(edit.irig).map((b) => [b.name, b.parent]));
	keyPlace(
		edit,
		new Set(at.plan.owned),
		carrier,
		w.get(parentOf.get(carrier) ?? ''),
		where,
		t,
		true,
	);
	if (!isObj(edit.irig.animations)) edit.irig.animations = {};
	const anims = edit.irig.animations as Json;
	if (!isObj(anims[x.clip])) anims[x.clip] = {};
	const clip = anims[x.clip] as Json;
	if (!isObj(clip.transform)) clip.transform = {};
	const tr = clip.transform as Record<string, Json[]>;
	for (const [name, sp] of Object.entries(spaces)) {
		if (name !== x.to && name !== now) continue;
		const keys = (tr[sp.constraint] ??= []);
		const c = (edit.irig.transform as Json[]).find((v) => v.name === sp.constraint) as Json;
		const rest = Object.fromEntries(
			TC_FIELDS.map((f) => [
				f,
				Number(c[f] ?? (f === 'mixY' ? (c.mixX ?? 1) : f === 'mixScaleY' ? (c.mixScaleX ?? 1) : 1)),
			]),
		);
		holdBefore(keys as ValueKey[], t, false, TC_FIELDS, rest);
		const k = onCurve(keys as ValueKey[], t, TC_FIELDS, rest);
		Object.assign(k, SPACE_MIXES(name === x.to ? 1 : 0));
		if (keys.some((o) => Number(o.time ?? 0) > t + EPS)) k.curve = 'stepped';
		else delete k.curve;
	}
	return { doc: edit.doc, irig: edit.irig, carrier };
}

/** Where a control is at `t` as a 3D IK reads it: its own place, moved by its spaces' mixes. */
function placeIn(
	rig: Rig3d,
	clip: {
		constraints?: Record<string, { time?: number; mix: number; x?: number; curve?: Curve }[]>;
	},
	w: Map<string, Frame3d>,
	name: string,
	t: number,
): number[] {
	let p = (w.get(name) as Frame3d).o;
	for (const c of rig.constraints ?? []) {
		if (c.space === undefined || !c.bones.includes(name)) continue;
		const keys = clip.constraints?.[c.name];
		const m = keyedAt(
			(keys ?? []) as unknown as Json[],
			(k) => Number(k.x ?? k.mix),
			1,
			c.spaceMix ?? c.mix,
			t,
		);
		const s = (w.get(c.space) as Frame3d).o;
		if (m) p = p.map((v, i) => v + (s[i] - v) * m);
	}
	return p;
}
