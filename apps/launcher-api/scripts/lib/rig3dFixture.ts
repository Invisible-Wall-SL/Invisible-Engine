/**
 * A small 2.5D rig for the sidecar checks (`check-rig3d.ts`, `check-rigger-writes.ts`): an irig v1
 * arm on a chest with a hand drawn by angle (an image bone that follows the hand), and the
 * `rig3d.json` that keys a reach in 3D. The irig is what the Rigger stores before the rig turns 3D;
 * the sidecar's `reach` clip turns the chest, swings the arm toward the camera and turns the hand
 * through its ¾ and side drawings.
 */
import { orientOf } from '../../src/lib/rig2p5d.ts';
import type { Rig3dDoc } from '../../src/lib/rig3d.ts';

export const HAND_DRAWINGS = [
	{ attachment: 'hand_front', turn: 0 },
	{ attachment: 'hand_3q_r', turn: 45 },
	{ attachment: 'hand_side_r', turn: 90 },
	{ attachment: 'hand_3q_l', turn: -45 },
	{ attachment: 'hand_side_l', turn: -90 },
];

const region = (x: number, width: number, height: number) => ({ x, y: 0, width, height });
const hand = Object.fromEntries(HAND_DRAWINGS.map((d) => [d.attachment, region(20, 40, 32)]));

/** Every region the rig draws, for an atlas (the finger's only `withFinger`'s). */
export const REGIONS = ['torso', 'upper_arm', 'forearm', 'sleeve', 'finger', ...Object.keys(hand)];

/** The rig as a 2D `.irig`: the image bone is listed before the hand it follows. */
export function irigOf(): Record<string, unknown> {
	return {
		irig: 1,
		skeleton: {
			hash: 'rig3d-fixture',
			importedFrom: '4.2',
			x: -400,
			y: -400,
			width: 800,
			height: 800,
		},
		bones: [
			{ name: 'root' },
			{ name: 'chest', parent: 'root' },
			{ name: 'hand_image', parent: 'chest', length: 40 },
			{ name: 'upper_arm', parent: 'chest', length: 120, x: 80, y: 100, rotation: -90 },
			{ name: 'forearm', parent: 'upper_arm', length: 100, x: 120 },
			{ name: 'hand', parent: 'forearm', length: 40, x: 100 },
		],
		slots: [
			{ name: 'torso', bone: 'chest', attachment: 'torso' },
			{ name: 'upper_arm', bone: 'upper_arm', attachment: 'upper_arm' },
			{ name: 'sleeve', bone: 'upper_arm', attachment: 'sleeve' },
			{ name: 'forearm', bone: 'forearm', attachment: 'forearm' },
			{ name: 'hand', bone: 'hand_image', attachment: 'hand_front' },
		],
		skins: [
			{
				name: 'default',
				attachments: {
					torso: { torso: region(0, 180, 260) },
					upper_arm: { upper_arm: region(60, 120, 36) },
					// Across the elbow, weighted to both bones: its points count toward both cards.
					sleeve: {
						sleeve: {
							type: 'mesh',
							uvs: [0, 0, 1, 0, 1, 1, 0, 1],
							triangles: [0, 1, 2, 2, 3, 0],
							// Per vertex: its influence count, then (bone index, x, y, weight) each.
							// prettier-ignore
							vertices: [
								1, 3, 100, -14, 1,
								2, 3, 130, -14, 0.5, 4, 10, -14, 0.5,
								2, 3, 130, 14, 0.5, 4, 10, 14, 0.5,
								1, 3, 100, 14, 1,
							],
							hull: 4,
							width: 40,
							height: 28,
						},
					},
					forearm: { forearm: region(50, 100, 30) },
					hand,
				},
			},
		],
		animations: {
			idle: {
				bones: {
					chest: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 5 },
						],
					},
				},
			},
			// The 2D side of the reach: the root walks (the baked arm hangs from it) and the torso tints.
			reach: {
				bones: {
					root: {
						translate: [
							{ time: 0, x: 0, y: 0 },
							{ time: 2, x: 30, y: 0 },
						],
					},
				},
				slots: {
					torso: {
						rgba: [
							{ time: 0, color: 'ffffffff' },
							{ time: 2, color: 'ffd0d0ff' },
						],
					},
				},
			},
		},
	};
}

/** The finger's curl through the reach, keyed in 2D. */
export const FINGER_CURL = [
	{ time: 0, value: 0 },
	{ time: 1, value: 80 },
	{ time: 2, value: 0 },
];

type Doc = {
	bones: unknown[];
	slots: unknown[];
	skins: { attachments: Record<string, unknown> }[];
};

/**
 * The rig with a long finger on the hand. It has no turn, depth or follow of its own, so in the reach
 * it lies flat in the hand's card (a flat bone, docs/design/rig-2p5d.md §4.1) and keeps its 2D curl;
 * its art reaches three hand lengths past the hand, so where the curl takes it decides the hand's
 * error (§4.4).
 */
export function withFinger(irig: Record<string, unknown>): Record<string, unknown> {
	const out = structuredClone(irig);
	const doc = out as unknown as Doc;
	doc.bones.push({ name: 'finger', parent: 'hand', length: 120, x: 40 });
	doc.slots.push({ name: 'finger', bone: 'finger', attachment: 'finger' });
	doc.skins[0].attachments.finger = { finger: region(60, 120, 12) };
	const anims = out.animations as Record<string, { bones: Record<string, unknown> }>;
	anims.reach.bones.finger = { rotate: structuredClone(FINGER_CURL) };
	return out;
}

/** The turn from the setup, as a key. */
const at = (time: number, rotate: number, tilt = 0, twist = 0) => ({
	time,
	value: orientOf(rotate, tilt, twist),
});

/** The rig's 3D data: a side turnaround, the hand's drawings by angle, and the reach in 3D. */
export function sidecarOf(stem: string): Rig3dDoc {
	return {
		rig3d: 1,
		rig: stem,
		turnaround: 'side',
		bones: { hand_image: { follow: 'hand' }, forearm: { depth: 3 } },
		views: { hand: { drawings: HAND_DRAWINGS.map((d) => ({ ...d })) } },
		clips: {
			reach: {
				duration: 2,
				bones: {
					chest: { orient: [at(0, 0), at(1, 0, 12), at(2, 0)] },
					upper_arm: { orient: [at(0, 0), at(1, 40, 50), at(2, 0)] },
					hand: { orient: [at(0, 0), at(1.2, 0, 50), at(1.6, 0, 88), at(2, 0)] },
				},
			},
		},
	};
}

/**
 * The rig's 3D data with a second 3D clip, `wave` (the arm raised and rolled, the elbow a hinge), and
 * a baked transition from the reach at `start` s (or its end) to the wave, over 0.3 s.
 */
export function withTransition(doc: Rig3dDoc, start: number | 'end' = 1): Rig3dDoc {
	return {
		...doc,
		clips: {
			...doc.clips,
			wave: {
				duration: 1.5,
				bones: {
					chest: { orient: [at(0, 0, -10), at(1.5, 0, -10)] },
					upper_arm: { orient: [at(0, 30, 20, 40), at(0.75, 60, 10, 20), at(1.5, 30, 20, 40)] },
					forearm: {
						rotate: [
							{ time: 0, value: 35 },
							{ time: 1.5, value: 35 },
						],
					},
				},
			},
			reach_to_wave: {
				bones: {},
				transition: {
					from: 'reach',
					to: 'wave',
					...(start === 'end' ? {} : { at: start }),
					duration: 0.3,
				},
			},
		},
	};
}

/**
 * A doc as the Rigger holds it after opening it: every key's time and omitted values filled in
 * (`normalizeKeys` in static/rigger/view.html), so saving it unchanged sends this.
 */
export function asRiggerLoads<T>(doc: T): T {
	const out = structuredClone(doc) as { animations?: Record<string, Record<string, unknown>> };
	const DEFAULTS: Record<string, [string, number][]> = {
		rotate: [['value', 0]],
		translate: [
			['x', 0],
			['y', 0],
		],
		scale: [
			['x', 1],
			['y', 1],
		],
		sheary: [['value', 0]],
	};
	const walk = (node: unknown) => {
		if (!node || typeof node !== 'object') return;
		for (const v of Object.values(node)) {
			if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null) {
				for (const k of v) if (k.time === undefined) k.time = 0;
			} else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
		}
	};
	for (const anim of Object.values(out.animations ?? {})) {
		walk(anim);
		const bones = (anim.bones ?? {}) as Record<string, Record<string, Record<string, unknown>[]>>;
		for (const timelines of Object.values(bones))
			for (const [kind, keys] of Object.entries(timelines))
				for (const k of keys)
					for (const [f, d] of DEFAULTS[kind] ?? []) if (k[f] === undefined) k[f] = d;
	}
	return out as T;
}

/** The same doc as a writer that leaves defaults out would store it (time 0, value 0 or 1). */
export function withDefaultsOmitted<T>(doc: T): T {
	const out = structuredClone(doc) as { animations?: Record<string, Record<string, unknown>> };
	for (const anim of Object.values(out.animations ?? {})) {
		const bones = (anim.bones ?? {}) as Record<string, Record<string, Record<string, unknown>[]>>;
		for (const timelines of Object.values(bones))
			for (const [kind, keys] of Object.entries(timelines))
				for (const k of keys) {
					if (k.time === 0) delete k.time;
					const rest = kind === 'scale' ? 1 : 0;
					for (const f of ['value', 'x', 'y']) if (k[f] === rest) delete k[f];
				}
	}
	return out as T;
}
