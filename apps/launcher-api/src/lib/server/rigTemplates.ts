import { IRIG_VERSION } from 'engine-rig';
import {
	FACE_BLENDSHAPES,
	FACE_GROUPS,
	FACE_LANDMARK_COUNT,
	POSE_LANDMARK_COUNT,
	boneRestDirection,
	scalePer,
	worldTurnPer,
	type LandmarkRef,
	type MotionFilter,
	type RigMotionMap,
} from '../rigMotion';
import { HAND_LANDMARK_COUNT, type HandMotionEntry } from '../rigMotionHand';
import { LIPSYNC_SHAPES, MOUTH_SHAPES, faceBlock, part, sides } from './rigTemplateFace';

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

/**
 * A part drawn as a mesh that bends: a `grid` of columns × rows of vertices over the image, each
 * weighted to the listed bones by how near it lies to each one's place on the image (`at`: u, v
 * from the image's top-left, 0…1). Bone weights, not deform keys, so the weights carry across every
 * image the slot swaps to and any number of controls can move the bones.
 */
export interface RigTemplateBend {
	grid: [number, number];
	bones: { bone: string; at: [number, number] }[];
}

export interface RigTemplatePart {
	name: string;
	slot: string;
	required: boolean;
	/** Placeholder size, used only until art is attached. */
	size: [number, number];
	at?: RigTemplatePlacement;
	bend?: RigTemplateBend;
}

/** A channel moving a bone: the key is `value × per` from setup (a scale: `1 + value × per`). */
export interface RigTemplateDrive {
	bone: string;
	prop: 'x' | 'y' | 'rotate' | 'scaleX' | 'scaleY';
	per: number;
}

/**
 * A depth control (docs/design/rig-templates.md §5.4): from each step's `at` upward, `slots` are
 * drawn just behind the slot `behind`, in their own order; below the first step they keep their
 * setup place. Keyed as the animation's draw order, so a hand passes behind the body or the head.
 */
export interface RigTemplateOrder {
	slots: string[];
	steps: { at: number; behind: string }[];
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
	/** Reorders slots in depth (the draw order); it has no drives, swaps or shapes of its own. */
	order?: RigTemplateOrder;
	/**
	 * `open`: how far each shape opens the jaw; `talk`: the order the talk helper cycles;
	 * `lipsync`: the part each lip-sync shape letter (A–H, X) becomes (§5.2); `pose`: the other
	 * controls each shape sets (mouth corners, lips), every one of them back to rest on a shape that
	 * does not name it.
	 */
	shapes?: {
		slot: string;
		jaw: string;
		rest: string;
		open: Record<string, number>;
		talk: string[];
		lipsync?: Record<string, string>;
		pose?: Record<string, Record<string, number>>;
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

export { LIPSYNC_SHAPES };

/**
 * Bust with face as it was first made (version 1), kept so a rig made from it keeps its controls:
 * a rig's keys are its controls' values times their travel, so the travel of a version a rig was
 * made from never changes. Its motion map is the face block's, cut to its controls.
 */
export const BUST_FACE_V1: RigTemplate = {
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
};

/** The face block as Bust with face v2 and Half body v1 have it: no depth controls. */
const FACE_V2 = faceBlock('head');
/** The face block with depth: the head turn's parallax and a head up / down control (§5.4). */
const FACE = faceBlock('head', { back: ['hair_back'], front: ['hair_front'] });

/** The face block's motion map, kept to the controls `t` has. */
function faceMotion(t: RigTemplate) {
	const ids = new Set(t.channels.map((c) => c.id));
	return { ...FACE.motion, entries: FACE.motion.entries.filter((e) => ids.has(e.channel)) };
}

const NOD_CANNOT =
	'Nods (up and down): the template turns the head in the picture, not toward the camera.';
const BODY_CANNOT = 'Breathing, and anything the face does not show (shoulders, body).';

BUST_FACE_V1.motion = {
	face: faceMotion(BUST_FACE_V1),
	cannot: [
		NOD_CANNOT,
		'Turns wider than the face slide inside the head; a ¾ view needs its own drawing.',
		BODY_CANNOT,
	],
};

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

BUST_FACE_V1.clips = [
	clip(BUST_FACE_V1, 'idle', 4, [
		[2, 'breath', 1],
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
		[1.5, 'gaze_x', 0.3],
		[1.9, 'gaze_x', 0.3],
		[2.3, 'gaze_x', 0],
		...blinkAt(0.9),
		...blinkAt(3),
	]),
	clip(BUST_FACE_V1, 'blink', 0.2, blinkAt(0)),
	clip(BUST_FACE_V1, 'talk', 2, [
		...talkKeys(BUST_FACE_V1, TALK_STEP, 2 - TALK_STEP),
		[0.5, 'head_nod', 1.5],
		[1, 'head_nod', 0],
		[1.5, 'head_nod', 1],
	]),
	clip(BUST_FACE_V1, 'happy', 1.2, [
		[0.1, 'mouth', 'mouth_smile'],
		[1, 'mouth', 'mouth_smile'],
		...both(0.15, 'brow', 0.7),
		...both(0.9, 'brow', 0.7),
		...both(0.15, 'blink', 0.4),
		...both(0.9, 'blink', 0.4),
		[0.3, 'head_tilt', 4],
		[0.9, 'head_tilt', 3],
	]),
	clip(BUST_FACE_V1, 'surprised', 1, [
		[0.08, 'mouth', 'mouth_O'],
		[0.8, 'mouth', 'mouth_O'],
		...both(0.08, 'brow', 1),
		...both(0.8, 'brow', 1),
		[0.08, 'gaze_y', 0.4],
		[0.8, 'gaze_y', 0.4],
		[0.1, 'head_nod', -3],
		[0.8, 'head_nod', -2],
	]),
	clip(BUST_FACE_V1, 'win_small', 1.5, [
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
	clip(BUST_FACE_V1, 'win_big', 2.5, [
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

/**
 * Bust with face, version 2: the bust of version 1 with the shared face block on its head
 * (`rigTemplateFace.ts`) — mouth corners, lips, cheeks, lids, inner and outer brows, the jaw
 * sideways and the nose, with bending brows and mouths, and more travel on every control so a
 * clear performance reads at game size. Every bone of version 1 keeps its place.
 */
export const BUST_FACE_V2: RigTemplate = {
	id: 'bust-face',
	version: 2,
	label: 'Bust with face',
	bones: [
		{ name: 'root', x: 0, y: 0 },
		{ name: 'chest', parent: 'root', x: 0, y: 120 },
		...sides((s, k) => [{ name: `shoulder_${s}`, parent: 'chest', x: 110 * k, y: 40 }]),
		{ name: 'neck', parent: 'chest', x: 0, y: 110 },
		{ name: 'head', parent: 'neck', x: 0, y: 40 },
		{ name: 'hair_back', parent: 'head', x: 0, y: 120 },
		...FACE_V2.bones,
		{ name: 'hair_front', parent: 'head', x: 0, y: 150 },
	],
	slots: [
		{ name: 'hair_back', bone: 'hair_back', setup: 'hair_back' },
		{ name: 'body', bone: 'chest', setup: 'body' },
		{ name: 'neck', bone: 'neck', setup: 'neck' },
		{ name: 'head', bone: 'head', setup: 'head' },
		...sides((s) => [{ name: `ear_${s}`, bone: 'head', setup: `ear_${s}` }]),
		...FACE_V2.slots,
		{ name: 'hair_front', bone: 'hair_front', setup: 'hair_front' },
	],
	parts: [
		part('hair_back', 'hair_back', [300, 300]),
		part('body', 'body', [420, 240], true),
		part('neck', 'neck', [90, 90]),
		part('head', 'head', [260, 300], true),
		...sides((s) => [part(`ear_${s}`, `ear_${s}`, [50, 80])]),
		...FACE_V2.parts,
		part('hair_front', 'hair_front', [300, 200]),
	],
	channels: [
		...FACE_V2.channels,
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
};
BUST_FACE_V2.motion = {
	face: faceMotion(BUST_FACE_V2),
	cannot: [NOD_CANNOT, ...FACE_V2.cannot, BODY_CANNOT],
};

BUST_FACE_V2.clips = [
	clip(BUST_FACE_V2, 'idle', 4, [
		[2, 'breath', 1],
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
		[1.5, 'gaze_x', 0.3],
		[1.9, 'gaze_x', 0.3],
		[2.3, 'gaze_x', 0],
		...both(1.6, 'smile', 0.15),
		...both(2.6, 'smile', 0.15),
		...blinkAt(0.9),
		...blinkAt(3),
	]),
	clip(BUST_FACE_V2, 'blink', 0.2, blinkAt(0)),
	clip(BUST_FACE_V2, 'talk', 2, [
		...talkKeys(BUST_FACE_V2, TALK_STEP, 2 - TALK_STEP),
		[0.5, 'head_nod', 1.5],
		[1, 'head_nod', 0],
		[1.5, 'head_nod', 1],
		...both(0.4, 'brow', 0.3),
		...both(0.8, 'brow', 0),
		...both(1.3, 'brow', 0.25),
		...both(1.7, 'brow', 0),
	]),
	clip(BUST_FACE_V2, 'happy', 1.2, [
		[0.1, 'mouth', 'mouth_smile'],
		[1, 'mouth', 'mouth_smile'],
		...both(0.15, 'cheek', 0.7),
		...both(0.9, 'cheek', 0.7),
		...both(0.15, 'squint', 0.4),
		...both(0.9, 'squint', 0.4),
		...both(0.15, 'brow', 0.5),
		...both(0.9, 'brow', 0.5),
		...both(0.15, 'blink', 0.2),
		...both(0.9, 'blink', 0.2),
		[0.3, 'head_tilt', 4],
		[0.9, 'head_tilt', 3],
	]),
	clip(BUST_FACE_V2, 'surprised', 1, [
		[0.08, 'mouth', 'mouth_O'],
		[0.8, 'mouth', 'mouth_O'],
		...both(0.08, 'brow', 1),
		...both(0.8, 'brow', 1),
		...both(0.08, 'brow_in', 0.5),
		...both(0.8, 'brow_in', 0.5),
		...both(0.08, 'blink', -0.3),
		...both(0.8, 'blink', -0.3),
		[0.08, 'gaze_y', 0.4],
		[0.8, 'gaze_y', 0.4],
		[0.1, 'head_nod', -3],
		[0.8, 'head_nod', -2],
	]),
	clip(BUST_FACE_V2, 'sad', 1.5, [
		...both(0.2, 'brow_in', 0.9),
		...both(1.3, 'brow_in', 0.9),
		...both(0.2, 'brow_out', -0.5),
		...both(1.3, 'brow_out', -0.5),
		...both(0.25, 'smile', -0.7),
		...both(1.3, 'smile', -0.7),
		[0.25, 'lip_lower', -0.3],
		[1.3, 'lip_lower', -0.3],
		...both(0.2, 'blink', 0.25),
		...both(1.3, 'blink', 0.25),
		[0.3, 'gaze_y', -0.5],
		[1.3, 'gaze_y', -0.5],
		[0.4, 'head_tilt', -4],
		[1.3, 'head_tilt', -4],
		[0.4, 'head_nod', 3],
		[1.3, 'head_nod', 3],
	]),
	clip(BUST_FACE_V2, 'angry', 1.2, [
		...both(0.1, 'brow', -1),
		...both(1, 'brow', -1),
		...both(0.1, 'brow_in', -1),
		...both(1, 'brow_in', -1),
		...both(0.1, 'squint', 0.6),
		...both(1, 'squint', 0.6),
		...both(0.15, 'smile', -0.4),
		...both(1, 'smile', -0.4),
		[0.15, 'lip_upper', 0.5],
		[1, 'lip_upper', 0.5],
		[0.15, 'sneer', 0.7],
		[1, 'sneer', 0.7],
		[0.2, 'head_nod', 2],
		[1, 'head_nod', 2],
	]),
	clip(BUST_FACE_V2, 'win_small', 1.5, [
		[0.1, 'mouth', 'mouth_smile'],
		[1.3, 'mouth', 'mouth_smile'],
		...both(0.15, 'cheek', 0.6),
		...both(1.2, 'cheek', 0.6),
		...both(0.15, 'brow', 0.6),
		...both(1.2, 'brow', 0.6),
		[0.2, 'head_nod', -4],
		[0.4, 'head_nod', 2],
		[0.6, 'head_nod', -3],
		[0.8, 'head_nod', 0],
		[0.3, 'breath', 1],
		[1.2, 'breath', 0.3],
	]),
	clip(BUST_FACE_V2, 'win_big', 2.5, [
		[0.1, 'mouth', 'mouth_wide'],
		[0.6, 'mouth', 'mouth_A'],
		[1.1, 'mouth', 'mouth_wide'],
		[1.8, 'mouth', 'mouth_smile'],
		[2.3, 'mouth', 'mouth_smile'],
		...both(0.1, 'brow', 1),
		...both(2.2, 'brow', 1),
		...both(0.1, 'cheek', 0.8),
		...both(2.2, 'cheek', 0.8),
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
/**
 * How far an elbow folds either way in the picture, in degrees. A hinge in 3D, but drawn flat it
 * bends both ways: which way the forearm turns on screen depends on how the upper arm is rolled,
 * an axis a 2D bone does not have. On real footage a hanging arm bends inward (the hand in front of
 * the body) on 58–100% of frames, by up to about 165° (rig templates §5.5).
 */
const ELBOW_REACH = 168;
const HAND_POSES = ['open', 'fist', 'point'];

/**
 * A whole standing character, drawn facing the viewer or facing right (the game flips it). Every
 * channel is a forward (FK) rotation or move: an IK constraint would override the rotation keys the
 * channels write, so the legs carry none; a planted-foot crouch waits for body tracking (T7b).
 */
export const FULL_BODY_V1: RigTemplate = {
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
				tip: 'Fold the forearm: + with the arm raised to the side lifts the hand (a flex), − brings the hand in across the body. 1 = 120°.',
				min: -ELBOW_REACH / 120,
				max: ELBOW_REACH / 120,
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
			smooth: 0.03,
			follow: 20,
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

FULL_BODY_V1.clips = [
	clip(FULL_BODY_V1, 'idle', 4, [
		[2, 'breath', 1],
		[2, 'lean', 1.5],
		...both(2, 'arm', 0.04),
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
	]),
	clip(FULL_BODY_V1, 'celebrate', 2, [
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
	clip(FULL_BODY_V1, 'win_small', 1.5, [
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
	clip(FULL_BODY_V1, 'win_big', 3, [
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
	clip(FULL_BODY_V1, 'walk', 1, [
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
 * The face is the shared face block (`rigTemplateFace.ts`) on `head`, as on Bust with face, so a
 * face clip, lip-sync or face import made for one plays on the other. Its slots draw after the head
 * and ears and before both arms, so a hand raised in front of the face covers it.
 */
export const HALF_BODY_V1: RigTemplate = {
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
		{ name: 'hair_back', parent: 'head', x: 0, y: 120 },
		...FACE_V2.bones,
		{ name: 'hair_front', parent: 'head', x: 0, y: 150 },
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
		{ name: 'hair_back', bone: 'hair_back', setup: 'hair_back' },
		{ name: 'pelvis', bone: 'hip', setup: 'pelvis' },
		{ name: 'torso', bone: 'chest', setup: 'torso' },
		{ name: 'neck', bone: 'neck', setup: 'neck' },
		{ name: 'head', bone: 'head', setup: 'head' },
		...sides((s) => [{ name: `ear_${s}`, bone: 'head', setup: `ear_${s}` }]),
		...FACE_V2.slots,
		{ name: 'hair_front', bone: 'hair_front', setup: 'hair_front' },
		...sides((s) => [
			{ name: `shoulder_${s}`, bone: `clavicle_${s}`, setup: `shoulder_${s}` },
			{ name: `upper_arm_${s}`, bone: `upper_arm_${s}`, setup: `upper_arm_${s}` },
			{ name: `lower_arm_${s}`, bone: `lower_arm_${s}`, setup: `lower_arm_${s}` },
			{ name: `hand_${s}`, bone: `hand_${s}`, setup: `hand_${s}` },
			...segmentSlots(s).map((n) => ({ name: n, bone: n, setup: n })),
		]),
	],
	parts: [
		part('hair_back', 'hair_back', [300, 300]),
		part('pelvis', 'pelvis', [300, 120]),
		part('torso', 'torso', [360, 380], true),
		part('neck', 'neck', [90, 90]),
		part('head', 'head', [260, 300], true),
		...sides((s) => [part(`ear_${s}`, `ear_${s}`, [50, 80])]),
		...FACE_V2.parts,
		part('hair_front', 'hair_front', [300, 200]),
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
			id: 'head_nod',
			label: 'Head nod',
			tip: 'Degrees, turned at the neck.',
			min: -10,
			max: 10,
			rest: 0,
			drives: [{ bone: 'neck', prop: 'rotate', per: 1 }],
		},
		...FACE_V2.channels,
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
					tip: 'Fold the forearm: + swings it out and up (a raised arm’s wave), − brings the hand in across the body (in front of the chest). 1 = 140°.',
					min: -ELBOW_REACH / 140,
					max: ELBOW_REACH / 140,
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
		face: FACE_V2.motion,
		body: {
			smooth: 0.03,
			follow: 20,
			minVisibility: 0.5,
			// Shoulder to shoulder: a waist-up shot rarely shows the hips.
			scale: { from: 11, to: 12, rig: 280 },
			entries: [
				{ kind: 'bone', channel: 'lean', bone: 'spine', from: [23, 24], to: [11, 12] },
				// Side-on, the shoulder line is short and its angle is noise (measured: 58 of the 97 frames
				// past ±12° on a turning performer had the shoulders under half their spread).
				{
					kind: 'bone',
					channel: 'twist',
					bone: 'chest',
					from: 11,
					to: 12,
					rest: [-1, 0],
					minSpan: 0.6,
				},
				...sides<BodyMotionEntryOf>((s) => {
					const [sh, el, wr, knuckles] =
						s === 'l' ? [12, 14, 16, [18, 20]] : [11, 13, 15, [17, 19]];
					return [
						{
							kind: 'bone',
							channel: `shrug_${s}`,
							bone: `clavicle_${s}`,
							from: [11, 12],
							to: sh,
							minSpan: 0.3,
						},
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
			smooth: 0.03,
			follow: 20,
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
			'The body turning toward or away from the camera.',
			...FACE_V2.cannot,
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

HALF_BODY_V1.clips = [
	clip(HALF_BODY_V1, 'idle', 4, [
		[2, 'breath', 1],
		[2, 'lean', 1.5],
		[1.2, 'twist', -1],
		[3, 'twist', 1],
		...both(2, 'arm', 0.03),
		...both(2, 'elbow', 0.08),
		...both(2, 'curl', 0.15),
		[1.2, 'head_tilt', 1.5],
		[3.2, 'head_tilt', -1],
		[1.5, 'gaze_x', 0.3],
		[1.9, 'gaze_x', 0.3],
		[2.3, 'gaze_x', 0],
		...both(1.6, 'smile', 0.15),
		...both(2.6, 'smile', 0.15),
		...blinkAt(0.9),
		...blinkAt(3),
	]),
	clip(HALF_BODY_V1, 'wave', 2, [
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
		[0.2, 'mouth', 'mouth_smile'],
		[1.7, 'mouth', 'mouth_smile'],
		...both(0.25, 'cheek', 0.5),
		...both(1.6, 'cheek', 0.5),
		...both(0.25, 'brow', 0.4),
		...both(1.6, 'brow', 0.4),
	]),
	clip(HALF_BODY_V1, 'point', 1.6, [
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
		...both(0.25, 'brow', 0.6),
		...both(1.3, 'brow', 0.6),
		[0.25, 'mouth', 'mouth_O'],
		[0.6, 'mouth', 'mouth_smile'],
		[1.3, 'mouth', 'mouth_smile'],
	]),
	// The fist turned so its fingers face the body puts the thumb up.
	clip(HALF_BODY_V1, 'thumbs_up', 1.6, [
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
		[0.25, 'mouth', 'mouth_smile'],
		[1.35, 'mouth', 'mouth_smile'],
		...both(0.3, 'cheek', 0.6),
		...both(1.3, 'cheek', 0.6),
		[0.45, 'blink_l', 0],
		[0.5, 'blink_l', 1],
		[0.75, 'blink_l', 1],
		[0.8, 'blink_l', 0],
	]),
	clip(HALF_BODY_V1, 'fist_pump', 1.6, [
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
		[0.25, 'mouth', 'mouth_wide'],
		[0.55, 'mouth', 'mouth_A'],
		[0.8, 'mouth', 'mouth_wide'],
		[1.05, 'mouth', 'mouth_A'],
		[1.3, 'mouth', 'mouth_wide'],
		...both(0.25, 'brow', -0.4),
		...both(1.3, 'brow', -0.4),
		...both(0.25, 'squint', 0.5),
		...both(1.3, 'squint', 0.5),
	]),
	clip(HALF_BODY_V1, 'celebrate', 2, [
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
		[0.2, 'mouth', 'mouth_A'],
		[0.8, 'mouth', 'mouth_wide'],
		[1.7, 'mouth', 'mouth_wide'],
		...both(0.2, 'brow', 1),
		...both(1.6, 'brow', 1),
		...both(0.3, 'cheek', 0.7),
		...both(1.6, 'cheek', 0.7),
	]),
	clip(HALF_BODY_V1, 'win_small', 1.5, [
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
		[0.1, 'mouth', 'mouth_smile'],
		[1.3, 'mouth', 'mouth_smile'],
		...both(0.15, 'cheek', 0.6),
		...both(1.2, 'cheek', 0.6),
		...both(0.15, 'brow', 0.6),
		...both(1.2, 'brow', 0.6),
	]),
	clip(HALF_BODY_V1, 'win_big', 3, [
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
		[0.1, 'mouth', 'mouth_wide'],
		[0.6, 'mouth', 'mouth_A'],
		[1.1, 'mouth', 'mouth_wide'],
		[1.8, 'mouth', 'mouth_smile'],
		[2.8, 'mouth', 'mouth_smile'],
		...both(0.1, 'brow', 1),
		...both(2.7, 'brow', 1),
		...both(1.8, 'cheek', 0.7),
		...both(2.7, 'cheek', 0.7),
		...blinkAt(2.2),
	]),
];

// ---- Depth (docs/design/rig-templates.md §5.4) -------------------------------------------------
// A 2D rig shows depth as foreshortening, draw order, parallax and image swaps. The depth versions
// below are the previous version plus those, so a rig made from the previous version keeps its
// controls exactly.

/** How short a limb may get pointing at the camera: 0.3 of its length (a shorter one stops reading). */
const FORESHORTEN_FLOOR = 0.3;
/** A full `approach` (±1) scales the whole character by this much. */
const APPROACH_PER = 0.15;

/**
 * `t`'s bones and slots with each named slot's image on a bone of its own (`<slot>_image`), a child
 * of the slot's bone at its place. A limb's shortening scales that bone, so the limb's image shortens
 * while the joints below keep their own shape (a scaled chain bone would squash its children).
 */
function withImageBones(t: RigTemplate, slots: string[]): Pick<RigTemplate, 'bones' | 'slots'> {
	const bones: RigTemplateBone[] = [];
	for (const b of t.bones) {
		bones.push(b);
		for (const s of t.slots)
			if (s.bone === b.name && slots.includes(s.name))
				bones.push({ name: `${s.name}_image`, parent: b.name, x: 0, y: 0 });
	}
	return {
		bones,
		slots: t.slots.map((s) => (slots.includes(s.name) ? { ...s, bone: `${s.name}_image` } : s)),
	};
}

/** `list` with each channel named in `by` replaced by the channels given for it. */
const replaceChannels = (
	list: RigTemplateChannel[],
	by: Record<string, RigTemplateChannel[]>,
): RigTemplateChannel[] => list.flatMap((c) => by[c.id] ?? [c]);

const SIDE_WORD = (s: 'l' | 'r') => (s === 'l' ? 'left' : 'right');

/**
 * A limb shortening toward or away from the camera: `bone` scales along the limb (its image, or a
 * hand with its fingers) and the next joint, `next`, comes in with it.
 */
function shorten(
	t: { bones: RigTemplateBone[] },
	id: string,
	label: string,
	bone: string,
	next: string | null,
): RigTemplateChannel {
	const n = next ? t.bones.find((b) => b.name === next) : undefined;
	return {
		id,
		label,
		tip: 'Point it toward or away from the camera: it shortens toward its joint, down to 0.3 of its length.',
		min: 0,
		max: 1 - FORESHORTEN_FLOOR,
		rest: 0,
		drives: [
			{ bone, prop: 'scaleY', per: -1 },
			...(n && n.x ? [{ bone: n.name, prop: 'x' as const, per: -n.x }] : []),
			...(n && n.y ? [{ bone: n.name, prop: 'y' as const, per: -n.y }] : []),
		],
	};
}

/** The ¾ and side torso images a turn shows, when the art has them (all optional). */
const torsoViews = (size: [number, number]): RigTemplatePart[] =>
	['3q_l', '3q_r', 'side_l', 'side_r'].map((v) => part(`torso_${v}`, 'torso', size));

/** The body's turn toward the picture's right (+) or left, as a ¾ or side torso image. */
const TURN: RigTemplateChannel = {
	id: 'turn',
	label: 'Body turn',
	tip: 'Turn the body toward the picture’s right (+) or left: shows the ¾ and side torso images when the art has them (Body side-on narrows it).',
	min: -1,
	max: 1,
	rest: 0,
	slot: 'torso',
	swaps: [
		{ at: -1, part: 'torso_side_l' },
		{ at: -0.75, part: 'torso_3q_l' },
		{ at: -0.3, part: 'torso' },
		{ at: 0.3, part: 'torso_3q_r' },
		{ at: 0.75, part: 'torso_side_r' },
	],
};

/**
 * How side-on the body is: the `images` (the torso, the pelvis) narrow a little — a body has depth of
 * its own — and `joints` (the shoulders, the hips) come in toward the middle by the full amount
 * (1 − the cosine of the turn).
 */
function sideOn(
	t: { bones: RigTemplateBone[] },
	joints: string[],
	images: string[],
): RigTemplateChannel {
	return {
		id: 'turn_width',
		label: 'Body side-on',
		tip: 'How side-on the body is: the shoulders and hips come in toward the middle and the torso narrows. Body turn picks the image.',
		min: 0,
		max: 0.6,
		rest: 0,
		drives: [
			...images.map((bone) => ({ bone, prop: 'scaleX' as const, per: -0.5 })),
			...joints.map((j) => ({
				bone: j,
				prop: 'x' as const,
				per: -(t.bones.find((b) => b.name === j)?.x ?? 0),
			})),
		],
	};
}

const APPROACH: RigTemplateChannel = {
	id: 'approach',
	label: 'Nearer / further',
	tip: 'Scale the whole character a little: + as if it came toward the camera, − as if it stepped back (1 = 15%).',
	min: -1,
	max: 1,
	rest: 0,
	drives: [
		{ bone: 'root', prop: 'scaleX', per: APPROACH_PER },
		{ bone: 'root', prop: 'scaleY', per: APPROACH_PER },
	],
};

/** One arm in depth: in front (setup), behind the head, behind the body. */
const armDepth = (s: 'l' | 'r', slots: string[]): RigTemplateChannel => ({
	id: `depth_${s}`,
	label: `${SIDE_WORD(s) === 'left' ? 'Left' : 'Right'} arm depth`,
	tip: '0 in front of the body, 1 behind the head, 2 behind the body: keyed as the draw order.',
	min: 0,
	max: 2,
	rest: 0,
	order: {
		slots,
		steps: [
			{ at: 1, behind: 'head' },
			{ at: 2, behind: 'torso' },
		],
	},
});

/** Pose points per side, `l` the picture's left (the performer's right). */
const POSE_SIDE = {
	l: {
		shoulder: 12,
		elbow: 14,
		wrist: 16,
		knuckles: [18, 20] as [number, number],
		hip: 24,
		knee: 26,
		ankle: 28,
	},
	r: {
		shoulder: 11,
		elbow: 13,
		wrist: 15,
		knuckles: [17, 19] as [number, number],
		hip: 23,
		knee: 25,
		ankle: 27,
	},
};
const SHOULDERS: [number, number] = [11, 12];
const HIPS: [number, number] = [23, 24];

/**
 * The depth readings every body template shares: the body's turn from the shoulder and hip lines
 * (each point's depth, measured on real footage at under 1° of jitter on turns of 33–101°), its
 * distance from the picture's pixels per metre of the shoulders and the torso (about 1% jitter), and
 * each wrist in front of or behind the body and the head (0.004–0.026 m jitter, hence the margins).
 */
const BODY_DEPTH: BodyMotionEntryOf[] = [
	{
		kind: 'turn',
		channel: 'turn',
		lines: [
			[12, 11],
			[24, 23],
		],
		read: 'yaw',
		gain: 1 / 90,
	},
	{
		kind: 'turn',
		channel: 'turn_width',
		lines: [
			[12, 11],
			[24, 23],
		],
		read: 'width',
		gain: 1,
	},
	{
		kind: 'approach',
		channel: 'approach',
		bone: 'root',
		lines: [
			[11, 12],
			[SHOULDERS, HIPS],
		],
	},
	...sides<BodyMotionEntryOf>((s) => [
		{
			kind: 'depth',
			channel: `depth_${s}`,
			point: POSE_SIDE[s].wrist,
			steps: [
				{ at: 2, behind: SHOULDERS, margin: 0.05, below: SHOULDERS },
				{ at: 1, behind: [7, 8], margin: 0.05, above: SHOULDERS },
			],
		},
	]),
];

/** The limbs' shortening, read from the pose's 3D points (its own hand points: cleaner than the hand model's). */
const armForeshorten = (s: 'l' | 'r'): BodyMotionEntryOf[] => {
	const p = POSE_SIDE[s];
	return [
		{
			kind: 'foreshorten',
			channel: `fore_upper_arm_${s}`,
			bone: `upper_arm_${s}_image`,
			from: p.shoulder,
			to: p.elbow,
		},
		{
			kind: 'foreshorten',
			channel: `fore_lower_arm_${s}`,
			bone: `lower_arm_${s}_image`,
			from: p.elbow,
			to: p.wrist,
		},
		{
			kind: 'foreshorten',
			channel: `fore_hand_${s}`,
			bone: `hand_${s}`,
			from: p.wrist,
			to: p.knuckles,
		},
	];
};

const TURN_CANNOT =
	'A full turn: the body shows its ¾ and side images and narrows, but its back and other side need drawings of their own.';
const CROSS_CANNOT =
	'A hand crossing in front of the other arm: an arm goes in front of or behind the body and the head only.';

/**
 * Bust with face, version 3: version 2 with depth. The head turn slides the nose further than the
 * face and the back hair the other way, a head up / down control does the same vertically, both read
 * from the face's 3D pose, and the character comes nearer or goes back with the face's distance.
 */
export const BUST_FACE: RigTemplate = {
	...BUST_FACE_V2,
	version: 3,
	channels: [
		...replaceChannels(BUST_FACE_V2.channels, {
			head_turn: FACE.channels.filter((c) => c.id === 'head_turn' || c.id === 'head_pitch'),
		}),
		APPROACH,
	],
	clips: BUST_FACE_V2.clips,
};
BUST_FACE.motion = {
	face: {
		...faceMotion(BUST_FACE),
		entries: [
			...faceMotion(BUST_FACE).entries,
			// The face's distance (its 3D pose) jitters about 0.2% on real footage.
			{ kind: 'pose', channel: 'approach', axis: 'near', gain: 1 / APPROACH_PER },
		],
	},
	cannot: [...FACE.cannot, BODY_CANNOT],
};

const FULL_BODY_IMAGES = withImageBones(FULL_BODY_V1, [
	'pelvis',
	'torso',
	...sides((s) => [`upper_arm_${s}`, `lower_arm_${s}`, `thigh_${s}`, `shin_${s}`]),
]);

/**
 * Full body, version 2: version 1 with depth. Each limb shortens as it points toward or away from
 * the camera (its image on a bone of its own at the joint), each arm passes behind the head or the
 * body in the draw order, the body turns (¾ and side torso images when the art has them, and narrows)
 * and comes nearer or goes back.
 */
export const FULL_BODY: RigTemplate = {
	...FULL_BODY_V1,
	version: 2,
	...FULL_BODY_IMAGES,
	parts: [...FULL_BODY_V1.parts, ...torsoViews([200, 240])],
	channels: [
		...FULL_BODY_V1.channels,
		...sides<RigTemplateChannel>((s) => [
			shorten(
				FULL_BODY_V1,
				`fore_upper_arm_${s}`,
				`Shorten ${SIDE_WORD(s)} upper arm`,
				`upper_arm_${s}_image`,
				`lower_arm_${s}`,
			),
			shorten(
				FULL_BODY_V1,
				`fore_lower_arm_${s}`,
				`Shorten ${SIDE_WORD(s)} forearm`,
				`lower_arm_${s}_image`,
				`hand_${s}`,
			),
			shorten(FULL_BODY_V1, `fore_hand_${s}`, `Shorten ${SIDE_WORD(s)} hand`, `hand_${s}`, null),
			shorten(
				FULL_BODY_V1,
				`fore_thigh_${s}`,
				`Shorten ${SIDE_WORD(s)} thigh`,
				`thigh_${s}_image`,
				`shin_${s}`,
			),
			shorten(
				FULL_BODY_V1,
				`fore_shin_${s}`,
				`Shorten ${SIDE_WORD(s)} shin`,
				`shin_${s}_image`,
				`foot_${s}`,
			),
		]),
		TURN,
		sideOn(
			FULL_BODY_V1,
			sides((s) => [`upper_arm_${s}`, `thigh_${s}`]),
			['torso_image', 'pelvis_image'],
		),
		APPROACH,
		...sides((s) => [armDepth(s, [`upper_arm_${s}`, `lower_arm_${s}`, `hand_${s}`])]),
	],
	clips: FULL_BODY_V1.clips,
};
FULL_BODY.motion = {
	body: {
		...FULL_BODY_V1.motion!.body!,
		entries: [
			...FULL_BODY_V1.motion!.body!.entries,
			...sides<BodyMotionEntryOf>((s) => {
				const p = POSE_SIDE[s];
				return [
					...armForeshorten(s),
					{
						kind: 'foreshorten',
						channel: `fore_thigh_${s}`,
						bone: `thigh_${s}_image`,
						from: p.hip,
						to: p.knee,
					},
					{
						kind: 'foreshorten',
						channel: `fore_shin_${s}`,
						bone: `shin_${s}_image`,
						from: p.knee,
						to: p.ankle,
					},
				];
			}),
			...BODY_DEPTH,
		],
	},
	cannot: [
		TURN_CANNOT,
		CROSS_CANNOT,
		'A knee bending forward, or a crouch with the feet planted (the template has no IK).',
		'The head turning or nodding (one head image), hand poses and breathing.',
	],
};

/**
 * Half body, version 2: version 1 with depth. The arms and hands shorten toward the camera (Reach
 * sets all three), each arm passes behind the head or the body in the draw order, the body turns
 * and comes nearer, and the face block turns and nods the head with parallax (§5.4).
 */
export const HALF_BODY: RigTemplate = {
	...HALF_BODY_V1,
	version: 2,
	...withImageBones(HALF_BODY_V1, ['torso', ...sides((s) => [`upper_arm_${s}`, `lower_arm_${s}`])]),
	parts: [...HALF_BODY_V1.parts, ...torsoViews([360, 380])],
	channels: [
		...replaceChannels(HALF_BODY_V1.channels, {
			head_turn: FACE.channels.filter((c) => c.id === 'head_turn' || c.id === 'head_pitch'),
			...Object.fromEntries(
				sides((s) => [
					[
						`reach_${s}`,
						[
							{
								id: `reach_${s}`,
								label: `Reach ${SIDE_WORD(s)} arm`,
								tip: 'Point the whole arm toward the camera: the upper arm, forearm and hand shorten together.',
								min: 0,
								max: 1,
								rest: 0,
								sets: [
									{ channel: `fore_upper_arm_${s}`, per: 1 - FORESHORTEN_FLOOR },
									{ channel: `fore_lower_arm_${s}`, per: 1 - FORESHORTEN_FLOOR },
									{ channel: `fore_hand_${s}`, per: 0.4 },
								],
							},
						],
					],
				]),
			),
		}),
		...sides<RigTemplateChannel>((s) => [
			shorten(
				HALF_BODY_V1,
				`fore_upper_arm_${s}`,
				`Shorten ${SIDE_WORD(s)} upper arm`,
				`upper_arm_${s}_image`,
				`lower_arm_${s}`,
			),
			shorten(
				HALF_BODY_V1,
				`fore_lower_arm_${s}`,
				`Shorten ${SIDE_WORD(s)} forearm`,
				`lower_arm_${s}_image`,
				`hand_${s}`,
			),
			shorten(HALF_BODY_V1, `fore_hand_${s}`, `Shorten ${SIDE_WORD(s)} hand`, `hand_${s}`, null),
		]),
		TURN,
		sideOn(
			HALF_BODY_V1,
			sides((s) => [`clavicle_${s}`, `upper_arm_${s}`]),
			['torso_image'],
		),
		APPROACH,
		...sides((s) => [
			armDepth(s, [
				`upper_arm_${s}`,
				`lower_arm_${s}`,
				`hand_${s}`,
				...HALF_BODY_V1.slots
					.filter(
						(x) => x.bone.endsWith(`_${s}`) && /^(thumb|index|middle|ring|pinky)_/.test(x.name),
					)
					.map((x) => x.name),
			]),
		]),
	],
	clips: HALF_BODY_V1.clips,
};
HALF_BODY.motion = {
	face: faceMotion(HALF_BODY),
	body: {
		...HALF_BODY_V1.motion!.body!,
		entries: [...HALF_BODY_V1.motion!.body!.entries, ...sides(armForeshorten), ...BODY_DEPTH],
	},
	hand: HALF_BODY_V1.motion!.hand,
	cannot: [
		TURN_CANNOT,
		CROSS_CANNOT,
		...FACE.cannot,
		'The drawn hand poses: the fingers are keyed instead.',
		'Fingers hidden behind the hand, the other hand or something held: they hold their last pose.',
		'Breathing.',
	],
};

/** The built-in templates ＋ New rig offers: the newest version of each. */
export const RIG_TEMPLATES: readonly RigTemplate[] = [BUST_FACE, FULL_BODY, HALF_BODY];
/** Every built-in version a rig may have been made from. */
export const RIG_TEMPLATE_VERSIONS: readonly RigTemplate[] = [
	BUST_FACE_V1,
	BUST_FACE_V2,
	FULL_BODY_V1,
	HALF_BODY_V1,
	...RIG_TEMPLATES,
];

/** A built-in template: the version a rig names when it is one we have, else the newest. */
export function rigTemplateById(id: string, version?: number): RigTemplate | undefined {
	return (
		(version === undefined
			? undefined
			: RIG_TEMPLATE_VERSIONS.find((t) => t.id === id && t.version === version)) ??
		RIG_TEMPLATES.find((t) => t.id === id)
	);
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
	for (const p of t.parts) {
		const bad = p.bend ? bendProblem(t, p) : null;
		if (bad) return `part "${p.name}" ${bad}`;
	}
	const channels = new Set<string>();
	const driven = new Map<string, string>();
	const reordered = new Map<string, string>();
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
			for (const p of Object.keys(c.shapes.pose ?? {}))
				if (parts.get(p) !== c.shapes.slot)
					return `channel "${c.id}" poses "${p}", not a part of "${c.shapes.slot}"`;
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
		if (c.order) {
			const bad = orderProblem(c, t.slots);
			if (bad) return `channel "${c.id}" ${bad}`;
			for (const s of c.order.slots) {
				const owner = reordered.get(s);
				if (owner !== undefined) return `channels "${owner}" and "${c.id}" both reorder "${s}"`;
				reordered.set(s, c.id);
			}
		}
		if (!c.drives?.length && !c.swaps && !c.shapes && !c.sets?.length && !c.order)
			return `channel "${c.id}" moves nothing`;
	}
	for (const c of t.channels) {
		if (c.shapes && !t.channels.some((j) => j.id === c.shapes?.jaw && j.drives?.length))
			return `channel "${c.id}" opens a missing jaw channel "${c.shapes.jaw}"`;
		for (const pose of Object.values(c.shapes?.pose ?? {}))
			for (const [id, v] of Object.entries(pose)) {
				const j = t.channels.find((x) => x.id === id);
				if (!j?.drives?.length || j.shapes || id === c.shapes?.jaw)
					return `channel "${c.id}" poses "${id}", which is not a control it can set`;
				if (!(v >= j.min && v <= j.max))
					return `channel "${c.id}" poses "${id}" to ${v}, outside ${j.min}…${j.max}`;
			}
	}
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

/**
 * Why a depth control cannot reorder its slots, or null: each step must put the slots further back,
 * behind a slot drawn before all of them, and the rest is the setup order.
 */
function orderProblem(c: RigTemplateChannel, slots: RigTemplateSlot[]): string | null {
	const o = c.order!;
	if (c.drives?.length || c.swaps || c.shapes || c.sets)
		return 'reorders slots, so it moves nothing else';
	const at = new Map(slots.map((s, i) => [s.name, i]));
	if (!o.slots.length) return 'reorders no slot';
	if (new Set(o.slots).size !== o.slots.length) return 'reorders a slot twice';
	const missing = o.slots.find((s) => !at.has(s));
	if (missing !== undefined) return `reorders a missing slot "${missing}"`;
	if (!o.steps.length) return 'reorders slots at no step';
	const front = Math.min(...o.slots.map((s) => at.get(s)!));
	let prev = front;
	for (const [i, st] of o.steps.entries()) {
		if (!(st.at > c.min && st.at <= c.max) || (i > 0 && !(st.at > o.steps[i - 1].at)))
			return 'steps must rise in order inside its range, above its min';
		const b = at.get(st.behind);
		if (b === undefined) return `puts slots behind a missing slot "${st.behind}"`;
		if (!(b < prev))
			return `puts slots behind "${st.behind}", which is not drawn before ${i ? 'the step before' : 'them'}`;
		prev = b;
	}
	if (!(c.rest < o.steps[0].at)) return 'rests below its first step (the setup order)';
	return null;
}

/**
 * The image a swap channel shows at `value` on a rig with these images: the step the value is at,
 * or, when the rig lacks that image, the nearest step toward the channel's rest that it has (then on
 * below the rest), so a missing angry brow shows the neutral one and a missing ¾ torso the front one,
 * never nothing. The Controls section keys the same choice (`faceSwapPart` in the Rigger).
 */
export function swapPart(
	ch: RigTemplateChannel,
	value: number,
	has: (part: string) => boolean,
): string | null {
	const swaps = ch.swaps ?? [];
	const step = (v: number) => {
		let s = 0;
		for (const [i, w] of swaps.entries()) if (v >= w.at - 1e-9) s = i;
		return s;
	};
	const ok = (i: number) => swaps[i].part === null || has(swaps[i].part as string);
	const from = step(value);
	const rest = step(ch.rest);
	const dir = from > rest ? -1 : 1;
	for (let i = from; ; i += dir) {
		if (ok(i)) return swaps[i].part;
		if (i === rest) break;
	}
	for (let i = Math.min(from, rest) - 1; i >= 0; i--) if (ok(i)) return swaps[i].part;
	return null;
}

/**
 * The draw order (slot names, back to front) the depth controls give at their values: each moves its
 * slots, in their own order, to just behind the slot its step names; controls apply in the order
 * given, so two moved behind one slot keep their setup order.
 */
export function orderAt(
	slots: readonly string[],
	controls: { order: RigTemplateOrder; value: number }[],
): string[] {
	let out = [...slots];
	for (const { order, value } of controls) {
		let behind: string | null = null;
		for (const st of order.steps) if (value >= st.at - 1e-9) behind = st.behind;
		if (behind === null) continue;
		const moving = out.filter((s) => order.slots.includes(s));
		out = out.filter((s) => !order.slots.includes(s));
		const at = out.indexOf(behind);
		if (at < 0) continue;
		out.splice(at, 0, ...moving);
	}
	return out;
}

/** A draw order as the rig format's key offsets: each moved slot, in setup order, and how far. */
export function orderOffsets(
	setup: readonly string[],
	order: readonly string[],
): { slot: string; offset: number }[] {
	const pos = new Map(order.map((s, i) => [s, i]));
	return setup
		.map((slot, i) => ({ slot, offset: (pos.get(slot) ?? i) - i }))
		.filter((o) => o.offset !== 0);
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
	for (const [what, f] of [
		['face', m.face],
		['body', m.body],
	] as [string, MotionFilter | undefined][])
		if (f && !(f.smooth >= 0 && (f.follow ?? 0) >= 0))
			return `motion ${what} needs a smoothing time and follow of 0 or more`;
	for (const e of m.face?.entries ?? []) {
		const bad = claim(e.channel);
		if (bad) return bad;
		if (e.group !== undefined && !(FACE_GROUPS as readonly string[]).includes(e.group))
			return `motion "${e.channel}" names an unknown group "${e.group}"`;
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
		if (e.kind === 'pose' && !['yaw', 'pitch', 'near'].includes(e.axis))
			return `motion "${e.channel}" reads an unknown head axis "${e.axis}"`;
		if (
			(e.kind === 'pose' || e.kind === 'angle' || e.kind === 'offset') &&
			!Number.isFinite(e.gain)
		)
			return `motion "${e.channel}" needs a gain`;
		if (c.order) return `motion "${e.channel}" sets a number on a draw-order control`;
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
			const claimed = claim(e.channel);
			if (claimed) return claimed;
			const c = chan.get(e.channel)!;
			const bad = bodyDepthProblem(e, c, chain);
			if (bad) return bad;
			if (e.kind !== 'depth' && c.order)
				return `motion "${e.channel}" sets a number on a draw-order control`;
			if (e.kind !== 'bone' && e.kind !== 'root') continue;
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
		if (chan.get(e.channel)!.shapes || chan.get(e.channel)!.order)
			return `motion "${e.channel}" sets a number on a ${chan.get(e.channel)!.shapes ? 'shapes' : 'draw-order'} channel`;
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

/** Why a body depth entry (§5.4) cannot drive its channel, or null; null for the other kinds. */
function bodyDepthProblem(
	e: BodyMotionEntryOf,
	c: RigTemplateChannel,
	chain: Map<string, string[]>,
): string | null {
	if (e.kind === 'bone' || e.kind === 'root') return null;
	const pose = (refs: LandmarkRef[]) =>
		refs.every((r) => refOk(r, POSE_LANDMARK_COUNT))
			? null
			: `motion "${e.channel}" names a pose point outside 0…${POSE_LANDMARK_COUNT - 1}`;
	if (c.shapes) return `motion "${e.channel}" sets a number on a shapes channel`;
	if (e.kind === 'foreshorten' || e.kind === 'approach') {
		if (!chain.has(e.bone)) return `motion "${e.channel}" scales a missing bone "${e.bone}"`;
		if (scalePer(c, e.bone) === 0)
			return `motion "${e.channel}" scales "${e.bone}", which the channel does not scale`;
	}
	if (e.kind === 'foreshorten') return pose([e.from, e.to]);
	if (e.kind === 'turn' || e.kind === 'approach') {
		if (!e.lines.length) return `motion "${e.channel}" reads no line`;
		if (e.kind === 'turn' && (!['yaw', 'width'].includes(e.read) || !Number.isFinite(e.gain)))
			return `motion "${e.channel}" needs a turn reading (yaw or width) and a gain`;
		return pose(e.lines.flat());
	}
	if (!c.order && !c.swaps)
		return `motion "${e.channel}" sets a depth step, but the channel neither reorders nor swaps`;
	if (!e.steps.length) return `motion "${e.channel}" has no depth step`;
	for (const st of e.steps) {
		if (!(st.at >= c.min && st.at <= c.max) || st.at === c.rest)
			return `motion "${e.channel}" steps to ${st.at}, not a value of the channel apart from its rest`;
		if (!Number.isFinite(st.margin)) return `motion "${e.channel}" needs a depth margin`;
	}
	return pose([
		e.point,
		...e.steps.flatMap((st) => [
			st.behind,
			...(st.above === undefined ? [] : [st.above]),
			...(st.below === undefined ? [] : [st.below]),
		]),
	]);
}

/** Setup world positions of the bones, by name (a template's bones are unturned where it bends). */
function boneWorld(t: RigTemplate): Map<string, [number, number]> {
	const at = new Map<string, [number, number]>();
	for (const b of t.bones) {
		const p = b.parent === undefined ? [0, 0] : (at.get(b.parent) ?? [0, 0]);
		at.set(b.name, [p[0] + b.x, p[1] + b.y]);
	}
	return at;
}

/** Why a bending part could not be built, or null. */
function bendProblem(t: RigTemplate, p: RigTemplatePart): string | null {
	const bend = p.bend!;
	const [cols, rows] = bend.grid;
	if (![cols, rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 16))
		return 'bends on a grid of 2 to 16 columns and rows';
	if (!bend.bones.length) return 'bends on no bone';
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const slotBone = t.slots.find((s) => s.name === p.slot)?.bone;
	const used = new Set<string>();
	for (const w of bend.bones) {
		if (!byName.has(w.bone)) return `bends on a missing bone "${w.bone}"`;
		if (used.has(w.bone)) return `bends on "${w.bone}" twice`;
		used.add(w.bone);
		if (!w.at.every((u) => u >= 0 && u <= 1)) return `places "${w.bone}" off the image`;
	}
	// Weighted vertices are written in each bone's setup space, read here as a plain offset.
	for (const name of [...used, ...(slotBone ? [slotBone] : [])])
		for (let b = byName.get(name); b; b = b.parent ? byName.get(b.parent) : undefined)
			if ((b.rotation ?? 0) !== 0 || (b.scaleX ?? 1) !== 1 || (b.scaleY ?? 1) !== 1)
				return `bends on "${b.name}", which is turned or scaled in the setup pose`;
	if (p.at && ((p.at.rotation ?? 0) !== 0 || (p.at.scaleX ?? 1) !== 1 || (p.at.scaleY ?? 1) !== 1))
		return 'bends, so it cannot be turned or scaled on its bone';
	return null;
}

/**
 * A bending part's weighted mesh at the art's size: a grid over the image (centred on the slot's
 * bone, as an image part is), each vertex weighted to the part's bones by inverse squared distance
 * to each one's place on the image. Hull first, as the rig format wants.
 */
function bendMesh(
	t: RigTemplate,
	p: RigTemplatePart,
	w: number,
	h: number,
	world: Map<string, [number, number]>,
): Record<string, unknown> {
	const bend = p.bend!;
	const [cols, rows] = bend.grid;
	const slotBone = t.slots.find((s) => s.name === p.slot)!.bone;
	const [ox, oy] = world.get(slotBone)!;
	const cx = ox + (p.at?.x ?? 0);
	const cy = oy + (p.at?.y ?? 0);
	const index = new Map(t.bones.map((b, i) => [b.name, i]));
	const cells: [number, number][] = [];
	for (let c = 0; c < cols; c++) cells.push([c, 0]);
	for (let r = 1; r < rows; r++) cells.push([cols - 1, r]);
	for (let c = cols - 2; c >= 0; c--) cells.push([c, rows - 1]);
	for (let r = rows - 2; r >= 1; r--) cells.push([0, r]);
	const hull = cells.length;
	for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) cells.push([c, r]);
	const at = new Map(cells.map(([c, r], i) => [`${c},${r}`, i]));
	const uvs: number[] = [];
	const vertices: number[] = [];
	const eps = (0.04 * Math.max(w, h)) ** 2;
	const anchors = bend.bones.map((b) => ({
		bone: b.bone,
		x: (b.at[0] - 0.5) * w,
		y: (0.5 - b.at[1]) * h,
	}));
	for (const [c, r] of cells) {
		const u = c / (cols - 1);
		const v = r / (rows - 1);
		uvs.push(u, v);
		const x = (u - 0.5) * w;
		const y = (0.5 - v) * h;
		let weights = anchors.map((a) => 1 / ((x - a.x) ** 2 + (y - a.y) ** 2 + eps));
		const sum = weights.reduce((s, x) => s + x, 0);
		weights = weights.map((x) => x / sum);
		const kept = anchors
			.map((a, i) => ({ a, wt: weights[i] }))
			.filter((k) => k.wt >= 0.01)
			.sort((p, q) => q.wt - p.wt);
		const ksum = kept.reduce((s, k) => s + k.wt, 0);
		// Rounded weights that sum to exactly 1, or the vertex drifts by its distance from the origin.
		const wts = kept.map((k) => round4(k.wt / ksum));
		wts[0] = round4(1 - wts.slice(1).reduce((s, x) => s + x, 0));
		vertices.push(kept.length);
		kept.forEach(({ a }, i) => {
			const [bx, by] = world.get(a.bone)!;
			vertices.push(index.get(a.bone)!, round4(cx + x - bx), round4(cy + y - by), wts[i]);
		});
	}
	const triangles: number[] = [];
	for (let r = 0; r < rows - 1; r++)
		for (let c = 0; c < cols - 1; c++) {
			const a = at.get(`${c},${r}`)!;
			const b = at.get(`${c + 1},${r}`)!;
			const d = at.get(`${c},${r + 1}`)!;
			const e = at.get(`${c + 1},${r + 1}`)!;
			triangles.push(a, d, b, b, d, e);
		}
	return { type: 'mesh', uvs, triangles, vertices, hull, width: w, height: h };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

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
	const world = boneWorld(t);
	const attachments: Record<string, Record<string, Record<string, unknown>>> = {};
	const missing: string[] = [];
	const missingRequired: string[] = [];
	for (const p of t.parts) {
		const r = byName.get(p.name);
		if (!r) {
			missing.push(p.name);
			if (p.required) missingRequired.push(p.name);
			continue;
		}
		const w = r.origW ?? r.w;
		const h = r.origH ?? r.h;
		(attachments[p.slot] ??= {})[p.name] = p.bend
			? bendMesh(t, p, w, h, world)
			: {
					...nonDefault(p.at ?? {}, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
					width: w,
					height: h,
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
	/** A built-in's newest version, when the rig was made from an older one (it keeps its controls). */
	newest?: number;
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
		...newerBuiltin(t, saved),
	};
}

function newerBuiltin(t: RigTemplate, saved?: RigTemplateSaved): { newest?: number } {
	if (saved) return {};
	const newest = RIG_TEMPLATES.find((b) => b.id === t.id)?.version;
	return newest !== undefined && newest > t.version ? { newest } : {};
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
	const t = ref ? rigTemplateById(ref.id, ref.version) : undefined;
	return t ? rigTemplateSummary(t) : null;
}
