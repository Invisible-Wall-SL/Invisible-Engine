/**
 * A small 2D rig with a control layer, for the `controls.json` checks (`check-rig-controls.ts`,
 * `check-rigger-writes.ts`): an arm on a chest with an IK hand control (chest and world spaces, an
 * elbow pole) at setup mix 0, a head aimed at a look control, and the `controls.json` that makes those
 * bones controls — every field of docs/design/rig-controls.md §5.7 used once.
 */
import type { ControlsDoc } from '../../src/lib/rigControls.ts';

const region = (x: number, width: number, height: number) => ({ x, y: 0, width, height });

/** Every region the rig draws, for an atlas. */
export const REGIONS = ['torso', 'upper_arm', 'lower_arm', 'hand', 'head'];

/** The rig as the Rigger stores it: control bones carry no slot, the IK is off until a clip. */
export function controlsIrig(): Record<string, unknown> {
	return {
		irig: 1,
		skeleton: {
			hash: 'controls-fixture',
			importedFrom: '4.2',
			x: -400,
			y: -400,
			width: 800,
			height: 800,
		},
		bones: [
			{ name: 'root' },
			{ name: 'chest', parent: 'root', y: 100 },
			{ name: 'upper_arm_l', parent: 'chest', length: 120, x: 80, y: 100, rotation: -90 },
			{ name: 'lower_arm_l', parent: 'upper_arm_l', length: 100, x: 120 },
			{ name: 'hand_l', parent: 'lower_arm_l', length: 40, x: 100 },
			{ name: 'head', parent: 'chest', length: 60, y: 260, rotation: 90 },
			{ name: 'hand_ik_l', parent: 'root', x: 80, y: -20 },
			{ name: 'elbow_pole_l', parent: 'root', x: 200, y: 100 },
			{ name: 'space_chest_hand_l', parent: 'chest', x: 80, y: -120 },
			{ name: 'space_world_hand_l', parent: 'root', x: 80, y: -20 },
			{ name: 'look', parent: 'root', x: 300, y: 380 },
		],
		slots: [
			{ name: 'torso', bone: 'chest', attachment: 'torso' },
			{ name: 'upper_arm', bone: 'upper_arm_l', attachment: 'upper_arm' },
			{ name: 'lower_arm', bone: 'lower_arm_l', attachment: 'lower_arm' },
			{ name: 'hand', bone: 'hand_l', attachment: 'hand' },
			{ name: 'head', bone: 'head', attachment: 'head' },
		],
		// Solve order: the spaces, then the IK, then the aim (§4.6).
		ik: [
			{
				name: 'arm_ik_l',
				order: 2,
				bones: ['upper_arm_l', 'lower_arm_l'],
				target: 'hand_ik_l',
				mix: 0,
			},
			{ name: 'head_aim', order: 3, bones: ['head'], target: 'look' },
		],
		transform: [
			{
				name: 'hand_l_in_chest',
				order: 0,
				bones: ['hand_ik_l'],
				target: 'space_chest_hand_l',
				mixScaleX: 0,
				mixShearY: 0,
			},
			{
				name: 'hand_l_in_world',
				order: 1,
				bones: ['hand_ik_l'],
				target: 'space_world_hand_l',
				mixRotate: 0,
				mixX: 0,
				mixScaleX: 0,
				mixShearY: 0,
			},
		],
		skins: [
			{
				name: 'default',
				attachments: {
					torso: { torso: region(0, 180, 260) },
					upper_arm: { upper_arm: region(60, 120, 36) },
					lower_arm: { lower_arm: region(50, 100, 30) },
					hand: { hand: region(20, 40, 32) },
					head: { head: region(30, 60, 80) },
				},
			},
		],
		animations: {
			// FK: the arm waves, the chest breathes, the look target drifts.
			wave: {
				bones: {
					chest: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 6 },
						],
					},
					upper_arm_l: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 0.5, value: 50 },
							{ time: 1, value: 10 },
						],
					},
					lower_arm_l: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 70 },
						],
					},
					look: {
						translate: [
							{ time: 0, x: 0, y: 0 },
							{ time: 1, x: -120, y: 30 },
						],
					},
				},
			},
			// IK: the hand control moves (in chest space, so its space bone is keyed) and the arm
			// switches to IK, stepped, half way.
			reach: {
				bones: {
					space_chest_hand_l: {
						translate: [
							{ time: 0, x: 0, y: 0 },
							{ time: 1, x: 60, y: 100 },
						],
					},
				},
				ik: {
					arm_ik_l: [
						{ time: 0, mix: 0, curve: 'stepped' },
						{ time: 0.5, mix: 1 },
					],
				},
			},
		},
	};
}

/** The rig's control layer: every field of §5.7, once. */
export function controlsOf(stem: string): ControlsDoc {
	return {
		controls: 1,
		rig: stem,
		bones: {
			hand_ik_l: {
				role: 'control',
				shape: 'square',
				colour: '#e8b04a',
				size: 14,
				channels: ['translate', 'rotate'],
				layer: 'Body IK',
			},
			elbow_pole_l: { role: 'control', shape: 'diamond', size: 8, layer: 'Body IK' },
			upper_arm_l: {
				shape: 'ring',
				size: 40,
				sizeIn: 'rig',
				lineWidth: 2,
				layer: 'Body FK',
				limits: { rotate: [-170, 60] },
			},
			lower_arm_l: { shape: 'ring', size: 30, layer: 'Body FK', limits: { rotate: [0, 150] } },
			look: {
				role: 'control',
				shape: 'arrow',
				ways: 4,
				filled: true,
				offset: [0, 10],
				turn: 45,
				display: 'both',
				layer: 'Face',
				limits: { x: [-200, 200], y: [-100, 100] },
			},
			head: {
				shape: 'polyline',
				points: [
					[0, -20],
					[60, 0],
					[0, 20],
				],
				locked: true,
				layer: 'Face',
			},
			chest: { shape: 'box', axes: 2, display: 'picker', limits: { scaleX: [0.8, 1.2] } },
			space_chest_hand_l: { role: 'helper', hidden: true, layer: 'Helpers' },
			space_world_hand_l: { role: 'helper', hidden: true, layer: 'Helpers' },
		},
		layers: [
			{ name: 'Body FK', visible: true, locked: false },
			{ name: 'Body IK', visible: true },
			{ name: 'Face' },
			{ name: 'Helpers', visible: false, locked: true },
		],
		sets: { hands: ['hand_ik_l', 'hand_l'], arm_l: ['upper_arm_l', 'lower_arm_l', 'hand_l'] },
		limbs: {
			arm_l: {
				ik: 'arm_ik_l',
				fk: ['upper_arm_l', 'lower_arm_l'],
				control: 'hand_ik_l',
				pole: 'elbow_pole_l',
				spaces: {
					chest: { bone: 'space_chest_hand_l', constraint: 'hand_l_in_chest' },
					world: { bone: 'space_world_hand_l', constraint: 'hand_l_in_world' },
				},
			},
		},
		presets: { head_aim: 'aim', arm_ik_l: 'twoBoneIk', hand_l_in_chest: 'childOf' },
		mirror: { line: 'root', pairs: { hand_ik_l: 'hand_ik_l' } },
		picker: {
			items: [
				{ bone: 'hand_ik_l', at: [0.2, 0.55], label: 'Hand L' },
				{ set: 'hands', at: [0.5, 0.9] },
				{ limb: 'arm_l', at: [0.2, 0.4], label: 'IK / FK' },
			],
		},
		slotFolders: { arm: ['upper_arm', 'lower_arm', 'hand'], face: ['head'] },
	};
}

/**
 * The rig as the Rigger's ✎ rename leaves it (`renameBone` in static/rigger/view.html): the bone
 * renamed in place, and every parent, slot, constraint and timeline that named it rewritten.
 */
export function renamedBone(doc: Record<string, unknown>, from: string, to: string) {
	const out = structuredClone(doc) as {
		bones: { name: string; parent?: string }[];
		slots?: { bone: string }[];
		animations?: Record<string, { bones?: Record<string, unknown> }>;
	} & Record<string, unknown>;
	for (const b of out.bones) {
		if (b.name === from) b.name = to;
		if (b.parent === from) b.parent = to;
	}
	for (const s of out.slots ?? []) if (s.bone === from) s.bone = to;
	for (const kind of ['ik', 'transform', 'path', 'physics'])
		for (const c of (out[kind] ?? []) as Record<string, unknown>[]) {
			if (Array.isArray(c.bones)) c.bones = c.bones.map((n: string) => (n === from ? to : n));
			if (c.target === from) c.target = to;
			if (c.bone === from) c.bone = to;
		}
	for (const anim of Object.values(out.animations ?? {}))
		if (anim.bones && Object.hasOwn(anim.bones, from)) {
			anim.bones[to] = anim.bones[from];
			delete anim.bones[from];
		}
	return out;
}

/** The rig as renaming one constraint leaves it: in place, its timelines moved with it. */
export function renamedConstraint(
	doc: Record<string, unknown>,
	kind: 'ik' | 'transform' | 'path' | 'physics',
	from: string,
	to: string,
) {
	const out = structuredClone(doc) as Record<string, unknown> & {
		animations?: Record<string, Record<string, Record<string, unknown>>>;
	};
	for (const c of (out[kind] ?? []) as { name: string }[]) if (c.name === from) c.name = to;
	for (const anim of Object.values(out.animations ?? {}))
		if (anim[kind] && Object.hasOwn(anim[kind], from)) {
			anim[kind][to] = anim[kind][from];
			delete anim[kind][from];
		}
	return out;
}

/** The rig with a bone deleted as the Rigger deletes one with no children and no slot. */
export function deletedBone(doc: Record<string, unknown>, name: string) {
	const out = structuredClone(doc) as {
		bones: { name: string }[];
		animations?: Record<string, { bones?: Record<string, unknown> }>;
	} & Record<string, unknown>;
	out.bones = out.bones.filter((b) => b.name !== name);
	for (const anim of Object.values(out.animations ?? {})) delete anim.bones?.[name];
	return out;
}
