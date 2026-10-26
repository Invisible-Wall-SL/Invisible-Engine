/**
 * The material renderer's page (`particleMaterial.mjs`) on WebGL1 or WebGL2: real emitters of the
 * library, bound as the runtime binds them (`bindArt`, then the renderer's `fxMaterial`), drawn
 * through `pixi-svelte`'s `ParticleMaterial` and read back off the canvas.
 *
 *  - PARITY: each case is one emitter drawn twice in the same state, through its material (an Output
 *    alone) and as the plain sprites it hides, and the two cells are compared pixel by pixel;
 *  - INPUTS: probe materials write a particle's progress, seed, strength, wave index, spawn order,
 *    seconds and looping as its colour, read back at its centre and held to what the particle carries;
 *  - FALLBACKS: every reason a layer draws plain, each still drawing its sprites;
 *  - STEADY STATE: 20,000 frames after a warm-up allocate no buffer, on the GPU or in the mirror;
 *  - the CPU time to mirror 512 particles.
 *
 * `window.result` holds what the script judges; a failed claim is also logged as an error.
 */
import {
	Application,
	Container,
	Graphics,
	Mesh,
	RenderTexture,
	Sprite,
	Spritesheet,
	Texture,
	type WebGLRenderer,
} from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_MATERIAL_KEYS,
	FX_MATERIAL_SEEDS,
	bindArt,
	registerFxBehaviors,
} from '@fxroot/packages/engine-fx/index';
import type { CustomElementFx } from '@fxroot/packages/constants-shared/elementFx';
import {
	compileShaderEffect,
	graphBuilder,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import {
	PARTICLE_MATERIAL_CAPACITY,
	ParticleMaterial,
	type ParticleMaterialOptions,
} from '@fxroot/packages/pixi-svelte/src/lib/particleMaterial/index';

registerFxBehaviors(Emitter);

const query = new URLSearchParams(location.search);
const THRESHOLD = Number(query.get('threshold') ?? 2);
const FRAMES = Number(query.get('frames') ?? 20000);
const CELL = 240;
const COLS = 5;
const ROWS = 3;
const BACKGROUND = 0x20232a;
const EMIT_SPEED = 0.00234;
const FRAME_MS = 1000 / 60;

const page = window as unknown as { result?: unknown; ready?: boolean };

/** The atlas's frames, laid out as a packer writes them (Pixi's own `Spritesheet` reads them). */
const ATLAS_FRAMES = {
	static: { frame: { x: 4, y: 4, w: 60, h: 80 }, sourceSize: { w: 60, h: 80 } },
	rotated: {
		frame: { x: 70, y: 4, w: 60, h: 80 },
		rotated: true,
		sourceSize: { w: 60, h: 80 },
	},
	trimmed: {
		frame: { x: 160, y: 4, w: 44, h: 56 },
		trimmed: true,
		spriteSourceSize: { x: 9, y: 14, w: 44, h: 56 },
		sourceSize: { w: 64, h: 84 },
	},
	trimRotated: {
		frame: { x: 4, y: 100, w: 44, h: 56 },
		rotated: true,
		trimmed: true,
		spriteSourceSize: { x: 5, y: 20, w: 44, h: 56 },
		sourceSize: { w: 60, h: 90 },
	},
	f0: { frame: { x: 80, y: 100, w: 40, h: 40 }, sourceSize: { w: 40, h: 40 } },
	f1: { frame: { x: 124, y: 100, w: 40, h: 40 }, sourceSize: { w: 40, h: 40 } },
	f2: { frame: { x: 168, y: 100, w: 40, h: 40 }, sourceSize: { w: 40, h: 40 } },
	f3: { frame: { x: 212, y: 100, w: 40, h: 40 }, sourceSize: { w: 40, h: 40 } },
};

/**
 * The atlas page, an image as a real one is: art no wrong mapping draws the same (a gradient across,
 * waves at an angle, soft discs, alpha falling down the page), SMOOTH at the scale of a texel. The
 * material's quad is the particle's whole frame, padded, where the sprite's is its trimmed box, so
 * the two are rasterised from different corners, and SwiftShader snaps corners to 1/16 of a pixel:
 * the same texel is read up to about 0.06 px apart. On art with hard texel edges that moves a pixel
 * by 15 steps or more; on this art by 2 at most, while a mapping off by half a texel moves whole
 * regions.
 */
const atlasArt = (): HTMLCanvasElement => {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 256;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
	const image = ctx.createImageData(256, 256);
	const discs = Array.from({ length: 24 }, (_, i) => ({
		x: (i * 53) % 256,
		y: (i * 97) % 256,
		r: 10 + (i % 5) * 4,
		color: [(i * 83) % 256, (i * 151) % 256, (i * 47) % 256],
	}));
	for (let y = 0; y < 256; y++)
		for (let x = 0; x < 256; x++) {
			const t = (x + y) / 510;
			let rgb = [255 * (1 - t) + 58 * t, 77 + 106 * Math.sin(Math.PI * t), 109 + 146 * t];
			const wave = 0.5 + 0.5 * Math.sin((x * 0.8 + y * 0.45) / 4.5);
			rgb = rgb.map((c) => c * (0.55 + 0.45 * wave));
			for (const d of discs) {
				const k = Math.max(0, 1 - Math.hypot(x - d.x, y - d.y) / d.r);
				const w = k * k * (3 - 2 * k) * 0.8;
				rgb = rgb.map((c, j) => c * (1 - w) + d.color[j] * w);
			}
			const i = (y * 256 + x) * 4;
			image.data.set([...rgb.map(Math.round), Math.round(255 * (1 - 0.8 * (y / 255)))], i);
		}
	ctx.putImageData(image, 0, 0);
	return canvas;
};

/** Output alone: the particle's own texture, as it is. */
const outputAlone = (id: string, padding = 0): CustomElementFx => {
	const g = graphBuilder({ id, name: id, phase: 'emphasis', durationMs: 1000, padding });
	g.node('output');
	return compiled(g.doc());
};

const compiled = (doc: ShaderGraphDoc): CustomElementFx => {
	const result = compileShaderEffect(doc);
	if (!result.ok) throw new Error(`${doc.id}: ${result.issues.map((i) => i.message).join('; ')}`);
	return result.effect;
};

/** A probe: four numbers the graph reads, written out as the particle's colour. */
const probe = (
	id: string,
	durationMs: number,
	wires: (
		g: ReturnType<typeof graphBuilder>,
		ids: { time: string; seed: string; particle: string; combine: string },
	) => void,
): CustomElementFx => {
	const g = graphBuilder({ id, name: id, phase: 'emphasis', durationMs });
	const ids = {
		time: g.node('time'),
		seed: g.node('seed'),
		particle: g.node('particle'),
		combine: g.node('combine'),
	};
	const out = g.node('output');
	wires(g, ids);
	g.wire(ids.combine, 'xyzw', out, 'color');
	return compiled(g.doc());
};

/** `of ÷ by`, through a Divide node, into the Combine's `port`. */
const divided = (
	g: ReturnType<typeof graphBuilder>,
	from: [string, string],
	by: number,
	into: [string, string],
): void => {
	const div = g.node('divide', { b: by });
	g.wire(from[0], from[1], div, 'a');
	g.wire(div, 'out', into[0], into[1]);
};

interface Cell {
	drawn: number;
	over: number;
	patch: number;
	max: number;
}

(async () => {
	const app = new Application();
	await app.init({
		width: COLS * CELL,
		height: ROWS * CELL,
		background: BACKGROUND,
		preference: 'webgl',
		preferWebGLVersion: query.get('gl') === '1' ? 1 : 2,
		antialias: false,
		autoStart: false,
		sharedTicker: false,
		resolution: 1,
		preserveDrawingBuffer: true,
	});
	document.body.appendChild(app.canvas);
	const renderer = app.renderer as WebGLRenderer;
	const gl = renderer.gl;
	const errors: string[] = [];
	const report = console.error.bind(console);
	const claim = (label: string, ok: boolean): boolean => {
		if (!ok) {
			errors.push(label);
			report(`particle-material: ${label}`);
		}
		return ok;
	};

	const atlas = Texture.from(atlasArt());
	const sheet = new Spritesheet(atlas, {
		frames: ATLAS_FRAMES,
		meta: { scale: 1 },
	} as ConstructorParameters<typeof Spritesheet>[1]);
	await sheet.parse();
	const frame = (name: keyof typeof ATLAS_FRAMES): Texture => sheet.textures[name];
	const flipbook = [frame('f0'), frame('f1'), frame('f2'), frame('f3')];

	const readCanvas = (): Uint8Array => {
		const out = new Uint8Array(renderer.width * renderer.height * 4);
		gl.readPixels(0, 0, renderer.width, renderer.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return out;
	};
	/** Pixel (x, y) from the top of a read canvas. */
	const at = (pixels: Uint8Array, x: number, y: number): number[] => {
		const i = ((renderer.height - 1 - y) * renderer.width + x) * 4;
		return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
	};
	const bg = [(BACKGROUND >> 16) & 255, (BACKGROUND >> 8) & 255, BACKGROUND & 255];
	/** Cell `n` of two reads compared: what differs by more than THRESHOLD, and in patches. */
	const compare = (a: Uint8Array, b: Uint8Array, n: number): Cell => {
		const x0 = (n % COLS) * CELL;
		const y0 = Math.floor(n / COLS) * CELL;
		const differs = new Uint8Array(CELL * CELL);
		const cell: Cell = { drawn: 0, over: 0, patch: 0, max: 0 };
		for (let y = 0; y < CELL; y++)
			for (let x = 0; x < CELL; x++) {
				const pa = at(a, x0 + x, y0 + y);
				const pb = at(b, x0 + x, y0 + y);
				if (pb.slice(0, 3).some((v, k) => Math.abs(v - bg[k]) > THRESHOLD)) cell.drawn++;
				const d = Math.max(...pa.map((v, k) => Math.abs(v - pb[k])));
				cell.max = Math.max(cell.max, d);
				if (d > THRESHOLD) {
					cell.over++;
					differs[y * CELL + x] = 1;
				}
			}
		for (let y = 1; y < CELL - 1; y++)
			for (let x = 1; x < CELL - 1; x++)
				if (
					differs[y * CELL + x] &&
					differs[y * CELL + x - 1] &&
					differs[y * CELL + x + 1] &&
					differs[(y - 1) * CELL + x] &&
					differs[(y + 1) * CELL + x]
				)
					cell.patch++;
		return cell;
	};

	interface Layer {
		host: Container;
		emitter: Emitter;
		material: ParticleMaterial;
		step: (frames: number) => void;
	}
	/** One emitter layer in cell `n`: bound as the runtime binds it, through its material. */
	const layer = (
		n: number,
		config: EmitterConfigV3,
		textures: Texture[],
		options: Partial<ParticleMaterialOptions> & { animated?: boolean },
	): Layer => {
		const host = new Container();
		host.position.set((n % COLS) * CELL + CELL / 2, Math.floor(n / COLS) * CELL + CELL / 2);
		app.stage.addChild(host);
		const { animated = false, ...given } = options;
		const material = new ParticleMaterial({
			host,
			effect: undefined,
			maxParticles: config.maxParticles ?? 0,
			textures,
			emitSpeed: EMIT_SPEED,
			...given,
		});
		const bound = material.bindConfig(bindArt(config, textures, animated));
		const emitter = new Emitter(material.particles, bound);
		const step = (frames: number) => {
			for (let i = 0; i < frames; i++) {
				emitter.update(FRAME_MS * EMIT_SPEED);
				material.sync(renderer);
			}
		};
		return { host, emitter, material, step };
	};
	const meshOf = (host: Container): Mesh | undefined =>
		host.children.find((c): c is Mesh => c instanceof Mesh);

	const base = (behaviors: EmitterConfigV3['behaviors'], extra: Partial<EmitterConfigV3> = {}) =>
		({
			lifetime: { min: 0.9, max: 1.6 },
			frequency: 0.04,
			emitterLifetime: -1,
			maxParticles: 60,
			pos: { x: 0, y: 0 },
			addAtBack: false,
			behaviors: [
				{ type: 'spawnShape', config: { type: 'rect', data: { x: -80, y: -80, w: 160, h: 160 } } },
				{
					type: 'rotation',
					config: { minStart: 0, maxStart: 360, minSpeed: -120, maxSpeed: 120, accel: 0 },
				},
				{
					type: 'scale',
					config: {
						scale: {
							list: [
								{ value: 0.45, time: 0 },
								{ value: 1.15, time: 1 },
							],
						},
						minMult: 0.5,
					},
				},
				...behaviors,
			],
			...extra,
		}) as EmitterConfigV3;

	// --- parity: an Output-alone material against the plain sprites it hides ---
	const alone = outputAlone('alone');
	const padded = outputAlone('padded', 0.4);
	const cases: {
		label: string;
		config: EmitterConfigV3;
		textures: Texture[];
		animated?: boolean;
		effect?: CustomElementFx;
		group?: (host: Container) => void;
	}[] = [
		{ label: 'static frame', config: base([]), textures: [frame('static')] },
		{ label: 'rotated frame', config: base([]), textures: [frame('rotated')] },
		{ label: 'trimmed frame', config: base([]), textures: [frame('trimmed')] },
		{ label: 'trimmed rotated frame', config: base([]), textures: [frame('trimRotated')] },
		{
			label: 'flipbook, several frames',
			config: base([]),
			textures: flipbook,
			animated: true,
		},
		{
			label: 'fxSprite pivot and offset',
			config: base([{ type: 'fxSprite', config: { rotation: 35, anchorX: 0.15, anchorY: 0.85 } }]),
			textures: [frame('trimmed')],
		},
		{
			label: 'tint over life',
			config: base([
				{
					type: 'color',
					config: {
						color: {
							list: [
								{ value: 'ff8040', time: 0 },
								{ value: '40a0ff', time: 1 },
							],
						},
					},
				},
			]),
			textures: [frame('static')],
		},
		{
			label: 'colour overlay',
			config: base([
				{
					type: 'fxColorOverlay',
					config: { color: '#30ff90', minIntensity: 0.2, maxIntensity: 0.9 },
				},
			]),
			textures: [frame('rotated')],
		},
		{
			label: 'fade',
			config: base([
				{
					type: 'alpha',
					config: {
						alpha: {
							list: [
								{ value: 1, time: 0 },
								{ value: 0.15, time: 1 },
							],
						},
					},
				},
			]),
			textures: [frame('trimRotated')],
		},
		{
			label: 'Add blend',
			config: base([{ type: 'blendMode', config: { blendMode: 'add' } }]),
			textures: [frame('static')],
		},
		{
			label: 'group alpha and tint below 1',
			config: base([
				{
					type: 'alpha',
					config: {
						alpha: {
							list: [
								{ value: 0.9, time: 0 },
								{ value: 0.4, time: 1 },
							],
						},
					},
				},
			]),
			textures: [frame('trimmed')],
			group: (host) => {
				host.alpha = 0.55;
				host.tint = 0xffa060;
			},
		},
		{
			label: 'padded material, Add, addAtBack',
			config: base([{ type: 'blendMode', config: { blendMode: 'add' } }], { addAtBack: true }),
			textures: flipbook,
			animated: true,
			effect: padded,
		},
		{
			label: 'scaled and turned parent',
			config: base([]),
			textures: [frame('trimRotated')],
			group: (host) => {
				const wrap = new Container();
				wrap.position.copyFrom(host.position);
				host.position.set(0, 0);
				wrap.addChild(host);
				wrap.scale.set(0.8, 1.1);
				wrap.rotation = 0.4;
				app.stage.addChild(wrap);
			},
		},
	];
	/** Whether a case's quads are not the sprites' (trimmed frames, padding): see `atlasArt`. */
	const edges = (c: (typeof cases)[number]): boolean =>
		c.textures.some((t) => !!t.trim) || (c.effect?.padding ?? 0) > 0;
	const parity: { label: string; moment: number; edges: boolean; cell: Cell }[] = [];
	const dumps: string[] = [];
	const layers = cases.map((c, n) => {
		const l = layer(n, c.config, c.textures, {
			effect: c.effect ?? alone,
			animated: c.animated,
		});
		c.group?.(l.host);
		return l;
	});
	for (const [k, l] of layers.entries())
		claim(`${cases[k].label}: the material is on`, l.material.plain === undefined);
	for (const moment of [20, 45]) {
		for (const l of layers) l.step(moment === 20 ? 20 : 25);
		renderer.render(app.stage);
		const material = readCanvas();
		if (query.has('dump')) dumps.push(app.canvas.toDataURL());
		for (const l of layers) {
			l.material.particles.visible = true;
			const mesh = meshOf(l.host);
			if (mesh) mesh.visible = false;
		}
		renderer.render(app.stage);
		const plain = readCanvas();
		if (query.has('dump')) dumps.push(app.canvas.toDataURL());
		for (const l of layers) {
			l.material.particles.visible = false;
			const mesh = meshOf(l.host);
			if (mesh) mesh.visible = true;
		}
		cases.forEach((c, n) =>
			parity.push({ label: c.label, moment, edges: edges(c), cell: compare(material, plain, n) }),
		);
	}
	// The hidden sprites are not measured: the layer's bounds are the mesh's.
	const measured = layers[0].host.getLocalBounds();
	const meshBounds = meshOf(layers[0].host)?.getLocalBounds();
	claim(
		'the layer measures as its mesh (the hidden sprites do not count)',
		!!meshBounds &&
			Math.abs(measured.width - meshBounds.width) < 1e-3 &&
			Math.abs(measured.height - meshBounds.height) < 1e-3 &&
			meshBounds.width > 0,
	);
	for (const l of layers) {
		l.emitter.destroy();
		l.material.destroy();
	}
	app.stage.removeChildren();

	// --- the per-particle inputs ---
	const STRENGTH = 0.5;
	const probes = {
		life: probe('probeLife', 1000, (g, i) => {
			g.wire(i.time, 'progress', i.combine, 'x');
			divided(g, [i.seed, 'out'], 97, [i.combine, 'y']);
			g.wire(i.time, 'intensity', i.combine, 'z');
		}),
		indexes: probe('probeIndexes', 1000, (g, i) => {
			g.wire(i.particle, 'wave', i.combine, 'x');
			g.wire(i.particle, 'order', i.combine, 'y');
			divided(g, [i.time, 'seconds'], 4, [i.combine, 'z']);
		}),
		loop: probe('probeLoop', 300, (g, i) => {
			g.wire(i.time, 'progress', i.combine, 'x');
			g.wire(i.time, 'looping', i.combine, 'y');
			divided(g, [i.time, 'seconds'], 4, [i.combine, 'z']);
		}),
	};
	const WAVE = 4;
	const MAX = 24;
	const still = {
		lifetime: { min: 4, max: 6 },
		frequency: 0.12,
		emitterLifetime: -1,
		maxParticles: MAX,
		particlesPerWave: WAVE,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [],
	} as unknown as EmitterConfigV3;
	type Probed = Sprite & { age: number; agePercent: number; config: Record<string, number> };
	const inputs: Record<string, { particles: number; worst: number }> = {};
	const SPOT = 40;
	const probeLayer = (name: keyof typeof probes, time: 'life' | 'loop'): void => {
		const l = layer(0, still, [frame('static')], {
			effect: probes[name],
			time,
			intensity: STRENGTH,
		});
		l.host.position.set(0, 0);
		for (let i = 0; i < 70; i++) l.emitter.update(FRAME_MS * EMIT_SPEED);
		const live = l.material.particles.children as Probed[];
		live.forEach((p, k) => {
			p.position.set((k % 8) * SPOT + SPOT / 2, Math.floor(k / 8) * SPOT + SPOT / 2);
			p.rotation = 0;
			p.scale.set(0.5);
		});
		l.material.sync(renderer);
		renderer.render(app.stage);
		const pixels = readCanvas();
		const expected = (p: Probed): number[] => {
			const seconds = p.age / (EMIT_SPEED * 1000);
			const loop = seconds / 0.3 - Math.floor(seconds / 0.3);
			if (name === 'life') return [p.agePercent, p.config[FX_MATERIAL_KEYS.seed] / 97, STRENGTH];
			if (name === 'indexes')
				return [p.config[FX_MATERIAL_KEYS.wave], p.config[FX_MATERIAL_KEYS.order], seconds / 4];
			return [loop, 1, seconds / 4];
		};
		let worst = 0;
		for (const [k, p] of live.entries()) {
			const got = at(pixels, (k % 8) * SPOT + SPOT / 2, Math.floor(k / 8) * SPOT + SPOT / 2);
			const want = expected(p).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
			worst = Math.max(worst, ...want.map((v, c) => Math.abs(v - got[c])));
		}
		inputs[name] = { particles: live.length, worst };
		claim(`${name} probe: ${live.length} particles, as many as spawned`, live.length === MAX);
		claim(`${name} probe: every particle reads its own values (worst ${worst})`, worst <= 2);
		if (name === 'life') {
			const seeds = live.map((p) => p.config[FX_MATERIAL_KEYS.seed]);
			const progress = new Set(live.map((p) => Math.round(p.agePercent * 255)));
			claim(
				'seeds are whole numbers 0…97',
				seeds.every((s) => Number.isInteger(s) && s >= 0 && s < FX_MATERIAL_SEEDS),
			);
			claim('seeds differ between particles', new Set(seeds).size > live.length / 2);
			claim('progress differs between particles', progress.size > 4);
		}
		if (name === 'indexes') {
			const waves = live.map((p) => p.config[FX_MATERIAL_KEYS.wave]);
			const orders = live.map((p) => p.config[FX_MATERIAL_KEYS.order]);
			claim(
				'wave index is the place in the wave ÷ (size − 1)',
				waves.every((w, k) => Math.abs(w - (k % WAVE) / (WAVE - 1)) < 1e-9),
			);
			claim(
				'spawn order is the spawn number ÷ Max particles',
				orders.every((o, k) => Math.abs(o - k / MAX) < 1e-9),
			);
		}
		l.emitter.destroy();
		l.material.destroy();
		app.stage.removeChildren();
	};
	probeLayer('life', 'life');
	probeLayer('indexes', 'life');
	probeLayer('loop', 'loop');

	// Padding: a material drawing white over all of its quad reaches past the frame by the padding.
	const PAD = 0.25;
	const fill = graphBuilder({
		id: 'fill',
		name: 'fill',
		phase: 'emphasis',
		durationMs: 1000,
		padding: PAD,
	});
	fill.wire(fill.node('combine', { x: 1, y: 1, z: 1 }), 'xyzw', fill.node('output'), 'color');
	const one = layer(
		0,
		{ ...still, maxParticles: 1, particlesPerWave: 1 } as EmitterConfigV3,
		[frame('static')],
		{
			effect: compiled(fill.doc()),
		},
	);
	one.host.position.set(0, 0);
	one.emitter.update(0.01);
	const lone = one.material.particles.children[0] as Probed;
	lone.position.set(120, 120);
	lone.scale.set(0.5);
	one.material.sync(renderer);
	renderer.render(app.stage);
	const filled = readCanvas();
	const box = { minX: CELL, minY: CELL, maxX: -1, maxY: -1 };
	for (let y = 0; y < CELL; y++)
		for (let x = 0; x < CELL; x++)
			if (at(filled, x, y)[0] === 255) {
				box.minX = Math.min(box.minX, x);
				box.maxX = Math.max(box.maxX, x);
				box.minY = Math.min(box.minY, y);
				box.maxY = Math.max(box.maxY, y);
			}
	const room = PAD * 80;
	const quad = { w: (60 + 2 * room) * 0.5, h: (80 + 2 * room) * 0.5 };
	const reach = { w: box.maxX - box.minX + 1, h: box.maxY - box.minY + 1 };
	inputs.padding = {
		particles: 1,
		worst: Math.max(Math.abs(reach.w - quad.w), Math.abs(reach.h - quad.h)),
	};
	claim(
		`a padded quad covers the frame and the padding, ${quad.w} × ${quad.h} px (drew ${reach.w} × ${reach.h})`,
		Math.abs(reach.w - quad.w) <= 1 && Math.abs(reach.h - quad.h) <= 1,
	);
	one.emitter.destroy();
	one.material.destroy();
	app.stage.removeChildren();

	// --- plain: each reason a layer draws its sprites ---
	const broken: CustomElementFx = {
		...alone,
		spec: { ...alone.spec, kind: 'custom:broken' },
		shader: { body: 'void main(void)\n{\n    finalColor = vec4(undeclared);\n}\n', uniforms: [] },
	};
	const refused: CustomElementFx = {
		...alone,
		spec: { ...alone.spec, kind: 'custom:refused' },
		shader: {
			body: '#define X 1\nvoid main(void)\n{\n    finalColor = vec4(1.0);\n}\n',
			uniforms: [],
		},
	};
	const other = RenderTexture.create({ width: 64, height: 64 });
	renderer.render({
		container: new Graphics().rect(0, 0, 64, 64).fill(0xffffff),
		target: other,
		clear: true,
	});
	// The broken program's compile errors are Pixi's own log: kept here, not failed on.
	const warned: string[] = [];
	const driver: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => warned.push(args.map(String).join(' '));
	console.error = (...args: unknown[]) => driver.push(args.map(String).join(' '));
	const plainCases: {
		label: string;
		want: string;
		config: EmitterConfigV3;
		options: Partial<ParticleMaterialOptions>;
		textures: Texture[];
		drive?: (l: Layer) => void;
	}[] = [
		{
			label: 'no effect',
			want: 'no effect',
			config: base([]),
			textures: [frame('static')],
			options: { effect: undefined },
		},
		{
			label: 'a body the shell refuses',
			want: 'shell refuses the body',
			config: base([]),
			textures: [frame('static')],
			options: { effect: refused },
		},
		{
			label: 'a program that fails to link',
			want: 'program does not link',
			config: base([]),
			textures: [frame('static')],
			options: { effect: broken },
		},
		{
			label: 'the same program again (logged once)',
			want: 'program does not link',
			config: base([]),
			textures: [frame('rotated')],
			options: { effect: broken },
		},
		{
			label: `Max particles over ${PARTICLE_MATERIAL_CAPACITY}`,
			want: 'over capacity',
			config: base([], { maxParticles: PARTICLE_MATERIAL_CAPACITY + 1 }),
			textures: [frame('static')],
			options: { effect: alone },
		},
		{
			label: 'a drive raising Max particles past the layer’s',
			want: 'over capacity',
			config: base([], { maxParticles: 20, frequency: 0.01 }),
			textures: [frame('static')],
			options: { effect: alone },
			drive: (l) => {
				l.emitter.maxParticles = 200;
			},
		},
		{
			label: 'frames on two textures',
			want: 'frames on several textures',
			config: base([]),
			textures: [frame('static'), other],
			options: { effect: alone },
		},
	];
	const plain: { label: string; reason?: string; drawn: number; meshes: number; shown: boolean }[] =
		[];
	const plainLayers = plainCases.map((c, n) => {
		const l = layer(n, c.config, c.textures, c.options);
		c.drive?.(l);
		l.step(40);
		return l;
	});
	renderer.render(app.stage);
	const plainRead = readCanvas();
	plainCases.forEach((c, n) => {
		const l = plainLayers[n];
		const drawn = compare(plainRead, plainRead, n).drawn;
		const meshes = l.host.children.filter((ch) => ch instanceof Mesh).length;
		plain.push({
			label: c.label,
			reason: l.material.plain,
			drawn,
			meshes,
			shown: l.material.particles.visible,
		});
		claim(
			`${c.label}: plain because "${c.want}" (got "${l.material.plain}")`,
			l.material.plain === c.want,
		);
		claim(`${c.label}: no mesh`, meshes === 0);
		claim(
			`${c.label}: the sprites are shown and draw (${drawn} px)`,
			l.material.particles.visible && drawn > 500,
		);
	});
	console.warn = warn;
	console.error = report;
	claim('the driver refused the broken program', driver.length > 0);
	const linkWarnings = warned.filter((w) => w.includes('custom:broken')).length;
	claim(`a failing program is logged once (${linkWarnings} lines)`, linkWarnings === 1);
	for (const l of plainLayers) {
		l.emitter.destroy();
		l.material.destroy();
	}
	app.stage.removeChildren();

	// --- steady state: 20,000 frames reallocate nothing after warm-up ---
	const small = RenderTexture.create({ width: 128, height: 128 });
	const churn = layer(
		0,
		base([], {
			maxParticles: PARTICLE_MATERIAL_CAPACITY,
			frequency: 0.002,
			lifetime: { min: 0.4, max: 1.2 },
		}),
		flipbook,
		{ effect: alone, animated: true },
	);
	churn.host.position.set(64, 64);
	churn.host.scale.set(0.3);
	const render = () => renderer.render({ container: churn.host, target: small, clear: true });
	for (let i = 0; i < 300; i++) {
		churn.step(1);
		render();
	}
	const counts = { bufferData: 0, createBuffer: 0 };
	const glAny = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
	const original = { bufferData: glAny.bufferData, createBuffer: glAny.createBuffer };
	glAny.bufferData = function (...args: unknown[]) {
		counts.bufferData++;
		return original.bufferData.apply(gl, args);
	};
	glAny.createBuffer = function (...args: unknown[]) {
		counts.createBuffer++;
		return original.createBuffer.apply(gl, args);
	};
	const geometry = meshOf(churn.host)?.geometry;
	const before = geometry?.buffers.map((b) => b.data);
	let peak = 0;
	const steadyBegan = performance.now();
	for (let i = 0; i < FRAMES; i++) {
		churn.step(1);
		peak = Math.max(peak, churn.material.particles.children.length);
		render();
	}
	const steadyMs = performance.now() - steadyBegan;
	glAny.bufferData = original.bufferData;
	glAny.createBuffer = original.createBuffer;
	const same =
		!!geometry &&
		!!before &&
		geometry.buffers.length === before.length &&
		geometry.buffers.every((b, i) => b.data === before[i]);
	claim(`${FRAMES} frames: the material stays on`, churn.material.plain === undefined);
	claim(
		`${FRAMES} frames: no GPU buffer allocated (${counts.bufferData} bufferData, ${counts.createBuffer} createBuffer)`,
		counts.bufferData === 0 && counts.createBuffer === 0,
	);
	claim(`${FRAMES} frames: the mirror keeps its arrays`, same);
	claim(`${FRAMES} frames: the layer ran full (${peak} live at most)`, peak > 300);
	churn.emitter.destroy();
	churn.material.destroy();

	// --- the CPU time to mirror 512 particles ---
	const full = layer(
		0,
		{
			...base([]),
			maxParticles: PARTICLE_MATERIAL_CAPACITY,
			particlesPerWave: PARTICLE_MATERIAL_CAPACITY,
			frequency: 100,
			lifetime: { min: 1000, max: 1000 },
		} as EmitterConfigV3,
		[frame('trimRotated')],
		{ effect: alone },
	);
	full.step(2);
	const mirrored = full.material.particles.children.length;
	const SYNCS = 2000;
	for (let i = 0; i < 200; i++) full.material.sync(renderer);
	const syncBegan = performance.now();
	for (let i = 0; i < SYNCS; i++) {
		for (const p of full.material.particles.children) p.rotation += 1e-3;
		full.material.sync(renderer);
	}
	const turnBegan = performance.now();
	for (let i = 0; i < SYNCS; i++)
		for (const p of full.material.particles.children) p.rotation += 1e-3;
	const turnMs = performance.now() - turnBegan;
	const syncMs = (turnBegan - syncBegan - turnMs) / SYNCS;
	claim(`the sync mirrored ${mirrored} particles`, mirrored === PARTICLE_MATERIAL_CAPACITY);
	full.emitter.destroy();
	full.material.destroy();

	page.result = {
		parity,
		dumps,
		inputs,
		plain,
		steady: { frames: FRAMES, ms: steadyMs, peak, ...counts, same },
		sync: { particles: mirrored, ms: syncMs },
		errors,
	};
	page.ready = true;
})().catch((error: Error) => {
	console.error(`particle-material: threw ${error.stack ?? error.message}`);
	page.ready = true;
});
