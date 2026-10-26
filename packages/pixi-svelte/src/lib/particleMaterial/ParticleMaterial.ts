/**
 * The MATERIAL RENDERER (Invisible Shader Graph step 8d, `docs/design/shader-graph-particles.md`
 * §6): an emitter layer's particles drawn through a compiled Shader Graph effect, as ONE Pixi
 * `Mesh`.
 *
 *  - THE HIDDEN SPRITES. The emitter's particles go into {@link ParticleMaterial.particles}, a
 *    container the material keeps hidden, so Pixi neither transforms nor draws them. The library
 *    still owns their whole life.
 *  - THE MESH sits beside it in the layer's container, at its depth: one quad a particle, one draw
 *    call a layer, the layer's blend, the particles' atlas as its texture.
 *  - THE MIRROR ({@link ParticleMaterial.sync}, after each `emitter.update`) walks the hidden
 *    children in order (so `addAtBack` holds) and writes each particle's four vertices into one
 *    interleaved buffer, the layout `particleShell.ts`'s vertex shader declares: its corners from
 *    its own local transform, anchor and texture as Pixi builds a sprite's quad, but over the whole
 *    frame (untrimmed) and grown by the effect's padding; the atlas mapping for its current frame
 *    (a frame the atlas turned mapped as Pixi turns it); its trimmed box; its tint × alpha; its
 *    time, strength and the seed and indexes `fxMaterial` gave it. Only the live quads are drawn,
 *    and the mesh's bounds are theirs. WebGL2 uploads only the live part of the buffer; WebGL1's
 *    `bufferSubData` takes no length, so Pixi uploads the whole buffer there (its size is the
 *    layer's Max particles, not the cap).
 *
 * FAIL CLOSED, NEVER INVISIBLE: the layer draws as the plain sprites it would without a material
 * (the hidden container shown, no mesh) when the effect is missing, when the particle shell cannot
 * convert its body, when the layer's Max particles is over {@link PARTICLE_MATERIAL_CAPACITY} (one
 * that is not a positive number is the library's 1000, so over it too), when its frames are not
 * all on one texture source, when the renderer is not WebGL, or when the program does not compile
 * and link on this GPU (asked of the driver once, at first use, and logged once). A layer found
 * out while it plays (a drive raising Max particles past its value at mount, a frame on another
 * source) turns plain for the rest of its life.
 */

import {
	Bounds,
	Buffer,
	BufferUsage,
	Container,
	Geometry,
	GlProgram,
	Mesh,
	RendererType,
	Shader,
	UniformGroup,
	type Sprite,
	type Texture,
	type TextureSource,
} from 'pixi.js';
import {
	elementFxParamUniform,
	type CustomElementFx,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import {
	PARTICLE_ATTRIBUTES,
	PARTICLE_VERTEX,
	particleShellSource,
} from 'constants-shared/particleShell';
import { DEFAULT_EMIT_SPEED, FX_MATERIAL_KEYS, bindFxMaterial } from 'engine-fx';
import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { programLinks } from '../elementFx/shaders';

/** The most particles a material layer draws (design §10): a layer allowing more draws plain. */
export const PARTICLE_MATERIAL_CAPACITY = 512;

/** Why a material layer draws as plain sprites. */
export type ParticleMaterialPlain =
	| 'no effect'
	| 'shell refuses the body'
	| 'over capacity'
	| 'frames on several textures'
	| 'not WebGL'
	| 'program does not link';

/** How a material's Time input runs on a particle (§7): over its life, or looped at its length. */
export type ParticleMaterialTime = 'life' | 'loop';

export interface ParticleMaterialOptions {
	/** The layer's container: the hidden particles and the mesh go into it. */
	host: Container;
	/** The compiled effect; undefined (its kind not registered) draws plain. */
	effect: CustomElementFx | undefined;
	/** The layer's Max particles (the library's 1000 for a config that leaves it unset). */
	maxParticles: number;
	/** The layer's frames, as bound: they must share one texture source. */
	textures: readonly Texture[];
	time?: ParticleMaterialTime;
	/** The material's strength, 0…4 (absent = 1). */
	intensity?: number;
	/** The material's params by id; a param left out plays its default. */
	params?: Readonly<Record<string, unknown>>;
	/** The emitter's emit speed (emitter seconds per wall millisecond), for the Seconds input. */
	emitSpeed?: number;
}

/** The renderer the frame draws on (what the Element FX link check takes). */
type MaterialRenderer = Parameters<typeof programLinks>[0];

/** The library's `Particle`: a sprite with its life and scratch bag. */
type MaterialParticle = Sprite & {
	age: number;
	agePercent: number;
	config: Record<string, unknown>;
};

const FORMATS: Record<number, 'float32x2' | 'float32x3' | 'float32x4'> = {
	2: 'float32x2',
	3: 'float32x3',
	4: 'float32x4',
};

/** Floats a vertex. */
const STRIDE = PARTICLE_ATTRIBUTES.reduce((sum, a) => sum + a.size, 0);

const offsetOf = (name: string): number => {
	let at = 0;
	for (const a of PARTICLE_ATTRIBUTES) {
		if (a.name === name) return at;
		at += a.size;
	}
	throw new Error(`particle shell: no ${name} attribute`);
};

const POSITION = offsetOf('aPosition');
const FRAME = offsetOf('aEfxFrame');
const MAP = offsetOf('aEfxMap');
const MAP2 = offsetOf('aEfxMap2');
const TRIM = offsetOf('aEfxTrim');
const COLOR = offsetOf('aEfxColor');
const TIME = offsetOf('aEfxTime');

/** A quad's corners as Pixi orders a sprite's: top left, top right, bottom right, bottom left. */
const ACROSS = [0, 1, 1, 0];
const DOWN = [0, 0, 1, 1];

/** A quad's two triangles, by corner. */
const QUAD = [0, 1, 2, 0, 2, 3];

const VECTOR_SIZES = { vec2: 2, vec3: 3, vec4: 4 } as const;

/** The library's Max particles for a config without a positive one (`Emitter.init`). */
const LIBRARY_MAX_PARTICLES = 1000;

/** Programs already said to have failed: each is logged once. */
const reported = new WeakSet<GlProgram>();

/** A geometry whose bounds are the live quads', set by the mirror, not the whole buffer's. */
class ParticleGeometry extends Geometry {
	readonly live = new Bounds();
	override get bounds(): Bounds {
		return this.live;
	}
}

export class ParticleMaterial {
	/** The emitter's particle parent: hidden while the material draws, shown when it is plain. */
	readonly particles = new Container({ label: 'particle material sprites' });
	private readonly host: Container;
	private readonly effect: CustomElementFx | undefined;
	private readonly specs = new Map<string, ElementFxParamSpec>();
	private readonly capacity: number;
	private mesh: Mesh<ParticleGeometry, Shader> | undefined;
	private shader: Shader | undefined;
	private program: GlProgram | undefined;
	private geometry: ParticleGeometry | undefined;
	private buffer: Buffer | undefined;
	private data: Float32Array | undefined;
	private params: UniformGroup | undefined;
	private source: TextureSource | undefined;
	private checked = false;
	private plainBecause: ParticleMaterialPlain | undefined;
	private looping: boolean;
	private intensity: number;
	private readonly secondsPerAge: number;
	private readonly lengthSeconds: number;
	private readonly padding: number;

	constructor(options: ParticleMaterialOptions) {
		const { host, effect } = options;
		this.host = host;
		this.effect = effect;
		this.looping = options.time === 'loop';
		this.intensity = options.intensity ?? 1;
		this.secondsPerAge = 1 / ((options.emitSpeed || DEFAULT_EMIT_SPEED) * 1000);
		this.lengthSeconds = Math.max(1e-3, (effect?.spec.durationMs ?? 1000) / 1000);
		this.padding = effect?.padding ?? 0;
		// As the library reads it: not a positive number is 1000, a fraction lets one more spawn.
		const max = options.maxParticles > 0 ? Math.ceil(options.maxParticles) : LIBRARY_MAX_PARTICLES;
		this.capacity = Math.min(PARTICLE_MATERIAL_CAPACITY, max);
		host.addChild(this.particles);
		const fragment = effect && particleShellSource(effect);
		const source = options.textures[0]?.source;
		if (!effect) this.plainBecause = 'no effect';
		else if (!fragment) this.plainBecause = 'shell refuses the body';
		else if (max > PARTICLE_MATERIAL_CAPACITY) this.plainBecause = 'over capacity';
		else if (!source || options.textures.some((t) => t.source !== source))
			this.plainBecause = 'frames on several textures';
		if (this.plainBecause || !effect || !fragment || !source) return;
		this.source = source;
		for (const spec of effect.spec.params) this.specs.set(spec.id, spec);
		this.build(effect, fragment, options.textures[0], options.params);
		this.particles.visible = false;
	}

	private build(
		effect: CustomElementFx,
		fragment: string,
		texture: Texture,
		values: ParticleMaterialOptions['params'],
	): void {
		this.data = new Float32Array(this.capacity * 4 * STRIDE);
		this.buffer = new Buffer({
			data: this.data,
			usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
			label: 'particle material',
		});
		const indices = new Uint16Array(this.capacity * 6);
		for (let q = 0; q < this.capacity; q++)
			for (let k = 0; k < 6; k++) indices[6 * q + k] = 4 * q + QUAD[k];
		const buffer = this.buffer;
		this.geometry = new ParticleGeometry({
			attributes: Object.fromEntries(
				PARTICLE_ATTRIBUTES.map((a) => [
					a.name,
					{ buffer, format: FORMATS[a.size], stride: STRIDE * 4, offset: offsetOf(a.name) * 4 },
				]),
			),
			indexBuffer: indices,
			indexCount: 6,
		});
		const uniforms: ConstructorParameters<typeof UniformGroup>[0] = {};
		for (const u of effect.shader.uniforms) {
			if (u.source.kind !== 'param') continue;
			uniforms[u.name] =
				u.type === 'float'
					? { value: 0, type: 'f32' }
					: { value: new Float32Array(VECTOR_SIZES[u.type]), type: `${u.type}<f32>` };
		}
		this.params = Object.keys(uniforms).length ? new UniformGroup(uniforms) : undefined;
		this.setParams(values);
		this.program = GlProgram.from({
			vertex: PARTICLE_VERTEX,
			fragment,
			name: `particle-material-${effect.spec.kind.replace(/\W/g, '-')}`,
		});
		const shader = (this.shader = new Shader({
			glProgram: this.program,
			resources: {
				uTexture: texture.source,
				...(this.params ? { efxParams: this.params } : {}),
			},
		}));
		this.mesh = new Mesh({ geometry: this.geometry, shader, texture });
		this.mesh.label = 'particle material';
		this.mesh.eventMode = 'none';
		this.mesh.visible = false;
		this.host.addChildAt(this.mesh, this.host.getChildIndex(this.particles) + 1);
	}

	/** Undefined while the material draws; otherwise why the layer is plain. */
	get plain(): ParticleMaterialPlain | undefined {
		return this.plainBecause;
	}

	/** The bound config with `fxMaterial` added, for the emitter (the stored config stays pure). */
	bindConfig(config: EmitterConfigV3): EmitterConfigV3 {
		return bindFxMaterial(config);
	}

	setTime(time: ParticleMaterialTime): void {
		this.looping = time === 'loop';
	}

	setIntensity(intensity: number): void {
		this.intensity = intensity;
	}

	/** Write the params' uniforms: each given value, or its default. */
	setParams(values: Readonly<Record<string, unknown>> | undefined): void {
		const group = this.params;
		if (!group || !this.effect) return;
		for (const u of this.effect.shader.uniforms) {
			if (u.source.kind !== 'param') continue;
			const spec = this.specs.get(u.source.id);
			const value = spec ? elementFxParamUniform(spec, values?.[spec.id]) : [0];
			const target = group.uniforms[u.name];
			if (target instanceof Float32Array) {
				for (let i = 0; i < target.length; i++) target[i] = value[i] ?? 0;
			} else {
				group.uniforms[u.name] = value[0];
			}
		}
		group.update();
	}

	/** Turn the layer plain for good: the sprites shown, the mesh gone. */
	private fallBack(reason: ParticleMaterialPlain): void {
		this.plainBecause = reason;
		this.particles.visible = true;
		this.dropMesh();
	}

	private dropMesh(): void {
		if (!this.mesh) return;
		this.host.removeChild(this.mesh);
		this.mesh.destroy();
		this.geometry?.destroy(true);
		// The mesh lets go of its shader without destroying it, and the shader's bind group listens
		// to the atlas source. Its program is Pixi's shared one (`GlProgram.from`): kept.
		this.shader?.destroy();
		this.mesh = this.shader = this.geometry = this.buffer = this.data = undefined;
	}

	/**
	 * Mirror the hidden particles into the mesh: call after `emitter.update`, before the frame
	 * renders. `renderer` is asked, at the first live particle, whether the program links.
	 */
	sync(renderer: MaterialRenderer): void {
		const { mesh, geometry, buffer, data, source, program } = this;
		if (!mesh || !geometry || !buffer || !data || !source || !program) return;
		const children = this.particles.children;
		const count = children.length;
		if (count > this.capacity) return this.fallBack('over capacity');
		if (count > 0 && !this.checked) {
			this.checked = true;
			if (renderer.type !== RendererType.WEBGL) return this.fallBack('not WebGL');
			if (!programLinks(renderer, program)) {
				if (!reported.has(program)) {
					reported.add(program);
					console.warn(
						`Particle material: ${this.effect?.spec.kind} did not compile on this GPU, ` +
							'so its particles draw as plain sprites.',
					);
				}
				return this.fallBack('program does not link');
			}
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const looping = this.looping ? 1 : 0;
		let live = 0;
		for (let i = 0; i < count; i++) {
			const p = children[i] as MaterialParticle;
			if (!p.visible) continue;
			const texture = p.texture;
			if (texture.source !== source) return this.fallBack('frames on several textures');
			if (live === 0 && mesh.blendMode !== p.blendMode) mesh.blendMode = p.blendMode;
			p.updateLocalTransform();
			const { a, b, c, d, tx, ty } = p.localTransform;
			const w = texture.orig.width;
			const h = texture.orig.height;
			if (!(w > 0 && h > 0)) continue;
			const trim = texture.trim;
			const t0 = trim ? trim.x / w : 0;
			const t1 = trim ? trim.y / h : 0;
			const t2 = trim ? (trim.x + trim.width) / w : 1;
			const t3 = trim ? (trim.y + trim.height) / h : 1;
			const uvs = texture.uvs;
			const acrossU = (uvs.x1 - uvs.x0) / (t2 - t0);
			const acrossV = (uvs.y1 - uvs.y0) / (t2 - t0);
			const downU = (uvs.x3 - uvs.x0) / (t3 - t1);
			const downV = (uvs.y3 - uvs.y0) / (t3 - t1);
			const originU = uvs.x0 - t0 * acrossU - t1 * downU;
			const originV = uvs.y0 - t0 * acrossV - t1 * downV;
			const room = this.padding * Math.max(w, h);
			const padU = room / w;
			const padV = room / h;
			const ax = p.anchor.x;
			const ay = p.anchor.y;
			const tint = p.tint;
			const alpha = p.alpha;
			const seconds = p.age * this.secondsPerAge;
			const progress = looping
				? seconds / this.lengthSeconds - Math.floor(seconds / this.lengthSeconds)
				: p.agePercent;
			const config = p.config;
			const seed = (config[FX_MATERIAL_KEYS.seed] as number | undefined) ?? 0;
			const wave = (config[FX_MATERIAL_KEYS.wave] as number | undefined) ?? 0;
			const order = (config[FX_MATERIAL_KEYS.order] as number | undefined) ?? 0;
			const frameW = w * Math.sqrt(a * a + b * b);
			const frameH = h * Math.sqrt(c * c + d * d);
			for (let k = 0; k < 4; k++) {
				const v = (live * 4 + k) * STRIDE;
				const u = ACROSS[k] ? 1 + padU : -padU;
				const s = DOWN[k] ? 1 + padV : -padV;
				const lx = (u - ax) * w;
				const ly = (s - ay) * h;
				const x = a * lx + c * ly + tx;
				const y = b * lx + d * ly + ty;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
				data[v + POSITION] = x;
				data[v + POSITION + 1] = y;
				data[v + POSITION + 2] = u;
				data[v + POSITION + 3] = s;
				data[v + FRAME] = frameW;
				data[v + FRAME + 1] = frameH;
				data[v + FRAME + 2] = seed;
				data[v + MAP] = originU;
				data[v + MAP + 1] = originV;
				data[v + MAP + 2] = acrossU;
				data[v + MAP + 3] = acrossV;
				data[v + MAP2] = downU;
				data[v + MAP2 + 1] = downV;
				data[v + MAP2 + 2] = wave;
				data[v + MAP2 + 3] = order;
				data[v + TRIM] = t0;
				data[v + TRIM + 1] = t1;
				data[v + TRIM + 2] = t2;
				data[v + TRIM + 3] = t3;
				data[v + COLOR] = (((tint >> 16) & 255) / 255) * alpha;
				data[v + COLOR + 1] = (((tint >> 8) & 255) / 255) * alpha;
				data[v + COLOR + 2] = ((tint & 255) / 255) * alpha;
				data[v + COLOR + 3] = alpha;
				data[v + TIME] = progress;
				data[v + TIME + 1] = seconds;
				data[v + TIME + 2] = this.intensity;
				data[v + TIME + 3] = looping;
			}
			live++;
		}
		mesh.visible = live > 0;
		if (!live) return geometry.live.set(0, 0, 0, 0);
		geometry.live.set(minX, minY, maxX, maxY);
		geometry.indexCount = live * 6;
		buffer.update(live * 4 * STRIDE * 4);
	}

	/** Take the mesh and the hidden container out of the layer. Destroy the emitter first. */
	destroy(): void {
		this.dropMesh();
		this.host.removeChild(this.particles);
		this.particles.destroy();
	}
}
