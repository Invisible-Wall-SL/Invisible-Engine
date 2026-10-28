/**
 * The screen shell's page (`shaderPages.mjs`; `shaderCompile.mjs` draws it in CI) on WebGL1 or
 * WebGL2, `?screens=1`: every compiled body the gates know (the reference graphs, the calibration
 * graphs, the twins, every node's own graph and the Custom GLSL bodies: the samples, the examples,
 * the Particle and Screens nodes', random ones from the grammar, and every broken or one-slip body
 * the checker takes, ten to a graph) built through the screen shell (`constants-shared/screenShell`)
 * as a transition's In route draws it: one Pixi `Filter` with the element pass's vertex stage over a
 * cell standing for the stage, the new screen its input and a still of the old one its second
 * texture. A body the shell refuses, or a program that does not compile or link, is named (each body
 * of a failing graph drawn alone) and `shaderCompile.mjs` fails on the line logged.
 *
 * Also the Screens node's meanings, read back off the canvas: through the screen shell From reads
 * the still (each quarter where it is, so the mapping is neither turned nor flipped), To and an
 * Output alone the new screen, Reverse the shell's switch (0 leaving the old screen showing through,
 * 1 white), and a crossfade at half way the mean of the two; on an element (through the element's
 * own pass) and on a particle (through the particle shell) From and To read what Sample element
 * reads there, and Reverse 0.
 */
import {
	Application,
	Container,
	Filter,
	GlProgram,
	Graphics,
	Rectangle,
	RenderTexture,
	Sprite,
	UniformGroup,
	type Texture,
	type WebGLRenderer,
} from 'pixi.js';
import {
	elementFxParamUniform,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	SCREEN_FROM_TEXTURE,
	SCREEN_REVERSE,
	screenShellSource,
} from '@fxroot/packages/constants-shared/screenShell';
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
	graphBuilder,
	nodeShowcase,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import {
	CUSTOM_GLSL_EXAMPLES,
	PARTICLE_GLSL,
	SCREEN_GLSL,
	VALID_GLSL,
	customGlslChain,
	generatedGlsl,
	mutatedGlsl,
	nearMissGlsl,
	type GlslSample,
} from '@fxroot/packages/engine-shadergraph/customGlsl.samples';
import { graphFilter } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/custom';
import { VERTEX } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/shaders';
import { ATLAS, FRAME, SEED, TIME, TRIM, makeCard, particleMesh } from './particleCell';

const COLS = 12;
const CELL_W = 170;
const CELL_H = 190;

/** The meanings' screens: the new one a flat colour, the old one a colour a quarter. */
const NEW = [40, 160, 90];
const OLD = { tl: [200, 60, 40], tr: [50, 70, 210], bl: [230, 200, 40], br: [120, 40, 160] };

const hex = (rgb: number[]): number => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

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

	/** A cell-sized texture drawn once from `scene`. */
	const still = (scene: Container): Texture => {
		const texture = RenderTexture.create({ width: CELL_W, height: CELL_H });
		renderer.render({ container: scene, target: texture, clear: true, clearColor: [0, 0, 0, 0] });
		return texture;
	};
	const cardOn = (backdrop: number): Container => {
		const scene = new Container();
		const card = makeCard();
		card.position.set(CELL_W / 2, CELL_H / 2);
		scene.addChild(new Graphics().rect(0, 0, CELL_W, CELL_H).fill(backdrop), card);
		return scene;
	};
	const newScreen = still(cardOn(0xdfe6ee));
	const oldScreen = still(
		(() => {
			const scene = new Container();
			scene.addChild(
				new Graphics().rect(0, 0, CELL_W, CELL_H).fill(0x1d3557),
				new Graphics().star(CELL_W / 2, CELL_H / 2, 6, 60, 26).fill(0xffd166),
			);
			return scene;
		})(),
	);
	const flatNew = still(new Graphics().rect(0, 0, CELL_W, CELL_H).fill(hex(NEW)));
	const quarters = still(
		new Graphics()
			.rect(0, 0, CELL_W / 2, CELL_H / 2)
			.fill(hex(OLD.tl))
			.rect(CELL_W / 2, 0, CELL_W / 2, CELL_H / 2)
			.fill(hex(OLD.tr))
			.rect(0, CELL_H / 2, CELL_W / 2, CELL_H / 2)
			.fill(hex(OLD.bl))
			.rect(CELL_W / 2, CELL_H / 2, CELL_W / 2, CELL_H / 2)
			.fill(hex(OLD.br)),
	);
	const atlas = RenderTexture.create({ width: ATLAS, height: ATLAS });
	const atlasCard = makeCard();
	atlasCard.position.set(FRAME.x + TRIM.w / 2, FRAME.y + TRIM.h / 2);
	renderer.render({ container: atlasCard, target: atlas, clear: true, clearColor: [0, 0, 0, 0] });
	const probe = RenderTexture.create({ width: CELL_W, height: CELL_H });

	/**
	 * A cell standing for the stage with `effect` as its transition: the new screen under a filter
	 * built from the screen shell, the still its second texture, or why it cannot be.
	 */
	const screenCell = (
		name: string,
		effect: CustomElementFx,
		{ to = newScreen, from = oldScreen, reverse = 0, progress = TIME[0] } = {},
	): { cell: Container; program: GlProgram } | string => {
		const fragment = screenShellSource(effect);
		if (!fragment) return 'the screen shell refuses its body';
		const params = new Map(effect.spec.params.map((p) => [p.id, p]));
		const uniforms: ConstructorParameters<typeof UniformGroup>[0] = {
			[SCREEN_REVERSE]: { value: reverse, type: 'f32' },
		};
		for (const u of effect.shader.uniforms) {
			const spec = u.source.kind === 'param' ? params.get(u.source.id) : undefined;
			const value =
				u.source.kind === 'time'
					? [progress, ...TIME.slice(1)]
					: u.source.kind === 'seed'
						? [SEED]
						: spec
							? elementFxParamUniform(spec, spec.default)
							: [0];
			uniforms[u.name] =
				u.type === 'float'
					? { value: value[0], type: 'f32' as const }
					: { value: new Float32Array(value), type: `${u.type}<f32>` as const };
		}
		const program = GlProgram.from({
			vertex: VERTEX,
			fragment,
			name: `screen-${name.replace(/\W/g, '-')}`,
		});
		const filter = new Filter({
			glProgram: program,
			resources: {
				screenUniforms: new UniformGroup(uniforms),
				[SCREEN_FROM_TEXTURE]: from.source,
			},
			clipToViewport: false,
		});
		const cell = new Container();
		cell.addChild(new Sprite(to));
		cell.filterArea = new Rectangle(0, 0, CELL_W, CELL_H);
		cell.filters = [filter];
		return { cell, program };
	};

	/** Whether `program` compiled and linked: `cell` drawn alone, Pixi's log taken, the driver asked. */
	const draws = (cell: Container, program: GlProgram): string[] => {
		const report = console.error;
		const logged: string[] = [];
		console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
		try {
			renderer.render({ container: cell, target: probe });
			const compiled = renderer.shader._getProgramData(program)?.program;
			if (!compiled || !renderer.gl.getProgramParameter(compiled, renderer.gl.LINK_STATUS))
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
	/** `doc` drawn as a transition, or why not. */
	const failures = (name: string, doc: ShaderGraphDoc): string[] => {
		const effect = effectOf(doc);
		if (typeof effect === 'string') return [effect];
		const drawn = screenCell(name, effect);
		return typeof drawn === 'string' ? [drawn] : draws(drawn.cell, drawn.program);
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
		...SCREEN_GLSL.map((sample) => ({ name: sample.name, samples: [sample] })),
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
		...nodeShowcase().map((doc) => ({ name: doc.id, doc })),
		...groups.map((group, i) => ({
			name: group.name,
			doc: customGlslChain(`screen-glsl-${i}`, group.samples),
			samples: group.samples,
		})),
	];

	const at = (i: number) => ({
		x: (i % COLS) * CELL_W,
		y: Math.floor(i / COLS) * CELL_H,
	});
	const labels: string[] = [];
	const place = (item: Container, label: string, centred = false): number => {
		const i = labels.length;
		labels.push(label);
		item.position.set(at(i).x + (centred ? CELL_W / 2 : 0), at(i).y + (centred ? CELL_H / 2 : 0));
		app.stage.addChild(item);
		return i;
	};
	for (const cell of cells) {
		const effect = effectOf(cell.doc);
		const drawn = typeof effect === 'string' ? effect : screenCell(cell.name, effect);
		const failed = typeof drawn === 'string' ? [drawn] : draws(drawn.cell, drawn.program);
		if (typeof drawn !== 'string' && !failed.length) {
			place(drawn.cell, cell.name);
			continue;
		}
		// Name the body that failed: each alone.
		const culprits = (cell.samples ?? []).filter(
			(sample) => failures(`${cell.name} alone`, customGlslChain('alone', [sample])).length > 0,
		);
		const said = failed.join(' ').replace(/\s+/g, ' ').slice(0, 400);
		if (!culprits.length) console.error(`${cell.name}: as a screen transition, ${said}`);
		for (const sample of culprits)
			console.error(`${sample.name}: as a screen transition, ${said}\n${sample.code}`);
	}

	// The meanings through the screen shell, over flat screens.
	const showcase = (id: string) => nodeShowcase().find((d) => d.id === id) as ShaderGraphDoc;
	const crossfade = graphBuilder({
		id: 'screens-crossfade',
		name: 'Screens crossfade',
		phase: 'enter',
		durationMs: 1000,
	});
	const screens = crossfade.node('screens');
	const mix = crossfade.node('mix');
	crossfade.wire(screens, 'from', mix, 'a');
	crossfade.wire(screens, 'to', mix, 'b');
	crossfade.wire(crossfade.node('time'), 'progress', mix, 't');
	crossfade.wire(mix, 'out', crossfade.node('output'), 'color');
	const alone = graphBuilder({
		id: 'output-alone',
		name: 'Output alone',
		phase: 'enter',
		durationMs: 1000,
	});
	alone.node('output');
	const meaning = (
		label: string,
		doc: ShaderGraphDoc,
		options: Parameters<typeof screenCell>[2] = {},
	): number => {
		const effect = effectOf(doc);
		const drawn =
			typeof effect === 'string'
				? effect
				: screenCell(label, effect, { to: flatNew, from: quarters, ...options });
		if (typeof drawn === 'string') {
			console.error(`${label}: ${drawn}`);
			return -1;
		}
		return place(drawn.cell, label);
	};
	const fromCell = meaning('From through the screen shell', showcase('screens-from'));
	const toCell = meaning('To through the screen shell', showcase('screens-to'));
	const forward = meaning('Reverse 0 through the screen shell', showcase('screens-reverse'));
	const reversed = meaning('Reverse 1 through the screen shell', showcase('screens-reverse'), {
		reverse: 1,
	});
	const aloneCell = meaning('an Output alone through the screen shell', alone.doc());
	const halfWay = meaning('a crossfade half way through the screen shell', crossfade.doc(), {
		progress: 0.5,
	});

	// The neutral meanings: on an element and on a particle, beside what Sample element draws there.
	const neutral: Record<string, { element: number; particle: number }> = {};
	for (const id of ['sample-out', 'screens-from', 'screens-to', 'screens-reverse']) {
		const doc = showcase(id);
		const result = compileShaderGraph(doc);
		const element = makeCard();
		if (result.ok) element.filters = [graphFilter(doc.id, result.shader)];
		const onElement = place(element, `${id} on an element`, true);
		const effect = effectOf(doc);
		const mesh = typeof effect === 'string' ? effect : particleMesh(id, effect, atlas);
		if (typeof mesh === 'string') {
			console.error(`${id} on a particle: ${mesh}`);
			continue;
		}
		neutral[id] = { element: onElement, particle: place(mesh, `${id} on a particle`, true) };
	}

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
	/** Cell `i` at a share of its width and height. */
	const read = (i: number, u: number, v: number): number[] =>
		pixel(Math.floor(at(i).x + u * CELL_W), Math.floor(at(i).y + v * CELL_H));
	const near = (a: number[], b: number[]): boolean => a.every((v, k) => Math.abs(v - b[k]) <= 3);
	/** Where each quarter of the still is read: its middle and a corner 2 px in. */
	const spots: [keyof typeof OLD, number, number][] = [
		['tl', 0.25, 0.25],
		['tr', 0.75, 0.25],
		['bl', 0.25, 0.75],
		['br', 0.75, 0.75],
		['tl', 2 / CELL_W, 2 / CELL_H],
		['tr', 1 - 3 / CELL_W, 2 / CELL_H],
		['bl', 2 / CELL_W, 1 - 3 / CELL_H],
		['br', 1 - 3 / CELL_W, 1 - 3 / CELL_H],
	];
	const everywhere = (i: number, expected: (quarter: keyof typeof OLD) => number[]): boolean =>
		i >= 0 && spots.every(([quarter, u, v]) => near(read(i, u, v), expected(quarter)));
	/** Points over the card: its middle, its star, its bar, its edge and off it. */
	const cardSpots: [number, number][] = [
		[0.5, 0.5],
		[0.5, 0.45],
		[0.5, 0.71],
		[0.5 - 58 / CELL_W, 0.5],
		[0.05, 0.05],
	];
	const sameAs = (a: number | undefined, b: number | undefined): boolean =>
		a !== undefined &&
		b !== undefined &&
		cardSpots.every(([u, v]) => near(read(a, u, v), read(b, u, v)));
	const background = (i: number | undefined): boolean =>
		i !== undefined && cardSpots.every(([u, v]) => near(read(i, u, v), [0x20, 0x23, 0x2a]));
	const claims: [string, boolean][] = [
		[
			'through the screen shell From reads the still, each quarter where it is',
			everywhere(fromCell, (q) => OLD[q]),
		],
		['through the screen shell To reads the new screen', everywhere(toCell, () => NEW)],
		[
			'through the screen shell Reverse 0 leaves the old screen showing',
			everywhere(forward, (q) => OLD[q]),
		],
		['through the screen shell Reverse 1 reads 1', everywhere(reversed, () => [255, 255, 255])],
		[
			'through the screen shell an Output alone draws the new screen',
			everywhere(aloneCell, () => NEW),
		],
		[
			'through the screen shell a crossfade half way is the mean of the two screens',
			everywhere(halfWay, (q) => OLD[q].map((c, k) => (c + NEW[k]) / 2)),
		],
		...(['element', 'particle'] as const).flatMap((on): [string, boolean][] => [
			[
				`on ${on === 'element' ? 'an element' : 'a particle'} From reads what Sample element reads`,
				sameAs(neutral['screens-from']?.[on], neutral['sample-out']?.[on]),
			],
			[
				`on ${on === 'element' ? 'an element' : 'a particle'} To reads what Sample element reads`,
				sameAs(neutral['screens-to']?.[on], neutral['sample-out']?.[on]),
			],
			[
				`on ${on === 'element' ? 'an element' : 'a particle'} Reverse is 0`,
				background(neutral['screens-reverse']?.[on]),
			],
		]),
	];
	for (const [label, ok] of claims) if (!ok) console.error(`screens: ${label}`);
	page.meanings = Object.fromEntries(claims);
	page.rows = rows;
	page.ready = true;
})();
