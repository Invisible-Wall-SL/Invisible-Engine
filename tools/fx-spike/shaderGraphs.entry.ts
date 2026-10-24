/**
 * The graph page `shaderParity.mjs` renders: with `?graphs=1` the reference shader graphs posed at
 * eight moments, one row each; with `?nodes=1` every node's own graph (`nodeShowcase`), one cell
 * each. Each graph is compiled and drawn through the real `ElementFxFilter` on WebGL1 or WebGL2, so
 * a node whose GLSL does not compile there fails the shoot (and `shaderCompile.mjs`). Each graph's pass
 * is compiled alone first, so the error the page logs names the graph.
 */
import { Application, Container, FillGradient, Graphics, Rectangle, RenderTexture } from 'pixi.js';
import {
	DIMS,
	REFERENCE_GRAPHS,
	compileShaderGraph,
	nodeShowcase,
	paramUniformValue,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import { ElementFxFilter } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/shaders';

const MOMENTS = [0.06, 0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.96];
const CELL_W = 170;
const CELL_H = 190;

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
	// The pass's frame is the card's box: the element is all of it (`uElement` stays 0, 0, 1, 1).
	card.filterArea = new Rectangle(-62, -72, 124, 144);
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
		if (spec) filter.set(u.name, ...paramUniformValue(spec, spec.default));
	}
	return filter;
};

(async () => {
	const query = new URLSearchParams(location.search);
	const cells: { doc: ShaderGraphDoc; t: number; col: number; row: number }[] = [];
	const rows: string[] = [];
	if (query.get('graphs') === '1') {
		REFERENCE_GRAPHS.forEach((doc, row) => {
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
	const probe = RenderTexture.create({ width: 64, height: 64 });
	const report = console.error.bind(console);
	for (const { doc, t, col, row } of cells) {
		const card = makeCard();
		card.filters = [filterFor(doc, t)];
		console.error = (...args: unknown[]) => report(`${doc.id}:`, ...args);
		app.renderer.render({ container: card, target: probe });
		console.error = report;
		card.position.set(col * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2);
		app.stage.addChild(card);
	}
	app.renderer.render(app.stage);
	const page = window as unknown as { rows: string[]; ready: boolean };
	page.rows = rows;
	page.ready = true;
})();
