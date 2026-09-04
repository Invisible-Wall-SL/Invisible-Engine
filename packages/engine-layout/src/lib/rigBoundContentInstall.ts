/**
 * Wire this package's rig-timeline registries into `pixi-svelte`'s {@link setRigBoundContentResolver}
 * seam, so `<SpineProvider>` plays a rig's bound effects + clips for EVERY rig, whatever mounted it.
 *
 * Why an install call rather than a direct import: `pixi-svelte` sits BELOW this package
 * (`engine-layout` imports it, not the other way), so `SpineProvider` cannot read `resolveRigFx` /
 * `resolveEffect` itself. The lower package declares the shape, this one fills it in — the same
 * inversion `registerFxBehaviors(Emitter)` uses to keep `engine-fx` PixiJS-free.
 *
 * Why it needs no boot step: a rig can only have bound content if the game registered a manifest
 * for it, so {@link registerRigFx} and {@link registerRigFlipbooks} install this themselves. A game
 * that authored no bindings never installs it and every rig resolves to the shared frozen empty;
 * a game that did gets it before the first rig can render, because registration happens in the same
 * boot block that loads the doc. Nothing to remember, nothing to forget.
 */
import { foldFlipbookPlayback, resolveFlipbook } from './registerFlipbooks';
import { resolveEffect } from './registerEffects';
import { resolveRigFlipbooks } from './registerRigFlipbooks';
import { resolveRigFx } from './registerRigFx';
import { rigBeatKey } from './rigBeat';
// The SUBPATH, deliberately not the `pixi-svelte` barrel. This module is imported by
// `registerRigFx` / `registerRigFlipbooks`, which the game's `editor-scenes` pulls in, and which
// SvelteKit analyses during SSR prerender. Importing the barrel for these two VALUES drags every
// pixi-svelte component behind them — including `webfontloader`, which touches `window` at import
// time and crashes the route analysis. `pixi-svelte/rigBoundContent` is a leaf: two functions, a
// frozen empty, and type-only imports.
import {
	EMPTY_RIG_BOUND_CONTENT,
	setRigBoundContentResolver,
	type RigBoundContent,
	type RigBoundEffect,
	type RigBoundFlipbook,
} from 'pixi-svelte/rigBoundContent';

/**
 * Resolve one rig's bindings into mount-ready props.
 *
 * A binding whose effect / clip id resolves to nothing is DROPPED, not mounted empty — a dangling
 * or un-baked id has always rendered nothing, and that stays true here rather than becoming a
 * crash inside a rig's render.
 */
function resolveFor(rigKey: string): RigBoundContent {
	const fxBinds = resolveRigFx(rigKey);
	const clipBinds = resolveRigFlipbooks(rigKey);
	if (fxBinds.length === 0 && clipBinds.length === 0) return EMPTY_RIG_BOUND_CONTENT;

	const effects: RigBoundEffect[] = [];
	for (const b of fxBinds) {
		const doc = resolveEffect(b.effectId);
		if (!doc) continue;
		effects.push({
			key: `${rigBeatKey(b)}${b.effectId}:${b.bone ?? ''}:${b.slot ?? ''}`,
			doc,
			event: b.event,
			animation: b.animation,
			time: b.time,
			bone: b.bone,
			// `slot` → `drawSlot`: Svelte reads a `slot` attribute on a component as the legacy slot
			// assignment, so `<RiggedEffect>` cannot take the field under its authored name.
			drawSlot: b.slot,
			alpha: b.alpha,
			scale: b.scale,
			delay: b.delay,
			duration: b.duration,
			speed: b.speed,
			continuous: b.continuous,
		});
	}

	const flipbooks: RigBoundFlipbook[] = [];
	for (const b of clipBinds) {
		const registered = resolveFlipbook(b.clipId);
		if (!registered) continue;
		flipbooks.push({
			key: `${rigBeatKey(b)}${b.clipId}:${b.bone ?? ''}:${b.slot ?? ''}`,
			// Folded HERE, not passed beside the clip: `direction` decides the texture array
			// `<Flipbook>` builds, so two answers in flight would walk the frames one way while
			// everything else assumed another. Same fold a placed node and a symbol cell use.
			clip: foldFlipbookPlayback(registered, b),
			event: b.event,
			animation: b.animation,
			time: b.time,
			bone: b.bone,
			drawSlot: b.slot,
			alpha: b.alpha,
			scale: b.scale,
			delay: b.delay,
			duration: b.duration,
			continuous: b.continuous,
		});
	}

	return effects.length === 0 && flipbooks.length === 0
		? EMPTY_RIG_BOUND_CONTENT
		: { effects, flipbooks };
}

/**
 * Install the resolver. Idempotent BY CONSTRUCTION — it writes the same function reference every
 * time, so both registries can call it on every registration. Deliberately no "already installed"
 * flag: that flag could fall out of step with the seam's real state (a direct
 * `setRigBoundContentResolver(undefined)`, which the `pixi-svelte` barrel exports, would leave the
 * seam dead AND make every later install a no-op), and it buys nothing over an idempotent write.
 *
 * Deliberately UNCACHED: the result is rebuilt per rig mount rather than memoized per key. The
 * registries are latest-wins and can be re-registered at any time (a re-bake, a test), so a cache
 * would need invalidating from four independent register calls — and the thing it would save is a
 * couple of `Map.get`s on a list that is nearly always empty, evaluated once per rig mount inside a
 * `$derived`, not per frame.
 */
export function installRigBoundContent(): void {
	setRigBoundContentResolver(resolveFor);
}

/** Tear the seam back down — tests/stories that clear the registries. */
export function uninstallRigBoundContent(): void {
	setRigBoundContentResolver(undefined);
}
