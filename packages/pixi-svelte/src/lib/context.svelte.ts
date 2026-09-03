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

// Spine LOAD-scale context — the `parser.scale` the host rig's bundle was read with (see
// `spineLoadScale.ts`). Set by `<SpineProvider>`; read by content bound INTO the rig
// (`<RiggedEffect>`, `<RiggedFlipbook>`, `<SpineBoneAttach rigUnits>`), which is authored in RIG
// units: the Rigger and /symbols load every rig at 1, so there 1 clip px = 1 rig unit, while a
// symbol bundle is read at 2 — the reader scales bone POSITIONS and attachment geometry but never a
// bone's own scaleX/scaleY, and a Pixi child riding a bone follows only that scale. Without this
// factor a bound clip drew at HALF its authored size on the board and at full size in every tool.
const SPINE_LOAD_SCALE_NS = '@@pixi_spine_load_scale';
export function setContextSpineLoadScale(value: () => number) {
	setContext(SPINE_LOAD_SCALE_NS, value);
}
/** The host rig's load scale as a getter; `1` outside a `<SpineProvider>`. */
export function getContextSpineLoadScale(): () => number {
	return (getContext(SPINE_LOAD_SCALE_NS) as (() => number) | undefined) ?? (() => 1);
}

// Spine event context
const SPINE_EVENT_EMITTER_NS = '@@pixi_spine_event_emitter';
export function setContextSpineEventEmitter(value: PIXI.EventEmitter) {
	setContext(SPINE_EVENT_EMITTER_NS, value);
}
export function getContextSpineEventEmitter() {
	return getContext(SPINE_EVENT_EMITTER_NS) as PIXI.EventEmitter;
}
