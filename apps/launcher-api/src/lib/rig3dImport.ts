/**
 * A motion import into a 2.5D rig's clip (docs/design/rig-2p5d.md §8, P4): the import's 3D keys and
 * its 2D control keys written into the rig's sidecar (`rig3d.json`), then baked into the `.irig` so
 * the clip plays at once — the same bake the save runs (`rig3d.ts`, `rig2p5d.ts`). Pure, so the
 * Rigger page (through `vendor/rigger-2p5d.js`) and the gates run the same code.
 *
 * In a 3D clip the bake owns every bone under a bone turned in 3D: the irig holds its output there,
 * the sidecar the keys an author (or an import) made. So the 2D controls are keyed into the clip as
 * an author sees it (`authoringOf`: the sidecar's keys in place of the bake's), and `importClip3d`
 * moves every owned bone's keys into the sidecar before it bakes.
 */
import {
	bake2p5d,
	bakedBonesOf,
	orientOf,
	type Bake2p5d,
	type BoneKeys3d,
	type Curve,
	type Drawing,
	type Key1,
	type Key2,
	type QuatKey,
	type Turnaround,
} from './rig2p5d';
import {
	RIG3D_VERSION,
	animationOf,
	clipOf,
	followersOf,
	rigOf,
	withBake,
	type ClipPlan,
	type Rig3dDoc,
} from './rig3d';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** What a 2.5D template starts its rigs' 3D data with (`RigTemplate3d`). */
export interface Template3d {
	turnaround: Turnaround;
	depths: Record<string, number>;
	views?: Record<string, Drawing[]>;
	layers?: Record<string, string[]>;
}

/** The attachments each slot of an irig has, in any skin. */
function attachmentsOf(irig: Json): Map<string, Set<string>> {
	const skins = Array.isArray(irig.skins)
		? list(irig.skins)
		: isObj(irig.skins)
			? Object.values(irig.skins).map((attachments) => ({ attachments }))
			: [];
	const out = new Map<string, Set<string>>();
	for (const skin of skins)
		for (const [slot, byName] of Object.entries(isObj(skin.attachments) ? skin.attachments : {}))
			if (isObj(byName))
				for (const a of Object.keys(byName)) out.set(slot, (out.get(slot) ?? new Set()).add(a));
	return out;
}

/**
 * A rig's first 3D data, from its template (rig-2p5d §3): the turnaround (the template's, unless
 * `turnaround` picks a full one), its parts in depth (those the rig has), and per slot the drawings by
 * angle its art has — the front-half ones on a side turnaround, every one on a full turnaround if the
 * art has a back one. A slot with fewer than two keeps the one drawing it has, turning as a card, and
 * so does a slot whose bone carries more than it (a drawing turns its whole bone), unless `carrying`:
 * then the caller puts it on an image bone (`make3dFromTemplate`).
 */
export function rig3dFromTemplate(
	stem: string,
	irig: Json,
	t: Template3d,
	{ turnaround = t.turnaround, carrying = false }: { turnaround?: Turnaround; carrying?: boolean } = {},
): Rig3dDoc {
	const bones = new Set(list(irig.bones).map((b) => b.name));
	const has = attachmentsOf(irig);
	const doc: Rig3dDoc = { rig3d: RIG3D_VERSION, rig: stem, turnaround };
	const depths = Object.entries(t.depths).filter(([b, d]) => bones.has(b) && d !== 0);
	if (depths.length) doc.bones = Object.fromEntries(depths.map(([b, depth]) => [b, { depth }]));
	const slots = list(irig.slots);
	const alone = (slot: string): boolean => {
		const bone = slots.find((s) => s.name === slot)?.bone;
		return (
			!list(irig.bones).some((b) => b.parent === bone) &&
			!slots.some((s) => s.bone === bone && s.name !== slot)
		);
	};
	const views: NonNullable<Rig3dDoc['views']> = {};
	for (const [slot, drawings] of Object.entries(t.views ?? {})) {
		const kept = drawings.filter(
			(d) =>
				has.get(slot)?.has(d.attachment) && (turnaround === 'full' || Math.abs(d.turn) <= 90),
		);
		if (turnaround === 'full' && !kept.some((d) => Math.abs(d.turn) > 90)) continue;
		if (kept.length >= 2 && (carrying || alone(slot)))
			views[slot] = { drawings: kept.map((d) => ({ ...d })) };
	}
	if (Object.keys(views).length) doc.views = views;
	const names = new Set(slots.map((x) => x.name));
	const layers = Object.entries(t.layers ?? {})
		.map(([layer, members]) => [layer, members.filter((x) => names.has(x))] as const)
		.filter(([, members]) => members.length > 1);
	if (layers.length) doc.layers = Object.fromEntries(layers.map(([l, m]) => [l, [...m]]));
	return doc;
}

const TIMELINES = ['rotate', 'translate', 'scale'] as const;
type Timeline = (typeof TIMELINES)[number];

/**
 * Clip `name` as its author keys it: the irig's animation, with every bone the bake owns keyed from
 * the sidecar instead (its `rotate`, `translate` and `scale`; none where the sidecar has none), and
 * the sidecar's `orient` keys beside it. A clip with no 3D keys is the irig's, untouched.
 *
 * `owned` names the bones whose irig keys are a bake's output: those of the bake the irig holds, when
 * the sidecar has been edited since (a bone whose last 3D key went is no longer owned by the edited
 * clip, but its irig keys are still that bake's). Without it, the bones the sidecar's clip owns now.
 * A bone the sidecar keys that is not owned (its first 3D key, just made) keeps its irig keys, each
 * timeline the sidecar keys read from the sidecar.
 */
export function authoringOf(
	irig: Json,
	doc: Rig3dDoc | null,
	name: string,
	owned?: Iterable<string>,
): { animation: Json; orient: Record<string, QuatKey[]> } {
	const animation: Json = structuredClone(animationOf(irig, name) ?? {});
	const side = doc?.clips?.[name];
	if (!doc || !side) return { animation, orient: {} };
	const baked = new Set(owned ?? clipOf(rigOf(irig, doc), irig, doc, name).owned);
	const bones = isObj(animation.bones) ? animation.bones : (animation.bones = {});
	const orient: Record<string, QuatKey[]> = {};
	for (const b of new Set([...baked, ...Object.keys(side.bones)])) {
		const keys = side.bones[b];
		const kept = bones[b];
		const own: Json = !baked.has(b) && isObj(kept) ? { ...kept } : {};
		for (const t of TIMELINES) if (keys?.[t]?.length) own[t] = structuredClone(keys[t]);
		if (Object.keys(own).length) bones[b] = own;
		else delete bones[b];
		if (keys?.orient?.length) orient[b] = structuredClone(keys.orient);
	}
	if (!Object.keys(bones).length) delete animation.bones;
	return { animation, orient };
}

/** The 2D keys a rotate run becomes as `orient` keys: Rz of each, a run past 180° split. */
export function orientFromRotate(keys: Key1[]): QuatKey[] {
	const out: QuatKey[] = [];
	keys.forEach((k, i) => {
		const t0 = k.time ?? 0;
		const v0 = k.value ?? 0;
		const next = keys[i + 1];
		const step = (v: number, time: number, curve?: Curve): QuatKey => ({
			time,
			value: orientOf(v, 0, 0),
			...(curve === undefined ? {} : { curve }),
		});
		if (!next || k.curve === 'stepped') {
			out.push(step(v0, t0, k.curve === 'stepped' ? 'stepped' : undefined));
			return;
		}
		const t1 = next.time ?? 0;
		const v1 = next.value ?? 0;
		const parts = Math.max(1, Math.ceil(Math.abs(v1 - v0) / 179));
		if (parts > 1) {
			// Slerp takes the shorter arc: a long turn needs a key at least every 180°.
			for (let j = 0; j < parts; j++)
				out.push(step(v0 + ((v1 - v0) * j) / parts, t0 + ((t1 - t0) * j) / parts));
			return;
		}
		const c = k.curve;
		const curve =
			Array.isArray(c) && c.length >= 4 && Math.abs(v1 - v0) > 1e-9
				? [c[0], (c[1] - v0) / (v1 - v0), c[2], (c[3] - v0) / (v1 - v0)]
				: undefined;
		out.push(step(v0, t0, curve));
	});
	return out;
}

export interface Import3d {
	/** The rig as open in the Rigger, and its 3D data (null: none yet). */
	irig: Json;
	doc: Rig3dDoc | null;
	stem: string;
	/** Its template's 3D setup, for a rig with no 3D data yet. */
	template: Template3d;
	clip: string;
	/** The clip as its author keys it (`authoringOf`), with the import's 2D control keys written in. */
	animation: Json;
	/** The sidecar's `orient` keys before the import (`authoringOf`). */
	orient: Record<string, QuatKey[]>;
	/** The import's 3D keys from its own time 0 (`MotionSolve.bones3d`), written from `at`. */
	keys: Record<string, BoneKeys3d>;
	at: number;
	/** The import's last time, from 0. */
	length: number;
	/**
	 * The timelines of the controls the 3D import replaces, cleared under it: a limb's old shortening
	 * or a 2D turn keyed before would add to the projection.
	 */
	replaced: { bone: string; timeline: Timeline }[];
}

export interface Imported3d {
	doc: Rig3dDoc;
	irig: Json;
	bake: Bake2p5d;
	plan: ClipPlan;
}

const under = (time: number | undefined, from: number, to: number) =>
	(time ?? 0) >= from - 1e-4 && (time ?? 0) <= to + 1e-4;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Write an import into clip `clip` of a 2.5D rig and bake it (rig-2p5d §8): the import's 3D keys
 * replace each bone's under it (from `at` to `at + length`), a bone that had 2D turns there now turns
 * in 3D (its other 2D turns become `orient` keys), and every bone the bake will own takes its keys
 * from the authoring clip into the sidecar. The irig gets the authoring clip with the bake in its
 * owned parts (`withBake`), as the save would write it. Throws on what the bake refuses.
 */
export function importClip3d(x: Import3d): Imported3d {
	const from = x.at;
	const to = x.at + x.length;
	const doc: Rig3dDoc = structuredClone(x.doc ?? rig3dFromTemplate(x.stem, x.irig, x.template));
	const animation: Json = structuredClone(x.animation);
	const animBones = isObj(animation.bones) ? animation.bones : (animation.bones = {});
	for (const { bone, timeline } of x.replaced) {
		const own = animBones[bone];
		if (!isObj(own) || !Array.isArray(own[timeline])) continue;
		const kept = (own[timeline] as Json[]).filter((k) => !under(k.time as number, from, to));
		if (kept.length) own[timeline] = kept;
		else delete own[timeline];
	}

	// The 3D keys: the import's under it, each bone's own outside it.
	const bones: Record<string, BoneKeys3d> = {};
	const shift = <K extends { time?: number }>(ks: K[] = []) =>
		ks.map((k) => ({ ...k, time: round4((k.time ?? 0) + from) }));
	for (const [b, k] of Object.entries(x.keys)) {
		const own = isObj(animBones[b]) ? animBones[b] : {};
		const twoD = (Array.isArray(own.rotate) ? own.rotate : []) as Key1[];
		if (k.orient?.length) {
			const before = x.orient[b]?.length ? x.orient[b] : orientFromRotate(twoD);
			bones[b] = {
				orient: [
					...before.filter((q) => (q.time ?? 0) < from - 1e-4),
					...shift(k.orient),
					...before.filter((q) => (q.time ?? 0) > to + 1e-4),
				],
			};
			delete own.rotate;
		} else if (k.rotate?.length) {
			own.rotate = [
				...twoD.filter((q) => (q.time ?? 0) < from - 1e-4),
				...shift(k.rotate),
				...twoD.filter((q) => (q.time ?? 0) > to + 1e-4),
			];
			animBones[b] = own;
		}
	}
	for (const [b, ks] of Object.entries(x.orient))
		if (!bones[b] && ks.length) bones[b] = { orient: structuredClone(ks) };
	for (const [b, k] of Object.entries(doc.clips?.[x.clip]?.bones ?? {}))
		if (k.depth?.length && !bones[b]?.depth) (bones[b] ??= {}).depth = structuredClone(k.depth);
	const duration = Math.max(doc.clips?.[x.clip]?.duration ?? 0, round4(to));
	return bakeAuthored(x.irig, doc, x.clip, animation, bones, duration);
}

/**
 * Bake clip `clip` from its authoring form (rig-2p5d §9): `animation` as its author keys it in 2D,
 * `bones` its 3D keys (`orient`, `depth`). Every bone the bake will own takes its 2D keys from
 * `animation` into the sidecar — and a bone it no longer owns keeps them in the irig, as 2D keys —
 * then the clip is baked into the irig where the bake owns it (`withBake`), as the save would.
 * `doc` is the sidecar's copy to write into.
 */
function bakeAuthored(
	irigIn: Json,
	doc: Rig3dDoc,
	clip: string,
	animation: Json,
	bones: Record<string, BoneKeys3d>,
	duration: number | undefined,
): Imported3d {
	const irig: Json = structuredClone(irigIn);
	const anims = isObj(irig.animations) ? irig.animations : (irig.animations = {});
	anims[clip] = animation;
	const animBones = isObj(animation.bones) ? animation.bones : {};
	const rig = rigOf(irig, doc);
	const owned = new Set([
		...bakedBonesOf(rig, { name: clip, duration: Math.max(duration ?? 0, 1e-3), bones }),
		...Object.keys(bones),
	]);
	for (const b of owned) {
		const own = animBones[b];
		if (!isObj(own)) continue;
		for (const t of TIMELINES)
			if (Array.isArray(own[t]) && own[t].length)
				(bones[b] ??= {})[t] = structuredClone(own[t]) as Key1[] & Key2[];
	}
	const prev = doc.clips?.[clip];
	doc.clips = {
		...doc.clips,
		[clip]: {
			...(duration === undefined ? {} : { duration }),
			bones,
			...(prev?.baked ? { baked: prev.baked } : {}),
		},
	};
	const plan = clipOf(rig, irig, doc, clip);
	if (plan.problems.length) throw new Error(plan.problems.join('; '));
	const bake = bake2p5d(rig, plan.clip);
	return { doc, irig: withBake(irig, clip, plan, bake, followersOf(doc)), bake, plan };
}

export interface Rebake3d {
	/** The rig as open in the Rigger, holding a bake of the clip (or the 2D clip it is made from). */
	irig: Json;
	/** Its 3D data, with the clip as its author has edited it. */
	doc: Rig3dDoc;
	clip: string;
	/** The bones the irig's bake of the clip owns (`authoringOf`); none for a clip made 3D now. */
	owned?: Iterable<string>;
}

/**
 * Bake a 3D clip again after an edit (rig-2p5d §9): its keys as authored — the sidecar's 3D keys and
 * owned bones' keys, the irig's 2D keys on the rest — re-split between the two (a bone that turns in
 * 3D now has its 2D keys moved into the sidecar, one that no longer does gets them back) and baked.
 * A 2D clip declared in the sidecar with no keys (`3D from this clip`) bakes back to itself.
 */
export function rebakeClip3d(x: Rebake3d): Imported3d {
	const { animation } = authoringOf(x.irig, x.doc, x.clip, x.owned);
	const doc: Rig3dDoc = structuredClone(x.doc);
	const side = doc.clips?.[x.clip];
	if (!side || side.transition) throw new Error(`${x.clip} is not a 3D clip`);
	const bones: Record<string, BoneKeys3d> = {};
	for (const [b, k] of Object.entries(side.bones)) {
		const own: BoneKeys3d = {};
		if (k.orient?.length) own.orient = k.orient;
		if (k.depth?.length) own.depth = k.depth;
		if (Object.keys(own).length) bones[b] = own;
	}
	return bakeAuthored(x.irig, doc, x.clip, animation, bones, side.duration);
}
