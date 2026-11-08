import type * as PIXI from 'pixi.js';
import { setContext, getContext, onMount, untrack } from 'svelte';
import * as RIG from 'engine-rig/pixi';

import type { App as ContextApp } from './createApp.svelte';

// App context
const APP_NS = '@@pixi_svelte';
export function setContextApp(value: ContextApp) {
	setContext(APP_NS, value);
}
export function getContextApp() {
	return getContext(APP_NS) as ContextApp;
}

// Parent context
const PARENT_NS = '@@pixi_parent';
export function createContextParent(value: PIXI.Container) {
	const addToParent = (node: PIXI.ContainerChild) => {
		onMount(() => {
			context.parent.addChild(node);
			context.parent.sortChildren();

			return () => {
				if (node) node.destroy(); // Equivalent to onDestroy(); Leave this comment for searching.
			};
		});
	};

	const context = { parent: value, addToParent };

	setContext(PARENT_NS, context);

	return context;
}
export function getContextParent() {
	return getContext(PARENT_NS) as ReturnType<typeof createContextParent>;
}

// Particle context
const PARTICLE_PARENT_NS = '@@pixi_particle_parent';
export function setContextParticleParent(value: PIXI.ParticleContainer) {
	setContext(PARTICLE_PARENT_NS, value);
}
export function getContextParticleParent() {
	return getContext(PARTICLE_PARENT_NS) as PIXI.ParticleContainer;
}

// Rig context
const RIG_NS = '@@pixi_rig';
export function setContextRig(value: RIG.RigView) {
	setContext(RIG_NS, value);
}
export function getContextRig() {
	return getContext(RIG_NS) as RIG.RigView;
}

// Rig LOAD-scale context — the `parser.scale` the host rig's bundle was read with (see
// `rigLoadScale.ts`). Set by `<RigProvider>`; read by content bound INTO the rig
// (`<RiggedEffect>`, `<RiggedFlipbook>`, `<RigBoneAttach rigUnits>`), which is authored in RIG
// units: the Rigger and /symbols load every rig at 1, so there 1 clip px = 1 rig unit, while a
// symbol bundle is read at 2 — the reader scales bone POSITIONS and attachment geometry but never a
// bone's own scaleX/scaleY, and a Pixi child riding a bone follows only that scale. Without this
// factor a bound clip drew at HALF its authored size on the board and at full size in every tool.
const RIG_LOAD_SCALE_NS = '@@pixi_rig_load_scale';
export function setContextRigLoadScale(value: () => number) {
	setContext(RIG_LOAD_SCALE_NS, value);
}
/** The host rig's load scale as a getter; `1` outside a `<RigProvider>`. */
export function getContextRigLoadScale(): () => number {
	return (getContext(RIG_LOAD_SCALE_NS) as (() => number) | undefined) ?? (() => 1);
}

// A screen that a timeline drives without remounting it hands its content a RESTART key: each new
// play changes it, and what a remount would have restarted (a rig's track, a component's state
// machine, an effect) starts again from the top.
const RESTART_NS = '@@pixi_restart';
export function setContextRestart(value: () => unknown) {
	setContext(RESTART_NS, value);
}
/** The restart key as a getter; `undefined` outside such a screen. */
export function getContextRestart(): (() => unknown) | undefined {
	return getContext(RESTART_NS) as (() => unknown) | undefined;
}
/**
 * Run `fn`, untracked, each time `restart`'s key changes from now on — before the render effects
 * and the user effects of that flush, so what it resets is reset before anything that reads it runs
 * again, parent before child, as a mount orders them. Without a key (every screen that is remounted
 * instead) it adds nothing.
 */
export function onRestart(restart: (() => unknown) | undefined, fn: () => void): void {
	if (!restart) return;
	let key = untrack(restart);
	$effect.pre(() => {
		const next = restart();
		if (next === key) return;
		key = next;
		untrack(fn);
	});
}

// Rig event context
const RIG_EVENT_EMITTER_NS = '@@pixi_rig_event_emitter';
export function setContextRigEventEmitter(value: PIXI.EventEmitter) {
	setContext(RIG_EVENT_EMITTER_NS, value);
}
export function getContextRigEventEmitter() {
	return getContext(RIG_EVENT_EMITTER_NS) as PIXI.EventEmitter;
}
