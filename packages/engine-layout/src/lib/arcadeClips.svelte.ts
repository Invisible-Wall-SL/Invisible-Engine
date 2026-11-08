/**
 * THE CLIPS SPAWNED CHARACTERS PLAY, as an online room draws them (Salmons' S0 art): per instance,
 * the Invisible Flipbook clip its component's `characterClips` resolve to this frame
 * (`characterClips.ts`). The online runtime writes them once a frame; `<SpawnLayer>` draws the clip
 * over the instance's own tree, which it hides meanwhile (and shows again for an instance with no
 * clip). Generic: engine-layout knows only that some spawned instances play a clip.
 *
 * Nothing turns it on but an online room whose characters have clips (its first publish); every
 * other spawn layer renders as before.
 */

import { SvelteMap } from 'svelte/reactivity';

/**
 * An instance's clip: `play` changes when a one-shot starts (so a repeat plays again), `width`
 * is the drawn width of the clip's box, `anchorY` where the feet are down it and `own` that the
 * clip is a marked player's own (drawn as made, not tinted gold).
 */
export type InstanceClip = {
	clipId: string;
	flipX: boolean;
	loop: boolean;
	play: number;
	width: number;
	anchorY: number;
	own: boolean;
};

const state = $state({ on: false });
const clips = new SvelteMap<string, InstanceClip>();

/** Whether any spawned instance plays a clip (an online room whose characters have clips). */
export const clipsOn = (): boolean => state.on;

/** An instance's clip, or `undefined` when it draws its own tree. */
export const clipOf = (id: string): InstanceClip | undefined => clips.get(id);

const same = (a: InstanceClip | undefined, b: InstanceClip) =>
	!!a &&
	a.clipId === b.clipId &&
	a.flipX === b.flipX &&
	a.loop === b.loop &&
	a.play === b.play &&
	a.width === b.width &&
	a.anchorY === b.anchorY &&
	a.own === b.own;

/** Publish the clips after a frame (only the changes); the first publish turns them on. */
export const setClips = (next: ReadonlyMap<string, InstanceClip>): void => {
	if (!state.on) state.on = true;
	for (const id of clips.keys()) if (!next.has(id)) clips.delete(id);
	for (const [id, clip] of next) if (!same(clips.get(id), clip)) clips.set(id, clip);
};

/** The room is gone: no clips, and off again. */
export const clearClips = (): void => {
	clips.clear();
	state.on = false;
};
