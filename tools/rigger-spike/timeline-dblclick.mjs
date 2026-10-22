// Browser gate: a REAL mouse double-click deletes a Timeline visibility or text key.
//
//   node tools/rigger-spike/timeline-dblclick.mjs
//
// THE BUG (reported in /editor, 2026-10-22): double-clicking a marker on a `↳ visible` row did
// nothing, so a stray Hide key could not be removed. The pointerup that ends the first click
// re-rendered the timeline, so the second click landed on a NEW marker and the browser sent the
// dblclick to neither. Every other Timeline gate dispatches events straight to the handlers, which
// hides exactly this, so here the input is Chrome's own (`Input.dispatchMouseEvent`, clickCount 1
// then 2, as a user's double-click is).
//
// Also pinned: a single click on a text key still seeks the playhead to it, and a drag still
// retimes a visibility key. The page mounts the shared Timeline (`static/shared/timeline.mjs`, the
// copy both `/editor` and `/rigger` load) with minimal CSS: only where markers sit matters here.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { launchChrome } from './chrome.mjs';

const SHARED = fileURLToPath(new URL('../../apps/launcher-api/static/shared/', import.meta.url));

const DOC = {
	schemaVersion: 1,
	id: 'basegame_intro',
	name: 'Intro',
	duration: 2,
	fps: 30,
	host: { kind: 'screen', sceneId: 'basegame' },
	stage: {
		sceneId: null,
		cast: [
			{ actorId: 'a_frame', kind: 'node', target: 'Reel.png', place: {}, z: 0 },
			{ actorId: 'a_amount', kind: 'node', target: 'Amount', place: {}, z: 1 },
		],
	},
	tracks: [
		{ id: 'vis', actorId: 'a_frame', kind: 'visibility', keys: [{ time: 2 / 30, visible: false }] },
		{
			id: 'txt',
			actorId: 'a_amount',
			kind: 'text',
			mode: 'countUp',
			keys: [{ time: 1, value: 5 }],
		},
	],
	markers: [],
};

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; font: 12px sans-serif; }
#lanes { position: relative; width: 1000px; height: 400px; overflow: auto; }
.cineRow { display: flex; align-items: center; height: 24px; position: relative; }
.cineGutter { flex: 0 0 132px; width: 132px; overflow: hidden; }
.cineLane { position: relative; height: 24px; }
.cineVisKey, .cineTextKey, .cineKey, .cineCue {
	position: absolute; top: 4px; min-width: 14px; height: 14px; margin-left: -7px; background: #6cf;
}
#cinePlayhead { position: absolute; top: 0; width: 1px; background: red; }
</style></head><body><div id="lanes"></div><script type="module">
import { mount } from './timeline.mjs';
import * as EV from './cinematicEval.mjs';
window.tl = mount(document.getElementById('lanes'), {
	doc: ${JSON.stringify(DOC)},
	ev: EV,
	textRows: true,
	interpolation: true,
	summaryRows: true,
	boxSelect: true,
});
window.tl.setActive(true);
window.tl.historyReset();
window.tl.renderTimeline();
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

const browser = await launchChrome({
	name: 'timeline-dblclick',
	url,
	args: ['--window-size=1200,600'],
});
const { evaluate, waitFor, send } = browser;
try {
	await waitFor('window.ready === true');

	/** The centre of the first element matching `selector`, in viewport pixels. */
	const centre = (selector) =>
		evaluate(`(() => {
			const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
			return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
		})()`);
	const mouse = (type, { x, y }, extra = {}) =>
		send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
	/** One click: Chrome counts `clickCount` 2 as the second half of a double-click. */
	const click = async (at, clickCount = 1) => {
		await mouse('mousePressed', at, { clickCount, buttons: 1 });
		await mouse('mouseReleased', at, { clickCount, buttons: 0 });
	};
	const dblclick = async (at) => {
		await mouse('mouseMoved', at, { button: 'none' });
		await click(at, 1);
		await click(at, 2);
	};
	const keys = (trackId) =>
		evaluate(
			`JSON.stringify(window.tl.doc().tracks.find((t) => t.id === ${JSON.stringify(trackId)})?.keys ?? null)`,
		);

	// A single click on the text key seeks to it and keeps the key.
	const text = await centre('.cineTextKey');
	await click(text);
	check(
		'a click on a text key seeks the playhead to it',
		(await evaluate('window.tl.time()')) === 1,
	);
	check('…and keeps the key', (await keys('txt')) === JSON.stringify([{ time: 1, value: 5 }]));

	// A drag on the visibility key still retimes it (pressed, moved 60 px, released).
	const vis = await centre('.cineVisKey');
	await mouse('mouseMoved', vis, { button: 'none' });
	await mouse('mousePressed', vis, { clickCount: 1, buttons: 1 });
	for (let i = 1; i <= 6; i++)
		await mouse('mouseMoved', { x: vis.x + i * 10, y: vis.y }, { buttons: 1 });
	await mouse('mouseReleased', { x: vis.x + 60, y: vis.y }, { clickCount: 1, buttons: 0 });
	const moved = JSON.parse(await keys('vis'));
	check('a drag retimes the visibility key', moved?.length === 1 && moved[0].time > 2 / 30, JSON.stringify(moved)); // prettier-ignore

	// The reported bug: a double-click deletes the key, and the emptied row goes with it.
	await dblclick(await centre('.cineVisKey'));
	check('a double-click deletes the visibility key (and its emptied track)', (await keys('vis')) === 'null', await keys('vis')); // prettier-ignore
	await dblclick(await centre('.cineTextKey'));
	check('a double-click deletes the text key (and its emptied track)', (await keys('txt')) === 'null', await keys('txt')); // prettier-ignore
	check('no marker is left on the page', (await evaluate("document.querySelectorAll('.cineVisKey, .cineTextKey').length")) === 0); // prettier-ignore
} finally {
	await browser.close();
	server.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
