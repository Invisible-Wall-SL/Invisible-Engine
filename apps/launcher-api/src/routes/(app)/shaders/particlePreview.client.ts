/**
 * The Particles element of Invisible Shader Graph's preview (step 8d.7,
 * `docs/design/shader-graph-particles.md` §9): the edited effect drawn as a particle material on a
 * stock Burst or Fountain, through the game's own mount (`mountParticleMaterial`, the same renderer
 * and fallbacks `<ParticleEmitter material>` has), in the preview's Pixi app beside the element.
 *
 * Each particle has its own age, so this stage plays rather than poses: play, pause and restart.
 * The strength is a uniform write; the params play their defaults, as on the element.
 */
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import type { CustomElementFx } from 'constants-shared/elementFx';
import { bindArt, emitterDeltaSeconds, registerFxBehaviors } from 'engine-fx';
import {
	mountParticleMaterial,
	particleMaterialSlotsFor,
	type MountedParticleMaterial,
} from 'pixi-svelte/particleMaterial';
import { CanvasSource, Container, Texture, type Application, type Ticker } from 'pixi.js';
import { layerEmitter } from '$lib/fx/layerMaterial.client';
import {
	PARTICLE_VIEW,
	particlePreviewConfig,
	particleScale,
	type ParticlePreviewShape,
} from './particlePreview';
import type { RegionArt } from './shaderPreview.client';

/** How far a paused stage plays a rebuilt emitter (wall ms), a frame at a time. */
const PAUSED_PREWARM_MS = 500;
const FRAME_MS = 1000 / 60;

// The material binds `fxMaterial` into the emitter's config: the library must know it (idempotent).
registerFxBehaviors(Emitter);

/** How the particles draw: through the material, plain (and why), or not at all (no effect). */
export type ParticlePreviewState = 'on' | 'none' | MountedParticleMaterial['state'];

/** A soft white dot, the particles' art until a region is picked. */
function softDot(resolution: number): Texture {
	const size = 32 * resolution;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const r = size / 2;
		const g = ctx.createRadialGradient(r, r, 0, r, r, r);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, size, size);
	}
	return new Texture({
		source: new CanvasSource({ resource: canvas, resolution }),
		label: 'shader-preview-dot',
	});
}

export class ParticlePreviewStage {
	/** Centred and scaled so the stage's smaller side is {@link PARTICLE_VIEW} units. */
	private readonly world = new Container({ label: 'shader preview particles' });
	private readonly dot: Texture;
	private region: Texture | undefined;
	private artToken = 0;
	private effect: CustomElementFx | undefined;
	private shape: ParticlePreviewShape = 'burst';
	private intensity = 1;
	private visible = false;
	private mounted: MountedParticleMaterial | undefined;
	private emitter: Emitter | undefined;
	private config: EmitterConfigV3 | undefined;
	private destroyed = false;
	/** Whether the particles move: paused, the material still answers a strength change. */
	playing = true;

	constructor(
		private readonly app: Application,
		private readonly art: RegionArt,
	) {
		this.dot = softDot(Math.min(3, Math.max(1, Math.ceil(app.renderer.resolution))));
		this.world.visible = false;
		app.stage.addChild(this.world);
		app.ticker.add(this.tick);
		this.layout();
	}

	/** How the particles draw now. */
	get state(): ParticlePreviewState {
		const mounted = this.mounted;
		if (!mounted) return 'none';
		return mounted.material ? (mounted.material.plain ?? 'on') : mounted.state;
	}

	/** Shown (the preview's element is Particles) or hidden, holding no emitter. */
	setVisible(visible: boolean): void {
		if (this.visible === visible) return;
		this.visible = visible;
		this.world.visible = visible;
		this.rebuild();
	}

	/** Draw `effect` (registered, as the element stage registered it), or nothing. */
	show(effect: CustomElementFx | undefined): void {
		if (this.effect === effect) return;
		this.effect = effect;
		this.rebuild();
	}

	setShape(shape: ParticlePreviewShape): void {
		if (this.shape === shape) return;
		this.shape = shape;
		this.rebuild();
	}

	/** The material's strength: a uniform write, mirrored at once so a paused stage shows it. */
	setIntensity(intensity: number): void {
		this.intensity = intensity;
		const material = this.mounted?.material;
		if (!material) return;
		material.setIntensity(intensity);
		material.sync(this.app.renderer);
	}

	/** Every particle gone and the emitter started again, as at its first frame. */
	restart(): void {
		const material = this.mounted?.material;
		if (!this.emitter || !this.config) return;
		this.emitter.init(material ? material.bindConfig(this.config) : this.config);
		material?.sync(this.app.renderer);
	}

	/** The particles on the soft dot. Cancels a region still loading. */
	useDot(): void {
		this.artToken++;
		this.setRegion(undefined);
	}

	/**
	 * The particles on an atlas region once it has loaded. Resolves false when a later choice
	 * overtook it; rejects when it cannot load, and the particles go back to the dot.
	 */
	async useRegion(manifestKey: string, name: string): Promise<boolean> {
		const token = ++this.artToken;
		let texture: Texture;
		try {
			texture = await this.art.texture(manifestKey, name);
		} catch (err) {
			if (token !== this.artToken || this.destroyed) return false;
			this.setRegion(undefined);
			throw err;
		}
		if (token !== this.artToken || this.destroyed) {
			texture.destroy();
			return false;
		}
		this.setRegion(texture);
		return true;
	}

	resize(): void {
		this.layout();
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.artToken++;
		this.app.ticker.remove(this.tick);
		this.teardown();
		this.world.destroy({ children: true });
		this.region?.destroy();
		this.region = undefined;
		this.dot.destroy(true);
	}

	private setRegion(texture: Texture | undefined): void {
		if (this.destroyed || this.region === texture) return;
		const previous = this.region;
		this.region = texture;
		this.rebuild();
		previous?.destroy();
	}

	private layout(): void {
		const { width, height } = this.app.screen;
		this.world.position.set(width / 2, height / 2);
		this.world.scale.set(Math.min(width, height) / PARTICLE_VIEW);
	}

	private teardown(): void {
		if (this.emitter) {
			this.emitter.emit = false;
			this.emitter.destroy();
			this.emitter = undefined;
		}
		this.mounted?.release();
		this.mounted = undefined;
		this.config = undefined;
	}

	/** The emitter and its material built again: the renderer reads its spec at mount. */
	private rebuild(): void {
		this.teardown();
		const effect = this.effect;
		if (this.destroyed || !this.visible || !effect) return;
		const texture = this.region ?? this.dot;
		const { width, height } = texture.orig;
		const config = particlePreviewConfig(this.shape, particleScale(this.shape, width, height));
		this.mounted = mountParticleMaterial({
			spec: { kind: effect.spec.kind, intensity: this.intensity, label: 'shaders/preview' },
			host: this.world,
			textures: [texture],
			maxParticles: config.maxParticles,
			rigParticles: false,
			slots: particleMaterialSlotsFor(this.app),
		});
		this.config = bindArt(config, [texture], false);
		this.emitter = layerEmitter(this.world, this.config, this.mounted);
		// Paused, nothing would advance a new emitter: play it a moment, so an edit shows particles.
		if (!this.playing)
			for (let ms = 0; ms < PAUSED_PREWARM_MS; ms += FRAME_MS)
				this.emitter.update(emitterDeltaSeconds(FRAME_MS));
		this.mounted.material?.sync(this.app.renderer);
	}

	private readonly tick = (ticker: Ticker): void => {
		if (!this.emitter || !this.playing) return;
		this.emitter.update(emitterDeltaSeconds(ticker.deltaMS));
		this.mounted?.material?.sync(this.app.renderer);
	};
}
