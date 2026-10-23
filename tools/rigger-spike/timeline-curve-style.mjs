// Browser gate: the Timeline's Interpolation panel draws its curve in the /editor host's theme.
//
//   node tools/rigger-spike/timeline-curve-style.mjs
//
// THE BUG (reported in /editor, 2026-10-23): the Interpolation panel showed a solid black shape
// where the cubic curve belongs. The shared Timeline emits the curve as SVG (`.cineCurveBox`,
// `.cineCurveArm`, `.cineCurvePath`, `.cineCurveHandle`), and an SVG shape nobody styles is filled
// black with no stroke. /editor styles the module's markup from EditorTimelinePanel.svelte's
// `:global(...)` rules, and none of them named the curve classes.
//
// The page compiles that component's REAL stylesheet with Svelte, wraps the shared Timeline
// (`static/shared/timeline.mjs`) in a `.tl-panel` carrying the component's scope class, and reads
// the computed style of the default-interpolation editor for Cubic, Linear and Hold.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { launchChrome } from './chrome.mjs';

const LAUNCHER = new URL('../../apps/launcher-api/', import.meta.url);
const SHARED = fileURLToPath(new URL('static/shared/', LAUNCHER));
const PANEL = fileURLToPath(
	new URL('src/routes/(app)/editor/EditorTimelinePanel.svelte', LAUNCHER),
);

const { compile } = createRequire(fileURLToPath(new URL('package.json', LAUNCHER)))(
	'svelte/compiler',
);
const { css } = compile(readFileSync(PANEL, 'utf8'), { filename: PANEL, css: 'external' });
const scope = /\.tl-panel\.(svelte-[a-z0-9]+)/.exec(css.code)?.[1];
if (!scope) throw new Error('EditorTimelinePanel.svelte: no scoped `.tl-panel` rule');

const DOC = {
	schemaVersion: 1,
	id: 'respins',
	name: 'Respins',
	duration: 1,
	fps: 30,
	host: { kind: 'screen', sceneId: 'basegame' },
	stage: {
		sceneId: null,
		cast: [{ actorId: 'a_jp', kind: 'node', target: 'Jackpots', place: {}, z: 0 }],
	},
	tracks: [],
	markers: [],
	defaultEase: [0.42, 0, 0.58, 1],
};

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${css.code}</style></head>
<body><div class="tl-panel ${scope}"><div id="lanes"></div><div id="insp"></div></div>
<script type="module">
import { mount } from './timeline.mjs';
import * as EV from './cinematicEval.mjs';
const doc = ${JSON.stringify(DOC)};
window.tl = mount(document.getElementById('lanes'), {
	doc,
	ev: EV,
	inspector: document.getElementById('insp'),
	interpolation: true,
});
window.tl.setActive(true);
window.tl.renderTimeline();
window.tl.renderInspector();
window.ready = true;
</script></body></html>`;

const server = createServer((req, res) => {
	const path = new URL(req.url, 'http://x').pathname;
	if (path === '/') {
		res.writeHead(200, { 'content-type': 'text/html' });
		return res.end(HTML);
	}
	if (path === '/timeline.mjs' || path === '/cinematicEval.mjs') {
		res.writeHead(200, { 'content-type': 'text/javascript' });
		return res.end(readFileSync(SHARED + path.slice(1)));
	}
	res.writeHead(404);
	res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await launchChrome({ name: 'timeline-curve-style', url });
const { evaluate, waitFor } = browser;
try {
	await waitFor('window.ready === true');

	/** Computed fill / stroke of every curve shape, plus the theme colours they should use. */
	const read = () =>
		evaluate(`(() => {
			const panel = document.querySelector('.tl-panel');
			const theme = (v) => {
				const probe = document.createElement('i');
				probe.style.color = 'var(' + v + ')';
				panel.appendChild(probe);
				const c = getComputedStyle(probe).color;
				probe.remove();
				return c;
			};
			const shapes = [...document.querySelectorAll('#insp .cineCurve > *')].map((n) => {
				const s = getComputedStyle(n);
				return { cls: n.getAttribute('class'), fill: s.fill, stroke: s.stroke, d: n.getAttribute('d') };
			});
			return { shapes, accent: theme('--accent'), accent2: theme('--accent2') };
		})()`);
	const by = (shapes, cls) => shapes.filter((s) => s.cls === cls);
	const BLACK = 'rgb(0, 0, 0)';

	const cubic = await read();
	const path = by(cubic.shapes, 'cineCurvePath')[0];
	check('cubic: the curve is drawn', !!path);
	check('cubic: the curve is a stroke, not a fill', path?.fill === 'none', path?.fill);
	check('cubic: the curve strokes in --accent2', path?.stroke === cubic.accent2, path?.stroke);
	const box = by(cubic.shapes, 'cineCurveBox')[0];
	check('cubic: the unit box is not filled', box?.fill === 'none', box?.fill);
	const arms = by(cubic.shapes, 'cineCurveArm');
	check(
		'cubic: both handle arms are visible lines',
		arms.length === 2 && arms.every((a) => a.stroke !== 'none' && a.stroke !== BLACK),
		JSON.stringify(arms.map((a) => a.stroke)),
	);
	const handles = by(cubic.shapes, 'cineCurveHandle');
	check(
		'cubic: both handles fill in --accent',
		handles.length === 2 && handles.every((h) => h.fill === cubic.accent),
		JSON.stringify(handles.map((h) => h.fill)),
	);
	check(
		'cubic: no shape falls back to a black fill',
		cubic.shapes.every((s) => s.fill !== BLACK),
		JSON.stringify(cubic.shapes.filter((s) => s.fill === BLACK).map((s) => s.cls)),
	);

	for (const [kind, shape] of [
		['linear', /^M20\.0,160\.0 L140\.0,40\.0$/],
		['hold', /^M20\.0,160\.0 H140\.0 V40\.0$/],
	]) {
		await evaluate(`(() => {
			document.querySelector('#insp [data-ekind-default="${kind}"]').click();
			return true;
		})()`);
		const r = await read();
		const p = by(r.shapes, 'cineCurvePath')[0];
		check(`${kind}: its shape is drawn`, shape.test(p?.d ?? ''), p?.d);
		check(
			`${kind}: a stroke in --accent2, no fill`,
			p?.fill === 'none' && p?.stroke === r.accent2,
			`${p?.fill} / ${p?.stroke}`,
		);
		check(`${kind}: no handles`, by(r.shapes, 'cineCurveHandle').length === 0);
	}
} finally {
	await browser.close();
	server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
