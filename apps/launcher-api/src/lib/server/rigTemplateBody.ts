import type { RigMotionMap } from '../rigMotion';
import type { Bone3dMotion, FollowLimb, FollowMark } from '../rigMotion3d';
import { VIEW_SUFFIXES } from '../rig3dViews';
import { faceBlock, part, sides } from './rigTemplateFace';
import type {
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplatePart,
	RigTemplateSlot,
} from './rigTemplates';

/**
 * The pieces the built-in templates are made of (docs/design/rig-modules.md §5): each defined once,
 * sized by the template that has it. A template lists its pieces in its own order — bones parents
 * first, slots back to front, controls as the Controls section shows them — so writing a built-in
 * from pieces changes none of it (`rig-template-presets.mjs` holds every built-in to its snapshot).
 */

/**
 * A part's drawings by angle (rig-2p5d §4.7, P5), all optional: ¾ and side either way (`_3q_r`,
 * `_side_r`: made for the part turned toward the picture's right), and the ¾-back and back views a
 * full turnaround shows. Named after `base`; each fills the same slot as the part.
 */
export const angleParts = (base: string, slot: string, size: [number, number]): RigTemplatePart[] =>
	Object.values(VIEW_SUFFIXES).map((v) => part(`${base}_${v}`, slot, size));

/** The neck's bones, base first: what a turn of the neck is shared by. */
export const NECK_BONES = ['neck', 'neck_upper'] as const;

/**
 * The neck (§3.6): `neck` on the chest at the collar (`at` up the chest bone), `neck_upper`
 * halfway up its `length`, the head on that. A turn of the neck is shared by the two, so it bends
 * rather than swinging stiff from the collar, and its drawing is skinned across both. `neck_upper`
 * came later: a `link`.
 */
export function neck(
	at: number,
	length: number,
	size: [number, number],
): { bones: RigTemplateBone[]; slot: RigTemplateSlot; part: RigTemplatePart } {
	return {
		bones: [
			{ name: 'neck', parent: 'chest', x: 0, y: at },
			{ name: 'neck_upper', parent: 'neck', x: 0, y: length / 2, link: true },
			{ name: 'head', parent: 'neck_upper', x: 0, y: length / 2 },
		],
		slot: { name: 'neck', bone: 'neck', setup: 'neck' },
		part: part('neck', 'neck', size),
	};
}

/** The Head nod control: degrees, the neck's turn shared by its bones. */
export const HEAD_NOD: RigTemplateChannel = {
	id: 'head_nod',
	label: 'Head nod',
	tip: 'Degrees, turned along the neck.',
	min: -10,
	max: 10,
	rest: 0,
	drives: NECK_BONES.map((bone) => ({ bone, prop: 'rotate' as const, per: 1 / NECK_BONES.length })),
};

/** The face block on `head`: the head turn's parallax and a head up / down control (§5.4). */
export const FACE = faceBlock('head', { back: ['hair_back'], front: ['hair_front'] });

/** A head with the face block on it; its slots and parts go in two places in the draw order. */
export interface FaceHead {
	/** After the neck's `head`: the head's image bone, the back hair, the face block, the fringe. */
	bones: RigTemplateBone[];
	/** Behind the body: the back hair. */
	back: { slots: RigTemplateSlot[]; parts: RigTemplatePart[] };
	/** In front of the body and the neck: the head, its ears, the face block, the fringe. */
	front: { slots: RigTemplateSlot[]; parts: RigTemplatePart[] };
	/** The head's drawings by angle. */
	angles: RigTemplatePart[];
	/** Its parts in depth (z toward the viewer, rig units). */
	depths: Record<string, number>;
	/** Its draw-order layer. */
	layers: Record<string, string[]>;
	/** The head turned by the face's 3D pose; its outline and the back hair square to the viewer. */
	bones3d: Bone3dMotion[];
	/** The face's 2D controls a 3D import leaves to the head's turn and the parts' depth. */
	replaces: string[];
	/** What a 3D import cannot turn it to. */
	cannot3d: string;
	/**
	 * Following positions (§5.8): the face's eyes (Face Landmarker's corners, the picture's left eye
	 * first) and mouth corners, on the face block's bones.
	 */
	marks: FollowMark[];
}

/**
 * The head Bust with face and Half body share, about 260 units wide: its outline on an image bone
 * of its own, the ears, the face block (`rigTemplateFace.ts`), the back hair and the fringe.
 */
export const FACE_HEAD: FaceHead = {
	bones: [
		{ name: 'head_image', parent: 'head', x: 0, y: 0 },
		{ name: 'hair_back', parent: 'head', x: 0, y: 120 },
		...FACE.bones,
		{ name: 'hair_front', parent: 'head', x: 0, y: 150 },
	],
	back: {
		slots: [{ name: 'hair_back', bone: 'hair_back', setup: 'hair_back' }],
		parts: [part('hair_back', 'hair_back', [300, 300])],
	},
	front: {
		slots: [
			{ name: 'head', bone: 'head_image', setup: 'head' },
			...sides((s) => [{ name: `ear_${s}`, bone: 'head', setup: `ear_${s}` }]),
			...FACE.slots,
			{ name: 'hair_front', bone: 'hair_front', setup: 'hair_front' },
		],
		parts: [
			part('head', 'head', [260, 300], true),
			...sides((s) => [part(`ear_${s}`, `ear_${s}`, [50, 80])]),
			...FACE.parts,
			part('hair_front', 'hair_front', [300, 200]),
		],
	},
	angles: angleParts('head', 'head', [260, 300]),
	// The face 95 in front of the head's middle (a 25° turn slides it 40 units, as a round head's
	// features move), the nose further, the cheeks and mouth corners round the sides, the fringe in
	// front and the back hair behind.
	depths: {
		face: 95,
		nose: 25,
		cheek_l: -25,
		cheek_r: -25,
		mouth_corner_l: -10,
		mouth_corner_r: -10,
		hair_front: 100,
		hair_back: -100,
	},
	// Its outline, ears, the face's parts and the fringe move in depth as one (a hand passes in front
	// of the whole face or behind it), so a turned head does not reorder its left and right eyes,
	// which never overlap.
	layers: {
		head: ['head', 'ear_l', 'ear_r', ...FACE.slots.map((x) => x.name), 'hair_front'],
	},
	bones3d: [
		{ kind: 'bone3d', bone: 'head', face: 'matrix' },
		{ kind: 'bone3d', bone: 'head_image', viewer: 'square' },
		{ kind: 'bone3d', bone: 'hair_back', viewer: 'square' },
	],
	replaces: ['head_tilt', 'head_turn', 'head_pitch'],
	cannot3d:
		'A head turned past about 40°: the face slides toward the edge of a round head; a ¾ or profile head is its drawing by angle (head_3q_*, head_side_*).',
	marks: [
		{ point: { face: [33, 133] }, bone: 'eye_l' },
		{ point: { face: [362, 263] }, bone: 'eye_r' },
		{ point: { face: [61] }, bone: 'mouth_corner_l' },
		{ point: { face: [291] }, bone: 'mouth_corner_r' },
	],
};

type Side = 'l' | 'r';
/** An entry of a template's body motion map. */
export type BodyMotionEntryOf = NonNullable<RigMotionMap['body']>['entries'][number];

export const SIDE = { l: 'left', r: 'right' } as const;
/** The side as a label's first word. */
const SIDE_FIRST = { l: 'Left', r: 'Right' } as const;

/** Pose points per side, `l` the picture's left (the performer's right). */
export const POSE_SIDE = {
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
export const SHOULDERS: [number, number] = [11, 12];
export const HIPS: [number, number] = [23, 24];

/** How short a limb may get pointing at the camera: 0.3 of its length (a shorter one stops reading). */
const FORESHORTEN_FLOOR = 0.3;

/**
 * A limb shortening toward or away from the camera: `bone` scales along the limb (its image, or a
 * hand with its fingers) and the next joint, `next`, comes in with it.
 */
export function shortening(
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

/**
 * How far an elbow folds either way in the picture, in degrees. A hinge in 3D, but drawn flat it
 * bends both ways: which way the forearm turns on screen depends on how the upper arm is rolled,
 * an axis a 2D bone does not have. On real footage a hanging arm bends inward (the hand in front of
 * the body) on 58–100% of frames, by up to about 165° (rig templates §5.5).
 */
const ELBOW_REACH = 168;

/** A template's arms: their proportions, and what their controls say. */
export interface ArmDims {
	/** A collarbone at `at` on the chest, its shoulder image `size`; none = the arm on the chest. */
	clavicle?: { at: [number, number]; size: [number, number] };
	/** Where the upper arm hangs, on the collarbone or the chest (x out from the middle). */
	shoulder: [number, number];
	/** The upper arm's and the forearm's lengths. */
	upper: number;
	lower: number;
	/** The upper arm's and the forearm's placeholder sizes. */
	sizes: [[number, number], [number, number]];
	/** Raise arm: how far below 0 it goes, and what it does there. */
	raise: { min: number; below: string };
	/** Bend elbow: degrees at 1, and what it does either way. */
	elbow: { per: number; fold: string };
	/** A Reach control, the arm pointed toward the camera (in depth: `reachSets`). */
	reach?: true;
}

/**
 * The arms, per side (`k` the side's sign; x mirrors): the upper arm, the forearm and the bone at
 * the wrist the hands draw on, from a collarbone when there is one (Shrug lifts it). Raise arm and
 * Bend elbow turn them, read from the pose's shoulder, elbow and wrist. The depth stage (§5.4) adds
 * each segment shortening on an image bone of its own, the arm passing behind the head or the body,
 * and the arm in 3D, placed by its shoulder and reaching for the tracked wrist.
 */
export function arms(d: ArmDims) {
	const c = d.clavicle;
	/** The segments' images: each shortens on a bone of its own, and goes behind with the arm. */
	const images = (s: Side) => [`upper_arm_${s}`, `lower_arm_${s}`];
	return {
		bones: (s: Side, k: number): RigTemplateBone[] => [
			...(c ? [{ name: `clavicle_${s}`, parent: 'chest', x: c.at[0] * k, y: c.at[1] }] : []),
			{
				name: `upper_arm_${s}`,
				parent: c ? `clavicle_${s}` : 'chest',
				x: d.shoulder[0] * k,
				y: d.shoulder[1],
			},
			{ name: `lower_arm_${s}`, parent: `upper_arm_${s}`, x: 0, y: -d.upper },
			{ name: `hand_${s}`, parent: `lower_arm_${s}`, x: 0, y: -d.lower },
		],
		slots: (s: Side): RigTemplateSlot[] => [
			...(c ? [{ name: `shoulder_${s}`, bone: `clavicle_${s}`, setup: `shoulder_${s}` }] : []),
			{ name: `upper_arm_${s}`, bone: `upper_arm_${s}`, setup: `upper_arm_${s}` },
			{ name: `lower_arm_${s}`, bone: `lower_arm_${s}`, setup: `lower_arm_${s}` },
		],
		parts: (s: Side): RigTemplatePart[] => [
			...(c ? [part(`shoulder_${s}`, `shoulder_${s}`, c.size)] : []),
			part(`upper_arm_${s}`, `upper_arm_${s}`, d.sizes[0], true),
			part(`lower_arm_${s}`, `lower_arm_${s}`, d.sizes[1], true),
		],
		channels: (s: Side, k: number): RigTemplateChannel[] => [
			...(c
				? [
						{
							id: `shrug_${s}`,
							label: `Shrug ${SIDE[s]}`,
							tip: 'Lift the shoulder; below 0 drops it.',
							min: -0.3,
							max: 1,
							rest: 0,
							drives: [{ bone: `clavicle_${s}`, prop: 'rotate' as const, per: 15 * k }],
						},
					]
				: []),
			{
				id: `arm_${s}`,
				label: `Raise ${SIDE[s]} arm`,
				tip: `0 hangs down, 1 points up and out; below 0 ${d.raise.below}.`,
				min: d.raise.min,
				max: 1,
				rest: 0,
				drives: [{ bone: `upper_arm_${s}`, prop: 'rotate', per: 150 * k }],
			},
			...(d.reach
				? [
						{
							id: `reach_${s}`,
							label: `Reach ${SIDE[s]} arm`,
							tip: 'Point the arm toward the camera: the arm shortens, and so does the hand.',
							min: 0,
							max: 1,
							rest: 0,
							drives: [{ bone: `upper_arm_${s}`, prop: 'scaleY' as const, per: -0.5 }],
						},
					]
				: []),
			{
				id: `elbow_${s}`,
				label: `Bend ${SIDE[s]} elbow`,
				tip: `Fold the forearm: ${d.elbow.fold}. 1 = ${d.elbow.per}°.`,
				min: -ELBOW_REACH / d.elbow.per,
				max: ELBOW_REACH / d.elbow.per,
				rest: 0,
				drives: [{ bone: `lower_arm_${s}`, prop: 'rotate', per: d.elbow.per * k }],
			},
		],
		motion: (s: Side): BodyMotionEntryOf[] => {
			const p = POSE_SIDE[s];
			return [
				...(c
					? [
							{
								kind: 'bone' as const,
								channel: `shrug_${s}`,
								bone: `clavicle_${s}`,
								from: [11, 12] as [number, number],
								to: p.shoulder,
								minSpan: 0.3,
							},
						]
					: []),
				{
					kind: 'bone',
					channel: `arm_${s}`,
					bone: `upper_arm_${s}`,
					from: p.shoulder,
					to: p.elbow,
				},
				{ kind: 'bone', channel: `elbow_${s}`, bone: `lower_arm_${s}`, from: p.elbow, to: p.wrist },
			];
		},
		images,
		shorten: (t: { bones: RigTemplateBone[] }, s: Side): RigTemplateChannel[] => [
			shortening(
				t,
				`fore_upper_arm_${s}`,
				`Shorten ${SIDE[s]} upper arm`,
				`upper_arm_${s}_image`,
				`lower_arm_${s}`,
			),
			shortening(
				t,
				`fore_lower_arm_${s}`,
				`Shorten ${SIDE[s]} forearm`,
				`lower_arm_${s}_image`,
				`hand_${s}`,
			),
			shortening(t, `fore_hand_${s}`, `Shorten ${SIDE[s]} hand`, `hand_${s}`, null),
		],
		/** Reach in depth: the whole arm shortening, by the segments' own controls. */
		reachSets: (s: Side): RigTemplateChannel => ({
			id: `reach_${s}`,
			label: `Reach ${SIDE[s]} arm`,
			tip: 'Point the whole arm toward the camera: the upper arm, forearm and hand shorten together.',
			min: 0,
			max: 1,
			rest: 0,
			sets: [
				{ channel: `fore_upper_arm_${s}`, per: 1 - FORESHORTEN_FLOOR },
				{ channel: `fore_lower_arm_${s}`, per: 1 - FORESHORTEN_FLOOR },
				{ channel: `fore_hand_${s}`, per: 0.4 },
			],
		}),
		/**
		 * The shortening, read from the pose's 3D points (its own hand points: cleaner than the hand
		 * model's).
		 */
		foreshorten: (s: Side): BodyMotionEntryOf[] => {
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
		},
		/** The arm in depth, with its hand's slots `hand`: in front, behind the head or the body. */
		depth: (s: Side, hand: string[]): RigTemplateChannel => ({
			id: `depth_${s}`,
			label: `${SIDE_FIRST[s]} arm depth`,
			tip: '0 in front of the body, 1 behind the head, 2 behind the body: keyed as the draw order.',
			min: 0,
			max: 2,
			rest: 0,
			order: {
				slots: [...images(s), ...hand],
				steps: [
					{ at: 1, behind: 'head' },
					{ at: 2, behind: 'torso' },
				],
			},
		}),
		/**
		 * The arm in 3D: the upper arm, the forearm and the hand each along their points (the hand to
		 * the middle of its knuckles, in the picture Hand Landmarker's where it finds that hand),
		 * rolled about their length to face the viewer — a limb looks the same from any side, its card
		 * never turns edge-on while the arm bends, and the hand's own roll (palm or back to the camera)
		 * reads on the tracker's 4 cm knuckle line at about 15° of jitter, which turned it through
		 * edge-on 36 times in 30 s of real footage. That turn is drawings by angle's (2.5D P5). The
		 * limbs' images lie flat on them. A collarbone turns from the shoulders' middle to its
		 * shoulder.
		 */
		bones3d: (s: Side): Bone3dMotion[] => {
			const p = POSE_SIDE[s];
			return [
				...(c
					? [
							{
								kind: 'bone3d',
								bone: `clavicle_${s}`,
								pose: { from: SHOULDERS, to: p.shoulder },
							} as const,
						]
					: []),
				{
					kind: 'bone3d',
					bone: `upper_arm_${s}`,
					pose: { from: p.shoulder, to: p.elbow },
					roll: 'viewer',
				},
				{
					kind: 'bone3d',
					bone: `lower_arm_${s}`,
					pose: { from: p.elbow, to: p.wrist },
					roll: 'viewer',
				},
				{
					kind: 'bone3d',
					bone: `hand_${s}`,
					pose: { from: p.wrist, to: p.knuckles, hand: { side: s, from: 0, to: [5, 17] } },
					rest: [0, -1],
					roll: 'viewer',
				},
			];
		},
		/** The body placed by the tracked shoulder. */
		anchor: (s: Side): FollowMark => ({
			point: { pose: POSE_SIDE[s].shoulder },
			bone: `upper_arm_${s}`,
		}),
		/** The arm reaching the tracked wrist (the hand model's where it found the hand on it). */
		follow: (s: Side): FollowLimb => {
			const p = POSE_SIDE[s];
			return {
				upper: `upper_arm_${s}`,
				lower: `lower_arm_${s}`,
				end: `hand_${s}`,
				points: [p.shoulder, p.elbow, p.wrist],
				hand: s,
				pole: `elbow_pole_${s}`,
			};
		},
	};
}
