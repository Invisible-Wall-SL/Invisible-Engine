/**
 * Types for the evaluator. The implementation is deliberately plain JS (`cinematicEval.js`) —
 * see the package's `index.ts` for why — so its contract is declared here instead of inferred.
 * The behaviour these signatures describe is pinned by 87 headless assertions in
 * `tools/rigger-spike/cinematic.mjs`, which is the real specification.
 */
import type {
	CinematicEase,
	CinematicHost,
	CinematicKey,
	CinematicNodeChannel,
	CinematicNodeSample,
	CinematicStrip,
	CinematicTrack,
} from '../types';

/** The rig runtime enums the evaluator needs. It constructs nothing, so any runtime that
 *  exposes these (engine-rig headless, the vendored WebGL bundle, engine-rig/pixi) works. */
export interface RigNamespace {
	MixBlend: { setup: number; first: number; replace: number; add: number };
	MixDirection: { mixIn: number; mixOut: number };
	Physics?: { update?: unknown };
}

/** What the evaluator poses. It hands this object back to `resolveClip`, so it must carry
 *  whatever that resolver needs (in practice the skeleton data). */
export interface CinematicEvalTarget {
	actorId?: string;
	skeleton: unknown;
	skeletonData?: unknown;
	tracks: CinematicTrack[];
}

export type ClipResolver = (strip: CinematicStrip, target: CinematicEvalTarget) => unknown | null;

/** Where `t` lands inside a strip's source clip, or null when the strip is inactive. */
export function clipLocalTime(
	strip: CinematicStrip & { extrapolate?: 'hold' | 'holdForward' | 'none'; clipOut?: number },
	t: number,
	clipDuration: number,
): { local: number; cycle: number; lastLocal: number } | null;

/**
 * Inverse of `clipLocalTime` — the cinematic time at which `strip` shows clip-local `local`,
 * resolved inside the loop repeat that `at` is already in, and clamped to the strip's window.
 */
export function cineTimeForLocal(
	strip: CinematicStrip & { extrapolate?: 'hold' | 'holdForward' | 'none'; clipOut?: number },
	local: number,
	clipDuration: number,
	at: number,
): number;

/** The strip's blend-in/out ramp × its alpha at `t` (0..1). */
export function blendEnvelope(strip: CinematicStrip, t: number): number;

/** Pose one actor at cinematic time `t`. Pure in `t` — re-evaluating is idempotent. */
export function evaluateActor(
	rig: RigNamespace,
	target: CinematicEvalTarget,
	t: number,
	resolveClip: ClipResolver,
): void;

/** Cue keys crossed moving from `prev` to `next` (edge-triggered; empty when scrubbing back). */
/** The keys in `(prev, next]`; a step over `maxStep` seconds reads as a seek and crosses none. */
export function cuesCrossed<T extends { time: number }>(
	keys: T[],
	prev: number,
	next: number,
	maxStep?: number,
): T[];

/** Expand a bone mask to the full set of bone names it covers (the named bones + descendants). */
export function expandBoneMask(
	skeleton: unknown,
	mask: { bones: string[] } | undefined,
): Set<string> | null;

/** A property/camera channel's value at `t`, or undefined when the channel has no keys. */
export function sampleChannel(keys: CinematicKey[] | undefined, t: number): number | undefined;

/** Every keyed channel of a property/camera track sampled at `t`. */
export function sampleTrack(track: CinematicTrack | undefined, t: number): Record<string, number>;

/** An actor's static placement overridden by any keyed channel. Does not mutate `place`. */
export function resolvePlace(
	place: Record<string, number | boolean>,
	propertyTracks: CinematicTrack[] | undefined,
	t: number,
): Record<string, number | boolean>;

/** Insert or replace a key at `time`, keeping the channel sorted. */
export function putKey(
	keys: CinematicKey[],
	time: number,
	value: number,
	ease?: CinematicKey['ease'],
): CinematicKey;

/** Whether an actor is on screen at `t` — a keyed visibility track wins over the static toggle. */
export function resolveVisible(
	staticVisible: boolean | undefined,
	visibilityTracks: CinematicTrack[] | undefined,
	t: number,
): boolean;

/** The `property` channels a node actor honours. */
export const NODE_CHANNELS: readonly CinematicNodeChannel[];

/** The prefix of a channel keying one exposed parameter of an effect node (`fx:intensity`). */
export const FX_PARAM_CHANNEL_PREFIX: 'fx:';

/** Whether a cast entry is a node actor (`kind: 'node'`); absent `kind` is a rig. */
export function isNodeActor(cast: { kind?: string } | null | undefined): boolean;

/** The document's host, normalised: absent or malformed ⇒ `{ kind: 'cast' }`. */
export function cinematicHost(doc: { host?: unknown } | null | undefined): CinematicHost;

/** The ratio (layout type) a track keys for; undefined for the default keys. */
export function trackLayout(track: { layout?: unknown } | null | undefined): string | undefined;

/** The keys a timeline's `tracks` play in ratio `layoutType`: that ratio when a property track keys
 *  for it, else undefined (the default keys). Hand it to `sampleNodeActor`. */
export function keysLayout(
	tracks: readonly { kind?: unknown; layout?: unknown }[] | undefined,
	layoutType: string | undefined,
): string | undefined;

/** A `tint` channel at `t` (0xRRGGBB, eased per colour channel), or undefined when un-keyed. */
export function sampleTint(keys: CinematicKey[] | undefined, t: number): number | undefined;

/** A `text` track at `t`: the count-up number or the switched-to key; undefined when un-keyed. */
export function sampleText(
	track: CinematicTrack | undefined,
	t: number,
): CinematicNodeSample['text'] | undefined;

/** Every keyed channel of one node actor at `t` (relative to the node's authored pose), the clip an
 *  `animation` strip holds a rig node at (`animTime`, clip-local seconds), and each keyed
 *  `fx:<id>` channel under its own name (absolute). `layout` picks the property keys
 *  (`keysLayout`); absent ⇒ the default keys. */
export function sampleNodeActor(
	tracks: CinematicTrack[] | undefined,
	t: number,
	layout?: string,
): CinematicNodeSample;

/** Whether `ease` is a cubic `[x1, y1, x2, y2]` of four finite numbers. */
export function isCubicEase(ease: unknown): ease is [number, number, number, number];
/** The shape `u → eased u` (0..1 in, eased out) of a key's `ease`; unknown ⇒ linear. */
export function easeShape(ease: CinematicEase | unknown): (u: number) => number;
/** Whether a timeline's `loop` keeps it playing forever (`loop` / `pingPong`). */
export function loopsForever(loop: unknown): boolean;
/** The time to sample after `elapsed` seconds of playing a `duration`-long timeline of `loop` type. */
export function playbackTime(loop: unknown, elapsed: number, duration: number): number;
/** The cue keys a ping-pong timeline crosses between two unwrapped lap times (out legs only). */
export function pingPongCuesCrossed<T extends { time: number }>(
	keys: T[],
	fromLap: number,
	toLap: number,
	duration: number,
): T[];
