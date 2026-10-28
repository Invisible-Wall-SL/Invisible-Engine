/**
 * SCREEN TRANSITIONS (Invisible Shader Graph step 8e, `docs/design/shader-graph-screens.md` §8):
 * what a transition may play and how one is read. The Flow's `screenTransition` (its
 * `ScreenTransitionKind` dropdown), the layout doc's `settings.transitionCue` and the game all read
 * this, so none of them can name a transition the others would read differently.
 *
 * Dependency-free beyond the Element FX catalog, like it.
 */

import {
	ELEMENT_FX,
	isCustomElementFxKind,
	type ElementFxKind,
	type ElementFxKindId,
	type ElementFxParamValue,
} from './elementFx';

/** The built-in kinds a transition plays: every exit kind, played on a still of the old screen. */
export const SCREEN_TRANSITION_KINDS: readonly ElementFxKind[] = ELEMENT_FX.filter(
	(spec) => spec.phase === 'exit',
).map((spec) => spec.kind);

const BUILTIN = new Set<string>(SCREEN_TRANSITION_KINDS);

/** One of {@link SCREEN_TRANSITION_KINDS}. */
export const isBuiltinScreenTransitionKind = (value: unknown): value is ElementFxKind =>
	typeof value === 'string' && BUILTIN.has(value);

/** A kind a transition may name: a built-in exit kind, or a custom effect's, registered or not. */
export const isScreenTransitionKind = (value: unknown): value is ElementFxKindId =>
	isBuiltinScreenTransitionKind(value) || isCustomElementFxKind(value);

/** A transition's length and strength (§10: 50 ms to 5 s; strength as an Element FX's). */
export const SCREEN_TRANSITION_LIMITS = {
	durationMs: { min: 50, max: 5_000 },
	intensity: { min: 0, max: 4 },
} as const;

/** One transition as authored: the `transition` cue's row, or a Flow node's literals. */
export interface ScreenTransitionSpec {
	/** A built-in exit kind or `custom:<id>`. */
	kind: ElementFxKindId;
	/** Unset ⇒ the effect's own length. */
	durationMs?: number;
	/** Unset ⇒ 1. */
	intensity?: number;
	/** The effect's own knobs, by param id. */
	params?: Record<string, ElementFxParamValue>;
}

const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const clamped = (value: unknown, limits: { min: number; max: number }): number | undefined =>
	finite(value) ? Math.min(limits.max, Math.max(limits.min, value)) : undefined;

const readParams = (value: unknown): Record<string, ElementFxParamValue> | undefined => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const out: Record<string, ElementFxParamValue> = {};
	for (const [id, param] of Object.entries(value)) {
		if (!id) continue;
		if (finite(param) || typeof param === 'string' || typeof param === 'boolean') out[id] = param;
	}
	return Object.keys(out).length ? out : undefined;
};

/**
 * One transition as the game and the launcher read it, or `undefined` when it names no transition
 * kind (absent, malformed, or a built-in that is not an exit). The length and strength are
 * clamped; an unknown field, a malformed one and a non-primitive param are dropped.
 */
export function readScreenTransition(raw: unknown): ScreenTransitionSpec | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const value = raw as Record<string, unknown>;
	if (!isScreenTransitionKind(value.kind)) return undefined;
	const durationMs = clamped(value.durationMs, SCREEN_TRANSITION_LIMITS.durationMs);
	const intensity = clamped(value.intensity, SCREEN_TRANSITION_LIMITS.intensity);
	const params = readParams(value.params);
	return {
		kind: value.kind,
		...(durationMs !== undefined ? { durationMs } : {}),
		...(intensity !== undefined ? { intensity } : {}),
		...(params ? { params } : {}),
	};
}
