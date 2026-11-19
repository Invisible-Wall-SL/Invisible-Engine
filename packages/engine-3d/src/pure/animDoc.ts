import { validateStateMachine } from 'engine-layout/state-machine';
import type { ComponentStateMachine } from 'engine-layout/types';

import type { CharacterAnim3D, SmLayer3d } from './animGraph';

/**
 * The `CharacterAnim3D` docs of a game: `arcade.world3d.anim.<id>` in the raw Game Config, a look
 * naming one by `anim` (`pure/looks.ts`). Hand-written JSON until the Characters 3D tab (Phase 4);
 * shipped by the chain the config already travels, its clip libraries by `modelIds`.
 */
export function animDocsOf3d(raw: unknown): {
	docs: Record<string, CharacterAnim3D>;
	problems: string[];
} {
	const docs: Record<string, CharacterAnim3D> = {};
	const problems: string[] = [];
	if (raw === undefined) return { docs, problems };
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		return { docs, problems: ['arcade.world3d.anim: not an object'] };
	for (const [id, doc] of Object.entries(raw)) {
		const path = `arcade.world3d.anim.${id}`;
		const d = doc as Partial<CharacterAnim3D> | null;
		if (
			!d ||
			typeof d !== 'object' ||
			!Array.isArray(d.inputs) ||
			!Array.isArray(d.machine?.layers)
		) {
			problems.push(`${path}: needs inputs and machine.layers`);
			continue;
		}
		docs[id] = { ...(d as CharacterAnim3D), id };
	}
	return { docs, problems };
}

export type AnimIssue3d = {
	level: 'error' | 'warning';
	code: string;
	/** Where, as a path into the doc. */
	path: string;
	message: string;
};

const MODES = ['override', 'additive'];

/**
 * Every problem of a doc: the state machine's own (the 2D validator, on the doc's inputs and the
 * clips it can play), then the 3D additions — 2D blends (number inputs, ≥ 3 points, distinct
 * points), layer masks (named in `masks`, bones known), modes, weight inputs, the base layer (an
 * unmasked override), cues inside their clips. `clips` are the clip names and durations the
 * libraries bring and `bones` the skeleton's; either absent skips the checks that need it.
 */
export function validateCharacterAnim3d(
	doc: CharacterAnim3D,
	opts: { clips?: ReadonlyMap<string, number>; bones?: readonly string[] } = {},
): AnimIssue3d[] {
	const issues: AnimIssue3d[] = [];
	const add = (level: AnimIssue3d['level'], code: string, path: string, message: string) =>
		issues.push({ level, code, path, message });
	const layers: SmLayer3d[] = doc.machine.layers;
	const named = new Set<string>();
	for (const l of layers)
		for (const s of l.states) {
			if (s.timeline) named.add(s.timeline);
			for (const p of s.blend?.points ?? []) named.add(p.timeline);
			for (const p of s.blend2d?.points ?? []) named.add(p.timeline);
		}
	const known = opts.clips ? new Set(opts.clips.keys()) : named;
	const empty = new Set(
		layers.flatMap((l, i) => (i > 0 ? l.states.filter((s) => !s.timeline).map((s) => s.id) : [])),
	);
	for (const issue of validateStateMachine(
		{ inputs: doc.inputs, stateMachine: doc.machine as ComponentStateMachine },
		known,
	)) {
		// A layer above the base may rest in a state that plays nothing (its weight drops to 0).
		if (issue.code === 'state-no-timeline' && issue.state && empty.has(issue.state)) continue;
		const where = [issue.layer, issue.state, issue.transition].filter(Boolean).join('.');
		add(issue.level, issue.code, `machine${where ? `.${where}` : ''}`, issue.message);
	}

	const kinds = new Map(doc.inputs.map((i) => [i.id, i.kind]));
	const number = (id: string) => kinds.get(id) === 'number';
	const bones = opts.bones ? new Set(opts.bones) : undefined;
	for (const [name, mask] of Object.entries(doc.masks ?? {})) {
		if (!Array.isArray(mask.include) || !mask.include.length)
			add('error', 'mask-empty', `masks.${name}`, `Mask "${name}" includes no bone.`);
		if (bones)
			for (const b of [...(mask.include ?? []), ...(mask.exclude ?? [])])
				if (!bones.has(b)) add('error', 'mask-bone-unknown', `masks.${name}`, `No bone "${b}".`);
	}
	layers.forEach((layer, i) => {
		const path = `machine.${layer.id}`;
		const mode = layer.mode ?? 'override';
		if (!MODES.includes(mode))
			add('error', 'layer-mode-unknown', path, `Mode "${mode}" is not override or additive.`);
		if (layer.mask && !doc.masks?.[layer.mask])
			add('error', 'layer-mask-unknown', path, `Mask "${layer.mask}" is not in masks.`);
		if (layer.weightInput && !number(layer.weightInput))
			add(
				'error',
				'layer-weight-input',
				path,
				`Weight input "${layer.weightInput}" is not a number input.`,
			);
		if (i === 0 && (mode !== 'override' || layer.mask))
			add(
				'warning',
				'base-layer',
				path,
				'The first layer should be an unmasked override (the whole body).',
			);
		for (const state of layer.states) {
			const b = state.blend2d;
			if (!b) continue;
			const at = `${path}.${state.id}.blend2d`;
			for (const axis of [b.x, b.y])
				if (!number(axis)) add('error', 'blend2d-input', at, `"${axis}" is not a number input.`);
			if (b.points.length < 3)
				add('warning', 'blend2d-few-points', at, 'A 2D blend wants at least three points.');
			const seen = new Set<string>();
			for (const p of b.points) {
				const key = p.at.join(',');
				if (seen.has(key)) add('error', 'blend2d-duplicate-at', at, `Two points at (${key}).`);
				seen.add(key);
				if (!known.has(p.timeline))
					add('error', 'blend2d-clip-missing', at, `No clip "${p.timeline}".`);
			}
		}
	});
	for (const [clip, meta] of Object.entries(doc.clips ?? {})) {
		const duration = opts.clips?.get(clip);
		for (const cue of meta.cues ?? [])
			if (cue.at < 0 || (duration !== undefined && cue.at > duration))
				add(
					'warning',
					'cue-outside-clip',
					`clips.${clip}`,
					`Cue "${cue.cue}" at ${cue.at} s is outside the clip.`,
				);
	}
	return issues;
}
