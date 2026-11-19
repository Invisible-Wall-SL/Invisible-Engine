import { IRIG_VERSION } from 'engine-rig';
import {
	FACE_BLENDSHAPES,
	FACE_LANDMARK_COUNT,
	POSE_LANDMARK_COUNT,
	boneRestDirection,
	worldTurnPer,
	type LandmarkRef,
	type RigMotionMap,
} from '../rigMotion';
import { HAND_LANDMARK_COUNT, type HandMotionEntry } from '../rigMotionHand';

/**
 * Rig templates (docs/design/rig-templates.md): a fixed skeleton plus the named images it expects,
 * so art made to the names attaches itself and clips play on every character of a template.
 */

export interface RigTemplateBone {
	name: string;
	parent?: string;
	x: number;
	y: number;
	/** Setup values a template saved from a rig carries (the built-ins use x and y only). */
	rotation?: number;
	length?: number;
	scaleX?: number;
	scaleY?: number;
}

export interface RigTemplateSlot {
	name: string;
	bone: string;
	/** The part shown in the setup pose; none = the slot starts empty (an eyelid, open). */
	setup?: string;
	blend?: 'normal' | 'additive' | 'multiply' | 'screen';
	/** `rrggbbaa`, as the rig format writes it. */
	color?: string;
}

/** Where a part sits on its bone; none = centred on the bone, unturned. */
export interface RigTemplatePlacement {
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
}

export interface RigTemplatePart {
	name: string;
	slot: string;
	required: boolean;
	/** Placeholder size, used only until art is attached. */
	size: [number, number];
	at?: RigTemplatePlacement;
}

/** A channel moving a bone: the key is `value × per` from setup (scaleY: `1 + value × per`). */
export interface RigTemplateDrive {
	bone: string;
	prop: 'x' | 'y' | 'rotate' | 'scaleY';
	per: number;
}

/** From `at` upward the slot shows `part` (none = empty); a part the rig lacks is skipped. */
export interface RigTemplateSwap {
	at: number;
	part: string | null;
}

/** Another channel a channel sets: keyed at `value × per` (one slider curling every finger). */
export interface RigTemplateSet {
	channel: string;
	per: number;
}

/**
 * A slot a swap channel empties while the image it shows is not its first step's, and shows `part`
 * on that step: a whole drawn hand pose hides the finger images it replaces.
 */
export interface RigTemplateHide {
	slot: string;
	part: string;
}

/**
 * A face control (docs/design/rig-templates.md §4): one number the artist sets, written as the
 * ordinary keys of its drives and swaps. A `shapes` channel picks one of a slot's parts instead and
 * opens the jaw channel by that shape's amount.
 */
export interface RigTemplateChannel {
	id: string;
	label: string;
	tip: string;
	min: number;
	max: number;
	rest: number;
	drives?: RigTemplateDrive[];
	slot?: string;
	swaps?: RigTemplateSwap[];
	/** Needs `swaps`. */
	hides?: RigTemplateHide[];
	/** Keys only other channels: it has no drives, swaps or shapes of its own. */
	sets?: RigTemplateSet[];
	/**
	 * `open`: how far each shape opens the jaw; `talk`: the order the talk helper cycles;
	 * `lipsync`: the part each lip-sync shape letter (A–H, X) becomes (§5.2).
	 */
	shapes?: {
		slot: string;
		jaw: string;
		rest: string;
		open: Record<string, number>;
		talk: string[];
		lipsync?: Record<string, string>;
	};
}

export interface RigTemplate {
	id: string;
	version: number;
	label: string;
	bones: RigTemplateBone[];
	/** Draw order, back to front. */
	slots: RigTemplateSlot[];
	parts: RigTemplatePart[];
	channels: RigTemplateChannel[];
	clips: RigTemplateClip[];
	/** Which tracked face / body points drive which channels (T5 / T7b, §5.3). */
	motion?: RigMotionMap;
}

/** One channel key of a starter clip: time, channel id, value (a part name for a shapes channel). */
export type RigTemplateClipKey = [number, string, number | string];

/**
 * A starter animation. A built-in's is face-channel keys: the Rigger writes it through the same
 * channel code the Controls section uses, so it plays on every rig of the template, and every channel
 * it touches starts and ends at rest. A template saved from a rig keeps the rig's own animation as
 * timelines instead (`animation`, `keys` empty; docs/design/rig-templates.md §7.4).
 */
export interface RigTemplateClip {
	name: string;
	length: number;
	keys: RigTemplateClipKey[];
	animation?: RigTemplateTimelines;
}

/** An irig animation limited to what a template rig can play (§7.4). */
export interface RigTemplateTimelines {
	bones?: Record<string, Record<string, { time?: number }[]>>;
	slots?: Record<string, Record<string, { time?: number; name?: string | null }[]>>;
	drawOrder?: { time?: number; offsets?: { slot: string; offset: number }[] }[];
}

/** The bone and slot timelines a template clip may hold; others name what a template lacks. */
export const TEMPLATE_BONE_TIMELINES = [
	'rotate',
	'translate',
	'translatex',
	'translatey',
	'scale',
	'scalex',
	'scaley',
	'shear',
	'shearx',
	'sheary',
] as const;
export const TEMPLATE_SLOT_TIMELINES = [
	'attachment',
	'rgba',
	'rgb',
	'alpha',
	'rgba2',
	'rgb2',
] as const;

/** What a rig created from a template remembers, in its bundle's `template.json`. */
export interface RigTemplateRef {
	id: string;
	version: number;
}

export const RIG_TEMPLATE_SIDECAR = 'template.json';

const part = (
	name: string,
	slot: string,
	size: [number, number],
	required = false,
): RigTemplatePart => ({ name, slot, required, size });

const sides = <T>(f: (s: 'l' | 'r', sign: number) => T[]): T[] => [...f('l', -1), ...f('r', 1)];

const MOUTH_SHAPES = ['A', 'E', 'O', 'U', 'MBP', 'FV', 'smile', 'wide'];

/**
 * The mouth shapes Rhubarb Lip Sync answers with (docs/design/rig-templates.md §5.2): A closed
 * (M B P), B clenched teeth (most consonants, EE), C open (EH AE), D wide open (AA), E rounded
 * (AO ER), F puckered (UW OW W), G teeth on lip (F V), H tongue up (L), X at rest.
 */
export const LIPSYNC_SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'] as const;

export const BUST_FACE: RigTemplate = {
	id: 'bust-face',
	version: 1,
	label: 'Bust with face',
	bones: [
		{ name: 'root', x: 0, y: 0 },
		{ name: 'chest', parent: 'root', x: 0, y: 120 },
		...sides((s, k) => [{ name: `shoulder_${s}`, parent: 'chest', x: 110 * k, y: 40 }]),
		{ name: 'neck', parent: 'chest', x: 0, y: 110 },
		{ name: 'head', parent: 'neck', x: 0, y: 40 },
		{ name: 'hair_back', parent: 'head', x: 0, y: 120 },
		{ name: 'face', parent: 'head', x: 0, y: 90 },
		...sides((s, k) => [
			{ name: `brow_${s}`, parent: 'face', x: 45 * k, y: 55 },
			{ name: `eye_${s}`, parent: 'face', x: 45 * k, y: 20 },
			{ name: `pupil_${s}`, parent: `eye_${s}`, x: 0, y: 0 },
		]),
		{ name: 'nose', parent: 'face', x: 0, y: -10 },
		{ name: 'jaw', parent: 'face', x: 0, y: -50 },
		{ name: 'hair_front', parent: 'head', x: 0, y: 150 },
	],
	slots: [
		{ name: 'hair_back', bone: 'hair_back', setup: 'hair_back' },
		{ name: 'body', bone: 'chest', setup: 'body' },
		{ name: 'neck', bone: 'neck', setup: 'neck' },
		{ name: 'head', bone: 'head', setup: 'head' },
		...sides((s) => [{ name: `ear_${s}`, bone: 'head', setup: `ear_${s}` }]),
		...sides((s) => [{ name: `eye_white_${s}`, bone: `eye_${s}`, setup: `eye_white_${s}` }]),
		...sides((s) => [{ name: `pupil_${s}`, bone: `pupil_${s}`, setup: `pupil_${s}` }]),
		...sides((s) => [{ name: `eyelid_${s}`, bone: `eye_${s}` }]),
		...sides((s) => [{ name: `brow_${s}`, bone: `brow_${s}`, setup: `brow_${s}_neutral` }]),
		{ name: 'nose', bone: 'nose', setup: 'nose' },
		{ name: 'mouth', bone: 'jaw', setup: 'mouth_rest' },
		{ name: 'hair_front', bone: 'hair_front', setup: 'hair_front' },
	],
	parts: [
		part('hair_back', 'hair_back', [300, 300]),
		part('body', 'body', [420, 240], true),
		part('neck', 'neck', [90, 90]),
		part('head', 'head', [260, 300], true),
		...sides((s) => [part(`ear_${s}`, `ear_${s}`, [50, 80])]),
		...sides((s) => [part(`eye_white_${s}`, `eye_white_${s}`, [60, 40])]),
		...sides((s) => [part(`pupil_${s}`, `pupil_${s}`, [24, 24])]),
		...sides((s) => [
			part(`eyelid_${s}_half`, `eyelid_${s}`, [62, 42]),
			part(`eyelid_${s}_closed`, `eyelid_${s}`, [62, 42], true),
		]),
		...sides((s) => [
			part(`brow_${s}_neutral`, `brow_${s}`, [70, 20], true),
			part(`brow_${s}_up`, `brow_${s}`, [70, 20]),
			part(`brow_${s}_angry`, `brow_${s}`, [70, 20]),
		]),
		part('nose', 'nose', [40, 50]),
		part('mouth_rest', 'mouth', [90, 40], true),
		...MOUTH_SHAPES.map((m) => part(`mouth_${m}`, 'mouth', [90, 60], m === 'A' || m === 'O')),
		part('hair_front', 'hair_front', [300, 200]),
	],
	channels: [
		{
			id: 'mouth',
			label: 'Mouth',
			tip: 'Swap the mouth shape; the jaw opens to match it.',
			min: 0,
			max: 1,
			rest: 0,
			shapes: {
				slot: 'mouth',
				jaw: 'jaw',
				rest: 'mouth_rest',
				talk: ['A', 'E', 'O', 'MBP', 'U', 'A', 'FV', 'E', 'wide', 'O', 'MBP', 'A'].map(
					(m) => `mouth_${m}`,
				),
				open: {
					mouth_rest: 0,
					mouth_A: 1,
					mouth_E: 0.5,
					mouth_O: 0.9,
					mouth_U: 0.5,
					mouth_MBP: 0,
					mouth_FV: 0.3,
					mouth_smile: 0.2,
					mouth_wide: 0.6,
				},
				// Rhubarb's own Preston Blair mapping; B (clenched teeth) and H (L) have no image of
				// their own in this set, so they take E, the nearest in jaw opening.
				lipsync: {
					A: 'mouth_MBP',
					B: 'mouth_E',
					C: 'mouth_E',
					D: 'mouth_A',
					E: 'mouth_O',
					F: 'mouth_U',
					G: 'mouth_FV',
					H: 'mouth_E',
					X: 'mouth_rest',
				},
			},
		},
		{
			id: 'jaw',
			label: 'Jaw open',
			tip: 'Drop the jaw (and the mouth on it).',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'jaw', prop: 'y', per: -14 }],
		},
		...sides<RigTemplateChannel>((s) => [
			{
				id: `blink_${s}`,
				label: `Blink ${s === 'l' ? 'left' : 'right'}`,
				tip: '0 open, ½ half-closed, 1 closed (needs the eyelid images).',
				min: 0,
				max: 1,
				rest: 0,
				slot: `eyelid_${s}`,
				swaps: [
					{ at: 0, part: null },
					{ at: 0.34, part: `eyelid_${s}_half` },
					{ at: 0.67, part: `eyelid_${s}_closed` },
				],
			},
		]),
		...sides<RigTemplateChannel>((s) => [
			{
				id: `brow_${s}`,
				label: `Brow ${s === 'l' ? 'left' : 'right'}`,
				tip: 'Down to angry, up to raised; swaps the brow image at the ends.',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `brow_${s}`, prop: 'y', per: 8 }],
				slot: `brow_${s}`,
				swaps: [
					{ at: -1, part: `brow_${s}_angry` },
					{ at: -0.6, part: `brow_${s}_neutral` },
					{ at: 0.6, part: `brow_${s}_up` },
				],
			},
		]),
		{
			id: 'gaze_x',
			label: 'Look left / right',
			tip: 'Move both pupils sideways.',
			min: -1,
			max: 1,
			rest: 0,
			drives: sides<RigTemplateDrive>((s) => [{ bone: `pupil_${s}`, prop: 'x', per: 10 }]),
		},
		{
			id: 'gaze_y',
			label: 'Look down / up',
			tip: 'Move both pupils up or down.',
			min: -1,
			max: 1,
			rest: 0,
			drives: sides<RigTemplateDrive>((s) => [{ bone: `pupil_${s}`, prop: 'y', per: 6 }]),
		},
		{
			id: 'head_tilt',
			label: 'Head tilt',
			tip: 'Degrees; positive tilts counter-clockwise.',
			min: -15,
			max: 15,
			rest: 0,
			drives: [{ bone: 'head', prop: 'rotate', per: 1 }],
		},
		{
			id: 'head_nod',
			label: 'Head nod',
			tip: 'Degrees, turned at the neck.',
			min: -10,
			max: 10,
			rest: 0,
			drives: [{ bone: 'neck', prop: 'rotate', per: 1 }],
		},
		{
			id: 'head_turn',
			label: 'Head turn',
			tip: 'Slide the face inside the head for a small turn; reads best once the head is a mesh.',
			min: -1,
			max: 1,
			rest: 0,
			drives: [{ bone: 'face', prop: 'x', per: 14 }],
		},
		{
			id: 'breath',
			label: 'Breath',
			tip: 'Swell the chest a little.',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'chest', prop: 'scaleY', per: 0.03 }],
		},
	],
	clips: [],
	// MediaPipe names blendshapes and points from the PERFORMER's side; the template's `_l` is the
	// left of the picture, which is the performer's right in an unmirrored video.
	motion: {
		face: {
			smooth: 0.03,
			entries: [
				{
					kind: 'shape',
					channel: 'mouth',
					hold: 0.08,
					features: {
						open: ['jawOpen'],
						round: ['mouthFunnel', 'mouthPucker'],
						smile: ['mouthSmileLeft', 'mouthSmileRight'],
						wide: ['mouthStretchLeft', 'mouthStretchRight'],
						press: ['mouthPressLeft', 'mouthPressRight', 'mouthClose'],
						roll: ['mouthRollLower'],
					},
					shapes: {
						mouth_rest: {},
						mouth_A: { open: 0.6 },
						mouth_E: { open: 0.25, wide: 0.3 },
						mouth_O: { open: 0.35, round: 0.5 },
						mouth_U: { round: 0.6 },
						mouth_MBP: { press: 0.4 },
						mouth_FV: { roll: 0.5 },
						mouth_smile: { smile: 0.6 },
						mouth_wide: { open: 0.4, smile: 0.5 },
					},
				},
				{ kind: 'blend', channel: 'jaw', plus: ['jawOpen'], gain: 1.4 },
				{ kind: 'blend', channel: 'blink_l', plus: ['eyeBlinkRight'], gain: 1.2 },
				{ kind: 'blend', channel: 'blink_r', plus: ['eyeBlinkLeft'], gain: 1.2 },
				...sides<FaceMotionEntryOf>((s) => {
					const side = s === 'l' ? 'Right' : 'Left';
					return [
						{
							kind: 'blend',
							channel: `brow_${s}`,
							plus: [`browOuterUp${side}`, 'browInnerUp'],
							minus: [`browDown${side}`],
							gain: 1.6,
							rest: 'median',
						},
					];
				}),
				{
					kind: 'blend',
					channel: 'gaze_x',
					plus: ['eyeLookOutLeft', 'eyeLookInRight'],
					minus: ['eyeLookInLeft', 'eyeLookOutRight'],
					gain: 1.5,
				},
				{
					kind: 'blend',
					channel: 'gaze_y',
					plus: ['eyeLookUpLeft', 'eyeLookUpRight'],
					minus: ['eyeLookDownLeft', 'eyeLookDownRight'],
					gain: 1.5,
				},
				// The outer eye corners (33 = the performer's right, 263 = left) and the nose tip (1).
				{ kind: 'angle', channel: 'head_tilt', from: 33, to: 263, gain: 1, rest: 'level' },
				{ kind: 'offset', channel: 'head_turn', point: 1, between: [33, 263], axis: 'x', gain: 3 },
			],
		},
		cannot: [
			'Nods (up and down): the template turns the head in the picture, not toward the camera.',
			'Turns wider than the face slide inside the head; a ¾ view needs its own drawing.',
			'Breathing, and anything the face does not show (shoulders, body).',
		],
	},
};

type FaceMotionEntryOf = NonNullable<RigMotionMap['face']>['entries'][number];

/** The same value on both sides' channel (`brow` → `brow_l`, `brow_r`). */
const both = (t: number, ch: string, v: number | string): RigTemplateClipKey[] => [
	[t, `${ch}_l`, v],
	[t, `${ch}_r`, v],
];
const blinkAt = (t: number): RigTemplateClipKey[] =>
	(
		[
			[0, 0],
			[0.04, 0.5],
			[0.08, 1],
			[0.14, 0.5],
			[0.2, 0],
		] as const
	).flatMap(([dt, v]) => both(Math.round((t + dt) * 1000) / 1000, 'blink', v));
const TALK_STEP = 0.12;

/**
 * A clip whose every channel starts at rest at 0 and ends at rest at `length` (the rest shape for
 * a shapes channel), unless its own keys already say what happens there.
 */
function clip(
	t: RigTemplate,
	name: string,
	length: number,
	keys: RigTemplateClipKey[],
): RigTemplateClip {
	const restOf = (id: string): number | string => {
		const c = t.channels.find((x) => x.id === id);
		return c?.shapes ? c.shapes.rest : (c?.rest ?? 0);
	};
	const used = [...new Set(keys.map((k) => k[1]))];
	const at = (time: number, id: string) =>
		keys.some((k) => k[1] === id && Math.abs(k[0] - time) < 1e-6);
	const ends: RigTemplateClipKey[] = used.flatMap((id) => [
		...(at(0, id) ? [] : [[0, id, restOf(id)] as RigTemplateClipKey]),
		...(at(length, id) ? [] : [[length, id, restOf(id)] as RigTemplateClipKey]),
	]);
	return { name, length, keys: [...keys, ...ends].sort((a, b) => a[0] - b[0]) };
}

function talkKeys(t: RigTemplate, from: number, secs: number): RigTemplateClipKey[] {
	const order = t.channels.find((c) => c.shapes)?.shapes?.talk ?? [];
	const out: RigTemplateClipKey[] = [];
	for (let i = 0; (i + 1) * TALK_STEP <= secs + 1e-9; i++)
		out.push([Math.round((from + i * TALK_STEP) * 1000) / 1000, 'mouth', order[i % order.length]]);
	return out;
}

BUST_FACE.clips = [
	clip(BUST_FACE, 'idle', 4, [
		[2, 'breath', 1],
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
		[1.5, 'gaze_x', 0.3],
		[1.9, 'gaze_x', 0.3],
		[2.3, 'gaze_x', 0],
		...blinkAt(0.9),
		...blinkAt(3),
	]),
	clip(BUST_FACE, 'blink', 0.2, blinkAt(0)),
	clip(BUST_FACE, 'talk', 2, [
		...talkKeys(BUST_FACE, TALK_STEP, 2 - TALK_STEP),
		[0.5, 'head_nod', 1.5],
		[1, 'head_nod', 0],
		[1.5, 'head_nod', 1],
	]),
	clip(BUST_FACE, 'happy', 1.2, [
		[0.1, 'mouth', 'mouth_smile'],
		[1, 'mouth', 'mouth_smile'],
		...both(0.15, 'brow', 0.7),
		...both(0.9, 'brow', 0.7),
		...both(0.15, 'blink', 0.4),
		...both(0.9, 'blink', 0.4),
		[0.3, 'head_tilt', 4],
		[0.9, 'head_tilt', 3],
	]),
	clip(BUST_FACE, 'surprised', 1, [
		[0.08, 'mouth', 'mouth_O'],
		[0.8, 'mouth', 'mouth_O'],
		...both(0.08, 'brow', 1),
		...both(0.8, 'brow', 1),
		[0.08, 'gaze_y', 0.4],
		[0.8, 'gaze_y', 0.4],
		[0.1, 'head_nod', -3],
		[0.8, 'head_nod', -2],
	]),
	clip(BUST_FACE, 'win_small', 1.5, [
		[0.1, 'mouth', 'mouth_smile'],
		[1.3, 'mouth', 'mouth_smile'],
		...both(0.15, 'brow', 0.6),
		...both(1.2, 'brow', 0.6),
		[0.2, 'head_nod', -4],
		[0.4, 'head_nod', 2],
		[0.6, 'head_nod', -3],
		[0.8, 'head_nod', 0],
		[0.3, 'breath', 1],
		[1.2, 'breath', 0.3],
	]),
	clip(BUST_FACE, 'win_big', 2.5, [
		[0.1, 'mouth', 'mouth_wide'],
		[0.6, 'mouth', 'mouth_A'],
		[1.1, 'mouth', 'mouth_wide'],
		[1.8, 'mouth', 'mouth_smile'],
		[2.3, 'mouth', 'mouth_smile'],
		...both(0.1, 'brow', 1),
		...both(2.2, 'brow', 1),
		[0.3, 'head_tilt', 5],
		[0.7, 'head_tilt', -5],
		[1.1, 'head_tilt', 5],
		[1.5, 'head_tilt', -3],
		[2, 'head_tilt', 0],
		[0.2, 'head_nod', -4],
		[0.5, 'head_nod', 2],
		[0.8, 'head_nod', -4],
		[1.1, 'head_nod', 2],
		[0.3, 'breath', 1],
		[2, 'breath', 1],
		...blinkAt(1.9),
	]),
];

const SIDE = { l: 'left', r: 'right' } as const;
const HAND_POSES = ['open', 'fist', 'point'];

/**
 * A whole standing character, drawn facing the viewer or facing right (the game flips it). Every
 * channel is a forward (FK) rotation or move: an IK constraint would override the rotation keys the
 * channels write, so the legs carry none; a planted-foot crouch waits for body tracking (T7b).
 */
export const FULL_BODY: RigTemplate = {
	id: 'full-body',
	version: 1,
	label: 'Full body',
	bones: [
		{ name: 'root', x: 0, y: 0 },
		{ name: 'hip', parent: 'root', x: 0, y: 290 },
		{ name: 'spine', parent: 'hip', x: 0, y: 30 },
		{ name: 'chest', parent: 'spine', x: 0, y: 90 },
		{ name: 'neck', parent: 'chest', x: 0, y: 90 },
		{ name: 'head', parent: 'neck', x: 0, y: 30 },
		...sides((s, k) => [
			{ name: `upper_arm_${s}`, parent: 'chest', x: 70 * k, y: 70 },
			{ name: `lower_arm_${s}`, parent: `upper_arm_${s}`, x: 0, y: -95 },
			{ name: `hand_${s}`, parent: `lower_arm_${s}`, x: 0, y: -85 },
		]),
		...sides((s, k) => [
			{ name: `thigh_${s}`, parent: 'hip', x: 35 * k, y: -10 },
			{ name: `shin_${s}`, parent: `thigh_${s}`, x: 0, y: -130 },
			{ name: `foot_${s}`, parent: `shin_${s}`, x: 0, y: -130 },
		]),
	],
	slots: [
		...sides((s) => [
			{ name: `thigh_${s}`, bone: `thigh_${s}`, setup: `thigh_${s}` },
			{ name: `shin_${s}`, bone: `shin_${s}`, setup: `shin_${s}` },
			{ name: `foot_${s}`, bone: `foot_${s}`, setup: `foot_${s}` },
		]),
		{ name: 'pelvis', bone: 'hip', setup: 'pelvis' },
		{ name: 'torso', bone: 'chest', setup: 'torso' },
		{ name: 'neck', bone: 'neck', setup: 'neck' },
		{ name: 'head', bone: 'head', setup: 'head' },
		...sides((s) => [
			{ name: `upper_arm_${s}`, bone: `upper_arm_${s}`, setup: `upper_arm_${s}` },
			{ name: `lower_arm_${s}`, bone: `lower_arm_${s}`, setup: `lower_arm_${s}` },
			{ name: `hand_${s}`, bone: `hand_${s}`, setup: `hand_${s}_open` },
		]),
	],
	parts: [
		...sides((s) => [
			part(`thigh_${s}`, `thigh_${s}`, [70, 150], true),
			part(`shin_${s}`, `shin_${s}`, [60, 150], true),
			part(`foot_${s}`, `foot_${s}`, [90, 40], true),
		]),
		part('pelvis', 'pelvis', [150, 80]),
		part('torso', 'torso', [200, 240], true),
		part('neck', 'neck', [60, 50]),
		part('head', 'head', [180, 200], true),
		...sides((s) => [
			part(`upper_arm_${s}`, `upper_arm_${s}`, [50, 110], true),
			part(`lower_arm_${s}`, `lower_arm_${s}`, [45, 100], true),
			...HAND_POSES.map((h) => part(`hand_${s}_${h}`, `hand_${s}`, [55, 60], h === 'open')),
		]),
	],
	channels: [
		{
			id: 'lean',
			label: 'Lean',
			tip: 'Degrees; bend the body at the spine (the chest follows a little further). Negative leans right.',
			min: -15,
			max: 15,
			rest: 0,
			drives: [
				{ bone: 'spine', prop: 'rotate', per: 1 },
				{ bone: 'chest', prop: 'rotate', per: 0.5 },
			],
		},
		{
			id: 'hop',
			label: 'Hop',
			tip: 'Lift the whole character off the ground.',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'root', prop: 'y', per: 80 }],
		},
		{
			id: 'move',
			label: 'Move sideways',
			tip: 'Slide the whole character left (−) or right (+); 1 = 100 rig units.',
			min: -3,
			max: 3,
			rest: 0,
			drives: [{ bone: 'root', prop: 'x', per: 100 }],
		},
		...sides<RigTemplateChannel>((s, k) => [
			{
				id: `arm_${s}`,
				label: `Raise ${SIDE[s]} arm`,
				tip: '0 hangs down, 1 points up and out; below 0 swings it the other way.',
				min: -0.3,
				max: 1,
				rest: 0,
				drives: [{ bone: `upper_arm_${s}`, prop: 'rotate', per: 150 * k }],
			},
			{
				id: `elbow_${s}`,
				label: `Bend ${SIDE[s]} elbow`,
				tip: 'Fold the forearm; with the arm raised to the side it lifts the hand (a flex).',
				min: 0,
				max: 1,
				rest: 0,
				drives: [{ bone: `lower_arm_${s}`, prop: 'rotate', per: 120 * k }],
			},
			{
				id: `hand_${s}`,
				label: `${SIDE[s] === 'left' ? 'Left' : 'Right'} hand`,
				tip: '0 open, ½ fist, 1 pointing (needs those images).',
				min: 0,
				max: 1,
				rest: 0,
				slot: `hand_${s}`,
				swaps: [
					{ at: 0, part: `hand_${s}_open` },
					{ at: 0.34, part: `hand_${s}_fist` },
					{ at: 0.67, part: `hand_${s}_point` },
				],
			},
		]),
		...sides<RigTemplateChannel>((s) => [
			{
				id: `step_${s}`,
				label: `Step ${SIDE[s]} leg`,
				tip: 'Swing the leg at the hip: forward (+) or back (−) for a character facing right.',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `thigh_${s}`, prop: 'rotate', per: 25 }],
			},
			{
				id: `knee_${s}`,
				label: `Bend ${SIDE[s]} knee`,
				tip: 'Fold the lower leg back (facing right).',
				min: 0,
				max: 1,
				rest: 0,
				drives: [{ bone: `shin_${s}`, prop: 'rotate', per: -60 }],
			},
		]),
		{
			id: 'head_tilt',
			label: 'Head tilt',
			tip: 'Degrees; positive tilts counter-clockwise.',
			min: -15,
			max: 15,
			rest: 0,
			drives: [{ bone: 'head', prop: 'rotate', per: 1 }],
		},
		{
			id: 'head_nod',
			label: 'Head nod',
			tip: 'Degrees, turned at the neck.',
			min: -10,
			max: 10,
			rest: 0,
			drives: [{ bone: 'neck', prop: 'rotate', per: 1 }],
		},
		{
			id: 'breath',
			label: 'Breath',
			tip: 'Swell the chest a little.',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'chest', prop: 'scaleY', per: 0.03 }],
		},
	],
	clips: [],
	motion: {
		body: {
			smooth: 0.05,
			minVisibility: 0.5,
			scale: { from: [23, 24], to: [11, 12], rig: 190 },
			entries: [
				{ kind: 'bone', channel: 'lean', bone: 'chest', from: [23, 24], to: [11, 12] },
				{
					kind: 'bone',
					channel: 'head_tilt',
					bone: 'head',
					from: 8,
					to: 7,
					rest: [1, 0],
					minSpan: 0.12,
				},
				...sides<BodyMotionEntryOf>((s) => {
					const [sh, el, wr, hip, kn, an] =
						s === 'l' ? [12, 14, 16, 24, 26, 28] : [11, 13, 15, 23, 25, 27];
					return [
						{ kind: 'bone', channel: `arm_${s}`, bone: `upper_arm_${s}`, from: sh, to: el },
						{ kind: 'bone', channel: `elbow_${s}`, bone: `lower_arm_${s}`, from: el, to: wr },
						{ kind: 'bone', channel: `step_${s}`, bone: `thigh_${s}`, from: hip, to: kn },
						{ kind: 'bone', channel: `knee_${s}`, bone: `shin_${s}`, from: kn, to: an },
					];
				}),
				{ kind: 'root', channel: 'hop', point: [23, 24], axis: 'y' },
				{ kind: 'root', channel: 'move', point: [23, 24], axis: 'x' },
			],
		},
		cannot: [
			'Depth: a limb pointing at or away from the camera reads as short, not as turned.',
			'Turning toward or away from the camera, or walking into the picture.',
			'A knee bending forward, or a crouch with the feet planted (the template has no IK).',
			'Hand poses, head nods and breathing.',
		],
	},
};

type BodyMotionEntryOf = NonNullable<RigMotionMap['body']>['entries'][number];

FULL_BODY.clips = [
	clip(FULL_BODY, 'idle', 4, [
		[2, 'breath', 1],
		[2, 'lean', 1.5],
		...both(2, 'arm', 0.04),
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
	]),
	clip(FULL_BODY, 'celebrate', 2, [
		...both(0.3, 'arm', 0.9),
		...both(1.6, 'arm', 0.9),
		...both(0.2, 'hand', 0.5),
		...both(1.7, 'hand', 0.5),
		[0.2, 'hop', 0],
		[0.45, 'hop', 1],
		[0.7, 'hop', 0],
		[0.95, 'hop', 0.6],
		[1.2, 'hop', 0],
		[0.45, 'head_nod', -4],
		[1.2, 'head_nod', 0],
		[0.3, 'breath', 1],
		[1.6, 'breath', 1],
	]),
	clip(FULL_BODY, 'win_small', 1.5, [
		[0.15, 'hand_r', 0.5],
		[1.2, 'hand_r', 0.5],
		[0.25, 'arm_r', 0.6],
		[0.5, 'arm_r', 0.7],
		[0.75, 'arm_r', 0.6],
		[1.1, 'arm_r', 0.6],
		[0.25, 'elbow_r', 0.8],
		[1.1, 'elbow_r', 0.8],
		[0.3, 'lean', -3],
		[1.1, 'lean', -3],
		[0.3, 'head_nod', -3],
		[0.6, 'head_nod', 1],
		[0.9, 'head_nod', -2],
	]),
	clip(FULL_BODY, 'win_big', 3, [
		...both(0.3, 'arm', 1),
		...both(1.6, 'arm', 1),
		...both(0.2, 'hand', 0.5),
		...both(1.6, 'hand', 0.5),
		[0.2, 'hop', 0],
		[0.45, 'hop', 1],
		[0.7, 'hop', 0],
		[0.95, 'hop', 1],
		[1.2, 'hop', 0],
		[0.5, 'lean', 6],
		[1, 'lean', -6],
		[1.5, 'lean', 4],
		[2, 'lean', 0],
		[1.9, 'arm_r', 0.5],
		[2.7, 'arm_r', 0.5],
		[1.9, 'hand_r', 1],
		[2.7, 'hand_r', 1],
		[0.45, 'head_nod', -5],
		[1.2, 'head_nod', 2],
		[2.1, 'head_tilt', 5],
		[2.7, 'head_tilt', 5],
		[0.3, 'breath', 1],
		[2.5, 'breath', 1],
	]),
	clip(FULL_BODY, 'walk', 1, [
		[0.25, 'step_l', 1],
		[0.5, 'step_l', 0],
		[0.75, 'step_l', -1],
		[0.25, 'step_r', -1],
		[0.5, 'step_r', 0],
		[0.75, 'step_r', 1],
		[0.25, 'knee_r', 0.5],
		[0.5, 'knee_r', 0],
		[0.5, 'knee_l', 0],
		[0.75, 'knee_l', 0.5],
		...both(0.25, 'arm', 0.15),
		...both(0.5, 'arm', 0),
		...both(0.75, 'arm', -0.15),
		[0.25, 'lean', -2],
		[0.75, 'lean', -2],
	]),
];

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const DIGITS = ['thumb', ...FINGERS] as const;
type Digit = (typeof DIGITS)[number];
const SEGMENTS = [1, 2, 3] as const;

/**
 * Each digit's knuckle on the hand bone and its three segments, the hand hanging with its back to
 * the viewer: x across the hand toward the thumb (mirrored per side), y up. The third segment only
 * sizes its image.
 */
const HAND: Record<Digit, { at: [number, number]; seg: [number, number][]; w: number }> = {
	thumb: {
		at: [30, -22],
		seg: [
			[10, -22],
			[6, -19],
			[4, -16],
		],
		w: 18,
	},
	index: {
		at: [26, -80],
		seg: [
			[0, -26],
			[0, -20],
			[0, -16],
		],
		w: 16,
	},
	middle: {
		at: [9, -82],
		seg: [
			[0, -29],
			[0, -22],
			[0, -17],
		],
		w: 17,
	},
	ring: {
		at: [-8, -80],
		seg: [
			[0, -27],
			[0, -20],
			[0, -16],
		],
		w: 16,
	},
	pinky: {
		at: [-24, -76],
		seg: [
			[-2, -21],
			[-1, -16],
			[0, -13],
		],
		w: 14,
	},
};
/** Each segment's fold when its finger curls: scale Y along the finger, read as bending toward the
 * viewer or away from them, which is how a hand facing the picture closes. */
const CURL_FOLD = [-0.7, -0.5, -0.4];
const HAND_POSE_IMAGES = ['open', 'fist', 'point', 'thumbs_up'];
const bone = (d: Digit, n: number, s: string) => `${d}_${n}_${s}`;
const segmentSlots = (s: string) =>
	(['pinky', 'ring', 'middle', 'index', 'thumb'] as const).flatMap((d) =>
		SEGMENTS.map((n) => bone(d, n, s)),
	);

/**
 * The upper body of a character beside the reels, drawn facing the viewer: torso, arms, and hands
 * with a bone and an image for every finger segment, so a hand can count, point, wave and close.
 * Each hand also takes whole drawn poses (open, fist, point, thumbs up) as image swaps, for a pose
 * the segments cannot draw; showing one hides that hand's segments. Forward kinematics only.
 *
 * The face seam: the head is one image for now. The shared face block (bust-face's) joins at
 * `head` — its bones parent to it and its slots follow it in draw order — and keeps head tilt, nod
 * and breath, which this template already owns, on the same bones.
 */
export const HALF_BODY: RigTemplate = {
	id: 'half-body',
	version: 1,
	label: 'Half body',
	bones: [
		{ name: 'root', x: 0, y: 0 },
		{ name: 'hip', parent: 'root', x: 0, y: 30 },
		{ name: 'spine', parent: 'hip', x: 0, y: 40 },
		{ name: 'chest', parent: 'spine', x: 0, y: 150 },
		{ name: 'neck', parent: 'chest', x: 0, y: 130 },
		{ name: 'head', parent: 'neck', x: 0, y: 40 },
		...sides((s, k) => [
			{ name: `clavicle_${s}`, parent: 'chest', x: 25 * k, y: 110 },
			{ name: `upper_arm_${s}`, parent: `clavicle_${s}`, x: 115 * k, y: 0 },
			{ name: `lower_arm_${s}`, parent: `upper_arm_${s}`, x: 0, y: -190 },
			{ name: `hand_${s}`, parent: `lower_arm_${s}`, x: 0, y: -170 },
			...DIGITS.flatMap((d) => {
				const h = HAND[d];
				return [
					{ name: bone(d, 1, s), parent: `hand_${s}`, x: -k * h.at[0], y: h.at[1] },
					{ name: bone(d, 2, s), parent: bone(d, 1, s), x: -k * h.seg[0][0], y: h.seg[0][1] },
					{ name: bone(d, 3, s), parent: bone(d, 2, s), x: -k * h.seg[1][0], y: h.seg[1][1] },
				];
			}),
		]),
	],
	slots: [
		{ name: 'pelvis', bone: 'hip', setup: 'pelvis' },
		{ name: 'torso', bone: 'chest', setup: 'torso' },
		{ name: 'neck', bone: 'neck', setup: 'neck' },
		{ name: 'head', bone: 'head', setup: 'head' },
		...sides((s) => [
			{ name: `shoulder_${s}`, bone: `clavicle_${s}`, setup: `shoulder_${s}` },
			{ name: `upper_arm_${s}`, bone: `upper_arm_${s}`, setup: `upper_arm_${s}` },
			{ name: `lower_arm_${s}`, bone: `lower_arm_${s}`, setup: `lower_arm_${s}` },
			{ name: `hand_${s}`, bone: `hand_${s}`, setup: `hand_${s}` },
			...segmentSlots(s).map((n) => ({ name: n, bone: n, setup: n })),
		]),
	],
	parts: [
		part('pelvis', 'pelvis', [300, 120]),
		part('torso', 'torso', [360, 380], true),
		part('neck', 'neck', [90, 90]),
		part('head', 'head', [260, 300], true),
		...sides((s) => [
			part(`shoulder_${s}`, `shoulder_${s}`, [110, 70]),
			part(`upper_arm_${s}`, `upper_arm_${s}`, [70, 190], true),
			part(`lower_arm_${s}`, `lower_arm_${s}`, [60, 170], true),
			part(`hand_${s}`, `hand_${s}`, [80, 85], true),
			...HAND_POSE_IMAGES.map((h) => part(`hand_${s}_${h}`, `hand_${s}`, [90, 120])),
			...segmentSlots(s).map((n) => {
				const [d, i] = n.split('_') as [Digit, string];
				const h = HAND[d];
				const [dx, dy] = h.seg[Number(i) - 1];
				return part(n, n, [h.w + Math.abs(dx), Math.round(Math.abs(dy) + h.w / 2)]);
			}),
		]),
	],
	channels: [
		{
			id: 'lean',
			label: 'Lean',
			tip: 'Degrees; bend the body at the waist. Negative leans right.',
			min: -20,
			max: 20,
			rest: 0,
			drives: [{ bone: 'spine', prop: 'rotate', per: 1 }],
		},
		{
			id: 'twist',
			label: 'Twist',
			tip: 'Degrees; turn the chest against the waist, in the picture.',
			min: -12,
			max: 12,
			rest: 0,
			drives: [{ bone: 'chest', prop: 'rotate', per: 1 }],
		},
		{
			id: 'breath',
			label: 'Breath',
			tip: 'Swell the chest a little.',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'chest', prop: 'scaleY', per: 0.03 }],
		},
		{
			id: 'head_tilt',
			label: 'Head tilt',
			tip: 'Degrees; positive tilts counter-clockwise.',
			min: -15,
			max: 15,
			rest: 0,
			drives: [{ bone: 'head', prop: 'rotate', per: 1 }],
		},
		{
			id: 'head_nod',
			label: 'Head nod',
			tip: 'Degrees, turned at the neck.',
			min: -10,
			max: 10,
			rest: 0,
			drives: [{ bone: 'neck', prop: 'rotate', per: 1 }],
		},
		...sides<RigTemplateChannel>((s, k) => {
			const side = SIDE[s];
			const Side = side === 'left' ? 'Left' : 'Right';
			return [
				{
					id: `shrug_${s}`,
					label: `Shrug ${side}`,
					tip: 'Lift the shoulder; below 0 drops it.',
					min: -0.3,
					max: 1,
					rest: 0,
					drives: [{ bone: `clavicle_${s}`, prop: 'rotate', per: 15 * k }],
				},
				{
					id: `arm_${s}`,
					label: `Raise ${side} arm`,
					tip: '0 hangs down, 1 points up and out; below 0 swings it in across the body.',
					min: -0.4,
					max: 1,
					rest: 0,
					drives: [{ bone: `upper_arm_${s}`, prop: 'rotate', per: 150 * k }],
				},
				{
					id: `reach_${s}`,
					label: `Reach ${side} arm`,
					tip: 'Point the arm toward the camera: the arm shortens, and so does the hand.',
					min: 0,
					max: 1,
					rest: 0,
					drives: [{ bone: `upper_arm_${s}`, prop: 'scaleY', per: -0.5 }],
				},
				{
					id: `elbow_${s}`,
					label: `Bend ${side} elbow`,
					tip: 'Fold the forearm up toward the shoulder; below 0 bends it the other way.',
					min: -0.3,
					max: 1,
					rest: 0,
					drives: [{ bone: `lower_arm_${s}`, prop: 'rotate', per: 140 * k }],
				},
				{
					id: `wrist_${s}`,
					label: `${Side} wrist`,
					tip: 'Degrees; positive turns the hand counter-clockwise.',
					min: -90,
					max: 90,
					rest: 0,
					drives: [{ bone: `hand_${s}`, prop: 'rotate', per: 1 }],
				},
				{
					id: `hand_${s}`,
					label: `${Side} hand pose`,
					tip: '0 the finger rig; 1 open, 2 fist, 3 pointing, 4 thumbs up when those images exist (each hides the fingers).',
					min: 0,
					max: 4,
					rest: 0,
					slot: `hand_${s}`,
					swaps: [
						{ at: 0, part: `hand_${s}` },
						...HAND_POSE_IMAGES.map((h, i) => ({ at: i + 1, part: `hand_${s}_${h}` })),
					],
					hides: segmentSlots(s).map((n) => ({ slot: n, part: n })),
				},
				{
					id: `curl_${s}`,
					label: `Curl ${side} hand`,
					tip: 'Close every finger and the thumb together; 1 is a fist.',
					min: 0,
					max: 1,
					rest: 0,
					sets: [
						...FINGERS.map((f) => ({ channel: `curl_${f}_${s}`, per: 1 })),
						{ channel: `thumb_${s}`, per: 1 },
					],
				},
				{
					id: `thumb_${s}`,
					label: `${Side} thumb`,
					tip: '1 folds the thumb across the palm; below 0 sticks it out (thumbs up).',
					min: -0.5,
					max: 1,
					rest: 0,
					drives: [
						{ bone: bone('thumb', 1, s), prop: 'rotate', per: 40 * k },
						{ bone: bone('thumb', 2, s), prop: 'rotate', per: 25 * k },
						{ bone: bone('thumb', 3, s), prop: 'rotate', per: 20 * k },
					],
				},
				...FINGERS.map((f): RigTemplateChannel => ({
					id: `curl_${f}_${s}`,
					label: `Curl ${side} ${f}`,
					tip: `Close the ${f} finger: each segment folds toward the palm.`,
					min: 0,
					max: 1,
					rest: 0,
					drives: SEGMENTS.map((n) => ({
						bone: bone(f, n, s),
						prop: 'scaleY' as const,
						per: CURL_FOLD[n - 1],
					})),
				})),
				{
					id: `spread_${s}`,
					label: `Spread ${side} fingers`,
					tip: 'Fan the fingers apart; below 0 closes them together.',
					min: -0.3,
					max: 1,
					rest: 0,
					drives: (
						[
							['index', 12],
							['middle', 3],
							['ring', -5],
							['pinky', -12],
						] as const
					).map(([f, deg]) => ({ bone: bone(f, 1, s), prop: 'rotate' as const, per: -k * deg })),
				},
			];
		}),
	],
	clips: [],
	motion: {
		body: {
			smooth: 0.05,
			minVisibility: 0.5,
			// Shoulder to shoulder: a waist-up shot rarely shows the hips.
			scale: { from: 11, to: 12, rig: 280 },
			entries: [
				{ kind: 'bone', channel: 'lean', bone: 'spine', from: [23, 24], to: [11, 12] },
				{ kind: 'bone', channel: 'twist', bone: 'chest', from: 11, to: 12, rest: [-1, 0] },
				{
					kind: 'bone',
					channel: 'head_tilt',
					bone: 'head',
					from: 8,
					to: 7,
					rest: [1, 0],
					minSpan: 0.12,
				},
				...sides<BodyMotionEntryOf>((s) => {
					const [sh, el, wr, knuckles] =
						s === 'l' ? [12, 14, 16, [18, 20]] : [11, 13, 15, [17, 19]];
					return [
						{ kind: 'bone', channel: `shrug_${s}`, bone: `clavicle_${s}`, from: [11, 12], to: sh },
						{ kind: 'bone', channel: `arm_${s}`, bone: `upper_arm_${s}`, from: sh, to: el },
						{ kind: 'bone', channel: `elbow_${s}`, bone: `lower_arm_${s}`, from: el, to: wr },
						{
							kind: 'bone',
							channel: `wrist_${s}`,
							bone: `hand_${s}`,
							from: wr,
							to: knuckles as [number, number],
							rest: [0, -1],
						},
					];
				}),
			],
		},
		// Hand Landmarker's 21 points: 0 wrist; 1–4 thumb; 5–8 index, 9–12 middle, 13–16 ring,
		// 17–20 pinky, each knuckle to tip. Read in the hand's own 3D points, so a finger curling
		// toward the camera reads as fully as one curling across the picture.
		hand: {
			smooth: 0.05,
			entries: sides<HandMotionEntry>((s) => [
				...FINGERS.map((f, i): HandMotionEntry => {
					const b = 5 + 4 * i;
					return {
						kind: 'curl',
						channel: `curl_${f}_${s}`,
						side: s,
						joints: [
							[0, b, b + 1],
							[b, b + 1, b + 2],
							[b + 1, b + 2, b + 3],
						],
						// Straight reads 0, a fist's ~240° reads 1: a relaxed hand keys a light curl, as it shows.
						rest: 0,
						full: 240,
					};
				}),
				{
					kind: 'curl',
					channel: `thumb_${s}`,
					side: s,
					joints: [
						[1, 2, 3],
						[2, 3, 4],
					],
					rest: 30,
					full: 120,
				},
				{
					kind: 'spread',
					channel: `spread_${s}`,
					side: s,
					from: [5, 6],
					to: [17, 18],
					rest: 15,
					full: 55,
				},
			]),
		},
		cannot: [
			'Depth: an arm reaching toward the camera (key Reach by hand), and nods.',
			'Turning toward or away from the camera.',
			'The drawn hand poses: the fingers are keyed instead.',
			'Fingers hidden behind the hand, the other hand or something held: they hold their last pose.',
			'Breathing.',
		],
	},
};

/** The same value on all four fingers' curl (thumb apart). */
const fingers = (
	t: number,
	s: 'l' | 'r',
	v: number,
	only: readonly (typeof FINGERS)[number][] = FINGERS,
): RigTemplateClipKey[] => only.map((f) => [t, `curl_${f}_${s}`, v]);

HALF_BODY.clips = [
	clip(HALF_BODY, 'idle', 4, [
		[2, 'breath', 1],
		[2, 'lean', 1.5],
		[1.2, 'twist', -1],
		[3, 'twist', 1],
		...both(2, 'arm', 0.03),
		...both(2, 'elbow', 0.08),
		...both(2, 'curl', 0.15),
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
	]),
	clip(HALF_BODY, 'wave', 2, [
		[0.3, 'arm_r', 0.35],
		[1.7, 'arm_r', 0.35],
		[0.3, 'elbow_r', 1],
		[1.7, 'elbow_r', 1],
		[0.3, 'shrug_r', 0.3],
		[1.7, 'shrug_r', 0.3],
		[0.25, 'hand_r', 1],
		[1.75, 'hand_r', 1],
		[0.3, 'spread_r', 0.6],
		[1.6, 'spread_r', 0.6],
		[0.3, 'wrist_r', 0],
		[0.5, 'wrist_r', 20],
		[0.7, 'wrist_r', -20],
		[0.9, 'wrist_r', 20],
		[1.1, 'wrist_r', -20],
		[1.3, 'wrist_r', 20],
		[1.5, 'wrist_r', 0],
		[0.4, 'lean', -2],
		[1.5, 'lean', -2],
		[0.4, 'head_tilt', 4],
		[1.5, 'head_tilt', 4],
	]),
	clip(HALF_BODY, 'point', 1.6, [
		[0.25, 'arm_r', 0.55],
		[1.3, 'arm_r', 0.55],
		[0.25, 'elbow_r', 0.1],
		[1.3, 'elbow_r', 0.1],
		[0.25, 'wrist_r', 5],
		[1.3, 'wrist_r', 5],
		[0.15, 'hand_r', 3],
		[1.4, 'hand_r', 3],
		...fingers(0.2, 'r', 1, ['middle', 'ring', 'pinky']),
		...fingers(1.35, 'r', 1, ['middle', 'ring', 'pinky']),
		[0.2, 'thumb_r', 0.6],
		[1.35, 'thumb_r', 0.6],
		[0.3, 'lean', -2],
		[1.3, 'lean', -2],
		[0.3, 'head_tilt', -3],
		[1.3, 'head_tilt', -3],
	]),
	// The fist turned so its fingers face the body puts the thumb up.
	clip(HALF_BODY, 'thumbs_up', 1.6, [
		[0.3, 'arm_r', 0.25],
		[1.3, 'arm_r', 0.25],
		[0.3, 'elbow_r', 1],
		[1.3, 'elbow_r', 1],
		[0.3, 'wrist_r', 70],
		[1.3, 'wrist_r', 70],
		[0.2, 'hand_r', 4],
		[1.4, 'hand_r', 4],
		...fingers(0.25, 'r', 1),
		...fingers(1.35, 'r', 1),
		[0.25, 'thumb_r', -0.5],
		[1.35, 'thumb_r', -0.5],
		[0.35, 'head_nod', -3],
		[0.6, 'head_nod', 1],
		[0.85, 'head_nod', 0],
		[0.3, 'head_tilt', 3],
		[1.3, 'head_tilt', 3],
	]),
	clip(HALF_BODY, 'fist_pump', 1.6, [
		[0.25, 'arm_r', 0.6],
		[0.55, 'arm_r', 0.65],
		[0.8, 'arm_r', 0.55],
		[1.05, 'arm_r', 0.65],
		[1.3, 'arm_r', 0.6],
		[0.25, 'elbow_r', 0.65],
		[0.55, 'elbow_r', 0.85],
		[0.8, 'elbow_r', 0.6],
		[1.05, 'elbow_r', 0.85],
		[1.3, 'elbow_r', 0.65],
		[0.2, 'curl_r', 1],
		[1.4, 'curl_r', 1],
		[0.2, 'hand_r', 2],
		[1.4, 'hand_r', 2],
		[0.3, 'shrug_r', 0.5],
		[1.3, 'shrug_r', 0.5],
		[0.3, 'lean', -3],
		[1.3, 'lean', -3],
		[0.55, 'head_nod', -4],
		[0.8, 'head_nod', 2],
		[1.05, 'head_nod', -4],
		[1.3, 'head_nod', 0],
		[0.4, 'breath', 1],
		[1.3, 'breath', 1],
	]),
	clip(HALF_BODY, 'celebrate', 2, [
		...both(0.3, 'arm', 0.9),
		...both(1.6, 'arm', 0.9),
		...both(0.3, 'elbow', 0.25),
		...both(1.6, 'elbow', 0.25),
		...both(0.3, 'shrug', 0.5),
		...both(1.6, 'shrug', 0.5),
		...both(0.25, 'hand', 1),
		...both(1.7, 'hand', 1),
		...both(0.3, 'spread', 1),
		...both(1.6, 'spread', 1),
		...[0.4, 0.6, 0.8, 1, 1.2, 1.4].flatMap((t, i) => both(t, 'wrist', i % 2 ? -15 : 15)),
		...both(1.6, 'wrist', 0),
		[0.5, 'lean', 3],
		[1, 'lean', -3],
		[1.5, 'lean', 2],
		[0.4, 'head_tilt', 4],
		[1.2, 'head_tilt', -3],
		[0.3, 'breath', 1],
		[1.6, 'breath', 1],
	]),
	clip(HALF_BODY, 'win_small', 1.5, [
		[0.25, 'arm_r', 0.5],
		[1.15, 'arm_r', 0.5],
		[0.25, 'elbow_r', 0.9],
		[0.5, 'elbow_r', 1],
		[0.75, 'elbow_r', 0.85],
		[1.15, 'elbow_r', 0.9],
		[0.2, 'curl_r', 1],
		[1.25, 'curl_r', 1],
		[0.2, 'hand_r', 2],
		[1.25, 'hand_r', 2],
		[0.3, 'lean', -3],
		[1.1, 'lean', -3],
		[0.3, 'head_nod', -3],
		[0.6, 'head_nod', 1],
		[0.9, 'head_nod', -2],
		[0.3, 'breath', 1],
		[1.2, 'breath', 0.3],
	]),
	clip(HALF_BODY, 'win_big', 3, [
		...both(0.3, 'arm', 1),
		...both(1.4, 'arm', 1),
		...both(0.3, 'elbow', 0.3),
		...both(0.7, 'elbow', 0.6),
		...both(1.1, 'elbow', 0.3),
		...both(1.4, 'elbow', 0.6),
		...both(0.2, 'curl', 1),
		...both(1.4, 'curl', 1),
		...both(1.6, 'curl', 0),
		...both(0.2, 'hand', 2),
		...both(1.45, 'hand', 2),
		...both(1.55, 'hand', 1),
		...both(2.7, 'hand', 1),
		...both(1.6, 'arm', 0.7),
		...both(2.6, 'arm', 0.7),
		...both(1.6, 'spread', 1),
		...both(2.6, 'spread', 1),
		...[1.8, 2, 2.2, 2.4].flatMap((t, i) => both(t, 'wrist', i % 2 ? -20 : 20)),
		...both(2.6, 'wrist', 0),
		...both(0.3, 'shrug', 0.6),
		...both(2.6, 'shrug', 0.6),
		[0.5, 'lean', 5],
		[1, 'lean', -5],
		[1.5, 'lean', 4],
		[2.1, 'lean', -3],
		[2.6, 'lean', 0],
		[0.6, 'twist', 6],
		[1.2, 'twist', -6],
		[1.8, 'twist', 4],
		[2.6, 'twist', 0],
		[0.45, 'head_nod', -5],
		[1.2, 'head_nod', 2],
		[2.1, 'head_tilt', 5],
		[2.7, 'head_tilt', 5],
		[0.3, 'breath', 1],
		[2.5, 'breath', 1],
	]),
];

export const RIG_TEMPLATES: readonly RigTemplate[] = [BUST_FACE, FULL_BODY, HALF_BODY];

export function rigTemplateById(id: string): RigTemplate | undefined {
	return RIG_TEMPLATES.find((t) => t.id === id);
}

/** Why a template could not make a rig, or null. */
export function rigTemplateProblem(t: RigTemplate): string | null {
	const bones = new Set<string>();
	for (const b of t.bones) {
		if (bones.has(b.name)) return `bone "${b.name}" is listed twice`;
		if (b.parent === undefined ? bones.size > 0 : !bones.has(b.parent))
			return `bone "${b.name}" must come after its parent, and only the first bone has none`;
		bones.add(b.name);
	}
	const slots = new Set<string>();
	for (const s of t.slots) {
		if (slots.has(s.name)) return `slot "${s.name}" is listed twice`;
		if (!bones.has(s.bone)) return `slot "${s.name}" names a missing bone "${s.bone}"`;
		slots.add(s.name);
	}
	const parts = new Map<string, string>();
	for (const p of t.parts) {
		if (parts.has(p.name)) return `part "${p.name}" is listed twice`;
		if (!slots.has(p.slot)) return `part "${p.name}" names a missing slot "${p.slot}"`;
		parts.set(p.name, p.slot);
	}
	for (const s of t.slots)
		if (s.setup !== undefined && parts.get(s.setup) !== s.name)
			return `slot "${s.name}" starts on "${s.setup}", which is not one of its parts`;
	const channels = new Set<string>();
	const driven = new Map<string, string>();
	for (const c of t.channels) {
		if (channels.has(c.id)) return `channel "${c.id}" is listed twice`;
		channels.add(c.id);
		if (!(c.min < c.max) || c.rest < c.min || c.rest > c.max)
			return `channel "${c.id}" needs min < max with rest between them`;
		for (const d of c.drives ?? []) {
			if (!bones.has(d.bone)) return `channel "${c.id}" drives a missing bone "${d.bone}"`;
			// A key is the channel's absolute value, so a second channel on it would overwrite the first.
			const owner = driven.get(`${d.bone}.${d.prop}`);
			if (owner !== undefined && owner !== c.id)
				return `channels "${owner}" and "${c.id}" both drive ${d.bone}.${d.prop}`;
			driven.set(`${d.bone}.${d.prop}`, c.id);
		}
		if (c.swaps) {
			if (!c.slot || !slots.has(c.slot)) return `channel "${c.id}" swaps a missing slot`;
			for (const [i, w] of c.swaps.entries()) {
				if (i > 0 && !(w.at > c.swaps[i - 1].at))
					return `channel "${c.id}" swaps must rise in order`;
				if (w.part !== null && parts.get(w.part) !== c.slot)
					return `channel "${c.id}" swaps to "${w.part}", not a part of "${c.slot}"`;
			}
			if (c.swaps[0]?.at !== c.min) return `channel "${c.id}" must swap from its min`;
		}
		if (c.shapes) {
			if (!slots.has(c.shapes.slot)) return `channel "${c.id}" picks a missing slot`;
			const lipsync = c.shapes.lipsync ?? {};
			for (const p of [
				c.shapes.rest,
				...Object.keys(c.shapes.open),
				...c.shapes.talk,
				...Object.values(lipsync),
			])
				if (parts.get(p) !== c.shapes.slot)
					return `channel "${c.id}" names "${p}", not a part of "${c.shapes.slot}"`;
			if (c.shapes.lipsync)
				for (const k of LIPSYNC_SHAPES)
					if (!lipsync[k]) return `channel "${c.id}" lip-sync has no part for shape "${k}"`;
			for (const k of Object.keys(lipsync))
				if (!(LIPSYNC_SHAPES as readonly string[]).includes(k))
					return `channel "${c.id}" lip-sync names an unknown shape "${k}"`;
		}
		if (c.hides) {
			if (!c.swaps) return `channel "${c.id}" hides slots but swaps none`;
			for (const h of c.hides) {
				if (!slots.has(h.slot)) return `channel "${c.id}" hides a missing slot "${h.slot}"`;
				if (parts.get(h.part) !== h.slot)
					return `channel "${c.id}" shows "${h.part}" in "${h.slot}", not one of its parts`;
				if (h.slot === c.slot) return `channel "${c.id}" hides its own slot "${h.slot}"`;
			}
		}
		if (c.sets && (c.drives?.length || c.swaps || c.shapes))
			return `channel "${c.id}" sets other channels, so it moves nothing itself`;
		if (!c.drives?.length && !c.swaps && !c.shapes && !c.sets?.length)
			return `channel "${c.id}" moves nothing`;
	}
	for (const c of t.channels)
		if (c.shapes && !t.channels.some((j) => j.id === c.shapes?.jaw && j.drives?.length))
			return `channel "${c.id}" opens a missing jaw channel "${c.shapes.jaw}"`;
	const hidden = new Map<string, string>();
	for (const c of t.channels) {
		const set = new Set<string>();
		for (const s of c.sets ?? []) {
			const target = t.channels.find((x) => x.id === s.channel);
			if (!target || target === c) return `channel "${c.id}" sets a missing channel "${s.channel}"`;
			if (target.sets || target.shapes)
				return `channel "${c.id}" sets "${s.channel}", which is not a number it can key`;
			if (set.has(s.channel)) return `channel "${c.id}" sets "${s.channel}" twice`;
			set.add(s.channel);
		}
		// A slot's image is keyed absolutely, so whoever hides it must be the only one keying it.
		for (const h of c.hides ?? []) {
			const owner =
				hidden.get(h.slot) ??
				t.channels.find((x) => x !== c && (x.slot === h.slot || x.shapes?.slot === h.slot))?.id;
			if (owner !== undefined && owner !== c.id)
				return `channels "${owner}" and "${c.id}" both key the image of "${h.slot}"`;
			hidden.set(h.slot, c.id);
		}
	}
	const motion = t.motion ? rigMotionProblem(t, parts) : null;
	if (motion) return motion;
	const clips = new Set<string>();
	for (const k of t.clips) {
		if (clips.has(k.name)) return `clip "${k.name}" is listed twice`;
		clips.add(k.name);
		if (!(k.length > 0)) return `clip "${k.name}" needs a length`;
		if (k.animation) {
			if (k.keys.length) return `clip "${k.name}" has both channel keys and timelines`;
			const bad = timelinesProblem(k.animation, k.length, bones, slots, parts);
			if (bad) return `clip "${k.name}" ${bad}`;
		}
		for (const [time, id, v] of k.keys) {
			const c = t.channels.find((x) => x.id === id);
			if (!c) return `clip "${k.name}" keys a missing channel "${id}"`;
			if (!(time >= 0 && time <= k.length + 1e-9))
				return `clip "${k.name}" keys "${id}" at ${time}, outside 0…${k.length}`;
			const fits = c.shapes
				? typeof v === 'string' && parts.get(v) === c.shapes.slot
				: typeof v === 'number' && v >= c.min && v <= c.max;
			if (!fits)
				return `clip "${k.name}" keys "${id}" to ${JSON.stringify(v)}, not one of its values`;
		}
		// Both would write the same keys, and the later one would win wherever their times cross.
		const keyed = new Set(k.keys.map((x) => x[1]));
		for (const id of keyed)
			for (const s of t.channels.find((x) => x.id === id)?.sets ?? [])
				if (keyed.has(s.channel))
					return `clip "${k.name}" keys both "${id}" and "${s.channel}", which it sets`;
	}
	return null;
}

/** Why a timeline clip names something a template rig does not have, or null (§7.4). */
function timelinesProblem(
	a: RigTemplateTimelines,
	length: number,
	bones: Set<string>,
	slots: Set<string>,
	parts: Map<string, string>,
): string | null {
	const extra = Object.keys(a).find((k) => !['bones', 'slots', 'drawOrder'].includes(k));
	if (extra) return `holds "${extra}" timelines, which a template rig cannot play`;
	const timed = (keys: unknown, what: string): string | null => {
		if (!Array.isArray(keys) || !keys.length) return `has an empty ${what} timeline`;
		for (const k of keys) {
			const time = (k as { time?: unknown } | null)?.time ?? 0;
			if (typeof time !== 'number' || !(time >= 0 && time <= length + 1e-9))
				return `keys ${what} outside 0…${length}`;
		}
		return null;
	};
	for (const [bone, tls] of Object.entries(a.bones ?? {})) {
		if (!bones.has(bone)) return `moves a bone "${bone}" the template does not have`;
		for (const [name, keys] of Object.entries(tls)) {
			if (!(TEMPLATE_BONE_TIMELINES as readonly string[]).includes(name))
				return `holds a "${name}" timeline on bone "${bone}"`;
			const bad = timed(keys, `${bone}.${name}`);
			if (bad) return bad;
		}
	}
	for (const [slot, tls] of Object.entries(a.slots ?? {})) {
		if (!slots.has(slot)) return `keys a slot "${slot}" the template does not have`;
		for (const [name, keys] of Object.entries(tls)) {
			if (!(TEMPLATE_SLOT_TIMELINES as readonly string[]).includes(name))
				return `holds a "${name}" timeline on slot "${slot}"`;
			const bad = timed(keys, `${slot}.${name}`);
			if (bad) return bad;
			if (name !== 'attachment') continue;
			for (const k of keys) {
				const part = k.name ?? null;
				if (part !== null && parts.get(part) !== slot)
					return `shows "${part}" in slot "${slot}", not one of its parts`;
			}
		}
	}
	if (a.drawOrder !== undefined) {
		const bad = timed(a.drawOrder, 'draw order');
		if (bad) return bad;
		for (const k of a.drawOrder)
			for (const o of k.offsets ?? [])
				if (!slots.has(o.slot)) return `reorders a slot "${o.slot}" the template does not have`;
	}
	return null;
}

const refOk = (r: LandmarkRef, count: number) =>
	(typeof r === 'number' ? [r] : r).every((i) => Number.isInteger(i) && i >= 0 && i < count);

/** Why a template's motion map could not drive its channels, or null. */
function rigMotionProblem(t: RigTemplate, parts: Map<string, string>): string | null {
	const m = t.motion!;
	const chan = new Map(t.channels.map((c) => [c.id, c]));
	const blend = new Set<string>(FACE_BLENDSHAPES);
	const seen = new Set<string>();
	const claim = (id: string): string | null => {
		if (!chan.has(id)) return `motion drives a missing channel "${id}"`;
		if (seen.has(id)) return `motion drives channel "${id}" twice`;
		if (chan.get(id)!.sets)
			return `motion drives "${id}", which only sets other channels: map those instead`;
		seen.add(id);
		return null;
	};
	for (const e of m.face?.entries ?? []) {
		const bad = claim(e.channel);
		if (bad) return bad;
		const c = chan.get(e.channel)!;
		if (e.kind === 'blend' || e.kind === 'shape') {
			const names =
				e.kind === 'blend' ? [...e.plus, ...(e.minus ?? [])] : Object.values(e.features).flat();
			const unknown = names.find((n) => !blend.has(n));
			if (unknown) return `motion "${e.channel}" reads an unknown blendshape "${unknown}"`;
			if (!names.length) return `motion "${e.channel}" reads no blendshape`;
		}
		if (e.kind === 'shape') {
			if (!c.shapes) return `motion "${e.channel}" picks shapes, but the channel has none`;
			for (const p of Object.keys(e.shapes))
				if (parts.get(p) !== c.shapes.slot)
					return `motion "${e.channel}" names "${p}", not a part of "${c.shapes.slot}"`;
		} else if (c.shapes) return `motion "${e.channel}" sets a number on a shapes channel`;
		const refs =
			e.kind === 'angle' ? [e.from, e.to] : e.kind === 'offset' ? [e.point, ...e.between] : [];
		if (!refs.every((r) => refOk(r, FACE_LANDMARK_COUNT)))
			return `motion "${e.channel}" names a face point outside 0…${FACE_LANDMARK_COUNT - 1}`;
	}
	const body = m.body;
	if (body) {
		if (!(body.scale.rig > 0)) return 'motion body scale needs a rig length';
		if (![body.scale.from, body.scale.to].every((r) => refOk(r, POSE_LANDMARK_COUNT)))
			return `motion body scale names a pose point outside 0…${POSE_LANDMARK_COUNT - 1}`;
		const chain = new Map<string, string[]>();
		for (const b of t.bones)
			chain.set(b.name, b.parent === undefined ? [] : [b.parent, ...(chain.get(b.parent) ?? [])]);
		const root = t.bones[0]?.name;
		const done: string[] = [];
		for (const e of body.entries) {
			const bad = claim(e.channel);
			if (bad) return bad;
			const c = chan.get(e.channel)!;
			const refs = e.kind === 'bone' ? [e.from, e.to] : [e.point];
			if (!refs.every((r) => refOk(r, POSE_LANDMARK_COUNT)))
				return `motion "${e.channel}" names a pose point outside 0…${POSE_LANDMARK_COUNT - 1}`;
			if (e.kind === 'root') {
				if (!c.drives?.some((d) => d.bone === root && d.prop === e.axis))
					return `motion "${e.channel}" moves the root on ${e.axis}, which the channel does not drive`;
				continue;
			}
			if (!chain.has(e.bone)) return `motion "${e.channel}" turns a missing bone "${e.bone}"`;
			if (worldTurnPer(c, e.bone, chain) === 0)
				return `motion "${e.channel}" turns "${e.bone}", which the channel does not rotate`;
			if (e.minSpan !== undefined && !(e.minSpan >= 0 && e.minSpan < 1))
				return `motion "${e.channel}" needs a minimum span between 0 and 1`;
			if (!boneRestDirection(t.bones, e.bone, e.rest))
				return `motion "${e.channel}" needs a rest direction for "${e.bone}"`;
			// The solve reads a child's offset as a picture direction, which holds only while the bone
			// and its parents are unturned in the setup pose (true of the built-ins).
			const turned = [e.bone, ...(chain.get(e.bone) ?? [])].find(
				(n) => (t.bones.find((b) => b.name === n)?.rotation ?? 0) !== 0,
			);
			if (turned && !e.rest)
				return `motion "${e.channel}" needs a rest direction: "${turned}" is turned in the setup pose`;
			// A bone is solved after its parents, so it can take off the turn they already carry.
			const late = done.find((b) => chain.get(b)?.includes(e.bone));
			if (late) return `motion "${e.channel}" turns "${e.bone}" after its child "${late}"`;
			done.push(e.bone);
		}
	}
	for (const e of m.hand?.entries ?? []) {
		const bad = claim(e.channel);
		if (bad) return bad;
		if (chan.get(e.channel)!.shapes)
			return `motion "${e.channel}" sets a number on a shapes channel`;
		if (e.side !== 'l' && e.side !== 'r') return `motion "${e.channel}" needs the hand side l or r`;
		if (e.kind === 'curl' && !e.joints.length) return `motion "${e.channel}" reads no joint`;
		const pts = e.kind === 'curl' ? e.joints.flat() : [...e.from, ...e.to];
		if (!pts.every((i) => refOk(i, HAND_LANDMARK_COUNT)))
			return `motion "${e.channel}" names a hand point outside 0…${HAND_LANDMARK_COUNT - 1}`;
		if (!(Math.abs(e.full - e.rest) > 0))
			return `motion "${e.channel}" needs its full angle apart from its rest`;
	}
	return null;
}

/** An atlas region's drawn size: the untrimmed size when the packer trimmed it. */
export interface TemplateRegion {
	name: string;
	w: number;
	h: number;
	origW?: number;
	origH?: number;
}

export interface TemplateRig {
	skeleton: Record<string, unknown>;
	ref: RigTemplateRef;
	/** Parts the art does not have, so the rig does not show them. */
	missing: string[];
	/** The missing parts the template needs to work. */
	missingRequired: string[];
}

/**
 * A new rig from a template, over the art's regions. Only parts the art has become attachments:
 * the game's loader throws on an attachment whose region is not in the atlas, so a missing part is
 * reported, never written. A slot whose setup part is missing starts empty.
 */
export function templateRig(t: RigTemplate, regions: readonly TemplateRegion[]): TemplateRig {
	const problem = rigTemplateProblem(t);
	if (problem) throw new Error(`Rig template "${t.id}" is broken: ${problem}`);
	const byName = new Map(regions.map((r) => [r.name, r]));
	const attachments: Record<string, Record<string, Record<string, number>>> = {};
	const missing: string[] = [];
	const missingRequired: string[] = [];
	for (const p of t.parts) {
		const r = byName.get(p.name);
		if (!r) {
			missing.push(p.name);
			if (p.required) missingRequired.push(p.name);
			continue;
		}
		(attachments[p.slot] ??= {})[p.name] = {
			...nonDefault(p.at ?? {}, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
			width: r.origW ?? r.w,
			height: r.origH ?? r.h,
		};
	}
	const skeleton = {
		irig: IRIG_VERSION,
		skeleton: {},
		bones: t.bones.map((b) => ({
			name: b.name,
			...(b.parent === undefined ? {} : { parent: b.parent }),
			...nonDefault(b, { length: 0, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
		})),
		slots: t.slots.map((s) => ({
			name: s.name,
			bone: s.bone,
			...(s.color !== undefined && s.color !== 'ffffffff' ? { color: s.color } : {}),
			...(s.setup !== undefined && attachments[s.name]?.[s.setup] ? { attachment: s.setup } : {}),
			...(s.blend !== undefined && s.blend !== 'normal' ? { blend: s.blend } : {}),
		})),
		skins: [{ name: 'default', attachments }],
		animations: {},
	};
	return { skeleton, ref: { id: t.id, version: t.version }, missing, missingRequired };
}

/** The fields of `from` named in `defaults` whose value differs from the default there. */
function nonDefault<K extends string>(
	from: object,
	defaults: Record<K, number>,
): Partial<Record<K, number>> {
	const out: Partial<Record<K, number>> = {};
	for (const k of Object.keys(defaults) as K[]) {
		const v = (from as Partial<Record<K, unknown>>)[k];
		if (typeof v === 'number' && v !== defaults[k]) out[k] = v;
	}
	return out;
}

/** What a create answers about a template rig. */
export function templateReport(fit: TemplateRig): RigTemplateRef & {
	missing: string[];
	missingRequired: string[];
} {
	return { ...fit.ref, missing: fit.missing, missingRequired: fit.missingRequired };
}

/** Who saved a template made in the Rigger, and the head the author was shown. */
export interface RigTemplateSaved {
	savedAt: string;
	savedBy: { uid: string; name: string };
	project: string;
	/** The head's etag: the precondition for a new version or a delete. */
	etag: string | null;
}

/** What the Rigger page is told about a template. */
export interface RigTemplateSummary {
	id: string;
	version: number;
	label: string;
	parts: { name: string; required: boolean }[];
	channels: RigTemplateChannel[];
	clips: RigTemplateClip[];
	/** The skeleton and the motion map, for the motion import's solve. */
	bones: RigTemplateBone[];
	motion: RigMotionMap | null;
	/** In code, or made in the Rigger (docs/design/rig-templates.md §7), with who saved it. */
	origin: 'builtin' | 'user';
	saved?: RigTemplateSaved;
}

export function rigTemplateSummary(t: RigTemplate, saved?: RigTemplateSaved): RigTemplateSummary {
	return {
		id: t.id,
		version: t.version,
		label: t.label,
		parts: t.parts.map((p) => ({ name: p.name, required: p.required })),
		channels: t.channels,
		clips: t.clips,
		bones: t.bones,
		motion: t.motion ?? null,
		origin: saved ? 'user' : 'builtin',
		...(saved ? { saved } : {}),
	};
}

/** The built-in templates. */
export function rigTemplateList(): RigTemplateSummary[] {
	return RIG_TEMPLATES.map((t) => rigTemplateSummary(t));
}

/** A bundle's `template.json`, or null for none or one that is not `{ id, version }`. */
export function parseTemplateRef(text: string | null): RigTemplateRef | null {
	if (!text) return null;
	let ref: unknown;
	try {
		ref = JSON.parse(text);
	} catch {
		return null;
	}
	if (!ref || typeof ref !== 'object') return null;
	const { id, version } = ref as { id?: unknown; version?: unknown };
	if (typeof id !== 'string' || !id) return null;
	return { id, version: typeof version === 'number' && Number.isInteger(version) ? version : 1 };
}

/** The BUILT-IN template a `template.json` names, or null (`rigTemplateStore` resolves user ones). */
export function rigTemplateFromSidecar(text: string | null): RigTemplateSummary | null {
	const ref = parseTemplateRef(text);
	const t = ref ? rigTemplateById(ref.id) : undefined;
	return t ? rigTemplateSummary(t) : null;
}
