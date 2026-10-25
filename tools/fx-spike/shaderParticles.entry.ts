/**
 * The particle shell's page (`shaderPages.mjs`; `shaderCompile.mjs` draws it in CI) on WebGL1 or
 * WebGL2, `?particles=1`: every compiled body the gates know (the reference graphs, the twins, every
 * node's own graph and the Custom GLSL bodies: the samples, the examples, the Particle node's, random
 * ones from the grammar, and every broken or one-slip body the checker takes, ten to a graph) built
 * through the particle shell (`constants-shared/particleShell`) with its vertex shader, as a Pixi
 * `Mesh` draws a material: one particle each, a trimmed frame of an atlas, padded, tinted and faded.
 * A body the shell refuses, or a program that does not compile or link, is named (each body of a
 * failing graph drawn alone) and `shaderCompile.mjs` fails on the line logged.
 *
 * Also the Particle node's meanings, read back off the canvas: on an element (through the element's
 * own pass) its Colour is white and opaque and its indexes 0; on a particle its Colour is the
 * particle's own (the graph owns it, so nothing is multiplied after) and its indexes are the ones the
 * vertices carry, tinted and faded after as a sprite is. Whether the drawing matches the plain sprite
 * it replaces is the material renderer's gate (step 8d.2).
 */
import {
	Application,
	Container,
	FillGradient,
	Geometry,
	GlProgram,
	Graphics,
	Mesh,
	RenderTexture,
	Shader,
	UniformGroup,
	type WebGLRenderer,
} from 'pixi.js';
import {
	elementFxParamUniform,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	PARTICLE_ATTRIBUTES,
	PARTICLE_VERTEX,
	particleShellSource,
} from '@fxroot/packages/constants-shared/particleShell';
import {
	BUILTIN_TWINS,
	CUSTOM_GLSL,
	CUSTOM_GLSL_EFFECT_COST_MAX,
	CUSTOM_GLSL_EFFECT_SAMPLES_MAX,
	REFERENCE_GRAPHS,
	compileShaderEffect,
	compileShaderGraph,
	customGlslDef,
	customGlslIssues,
	nodeShowcase,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import {
	CUSTOM_GLSL_EXAMPLES,
	PARTICLE_GLSL,
	VALID_GLSL,
	customGlslChain,
	generatedGlsl,
	mutatedGlsl,
	nearMissGlsl,
	type GlslSample,
} from '@fxroot/packages/engine-shadergraph/customGlsl.samples';
import { graphFilter } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/custom';

const COLS = 12;
const CELL_W = 170;
const CELL_H = 190;
const BACKGROUND = [0x20, 0x23, 0x2a];

/** The atlas: the test card drawn in a 256 × 256 texture. */
const ATLAS = 256;
/** The particle's frame: untrimmed 140 × 170, its 124 × 144 trimmed box 8, 13 in, at 66, 56. */
const ORIG = { w: 140, h: 170 };
const TRIM = { x: 8, y: 13, w: 124, h: 144 };
const FRAME = { x: 66, y: 56 };
/** Drawn at 0.8, padded by 0.1 of its larger side. */
const SIZE = { w: ORIG.w * 0.8, h: ORIG.h * 0.8 };
const PAD = 0.1 * Math.max(SIZE.w, SIZE.h);
/** What the particle carries: its seed, wave index and spawn order, its colour and its time. */
const SEED = 41;
const WAVE = 0.5;
const ORDER = 0.25;
const TINT = [1, 0.8, 0.6];
const ALPHA = 0.9;
const COLOR = [...TINT.map((c) => c * ALPHA), ALPHA];
const TIME = [0.5, 0.5, 1, 0];

const makeCard = (): Container => {
	const card = new Container();
	const fill = new FillGradient(0, 0, 120, 140);
	fill.addColorStop(0, 0xff4d6d);
	fill.addColorStop(0.5, 0xffb703);
	fill.addColorStop(1, 0x3a86ff);
	card.addChild(
		new Graphics()
			.roundRect(-60, -70, 120, 140, 18)
			.fill(fill)
			.stroke({ width: 4, color: 0xffffff }),
		new Graphics().star(0, -10, 5, 34, 16).fill(0xffffff),
		new Graphics().rect(-40, 30, 80, 16).fill(0x111111),
	);
	return card;
};

/** Each attribute's four values, one particle's quad, in the vertex shader's layout. */
const quad = (): Record<string, number[][]> => {
	const pad = { x: PAD / SIZE.w, y: PAD / SIZE.h };
	const units = [
		[-pad.x, -pad.y],
		[1 + pad.x, -pad.y],
		[1 + pad.x, 1 + pad.y],
		[-pad.x, 1 + pad.y],
	];
	const at = (values: number[]): number[][] => units.map(() => values);
	return {
		aPosition: units.map(([u, v]) => [(u - 0.5) * SIZE.w, (v - 0.5) * SIZE.h, u, v]),
		aEfxFrame: at([SIZE.w, SIZE.h, SEED]),
		aEfxMap: at([(FRAME.x - TRIM.x) / ATLAS, (FRAME.y - TRIM.y) / ATLAS, ORIG.w / ATLAS, 0]),
		aEfxMap2: at([0, ORIG.h / ATLAS, WAVE, ORDER]),
		aEfxTrim: at([
			TRIM.x / ORIG.w,
			TRIM.y / ORIG.h,
			(TRIM.x + TRIM.w) / ORIG.w,
			(TRIM.y + TRIM.h) / ORIG.h,
		]),
		aEfxColor: at(COLOR),
		aEfxTime: at(TIME),
	};
};

const FORMATS: Record<number, 'float32x2' | 'float32x3' | 'float32x4'> = {
	2: 'float32x2',
	3: 'float32x3',
	4: 'float32x4',
};

/** One particle drawn with `effect` as its material, or why it cannot be. */
const particleMesh = (
	name: string,
	effect: CustomElementFx,
	atlas: RenderTexture,
): Mesh<Geometry, Shader> | string => {
	const fragment = particleShellSource(effect);
	if (!fragment) return 'the particle shell refuses its body';
	const values = quad();
	const missing = PARTICLE_ATTRIBUTES.filter((a) => values[a.name]?.[0]?.length !== a.size);
	if (missing.length) return `the page gives no ${missing.map((a) => a.name).join(', ')}`;
	const geometry = new Geometry({
		attributes: Object.fromEntries(
			PARTICLE_ATTRIBUTES.map((a) => [
				a.name,
				{ buffer: new Float32Array(values[a.name].flat()), format: FORMATS[a.size] },
			]),
		),
		indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
	});
	const params = new Map(effect.spec.params.map((p) => [p.id, p]));
	const uniforms: ConstructorParameters<typeof UniformGroup>[0] = {};
	for (const u of effect.shader.uniforms) {
		if (u.source.kind !== 'param') continue;
		const spec = params.get(u.source.id);
		const value = spec ? elementFxParamUniform(spec, spec.default) : [0];
		uniforms[u.name] =
			u.type === 'float'
				? { value: value[0], type: 'f32' as const }
				: { value: new Float32Array(value), type: `${u.type}<f32>` as const };
	}
	const shader = new Shader({
		glProgram: GlProgram.from({
			vertex: PARTICLE_VERTEX,
			fragment,
			name: `particle-${name.replace(/\W/g, '-')}`,
		}),
		resources: {
			uTexture: atlas.source,
			...(Object.keys(uniforms).length ? { efxParams: new UniformGroup(uniforms) } : {}),
		},
	});
	return new Mesh({ geometry, shader, texture: atlas });
};

const page = window as unknown as {
	rows: string[];
	ready: boolean;
	meanings?: Record<string, boolean>;
};

(async () => {
	const query = new URLSearchParams(location.search);
	const app = new Application();
	await app.init({
		width: COLS * CELL_W,
		height: CELL_H,
		background: 0x20232a,
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
	const atlas = RenderTexture.create({ width: ATLAS, height: ATLAS });
	const card = makeCard();
	card.position.set(FRAME.x + TRIM.w / 2, FRAME.y + TRIM.h / 2);
	renderer.render({ container: card, target: atlas, clear: true, clearColor: [0, 0, 0, 0] });
	const probe = RenderTexture.create({ width: CELL_W, height: CELL_H });

	/** Whether `mesh`'s program compiled and linked: drawn alone, Pixi's log taken, the driver asked. */
	const draws = (mesh: Mesh<Geometry, Shader>): string[] => {
		const report = console.error;
		const logged: string[] = [];
		console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
		try {
			renderer.render({ container: mesh, target: probe });
			const glProgram = mesh.shader?.glProgram;
			const program = glProgram && renderer.shader._getProgramData(glProgram)?.program;
			if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS))
				logged.push('the program does not link');
		} catch (error) {
			logged.push(`threw ${(error as Error).message}`);
		} finally {
			console.error = report;
		}
		return logged;
	};
	const effectOf = (doc: ShaderGraphDoc): CustomElementFx | string => {
		const result = compileShaderEffect(doc);
		return result.ok
			? result.effect
			: `does not compile: ${result.issues.map((i) => i.message).join('; ')}`;
	};
	/** `doc` drawn as one particle, or why not. */
	const failures = (name: string, doc: ShaderGraphDoc): string[] => {
		const effect = effectOf(doc);
		if (typeof effect === 'string') return [effect];
		const mesh = particleMesh(name, effect, atlas);
		return typeof mesh === 'string' ? [mesh] : draws(mesh);
	};

	const nodeOf = (sample: GlslSample) => ({
		id: 'g',
		type: CUSTOM_GLSL,
		x: 0,
		y: 0,
		glsl: sample,
	});
	const accepted = (sample: GlslSample): boolean =>
		!customGlslIssues(nodeOf(sample)).some((i) => i.level === 'error');
	/** `samples` in graphs of up to ten, each within what an effect's Custom GLSL may spend. */
	const chunks = (samples: GlslSample[]): GlslSample[][] => {
		const out: GlslSample[][] = [];
		let cost = 0;
		let reads = 0;
		for (const sample of samples) {
			const def = customGlslDef(nodeOf(sample));
			const last = out[out.length - 1];
			if (
				!last ||
				last.length === 10 ||
				cost + def.cost > CUSTOM_GLSL_EFFECT_COST_MAX ||
				reads + (def.samples ?? 0) > CUSTOM_GLSL_EFFECT_SAMPLES_MAX
			) {
				out.push([sample]);
				cost = def.cost;
				reads = def.samples ?? 0;
			} else {
				last.push(sample);
				cost += def.cost;
				reads += def.samples ?? 0;
			}
		}
		return out;
	};
	const groups: { name: string; samples: GlslSample[] }[] = [
		...VALID_GLSL.map((sample) => ({ name: sample.name, samples: [sample] })),
		...PARTICLE_GLSL.map((sample) => ({ name: sample.name, samples: [sample] })),
		{ name: 'examples', samples: [...CUSTOM_GLSL_EXAMPLES] },
		...chunks(Array.from({ length: 200 }, (_, n) => generatedGlsl(5, n))).map((samples, i) => ({
			name: `generated ${i}`,
			samples,
		})),
		...chunks(Array.from({ length: 700 }, (_, n) => mutatedGlsl(13, n)).filter(accepted)).map(
			(samples, i) => ({ name: `mutated ${i}`, samples }),
		),
		...chunks(nearMissGlsl().filter(accepted)).map((samples, i) => ({
			name: `near ${i}`,
			samples,
		})),
	];
	const cells: { name: string; doc: ShaderGraphDoc; samples?: GlslSample[] }[] = [
		...REFERENCE_GRAPHS.map((doc) => ({ name: doc.id, doc })),
		...BUILTIN_TWINS.map((twin) => ({
			name: `twin ${twin.kind}`,
			doc: twin.doc as ShaderGraphDoc,
		})),
		...nodeShowcase().map((doc) => ({ name: doc.id, doc })),
		...groups.map((group, i) => ({
			name: group.name,
			doc: customGlslChain(`particle-glsl-${i}`, group.samples),
			samples: group.samples,
		})),
	];

	const at = (i: number) => ({
		x: (i % COLS) * CELL_W + CELL_W / 2,
		y: Math.floor(i / COLS) * CELL_H + CELL_H / 2,
	});
	for (const [i, cell] of cells.entries()) {
		const effect = effectOf(cell.doc);
		const mesh = typeof effect === 'string' ? effect : particleMesh(cell.name, effect, atlas);
		const failed = typeof mesh === 'string' ? [mesh] : draws(mesh);
		if (typeof mesh !== 'string' && !failed.length) {
			mesh.position.set(at(i).x, at(i).y);
			app.stage.addChild(mesh);
			continue;
		}
		// Name the body that failed: each alone.
		const culprits = (cell.samples ?? []).filter(
			(sample) => failures(`${cell.name} alone`, customGlslChain('alone', [sample])).length > 0,
		);
		const said = failed.join(' ').replace(/\s+/g, ' ').slice(0, 400);
		if (!culprits.length) console.error(`${cell.name}: as a particle material, ${said}`);
		for (const sample of culprits)
			console.error(`${sample.name}: as a particle material, ${said}\n${sample.code}`);
	}

	// The Particle node's meanings: on an element (through the element's pass), then on a particle.
	const ports = ['color', 'wave', 'order'];
	const first = cells.length;
	ports.forEach((port, k) => {
		const doc = nodeShowcase().find((d) => d.id === `particle-${port}`) as ShaderGraphDoc;
		const result = compileShaderGraph(doc);
		const element = makeCard();
		if (result.ok) element.filters = [graphFilter(doc.id, result.shader)];
		element.position.set(at(first + k).x, at(first + k).y);
		app.stage.addChild(element);
	});
	const labels = [...cells.map((c) => c.name), ...ports.map((p) => `particle-${p} on an element`)];
	const rows: string[] = [];
	labels.forEach((label, i) => {
		const row = Math.floor(i / COLS);
		rows[row] = rows[row] ? `${rows[row]} | ${label}` : label;
	});
	renderer.resize(COLS * CELL_W, rows.length * CELL_H);
	renderer.render(app.stage);

	const pixel = (x: number, y: number): number[] => {
		const out = new Uint8Array(4);
		const gl = renderer.gl;
		gl.readPixels(x, renderer.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return [...out].slice(0, 3);
	};
	/** Off the card's white star, on its black bar. */
	const onBar = (i: number): number[] => pixel(at(i).x, at(i).y + 38);
	const centre = (name: string): number[] => {
		const i = cells.findIndex((c) => c.name === name);
		return pixel(at(i).x, at(i).y);
	};
	/** `src` (premultiplied) drawn over the background, in 8 bits. */
	const over = (src: number[]): number[] =>
		BACKGROUND.map((bg, k) => Math.round(src[k] * 255 + bg * (1 - src[3])));
	const near = (a: number[], b: number[]): boolean => a.every((v, k) => Math.abs(v - b[k]) <= 3);
	const scaled = (k: number) => COLOR.map((c) => c * k);
	const claims: [string, boolean][] = [
		['on an element its Colour is white and opaque', near(onBar(first), [255, 255, 255])],
		['on an element its Wave index is 0', near(onBar(first + 1), BACKGROUND)],
		['on an element its Spawn order is 0', near(onBar(first + 2), BACKGROUND)],
		[
			'on a particle its Colour is the particle’s own, nothing multiplied after',
			near(centre('particle-color'), over(COLOR)),
		],
		[
			'on a particle its Wave index is the wave’s, tinted and faded after',
			near(centre('particle-wave'), over(scaled(WAVE))),
		],
		[
			'on a particle its Spawn order is the order’s, tinted and faded after',
			near(centre('particle-order'), over(scaled(ORDER))),
		],
	];
	for (const [label, ok] of claims) if (!ok) console.error(`particles: ${label}`);
	page.meanings = Object.fromEntries(claims);
	page.rows = rows;
	page.ready = true;
})();
