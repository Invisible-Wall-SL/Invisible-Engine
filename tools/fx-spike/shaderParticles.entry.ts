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
	RenderTexture,
	type Geometry,
	type Mesh,
	type Shader,
	type WebGLRenderer,
} from 'pixi.js';
import type { CustomElementFx } from '@fxroot/packages/constants-shared/elementFx';
import {
	BUILTIN_TWINS,
	CALIBRATION_GRAPHS,
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
import { ATLAS, COLOR, FRAME, ORDER, TRIM, WAVE, makeCard, particleMesh } from './particleCell';

const COLS = 12;
const CELL_W = 170;
const CELL_H = 190;
const BACKGROUND = [0x20, 0x23, 0x2a];

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
		...CALIBRATION_GRAPHS.map((doc) => ({ name: doc.id, doc })),
		...BUILTIN_TWINS.map((twin) => ({
			name: `twin ${twin.kind}`,
			doc: twin.doc as ShaderGraphDoc,
		})),
		// The Screens node's graphs are drawn on the screens sheet, so this one's layout predates it.
		...nodeShowcase()
			.filter((doc) => !doc.nodes.some((n) => n.type === 'screens'))
			.map((doc) => ({ name: doc.id, doc })),
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
