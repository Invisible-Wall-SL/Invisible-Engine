// Browser gate: Timeline visibility and text markers answer a REAL mouse and keyboard.
//
//   node tools/rigger-spike/timeline-markers.mjs
//
// THE BUGS (reported in /editor, 2026-10-22, while removing a stray Hide key from a node's
// `↳ visible` row):
//   - a visible marker could not be selected, so Delete (which removes a selected key diamond)
//     had nothing to remove;
//   - a double-click deleted nothing: the pointerup ending the first click re-rendered the
//     Timeline, so the second click landed on a NEW marker and the browser sent the dblclick to
//     neither (a visible or a text marker alike);
//   - a drag moved a visible marker one frame at most: each move looked its key up by the time the
//     drag began, so the key was lost once it left that frame.
// Every other Timeline gate dispatches events straight to the handlers, which hides the second
// bug entirely, so the input here is Chrome's own (`Input.dispatchMouseEvent` with clickCount 1
// then 2, as a user's double-click is, and `Input.dispatchKeyEvent`).
//
// The page mounts the shared Timeline (`static/shared/timeline.mjs`, the copy both `/editor` and
// `/rigger` load) with minimal CSS: only where the markers sit matters here.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { launchChrome } from './chrome.mjs';

const SHARED = fileURLToPath(new URL('../../apps/launcher-api/static/shared/', import.meta.url));

const FPS = 30;
const DOC = {
	schemaVersion: 1,
	id: 'basegame_intro',
	name: 'Intro',
	duration: 2,
	fps: FPS,
	host: { kind: 'screen', sceneId: 'basegame' },
	stage: {
		sceneId: null,
		cast: [
			{ actorId: 'a_frame', kind: 'node', target: 'Reel.png', place: {}, z: 0 },
			{ actorId: 'a_grid', kind: 'node', target: 'Reel grid', place: {}, z: 1 },
			{ actorId: 'a_amount', kind: 'node', target: 'Amount', place: {}, z: 2 },
		],
	},
	tracks: [
		{
			id: 'vis',
			actorId: 'a_frame',
			kind: 'visibility',
			keys: [
				{ time: 2 / FPS, visible: false },
				{ time: 1, visible: true },
				{ time: 1.5, visible: false },
			],
		},
		{
			id: 'prop',
			actorId: 'a_grid',
			kind: 'property',
			channels: {
				y: [
					{ time: 0, value: 0, ease: 'linear' },
					{ time: 1, value: 100, ease: 'linear' },
				],
			},
		},
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
#lanes { position: relative; width: 1000px; height: 500px; overflow: auto; }
.cineRuler, .cineTrack { display: flex; height: 24px; position: relative; }
.cineGutter { flex: 0 0 132px; width: 132px; overflow: hidden; }
.cineLane { position: relative; height: 24px; }
.cineVisKey, .cineTextKey, .cineKey, .cineCue {
	position: absolute; top: 4px; min-width: 14px; height: 14px; margin-left: -7px; background: #6cf;
}
.cineTick { position: absolute; top: 0; }
#cinePlayhead { position: absolute; top: 0; width: 1px; background: red; pointer-events: none; }
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
	name: 'timeline-markers',
	url,
	args: ['--window-size=1200,700'],
});
const { evaluate, waitFor, send } = browser;
try {
	await waitFor('window.ready === true');

	/** The centre of the `index`-th element matching `selector`, in viewport pixels. */
	const centre = (selector, index = 0) =>
		evaluate(`(() => {
			const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.getBoundingClientRect();
			return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
		})()`);
	const mouse = (type, { x, y }, extra = {}) =>
		send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
	/** One click; Chrome reads `clickCount` 2 as the second half of a double-click. */
	const click = async (at, clickCount = 1) => {
		if (!at) return void check('the marker to click is on the page', false);
		await mouse('mouseMoved', at, { button: 'none' });
		await mouse('mousePressed', at, { clickCount, buttons: 1 });
		await mouse('mouseReleased', at, { clickCount, buttons: 0 });
	};
	const dblclick = async (at) => {
		await click(at, 1);
		await click(at, 2);
	};
	const pressDelete = async () => {
		const key = { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 };
		await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
	};
	const track = (id) =>
		evaluate(`(() => {
			const t = window.tl.doc().tracks.find((x) => x.id === ${JSON.stringify(id)});
			return t ? JSON.stringify(t.keys ?? t.channels) : 'none';
		})()`);
	const visTimes = async () => {
		const keys = await track('vis');
		return keys === 'none' ? [] : JSON.parse(keys).map((k) => Math.round(k.time * FPS));
	};
	const selectedMarkers = () => evaluate("document.querySelectorAll('.cineVisKey.sel').length");

	// A single click on a text key seeks the playhead to it and keeps the key.
	await click(await centre('.cineTextKey'));
	check(
		'a click on a text key seeks the playhead to it',
		(await evaluate('window.tl.time()')) === 1,
	);
	check('…and keeps the key', (await track('txt')) === JSON.stringify([{ time: 1, value: 5 }]));

	// A drag carries a visible marker the whole way, not one frame: pressed, moved 60 px, released.
	const pps = await evaluate(
		"parseFloat(document.querySelectorAll('.cineVisKey')[1].style.left) / 1",
	);
	const start = await centre('.cineVisKey', 0);
	await mouse('mouseMoved', start, { button: 'none' });
	await mouse('mousePressed', start, { clickCount: 1, buttons: 1 });
	for (let i = 1; i <= 6; i++)
		await mouse('mouseMoved', { x: start.x + i * 10, y: start.y }, { buttons: 1 });
	await mouse('mouseReleased', { x: start.x + 60, y: start.y }, { clickCount: 1, buttons: 0 });
	const want = Math.round((2 / FPS + 60 / pps) * FPS);
	const dragged = await visTimes();
	check('a drag carries the visible marker the whole way', dragged[0] === want, `frames ${dragged.join()} (want ${want} first)`); // prettier-ignore
	check('…and leaves it selected', (await selectedMarkers()) === 1);

	// Clicking elsewhere in the Timeline drops the marker's selection: Delete then removes nothing.
	await click(await centre('.cineTextKey'));
	check('a click elsewhere deselects the visible marker', (await selectedMarkers()) === 0);
	await pressDelete();
	check('…so Delete removes no visible key', (await visTimes()).length === 3, (await visTimes()).join()); // prettier-ignore

	// The reported ask: click a visible marker, press Delete, as with a key diamond.
	await click(await centre('.cineVisKey', 0));
	check('a click selects a visible marker (outlined)', (await selectedMarkers()) === 1);
	await pressDelete();
	check('Delete removes the selected visible key', JSON.stringify(await visTimes()) === JSON.stringify([30, 45]), (await visTimes()).join()); // prettier-ignore

	// A diamond, then a visible marker: Delete removes the marker only.
	await click(await centre('.cineKey', 1));
	await click(await centre('.cineVisKey', 0));
	await pressDelete();
	check('after a diamond, a selected visible marker is what Delete removes', JSON.stringify(await visTimes()) === JSON.stringify([45]), (await visTimes()).join()); // prettier-ignore
	check('…and the diamond is untouched', JSON.parse(await track('prop')).y.length === 2);

	// A selected diamond still deletes as before.
	await click(await centre('.cineKey', 1));
	await pressDelete();
	check('Delete still removes a selected key diamond', JSON.parse(await track('prop')).y.length === 1, await track('prop')); // prettier-ignore

	// A double-click deletes a visible key (emptying its row) and a text key.
	await dblclick(await centre('.cineVisKey'));
	check('a double-click deletes a visible key (and its emptied track)', (await track('vis')) === 'none', await track('vis')); // prettier-ignore
	await dblclick(await centre('.cineTextKey'));
	check('a double-click deletes a text key (and its emptied track)', (await track('txt')) === 'none', await track('txt')); // prettier-ignore
} finally {
	await browser.close();
	server.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
