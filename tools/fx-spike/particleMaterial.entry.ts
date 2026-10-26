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
 *  - THE GAME'S MOUNT (`mountParticleMaterial`, what `<ParticleEmitter material>` runs): a registered
 *    kind draws through the mesh, the game cap turns the next layer plain, a layer refused at mount
 *    leaves nothing in its host and gives its slot back, a buffer sized to a drive's peak stays on, a
 *    program that fails while playing gives its slot back and says so on `?fxdebug=1`, and a
 *    `material.param.*` drive is a uniform write: new pixels, the same mesh, shader and particles;
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
	bindEffectParams,
	createFxMaterialSlots,
	normalizeEffectDoc,
	registerFxBehaviors,
} from '@fxroot/packages/engine-fx/index';
import {
	setCustomElementFx,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	REFERENCE_GRAPHS,
	compileShaderEffect,
	graphBuilder,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import {
	PARTICLE_MATERIAL_CAPACITY,
	ParticleMaterial,
	mountParticleMaterial,
	type ParticleMaterialOptions,
	type ParticleMaterialSpec,
} from '@fxroot/packages/pixi-svelte/src/lib/particleMaterial/index';

registerFxBehaviors(Emitter);

const query = new URLSearchParams(location.search);
const THRESHOLD = Number(query.get('threshold') ?? 2);
const FRAMES = Number(query.get('frames') ?? 20000);
const CELL = 240;
const COLS = 5;
const ROWS = 4;
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

	/** Pixels read back, bottom row first when `flipped` (as `readPixels` gives a canvas). */
	interface Read {
		pixels: Uint8Array | Uint8ClampedArray;
		width: number;
		height: number;
		flipped: boolean;
	}
	const readCanvas = (): Read => {
		const pixels = new Uint8Array(renderer.width * renderer.height * 4);
		gl.readPixels(0, 0, renderer.width, renderer.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		return { pixels, width: renderer.width, height: renderer.height, flipped: true };
	};
	/** Pixel (x, y) from the top of a read. */
	const at = (read: Read, x: number, y: number): number[] => {
		const i = ((read.flipped ? read.height - 1 - y : y) * read.width + x) * 4;
		return [read.pixels[i], read.pixels[i + 1], read.pixels[i + 2], read.pixels[i + 3]];
	};
	const canvasBackground = [(BACKGROUND >> 16) & 255, (BACKGROUND >> 8) & 255, BACKGROUND & 255];
	/**
	 * The `size`-square at (x0, y0) of two reads compared: what differs by more than THRESHOLD, and
	 * in patches; drawn = what `b` draws off `background`.
	 */
	const compareAt = (
		a: Read,
		b: Read,
		x0: number,
		y0: number,
		size: number,
		background: number[],
	): Cell => {
		const differs = new Uint8Array(size * size);
		const cell: Cell = { drawn: 0, over: 0, patch: 0, max: 0 };
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const pa = at(a, x0 + x, y0 + y);
				const pb = at(b, x0 + x, y0 + y);
				if (background.some((v, k) => Math.abs(v - pb[k]) > THRESHOLD)) cell.drawn++;
				const d = Math.max(...pa.map((v, k) => Math.abs(v - pb[k])));
				cell.max = Math.max(cell.max, d);
				if (d > THRESHOLD) {
					cell.over++;
					differs[y * size + x] = 1;
				}
			}
		for (let y = 1; y < size - 1; y++)
			for (let x = 1; x < size - 1; x++)
				if (
					differs[y * size + x] &&
					differs[y * size + x - 1] &&
					differs[y * size + x + 1] &&
					differs[(y - 1) * size + x] &&
					differs[(y + 1) * size + x]
				)
					cell.patch++;
		return cell;
	};
	/** Cell `n` of two canvas reads compared. */
	const compare = (a: Read, b: Read, n: number): Cell =>
		compareAt(a, b, (n % COLS) * CELL, Math.floor(n / COLS) * CELL, CELL, canvasBackground);

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
			maxParticles: config.maxParticles ?? 1000,
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
		/** The negative control: the material's trimmed box written a quarter texel off. */
		control?: boolean;
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
		{
			label: 'trimmed frame, padded material',
			config: base([]),
			textures: [frame('trimmed')],
			effect: padded,
		},
		{
			label: 'Max particles 10.3 (11 spawn)',
			// Lives longer than the run, so the count is the cap's at every moment, never one short
			// between a death and the next spawn.
			config: base([], { maxParticles: 10.3, lifetime: { min: 30, max: 30 } }),
			textures: [frame('static')],
		},
		{
			label: 'CONTROL: trimmed box a quarter texel off',
			config: base([]),
			textures: [frame('trimmed')],
			control: true,
		},
	];
	/** Whether a case's quads are not the sprites' (trimmed frames, padding): see `atlasArt`. */
	const edges = (c: (typeof cases)[number]): boolean =>
		c.textures.some((t) => !!t.trim) || (c.effect?.padding ?? 0) > 0;
	const parity: {
		label: string;
		moment: number;
		edges: boolean;
		control: boolean;
		cell: Cell;
	}[] = [];
	/**
	 * What a trim read a quarter texel off would write: the box's left edge and the mapping's origin
	 * moved by a quarter of the frame's texel, in the mirror's buffer, so only the material draws it.
	 */
	const misTrim = (l: Layer): void => {
		const geometry = meshOf(l.host)?.geometry;
		if (!geometry) return;
		const buffer = geometry.getBuffer('aPosition');
		const data = buffer.data as Float32Array;
		const stride = geometry.getAttribute('aPosition').stride / 4;
		const trim = geometry.getAttribute('aEfxTrim').offset / 4;
		const map = geometry.getAttribute('aEfxMap').offset / 4;
		const shift = 0.25 / frame('trimmed').orig.width;
		for (let v = 0; v < l.material.particles.children.length * 4; v++) {
			const at = v * stride;
			data[at + trim] += shift;
			data[at + map] -= shift * data[at + map + 2];
			data[at + map + 1] -= shift * data[at + map + 3];
		}
		buffer.update();
	};
	const dumps: string[] = [];
	const listening = atlas.source.listenerCount('change');
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
	const fraction = cases.findIndex((c) => c.config.maxParticles === 10.3);
	for (const moment of [20, 45]) {
		for (const l of layers) l.step(moment === 20 ? 20 : 25);
		cases.forEach((c, n) => c.control && misTrim(layers[n]));
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
			parity.push({
				label: c.label,
				moment,
				edges: edges(c),
				control: !!c.control,
				cell: compare(material, plain, n),
			}),
		);
	}
	const spawned = layers[fraction].material.particles.children.length;
	claim(`Max particles 10.3: 11 particles drawn (${spawned})`, spawned === 11);
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
	// At resolution 2: a target twice as dense, both ways.
	const dense = RenderTexture.create({ width: CELL, height: CELL, resolution: 2 });
	const hi = layer(0, base([]), [frame('trimRotated')], { effect: padded });
	app.stage.removeChild(hi.host);
	const drawDense = (): Read => {
		renderer.render({ container: hi.host, target: dense, clear: true, clearColor: [0, 0, 0, 0] });
		const { pixels, width, height } = renderer.extract.pixels({ target: dense });
		return { pixels, width, height, flipped: false };
	};
	for (const moment of [20, 45]) {
		hi.step(moment === 20 ? 20 : 25);
		const material = drawDense();
		hi.material.particles.visible = true;
		const mesh = meshOf(hi.host);
		if (mesh) mesh.visible = false;
		const plain = drawDense();
		hi.material.particles.visible = false;
		if (mesh) mesh.visible = true;
		parity.push({
			label: 'resolution 2, trimmed rotated, padded',
			moment,
			edges: true,
			control: false,
			cell: compareAt(material, plain, 0, 0, material.width, [0, 0, 0, 0]),
		});
	}
	claim('resolution 2: the material is on', hi.material.plain === undefined);
	hi.emitter.destroy();
	hi.material.destroy();
	const after = atlas.source.listenerCount('change');
	claim(
		`a destroyed material lets go of the atlas (${listening} change listeners before, ${after} after)`,
		after === listening,
	);

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
		{
			label: 'a frame on another texture mid-play',
			want: 'frames on several textures',
			config: base([]),
			textures: [frame('static')],
			options: { effect: alone },
			drive: (l) => {
				l.step(20);
				if (l.material.plain) return;
				(l.material.particles.children[0] as Sprite).texture = other;
			},
		},
		{
			label: 'Max particles not a number (the library’s 1000)',
			want: 'over capacity',
			config: base([], { maxParticles: Number.NaN }),
			textures: [frame('static')],
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

	// --- the game's mount: `mountParticleMaterial`, as `<ParticleEmitter material>` runs it ---
	const pulse = compiled({
		...(REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint') as ShaderGraphDoc),
		id: 'pulsetint',
	});
	setCustomElementFx([pulse, { ...alone, spec: { ...alone.spec, kind: 'custom:alone' } }, broken]);
	const slots = createFxMaterialSlots(3);
	const debugLines: string[] = [];
	const log = console.log;
	console.log = (...args: unknown[]) => {
		const line = args.map(String).join(' ');
		if (line.startsWith('[fxdebug]')) debugLines.push(line);
		log(...args);
	};
	interface GameLayer {
		host: Container;
		emitter: Emitter;
		mounted: ReturnType<typeof mountParticleMaterial>;
		step: (frames: number) => void;
	}
	const mountLayer = (
		n: number,
		config: EmitterConfigV3,
		textures: Texture[],
		spec: ParticleMaterialSpec,
	): GameLayer => {
		const host = new Container();
		host.position.set((n % COLS) * CELL + CELL / 2, Math.floor(n / COLS) * CELL + CELL / 2);
		app.stage.addChild(host);
		const mounted = mountParticleMaterial({
			spec,
			host,
			textures,
			maxParticles: Number(config.maxParticles),
			rigParticles: false,
			emitSpeed: EMIT_SPEED,
			slots,
		});
		const material = mounted.material;
		const bound = bindArt(config, textures, false);
		const emitter = new Emitter(
			material?.particles ?? host,
			material ? material.bindConfig(bound) : bound,
		);
		const step = (frames: number) => {
			for (let i = 0; i < frames; i++) {
				emitter.update(FRAME_MS * EMIT_SPEED);
				material?.sync(renderer);
			}
		};
		return { host, emitter, mounted, step };
	};
	const game: Record<string, unknown> = {};
	const tinted = normalizeEffectDoc({
		id: 'embers',
		name: 'Embers',
		layers: [
			{
				key: 'main',
				config: base([], { maxParticles: 80 }),
				art: { assetKey: 'atlas', frames: ['static'] },
				placement: { space: 'free' },
				particleKind: 'sprite',
				material: { kind: 'custom:pulsetint', intensity: 4 },
			},
		],
		params: [
			{
				id: 'hue',
				kind: 'color',
				default: '#ff2020',
				drives: [{ id: 'h', layer: 'main', path: 'material.param.color' }],
			},
		],
	});
	const tintedLayer = tinted.layers[0];
	claim(
		'the doc carries its material with the default written in',
		tintedLayer.material?.params?.color === '#ff2020',
	);
	const on = mountLayer(0, tintedLayer.config, [frame('static')], {
		...tintedLayer.material!,
		label: 'embers/main',
	});
	const onMaterial = on.mounted.material;
	claim('a registered kind mounts its renderer', on.mounted.state === 'on' && !!onMaterial);
	// The same kind as layer 0, with its own value: a drive on layer 0 must not reach it.
	const second = mountLayer(1, base([]), [frame('rotated')], {
		kind: 'custom:pulsetint',
		intensity: 4,
		params: { color: '#2040ff' },
		label: 'b',
	});
	const third = mountLayer(2, base([]), [frame('trimmed')], { kind: 'custom:alone', label: 'c' });
	const capped = mountLayer(3, base([]), [frame('static')], { kind: 'custom:alone', label: 'd' });
	claim(
		`the game cap: three layers on, the fourth plain (${capped.mounted.state})`,
		second.mounted.state === 'on' &&
			third.mounted.state === 'on' &&
			capped.mounted.state === 'over the game cap' &&
			slots.drawing === 3,
	);
	const applier = bindEffectParams({
		params: tinted.params,
		layer: tintedLayer,
		emitter: on.emitter,
		material: onMaterial,
	});
	for (const l of [on, second, third, capped]) l.step(50);
	claim(
		'a capped layer is a layer with no material: its sprites sit in the host itself',
		capped.mounted.material === undefined &&
			capped.host.children.length > 0 &&
			capped.host.children.every((c) => c instanceof Sprite),
	);
	renderer.render(app.stage);
	const tintRed = readCanvas();
	const meshBefore = meshOf(on.host);
	const shaderBefore = meshBefore?.shader;
	const childrenBefore = [...on.host.children];
	const particlesBefore = [...(onMaterial?.particles.children ?? [])];
	claim(
		'the material layer draws through its mesh, its sprites hidden',
		!!meshBefore && meshBefore.visible && onMaterial?.particles.visible === false,
	);
	claim('the capped layer still draws its sprites', compare(tintRed, tintRed, 3).drawn > 500);
	// Another material layer's own draw, alone on the canvas: layer 0's particles spawn near its cell's
	// edge and, scaled and turned, reach into cell 1, so the whole canvas cannot say whose pixels moved.
	const hosts = [on, second, third, capped].map((l) => l.host);
	const drawnAlone = (host: Container): Read => {
		for (const h of hosts) h.visible = h === host;
		renderer.render(app.stage);
		const read = readCanvas();
		for (const h of hosts) h.visible = true;
		return read;
	};
	const secondBefore = drawnAlone(second.host);
	const firstBefore = drawnAlone(on.host);
	applier?.apply({ hue: '#20ff20' });
	onMaterial?.sync(renderer);
	renderer.render(app.stage);
	const tintGreen = readCanvas();
	const changed = compare(tintRed, tintGreen, 0);
	game.paramWrite = { drawn: changed.drawn, changed: changed.over };
	claim(
		`a \`material.param.*\` drive changes the pixels (${changed.over} of ${changed.drawn} drawn)`,
		changed.over > 200,
	);
	claim(
		'…by a uniform write: the same mesh, shader, children and particles (no rebuild, no re-init)',
		meshOf(on.host) === meshBefore &&
			meshBefore?.shader === shaderBefore &&
			on.host.children.every((c, i) => c === childrenBefore[i]) &&
			onMaterial?.particles.children.every((p, i) => p === particlesBefore[i]) === true &&
			particlesBefore.length > 0,
	);
	onMaterial?.sync(renderer);
	const secondAfter = drawnAlone(second.host);
	const others = compare(secondBefore, secondAfter, 1);
	const spill = compare(firstBefore, firstBefore, 1).drawn;
	game.otherLayer = {
		drawn: others.drawn,
		changed: others.over,
		canvasChanged: compare(tintRed, tintGreen, 1).over,
		firstLayerPxInItsCell: spill,
	};
	claim(
		`another material layer's own draw is untouched by the drive (${others.over} of ${others.drawn} px changed)`,
		others.over === 0 && others.drawn > 500,
	);

	for (const l of [second, third]) {
		l.emitter.destroy();
		l.mounted.release();
	}
	capped.emitter.destroy();
	capped.mounted.release();
	claim(`releasing gives the slots back (${slots.drawing} drawing)`, slots.drawing === 1);
	const twoSources = mountLayer(1, base([]), [frame('static'), other], { kind: 'custom:alone' });
	claim(
		`refused at mount: plain (${twoSources.mounted.state}), nothing left in the host, the slot given back`,
		twoSources.mounted.state === 'frames on several textures' &&
			twoSources.mounted.material === undefined &&
			twoSources.host.children.length === 0 &&
			slots.drawing === 1,
	);
	const overCap = mountLayer(
		2,
		base([], { maxParticles: PARTICLE_MATERIAL_CAPACITY + 1 }),
		[frame('static')],
		{
			kind: 'custom:alone',
		},
	);
	claim(
		'Max particles over the cap: plain at mount, the slot given back',
		overCap.mounted.state === 'over capacity' && slots.drawing === 1,
	);
	const sized = mountLayer(3, base([], { maxParticles: 20, frequency: 0.01 }), [frame('static')], {
		kind: 'custom:alone',
		peakParticles: 200,
	});
	sized.emitter.maxParticles = 200;
	sized.step(60);
	const sizedLive = sized.mounted.material?.particles.children.length ?? 0;
	claim(
		`a buffer sized to a drive's peak stays on when the drive raises Max particles (${sizedLive} live)`,
		sized.mounted.material?.plain === undefined && sizedLive > 20,
	);
	const drivable = mountLayer(5, base([], { maxParticles: 200 }), [frame('static')], {
		kind: 'custom:alone',
		peakParticles: 2000,
		label: 'drivable',
	});
	const unboundedDrive = mountLayer(6, base([], { maxParticles: 200 }), [frame('static')], {
		kind: 'custom:alone',
		peakParticles: Infinity,
	});
	drivable.emitter.maxParticles = 2000;
	drivable.step(60);
	unboundedDrive.step(60);
	renderer.render(app.stage);
	const drivableRead = readCanvas();
	claim(
		`Max particles drivable past 512: plain from mount (${drivable.mounted.state}), its sprites drawing, its slot never taken`,
		drivable.mounted.state === 'Max particles can be driven over 512' &&
			drivable.mounted.material === undefined &&
			compare(drivableRead, drivableRead, 5).drawn > 500 &&
			slots.drawing === 2,
	);
	claim(
		`Max particles driven with no bound: plain from mount (${unboundedDrive.mounted.state})`,
		unboundedDrive.mounted.state === 'Max particles driven with no bound' &&
			compare(drivableRead, drivableRead, 6).drawn > 500,
	);
	const failing = mountLayer(4, base([]), [frame('static')], {
		kind: 'custom:broken',
		label: 'x/broken',
	});
	const failingWasOn = failing.mounted.state === 'on';
	const drawingBefore = slots.drawing;
	console.warn = () => {};
	console.error = () => {};
	failing.step(30);
	console.warn = warn;
	console.error = report;
	renderer.render(app.stage);
	const failRead = readCanvas();
	claim(
		'a program that fails while playing turns plain, draws its sprites and gives its slot back',
		failingWasOn &&
			failing.mounted.material?.plain === 'program does not link' &&
			slots.drawing === drawingBefore - 1 &&
			compare(failRead, failRead, 4).drawn > 500,
	);
	console.log = log;
	game.debug = debugLines;
	claim(
		`?fxdebug=1 names each material layer's state and kind (${debugLines.length} lines)`,
		debugLines.some((l) => l.includes('embers/main: on (custom:pulsetint')) &&
			debugLines.some((l) => l.includes('d: plain, over the game cap (custom:alone')) &&
			debugLines.some((l) => l.includes('plain, frames on several textures')) &&
			debugLines.some((l) => l.includes('x/broken: plain while playing, program does not link')),
	);
	for (const l of [on, twoSources, overCap, sized, drivable, unboundedDrive, failing]) {
		l.emitter.destroy();
		l.mounted.release();
	}
	claim(`every slot is back at the end (${slots.drawing})`, slots.drawing === 0);
	setCustomElementFx([]);
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
		game,
		steady: { frames: FRAMES, ms: steadyMs, peak, ...counts, same },
		sync: { particles: mirrored, ms: syncMs },
		errors,
	};
	page.ready = true;
})().catch((error: Error) => {
	console.error(`particle-material: threw ${error.stack ?? error.message}`);
	page.ready = true;
});
