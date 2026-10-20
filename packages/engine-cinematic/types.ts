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
	/**
	 * Restrict this strip to part of the skeleton — the roots, plus their descendants when
	 * `includeChildren`. Bone transforms only; slot colour / attachment / deform are NOT masked
	 * (see the evaluator's note). Absent or empty = the whole skeleton.
	 */
	mask?: { bones: string[]; includeChildren?: boolean };
	/**
	 * The source clip's length in seconds, for a strip on a NODE actor (a rig node — Rive plan
	 * Phase 8a): the player samples such a strip without the skeleton, so a loop mode needs the
	 * length recorded here. Absent ⇒ the strip plays its clip once and holds its last frame (the
	 * rig clamps the time to the clip). A cast actor's strips never read it: the evaluator has the
	 * skeleton.
	 */
	clipLength?: number;
}

/**
 * A cubic ease (Rive plan Phase 9b): the CSS cubic-bezier `[x1, y1, x2, y2]` through (0,0) and (1,1).
 * x is clamped to [0, 1]; y may overshoot.
 */
export type CinematicCubicEase = [number, number, number, number];

/** A key's outgoing interpolation: a named one, or a cubic. Absent or unknown ⇒ linear. */
export type CinematicEase = 'linear' | 'ease' | 'hold' | CinematicCubicEase;

/** One keyframe on a property/camera channel. `ease` is the key's OUTGOING interpolation. */
export interface CinematicKey {
	time: number;
	value: number;
	ease?: CinematicEase;
}

/**
 * A timeline's loop type (Rive plan Phase 9b). Absent ⇒ one-shot: plays once and holds its last
 * frame, as every timeline did before the field. `oneShot` says the same thing explicitly.
 */
export type CinematicLoop = 'oneShot' | 'loop' | 'pingPong';

/**
 * What a timeline animates (Rive plan §3.2). Absent ⇒ `cast`: rigs on the cinematic's own stage,
 * every document authored before node actors. `screen` animates the nodes of that Scene (it is
 * also the timeline's set); `component` animates the nodes of that component's root — valid in
 * the format, but nothing plays a component timeline yet (Rive plan Phase 4).
 */
export type CinematicHost =
	| { kind: 'cast' }
	| { kind: 'component'; componentId: string }
	| { kind: 'screen'; sceneId: string };

/**
 * An actor's kind (Rive plan §3.1). Absent or `rig` = a cast rig (today's actor). `node` = a layout
 * node in the host, found by `target`: the node's NAME (its label), falling back to its id.
 */
export type CinematicActorKind = 'rig' | 'node';

/**
 * The `property` channels a NODE actor honours. Unlike a rig actor's (absolute placement), they
 * are RELATIVE to the node's authored pose, so one timeline plays on any host with a node of that
 * name: `x`/`y` add design pixels, `scale`/`scaleX`/`scaleY` multiply, `rotation` adds degrees,
 * `alpha` multiplies. `tint` replaces the colour (0xRRGGBB, eased per channel), `frame` holds a
 * flipbook on a frame of its own clip, `fill` reveals 0..1 of a sprite / rect / flipbook.
 */
export type CinematicNodeChannel =
	'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'alpha' | 'tint' | 'frame' | 'fill';

/**
 * A channel keying one exposed parameter of an EFFECT node (Invisible FX Step 2): `fx:<param id>`.
 * Absolute, unlike the channels above — the keyed value is the parameter's value (a bool keyed 0 / 1).
 */
export type CinematicFxParamChannel = `fx:${string}`;

/**
 * One key of a `text` track (Rive plan §8). `countUp` keys carry a `value` (eased like any
 * channel); `switchKey` keys carry a `key`, stepped, naming one of the text node's own strings
 * (its `text` or one of its `switchKeys`). A timeline never carries free text.
 */
export interface CinematicTextKey {
	time: number;
	value?: number;
	ease?: CinematicKey['ease'];
	key?: string;
}

/** A node actor's channels sampled at one time — only what is keyed is present. */
export interface CinematicNodeSample {
	x?: number;
	y?: number;
	scaleX?: number;
	scaleY?: number;
	rotation?: number;
	alpha?: number;
	tint?: number;
	frame?: number;
	fill?: number;
	visible?: boolean;
	text?: { mode: 'countUp'; value: number } | { mode: 'switchKey'; key: string };
	/**
	 * A rig node's clip, held at a clip-local time in SECONDS (Rive plan Phase 8a): the strip of
	 * an `animation` track on a node actor that is active at the sampled time. The rig clamps the
	 * time to the clip's length, so a strip longer than its clip holds the last frame.
	 */
	animTime?: { animation: string; time: number };
	/** An effect node's keyed parameters, each under its channel name (`fx:intensity`). */
	[fxParam: CinematicFxParamChannel]: number | undefined;
}

export interface CinematicTrack {
	id: string;
	kind: 'animation' | 'property' | 'camera' | 'visibility' | 'cue' | 'subCinematic' | 'text';
	/** Null/absent for global tracks (camera). */
	actorId?: string | null;
	/** Animation tracks only — layers blend bottom-up. */
	layer?: number;
	strips?: CinematicStrip[];
	/** Visibility (stepped on/off), cue and text keys. */
	keys?: Array<{ time: number; visible?: boolean; cue?: string } & Partial<CinematicTextKey>>;
	/** Property/camera tracks only. */
	channels?: Record<string, CinematicKey[]>;
	/** Text tracks only: count up to a number, or switch among the node's own strings. */
	mode?: 'countUp' | 'switchKey';
	/**
	 * Count-up only. `format` names an engine value source (`win`, `balance`, …) whose formatter
	 * renders the number, so a count-up reads exactly like that readout; absent ⇒ a grouped
	 * integer. `to` names a value source too: the keys are then SHARES (0..1) of its current value,
	 * which is how a timeline counts up to "the win" without knowing it.
	 */
	format?: string;
	to?: string;
}
