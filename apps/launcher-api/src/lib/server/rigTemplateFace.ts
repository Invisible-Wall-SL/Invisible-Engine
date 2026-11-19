import type { FaceMotionEntry, RigMotionFace } from '../rigMotion';
import type {
	RigTemplateBend,
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplateDrive,
	RigTemplatePart,
	RigTemplateSlot,
} from './rigTemplates';

/**
 * The face every face template shares (docs/design/rig-templates.md §4): its bones, images,
 * controls and motion map, as one block a template puts on its head bone. Bust with face v2 is its
 * bust plus this block; a half-body template takes the same block, so a clip or a motion import made
 * for one face plays on the other.
 *
 * Bones, not deform keys, carry the expressions: a control is the absolute value of its bones, so
 * two controls never fight over one deform timeline, and the weights a bending image (a brow, every
 * mouth shape) has on its bones carry across every image the slot swaps to.
 */

export const part = (
	name: string,
	slot: string,
	size: [number, number],
	required = false,
	bend?: RigTemplateBend,
): RigTemplatePart => ({ name, slot, required, size, ...(bend ? { bend } : {}) });

/** One list for both sides: `_l` is the PICTURE's left, at negative x (`sign` −1). */
export const sides = <T>(f: (s: 'l' | 'r', sign: number) => T[]): T[] => [
	...f('l', -1),
	...f('r', 1),
];

export const MOUTH_SHAPES = ['A', 'E', 'O', 'U', 'MBP', 'FV', 'smile', 'wide'];

/**
 * The mouth shapes Rhubarb Lip Sync answers with (docs/design/rig-templates.md §5.2): A closed
 * (M B P), B clenched teeth (most consonants, EE), C open (EH AE), D wide open (AA), E rounded
 * (AO ER), F puckered (UW OW W), G teeth on lip (F V), H tongue up (L), X at rest.
 */
export const LIPSYNC_SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'] as const;

/** The talk helper's mouth order, shared by the template's `talk` clip. */
const TALK = ['A', 'E', 'O', 'MBP', 'U', 'A', 'FV', 'E', 'wide', 'O', 'MBP', 'A'].map(
	(m) => `mouth_${m}`,
);

const SIDE = { l: 'left', r: 'right' } as const;
/** MediaPipe names blendshapes from the PERFORMER's side: the picture's left is their right. */
const PERFORMER = { l: 'Right', r: 'Left' } as const;

/** A brow bends between its inner end (toward the nose) and its outer end. */
const browBend = (s: 'l' | 'r'): RigTemplateBend => ({
	grid: [5, 2],
	bones: [
		{ bone: `brow_in_${s}`, at: [s === 'l' ? 1 : 0, 0.5] },
		{ bone: `brow_out_${s}`, at: [s === 'l' ? 0 : 1, 0.5] },
	],
});
/** Every mouth image bends on its two corners and both lips. */
const MOUTH_BEND: RigTemplateBend = {
	grid: [7, 5],
	bones: [
		{ bone: 'mouth_corner_l', at: [0, 0.5] },
		{ bone: 'mouth_corner_r', at: [1, 0.5] },
		{ bone: 'lip_upper', at: [0.5, 0.15] },
		{ bone: 'lip_lower', at: [0.5, 0.85] },
	],
};

export interface FaceBlock {
	/** `face` and every bone under it, parents first; `face` hangs on the template's head bone. */
	bones: RigTemplateBone[];
	/** Back to front; they go straight after the template's head and ear slots. */
	slots: RigTemplateSlot[];
	parts: RigTemplatePart[];
	/** The face's controls, plus `head_tilt` (turns the head bone) and `head_turn` (slides the face). */
	channels: RigTemplateChannel[];
	/** The face motion map: the filter, and an entry for every control above. */
	motion: RigMotionFace;
	/** What this face cannot take from a video. */
	cannot: string[];
}

/** The face, built on `head` (a bone of the template), with the face 90 units above it. */
export function faceBlock(head: string): FaceBlock {
	const bones: RigTemplateBone[] = [
		{ name: 'face', parent: head, x: 0, y: 90 },
		...sides<RigTemplateBone>((s, k) => [
			{ name: `brow_${s}`, parent: 'face', x: 45 * k, y: 55 },
			{ name: `brow_in_${s}`, parent: `brow_${s}`, x: -25 * k, y: 0 },
			{ name: `brow_out_${s}`, parent: `brow_${s}`, x: 25 * k, y: 0 },
			{ name: `eye_${s}`, parent: 'face', x: 45 * k, y: 20 },
			{ name: `pupil_${s}`, parent: `eye_${s}`, x: 0, y: 0 },
			{ name: `lid_follow_${s}`, parent: `eye_${s}`, x: 0, y: 0 },
			{ name: `lid_upper_${s}`, parent: `lid_follow_${s}`, x: 0, y: 34 },
			{ name: `lid_lower_${s}`, parent: `eye_${s}`, x: 0, y: -24 },
			{ name: `cheek_${s}`, parent: 'face', x: 72 * k, y: -18 },
		]),
		{ name: 'nose', parent: 'face', x: 0, y: -10 },
		...sides<RigTemplateBone>((s, k) => [
			{ name: `mouth_corner_${s}`, parent: 'face', x: 40 * k, y: -50 },
		]),
		{ name: 'lip_upper', parent: 'face', x: 0, y: -36 },
		{ name: 'jaw', parent: 'face', x: 0, y: -50 },
		{ name: 'lip_lower', parent: 'jaw', x: 0, y: -14 },
	];
	const slots: RigTemplateSlot[] = [
		...sides((s) => [{ name: `cheek_${s}`, bone: `cheek_${s}`, setup: `cheek_${s}` }]),
		...sides((s) => [{ name: `eye_white_${s}`, bone: `eye_${s}`, setup: `eye_white_${s}` }]),
		...sides((s) => [{ name: `pupil_${s}`, bone: `pupil_${s}`, setup: `pupil_${s}` }]),
		...sides((s) => [{ name: `lid_lower_${s}`, bone: `lid_lower_${s}`, setup: `lid_lower_${s}` }]),
		...sides((s) => [{ name: `lid_upper_${s}`, bone: `lid_upper_${s}`, setup: `lid_upper_${s}` }]),
		...sides((s) => [{ name: `eyelid_${s}`, bone: `eye_${s}` }]),
		...sides((s) => [{ name: `brow_${s}`, bone: `brow_${s}`, setup: `brow_${s}_neutral` }]),
		{ name: 'nose', bone: 'nose', setup: 'nose' },
		{ name: 'mouth', bone: 'jaw', setup: 'mouth_rest' },
	];
	const parts: RigTemplatePart[] = [
		...sides((s) => [part(`cheek_${s}`, `cheek_${s}`, [70, 50])]),
		...sides((s) => [part(`eye_white_${s}`, `eye_white_${s}`, [60, 40])]),
		...sides((s) => [part(`pupil_${s}`, `pupil_${s}`, [24, 24])]),
		...sides((s) => [part(`lid_lower_${s}`, `lid_lower_${s}`, [64, 20])]),
		...sides((s) => [part(`lid_upper_${s}`, `lid_upper_${s}`, [64, 30])]),
		...sides((s) => [
			part(`eyelid_${s}_half`, `eyelid_${s}`, [62, 42]),
			part(`eyelid_${s}_closed`, `eyelid_${s}`, [62, 42], true),
		]),
		...sides((s) => [
			part(`brow_${s}_neutral`, `brow_${s}`, [70, 20], true, browBend(s)),
			part(`brow_${s}_up`, `brow_${s}`, [70, 20], false, browBend(s)),
			part(`brow_${s}_angry`, `brow_${s}`, [70, 20], false, browBend(s)),
		]),
		part('nose', 'nose', [40, 50]),
		part('mouth_rest', 'mouth', [90, 40], true, MOUTH_BEND),
		...MOUTH_SHAPES.map((m) =>
			part(`mouth_${m}`, 'mouth', [90, 60], m === 'A' || m === 'O', MOUTH_BEND),
		),
	];
	const both = (bone: (s: 'l' | 'r') => string, prop: RigTemplateDrive['prop'], per: number) =>
		sides<RigTemplateDrive>((s, k) => [{ bone: bone(s), prop, per: prop === 'x' ? per * k : per }]);
	const channels: RigTemplateChannel[] = [
		{
			id: 'mouth',
			label: 'Mouth',
			tip: 'Swap the mouth shape; the jaw opens and the corners and lips move to match it.',
			min: 0,
			max: 1,
			rest: 0,
			shapes: {
				slot: 'mouth',
				jaw: 'jaw',
				rest: 'mouth_rest',
				talk: TALK,
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
				pose: {
					mouth_E: { stretch_l: 0.5, stretch_r: 0.5 },
					mouth_O: { stretch_l: -0.5, stretch_r: -0.5 },
					mouth_U: { stretch_l: -0.8, stretch_r: -0.8 },
					mouth_MBP: { lip_upper: -0.3, lip_lower: -0.4 },
					mouth_FV: { lip_lower: -0.5 },
					mouth_smile: { smile_l: 0.7, smile_r: 0.7, stretch_l: 0.3, stretch_r: 0.3 },
					mouth_wide: { smile_l: 0.4, smile_r: 0.4, stretch_l: 0.6, stretch_r: 0.6 },
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
			tip: 'Drop the jaw: the lower lip comes with it and the mouth stretches open.',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'jaw', prop: 'y', per: -24 }],
		},
		{
			id: 'jaw_side',
			label: 'Jaw sideways',
			tip: 'Shift the jaw toward the picture’s left (−) or right (+).',
			min: -1,
			max: 1,
			rest: 0,
			drives: [{ bone: 'jaw', prop: 'x', per: 10 }],
		},
		...sides<RigTemplateChannel>((s, k) => [
			{
				id: `smile_${s}`,
				label: `Smile ${SIDE[s]}`,
				tip: 'Lift the mouth corner (smile) or pull it down (frown).',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `mouth_corner_${s}`, prop: 'y', per: 10 }],
			},
			{
				id: `stretch_${s}`,
				label: `Stretch ${SIDE[s]}`,
				tip: 'Pull the mouth corner outward (stretch) or in toward the middle (pucker).',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `mouth_corner_${s}`, prop: 'x', per: 10 * k }],
			},
		]),
		{
			id: 'lip_upper',
			label: 'Upper lip',
			tip: 'Raise the upper lip (a sneer, a snarl) or press it down.',
			min: -1,
			max: 1,
			rest: 0,
			drives: [{ bone: 'lip_upper', prop: 'y', per: 8 }],
		},
		{
			id: 'lip_lower',
			label: 'Lower lip',
			tip: 'Drop the lower lip off the teeth (+) or push it up (−).',
			min: -1,
			max: 1,
			rest: 0,
			drives: [{ bone: 'lip_lower', prop: 'y', per: -8 }],
		},
		{
			id: 'sneer',
			label: 'Nose sneer',
			tip: 'Wrinkle the nose up.',
			min: 0,
			max: 1,
			rest: 0,
			drives: [{ bone: 'nose', prop: 'y', per: 6 }],
		},
		...sides<RigTemplateChannel>((s) => [
			{
				id: `cheek_${s}`,
				label: `Cheek ${SIDE[s]}`,
				tip: 'Push the cheek up, as a real smile or a squint does.',
				min: 0,
				max: 1,
				rest: 0,
				drives: [{ bone: `cheek_${s}`, prop: 'y', per: 10 }],
			},
		]),
		{
			id: 'puff',
			label: 'Cheeks puff',
			tip: 'Puff both cheeks outward.',
			min: 0,
			max: 1,
			rest: 0,
			drives: both((s) => `cheek_${s}`, 'x', 8),
		},
		...sides<RigTemplateChannel>((s) => [
			{
				id: `blink_${s}`,
				label: `Blink ${SIDE[s]}`,
				tip: 'The upper lid comes down; ½ shows the half-closed image, 1 the closed one. Below 0 opens the eye wide.',
				min: -0.3,
				max: 1,
				rest: 0,
				drives: [{ bone: `lid_upper_${s}`, prop: 'y', per: -30 }],
				slot: `eyelid_${s}`,
				swaps: [
					{ at: -0.3, part: null },
					{ at: 0.34, part: `eyelid_${s}_half` },
					{ at: 0.67, part: `eyelid_${s}_closed` },
				],
			},
		]),
		...sides<RigTemplateChannel>((s) => [
			{
				id: `squint_${s}`,
				label: `Squint ${SIDE[s]}`,
				tip: 'Push the lower lid up.',
				min: 0,
				max: 1,
				rest: 0,
				drives: [{ bone: `lid_lower_${s}`, prop: 'y', per: 12 }],
			},
		]),
		...sides<RigTemplateChannel>((s) => [
			{
				id: `brow_${s}`,
				label: `Brow ${SIDE[s]}`,
				tip: 'Down to angry, up to raised; swaps the brow image at the ends.',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `brow_${s}`, prop: 'y', per: 16 }],
				slot: `brow_${s}`,
				swaps: [
					{ at: -1, part: `brow_${s}_angry` },
					{ at: -0.6, part: `brow_${s}_neutral` },
					{ at: 0.6, part: `brow_${s}_up` },
				],
			},
		]),
		...sides<RigTemplateChannel>((s) => [
			{
				id: `brow_in_${s}`,
				label: `Inner brow ${SIDE[s]}`,
				tip: 'Lift the brow’s inner end (worried) or knit it down (angry).',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `brow_in_${s}`, prop: 'y', per: 8 }],
			},
			{
				id: `brow_out_${s}`,
				label: `Outer brow ${SIDE[s]}`,
				tip: 'Lift or drop the brow’s outer end.',
				min: -1,
				max: 1,
				rest: 0,
				drives: [{ bone: `brow_out_${s}`, prop: 'y', per: 8 }],
			},
		]),
		{
			id: 'gaze_x',
			label: 'Look left / right',
			tip: 'Move both pupils sideways.',
			min: -1,
			max: 1,
			rest: 0,
			drives: sides<RigTemplateDrive>((s) => [{ bone: `pupil_${s}`, prop: 'x', per: 14 }]),
		},
		{
			id: 'gaze_y',
			label: 'Look down / up',
			tip: 'Move both pupils up or down; the upper lids follow a little.',
			min: -1,
			max: 1,
			rest: 0,
			drives: sides<RigTemplateDrive>((s) => [
				{ bone: `pupil_${s}`, prop: 'y', per: 8 },
				{ bone: `lid_follow_${s}`, prop: 'y', per: 4 },
			]),
		},
		{
			id: 'head_tilt',
			label: 'Head tilt',
			tip: 'Degrees; positive tilts counter-clockwise.',
			min: -20,
			max: 20,
			rest: 0,
			drives: [{ bone: head, prop: 'rotate', per: 1 }],
		},
		{
			id: 'head_turn',
			label: 'Head turn',
			tip: 'Slide the face inside the head for a small turn; reads best once the head is a mesh.',
			min: -1,
			max: 1,
			rest: 0,
			drives: [{ bone: 'face', prop: 'x', per: 20 }],
		},
	];
	const motion: FaceMotionEntry[] = [
		{
			kind: 'shape',
			channel: 'mouth',
			group: 'mouth',
			hold: 0.08,
			features: {
				open: ['jawOpen'],
				round: ['mouthFunnel', 'mouthPucker'],
				smile: ['mouthSmileLeft', 'mouthSmileRight'],
				wide: ['mouthStretchLeft', 'mouthStretchRight'],
				press: ['mouthPressLeft', 'mouthPressRight', 'mouthClose'],
				roll: ['mouthRollLower'],
			},
			// Against the performer's neutral and at speech size: a filmed talker's jawOpen rises only
			// about 0.05–0.15 above their neutral (measured on real footage), so the shapes sit there.
			shapes: {
				mouth_rest: {},
				mouth_A: { open: 0.15 },
				mouth_E: { open: 0.06, wide: 0.04 },
				mouth_O: { open: 0.08, round: 0.15 },
				mouth_U: { round: 0.2 },
				mouth_MBP: { press: 0.15 },
				mouth_FV: { roll: 0.3 },
				mouth_smile: { smile: 0.3 },
				mouth_wide: { open: 0.1, smile: 0.25 },
			},
		},
		{ kind: 'blend', channel: 'jaw', group: 'mouth', plus: ['jawOpen'], gain: 4 },
		{
			kind: 'blend',
			channel: 'jaw_side',
			group: 'mouth',
			plus: ['jawLeft'],
			minus: ['jawRight'],
			gain: 3,
		},
		...sides<FaceMotionEntry>((s) => {
			const p = PERFORMER[s];
			return [
				{
					kind: 'blend',
					channel: `smile_${s}`,
					group: 'mouth',
					plus: [`mouthSmile${p}`],
					minus: [`mouthFrown${p}`],
					gain: 2,
				},
				{
					kind: 'blend',
					channel: `stretch_${s}`,
					group: 'mouth',
					plus: [`mouthStretch${p}`, `mouthDimple${p}`],
					minus: ['mouthPucker', 'mouthFunnel'],
					gain: 3,
				},
			];
		}),
		{
			kind: 'blend',
			channel: 'lip_upper',
			group: 'mouth',
			plus: ['mouthUpperUpLeft', 'mouthUpperUpRight', 'mouthShrugUpper'],
			minus: ['mouthRollUpper'],
			gain: 2,
		},
		{
			kind: 'blend',
			channel: 'lip_lower',
			group: 'mouth',
			plus: ['mouthLowerDownLeft', 'mouthLowerDownRight'],
			minus: ['mouthRollLower', 'mouthShrugLower'],
			gain: 2,
		},
		// MediaPipe scores noseSneer, cheekSquint and cheekPuff near zero on real faces, so the sneer
		// also reads the upper lip it lifts, and the cheeks the squint and smile that push them up.
		{
			kind: 'blend',
			channel: 'sneer',
			group: 'mouth',
			plus: ['noseSneerLeft', 'noseSneerRight', 'mouthUpperUpLeft', 'mouthUpperUpRight'],
			gain: 2,
		},
		...sides<FaceMotionEntry>((s) => [
			{
				kind: 'blend',
				channel: `cheek_${s}`,
				group: 'eyes',
				plus: [`cheekSquint${PERFORMER[s]}`, `eyeSquint${PERFORMER[s]}`, `mouthSmile${PERFORMER[s]}`],
				gain: 2,
			},
		]),
		{ kind: 'blend', channel: 'puff', group: 'mouth', plus: ['cheekPuff'], gain: 2 },
		...sides<FaceMotionEntry>((s) => [
			{
				kind: 'blend',
				channel: `blink_${s}`,
				group: 'eyes',
				plus: [`eyeBlink${PERFORMER[s]}`],
				minus: [`eyeWide${PERFORMER[s]}`],
				gain: 2.4,
			},
			{
				kind: 'blend',
				channel: `squint_${s}`,
				group: 'eyes',
				plus: [`eyeSquint${PERFORMER[s]}`],
				gain: 2.5,
			},
		]),
		...sides<FaceMotionEntry>((s) => {
			const p = PERFORMER[s];
			return [
				{
					kind: 'blend',
					channel: `brow_${s}`,
					group: 'brows',
					plus: [`browOuterUp${p}`, 'browInnerUp'],
					minus: [`browDown${p}`],
					gain: 2.5,
				},
				{
					kind: 'blend',
					channel: `brow_in_${s}`,
					group: 'brows',
					plus: ['browInnerUp'],
					minus: [`browOuterUp${p}`, `browDown${p}`],
					gain: 2,
				},
				{
					kind: 'blend',
					channel: `brow_out_${s}`,
					group: 'brows',
					plus: [`browOuterUp${p}`],
					minus: ['browInnerUp'],
					gain: 1.5,
				},
			];
		}),
		{
			kind: 'blend',
			channel: 'gaze_x',
			group: 'gaze',
			plus: ['eyeLookOutLeft', 'eyeLookInRight'],
			minus: ['eyeLookInLeft', 'eyeLookOutRight'],
			gain: 2,
		},
		{
			kind: 'blend',
			channel: 'gaze_y',
			group: 'gaze',
			plus: ['eyeLookUpLeft', 'eyeLookUpRight'],
			minus: ['eyeLookDownLeft', 'eyeLookDownRight'],
			gain: 2,
		},
		// The outer eye corners (33 = the performer's right, 263 = left) and the nose tip (1).
		{
			kind: 'angle',
			channel: 'head_tilt',
			group: 'head',
			from: 33,
			to: 263,
			gain: 1,
			rest: 'neutral',
		},
		{
			kind: 'offset',
			channel: 'head_turn',
			group: 'head',
			point: 1,
			between: [33, 263],
			axis: 'x',
			gain: 4,
		},
	];
	return {
		bones,
		slots,
		parts,
		channels,
		motion: { smooth: 0.08, follow: 4, entries: motion },
		cannot: [
			'Turns wider than the face slide inside the head; a ¾ view needs its own drawing.',
			'Cheek puff and the nose sneer: the tracker barely scores them, so they read from the squint, the smile and the upper lip.',
		],
	};
}
