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

/**
 * A rig template fitted to one character (docs/design/frame-to-rig.md §4.6, §4.7): the template's
 * skeleton with the character's own lengths, the pose of the frame it was cut from, the props it
 * wears and the parts drawn as one bending piece. A fit changes lengths, never directions or names,
 * so every control and starter clip of the template plays on the fitted rig.
 */
export interface RigFit {
	/** New setup offsets (rig units, in the parent's frame), each along the template's direction. */
	bones: Record<string, { x: number; y: number }>;
	/** The frame's pose: keyed at t = 0 of the animation `frame`, relative to setup as every key is. */
	frame?: Record<string, { rotate: number; scaleY?: number }>;
	/** Worn things (§4.3a), each a slot of its own drawn just before or after the slot it names. */
	props?: RigFitProp[];
	/** Parts drawn as one bending piece, by part name (§4.7). */
	bends?: Record<string, RigFitBend>;
}

export interface RigFitProp {
	name: string;
	bone: string;
	before?: string;
	after?: string;
}

/**
 * A part weighted along a chain of bones: `bones` in order along the limb, each at its joint on the
 * image (u, v from the top-left, 0…1, of the untrimmed image), and per joint after the first the
 * limb's width there (rig units), the width its weight ramps across. `covers`: the parts this one
 * piece stands in for (a one-piece arm draws the forearm), so the rig does not report them needed.
 */
export interface RigFitBend {
	bones: { bone: string; at: [number, number] }[];
	ramp: number[];
	grid?: [number, number];
	covers?: string[];
}

/** The grid a fitted bend takes when the fit names none: rows enough for a ramp across an elbow. */
export const FIT_BEND_GRID: [number, number] = [3, 32];
/** A prop's placeholder size, until its art is attached. */
const PROP_SIZE: [number, number] = [64, 64];
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** How far a fitted bone may turn off its template direction (float noise, not a turn). */
const TURN_EPS = 2e-4;
/** The longest a fitted bone may be (px): past it the world sums overflow to Infinity. */
const MAX_FIT_LENGTH = 100_000;

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
	const extra = extraKey(raw, ['bones', 'frame', 'props', 'bends']);
	if (extra !== undefined) return no(`a fit has no field "${extra}"`);
	if (!isRecord(raw.bones)) return no('a fit needs `bones`: { name: { x, y } }');
	const bones: RigFit['bones'] = {};
	for (const [name, o] of Object.entries(raw.bones)) {
		if (!isRecord(o) || extraKey(o, ['x', 'y']) !== undefined || !finite(o.x) || !finite(o.y))
			return no(`bone "${name}" is fitted to { x, y }, two finite numbers`);
		bones[name] = { x: o.x, y: o.y };
	}
	const fit: RigFit = { bones };
	if (raw.frame !== undefined) {
		if (!isRecord(raw.frame)) return no('`frame` is { bone: { rotate, scaleY? } }');
		const frame: NonNullable<RigFit['frame']> = {};
		for (const [name, o] of Object.entries(raw.frame)) {
			if (!isRecord(o) || extraKey(o, ['rotate', 'scaleY']) !== undefined || !finite(o.rotate))
				return no(`the frame turns "${name}" by { rotate, scaleY? }, finite numbers`);
			if (o.scaleY !== undefined && !(finite(o.scaleY) && o.scaleY > 0))
				return no(`the frame scales "${name}" by a finite scaleY above 0`);
			frame[name] =
				o.scaleY === undefined ? { rotate: o.rotate } : { rotate: o.rotate, scaleY: o.scaleY };
		}
		fit.frame = frame;
	}
	if (raw.props !== undefined) {
		if (!Array.isArray(raw.props) || raw.props.length > 64)
			return no('`props` is a list of up to 64 { name, bone, before | after }');
		const props: RigFitProp[] = [];
		for (const p of raw.props) {
			if (!isRecord(p) || extraKey(p, ['name', 'bone', 'before', 'after']) !== undefined)
				return no('a prop is { name, bone, before | after }');
			const { name, bone, before, after } = p;
			if (typeof name !== 'string' || !NAME.test(name))
				return no('a prop is named with letters, digits, _ and - (up to 64)');
			if (typeof bone !== 'string' || !bone) return no(`prop "${name}" needs the bone it rides`);
			if ((before === undefined) === (after === undefined))
				return no(`prop "${name}" is drawn either before or after one slot`);
			const at = before ?? after;
			if (typeof at !== 'string' || !at) return no(`prop "${name}" names its neighbour slot`);
			props.push(before === undefined ? { name, bone, after: at } : { name, bone, before: at });
		}
		fit.props = props;
	}
	if (raw.bends !== undefined) {
		if (!isRecord(raw.bends)) return no('`bends` is { part: { bones, ramp, grid?, covers? } }');
		const bends: NonNullable<RigFit['bends']> = {};
		for (const [part, o] of Object.entries(raw.bends)) {
			if (!isRecord(o) || extraKey(o, ['bones', 'ramp', 'grid', 'covers']) !== undefined)
				return no(`the bend of "${part}" is { bones, ramp, grid?, covers? }`);
			if (!Array.isArray(o.bones) || o.bones.length < 2 || o.bones.length > 8)
				return no(`the bend of "${part}" runs along 2 to 8 bones`);
			const bb: RigFitBend['bones'] = [];
			for (const b of o.bones) {
				if (
					!isRecord(b) ||
					extraKey(b, ['bone', 'at']) !== undefined ||
					typeof b.bone !== 'string' ||
					!Array.isArray(b.at) ||
					b.at.length !== 2 ||
					!b.at.every(finite)
				)
					return no(`the bend of "${part}" places each bone as { bone, at: [u, v] }`);
				bb.push({ bone: b.bone, at: [b.at[0], b.at[1]] });
			}
			if (!Array.isArray(o.ramp) || !o.ramp.every(finite))
				return no(`the bend of "${part}" ramps across each joint by a finite width`);
			const bend: RigFitBend = { bones: bb, ramp: [...(o.ramp as number[])] };
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
	for (const [name, p] of Object.entries(fit.frame ?? {})) {
		if (!bones.has(name)) return `the frame turns a bone "${name}" the template does not have`;
		if (!finite(p.rotate) || (p.scaleY !== undefined && !(finite(p.scaleY) && p.scaleY > 0)))
			return `the frame poses "${name}" with a value that is not a number`;
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
		slots.add(p.name);
		parts.add(p.name);
	}
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
 * on a fitted bone scaled by that bone's fit (bezier values too).
 */
export function fitTimelines<A extends RigTemplateTimelines>(a: A, ratio: Map<string, number>): A {
	if (!a.bones || !Object.keys(a.bones).some((b) => ratio.has(b))) return a;
	const bones: NonNullable<RigTemplateTimelines['bones']> = {};
	for (const [bone, tls] of Object.entries(a.bones)) {
		const s = ratio.get(bone);
		if (s === undefined) {
			bones[bone] = tls;
			continue;
		}
		bones[bone] = Object.fromEntries(
			Object.entries(tls).map(([name, keys]) => {
				const fields = SCALED_TIMELINES[name as keyof typeof SCALED_TIMELINES];
				if (!fields) return [name, keys];
				return [
					name,
					keys.map((k) => {
						const out: Record<string, unknown> = { ...k };
						for (const f of fields) if (finite(out[f])) out[f] = (out[f] as number) * s;
						// A bezier's values sit at its odd places (cx, cy pairs per value).
						if (Array.isArray(out.curve))
							out.curve = out.curve.map((v, i) => (i % 2 === 1 && finite(v) ? v * s : v));
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
 * arm's length). Image bones sit on their joint, so they need nothing.
 */
export function fitLengths<T extends LengthBearing>(t: T, fit: RigFit['bones']): T {
	const ratio = fitRatios(t.bones, fit);
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
		if (!c.drives?.some((d) => (d.prop === 'x' || d.prop === 'y') && ratio.has(d.bone))) return c;
		return {
			...c,
			drives: c.drives.map((d) =>
				(d.prop === 'x' || d.prop === 'y') && ratio.has(d.bone)
					? { ...d, per: d.per * ratio.get(d.bone)! }
					: d,
			),
		};
	});
	const clips = t.clips.map((c): RigTemplateClip =>
		c.animation ? { ...c, animation: fitTimelines(c.animation, ratio) } : c,
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
 * (`fitLengths`), then its props, which become slots and optional parts drawn in depth with their
 * neighbour (a depth control moving the arm moves the watch on it), and its bending parts, which take
 * their chain weights.
 */
export function fitTemplate(t: RigTemplate, fit: RigFit): RigTemplate {
	const { bones, channels, clips, rig3d: lengthened } = fitLengths(t, fit.bones);
	let slots: RigTemplateSlot[] = [...t.slots];
	const parts: RigTemplatePart[] = t.parts.map((p) => {
		const b = fit.bends?.[p.name];
		return b
			? {
					...p,
					bend: {
						grid: b.grid ?? FIT_BEND_GRID,
						bones: b.bones,
						ramp: b.ramp,
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
			{ name: prop.name, bone: prop.bone, setup: prop.name },
			...slots.slice(isAfter ? i + 1 : i),
		];
		parts.push({ name: prop.name, slot: prop.name, required: false, size: PROP_SIZE });
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

	const rig3d = lengthened && { ...lengthened, ...(layers ? { layers } : {}) };
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

/** The frame's pose as an irig animation, every key at t = 0. */
export function frameAnimation(frame: NonNullable<RigFit['frame']>): Record<string, unknown> {
	const bones: Record<string, Record<string, unknown[]>> = {};
	for (const [bone, p] of Object.entries(frame)) {
		const tl: Record<string, unknown[]> = { rotate: [{ time: 0, value: p.rotate }] };
		if (p.scaleY !== undefined) tl.scale = [{ time: 0, x: 1, y: p.scaleY }];
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
 * an eased one (1.5× steeper in its middle) at about 67°.
 */
export function rampWeights(
	anchors: readonly [number, number][],
	ramp: readonly number[],
	x: number,
	y: number,
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
			past = Math.min(1, Math.max(0, s / ramp[i] + 0.5));
		}
		out.push(reached * (1 - past));
		reached *= past;
	}
	return out;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
