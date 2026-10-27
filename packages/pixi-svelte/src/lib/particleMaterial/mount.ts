/**
 * Mounting a layer's MATERIAL in a game (Invisible Shader Graph step 8d.3,
 * `docs/design/shader-graph-particles.md` §6 / §10): what `<ParticleEmitter material>` does before it
 * builds its emitter, kept out of the component so a coded emitter can take a material the same way.
 *
 * Decided once, at mount, and kept for the layer's life (nothing pops): a layer draws plain when its
 * particles are Tier-C rig views, when its kind is not registered (`setCustomElementFx`), when its
 * game (one Pixi app, {@link particleMaterialSlotsFor}) already has 8 material layers drawing, or
 * when its renderer refuses it at once (a body the shell refuses, Max particles over 512 or a drive
 * that can raise it there, no frames, frames on several texture sources). A renderer that is
 * refused is destroyed, so a plain layer is exactly a layer with no material. One that turns plain
 * while it plays (not WebGL, a program that does not link, a frame on another source) keeps its
 * sprites shown for good and gives its slot back. A renderer whose construction throws gives its
 * slot back before the error goes on.
 *
 * `?fxdebug=1` on the page logs each material layer's state as it mounts and when it turns plain,
 * and, while a layer draws, its peak covered pixels as they grow (at most once per 2 s a layer) and
 * again when it is released: the most pixels its quads covered at once, and, when the effect carries
 * its graph's cost (one made for particles), that × the cost: its peak load (design §10).
 */

import { customElementFx } from 'constants-shared/elementFx';
import {
	createFxMaterialSlots,
	fxMaterialMount,
	type EmitterMaterial,
	type FxMaterialMountPlain,
	type FxMaterialSlots,
} from 'engine-fx';
import type { Container, Texture } from 'pixi.js';
import { ParticleMaterial, type ParticleMaterialPlain } from './ParticleMaterial';

const appSlots = new WeakMap<object, FxMaterialSlots>();

/**
 * The material layers drawing at once in one game (design §10's cap of 8): one count per Pixi app,
 * keyed by its app state (`createApp`'s `stateApp`), so a page with several apps (an editor canvas
 * beside a preview) gives each its own 8.
 */
export function particleMaterialSlotsFor(app: object): FxMaterialSlots {
	let slots = appSlots.get(app);
	if (!slots) appSlots.set(app, (slots = createFxMaterialSlots()));
	return slots;
}

/** A material as an emitter takes it: an `EmitterLayer.material`, or one a coded emitter names. */
export interface ParticleMaterialSpec extends Omit<EmitterMaterial, 'kind'> {
	kind: string;
	/** The most particles a drive can raise the layer to (`fxMaterialPeakParticles`). */
	peakParticles?: number;
	/** Names the layer in the `?fxdebug=1` lines. */
	label?: string;
}

export interface MountedParticleMaterial {
	/** The renderer the emitter spawns into; undefined when the layer is plain from mount. */
	readonly material: ParticleMaterial | undefined;
	/** `on`, or why the layer draws plain (as it was decided at mount). */
	readonly state: 'on' | FxMaterialMountPlain | ParticleMaterialPlain;
	/** Destroy the renderer and give its slot back. Destroy the emitter first. */
	release(): void;
}

let debugging: boolean | undefined;
const debug = (): boolean =>
	(debugging ??=
		typeof location !== 'undefined' && new URLSearchParams(location.search).has('fxdebug'));

/** A count for a debug line, as `1.24 M`, `86.0 k`, `512`, with its unit after (`1.24 Mpx`). */
const amount = (n: number, unit = ''): string =>
	n >= 1e6
		? `${(n / 1e6).toFixed(2)} M${unit}`
		: n >= 1e3
			? `${(n / 1e3).toFixed(1)} k${unit}`
			: `${Math.round(n)}${unit ? ` ${unit}` : ''}`;

/** A layer's peak for a debug line: covered pixels, and its load when the cost is known. */
const peakText = (covered: number, cost: number | undefined): string =>
	`its peak ${amount(covered, 'px')} covered` +
	(cost === undefined ? '' : `, load ${amount(covered * cost)}`);

function report(spec: ParticleMaterialSpec, state: string, slots: FxMaterialSlots): void {
	if (!debug()) return;
	console.log(
		`[fxdebug] material layer ${spec.label ?? '(unnamed)'}: ${state} (${spec.kind}; ${slots.drawing}/${slots.cap} drawing)`,
	);
}

/** The most often a layer's growing peak is printed. */
const PEAK_REPORT_MS = 2000;

/** Print a layer's peak covered pixels as it grows, at most once per {@link PEAK_REPORT_MS}. */
function peakReporter(
	spec: ParticleMaterialSpec,
	slots: FxMaterialSlots,
	cost: number | undefined,
): (covered: number) => void {
	let last = -Infinity;
	return (covered) => {
		const now = performance.now();
		if (now - last < PEAK_REPORT_MS) return;
		last = now;
		report(spec, `on, ${peakText(covered, cost)}`, slots);
	};
}

export function mountParticleMaterial(options: {
	spec: ParticleMaterialSpec;
	/** The emitter's parent: the hidden sprites and the mesh go into it. */
	host: Container;
	/** The layer's frames, as bound. */
	textures: readonly Texture[];
	/** The layer's Max particles at mount (not a positive number = the library's 1000). */
	maxParticles: number;
	/** Tier C: the particles are pooled rig views. */
	rigParticles: boolean;
	emitSpeed?: number;
	/** The game's count ({@link particleMaterialSlotsFor}). */
	slots: FxMaterialSlots;
}): MountedParticleMaterial {
	const { spec, slots } = options;
	const effect = customElementFx(spec.kind);
	const decided = fxMaterialMount({
		rigParticles: options.rigParticles,
		registered: !!effect,
		slots,
	});
	if (!decided.on) {
		report(spec, `plain, ${decided.plain}`, slots);
		return { material: undefined, state: decided.plain, release: () => {} };
	}
	let held = true;
	const giveBack = (): void => {
		if (!held) return;
		held = false;
		slots.release();
	};
	let material: ParticleMaterial;
	try {
		material = new ParticleMaterial({
			host: options.host,
			effect,
			maxParticles: options.maxParticles,
			peakParticles: spec.peakParticles,
			textures: options.textures,
			time: spec.time,
			intensity: spec.intensity,
			params: spec.params,
			emitSpeed: options.emitSpeed,
			onPlain: (reason) => {
				giveBack();
				report(spec, `plain while playing, ${reason}`, slots);
			},
			onPeak: debug() ? peakReporter(spec, slots, effect?.cost) : undefined,
		});
	} catch (error) {
		giveBack();
		throw error;
	}
	const refused = material.plain;
	if (refused) {
		material.destroy();
		giveBack();
		report(spec, `plain, ${refused}`, slots);
		return { material: undefined, state: refused, release: () => {} };
	}
	report(spec, 'on', slots);
	return {
		material,
		state: 'on',
		release: () => {
			const peak = material.peakCoveredArea;
			material.destroy();
			giveBack();
			report(spec, `released, ${peakText(peak, effect?.cost)}`, slots);
		},
	};
}
