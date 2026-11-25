import {
	CONTROLS_VERSION,
	controlsDocProblems,
	controlsIrigProblems,
	fitControls,
	type ControlBone,
	type ControlChannel,
	type ControlLimb,
	type ControlLimit,
	type ControlsDoc,
} from '../rigControls';
import type {
	RigTemplate,
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplateUi,
} from './rigTemplates';

/**
 * A rig template's control layer (docs/design/rig-controls.md §6.1, T12a): what ＋ New rig writes to
 * the new rig's `controls.json` — the FK rings, layers, selection sets, mirror line and picker layout
 * — and the native constraints a template saved from a rig carries. The face board is the channels'
 * own `ui`. Authoring only: no clip, export or game reads either.
 */

/** `controls.json` without what binds it to one rig (its version, `rig` and pair mark). */
export type RigTemplateControls = Omit<ControlsDoc, 'controls' | 'rig' | 'irig'>;

/** Native constraints as the irig writes them, per kind. */
export type RigTemplateConstraints = Partial<
	Record<(typeof CONSTRAINT_KINDS)[number], Record<string, unknown>[]>
>;

export const CONSTRAINT_KINDS = ['ik', 'transform', 'path', 'physics'] as const;

type Prop = 'x' | 'y' | 'rotate' | 'scaleX' | 'scaleY';
const PROPS_OF: Record<ControlChannel, Prop[]> = {
	translate: ['x', 'y'],
	rotate: ['rotate'],
	scale: ['scaleX', 'scaleY'],
	tilt: [],
	twist: [],
	depth: [],
};

/** The channels a control lets the gizmo key, as the Rigger reads them (`controlCanKey`). */
function controlKeys(c: ControlBone): ControlChannel[] {
	return c.channels ?? (c.shape === 'ring' ? ['rotate'] : ['translate', 'rotate', 'scale']);
}

/** Which template channel drives each `bone.prop`. */
function driveOwners(channels: readonly RigTemplateChannel[]): Map<string, RigTemplateChannel> {
	const out = new Map<string, RigTemplateChannel>();
	for (const c of channels) for (const d of c.drives ?? []) out.set(`${d.bone}.${d.prop}`, c);
	return out;
}

/**
 * The channel a control's drag keys (rig-controls §6.1): the one driving every bone property the
 * control keys, or none when no channel drives any of them. A control keying properties of two
 * channels, or a driven one and a free one, would fight its channel — `templateControlsProblem`
 * refuses it.
 */
export function controlChannel(
	bone: string,
	c: ControlBone,
	channels: readonly RigTemplateChannel[],
): { channel: RigTemplateChannel | null } | { clash: string } {
	const owners = driveOwners(channels);
	const props = controlKeys(c).flatMap((k) => PROPS_OF[k]);
	const by = props.map((p) => [p, owners.get(`${bone}.${p}`) ?? null] as const);
	const ids = new Set(by.map(([, o]) => o?.id ?? ''));
	if (ids.size <= 1) return { channel: by[0]?.[1] ?? null };
	const what = by.map(
		([p, o]) => `${bone}.${p} ${o ? `(the "${o.id}" control's)` : '(no control’s)'}`,
	);
	return { clash: what.join(', ') };
}

/** An irig-shaped list of the template's names, for `controlsIrigProblems`. */
const namesOf = (t: Pick<RigTemplate, 'bones' | 'constraints'>) => ({
	bones: t.bones.map((b) => ({ name: b.name })),
	...Object.fromEntries(CONSTRAINT_KINDS.map((k) => [k, t.constraints?.[k] ?? []])),
});

/** Why a template's constraints could not be written into its rigs, or null. */
export function templateConstraintsProblem(t: RigTemplate): string | null {
	const bones = new Set(t.bones.map((b) => b.name));
	const extra = Object.keys(t.constraints ?? {}).find(
		(k) => !(CONSTRAINT_KINDS as readonly string[]).includes(k),
	);
	if (extra) return `carries "${extra}" constraints, which are not a constraint kind`;
	const names = new Set<string>();
	for (const k of CONSTRAINT_KINDS)
		for (const c of t.constraints?.[k] ?? []) {
			const name = c?.name;
			if (typeof name !== 'string' || !name) return `has a ${k} constraint with no name`;
			if (names.has(`${k}:${name}`)) return `has two ${k} constraints named "${name}"`;
			names.add(`${k}:${name}`);
			const refs = [...(Array.isArray(c.bones) ? c.bones : []), c.target, c.bone].filter(
				(n) => n !== undefined,
			);
			const gone = refs.find((n) => typeof n !== 'string' || !bones.has(n));
			if (gone !== undefined) return `${k} constraint "${name}" names a missing bone "${gone}"`;
		}
	return null;
}

/**
 * Why a template's control layer does not fit it, or null: a well-formed `controls.json` (bar its
 * binding to a rig) naming only the template's bones and constraints, whose every control keys what
 * one channel owns or what none does (rig-controls §6.1).
 */
export function templateControlsProblem(t: RigTemplate): string | null {
	if (!t.controls) return null;
	const doc = { ...t.controls, controls: CONTROLS_VERSION, rig: t.id };
	const bad = controlsDocProblems(doc)[0] ?? controlsIrigProblems(doc, namesOf(t))[0];
	if (bad) return `controls: ${bad}`;
	for (const [bone, c] of Object.entries(t.controls.bones ?? {})) {
		if (!c.shape && c.role !== 'control') continue;
		const own = controlChannel(bone, c, t.channels);
		if ('clash' in own)
			return `the control on "${bone}" keys ${own.clash}: a control keys only what one control owns, or what none does`;
	}
	return null;
}

/**
 * What 📐 Save as template keeps of an open rig's `controls.json`: fitted to the rig (an entry naming
 * a bone or constraint it lacks goes), without its binding to the rig. Null for none, an empty one or
 * one that is not a `controls.json` (`unreadable`); the template's own check judges what is left.
 */
export function controlsForTemplate(
	value: unknown,
	rig: Record<string, unknown>,
): { controls: RigTemplateControls | null; dropped: string[]; unreadable?: true } {
	if (value === null || value === undefined) return { controls: null, dropped: [] };
	if (controlsDocProblems(value).length) return { controls: null, dropped: [], unreadable: true };
	const fit = fitControls(value as ControlsDoc, rig);
	const rest: Partial<ControlsDoc> = { ...fit.doc };
	delete rest.controls;
	delete rest.rig;
	delete rest.irig;
	// Slot groups name this rig's own art, which a template's rigs do not share.
	delete rest.slotGroups;
	// A saved template carries no 3D data, so a limb solved in 3D (and its switch) stays behind.
	const dropped = [...fit.dropped];
	const flat = Object.entries(rest.limbs ?? {}).filter(([, l]) => l.ik3d);
	if (flat.length) {
		const gone = new Set(flat.map(([n]) => n));
		rest.limbs = Object.fromEntries(Object.entries(rest.limbs ?? {}).filter(([n]) => !gone.has(n)));
		if (rest.picker?.items)
			rest.picker = {
				...rest.picker,
				items: rest.picker.items.filter((x) => x.limb === undefined || !gone.has(x.limb)),
			};
		for (const n of gone)
			dropped.push(`limbs.${n} is solved in 3D, which a saved template does not carry`);
	}
	return { controls: Object.keys(rest).length ? rest : null, dropped };
}

// ── The built-ins' control layer ───────────────────────────────────────────────────────────────

const FK = 'Body FK';
const IK = 'Body IK';
const FACE = 'Face';
const FINGERS = 'Fingers';
const HELPERS = 'Helpers';

const FACE_BONES =
	/^(face|brow(_in|_out)?_[lr]|eye_[lr]|pupil_[lr]|lid_(follow|upper|lower)_[lr]|cheek_[lr]|nose|mouth_corner_[lr]|lip_(upper|lower)|jaw|hair_(back|front))$/;
const FINGER_BONES = /^(thumb|index|middle|ring|pinky)_\d_[lr]$/;

/** A built-in's control plan: ring sizes by bone, the move squares, the sets and the picker. */
export interface ControlPlan {
	/** FK bones with a ring (rotate only), and its size in rig units. */
	rings: Record<string, number>;
	/** Bones with a square (move and turn), and its size. */
	squares?: Record<string, number>;
	/** The mirror line's bone. */
	line: string;
	sets: Record<string, string[]>;
	/** Picker buttons: a bone (or `set:<name>`), its place on the board, its label. */
	picker: [string, number, number, string][];
}

/** A limit per property the control keys that a channel drives: the channel's range, from setup. */
function channelLimits(
	bone: RigTemplateBone,
	c: ControlBone,
	channels: readonly RigTemplateChannel[],
): Partial<Record<ControlLimit, [number, number]>> | undefined {
	const owners = driveOwners(channels);
	const out: Partial<Record<ControlLimit, [number, number]>> = {};
	for (const p of controlKeys(c).flatMap((k) => PROPS_OF[k])) {
		const ch = owners.get(`${bone.name}.${p}`);
		const d = ch?.drives?.find((x) => x.bone === bone.name && x.prop === p);
		if (!ch || !d) continue;
		const scale = p === 'scaleX' || p === 'scaleY';
		const setup = (scale ? bone[p] : p === 'rotate' ? bone.rotation : bone[p]) ?? (scale ? 1 : 0);
		const at = (v: number) =>
			Math.round((scale ? setup * (1 + v * d.per) : setup + v * d.per) * 1e4) / 1e4;
		const [a, b] = [at(ch.min), at(ch.max)];
		out[p] = a <= b ? [a, b] : [b, a];
	}
	return Object.keys(out).length ? out : undefined;
}

/** A built-in's control layer from its bones, channels and plan. */
export function builtinControls(
	t: { bones: RigTemplateBone[]; channels: RigTemplateChannel[] },
	plan: ControlPlan,
): RigTemplateControls {
	const bones: Record<string, ControlBone> = {};
	for (const b of t.bones) {
		const n = b.name;
		let c: ControlBone | null = null;
		if (plan.rings[n] !== undefined)
			c = { shape: 'ring', size: plan.rings[n], sizeIn: 'rig', channels: ['rotate'], layer: FK };
		else if (plan.squares?.[n] !== undefined)
			c = {
				shape: 'square',
				size: plan.squares[n],
				sizeIn: 'rig',
				channels: ['translate', 'rotate'],
				layer: FK,
			};
		else if (/^(hand|foot)_ik_[lr]$/.test(n))
			c = {
				role: 'control',
				shape: 'square',
				size: 14,
				channels: ['translate', 'rotate'],
				layer: IK,
			};
		else if (/^(elbow|knee)_pole_[lr]$/.test(n))
			c = { role: 'control', shape: 'diamond', size: 10, channels: ['translate'], layer: IK };
		else if (/_ik_[lr]_(chest|world)$/.test(n)) c = { role: 'helper', layer: HELPERS };
		else if (/_image$/.test(n)) c = { hidden: true, layer: HELPERS };
		else if (FACE_BONES.test(n)) c = { layer: FACE };
		else if (FINGER_BONES.test(n)) c = { layer: FINGERS };
		if (!c) continue;
		const limits = c.shape ? channelLimits(b, c, t.channels) : undefined;
		bones[n] = limits ? { ...c, limits } : c;
	}
	const used = new Set(Object.values(bones).map((c) => c.layer));
	const layers = [
		{ name: FK },
		{ name: IK, visible: false },
		{ name: FACE },
		{ name: FINGERS },
		{ name: HELPERS, visible: false },
	].filter((l) => used.has(l.name));
	return {
		bones,
		layers,
		sets: plan.sets,
		mirror: { line: plan.line },
		picker: {
			items: plan.picker.map(([what, x, y, label]) => ({
				...(what.startsWith('set:') ? { set: what.slice(4) } : { bone: what }),
				at: [x, y] as [number, number],
				label,
			})),
		},
	};
}

// ── The built-ins' IK (rig-controls §6.1, T12b) ─────────────────────────────────────────────────

/** A built-in's limb solved in 3D: as `rig3d.json` lists it (`Rig3dIk`). */
export interface TemplateIk3d {
	name: string;
	bones: [string, string];
	end: string;
	target: string;
	pole: string;
}

/** The mixes a space's transform keys: the control takes its space bone's turn and place. */
const spaceMixes = (v: number) => ({
	mixRotate: v,
	mixX: v,
	mixY: v,
	mixScaleX: 0,
	mixScaleY: 0,
	mixShearY: 0,
});

/**
 * A built-in's IK (§6.1, the owner's decisions of §10): per arm a 3D IK from the upper arm through the
 * forearm to the wrist, reaching the hand control and bending toward the elbow pole, its control in
 * chest space (the space's transform at mix 1) with a world space beside it; with `legs`, per leg the
 * same from the thigh to the ankle, reaching the foot control in world space, bending toward the knee
 * pole. Every IK is at mix 0, so no clip changes until one turns it on; the spaces move only control
 * bones, which carry no art. The transforms solve first, in their listed order.
 */
export function builtinIk(legs: boolean): {
	ik: TemplateIk3d[];
	constraints: RigTemplateConstraints;
	limbs: Record<string, ControlLimb>;
} {
	const ik: TemplateIk3d[] = [];
	const transform: Record<string, unknown>[] = [];
	const limbs: Record<string, ControlLimb> = {};
	const space = (control: string, name: string, mix: number) => {
		const constraint = `${control}_in_${name}`;
		transform.push({
			name: constraint,
			order: transform.length,
			bones: [control],
			target: `${control}_${name}`,
			...spaceMixes(mix),
		});
		return { bone: `${control}_${name}`, constraint };
	};
	for (const s of ['l', 'r'] as const) {
		const arm: TemplateIk3d = {
			name: `arm_ik_${s}`,
			bones: [`upper_arm_${s}`, `lower_arm_${s}`],
			end: `hand_${s}`,
			target: `hand_ik_${s}`,
			pole: `elbow_pole_${s}`,
		};
		ik.push(arm);
		limbs[`arm_${s}`] = {
			ik: arm.name,
			ik3d: true,
			fk: [...arm.bones],
			control: arm.target,
			pole: arm.pole,
			spaces: { chest: space(arm.target, 'chest', 1), world: space(arm.target, 'world', 0) },
		};
	}
	if (legs)
		for (const s of ['l', 'r'] as const) {
			const leg: TemplateIk3d = {
				name: `leg_ik_${s}`,
				bones: [`thigh_${s}`, `shin_${s}`],
				end: `foot_${s}`,
				target: `foot_ik_${s}`,
				pole: `knee_pole_${s}`,
			};
			ik.push(leg);
			limbs[`leg_${s}`] = {
				ik: leg.name,
				ik3d: true,
				fk: [...leg.bones],
				control: leg.target,
				pole: leg.pole,
				spaces: { world: space(leg.target, 'world', 1) },
			};
		}
	return { ik, constraints: { transform }, limbs };
}

/**
 * `controls` with the built-in's limbs (`builtinIk`): the Body IK layer shown, and a picker switch per
 * limb at `at` (the right one at 1 − x).
 */
export function withLimbs(
	controls: RigTemplateControls,
	limbs: Record<string, ControlLimb>,
	at: Record<string, [number, number]>,
): RigTemplateControls {
	const items = [...(controls.picker?.items ?? [])];
	for (const l of Object.keys(limbs)) {
		const [x, y] = at[l.replace(/_[lr]$/, '')];
		const right = l.endsWith('_r');
		items.push({
			limb: l,
			at: [right ? Math.round((1 - x) * 1e4) / 1e4 : x, y],
			label: `${l.startsWith('arm') ? 'arm' : 'leg'} ${right ? 'R' : 'L'}`,
		});
	}
	return {
		...controls,
		layers: controls.layers?.map((l) => (l.name === IK ? { name: IK } : l)),
		limbs,
		picker: { ...controls.picker, items },
	};
}

/** Both sides of a picker button, the right one at 1 − x. */
export const pickerPair = (
	bone: string,
	x: number,
	y: number,
	label: string,
): ControlPlan['picker'] => [
	[`${bone}_l`, x, y, `${label} L`],
	[`${bone}_r`, Math.round((1 - x) * 1e4) / 1e4, y, `${label} R`],
];

// ── The face board (rig-controls §6.1): a channel's `ui` ───────────────────────────────────────

/** A face-board row: sliders by channel id, or a 2D box `[x channel, y channel, box name]`. */
export type BoardRow = (string | [string, string, string])[];

const SLIDER_H = 30;
const BOX_H = 92;
const BOARD_PAD = 8;

/**
 * `channels` with the face board's `ui` laid out from `rows`, top to bottom: each row's items spread
 * across the board, a box row taller. Places are in 0…1 of a board as tall as the rows need; the
 * Rigger sizes the board to keep them apart.
 */
export function withFaceBoard(
	channels: RigTemplateChannel[],
	rows: readonly BoardRow[],
): RigTemplateChannel[] {
	const ui = new Map<string, RigTemplateUi>();
	const heights = rows.map((r) => (r.some((it) => Array.isArray(it)) ? BOX_H : SLIDER_H));
	const H = heights.reduce((a, b) => a + b, 2 * BOARD_PAD);
	let top = BOARD_PAD;
	const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
	rows.forEach((row, i) => {
		const y = r4((top + heights[i] / 2) / H);
		row.forEach((it, j) => {
			const at: [number, number] = [r4((j + 0.5) / row.length), y];
			if (Array.isArray(it)) {
				ui.set(it[0], { box: it[2], axis: 'x', at });
				ui.set(it[1], { box: it[2], axis: 'y' });
			} else ui.set(it, { at });
		});
		top += heights[i];
	});
	for (const id of ui.keys())
		if (!channels.some((c) => c.id === id)) throw new Error(`face board: no channel "${id}"`);
	return channels.map((c) => (ui.has(c.id) ? { ...c, ui: ui.get(c.id) } : c));
}

/** The face block's board: brows, eyes, the gaze and head boxes, cheeks, mouth, jaw. */
export const FACE_BOARD: readonly BoardRow[] = [
	['brow_out_l', 'brow_out_r'],
	['brow_l', 'brow_r'],
	['brow_in_l', 'brow_in_r'],
	['blink_l', 'blink_r'],
	['squint_l', 'squint_r'],
	[
		['gaze_x', 'gaze_y', 'gaze'],
		['head_turn', 'head_pitch', 'head'],
	],
	['cheek_l', 'cheek_r'],
	['puff', 'sneer'],
	['smile_l', 'smile_r'],
	['stretch_l', 'stretch_r'],
	['lip_upper', 'lip_lower'],
	['jaw', 'jaw_side'],
	['head_tilt', 'head_nod'],
];
