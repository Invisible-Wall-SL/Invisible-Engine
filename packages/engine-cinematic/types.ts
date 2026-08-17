/**
 * Cinematic document shapes, for the engine side.
 *
 * `CinematicDoc` itself lives in `engine-layout` (it is part of the baked-bundle contract, which
 * that package owns). These are the finer-grained pieces the evaluator and the player reason
 * about — kept loose on purpose: unknown track kinds and unknown strip fields are ADDITIVE, and
 * the evaluator already skips whatever it cannot resolve, so a stricter type would only reject
 * documents authored by a newer tool.
 */

/** How a strip's clip repeats across its length. */
export type CinematicLoopMode = 'once' | 'count' | 'fill' | 'pingPong';

/** Where a strip's clip comes from (design §4.2 "Clip sources"). */
export type CinematicClipSource = 'rig' | 'library' | 'local';

export interface CinematicClipRef {
	src: CinematicClipSource;
	/** For `src: 'rig'` — the animation name inside the actor's own skeleton. */
	name?: string;
	/** For `src: 'library'` — the `_shared/animations` entry id. */
	id?: string;
}

export interface CinematicStrip {
	id: string;
	clip?: CinematicClipRef | null;
	/** Seconds on the CINEMATIC timeline. */
	start: number;
	length: number;
	/** Seconds into the source clip that `start` maps to. */
	clipIn?: number;
	speed?: number;
	loop?: { mode: CinematicLoopMode; n?: number };
	/** Ramp lengths in seconds, multiplied into `alpha`. */
	blendIn?: number;
	blendOut?: number;
	alpha?: number;
	/** `replace` composites over the layers below; `add` is additive over a base. */
	blend?: 'replace' | 'add';
	/** Restrict this strip to a bone subtree (bone transforms only — see the evaluator's note). */
	mask?: { bones: string[] };
}

/** One keyframe on a property/camera channel. `ease` is the key's OUTGOING interpolation. */
export interface CinematicKey {
	time: number;
	value: number;
	ease?: 'linear' | 'ease' | 'hold';
}

export interface CinematicTrack {
	id: string;
	kind: 'animation' | 'property' | 'camera' | 'visibility' | 'cue' | 'subCinematic';
	/** Null/absent for global tracks (camera). */
	actorId?: string | null;
	/** Animation tracks only — layers blend bottom-up. */
	layer?: number;
	strips?: CinematicStrip[];
	/** Visibility tracks only — stepped on/off keys. */
	keys?: Array<{ time: number; visible?: boolean; cue?: string }>;
	/** Property/camera tracks only. */
	channels?: Record<string, CinematicKey[]>;
}
