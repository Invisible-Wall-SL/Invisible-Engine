import { ComponentStateMachineRunner } from 'engine-layout/state-machine';
import type {
	ComponentInput,
	ComponentStateMachine,
	SmBlendPoint,
	SmLayer,
	SmState,
} from 'engine-layout/types';

/**
 * THE 3D ANIMATION GRAPH (animation eval §2–§3, Phase 2 A1–A2): a character's `CharacterAnim3D` doc
 * evaluated into clip weights. Its `machine` IS a component state machine — the shared runner in
 * `engine-layout` decides states, transitions, triggers, exit times and blend progress, unchanged —
 * and everything 3D adds is read here, in `engine-3d`, so no 2D component's timing or bytes move:
 *
 * - **Phase sync** (`sync: 'phase'`, the default on a blend): every point of a 1D or 2D blend
 *   advances by `dt / (Σ wᵢ·dᵢ)` of ONE normalised phase and plays at `phase · dᵢ`, so a 0.8 s walk
 *   and a 0.6 s run keep their feet together. `sync: 'none'` plays each point on the state's clock.
 * - **2D blends** (`blend2d`): points at `{x, y}` weighted by gradient-band interpolation
 *   (Cartesian): `wᵢ = minⱼ (1 − (p−pᵢ)·(pⱼ−pᵢ) / |pⱼ−pᵢ|²)`, clamped at 0, normalised.
 * - **Crossfades keep the state being left moving** under the blend (3D's default; a transition's
 *   `pauseSource: true` freezes it), at `1 − progress`, the new state at `progress`.
 * - **Layers** stack: an `override` layer with weight `w` (its `weightInput`, else 1) times its
 *   coverage `c` (the share of its contributions that play) takes `w·c` of every bone in its `mask`
 *   (every bone without one) from the layers below; an `additive` layer adds on top. three's mixer
 *   AVERAGES override weights, so this is realised exactly with per-region sub-clips: a contribution
 *   of layer `i` is split by which later override layers cover each bone, and each piece is scaled by
 *   `Πₖ (1 − wₖ·cₖ)` over those layers. On every bone the base layer covers, override weights sum to
 *   1.
 *
 * Pure (no three.js): the adapter (`animator.ts`) turns each {@link Contribution} into an
 * `AnimationAction` on the region's sub-clip.
 */

/** A 2D blend point: a clip at `at = [x, y]`. */
export type SmBlend2DPoint = { timeline: string; at: [number, number] };

/** A 2D blend space (direction): two number inputs and ≥ 3 points (≥ 1 is played). */
export type SmBlend2D = { x: string; y: string; points: SmBlend2DPoint[] };

export type SmState3d = SmState & {
	blend2d?: SmBlend2D;
	/** How a blend's points share time. Absent ⇒ `phase`. */
	sync?: 'phase' | 'none';
};

export type SmLayerMode3d = 'override' | 'additive';

export type SmLayer3d = Omit<SmLayer, 'states'> & {
	states: SmState3d[];
	/** A mask name of the doc: the bones this layer drives. Absent ⇒ every bone. */
	mask?: string;
	/** Absent ⇒ `override`. */
	mode?: SmLayerMode3d;
	/** A number input 0..1 scaling the layer. Absent ⇒ 1. */
	weightInput?: string;
};

/** A named bone set: each `include` bone and its descendants, minus each `exclude` and its. */
export type Mask3d = { include: string[]; exclude?: string[] };

export type ClipMeta3d = {
	loop?: boolean;
	/** Presentation cues at seconds into the clip (footsteps, trails): never a hit. */
	cues?: { at: number; cue: string }[];
};

/** One skeleton's animation doc (per hero overrides swap clip names). */
export type CharacterAnim3D = {
	id: string;
	skeleton?: string;
	/** The clip libraries (`anim` models), by model id: what the models export ships. */
	modelIds?: string[];
	clips?: Record<string, ClipMeta3d>;
	masks?: Record<string, Mask3d>;
	inputs: ComponentInput[];
	machine: { layers: SmLayer3d[] };
	/** Per look id: clip name → the clip that plays instead. */
	heroOverrides?: Record<string, Record<string, string>>;
};

/** One clip playing this frame: on `region`'s bones, at `time`, with `weight`. */
export type Contribution = {
	clip: string;
	time: number;
	weight: number;
	mode: SmLayerMode3d;
	/** A key of {@link AnimGraph3d.regions}. */
	region: string;
};

export type AnimFrame3d = {
	contributions: Contribution[];
	/** Cues crossed this frame, `<clip>:<cue>`. */
	cues: string[];
	/** Each layer's state now, by layer id. */
	states: Record<string, string>;
};

export type AnimGraph3d = {
	setInput(id: string, value: number | boolean): void;
	fire(trigger: string): void;
	input(id: string): number | boolean | undefined;
	/** Advance by `dt` seconds (real time) and say what plays. */
	advance(dt: number): AnimFrame3d;
	/** The bone set of every region a contribution may name (built once). */
	readonly regions: ReadonlyMap<string, ReadonlySet<string>>;
	/** Clips some state names that the libraries do not have. */
	readonly missingClips: readonly string[];
};

/** Bones of a mask in a hierarchy (`parentOf` per bone). */
export function maskBones(
	mask: Mask3d,
	bones: readonly string[],
	parentOf: (bone: string) => string | undefined,
): Set<string> {
	const under = (bone: string, roots: readonly string[]) => {
		for (let b: string | undefined = bone; b; b = parentOf(b)) if (roots.includes(b)) return true;
		return false;
	};
	return new Set(bones.filter((b) => under(b, mask.include) && !under(b, mask.exclude ?? [])));
}

/** Gradient-band (Cartesian) weights of `p` over `points`: non-negative, summing to 1. */
export function gradientBand(
	p: readonly [number, number],
	points: readonly (readonly [number, number])[],
): number[] {
	const n = points.length;
	if (n === 0) return [];
	if (n === 1) return [1];
	const w = points.map((pi, i) => {
		let min = 1;
		for (let j = 0; j < n; j++) {
			if (j === i) continue;
			const pj = points[j];
			const ex = pj[0] - pi[0];
			const ey = pj[1] - pi[1];
			const len = ex * ex + ey * ey;
			if (len === 0) continue;
			const h = 1 - ((p[0] - pi[0]) * ex + (p[1] - pi[1]) * ey) / len;
			if (h < min) min = h;
		}
		return Math.max(0, min);
	});
	const sum = w.reduce((a, b) => a + b, 0);
	if (sum <= 0) {
		// Outside every band (cannot happen inside the hull): the nearest point plays alone.
		const d = points.map((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
		const k = d.indexOf(Math.min(...d));
		return points.map((_, i) => (i === k ? 1 : 0));
	}
	return w.map((v) => v / sum);
}

/** 1D bracket weights of `value` over points sorted by `at`. */
function bracket1d(value: number, points: readonly { at: number }[]): number[] {
	const w = points.map(() => 0);
	if (!points.length) return w;
	if (value <= points[0].at) w[0] = 1;
	else if (value >= points[points.length - 1].at) w[points.length - 1] = 1;
	else
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i].at;
			const b = points[i + 1].at;
			if (value >= a && value < b) {
				const t = (value - a) / (b - a);
				w[i] = 1 - t;
				w[i + 1] = t;
				break;
			}
		}
	return w;
}

const wrap = (t: number, d: number) => (d > 0 ? ((t % d) + d) % d : 0);

/** One state as it plays: its own clock and phase, advanced by the graph, not by the runner. */
type Sampler = {
	state: SmState3d;
	clock: number;
	phase: number;
	frozen: boolean;
	/** Last frame's time per clip, for cues. */
	last: Map<string, number>;
};

const finite = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Build a character's graph. `durations` are the seconds of every clip the libraries brought (by
 * `<set>.<clip>`); `bones` and `parentOf` describe its skeleton (masks resolve against them);
 * `overrides` swap clip names (`heroOverrides[look]`).
 */
export function createAnimGraph3d({
	doc,
	durations,
	bones,
	parentOf,
	overrides = {},
}: {
	doc: CharacterAnim3D;
	durations: ReadonlyMap<string, number>;
	bones: readonly string[];
	parentOf: (bone: string) => string | undefined;
	overrides?: Readonly<Record<string, string>>;
}): AnimGraph3d {
	const clipOf = (name: string) => overrides[name] ?? name;
	const layers = doc.machine.layers;
	const runner = new ComponentStateMachineRunner(
		{
			layers: layers.map((l) => ({
				...l,
				states: l.states.map((s) => ({ ...s, timeline: clipOf(s.timeline) })),
			})),
		} as ComponentStateMachine,
		doc.inputs,
		new Map([...durations].filter(([name]) => !!name)),
	);
	const missingClips = new Set<string>();
	for (const layer of layers)
		for (const state of layer.states)
			for (const name of [
				state.timeline,
				...(state.blend?.points ?? []).map((p) => p.timeline),
				...(state.blend2d?.points ?? []).map((p) => p.timeline),
			])
				if (name && !durations.has(clipOf(name))) missingClips.add(clipOf(name));

	// ── Regions ──
	const all = new Set(bones);
	const maskOf = (layer: SmLayer3d) => {
		const mask = layer.mask ? doc.masks?.[layer.mask] : undefined;
		return mask ? maskBones(mask, bones, parentOf) : all;
	};
	const masks = layers.map(maskOf);
	const isOverride = (l: SmLayer3d) => (l.mode ?? 'override') === 'override';
	const regions = new Map<string, Set<string>>();
	/** Per layer: its regions, each with the later override layers that cover it. */
	const layerRegions = layers.map((layer, i) => {
		if (!isOverride(layer)) {
			const key = `${i}`;
			regions.set(key, masks[i]);
			return [{ key, coveredBy: [] as number[] }];
		}
		const bySig = new Map<string, { key: string; coveredBy: number[]; bones: Set<string> }>();
		for (const bone of masks[i]) {
			const coveredBy = layers
				.map((l, k) => (k > i && isOverride(l) && !l.disabled && masks[k].has(bone) ? k : -1))
				.filter((k) => k >= 0);
			const sig = coveredBy.join(',');
			let region = bySig.get(sig);
			if (!region) {
				region = { key: `${i}:${sig}`, coveredBy, bones: new Set() };
				bySig.set(sig, region);
			}
			region.bones.add(bone);
		}
		for (const r of bySig.values()) regions.set(r.key, r.bones);
		return [...bySig.values()].map(({ key, coveredBy }) => ({ key, coveredBy }));
	});

	// ── Sampling ──
	const sampler = (state: SmState3d | undefined, at = 0): Sampler | undefined =>
		state ? { state, clock: at, phase: 0, frozen: false, last: new Map() } : undefined;
	const value = (id: string) => finite(runner.input(id), 0);
	/** A state's clips and weights now (before its own phase advance). */
	const points = (state: SmState3d): { clip: string; w: number; d: number }[] => {
		const known = (name: string) => durations.get(clipOf(name));
		if (state.blend2d) {
			const pts = state.blend2d.points.filter((p) => known(p.timeline) !== undefined);
			const w = gradientBand(
				[value(state.blend2d.x), value(state.blend2d.y)],
				pts.map((p) => p.at),
			);
			return pts.map((p, i) => ({ clip: clipOf(p.timeline), w: w[i], d: known(p.timeline) ?? 0 }));
		}
		if (state.blend) {
			const pts = [...state.blend.points]
				.filter((p: SmBlendPoint) => known(p.timeline) !== undefined)
				.sort((a, b) => a.at - b.at);
			const w = bracket1d(value(state.blend.input), pts);
			return pts.map((p, i) => ({ clip: clipOf(p.timeline), w: w[i], d: known(p.timeline) ?? 0 }));
		}
		const d = known(state.timeline);
		return d === undefined ? [] : [{ clip: clipOf(state.timeline), w: 1, d }];
	};
	const advanceSampler = (s: Sampler, dt: number) => {
		if (s.frozen) return;
		const speed = finite(s.state.speed, 1);
		const pts = points(s.state);
		const blended = pts.reduce((sum, p) => sum + p.w * p.d, 0);
		s.clock += dt * speed;
		if (blended > 0) s.phase += (dt * speed) / blended;
		if (s.state.loop) s.phase = wrap(s.phase, 1);
		else s.phase = Math.min(s.phase, 1);
	};
	const timeIn = (s: Sampler, p: { d: number }) => {
		const synced = (s.state.blend || s.state.blend2d) && (s.state.sync ?? 'phase') === 'phase';
		const t = synced ? s.phase * p.d : s.clock;
		return s.state.loop ? wrap(t, p.d) : Math.min(Math.max(t, 0), p.d);
	};

	const current: (Sampler | undefined)[] = layers.map(() => undefined);
	const previous: (Sampler | undefined)[] = layers.map(() => undefined);
	const stateById = (layer: SmLayer3d, id: string) => layer.states.find((s) => s.id === id);

	return {
		setInput: (id, v) => void runner.setInput(id, v),
		fire: (id) => void runner.fire(id),
		input: (id) => runner.input(id),
		regions,
		missingClips: [...missingClips],
		advance(dtIn) {
			const dt = Math.max(finite(dtIn, 0), 0);
			const step = runner.advance(dt);
			const plays = runner.plays();
			const contributions: Contribution[] = [];
			const cues: string[] = [];
			const states: Record<string, string> = {};
			// Per layer: its pieces before the cover from later layers, and its coverage.
			const pending: { clip: string; time: number; weight: number }[][] = [];
			const coverage: number[] = [];
			const weightOf: number[] = [];
			layers.forEach((layer, i) => {
				const play = plays[i];
				states[layer.id] = play.state;
				let cur = current[i];
				if (!cur || cur.state.id !== play.state) {
					const fired = step.fired.filter((f) => f.layer === layer.id).at(-1);
					const transition = fired && layer.transitions.find((t) => t.id === fired.transition);
					previous[i] = play.from && cur ? cur : undefined;
					if (previous[i] && transition?.pauseSource === true) previous[i]!.frozen = true;
					cur = sampler(stateById(layer, play.state), play.time);
					// The runner may already have moved the state on (the entry state, on the first
					// step): its phase starts where that clock is.
					if (cur) {
						const blended = points(cur.state).reduce((sum, p) => sum + p.w * p.d, 0);
						if (blended > 0)
							cur.phase = cur.state.loop
								? wrap(cur.clock / blended, 1)
								: Math.min(cur.clock / blended, 1);
					}
					current[i] = cur;
				} else {
					advanceSampler(cur, dt);
				}
				if (!play.from) previous[i] = undefined;
				const prev = previous[i];
				if (prev) advanceSampler(prev, dt);
				const progress = play.from ? finite(play.from.progress, 1) : 1;
				const pieces: { clip: string; time: number; weight: number }[] = [];
				const emit = (s: Sampler | undefined, share: number, cueing: boolean) => {
					if (!s || share <= 0) return;
					const pts = points(s.state);
					let lead: { clip: string; w: number; d: number } | undefined;
					for (const p of pts) {
						if (p.w <= 0) continue;
						const time = timeIn(s, p);
						pieces.push({ clip: p.clip, time, weight: p.w * share });
						if (!lead || p.w > lead.w) lead = p;
					}
					if (!cueing || !lead) return;
					const time = timeIn(s, lead);
					const before = s.last.get(lead.clip);
					s.last.set(lead.clip, time);
					for (const cue of doc.clips?.[lead.clip]?.cues ?? []) {
						const crossed =
							before === undefined
								? time >= cue.at && cue.at === 0
								: before <= time
									? before < cue.at && cue.at <= time
									: cue.at > before || cue.at <= time;
						if (crossed) cues.push(`${lead.clip}:${cue.cue}`);
					}
				};
				emit(cur, progress, true);
				emit(prev, 1 - progress, false);
				pending.push(pieces);
				coverage.push(
					Math.min(
						pieces.reduce((sum, p) => sum + p.weight, 0),
						1,
					),
				);
				const w = layer.disabled ? 0 : layer.weightInput ? value(layer.weightInput) : 1;
				weightOf.push(Math.min(Math.max(w, 0), 1));
			});
			layers.forEach((layer, i) => {
				const mode = layer.mode ?? 'override';
				for (const region of layerRegions[i]) {
					const keep = region.coveredBy.reduce((k, j) => k * (1 - weightOf[j] * coverage[j]), 1);
					const scale = weightOf[i] * keep;
					if (scale <= 0) continue;
					for (const piece of pending[i])
						contributions.push({
							...piece,
							weight: piece.weight * scale,
							mode,
							region: region.key,
						});
				}
			});
			return { contributions, cues, states };
		},
	};
}
