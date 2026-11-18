import {
	AdditiveAnimationBlendMode,
	AnimationClip,
	AnimationUtils,
	Bone,
	LoopOnce,
	LoopRepeat,
	NormalAnimationBlendMode,
	PropertyBinding,
	type AnimationAction,
} from 'three';

import type { Character3d } from './characters';
import { createAnimGraph3d, type AnimGraph3d, type CharacterAnim3D } from './pure/animGraph';

/** Just under a clip's end: a one-shot held there stays on its last pose instead of finishing. */
const END_EPSILON = 1e-4;

export type Animator3d = {
	readonly doc: CharacterAnim3D;
	readonly graph: AnimGraph3d;
	/** Advance the graph by `dt` seconds and, when `apply`, pose the character (the mixer). A
	 *  character off screen is advanced every frame and posed less often (the cast decides). */
	frame(dt: number, apply: boolean): void;
	/** The cues crossed since the last call (`<clip>:<cue>`). */
	takeCues(): string[];
	/** Each layer's state, after the last frame. */
	states(): Record<string, string>;
	/** Actions with weight this frame: `clip@region` → weight (the probe reads it). */
	weights(): Record<string, number>;
};

/**
 * The three.js half of the animation graph (A1): one `AnimationMixer` per character (its own), and
 * an `AnimationAction` per (clip, region, mode) the graph names, on a sub-clip holding only the
 * region's bone tracks (`AnimationUtils`-style filtering, cached) — made additive against its first
 * frame on an additive layer. Every frame the graph says which actions play at what time and weight;
 * the actions are held paused at that time and the mixer applies them with `update(0)`, so the pose
 * is exactly the graph's (three's own crossfades are not used: the graph's weights are the fades).
 */
export function createAnimator3d({
	character,
	doc,
	overrides,
}: {
	character: Character3d;
	doc: CharacterAnim3D;
	overrides?: Readonly<Record<string, string>>;
}): Animator3d {
	const bones: string[] = [];
	const parents = new Map<string, string>();
	character.root.traverse((o) => {
		if (!(o instanceof Bone)) return;
		bones.push(o.name);
		if (o.parent instanceof Bone) parents.set(o.name, o.parent.name);
	});
	const durations = new Map([...character.clips].map(([name, clip]) => [name, clip.duration]));
	const graph = createAnimGraph3d({
		doc,
		durations,
		bones,
		parentOf: (b) => parents.get(b),
		overrides,
	});
	if (graph.missingClips.length)
		console.warn(`[engine-3d] ${doc.id}: no clip ${graph.missingClips.join(', ')}`);

	const actions = new Map<string, AnimationAction>();
	const live = new Set<AnimationAction>();
	const weights = new Map<string, number>();
	let cues: string[] = [];
	let states: Record<string, string> = {};

	const actionFor = (clipName: string, region: string, mode: 'override' | 'additive') => {
		const key = `${mode}|${region}|${clipName}`;
		let action = actions.get(key);
		if (action) return action;
		const source = character.clips.get(clipName);
		const set = graph.regions.get(region);
		if (!source || !set) return undefined;
		const tracks = source.tracks.filter((t) => {
			const node = PropertyBinding.parseTrackName(t.name).nodeName;
			return set.has(node);
		});
		let clip = new AnimationClip(`${clipName}@${region}`, source.duration, tracks);
		if (mode === 'additive') clip = AnimationUtils.makeClipAdditive(clip.clone(), 0);
		action = character.mixer.clipAction(
			clip,
			undefined,
			mode === 'additive' ? AdditiveAnimationBlendMode : NormalAnimationBlendMode,
		);
		action.setLoop(doc.clips?.[clipName]?.loop === false ? LoopOnce : LoopRepeat, Infinity);
		action.clampWhenFinished = true;
		action.play();
		action.paused = true;
		actions.set(key, action);
		return action;
	};

	return {
		doc,
		graph,
		frame(dt, apply) {
			const out = graph.advance(dt);
			cues.push(...out.cues);
			states = out.states;
			if (!apply) return;
			weights.clear();
			const used = new Set<AnimationAction>();
			for (const c of out.contributions) {
				const action = actionFor(c.clip, c.region, c.mode);
				if (!action) continue;
				const duration = action.getClip().duration;
				action.enabled = true;
				action.paused = true;
				action.time = Math.min(c.time, Math.max(duration - END_EPSILON, 0));
				// Two contributions of one clip on one region (a crossfade back into the same clip)
				// cannot share an action: the later wins its time, the weights add.
				action.setEffectiveWeight((used.has(action) ? action.getEffectiveWeight() : 0) + c.weight);
				used.add(action);
				weights.set(action.getClip().name, action.getEffectiveWeight());
			}
			for (const action of live) if (!used.has(action)) action.setEffectiveWeight(0);
			live.clear();
			for (const action of used) live.add(action);
			character.mixer.update(0);
		},
		takeCues() {
			const out = cues;
			cues = [];
			return out;
		},
		states: () => states,
		weights: () => Object.fromEntries(weights),
	};
}
