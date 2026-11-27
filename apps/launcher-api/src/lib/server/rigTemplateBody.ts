import type { Bone3dMotion, FollowMark } from '../rigMotion3d';
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
 * The neck (§3.6): `neck` on the chest at the collar (`at` up the chest bone), `neck_upper` halfway
 * up its `length`, the head on that. A turn of the neck is shared by the two, so it bends rather than
 * swinging stiff from the collar, and its drawing is skinned across both. `neck_upper` came later: a
 * `link`.
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
 * The head Bust with face and Half body share, about 260 units wide: its outline on an image bone of
 * its own, the ears, the face block (`rigTemplateFace.ts`), the back hair and the fringe.
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
