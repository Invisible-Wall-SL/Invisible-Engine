/**
 * The page `shaderParity.mjs` renders: every Element FX kind posed at eight moments, one row per
 * kind (or, with `?sides=1`, one row per starting side of each spreading kind), on a test card with
 * transparent rounded corners. `@fxroot/` is the checkout being rendered (see `--root`).
 */
import { Application, Container, FillGradient, Graphics, Ticker } from 'pixi.js';
import { ELEMENT_FX, type ElementFxKind } from '@fxroot/packages/constants-shared/elementFx';
import { playElementFx } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/index';

const MOMENTS = [0.06, 0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.96];
const CELL_W = 170;
const CELL_H = 190;
const SPREADING: readonly string[] = ['freeze', 'petrify', 'turnToGold', 'burn', 'crystallize'];

interface Row {
	kind: ElementFxKind;
	params?: Record<string, string>;
}

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

const rowsFor = (query: URLSearchParams): Row[] => {
	if (query.get('sides') === '1') {
		return ELEMENT_FX.filter((spec) => SPREADING.includes(spec.kind)).flatMap((spec) => {
			const from = spec.params.find((p) => p.id === 'from');
			return from?.kind === 'choice'
				? from.options.map((option) => ({ kind: spec.kind, params: { from: option } }))
				: [];
		});
	}
	const only = (query.get('only') ?? '').split(',').filter(Boolean);
	return ELEMENT_FX.filter((spec) => only.includes(spec.kind)).map((spec) => ({ kind: spec.kind }));
};

(async () => {
	const query = new URLSearchParams(location.search);
	const rows = rowsFor(query);
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
	rows.forEach((row, r) => {
		MOMENTS.forEach((moment, i) => {
			const cell = new Container();
			cell.position.set(i * CELL_W + CELL_W / 2, r * CELL_H + CELL_H / 2);
			const card = makeCard();
			cell.addChild(card);
			app.stage.addChild(cell);
			// A break is posed before it bursts in the sides sheet: there only its still is compared.
			const progress =
				query.get('sides') === '1' && row.kind === 'crystallize' ? moment * 0.3 : moment;
			playElementFx(
				card,
				{ kind: row.kind, params: row.params, durationMs: 1500, pose: () => ({ progress }) },
				host,
			);
		});
	});
	let now = 1000;
	for (let k = 0; k < 3; k++) ticker.update((now += 16));
	app.renderer.render(app.stage);
	const page = window as unknown as { rows: string[]; ready: boolean };
	page.rows = rows.map((row) => (row.params?.from ? `${row.kind}:${row.params.from}` : row.kind));
	page.ready = true;
})();
