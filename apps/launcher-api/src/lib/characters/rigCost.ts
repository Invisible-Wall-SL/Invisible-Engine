import {
	BoundingBoxAttachment,
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	PointAttachment,
	MixBlend,
	MixDirection,
	RegionAttachment,
	Skeleton,
	SkeletonBinary,
	SkeletonJson,
	type AttachmentLoader,
	type SkeletonData,
} from 'engine-rig';

import type { RigCost, RigFacts } from './rigFacts';

/** Builds every attachment without an atlas, so a skeleton reads with no art and no WebGL. */
const noArt: AttachmentLoader = {
	newRegionAttachment: (_skin, name, path) => new RegionAttachment(name, path),
	newMeshAttachment: (_skin, name, path) => new MeshAttachment(name, path),
	newBoundingBoxAttachment: (_skin, name) => new BoundingBoxAttachment(name),
	newPathAttachment: (_skin, name) => new PathAttachment(name),
	newPointAttachment: (_skin, name) => new PointAttachment(name),
	newClippingAttachment: (_skin, name) => new ClippingAttachment(name),
};

/** A rig's skeleton as the game's runtime reads it (4.2 JSON or `.irig`, parsed or as text).
 *  Throws what the reader throws. */
export const readRigJson = (skeletonJson: unknown): SkeletonData =>
	new SkeletonJson(noArt).readSkeletonData(
		typeof skeletonJson === 'string' ? skeletonJson : structuredClone(skeletonJson as object),
	);

/** A binary `.skel`, likewise. */
export const readRigBinary = (bytes: Uint8Array): SkeletonData =>
	new SkeletonBinary(noArt).readSkeletonData(bytes);

/** How many poses of each animation are counted, evenly spaced from its start to its end. */
const POSES_PER_ANIMATION = 16;

export type PoseCost = Omit<RigCost, 'bones'>;

/** One pose, counted as `RigView.drawSlots` draws it: one mesh per slot that shows a region or a
 *  mesh, in draw order; neighbours batch until the blend mode changes; a slot with a dark colour
 *  has its own shader, so it is one draw call and the batch on either side of it ends. */
export function rigPoseCost(skeleton: Skeleton): PoseCost {
	let drawCalls = 0;
	let blendSwitches = 0;
	let darkTintSlots = 0;
	let drawnSlots = 0;
	/** The blend of the batch still open, the blend of the slot drawn last. */
	let open: number | undefined;
	let last: number | undefined;
	for (const slot of skeleton.drawOrder) {
		const attachment = slot.getAttachment();
		if (!(attachment instanceof RegionAttachment || attachment instanceof MeshAttachment)) continue;
		if (skeleton.color.a * slot.color.a * attachment.color.a <= 0) continue;
		const blend = slot.data.blendMode;
		drawnSlots += 1;
		if (last !== undefined && last !== blend) blendSwitches += 1;
		last = blend;
		if (slot.darkColor) {
			darkTintSlots += 1;
			drawCalls += 1;
			open = undefined;
		} else if (open !== blend) {
			drawCalls += 1;
			open = blend;
		}
	}
	return { drawCalls, blendSwitches, darkTintSlots, drawnSlots };
}

/**
 * What a loaded rig costs to draw, as the game's Pixi `RigView` draws it: its dearest pose, of
 * the setup pose and {@link POSES_PER_ANIMATION} poses of every animation (an effect rig shows
 * nothing until an animation attaches its art, so the setup pose alone would call it free). The
 * four counts are of that one pose. The rig wears its first skin that is not the default, when it
 * has one: a rig whose art is in skins draws nothing without. Atlas pages do not split a batch,
 * and a slot a clipping mask hides whole is still counted.
 */
export function rigCostOfData(data: SkeletonData): RigCost {
	const skeleton = new Skeleton(data);
	const worn = data.skins.find((skin) => skin !== data.defaultSkin);
	if (worn) skeleton.setSkin(worn);
	skeleton.setToSetupPose();
	let worst = rigPoseCost(skeleton);
	for (const animation of data.animations) {
		for (let pose = 0; pose <= POSES_PER_ANIMATION; pose += 1) {
			skeleton.setToSetupPose();
			const at = (animation.duration * pose) / POSES_PER_ANIMATION;
			animation.apply(skeleton, -1, at, false, null, 1, MixBlend.setup, MixDirection.mixIn);
			const cost = rigPoseCost(skeleton);
			if (cost.drawCalls > worst.drawCalls) worst = cost;
			if (animation.duration === 0) break;
		}
	}
	return { ...worst, bones: data.bones.length };
}

/** {@link rigCostOfData} of a skeleton's JSON. */
export const rigCostOf = (skeletonJson: unknown): RigCost =>
	rigCostOfData(readRigJson(skeletonJson));

/** A loaded rig's facts: its names and lengths are the runtime's own, so the lists cannot name
 *  what the game does not find. */
export function rigFactsOfData(name: string, data: SkeletonData): RigFacts {
	return {
		name,
		animations: data.animations.map((a) => ({
			name: a.name,
			durationMs: Math.round(a.duration * 1000),
		})),
		skins: data.skins.map((s) => s.name),
		bones: data.bones.map((b) => b.name),
		cost: rigCostOfData(data),
	};
}

/** {@link rigFactsOfData} of a skeleton's JSON. */
export const rigFactsOf = (name: string, skeletonJson: unknown): RigFacts =>
	rigFactsOfData(name, readRigJson(skeletonJson));

/** The most draw calls of the rigs measured to fit 60 frames a second at 100 on screen, and the
 *  fewest of the one that fit neither 60 nor 30 (`docs/status/game-families.md`, C6a "Cost"). */
export const RIG_DRAWS_MEASURED_LIGHT = 7;
export const RIG_DRAWS_MEASURED_TOO_HEAVY = 70;

const HOST = 'measured on a software rasteriser, not a phone';

/**
 * Whether a crowd can wear a rig, in one sentence. Only what was measured is claimed: up to 7
 * draw calls fit 60 frames a second with 100 on screen, about 70 fit neither 60 nor 30, and in
 * between nothing was measured.
 */
export function rigCostVerdict(cost: RigCost): {
	level: 'light' | 'heavy' | 'tooHeavy';
	text: string;
} {
	const { drawCalls, darkTintSlots } = cost;
	const calls = `${drawCalls} draw call${drawCalls === 1 ? '' : 's'}`;
	if (drawCalls === 0)
		return {
			level: 'light',
			text: 'Nothing is drawn in its setup pose or in any animation, so it has no cost yet.',
		};
	if (drawCalls <= RIG_DRAWS_MEASURED_LIGHT)
		return {
			level: 'light',
			text: `Light: ${calls} a character, and 100 characters of up to ${RIG_DRAWS_MEASURED_LIGHT} drew at 60 frames a second (${HOST}).`,
		};
	const why =
		darkTintSlots > 0
			? `${darkTintSlots} of them for slots with a dark tint`
			: 'one for each change of blend mode';
	if (drawCalls >= RIG_DRAWS_MEASURED_TOO_HEAVY)
		return {
			level: 'tooHeavy',
			text: `Too heavy for a crowd: ${calls} a character (${why}), and 100 characters of about ${RIG_DRAWS_MEASURED_TOO_HEAVY} reached neither 60 nor 30 frames a second (${HOST}).`,
		};
	return {
		level: 'heavy',
		text: `Heavy: ${calls} a character (${why}), more than the ${RIG_DRAWS_MEASURED_LIGHT} that drew 100 characters at 60 frames a second and not tried in a crowd (${HOST}).`,
	};
}

/** The tooltip beside a rig's cost. */
export const RIG_COST_TIP =
	'Draw calls are how many times the game stops and starts to draw one character of this rig in its dearest pose: one for each run of slots that share a blend mode and one for every slot with a dark tint, where 100 frame-clip characters take one between them.';
