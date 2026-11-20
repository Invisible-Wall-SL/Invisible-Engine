/**
 * Posing a 2.5D rig in the Rigger (docs/design/rig-2p5d.md §9, P3). Pure, so the page (through
 * `vendor/rigger-2p5d.js`) and the gates run the same code.
 *
 * - **The pose at one time, for any view** (`viewPose`): the rig held at its pose at the playhead, its
 *   root turned about the vertical by the view's angle, baked by the bake every clip is baked by — so
 *   the stage draws, through engine-rig, the 2D pose a game would play for that camera: each baked
 *   bone's local, the draw order from depth and the drawings by angle.
 * - **Editing a 3D clip** (`editClip3d`, then `bakeClip3d`): an edit runs on the clip as its author
 *   keys it (`authoringOf`: the sidecar's keys in place of the bake's), then every bone the bake will
 *   own takes its 2D keys into the sidecar and the clip is baked into the `.irig`, as the save bakes it.
 * - **Angles over quaternions**: `anglesAt` reads a bone's rotate / tilt / twist at a time, each key
 *   read nearest the one before (`anglesOf`), and `keyAngles` writes them back as a key's quaternion
 *   (`orientOf`), splitting a run that would turn more than 180°.
 */
import {
	anglesOf,
	bake2p5d,
	bakedBonesOf,
	keysAt,
	orientOf,
	rig2p5dProblems,
	type Angles,
	type Bake2p5d,
	type BoneKeys3d,
	type Clip3d,
	type Held3d,
	type Key1,
	type QuatKey,
	type Rig3d,
} from './rig2p5d';
import {
	clipOf,
	followersOf,
	rigOf,
	withBake,
	type ClipPlan,
	type Rig3dClip,
	type Rig3dDoc,
} from './rig3d';
import { authoringOf, orientFromRotate } from './rig3dImport';
import { matOf, mul3, quatOf, rotZ } from './rig3dMath';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** How long a held pose lasts: the bake needs a clip of some length, and one check of it is enough. */
const HOLD = 1 / 480;
/** Two keys this close (s) are one key, as the Rigger's dopesheet reads them. */
const SAME_KEY = 1e-4;
/** The widest turn one `orient` run may take: slerp takes the shorter arc. */
const MAX_RUN = 179;

/** A rig's pose at one time as a clip of that length: every channel one key at 0. */
export function heldClip(bones: Record<string, Held3d>): Clip3d {
	const out: Clip3d['bones'] = {};
	for (const [name, h] of Object.entries(bones)) {
		const k: BoneKeys3d = {};
		if (h.orient) k.orient = [{ time: 0, value: h.orient }];
		else if (h.rotate) k.rotate = [{ time: 0, value: h.rotate }];
		if (h.depth) k.depth = [{ time: 0, value: h.depth }];
		if (h.x || h.y) k.translate = [{ time: 0, x: h.x, y: h.y }];
		if (h.scaleX !== 1 || h.scaleY !== 1) k.scale = [{ time: 0, x: h.scaleX, y: h.scaleY }];
		out[name] = k;
	}
	return { name: 'pose', duration: HOLD, bones: out };
}

/**
 * The clip seen by a camera turned `deg` about the vertical: each root's turn composed with the
 * view's, about its own origin, so the rig turns in place (positive: its right side toward the viewer).
 */
export function turnedView(rig: Rig3d, clip: Clip3d, deg: number): Clip3d {
	if (!deg) return clip;
	const bones = { ...clip.bones };
	const view = matOf(orientOf(0, -deg, 0));
	for (const b of rig.bones) {
		if (b.parent !== undefined || b.follow !== undefined) continue;
		const own = bones[b.name] ?? {};
		const turn = own.orient?.length
			? matOf(own.orient[0].value)
			: matOf(orientOf(own.rotate?.[0]?.value ?? 0, 0, 0));
		const setup = b.rotate ?? 0;
		const value = quatOf(mul3(mul3(mul3(rotZ(-setup), view), rotZ(setup)), turn));
		const keys: BoneKeys3d = { ...own, orient: [{ time: 0, value }] };
		delete keys.rotate;
		bones[b.name] = keys;
	}
	return { ...clip, bones };
}

/** A bone's 2D local as engine-rig holds it (absolute, not offsets): what the stage draws. */
export interface Local2d {
	rotation: number;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	shearY: number;
}

export interface ViewPose {
	/** Every bone the bake keyed or passed through, at its pose. */
	bones: Record<string, Local2d>;
	/** The slots' draw order from depth, when depth moved any slot from the setup order; else null. */
	order: string[] | null;
	/** Per slot with drawings by angle, the drawing that faces the viewer best. */
	attachments: Record<string, string>;
	/** The bones the bake keyed. */
	baked: string[];
}

/**
 * The rig at pose `bones` (each bone's channels, `keysAt`; a bone left out is at its setup) seen by
 * a camera turned `deg` about the vertical, as the bake keys it. Constraints are not baked against:
 * the page's own update solves them after. Null, with the reasons, when the bake refuses the rig.
 */
export function viewPose(
	rig: Rig3d,
	bones: Record<string, Held3d>,
	deg: number,
): { pose: ViewPose } | { problems: string[] } {
	const free: Rig3d = { ...rig, constraints: [] };
	const clip = turnedView(free, heldClip(bones), deg);
	const problems = rig2p5dProblems(free, clip);
	if (problems.length) return { problems };
	const bake = bake2p5d(free, clip);
	const at = <K extends { time?: number }>(ks: K[] | undefined): K | undefined => ks?.[0];
	const out: Record<string, Local2d> = {};
	for (const name of new Set([...bake.baked, ...Object.keys(bake.animation.bones)])) {
		const s = bake.setup[name];
		const t = bake.animation.bones[name] ?? {};
		out[name] = {
			rotation: s.rotation + (at(t.rotate)?.value ?? 0),
			x: s.x + (at(t.translate)?.x ?? 0),
			y: s.y + (at(t.translate)?.y ?? 0),
			scaleX: s.scaleX * (at(t.scale)?.x ?? 1),
			scaleY: s.scaleY * (at(t.scale)?.y ?? 1),
			shearY: at(t.sheary)?.value ?? 0,
		};
	}
	const attachments: Record<string, string> = {};
	for (const [slot, keys] of Object.entries(bake.drawings))
		if (keys.length) attachments[slot] = keys[0].attachment;
	return {
		pose: {
			bones: out,
			order: bake.animation.drawOrder?.length ? bake.orderAt(0) : null,
			attachments,
			baked: bake.baked,
		},
	};
}

/** Clip `name`'s 3D keys at `t`, per bone the sidecar keys (none for a clip it does not have). */
export function sidecarAt(doc: Rig3dDoc | null, name: string, t: number): Record<string, Held3d> {
	const out: Record<string, Held3d> = {};
	const clip = doc?.clips?.[name];
	if (!clip || clip.transition) return out;
	for (const [b, keys] of Object.entries(clip.bones)) out[b] = keysAt(keys, t);
	return out;
}

/**
 * The bones a 3D clip's bake owns (`clipOf`): their 2D timelines in the irig are the bake's, their
 * keys the sidecar's. Empty for a clip the sidecar does not have.
 */
export function ownedBones(irig: Json, doc: Rig3dDoc | null, name: string): string[] {
	const clip = doc?.clips?.[name];
	if (!doc || !clip || clip.transition) return [];
	return clipOf(rigOf(irig, doc), irig, doc, name).owned;
}

// ── Angles ──────────────────────────────────────────────────────────────────────────────────────

/** Each `orient` key's angles, every one read nearest the key before it. */
export function keyAngles(keys: QuatKey[]): Angles[] {
	const out: Angles[] = [];
	for (const k of keys) out.push(anglesOf(k.value, out[out.length - 1]));
	return out;
}

/** A bone's rotate / tilt / twist at `t` (its setup's before its first key), read nearest the key before. */
export function anglesAt(keys: QuatKey[], t: number): Angles {
	const read = keyAngles(keys);
	let ref: Angles | undefined;
	keys.forEach((k, i) => {
		if ((k.time ?? 0) <= t + 1e-9) ref = read[i];
	});
	const q = keysAt({ orient: keys }, t).orient;
	return q ? anglesOf(q, ref) : { rotate: 0, tilt: 0, twist: 0 };
}

/**
 * `keys` with a key at `t` turned to `angles` (a key there keeps its curve; a new one runs linear).
 * A run from or to it that turns more than 180° is split, so the slerp goes the way the angles go.
 */
export function withAngles(keys: QuatKey[], t: number, angles: Angles): QuatKey[] {
	const read = keyAngles(keys);
	let i = keys.findIndex((k) => Math.abs((k.time ?? 0) - t) < SAME_KEY);
	const key: QuatKey = { time: t, value: orientOf(angles.rotate, angles.tilt, angles.twist) };
	const out = keys.map((k) => ({ ...k }));
	const ang = [...read];
	if (i >= 0) {
		key.time = keys[i].time ?? 0;
		if (keys[i].curve !== undefined) key.curve = keys[i].curve;
		out[i] = key;
		ang[i] = angles;
	} else {
		i = out.findIndex((k) => (k.time ?? 0) > t);
		if (i < 0) i = out.length;
		out.splice(i, 0, key);
		ang.splice(i, 0, angles);
	}
	const split = (a: number): void => {
		const b = a + 1;
		if (a < 0 || b >= out.length || out[a].curve === 'stepped') return;
		const turn = Math.max(
			...(['rotate', 'tilt', 'twist'] as const).map((c) => Math.abs(ang[b][c] - ang[a][c])),
		);
		const parts = Math.ceil(turn / MAX_RUN);
		if (parts <= 1) return;
		const t0 = out[a].time ?? 0;
		const t1 = out[b].time ?? 0;
		const mid: QuatKey[] = [];
		const midAng: Angles[] = [];
		for (let j = 1; j < parts; j++) {
			const u = j / parts;
			const x = (c: keyof Angles) => ang[a][c] + (ang[b][c] - ang[a][c]) * u;
			mid.push({ time: t0 + (t1 - t0) * u, value: orientOf(x('rotate'), x('tilt'), x('twist')) });
			midAng.push({ rotate: x('rotate'), tilt: x('tilt'), twist: x('twist') });
		}
		delete out[a].curve;
		out.splice(b, 0, ...mid);
		ang.splice(b, 0, ...midAng);
	};
	split(i);
	split(i - 1);
	return out;
}

// ── Editing a 3D clip ───────────────────────────────────────────────────────────────────────────

const TIMELINES = ['rotate', 'translate', 'scale'] as const;

/** The sidecar's keys an edit sees beside the authoring clip: each bone's `orient` and `depth`. */
export type Keys3d = Record<string, Pick<BoneKeys3d, 'orient' | 'depth'>>;

export interface Edited3d {
	doc: Rig3dDoc;
	/** The clip as its author keys it after the edit: the irig's clip until the bake writes over it. */
	animation: Json;
}

/**
 * An edit of clip `clip` of a 2.5D rig. `edit` runs on the clip as its author keys it — the 2D
 * timelines (`animation`, the sidecar's on every bone the bake owns) and each bone's 3D keys
 * (`keys`) — then every bone the bake will own takes its 2D keys into the sidecar. A bone the edit
 * turns in 3D must have its 2D turns made `orient` keys first (`turnIn3d`): a bone keys one or the
 * other. A clip the sidecar does not have yet becomes a 3D clip (§9, "3D from this clip").
 */
export function editClip3d(x: {
	irig: Json;
	doc: Rig3dDoc;
	clip: string;
	edit: (animation: Json, keys: Keys3d) => void;
}): Edited3d {
	const own = authoringOf(x.irig, x.doc, x.clip);
	const side = x.doc.clips?.[x.clip];
	if (side?.transition)
		throw new Error(`clip ${x.clip} is a baked transition: it has no keys of its own`);
	const keys: Keys3d = {};
	for (const [b, k] of Object.entries(side?.bones ?? {})) {
		const entry: Keys3d[string] = {};
		if (k.orient?.length) entry.orient = structuredClone(k.orient);
		if (k.depth?.length) entry.depth = structuredClone(k.depth);
		if (Object.keys(entry).length) keys[b] = entry;
	}
	const animation = own.animation;
	x.edit(animation, keys);
	const animBones = isObj(animation.bones) ? animation.bones : {};
	const bones: Record<string, BoneKeys3d> = {};
	for (const [b, k] of Object.entries(keys)) {
		const entry: BoneKeys3d = {};
		if (k.orient?.length) entry.orient = k.orient;
		if (k.depth?.length) entry.depth = k.depth;
		if (Object.keys(entry).length) bones[b] = entry;
	}
	const irig: Json = {
		...x.irig,
		animations: { ...(x.irig.animations as Json), [x.clip]: animation },
	};
	const rig = rigOf(irig, x.doc);
	const owned = new Set([
		...bakedBonesOf(rig, { name: x.clip, duration: 1, bones }),
		...Object.keys(bones),
		...Object.keys(side?.bones ?? {}),
	]);
	for (const b of owned) {
		const t = animBones[b];
		if (!isObj(t)) continue;
		if (bones[b]?.orient && Array.isArray(t.rotate) && t.rotate.length)
			throw new Error(`bone ${b} keys both a 3D turn and a 2D rotate: turn it in 3D first`);
		for (const name of TIMELINES)
			if (Array.isArray(t[name]) && t[name].length)
				(bones[b] ??= {})[name] = structuredClone(t[name]) as Key1[];
	}
	if (!Object.keys(animBones).length) delete animation.bones;
	const clip: Rig3dClip = {
		...(side?.duration ? { duration: side.duration } : {}),
		bones,
		...(side?.baked ? { baked: side.baked } : {}),
	};
	const doc: Rig3dDoc = { ...x.doc, clips: { ...x.doc.clips, [x.clip]: clip } };
	// A clip keyed only at 0 s (a pose) is held for one check: a clip of no length cannot be baked.
	if (!(clipOf(rig, irig, doc, x.clip).clip.duration > 0)) clip.duration = HOLD;
	return { doc, animation };
}

/**
 * Bone `bone` turned in 3D in an edit: its 2D `rotate` keys (from the authoring clip) become `orient`
 * keys, a run past 180° split, and it keys `orient` from now on. Its own `orient` keys stay.
 */
export function turnIn3d(animation: Json, keys: Keys3d, bone: string): QuatKey[] {
	const entry = (keys[bone] ??= {});
	const animBones = isObj(animation.bones) ? animation.bones : {};
	const t = animBones[bone];
	if (!entry.orient?.length) {
		const rotate = isObj(t) && Array.isArray(t.rotate) ? (t.rotate as Key1[]) : [];
		entry.orient = rotate.length ? orientFromRotate(rotate) : [];
	}
	if (isObj(t)) {
		delete t.rotate;
		if (!Object.keys(t).length) delete animBones[bone];
	}
	return entry.orient;
}

/** Clip `clip` baked into the irig (its owned parts and the followers' setups), as the save bakes it. */
export function bakeClip3d(
	irig: Json,
	doc: Rig3dDoc,
	clip: string,
): { irig: Json; bake: Bake2p5d; plan: ClipPlan } {
	const rig = rigOf(irig, doc);
	const plan = clipOf(rig, irig, doc, clip);
	const problems = [...plan.problems, ...rig2p5dProblems(rig, plan.clip)];
	if (problems.length) throw new Error(problems.join('; '));
	const bake = bake2p5d(rig, plan.clip);
	return { irig: withBake(irig, clip, plan, bake, followersOf(doc)), bake, plan };
}

/**
 * The rig with 3D clip `clip` made a plain 2D clip (§9, Detach): its baked keys stay as they are in
 * the irig, and the sidecar forgets the clip and every transition from or to it.
 */
export function detachClip3d(doc: Rig3dDoc, clip: string): { doc: Rig3dDoc; detached: string[] } {
	const clips = { ...doc.clips };
	const detached: string[] = [];
	for (const [c, v] of Object.entries(clips))
		if (c === clip || v.transition?.from === clip || v.transition?.to === clip) {
			delete clips[c];
			detached.push(c);
		}
	return { doc: { ...doc, clips }, detached };
}
