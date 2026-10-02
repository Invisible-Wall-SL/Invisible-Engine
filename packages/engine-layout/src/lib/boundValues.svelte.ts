import { untrack } from 'svelte';

import { getComponentValueSource } from './registerComponentValues';
import type { ValueBinding } from './types';
import {
	bindingInput,
	evaluateBinding,
	resolveBindingInputs,
	smoothedValue,
	type BindingInputRef,
} from './valueBindings';

/** A node's live value-binding outputs, one per binding (`undefined` = no value yet). */
export type BoundValues = { readonly outputs: readonly (number | undefined)[] };

const NONE: BoundValues = { outputs: [] };

/**
 * The live outputs of a node's value bindings (Phase 12b) — the reactive half of `valueBindings.ts`,
 * for `<LayoutNodeView>`. Call during component init. Each binding's inputs resolve against the
 * owning instance's params (`params`, read reactively): a `param` input reads the param, a `source`
 * input subscribes the engine value source, and the two engine subscriptions per name are shared.
 * A source the game never registered leaves its binding without a value — the node renders as
 * authored. A binding with `smooth` glides to each new output over that many seconds on a frame
 * clock; everything else snaps. No bindings ⇒ one shared empty result, no effect, no subscription.
 */
export function createBoundValues(
	bindings: readonly ValueBinding[] | undefined,
	params: () => Record<string, unknown>,
	frameCount: () => number | undefined,
): BoundValues {
	if (!bindings?.length) return NONE;

	const inputs = $derived(bindings.map((binding) => resolveBindingInputs(binding, params())));
	// The engine sources to subscribe, as one string so a re-resolve that names the same sources
	// (a param getter re-running) does not tear the subscriptions down.
	const sourceKey = $derived(
		inputs
			.flatMap((input) =>
				input
					? [input.value, input.of].flatMap((ref) => (ref && 'source' in ref ? [ref.source] : []))
					: [],
			)
			.filter((name, i, names) => names.indexOf(name) === i)
			.join('\n'),
	);
	const sourceValues = $state<Record<string, unknown>>({});
	$effect(() => {
		const names = sourceKey ? sourceKey.split('\n') : [];
		// Untracked: a source emits synchronously on subscribe, and that write must not become a
		// dependency of this effect (the `ComponentInstance` signal-subscribe discipline).
		return untrack(() => {
			const unsubs = names.flatMap((name) => {
				const source = getComponentValueSource(name);
				return source ? [source.subscribe((value) => (sourceValues[name] = value))] : [];
			});
			return () => {
				for (const unsub of unsubs) unsub();
			};
		});
	});

	const read = (ref: BindingInputRef, current: Record<string, unknown>): unknown =>
		'param' in ref ? current[ref.param] : sourceValues[ref.source];
	const targets = $derived(
		inputs.map((input, i) => {
			if (!input) return undefined;
			const current = params();
			const value = bindingInput(
				read(input.value, current),
				input.of ? read(input.of, current) : undefined,
				!!input.of,
			);
			return value === undefined ? undefined : evaluateBinding(bindings[i], value, frameCount());
		}),
	);

	const smooths = bindings.map((binding) =>
		binding.target !== 'visible' && binding.smooth && binding.smooth > 0 ? binding.smooth : 0,
	);
	if (!smooths.some((s) => s > 0)) {
		return {
			get outputs() {
				return targets;
			},
		};
	}

	// Smoothed outputs: the first value snaps (a pot that mounts half full shows half full), each
	// later change glides from where the output IS to the new target.
	const shown = $state<(number | undefined)[]>([]);
	const glides: ({ from: number; to: number; start: number } | undefined)[] = [];
	let raf = 0;
	const tick = (now: number): void => {
		raf = 0;
		let moving = false;
		glides.forEach((glide, i) => {
			if (!glide) return;
			const elapsed = (now - glide.start) / 1000;
			shown[i] = smoothedValue(glide.from, glide.to, elapsed, smooths[i]);
			if (elapsed >= smooths[i]) glides[i] = undefined;
			else moving = true;
		});
		if (moving) raf = requestAnimationFrame(tick);
	};
	$effect(() => {
		const next = targets;
		untrack(() => {
			next.forEach((target, i) => {
				const current = shown[i];
				if (!smooths[i] || target === undefined || current === undefined) {
					glides[i] = undefined;
					shown[i] = target;
					return;
				}
				if (target === (glides[i]?.to ?? current)) return;
				glides[i] = { from: current, to: target, start: performance.now() };
			});
			if (!raf && glides.some(Boolean)) raf = requestAnimationFrame(tick);
		});
	});
	$effect(() => () => {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
	});

	return {
		get outputs() {
			return shown;
		},
	};
}
