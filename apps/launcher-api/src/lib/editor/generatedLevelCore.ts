import type { LayoutNode } from 'engine-layout';

/**
 * The one step `/editor` takes to show a generated level (`generatedLevel.ts`), with the registries
 * passed in so a Node gate (`scripts/check-salmons-levels.mjs`) runs it on the real modules: the
 * room's generator (`engine-mechanics` `ONLINE_GENERATORS`) with the config's `levels`, drawn with
 * the room's drawing (`engine-layout` `FIELD_DRAWINGS`) — what a device does with a room's seed.
 */

type Made = { world: { w: number; h: number }; orphans?: unknown[] };
export type Generators = Readonly<
	Record<string, { make(seed: number, levels?: unknown): Made & Record<string, unknown> }>
>;
export type Drawings = Readonly<Record<string, (made: never) => LayoutNode>>;

export function drawGeneratedLevel(
	generators: Generators,
	drawings: Drawings,
	id: string,
	seed: number,
	levels: unknown,
): { made: Made; node: LayoutNode } {
	const made = generators[id].make(seed, levels);
	return { made, node: drawings[id](made as never) };
}
