/**
 * MARKED INSTANCES AND THE LINES BETWEEN THEM, as an online room shows them (after P11.3): a
 * player the room marks (`mark`: Salmons' golden salmon, `tag`'s "it") is drawn gold over a glow at
 * its place, and a line (a `hook` ability's fishing line) is drawn from one instance to another.
 * The online runtime writes both once a frame from the room's state; `<SpawnLayer>` draws them.
 * Generic: engine-layout knows only that some spawned instances are marked or linked.
 *
 * Nothing turns it on but an online room, so every other spawn layer renders as before.
 */

import { SvelteMap } from 'svelte/reactivity';

/** A marked instance: its body's width, which sizes the glow. */
export type InstanceMark = { width: number };

/**
 * A line from instance `from` to instance `to`. On a projected screen each end is raised by its
 * lift above the instance's place (its feet), so the line runs from the holder's hand to the middle
 * of the one on it; flat, it runs centre to centre.
 */
export type InstanceLink = { from: string; to: string; fromLift: number; toLift: number };

const state = $state({ on: false });
const marks = new SvelteMap<string, InstanceMark>();
const links = new SvelteMap<string, readonly InstanceLink[]>();

/** Whether marks and lines are drawn (an online room). */
export const marksOn = (): boolean => state.on;

/** An instance's mark, or `undefined` when it is not marked. */
export const markOf = (id: string): InstanceMark | undefined => marks.get(id);

/** The lines drawn in spawn layer `layer`. */
export const linksOf = (layer: string): readonly InstanceLink[] => links.get(layer) ?? [];

/** Publish the marks after a frame (only the changes); the first publish turns them on. */
export const setMarks = (next: ReadonlyMap<string, InstanceMark>): void => {
	if (!state.on) state.on = true;
	for (const id of marks.keys()) if (!next.has(id)) marks.delete(id);
	for (const [id, mark] of next) if (marks.get(id)?.width !== mark.width) marks.set(id, mark);
};

const sameLinks = (a: readonly InstanceLink[], b: readonly InstanceLink[]) =>
	a.length === b.length &&
	a.every(
		(link, i) =>
			link.from === b[i].from &&
			link.to === b[i].to &&
			link.fromLift === b[i].fromLift &&
			link.toLift === b[i].toLift,
	);

/** Publish layer `layer`'s lines after a frame (only when they changed). */
export const setLinks = (layer: string, next: readonly InstanceLink[]): void => {
	if (!state.on) state.on = true;
	if (!sameLinks(linksOf(layer), next)) links.set(layer, next);
};
