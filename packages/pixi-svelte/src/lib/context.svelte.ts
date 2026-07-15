import type * as PIXI from 'pixi.js';
import { setContext, getContext, onMount } from 'svelte';
import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

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

// Spine context
const SPINE_NS = '@@pixi_spine';
export function setContextSpine(value: SPINE_PIXI.Spine) {
	setContext(SPINE_NS, value);
}
export function getContextSpine() {
	return getContext(SPINE_NS) as SPINE_PIXI.Spine;
}

// FX portal context
//
// Optional escape hatch for a rig-timeline effect (`<RiggedEffect>`): a container OUTSIDE any
// clipping ancestor (e.g. a reel-window board mask) that the effect subtree renders into instead
// of parenting on the host spine. When present, `<RiggedEffect>` mounts its `fxParent` here and
// per-frame mirrors the host spine's WORLD transform onto it, so the effect is transform-identical
// to the spine-parented default but is no longer clipped by the mask (an always-on idle-bound FX
// then shows its full frame). Absent ⇒ the effect stays parented on the host spine (unchanged),
// so every non-portalled usage (layout spines, the win/animate layer) is byte-identical.
const FX_PORTAL_NS = '@@pixi_fx_portal';
export function setContextFxPortal(value: PIXI.Container) {
	setContext(FX_PORTAL_NS, value);
}
export function getContextFxPortal() {
	return getContext(FX_PORTAL_NS) as PIXI.Container | undefined;
}

// Spine event context
const SPINE_EVENT_EMITTER_NS = '@@pixi_spine_event_emitter';
export function setContextSpineEventEmitter(value: PIXI.EventEmitter) {
	setContext(SPINE_EVENT_EMITTER_NS, value);
}
export function getContextSpineEventEmitter() {
	return getContext(SPINE_EVENT_EMITTER_NS) as PIXI.EventEmitter;
}
