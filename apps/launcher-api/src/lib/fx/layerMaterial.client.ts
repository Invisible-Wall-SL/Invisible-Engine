/**
 * A sprite layer's MATERIAL in a launcher stage (Invisible Shader Graph step 8d,
 * `docs/design/shader-graph-particles.md` §9 / §13 "Four renderers drift"): the one mount `/fx`'s
 * `FxStage`, the Scene Editor's `EditorEffectLayer` and the Rigger / Symbols `fxOverlay` share, so
 * each draws a material exactly as the game's `<ParticleEmitter material>` does — through
 * `mountParticleMaterial`, with the game's own fallbacks (unregistered kind, the cap of 8 per app,
 * over 512, no frames, frames on two sources, a program that does not link), each drawing plain.
 *
 * The renderer reads its spec at mount, so a stage that keeps a layer alive remounts it when
 * {@link layerMaterialKey} changes; a strength or param change is a uniform write
 * ({@link retuneLayerMaterial}).
 */
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { customElementFx, setCustomElementFx } from 'constants-shared/elementFx';
import {
	fxMaterialIntensity,
	fxMaterialPeakParticles,
	planLayer,
	type EffectParam,
	type EmitterLayer,
	type EmitterMaterial,
	type FxMaterialSlots,
} from 'engine-fx';
import {
	mountParticleMaterial,
	type MountedParticleMaterial,
	type ParticleMaterial,
} from 'pixi-svelte/particleMaterial';
import type { Container, Texture } from 'pixi.js';

/** A layer's material as the game reads it (`planLayer`: none on Tier-C rig particles). */
const materialOf = (layer: EmitterLayer): EmitterMaterial | undefined => planLayer(layer).material;

/** The most particles a drive can raise a material layer to (0 without a material). */
export const layerMaterialPeak = (
	layer: EmitterLayer,
	params: readonly EffectParam[] | undefined,
): number => (materialOf(layer) ? fxMaterialPeakParticles(layer, params) : 0);

/**
 * What the material's renderer reads at mount: its kind (and whether it is registered), its time,
 * the capacity (Max particles and `peak`, {@link layerMaterialPeak}) and the frames' texture
 * source. A change to any remounts it; `undefined` with no material.
 */
export function layerMaterialKey(
	layer: EmitterLayer,
	textures: readonly Texture[],
	peak: number,
): string | undefined {
	const m = materialOf(layer);
	if (!m) return undefined;
	const max = (layer.config as { maxParticles?: unknown }).maxParticles;
	const source = textures[0]?.source.uid ?? 'none';
	const registered = customElementFx(m.kind) ? 'r' : 'u';
	return `${m.kind}|${registered}|${m.time ?? 'life'}|${String(max)}|${peak}|${source}|${textures.length}`;
}

/** Mount a layer's material into `host` as the game does; none when the layer has no material. */
export function mountLayerMaterial(options: {
	layer: EmitterLayer;
	host: Container;
	textures: readonly Texture[];
	peak: number;
	/** The stage's count (`particleMaterialSlotsFor`). */
	slots: FxMaterialSlots;
	/** Names the layer in the `?fxdebug=1` lines. */
	label: string;
}): MountedParticleMaterial | undefined {
	const m = materialOf(options.layer);
	if (!m) return undefined;
	// A plain copy: the layer may be a Svelte proxy, and the renderer keeps what it is given.
	const spec = JSON.parse(JSON.stringify(m)) as EmitterMaterial;
	return mountParticleMaterial({
		spec: { ...spec, peakParticles: options.peak, label: options.label },
		host: options.host,
		textures: options.textures,
		maxParticles: Number((options.layer.config as { maxParticles?: unknown }).maxParticles),
		rigParticles: false,
		slots: options.slots,
	});
}

/**
 * The layer's emitter: into the material's hidden particle parent with `fxMaterial` bound when the
 * material is on, else straight into `host`, a layer with no material.
 */
export function layerEmitter(
	host: Container,
	config: EmitterConfigV3,
	mounted: MountedParticleMaterial | undefined,
): Emitter {
	const material = mounted?.material;
	return new Emitter(material?.particles ?? host, material ? material.bindConfig(config) : config);
}

/** Write a material's strength and params as uniforms: no remount, no reset. */
export function retuneLayerMaterial(
	material: ParticleMaterial,
	m: EmitterMaterial | undefined,
): void {
	material.setIntensity(fxMaterialIntensity(m?.intensity));
	material.setParams(m?.params);
}

/** How long a host waits for the compiled set before it draws every material layer plain. */
export const SHADER_EFFECTS_TIMEOUT_MS = 5000;

/**
 * Register the project's compiled shader effects (`GET /api/shaders/effects`, the session's
 * project) for a host with no page data to take them from: the Rigger's `view.html`, through the
 * vendored overlay bundle, whose registry is its own. True once registered; on any failure, or no
 * answer within `timeoutMs`, nothing is registered and every material layer draws plain.
 */
export async function loadShaderEffects(
	fetcher: typeof fetch = fetch,
	timeoutMs = SHADER_EFFECTS_TIMEOUT_MS,
): Promise<boolean> {
	try {
		const res = await fetcher('/api/shaders/effects', {
			credentials: 'same-origin',
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { effects?: unknown };
		if (!Array.isArray(body.effects)) return false;
		setCustomElementFx(body.effects);
		return true;
	} catch {
		return false;
	}
}
