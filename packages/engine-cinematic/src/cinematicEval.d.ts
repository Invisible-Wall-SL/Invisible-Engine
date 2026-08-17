/**
 * Types for the evaluator. The implementation is deliberately plain JS (`cinematicEval.js`) —
 * see the package's `index.ts` for why — so its contract is declared here instead of inferred.
 * The behaviour these signatures describe is pinned by 87 headless assertions in
 * `tools/rigger-spike/cinematic.mjs`, which is the real specification.
 */
import type { CinematicKey, CinematicStrip, CinematicTrack } from '../types';

/** The spine runtime enums the evaluator needs. It constructs nothing, so any runtime that
 *  exposes these (spine-core headless, the vendored WebGL bundle, spine-pixi-v8) works. */
export interface SpineNamespace {
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

/** The strip's blend-in/out ramp × its alpha at `t` (0..1). */
export function blendEnvelope(strip: CinematicStrip, t: number): number;

/** Pose one actor at cinematic time `t`. Pure in `t` — re-evaluating is idempotent. */
export function evaluateActor(
	spine: SpineNamespace,
	target: CinematicEvalTarget,
	t: number,
	resolveClip: ClipResolver,
): void;

/** Cue keys crossed moving from `prev` to `next` (edge-triggered; empty when scrubbing back). */
export function cuesCrossed<T extends { time: number }>(keys: T[], prev: number, next: number): T[];

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
