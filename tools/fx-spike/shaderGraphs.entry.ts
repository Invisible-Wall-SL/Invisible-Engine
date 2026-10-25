/**
 * The graph page `shaderParity.mjs` renders: with `?graphs=1` the reference shader graphs posed at
 * eight moments, one row each; with `?custom=1` the same graphs compiled as custom Element FX
 * (`compileShaderEffect`), registered and played through the runtime (`playElementFx`) posed at the
 * eight moments, their passes and motion included; with `?subgraphs=1` each reference graph moved
 * into a subgraph its effect calls, one and two calls deep (`wrapped`), which draws as the graph
 * does; with `?nodes=1` every node's own graph (`nodeShowcase`), one cell each. Everything is drawn through the real `ElementFxFilter` on WebGL1
 * or WebGL2, so a shader that does not compile there fails the shoot (and `shaderCompile.mjs`). Each
 * cell is drawn alone first, so the error the page logs names its graph.
 */
import {
	Application,
	Container,
	FillGradient,
	Graphics,
	Rectangle,
	RenderTexture,
	Ticker,
} from 'pixi.js';
import {
	elementFxParamUniform,
	setCustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	DIMS,
	REFERENCE_GRAPHS,
	compileShaderEffect,
	compileShaderGraph,
	nodeShowcase,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import { playElementFx } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/runtime';
import { ElementFxFilter } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/shaders';

const MOMENTS = [0.06, 0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.96];
const CELL_W = 170;
const CELL_H = 190;

/** The test card. `bounded`: its pass frame is its own box (a filter set by hand, not the runtime). */
const makeCard = (bounded: boolean): Container => {
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
	// The pass's frame is the card's box: the element is all of it (`uElement` stays 0, 0, 1, 1).
	if (bounded) card.filterArea = new Rectangle(-62, -72, 124, 144);
	return card;
};

/** `doc` compiled into a filter posed at progress `t`, its params at their defaults. */
const filterFor = (doc: ShaderGraphDoc, t: number): ElementFxFilter => {
	const result = compileShaderGraph(doc);
	if (!result.ok) throw new Error(`${doc.id}: ${result.issues.map((i) => i.message).join('; ')}`);
	const { shader } = result;
	const uniforms = Object.fromEntries(
		shader.uniforms.map((u) => [
			u.name,
			u.type === 'float'
				? { value: 0, type: 'f32' }
				: { value: new Float32Array(DIMS[u.type]), type: `${u.type}<f32>` },
		]),
	);
	const filter = new ElementFxFilter(`graph-${doc.id.replace(/\W/g, '-')}`, shader.body, uniforms);
	filter.set('uFx', t, (t * doc.durationMs) / 1000, 1, 0);
	for (const u of shader.uniforms) {
		if (u.source.kind !== 'param') continue;
		const id = u.source.id;
		const spec = doc.params.find((p) => p.id === id);
		if (spec) filter.set(u.name, ...elementFxParamUniform(spec, spec.default));
	}
	return filter;
};

/**
 * `doc` with its graph moved into a subgraph its effect calls, `depth` calls deep: every node but the
 * Output in the innermost body, whose one output feeds the Output. It compiles to the same shader,
 * so it draws as `doc` does.
 */
const wrapped = (doc: ShaderGraphDoc, depth: number): ShaderGraphDoc => {
	let current = doc;
	for (let d = 0; d < depth; d++) {
		const output = current.nodes.find((n) => n.type === 'output');
		if (!output) return current;
		const feed = current.wires.find((w) => w.to.node === output.id && w.to.port === 'color');
		const id = `wrap${d}`;
		current = {
			...current,
			id: `${doc.id}-wrapped${d + 1}`,
			name: `${doc.name} (${d + 1} deep)`,
			subgraphs: [
				...(current.subgraphs ?? []),
				{
					id,
					name: `Wrap ${d}`,
					inputs: [],
					outputs: [{ id: 'color', label: 'Colour', type: 'vec4' }],
					nodes: [
						{ id: 'in', type: 'subgraphIn', x: 0, y: 0 },
						...current.nodes.filter((n) => n !== output),
						{ id: 'out', type: 'subgraphOut', x: 0, y: 0 },
					],
					wires: [
						...current.wires.filter((w) => w !== feed),
						...(feed ? [{ from: feed.from, to: { node: 'out', port: 'color' } }] : []),
					],
				},
			],
			nodes: [{ id: 'call', type: 'subgraph', x: 0, y: 0, values: { subgraph: id } }, output],
			wires: [{ from: { node: 'call', port: 'color' }, to: { node: output.id, port: 'color' } }],
		};
	}
	return current;
};

(async () => {
	const query = new URLSearchParams(location.search);
	const custom = query.get('custom') === '1';
	const cells: { doc: ShaderGraphDoc; t: number; col: number; row: number }[] = [];
	const rows: string[] = [];
	if (query.get('graphs') === '1' || custom) {
		REFERENCE_GRAPHS.forEach((doc, row) => {
			rows.push(doc.name);
			MOMENTS.forEach((t, col) => cells.push({ doc, t, col, row }));
		});
	} else if (query.get('subgraphs') === '1') {
		REFERENCE_GRAPHS.flatMap((doc) => [wrapped(doc, 1), wrapped(doc, 2)]).forEach((doc, row) => {
			rows.push(doc.name);
			MOMENTS.forEach((t, col) => cells.push({ doc, t, col, row }));
		});
	} else {
		nodeShowcase().forEach((doc, i) => {
			const row = Math.floor(i / MOMENTS.length);
			if (!rows[row]) rows[row] = '';
			rows[row] += `${rows[row] ? ' ' : ''}${doc.id}`;
			cells.push({ doc, t: 0.5, col: i % MOMENTS.length, row });
		});
	}
	const app = new Application();
	await app.init({
		width: MOMENTS.length * CELL_W,
		height: rows.length * CELL_H,
		background: 0x20232a,
		preference: 'webgl',
		preferWebGLVersion: query.get('gl') === '1' ? 1 : 2,
		antialias: false,
		autoStart: false,
		sharedTicker: false,
		resolution: 1,
	});
	document.body.appendChild(app.canvas);
	const ticker = new Ticker();
	ticker.autoStart = false;
	ticker.stop();
	const host = { ticker, renderer: app.renderer };
	if (custom) {
		setCustomElementFx(
			REFERENCE_GRAPHS.map((doc) => {
				const result = compileShaderEffect(doc);
				if (!result.ok) {
					throw new Error(`${doc.id}: ${result.issues.map((i) => i.message).join('; ')}`);
				}
				return result.effect;
			}),
		);
	}
	const probe = RenderTexture.create({ width: 256, height: 256 });
	const report = console.error.bind(console);
	for (const { doc, t, col, row } of cells) {
		const card = makeCard(!custom);
		const cell = new Container();
		cell.position.set(col * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2);
		cell.addChild(card);
		console.error = (...args: unknown[]) => report(`${doc.id}:`, ...args);
		if (custom) {
			const handle = playElementFx(
				card,
				{ kind: `custom:${doc.id}`, durationMs: doc.durationMs, pose: () => ({ progress: t }) },
				host,
			);
			if (!handle.active) report(`${doc.id}: the custom kind did not play`);
		} else {
			card.filters = [filterFor(doc, t)];
		}
		app.renderer.render({ container: card, target: probe });
		console.error = report;
		app.stage.addChild(cell);
	}
	let now = 1000;
	for (let k = 0; k < 3; k++) ticker.update((now += 16));
	app.renderer.render(app.stage);
	const page = window as unknown as { rows: string[]; ready: boolean };
	page.rows = rows;
	page.ready = true;
})();
