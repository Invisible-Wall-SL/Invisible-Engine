/**
 * Baked transitions in the Rigger (docs/design/rig-2p5d.md §7, §9; P7 built them, P3b gives them a
 * panel). A transition is a clip of the rig's 3D data named `transitionName(from, to)`, made from
 * clip `from`'s 3D pose at `at` (its end when omitted) to clip `to`'s at its start, over `duration`.
 * Pure, so the page (`vendor/rigger-2p5d.js`) bakes a transition exactly as the save does.
 */
import { bake2p5d, transitionName, type Bake2p5d } from './rig2p5d';
import { clipOf, followersOf, rigOf, withBake, type ClipPlan, type Rig3dDoc } from './rig3d';

type Json = Record<string, unknown>;

export interface TransitionSettings {
	from: string;
	to: string;
	/** When it leaves `from`, in seconds; omitted: at its end. */
	at?: number;
	duration: number;
}

/**
 * The 3D data with transition `from` → `to` declared (or its settings changed), and its name. Both
 * ends must be 3D clips (not transitions), the length above 0 and the start at or after 0; the
 * transition's own name must not be a clip of the irig that is not this transition. Throws why not.
 */
export function withTransition3d(
	doc: Rig3dDoc,
	irig: Json,
	t: TransitionSettings,
): { doc: Rig3dDoc; name: string } {
	const clips = doc.clips ?? {};
	for (const end of [t.from, t.to])
		if (!clips[end] || clips[end].transition)
			throw new Error(`“${end}” is not a 3D clip of this rig`);
	if (!(t.duration > 0)) throw new Error('a transition lasts more than 0 seconds');
	if (t.at !== undefined && !(t.at >= 0)) throw new Error('a transition starts at 0 s or later');
	const name = transitionName(t.from, t.to);
	const anims = (irig.animations ?? {}) as Json;
	if (Object.hasOwn(anims, name) && !clips[name]?.transition)
		throw new Error(`an animation named “${name}” already exists: rename it first`);
	const prev = clips[name];
	const transition = {
		from: t.from,
		to: t.to,
		...(t.at === undefined ? {} : { at: t.at }),
		duration: t.duration,
	};
	return {
		doc: {
			...doc,
			clips: {
				...clips,
				[name]: { bones: {}, transition, ...(prev?.baked ? { baked: prev.baked } : {}) },
			},
		},
		name,
	};
}

/** The 3D data without transition `name` (its clip in the irig is the caller's to keep or drop). */
export function withoutTransition3d(doc: Rig3dDoc, name: string): Rig3dDoc {
	if (!doc.clips?.[name]?.transition) return doc;
	const clips = { ...doc.clips };
	delete clips[name];
	return { ...doc, clips };
}

/** Transition `name` baked into the irig (its clip and the followers' setups), as the save bakes it. */
export function bakeTransition3d(
	irig: Json,
	doc: Rig3dDoc,
	name: string,
): { irig: Json; bake: Bake2p5d; plan: ClipPlan } {
	if (!doc.clips?.[name]?.transition) throw new Error(`${name} is not a baked transition`);
	const rig = rigOf(irig, doc);
	const plan = clipOf(rig, irig, doc, name);
	if (plan.problems.length) throw new Error(plan.problems.join('; '));
	const bake = bake2p5d(rig, plan.clip); // throws the rig's own problems, as the save refuses them
	return { irig: withBake(irig, name, plan, bake, followersOf(doc)), bake, plan };
}
