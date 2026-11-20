import type { SheetRigSource } from 'engine-layout';

/**
 * What Invisible Characters knows of one of the project's rigs (`docs/design/character-pipeline.md`
 * step C6b): the names a sheet can pick from, and what decides whether a crowd can wear it. Read
 * off the rig's skeleton, never typed. `name` is the rig's bundle name, the one a sheet's source
 * and a rig node store.
 */
export interface RigFacts {
	name: string;
	animations: { name: string; durationMs: number }[];
	skins: string[];
	bones: string[];
	cost: RigCost;
}

/**
 * What a rig costs to draw in its setup pose, as the game's Pixi `RigView` draws it: a slot with a
 * dark tint is its own draw call, and a change of blend mode between two drawn slots starts a new
 * one. One draw call is what 100 frame-clip characters cost together.
 */
export interface RigCost {
	drawCalls: number;
	blendSwitches: number;
	darkTintSlots: number;
	drawnSlots: number;
	bones: number;
}

export type RigFactsByName = Readonly<Record<string, RigFacts>>;

/** The rigs the page has read, as the resolver asks them (`resolveSheetRig`): a rig not read has
 *  no animation, as a rig not loaded has none in the game. */
export function rigSourceOf(rigs: RigFactsByName): SheetRigSource {
	const of = (rig: string): RigFacts | undefined =>
		Object.hasOwn(rigs, rig) ? rigs[rig] : undefined;
	return {
		has: (rig, animation) => !!of(rig)?.animations.some((a) => a.name === animation),
		durationMs: (rig, animation) =>
			of(rig)?.animations.find((a) => a.name === animation)?.durationMs,
		hasSkin: (rig, skin) => !!of(rig)?.skins.includes(skin),
	};
}
