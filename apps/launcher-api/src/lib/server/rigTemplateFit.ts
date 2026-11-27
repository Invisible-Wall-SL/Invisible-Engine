import type {
	RigTemplate,
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplateClip,
	RigTemplatePart,
	RigTemplateSlot,
	RigTemplate3d,
	RigTemplateTimelines,
} from './rigTemplates';
import { inDrawOrder, layersTogether } from '../rigSlotOrder';

/**
 * A rig template fitted to one character (docs/design/frame-to-rig.md §4.6, §4.7): the template's
 * skeleton with the character's own lengths, the pose of the frame it was cut from, the props it
 * wears and the parts drawn as one bending piece. A fit changes lengths, never directions or names,
 * so every control and starter clip of the template plays on the fitted rig — but for the fingers,
 * which sit where the frame's hand has them (their controls fold and fan each from where it is).
 */
export interface RigFit {
	/** New setup offsets (rig units, in the parent's frame), each along the template's direction. */
	bones: Record<string, { x: number; y: number }>;
	/**
	 * The frame's pose: keyed at t = 0 of the animation `frame`, relative to setup as every key is.
	 * `x`, `y` move a joint along its parent (a limb drawn shorter in this frame than its length).
	 */
	frame?: Record<string, { rotate: number; scaleY?: number; x?: number; y?: number }>;
	/** Worn things (§4.3a), each a slot of its own drawn just before or after the slot it names. */
	props?: RigFitProp[];
	/**
	 * Slots drawn in this order (back to front) in the places they hold between them, props
	 * included (`inDrawOrder`): the author's layers (frame-to-rig §13.1e). Every other slot stays.
	 */
	order?: string[];
	/** Parts drawn as one bending piece, by part name (§4.7). */
	bends?: Record<string, RigFitBend>;
	/**
	 * Finger bones' setup offsets (rig units, in the parent's frame) as the frame's hand has them,
	 * in any direction: the hand's mesh (`bends`) is weighted to the fingers drawn in its image.
	 */
	fingers?: Record<string, { x: number; y: number }>;
	/**
	 * The face where the frame draws it (frame-to-rig §12 F2i): `at`, setup offsets (rig units, in
	 * the parent's frame) of bones under the template's `face`, in any direction as `fingers` are;
	 * `scale`, the factors a bone's moves take instead of its length's, along x and along y (its
	 * controls' moves, its clips' translate keys; its depth takes x's): the drawn face's size, less
	 * where the skin around a feature has no room for the template's whole move.
	 */
	features?: {
		at: Record<string, { x: number; y: number }>;
		scale: Record<string, [number, number]>;
	};
	/** The head turn (frame-to-rig §13.1g, `rigHeadTurn.ts`). */
	turn?: RigFitTurn;
}

/**
 * The head turn: the ring of bones (`HEAD_TURN_BONES`) the head's drawing is weighted to round the
 * face, each a child of the face's parent (the head) at `at` (its setup offset) and `depth` (z toward
 * the viewer, rig units), so a 3D turn or nod carries the head's middle with the face and its round
 * part-way, its outline staying; `depths` the depth of bones the template or the fit already has (a
 * prop worn on the head, the lips), z in their parent's frame. The Head turn and Head up / down
 * controls slide each by its depth, as they slide the face by its own.
 */
export interface RigFitTurn {
	bones: { name: string; at: [number, number]; depth: number }[];
	depths?: Record<string, number>;
}

/** The head turn's ring: to the face's left, right, below and above. */
export const HEAD_TURN_BONES = [
	'head_turn_l',
	'head_turn_r',
	'head_turn_d',
	'head_turn_u',
] as const;
/** The deepest a head turn's bone may sit either way, rig units. */
const MAX_TURN_DEPTH = 10_000;

/**
 * A prop: its slot drawn just before or after the slot it names. With `at` it hangs from a bone of
 * its own of its name, a child of `bone` at `at` (its pivot, in that bone's frame); without, its
 * slot rides `bone` itself (a fit kept from before prop bones).
 */
export interface RigFitProp {
	name: string;
	bone: string;
	before?: string;
	after?: string;
	at?: [number, number];
}

/**
 * A part weighted along a chain of bones: `bones` in order along the limb, each at its joint on the
 * image (u, v from the top-left, 0…1, of the untrimmed image), and per joint after the first the
 * limb's width there (rig units), the width its weight ramps across. With `chains` instead of a
 * `ramp`, its bones branch from the first (a hand and its fingers, each placed where its bone is:
 * no `at`), each branch with its own widths. `covers`: the parts this one piece stands in for (a
 * one-piece arm draws the forearm), so the rig does not report them needed. With `skin` the part is
 * skinned across its joints with the parts beside it, bound in the frame's pose; its bones are then
 * its own bone first (unplaced), then every bone a joint hands over to.
 */
export interface RigFitBend {
	bones: { bone: string; at?: [number, number] }[];
	ramp?: number[];
	chains?: { bones: number[]; ramp: number[] }[];
	skin?: RigSkin[];
	grid?: [number, number];
	covers?: string[];
}

/** What a skinned part is skinned across, in order: joints with the parts beside it, and regions. */
export type RigSkin = RigSkinJoint | RigSkinSpot;

/**
 * A joint a part is skinned across (frame-to-rig §12 F2f): past it `bone` takes over, its share
 * ramping linearly along `dir` across `width` centred on the joint, near it — within `reach`, fading
 * out by twice that. `at` and `dir` are in the rig's world in the frame's pose, where the part is
 * bound, so the frame pose draws it as it was cut. The part on the joint's other side is skinned
 * across the same joint the other way, so every pixel the two share moves as one: no crack. `then`
 * splits the share handed over as the part beyond splits it (an upper arm hands its shoulder to the
 * torso, part of which the torso hands on to the clavicle there; the neck hands its top to the head
 * split as the head's face regions split it).
 */
export interface RigSkinJoint {
	bone: string;
	at: [number, number];
	dir: [number, number];
	width: number;
	reach: number;
	then?: RigSkin[];
}

/**
 * A region `bone` takes (a feature of the face, frame-to-rig §12 F2i): about `at`, reaching `extent`
 * to its left, right, below and above along `dir` (its right; its up is `dir` turned a quarter turn
 * left), from a line `run` long each way along `dir` (a brow, a lip; none: a point), its share whole
 * within `core` of the way to its edge, then falling linearly to 0 there. Linear, so a move of the
 * region by less than (1 − core) × its reach that way never folds the skin it squeezes. `then`
 * splits its share along it (a brow from its outer end to its inner one). `split` instead hands its
 * share to four bones by the way from `at` (left, right, below, above: the head turn's ring), the
 * square of each way's reach-scaled distance its weight.
 */
export interface RigSkinSpot {
	bone: string;
	at: [number, number];
	dir: [number, number];
	extent: [number, number, number, number];
	core: number;
	run?: number;
	then?: RigSkin[];
	split?: [string, string, string, string];
}

export const isSpot = (j: RigSkin): j is RigSkinSpot => 'extent' in j;

/** A region's share of the point (x, y): 1 within its core, falling linearly to 0 at its edge. */
export function spotShare(j: RigSkinSpot, x: number, y: number): number {
	const l = Math.hypot(j.dir[0], j.dir[1]);
	const [ex, ey] = [j.dir[0] / l, j.dir[1] / l];
	const [dx, dy] = [x - j.at[0], y - j.at[1]];
	const along = dx * ex + dy * ey;
	const run = j.run ?? 0;
	const u = along < 0 ? Math.min(0, along + run) : Math.max(0, along - run);
	const v = dy * ex - dx * ey;
	const d = Math.hypot(u / j.extent[u < 0 ? 0 : 1], v / j.extent[v < 0 ? 2 : 3]);
	return Math.min(1, Math.max(0, (1 - d) / (1 - j.core)));
}

/**
 * Each bone's share of a vertex at (x, y) (the frame's pose) across `joints`: a joint or region takes
 * its share of what the ones before it left, so one listed first (an armpit) keeps its blend whole
 * where a later one (a clavicle's) overlaps it. What is left stays on the part's own weighting.
 */
export function skinShares(
	joints: readonly RigSkin[],
	x: number,
	y: number,
): { bone: string; share: number }[] {
	let left = 1;
	const out: { bone: string; share: number }[] = [];
	for (const j of joints) {
		let own: number;
		if (isSpot(j)) own = spotShare(j, x, y);
		else {
			const [dx, dy] = [x - j.at[0], y - j.at[1]];
			const s = (dx * j.dir[0] + dy * j.dir[1]) / Math.hypot(j.dir[0], j.dir[1]);
			const past = Math.min(1, Math.max(0, 0.5 + s / j.width));
			own = past * Math.min(1, Math.max(0, 2 - Math.hypot(dx, dy) / j.reach));
		}
		const w = left * own;
		left -= w;
		const inner = j.then?.length ? skinShares(j.then, x, y) : [];
		const passed = inner.reduce((sum, k) => sum + k.share, 0);
		out.push(...inner.map((k) => ({ bone: k.bone, share: w * k.share })));
		if (isSpot(j) && j.split)
			out.push(
				...splitShares(j, x, y).map((k) => ({ bone: k.bone, share: w * (1 - passed) * k.share })),
			);
		else out.push({ bone: j.bone, share: w * (1 - passed) });
	}
	return out;
}

/** A split region's share at (x, y) across its four bones, by the way from its middle (`split`). */
function splitShares(j: RigSkinSpot, x: number, y: number): { bone: string; share: number }[] {
	const l = Math.hypot(j.dir[0], j.dir[1]);
	const [ex, ey] = [j.dir[0] / l, j.dir[1] / l];
	const [dx, dy] = [x - j.at[0], y - j.at[1]];
	const u = dx * ex + dy * ey;
	const v = dy * ex - dx * ey;
	const cu = (u / j.extent[u < 0 ? 0 : 1]) ** 2;
	const cv = (v / j.extent[v < 0 ? 2 : 3]) ** 2;
	const [h, s] = cu + cv > 0 ? [cu / (cu + cv), cv / (cu + cv)] : [0.5, 0.5];
	const [left, right, down, up] = j.split!;
	return [
		{ bone: u < 0 ? left : right, share: h },
		{ bone: v < 0 ? down : up, share: s },
	];
}

/** A bone's world transform `[a, b, c, d, x, y]`: (u, v) in its frame lands at (a u + b v + x, c u + d v + y). */
export type Affine = [number, number, number, number, number, number];

/**
 * Each bone's world transform with the frame's pose keyed on the setup (as engine-rig poses the clip
 * `frame`: a turn and a move add to the setup's, a scale multiplies it; no shear, inherited whole).
 */
export function frameWorld(
	bones: readonly RigTemplateBone[],
	frame: NonNullable<RigFit['frame']> = {},
): Map<string, Affine> {
	const out = new Map<string, Affine>();
	for (const b of bones) {
		const f = frame[b.name];
		const r = (((b.rotation ?? 0) + (f?.rotate ?? 0)) * Math.PI) / 180;
		const sx = b.scaleX ?? 1;
		const sy = (b.scaleY ?? 1) * (f?.scaleY ?? 1);
		const [x, y] = [b.x + (f?.x ?? 0), b.y + (f?.y ?? 0)];
		const l: Affine = [
			Math.cos(r) * sx,
			-Math.sin(r) * sy,
			Math.sin(r) * sx,
			Math.cos(r) * sy,
			x,
			y,
		];
		const p = b.parent === undefined ? undefined : out.get(b.parent);
		out.set(
			b.name,
			p
				? [
						p[0] * l[0] + p[1] * l[2],
						p[0] * l[1] + p[1] * l[3],
						p[2] * l[0] + p[3] * l[2],
						p[2] * l[1] + p[3] * l[3],
						p[0] * x + p[1] * y + p[4],
						p[2] * x + p[3] * y + p[5],
					]
				: l,
		);
	}
	return out;
}

/** A finger bone (`index_2_l`): the only bones a fit may place off the template's direction. */
export const FINGER_BONE = /^(thumb|index|middle|ring|pinky)_[123]_[lr]$/;

/** The grid a fitted bend takes when the fit names none: rows enough for a ramp across an elbow. */
export const FIT_BEND_GRID: [number, number] = [3, 32];
/** A prop's placeholder size, until its art is attached. */
const PROP_SIZE: [number, number] = [64, 64];
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** The slots a fit's `order` (a sheet mapping's layers) may list: every template slot and prop. */
export const MAX_LAYERS = 256;
/** How far a fitted bone may turn off its template direction (float noise, not a turn). */
const TURN_EPS = 2e-4;
/** The longest a fitted bone may be (px): past it the world sums overflow to Infinity. */
const MAX_FIT_LENGTH = 100_000;
/** The most joints and regions a part is skinned across, per list, and how deep they split. */
const MAX_SKIN = 16;
const SKIN_DEPTH = 3;
/** The most a face's feature may scale its moves by. */
const MAX_FEATURE_SCALE = 100;

/**
 * The bone a template's control bone marks, by its name (rig-controls.md §6.1, decision 4): a hand
 * control and its space bones (`hand_ik_l`, `hand_ik_l_chest`, `hand_ik_l_world`, …) at the wrist,
 * the elbow pole at the elbow, a foot control at the ankle and the knee pole at the knee. Under a
 * fit a control keeps its place on what it marks; null for every other bone.
 */
export function controlTarget(name: string): string | null {
	const m = /^(hand_ik|elbow_pole|foot_ik|knee_pole)_([lr])(?:_[A-Za-z0-9]+)?$/.exec(name);
	if (!m) return null;
	const at = { hand_ik: 'hand', elbow_pole: 'lower_arm', foot_ik: 'foot', knee_pole: 'shin' }[
		m[1] as 'hand_ik' | 'elbow_pole' | 'foot_ik' | 'knee_pole'
	];
	return `${at}_${m[2]}`;
}

/**
 * The template's `face` bone and every bone under it (the face block, rig-templates §4): an optional
 * one (a jointed mouth's upper teeth) only when `optional` names it, or is true for every one.
 */
export function faceBones(
	bones: readonly RigTemplateBone[],
	optional: ReadonlySet<string> | true = new Set(),
): Set<string> {
	const out = new Set<string>();
	for (const b of bones)
		if (b.name === 'face' || (b.parent !== undefined && out.has(b.parent)))
			if (!b.optional || optional === true || optional.has(b.name)) out.add(b.name);
	return out;
}

/** Setup world positions of the bones, by name (a template's bones are unturned where it bends). */
export function boneWorld(bones: readonly RigTemplateBone[]): Map<string, [number, number]> {
	const at = new Map<string, [number, number]>();
	for (const b of bones) {
		const p = b.parent === undefined ? [0, 0] : (at.get(b.parent) ?? [0, 0]);
		at.set(b.name, [p[0] + b.x, p[1] + b.y]);
	}
	return at;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const extraKey = (o: Record<string, unknown>, keys: readonly string[]) =>
	Object.keys(o).find((k) => !keys.includes(k));

/**
 * A fit as a request or a `template.json` carries it, checked for shape only (what it names is
 * checked against the template by `rigFitProblem`): unknown fields and non-finite numbers are refused.
 */
export function parseRigFit(raw: unknown): { fit: RigFit } | { problem: string } {
	const no = (problem: string) => ({ problem });
	if (!isRecord(raw)) return no('a fit is an object');
	const extra = extraKey(raw, [
		'bones',
		'frame',
		'props',
		'order',
		'bends',
		'fingers',
		'features',
		'turn',
	]);
	if (extra !== undefined) return no(`a fit has no field "${extra}"`);
	if (!isRecord(raw.bones)) return no('a fit needs `bones`: { name: { x, y } }');
	const offsets = (o: Record<string, unknown>, what: string) => {
		const out: RigFit['bones'] = {};
		for (const [name, p] of Object.entries(o)) {
			if (!isRecord(p) || extraKey(p, ['x', 'y']) !== undefined || !finite(p.x) || !finite(p.y))
				return `${what} "${name}" is fitted to { x, y }, two finite numbers`;
			out[name] = { x: p.x, y: p.y };
		}
		return out;
	};
	const bones = offsets(raw.bones, 'bone');
	if (typeof bones === 'string') return no(bones);
	const fit: RigFit = { bones };
	if (raw.fingers !== undefined) {
		if (!isRecord(raw.fingers)) return no('`fingers` is { bone: { x, y } }');
		const fingers = offsets(raw.fingers, 'finger');
		if (typeof fingers === 'string') return no(fingers);
		fit.fingers = fingers;
	}
	if (raw.features !== undefined) {
		const f = raw.features;
		const shape = '`features` is { at: { bone: { x, y } }, scale: { bone: factor } }';
		if (!isRecord(f) || extraKey(f, ['at', 'scale']) !== undefined) return no(shape);
		if (!isRecord(f.at) || !isRecord(f.scale)) return no(shape);
		const at = offsets(f.at, 'feature');
		if (typeof at === 'string') return no(at);
		const scale: Record<string, [number, number]> = {};
		for (const [name, v] of Object.entries(f.scale)) {
			if (!Array.isArray(v) || v.length !== 2 || !v.every(finite))
				return no(`the face's "${name}" moves by [x, y], two finite factors`);
			scale[name] = [v[0], v[1]];
		}
		fit.features = { at, scale };
	}
	if (raw.turn !== undefined) {
		const shape =
			'`turn` is { bones: [{ name, at: [x, y], depth }], depths?: { bone: depth } }, finite numbers';
		const o = raw.turn;
		if (!isRecord(o) || extraKey(o, ['bones', 'depths']) !== undefined || !Array.isArray(o.bones))
			return no(shape);
		const turnBones: RigFitTurn['bones'] = [];
		for (const b of o.bones) {
			if (
				!isRecord(b) ||
				extraKey(b, ['name', 'at', 'depth']) !== undefined ||
				typeof b.name !== 'string' ||
				!Array.isArray(b.at) ||
				b.at.length !== 2 ||
				!b.at.every(finite) ||
				!finite(b.depth)
			)
				return no(shape);
			turnBones.push({ name: b.name, at: [b.at[0], b.at[1]], depth: b.depth });
		}
		const turn: RigFitTurn = { bones: turnBones };
		if (o.depths !== undefined) {
			if (!isRecord(o.depths) || !Object.values(o.depths).every(finite)) return no(shape);
			turn.depths = { ...(o.depths as Record<string, number>) };
		}
		fit.turn = turn;
	}
	if (raw.frame !== undefined) {
		if (!isRecord(raw.frame)) return no('`frame` is { bone: { rotate, scaleY?, x?, y? } }');
		const frame: NonNullable<RigFit['frame']> = {};
		for (const [name, o] of Object.entries(raw.frame)) {
			if (
				!isRecord(o) ||
				extraKey(o, ['rotate', 'scaleY', 'x', 'y']) !== undefined ||
				!finite(o.rotate) ||
				(o.x !== undefined && !finite(o.x)) ||
				(o.y !== undefined && !finite(o.y))
			)
				return no(`the frame turns "${name}" by { rotate, scaleY?, x?, y? }, finite numbers`);
			if (o.scaleY !== undefined && !(finite(o.scaleY) && o.scaleY > 0))
				return no(`the frame scales "${name}" by a finite scaleY above 0`);
			frame[name] = {
				rotate: o.rotate,
				...(o.scaleY === undefined ? {} : { scaleY: o.scaleY }),
				...(o.x === undefined ? {} : { x: o.x }),
				...(o.y === undefined ? {} : { y: o.y }),
			};
		}
		fit.frame = frame;
	}
	if (raw.props !== undefined) {
		if (!Array.isArray(raw.props) || raw.props.length > 64)
			return no('`props` is a list of up to 64 { name, bone, before | after }');
		const props: RigFitProp[] = [];
		for (const p of raw.props) {
			if (!isRecord(p) || extraKey(p, ['name', 'bone', 'before', 'after', 'at']) !== undefined)
				return no('a prop is { name, bone, before | after, at? }');
			const { name, bone, before, after } = p;
			if (typeof name !== 'string' || !NAME.test(name))
				return no('a prop is named with letters, digits, _ and - (up to 64)');
			if (typeof bone !== 'string' || !bone) return no(`prop "${name}" needs the bone it rides`);
			if ((before === undefined) === (after === undefined))
				return no(`prop "${name}" is drawn either before or after one slot`);
			const at = before ?? after;
			if (typeof at !== 'string' || !at) return no(`prop "${name}" names its neighbour slot`);
			if (p.at !== undefined && !(Array.isArray(p.at) && p.at.length === 2 && p.at.every(finite)))
				return no(`prop "${name}" hangs at [x, y], two finite numbers`);
			const pivot = p.at as [number, number] | undefined;
			props.push({
				name,
				bone,
				...(before === undefined ? { after: at } : { before: at }),
				...(pivot ? { at: [pivot[0], pivot[1]] as [number, number] } : {}),
			});
		}
		fit.props = props;
	}
	if (raw.order !== undefined) {
		if (
			!Array.isArray(raw.order) ||
			raw.order.length > MAX_LAYERS ||
			!raw.order.every((n) => typeof n === 'string' && NAME.test(n)) ||
			new Set(raw.order).size !== raw.order.length
		)
			return no(`\`order\` is a list of up to ${MAX_LAYERS} slot names, back to front, each once`);
		fit.order = [...(raw.order as string[])];
	}
	if (raw.bends !== undefined) {
		if (!isRecord(raw.bends))
			return no('`bends` is { part: { bones, ramp | chains, grid?, covers? } }');
		const bends: NonNullable<RigFit['bends']> = {};
		const widths = (v: unknown): v is number[] => Array.isArray(v) && v.every(finite);
		for (const [part, o] of Object.entries(raw.bends)) {
			if (
				!isRecord(o) ||
				extraKey(o, ['bones', 'ramp', 'chains', 'skin', 'grid', 'covers']) !== undefined
			)
				return no(`the bend of "${part}" is { bones, ramp | chains | skin, grid?, covers? }`);
			const branched = o.chains !== undefined;
			const skinOnly = !branched && o.ramp === undefined && o.skin !== undefined;
			const named = (list: unknown): number =>
				Array.isArray(list)
					? list.reduce<number>((n, j) => n + 1 + (isRecord(j) ? named(j.then) : 0), 0)
					: 0;
			const most = (branched ? 16 : 8) + named(o.skin);
			const least = skinOnly ? 1 : 2;
			if (!Array.isArray(o.bones) || o.bones.length < least || o.bones.length > most)
				return no(`the bend of "${part}" runs along ${least} to ${most} bones`);
			const bb: RigFitBend['bones'] = [];
			for (const b of o.bones) {
				const placed =
					isRecord(b) && Array.isArray(b.at) && b.at.length === 2 && b.at.every(finite);
				if (
					!isRecord(b) ||
					extraKey(b, ['bone', 'at']) !== undefined ||
					typeof b.bone !== 'string' ||
					(b.at === undefined ? !branched && !skinOnly : !placed)
				)
					return no(`the bend of "${part}" places each bone as { bone, at: [u, v] }`);
				const at = b.at as [number, number] | undefined;
				bb.push(at ? { bone: b.bone, at: [at[0], at[1]] } : { bone: b.bone });
			}
			let bend: RigFitBend;
			if (branched) {
				if (o.ramp !== undefined)
					return no(`the bend of "${part}" ramps along one chain or along branches, not both`);
				if (!Array.isArray(o.chains) || !o.chains.length || o.chains.length > 8)
					return no(`the bend of "${part}" branches into 1 to 8 chains`);
				const chains: NonNullable<RigFitBend['chains']> = [];
				for (const c of o.chains) {
					if (
						!isRecord(c) ||
						extraKey(c, ['bones', 'ramp']) !== undefined ||
						!Array.isArray(c.bones) ||
						!c.bones.every((i) => Number.isInteger(i)) ||
						!widths(c.ramp)
					)
						return no(`each branch of the bend of "${part}" is { bones: [index…], ramp }`);
					chains.push({ bones: [...(c.bones as number[])], ramp: [...c.ramp] });
				}
				bend = { bones: bb, chains };
			} else if (skinOnly) {
				bend = { bones: bb };
			} else {
				if (!widths(o.ramp))
					return no(`the bend of "${part}" ramps across each joint by a finite width`);
				bend = { bones: bb, ramp: [...o.ramp] };
			}
			if (o.skin !== undefined) {
				const pair = (v: unknown): v is [number, number] =>
					Array.isArray(v) && v.length === 2 && v.every(finite);
				// Joints and regions, each splitting its share across a `then` of either, SKIN_DEPTH deep.
				const joints = (list: unknown, depth: number): RigSkin[] | null => {
					if (!Array.isArray(list) || !list.length || list.length > MAX_SKIN) return null;
					const out: RigSkin[] = [];
					for (const j of list) {
						if (!isRecord(j) || typeof j.bone !== 'string' || !pair(j.at) || !pair(j.dir))
							return null;
						const nest = depth < SKIN_DEPTH ? ['then'] : [];
						const inner = j.then === undefined ? undefined : joints(j.then, depth + 1);
						if (inner === null) return null;
						if (j.extent !== undefined) {
							const extent = j.extent;
							const split = j.split;
							if (
								extraKey(j, ['bone', 'at', 'dir', 'extent', 'core', 'run', 'split', ...nest]) !==
									undefined ||
								!Array.isArray(extent) ||
								extent.length !== 4 ||
								!extent.every(finite) ||
								!finite(j.core) ||
								(j.run !== undefined && !finite(j.run)) ||
								(split !== undefined &&
									(!Array.isArray(split) ||
										split.length !== 4 ||
										!split.every((n) => typeof n === 'string') ||
										inner !== undefined))
							)
								return null;
							out.push({
								bone: j.bone,
								at: [j.at[0], j.at[1]],
								dir: [j.dir[0], j.dir[1]],
								extent: [extent[0], extent[1], extent[2], extent[3]],
								core: j.core,
								...(j.run !== undefined ? { run: j.run as number } : {}),
								...(inner ? { then: inner } : {}),
								...(split
									? { split: [...(split as string[])] as [string, string, string, string] }
									: {}),
							});
							continue;
						}
						if (
							extraKey(j, ['bone', 'at', 'dir', 'width', 'reach', ...nest]) !== undefined ||
							!finite(j.width) ||
							!finite(j.reach)
						)
							return null;
						out.push({
							bone: j.bone,
							at: [j.at[0], j.at[1]],
							dir: [j.dir[0], j.dir[1]],
							width: j.width,
							reach: j.reach,
							...(inner ? { then: inner } : {}),
						});
					}
					return out;
				};
				const skin = joints(o.skin, 0);
				if (!skin)
					return no(
						`the bend of "${part}" is skinned across 1 to ${MAX_SKIN} joints { bone, at: [x, y], dir: [x, y], width, reach, then? } or regions { bone, at, dir, extent: [left, right, down, up], core, run?, then? }`,
					);
				bend.skin = skin;
			}
			if (o.grid !== undefined) {
				if (!Array.isArray(o.grid) || o.grid.length !== 2 || !o.grid.every(Number.isInteger))
					return no(`the bend of "${part}" has a grid of whole [columns, rows]`);
				bend.grid = [o.grid[0], o.grid[1]];
			}
			if (o.covers !== undefined) {
				if (!Array.isArray(o.covers) || !o.covers.every((c) => typeof c === 'string'))
					return no(`the bend of "${part}" covers a list of part names`);
				bend.covers = [...(o.covers as string[])];
			}
			bends[part] = bend;
		}
		fit.bends = bends;
	}
	return { fit };
}

/** Why `fit` does not fit template `t`, or null: everything it names must be the template's. */
export function rigFitProblem(t: RigTemplate, fit: RigFit): string | null {
	const bones = new Map(t.bones.map((b) => [b.name, b]));
	for (const [name, f] of Object.entries(fit.bones)) {
		const b = bones.get(name);
		if (!b) return `it fits a bone "${name}" the template does not have`;
		if (!finite(f.x) || !finite(f.y)) return `it fits "${name}" to a value that is not a number`;
		if (controlTarget(name))
			return `"${name}" is a control: it keeps its place on what it marks, it is not fitted`;
		const tl = Math.hypot(b.x, b.y);
		const fl = Math.hypot(f.x, f.y);
		if (tl === 0) return `"${name}" sits on its parent, so it has no length to fit`;
		if (!(fl > 0)) return `it fits "${name}" to no length`;
		if (!(fl <= MAX_FIT_LENGTH)) return `it fits "${name}" longer than ${MAX_FIT_LENGTH} px`;
		const turn = (b.x * f.y - b.y * f.x) / (tl * fl);
		if (!(Math.abs(turn) <= TURN_EPS) || !(b.x * f.x + b.y * f.y > 0))
			return `it turns "${name}" off the template's direction: a fit changes lengths, never directions`;
	}
	for (const [name, f] of Object.entries(fit.fingers ?? {})) {
		const b = bones.get(name);
		if (!b || !FINGER_BONE.test(name))
			return `it places a finger "${name}" the template does not have`;
		if (fit.bones[name]) return `it fits "${name}" both as a bone and as a finger`;
		const fl = Math.hypot(f.x, f.y);
		if (!finite(f.x) || !finite(f.y) || !(fl > 0) || !(fl <= MAX_FIT_LENGTH))
			return `it places "${name}" at no length, or past ${MAX_FIT_LENGTH} px`;
	}
	if (fit.features) {
		const under = faceBones(t.bones, true);
		for (const [name, f] of Object.entries(fit.features.at)) {
			if (!under.has(name) || name === 'face')
				return `it places a feature "${name}" that is not a bone under the template's face`;
			if (fit.bones[name] || fit.fingers?.[name])
				return `it fits "${name}" both as a bone and as a feature`;
			if (!finite(f.x) || !finite(f.y) || !(Math.hypot(f.x, f.y) <= MAX_FIT_LENGTH))
				return `it places "${name}" past ${MAX_FIT_LENGTH} px`;
		}
		for (const [name, k] of Object.entries(fit.features.scale)) {
			if (!under.has(name)) return `it scales "${name}", which is not the template's face`;
			if (!k.every((v) => finite(v) && v >= 0 && v <= MAX_FEATURE_SCALE))
				return `it scales "${name}" by ${k.join(', ')}, not factors from 0 to ${MAX_FEATURE_SCALE}`;
		}
	}
	if (fit.turn) {
		if (!bones.get('face')?.parent) return 'it turns a head, but the template has no face on one';
		const ring: readonly string[] = HEAD_TURN_BONES;
		const seen = new Set<string>();
		for (const b of fit.turn.bones) {
			if (!ring.includes(b.name) || seen.has(b.name))
				return `it turns the head on a bone "${b.name}", not one of ${HEAD_TURN_BONES.join(', ')} once`;
			if (bones.has(b.name)) return `the template already has a bone "${b.name}"`;
			seen.add(b.name);
			if (!(Math.hypot(...b.at) <= MAX_FIT_LENGTH) || !(Math.abs(b.depth) <= MAX_TURN_DEPTH))
				return `it places "${b.name}" past ${MAX_FIT_LENGTH} px or ${MAX_TURN_DEPTH} deep`;
		}
		const props = new Set((fit.props ?? []).filter((p) => p.at).map((p) => p.name));
		for (const [name, z] of Object.entries(fit.turn.depths ?? {}))
			if ((!bones.has(name) && !props.has(name)) || seen.has(name) || name === 'face')
				return `it sets the depth of "${name}", which is not a bone of the template or a prop's`;
			else if (!(Math.abs(z) <= MAX_TURN_DEPTH))
				return `it sets "${name}" ${z} deep, past ${MAX_TURN_DEPTH}`;
	}
	for (const [name, p] of Object.entries(fit.frame ?? {})) {
		if (!bones.has(name)) return `the frame turns a bone "${name}" the template does not have`;
		if (
			!finite(p.rotate) ||
			(p.scaleY !== undefined && !(finite(p.scaleY) && p.scaleY > 0)) ||
			(p.x !== undefined && !finite(p.x)) ||
			(p.y !== undefined && !finite(p.y))
		)
			return `the frame poses "${name}" with a value that is not a number`;
		if (!(Math.hypot(p.x ?? 0, p.y ?? 0) <= MAX_FIT_LENGTH))
			return `the frame moves "${name}" past ${MAX_FIT_LENGTH} px`;
	}
	const slots = new Set(t.slots.map((s) => s.name));
	const parts = new Set(t.parts.map((p) => p.name));
	for (const p of fit.props ?? []) {
		if (!NAME.test(p.name)) return `a prop "${p.name}" needs a name of letters, digits, _ and -`;
		if (slots.has(p.name) || parts.has(p.name))
			return `prop "${p.name}" is named like a slot or a part the template already has`;
		if (!bones.has(p.bone))
			return `prop "${p.name}" rides a bone "${p.bone}" the template does not have`;
		const at = p.before ?? p.after;
		if ((p.before === undefined) === (p.after === undefined) || at === undefined)
			return `prop "${p.name}" is drawn either before or after one slot`;
		if (!slots.has(at))
			return `prop "${p.name}" is drawn next to a slot "${at}" the rig does not have`;
		if (p.at) {
			if (bones.has(p.name)) return `prop "${p.name}" is named like a bone the template has`;
			if (!p.at.every(finite) || !(Math.hypot(...p.at) <= MAX_FIT_LENGTH))
				return `prop "${p.name}" hangs at a place that is not a number`;
			bones.set(p.name, { name: p.name, parent: p.bone, x: p.at[0], y: p.at[1] });
		}
		slots.add(p.name);
		parts.add(p.name);
	}
	const stray = fit.order?.find((n) => !slots.has(n));
	if (stray !== undefined) return `it orders a slot "${stray}" the rig does not have`;
	// The bend itself (its grid, bones, ramp and covers) is the template's contract, checked on the
	// fitted template: here only that it names a part to bend.
	for (const part of Object.keys(fit.bends ?? {}))
		if (!t.parts.some((p) => p.name === part))
			return `it bends a part "${part}" the template does not have`;
	return null;
}

const SCALED_TIMELINES = { translate: ['x', 'y'], translatex: ['value'], translatey: ['value'] };

/**
 * `a` (a template clip's timelines, or an `.irig` animation: the same shape) with each translate key
 * on a fitted bone scaled by that bone's fit (bezier values too): along x by `ratio`, along y by
 * `ratioY` (a face's feature, `RigFit.features`), else by `ratio` too.
 */
export function fitTimelines<A extends RigTemplateTimelines>(
	a: A,
	ratio: Map<string, number>,
	ratioY: Map<string, number> = ratio,
): A {
	if (!a.bones || !Object.keys(a.bones).some((b) => ratio.has(b) || ratioY.has(b))) return a;
	const bones: NonNullable<RigTemplateTimelines['bones']> = {};
	for (const [bone, tls] of Object.entries(a.bones)) {
		const [sx, sy] = [ratio.get(bone), ratioY.get(bone)];
		if (sx === undefined && sy === undefined) {
			bones[bone] = tls;
			continue;
		}
		bones[bone] = Object.fromEntries(
			Object.entries(tls).map(([name, keys]) => {
				const fields = SCALED_TIMELINES[name as keyof typeof SCALED_TIMELINES];
				if (!fields) return [name, keys];
				// Each value's factor: translate's x then y, translatex's x, translatey's y.
				const by = (name === 'translatey' ? [sy] : name === 'translatex' ? [sx] : [sx, sy]).map(
					(v) => v ?? 1,
				);
				return [
					name,
					keys.map((k) => {
						const out: Record<string, unknown> = { ...k };
						fields.forEach((f, i) => {
							if (finite(out[f])) out[f] = (out[f] as number) * by[i];
						});
						// A bezier's values sit at its odd places (cx, cy pairs, two pairs per value).
						if (Array.isArray(out.curve))
							out.curve = out.curve.map((v, i) =>
								i % 2 === 1 && finite(v) ? v * by[Math.min(by.length - 1, i >> 2)] : v,
							);
						return out as { time?: number };
					}),
				];
			}),
		);
	}
	return { ...a, bones };
}

/** `list` with `name` put just before or after `at` (which it holds), else unchanged. */
function insertBeside(list: readonly string[], name: string, at: string, after: boolean): string[] {
	const i = list.indexOf(at);
	if (i < 0) return [...list];
	const out = [...list];
	out.splice(after ? i + 1 : i, 0, name);
	return out;
}

/** What of a template carries its lengths (a template, or the summary the Rigger reads of one). */
export interface LengthBearing {
	bones: RigTemplateBone[];
	channels: RigTemplateChannel[];
	clips: RigTemplateClip[];
	rig3d?: RigTemplate3d | null;
}

/** Each fitted bone's fitted / template length, by name. */
export function fitRatios(
	bones: readonly RigTemplateBone[],
	fit: RigFit['bones'],
): Map<string, number> {
	const ratio = new Map<string, number>();
	for (const b of bones) {
		const f = fit[b.name];
		if (f) ratio.set(b.name, b.y !== 0 ? f.y / b.y : f.x / b.x);
	}
	return ratio;
}

/**
 * The depth of `bone` (z in its parent's frame) as a fit scales it: a fitted bone's by its own fit,
 * a control's by the fit of what it marks (an elbow pole sits behind the elbow by the upper arm).
 */
export function depthRatio(ratio: Map<string, number>, bone: string): number {
	const target = controlTarget(bone);
	return ratio.get(bone) ?? (target ? ratio.get(target) : undefined) ?? 1;
}

/**
 * `t` with the lengths of `fit` (checked first by `rigFitProblem`) and what carries a length
 * following them: a fitted bone's moves (a limb's shortening brings the next joint in by its fitted
 * length, not the template's) and the timeline keys that translate it, the control bones and poles
 * (each keeps its place on the joint it marks), and the depths of the poles (behind the elbow by the
 * arm's length). Image bones sit on their joint, so they need nothing. A bone in `scales` (a face's
 * feature, `RigFit.features`) has its moves scaled by its factor there instead.
 */
export function fitLengths<T extends LengthBearing>(
	t: T,
	fit: RigFit['bones'],
	scales: Record<string, [number, number]> = {},
): T {
	const ratio = fitRatios(t.bones, fit);
	const ratioY = new Map(ratio);
	for (const [bone, [kx, ky]] of Object.entries(scales)) {
		ratio.set(bone, kx);
		ratioY.set(bone, ky);
	}
	const fitted = t.bones.map((b) => {
		const f = fit[b.name];
		return f ? { ...b, x: f.x, y: f.y } : b;
	});
	const before = boneWorld(t.bones);
	const plain = boneWorld(fitted);
	const after = new Map<string, [number, number]>();
	const bones = fitted.map((b) => {
		const p = b.parent === undefined ? [0, 0] : after.get(b.parent)!;
		const target = controlTarget(b.name);
		let out = b;
		if (target && before.has(target)) {
			const [x0, y0] = before.get(b.name)!;
			const [tx0, ty0] = before.get(target)!;
			const [tx1, ty1] = plain.get(target)!;
			const x = round4(x0 + tx1 - tx0 - p[0]);
			const y = round4(y0 + ty1 - ty0 - p[1]);
			if (x !== b.x || y !== b.y) out = { ...b, x, y };
		}
		after.set(b.name, [p[0] + out.x, p[1] + out.y]);
		return out;
	});

	const channels = t.channels.map((c): RigTemplateChannel => {
		const of = (prop: string) => (prop === 'x' ? ratio : prop === 'y' ? ratioY : null);
		if (!c.drives?.some((d) => of(d.prop)?.has(d.bone))) return c;
		return {
			...c,
			drives: c.drives.map((d) => {
				const k = of(d.prop)?.get(d.bone);
				return k === undefined ? d : { ...d, per: d.per * k };
			}),
		};
	});
	const clips = t.clips.map((c): RigTemplateClip =>
		c.animation ? { ...c, animation: fitTimelines(c.animation, ratio, ratioY) } : c,
	);
	const rig3d = t.rig3d && {
		...t.rig3d,
		depths: Object.fromEntries(
			Object.entries(t.rig3d.depths).map(([b, z]) => [b, z * depthRatio(ratio, b)]),
		),
	};
	return { ...t, bones, channels, clips, ...(rig3d ? { rig3d } : {}) };
}

/**
 * Template `t` fitted to a character (checked first by `rigFitProblem`): its lengths
 * (`fitLengths`, with the face's features scaled as they are drawn), its fingers and features where
 * the frame has them, then its props, which become slots and optional parts drawn in depth with their
 * neighbour (a depth control moving the arm moves the watch on it), and its bending parts, which take
 * their chain weights.
 */
export function fitTemplate(t: RigTemplate, fit: RigFit): RigTemplate {
	const lengthened = fitLengths(t, fit.bones, fit.features?.scale);
	const { channels, clips } = lengthened;
	const bones = lengthened.bones.map((b) => {
		const f = fit.fingers?.[b.name] ?? fit.features?.at[b.name];
		return f ? { ...b, x: round4(f.x), y: round4(f.y) } : b;
	});
	let slots: RigTemplateSlot[] = [...t.slots];
	const parts: RigTemplatePart[] = t.parts.map((p) => {
		const b = fit.bends?.[p.name];
		return b
			? {
					...p,
					bend: {
						grid: b.grid ?? FIT_BEND_GRID,
						bones: b.bones,
						...(b.chains ? { chains: b.chains } : b.ramp ? { ramp: b.ramp } : {}),
						...(b.skin ? { skin: b.skin } : {}),
						...(b.covers?.length ? { covers: b.covers } : {}),
					},
				}
			: p;
	});
	let withProps = channels;
	let layers = t.rig3d?.layers;
	for (const prop of fit.props ?? []) {
		const at = (prop.before ?? prop.after)!;
		const isAfter = prop.after !== undefined;
		const i = slots.findIndex((s) => s.name === at);
		slots = [
			...slots.slice(0, isAfter ? i + 1 : i),
			{ name: prop.name, bone: prop.at ? prop.name : prop.bone, setup: prop.name },
			...slots.slice(isAfter ? i + 1 : i),
		];
		parts.push({ name: prop.name, slot: prop.name, required: false, size: PROP_SIZE });
		if (prop.at)
			bones.push({
				name: prop.name,
				parent: prop.bone,
				x: round4(prop.at[0]),
				y: round4(prop.at[1]),
			});
		withProps = withProps.map((c) =>
			c.order?.slots.includes(at)
				? {
						...c,
						order: { ...c.order, slots: insertBeside(c.order.slots, prop.name, at, isAfter) },
					}
				: c,
		);
		if (layers)
			layers = Object.fromEntries(
				Object.entries(layers).map(([k, v]) => [k, insertBeside(v, prop.name, at, isAfter)]),
			);
	}

	let depths = lengthened.rig3d?.depths;
	if (fit.turn) {
		const head = t.bones.find((b) => b.name === 'face')!.parent!;
		for (const b of fit.turn.bones)
			bones.push({ name: b.name, parent: head, x: round4(b.at[0]), y: round4(b.at[1]) });
		const deep = [
			...fit.turn.bones.map((b): [string, number] => [b.name, b.depth]),
			...Object.entries(fit.turn.depths ?? {}),
		];
		if (depths) depths = { ...depths, ...Object.fromEntries(deep) };
		withProps = withProps.map((c) => slidByDepth(t, c, deep));
	}

	if (fit.order) {
		const byName = new Map(slots.map((s) => [s.name, s]));
		slots = inDrawOrder(
			slots.map((s) => s.name),
			fit.order,
		).map((n) => byName.get(n)!);
		if (layers)
			layers = layersTogether(
				layers,
				slots.map((s) => s.name),
			);
	}
	const rig3d = lengthened.rig3d && {
		...lengthened.rig3d,
		...(depths ? { depths } : {}),
		...(layers ? { layers } : {}),
	};
	return {
		...t,
		bones,
		slots,
		parts,
		channels: withProps,
		clips,
		...(rig3d ? { rig3d } : {}),
	};
}

/** The controls that slide the face by its depth, and the way each slides it. */
const DEPTH_SLIDES: Record<string, 'x' | 'y'> = { head_turn: 'x', head_pitch: 'y' };

/**
 * Control `c` (of template `t`) with `deep`'s bones ([bone, depth]) slid by their depths, as it
 * slides the template's face by its own (the Head turn and Head up / down controls): unchanged for
 * any other control, or a template whose face has no depth or no such drive. A bone another control
 * moves that way (the jaw sideways, a lip up) keeps its depth in 3D alone: a move has one control.
 */
function slidByDepth(
	t: RigTemplate,
	c: RigTemplateChannel,
	deep: readonly [string, number][],
): RigTemplateChannel {
	const prop = DEPTH_SLIDES[c.id];
	const face = t.channels
		.find((x) => x.id === c.id)
		?.drives?.find((d) => d.bone === 'face' && d.prop === prop);
	const z = t.rig3d?.depths.face;
	if (!prop || !face || !z) return c;
	const taken = new Set(
		t.channels
			.filter((x) => x.id !== c.id)
			.flatMap((x) => (x.drives ?? []).filter((d) => d.prop === prop).map((d) => d.bone)),
	);
	const slid = deep.filter(([bone]) => !taken.has(bone));
	const own = new Set(slid.map(([b]) => b));
	return {
		...c,
		drives: [
			...(c.drives ?? []).filter((d) => !(own.has(d.bone) && d.prop === prop)),
			...slid.map(([bone, depth]) => ({ bone, prop, per: round4((depth * face.per) / z) })),
		],
	};
}

/** The frame's pose as an irig animation, every key at t = 0. */
export function frameAnimation(frame: NonNullable<RigFit['frame']>): Record<string, unknown> {
	const bones: Record<string, Record<string, unknown[]>> = {};
	for (const [bone, p] of Object.entries(frame)) {
		const tl: Record<string, unknown[]> = { rotate: [{ time: 0, value: p.rotate }] };
		if (p.scaleY !== undefined) tl.scale = [{ time: 0, x: 1, y: p.scaleY }];
		if (p.x !== undefined || p.y !== undefined)
			tl.translate = [{ time: 0, x: p.x ?? 0, y: p.y ?? 0 }];
		bones[bone] = tl;
	}
	return { bones };
}

/**
 * A vertex's weights along a chain (frame-to-rig §4.7): past each joint the next bone takes over,
 * its share ramping linearly along the line from the joint before, across `ramp` of width centred
 * on the joint. Far from a joint a vertex rides one bone alone; the weights sum to 1. Linear, not
 * eased: a blend of two turns folds the inside of a bend once the share's slope × the limb's half
 * width × sin(bend) passes cos²(bend / 2), which a linear ramp as wide as the limb reaches at 90°,
 * an eased one (1.5× steeper in its middle) at about 67°. `lead` is how much of the ramp lies past
 * the joint: half by default; 0 ends it at the joint, so a bone squeezing its own length (a finger's
 * curl) never folds the skin before it (centred, a squeeze under ⅓ does).
 */
export function rampWeights(
	anchors: readonly [number, number][],
	ramp: readonly number[],
	x: number,
	y: number,
	lead = 0.5,
): number[] {
	const out: number[] = [];
	let reached = 1;
	for (let i = 0; i < anchors.length; i++) {
		let past = 0;
		if (i + 1 < anchors.length) {
			const [ax, ay] = anchors[i];
			const [bx, by] = anchors[i + 1];
			const len = Math.hypot(bx - ax, by - ay);
			const s = ((x - bx) * (bx - ax) + (y - by) * (by - ay)) / len;
			past = Math.min(1, Math.max(0, s / ramp[i] + (1 - lead)));
		}
		out.push(reached * (1 - past));
		reached *= past;
	}
	return out;
}

/**
 * A vertex's weights on a branching bend (a hand and its fingers): the branch it lies nearest — its
 * line from its first joint on, run past the last joint by the segment before it (the fingertip) —
 * shared with any other within half a finger's width of that, and along each branch as
 * `rampWeights` ramps, each ramp ending at its joint (a curl squeezes a finger toward its knuckle;
 * a ramp past the joint would fold the skin there). One weight per anchor, summing to 1.
 */
export function chainWeights(
	anchors: readonly { x: number; y: number }[],
	chains: readonly { bones: readonly number[]; ramp: readonly number[] }[],
	x: number,
	y: number,
): number[] {
	const segDist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
		const [dx, dy] = [b.x - a.x, b.y - a.y];
		const l2 = dx * dx + dy * dy;
		const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
		return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
	};
	// How near each finger runs: its line from its first joint on (the palm before it is the root's).
	const near = chains.map((c) => {
		const pts = c.bones.slice(1).map((i) => anchors[i]);
		const [a, b] = [
			pts.length > 1 ? pts[pts.length - 2] : anchors[c.bones[0]],
			pts[pts.length - 1],
		];
		pts.push({ x: 2 * b.x - a.x, y: 2 * b.y - a.y });
		let d = Infinity;
		for (let k = 1; k < pts.length; k++) d = Math.min(d, segDist(pts[k - 1], pts[k]));
		return d;
	});
	let best = 0;
	near.forEach((d, i) => {
		if (d < near[best]) best = i;
	});
	// Between two fingers the share passes from one to the other across half a finger's width, so
	// the skin between them follows both.
	const share = near.map((d, i) =>
		Math.max(0, 1 - (d - near[best]) / Math.max(1e-6, 0.5 * chains[i].ramp[0])),
	);
	const total = share.reduce((s, v) => s + v, 0);
	const out = anchors.map(() => 0);
	chains.forEach((c, i) => {
		if (!share[i]) return;
		const w = rampWeights(
			c.bones.map((k): [number, number] => [anchors[k].x, anchors[k].y]),
			c.ramp,
			x,
			y,
			0,
		);
		c.bones.forEach((k, n) => (out[k] += (w[n] * share[i]) / total));
	});
	return out;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
