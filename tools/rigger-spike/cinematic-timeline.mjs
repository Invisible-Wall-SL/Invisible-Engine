// End-to-end browser gate for the 🎬 Cinematic sequencer in /rigger — the shared Timeline panel that
// `static/shared/timeline.mjs` (source: `apps/launcher-api/src/lib/timeline/`) renders.
//
//   node tools/rigger-spike/cinematic-timeline.mjs
//   node tools/rigger-spike/cinematic-timeline.mjs --update   # re-record the golden (an INTENDED change)
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, and works the sequencer the way an author does — through the page's own DOM
// handlers: cast two rigs, drag / trim / retime strips, the strip inspector, layers, ＋ strip,
// Ctrl+D / Delete, bone masks, property / camera / visibility keys and their inspector, cues and
// the cue picker, the set + its depth row, the frame picker, ruler scrub (also scrolled), zoom,
// undo / redo by button and by key (with the 600 ms coalescing on a virtual clock), Tweak Mode
// (double-click, Esc), ＋ New clip, inline posing (✎), save, rename, new, open, remove.
//
// After every action it records the cinematic document, the undo history, the playhead and the
// rendered HTML of the timeline, the left panel and the right-hand inspector, and compares them
// with `cinematic-timeline.golden.json`.
//
// WHY A GOLDEN: the sequencer was extracted out of `static/rigger/cinematic.js` into a shared module
// (Rive plan Phase 2, docs/design/rive-style-editor.md §3.4) with the hard requirement "zero
// behaviour change in /rigger". The golden was recorded against the PRE-extraction code, so a pass
// here means the extracted module produces the same document, the same history and the same DOM,
// action for action. Re-record it only for a change you MEAN to make, and say so in the PR.
//
// Determinism: `Math.random` (strip / track ids) is re-seeded before every action, `Date.now` is a
// virtual clock the gate advances (ids and undo coalescing are identical run to run), and the
// timeline's width is pinned (its pixel positions do not depend on the window, fonts or scrollbars
// of whichever Chrome runs it — CI uses the runner's own).
//
// What it does NOT cover: R2, auth, rendering (the stage canvas is not compared — the WebGL half is
// `static/rigger/cinematic-harness.html`), a real mouse (events are dispatched to the same handlers).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));
const GOLDEN = fileURLToPath(new URL('cinematic-timeline.golden.json', import.meta.url));
const UPDATE = process.argv.includes('--update');

// Seeded before ANY page script runs, so every id the tool mints is the same on every run.
const SEED = `<script>
(() => {
	let s = 0x2f6b9a1;
	Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
	window.__seed = (n) => { s = (0x2f6b9a1 + n * 7919) >>> 0; };
	window.__clock = 1700000000000;
	Date.now = () => window.__clock;
	localStorage.clear();
})();
</script>
<style>
	/* Every px on the timeline derives from its width, so pin it: no window size, font or platform
	   scrollbar may move a strip in the golden. */
	#timeline { width: 1200px !important; min-width: 1200px !important; max-width: 1200px !important;
		scrollbar-width: none !important; }
</style>`;
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8')
	.replace(/\r\n/g, '\n')
	.replace('<head>', '<head>' + SEED);

// ------------------------------------------------------------------ the fake launcher ----

const anticipation = JSON.parse(
	readFileSync(join(RIG_ASSETS, 'anticipation', 'anticipation.json'), 'utf8'),
);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const RIGS = { A: 'A.json', B: 'B.json' };
const ENTRIES = Object.entries(RIGS).map(([name, file], id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: file,
	atlas_file: 'anticipation.atlas',
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
const rigDoc = (name) => ({ ...anticipation, skeleton: { ...anticipation.skeleton, hash: name } });

const stored = new Map(); // cinematic id -> { doc, etag }
let saveCount = 0;
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.json': 'application/json',
	'.atlas': 'text/plain',
	'.svg': 'image/svg+xml',
};
const readBody = (req) =>
	new Promise((r) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => r(s));
	});

const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons')
			return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			const rig = Object.entries(RIGS).find(([n]) => b64(n) === url.searchParams.get('dir'));
			if (rig && name === rig[1]) return jsonOut(rigDoc(rig[0]));
			if (rig && /^anticipation\.(atlas|png|webp)$/.test(name))
				return send(200, MIME[extname(name)], readFileSync(join(RIG_ASSETS, 'anticipation', name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/cinematics/list')
			return jsonOut({
				ok: true,
				cinematics: [...stored.values()].map(({ doc }) => ({
					id: doc.id,
					name: doc.name,
					actors: doc.stage.cast.length,
				})),
			});
		if (p === '/api/cinematics/get') {
			const hit = stored.get(url.searchParams.get('id'));
			return hit
				? jsonOut({ ok: true, doc: hit.doc, etag: hit.etag })
				: jsonOut({ ok: false }, 404);
		}
		if (p === '/api/cinematics/save') {
			const body = JSON.parse(await readBody(req));
			const etag = `etag-${++saveCount}`;
			stored.set(body.doc.id, { doc: body.doc, etag });
			return jsonOut({ ok: true, etag, updatedAt: '2026-10-13T00:00:00.000Z' });
		}
		if (p === '/api/cinematics/delete') {
			stored.delete(JSON.parse(await readBody(req)).id);
			return jsonOut({ ok: true });
		}
		if (p === '/api/editor/scenes')
			return jsonOut({
				scenes: [{ id: 'intro', name: 'Intro', nodes: 3 }],
				mainSizesMap: { desktop: { width: 1920, height: 1080 } },
				layoutProfileSource: 'project',
			});
		if (p === '/api/editor/effects') return jsonOut({ effects: [{ id: 'burst', name: 'Burst' }] });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: null });
		if (p.startsWith('/api/'))
			return jsonOut({
				effects: [],
				atlases: [],
				rigs: [],
				animations: [],
				clips: [],
				backups: [],
			});
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await launchChrome({
	name: 'cinematic-timeline',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
});
const { evaluate, waitFor, pageLog } = browser;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;

// ------------------------------------------------------------------ page-side helpers ----

const install = () =>
	evaluate(`(() => {
		window.__asked = [];
		window.__prompts = [];
		window.confirm = (m) => { window.__asked.push(String(m)); return true; };
		window.alert = () => {};
		window.prompt = (m, d) => { window.__prompts.push(String(m)); return window.__answer ?? d; };
		const $ = (s) => document.querySelector(s);
		const at = (el, fx = 0.5) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height / 2 }; };
		const ptr = (el, type, x, y, extra) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...extra }));
		window.S = {
			$,
			tick(ms = 1000) { window.__clock += ms; },
			snap() {
				const C = window.RiggerCinematic;
				return {
					doc: localStorage.getItem('rigger.cinematic.v1'),
					hist: C.historyDepth(),
					time: +C.getTime().toFixed(6),
					tweaking: C.isTweaking(),
					posing: C.isPosing(),
					dirty: C.isDirty(),
					tl: $('#timeline').innerHTML,
					panel: $('#cinePanel').innerHTML,
					props: $('#cineProps').innerHTML,
					propSub: $('#propSub').textContent,
				};
			},
			click(el) { el.click(); },
			set(el, v) {
				if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
			},
			/** Press on an element at fraction fx of its width, move by dx pixels, release. */
			drag(el, fx, dx, extra) {
				const p = at(el, fx);
				ptr(el, 'pointerdown', p.x, p.y, extra);
				ptr(el, 'pointermove', p.x + dx / 2, p.y, extra);
				ptr(el, 'pointermove', p.x + dx, p.y, extra);
				ptr(el, 'pointerup', p.x + dx, p.y, extra);
			},
			dbl(el) { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); },
			key(key, mods = {}) {
				const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift });
				(document.activeElement || document.body).dispatchEvent(e);
				return e.defaultPrevented;
			},
			blur() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); },
			strip(i) { return document.querySelectorAll('#timeline .cineStrip')[i]; },
			row(sel) { return document.querySelector('#timeline ' + sel); },
			actorRow(i) { return document.querySelectorAll('#cinePanel .cineActor')[i]; },
		};
		return true;
	})()`);

// ------------------------------------------------------------------ the script ----

const results = [];
let failures = 0;
const golden = !UPDATE && existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : null;
const digest = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Let async work (rig loads, fetches, re-renders) land, then the DOM stop changing. */
async function settle() {
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	let last = '';
	let same = 0;
	for (let i = 0; i < 100 && same < 3; i++) {
		await wait(60);
		const cur = await evaluate('JSON.stringify(S.snap())');
		same = cur === last ? same + 1 : 0;
		last = cur;
	}
}

/** Run one author action; `until` is a page condition the action is only finished once true. */
async function act(name, js, until) {
	await evaluate(`(async () => { S.tick(); __seed(${results.length}); ${js}; return true; })()`);
	if (until) await waitFor(until, 30000);
	await settle();
	const snap = await evaluate('S.snap()');
	// The history and the playhead are compared in full; the document and the three DOM panels by
	// digest (the golden would otherwise be megabytes) — on a mismatch the actual output is written to
	// the temp dir, and running this file with --update on the base branch gives the expected one.
	const rec = {
		name,
		doc: digest(snap.doc),
		hist: snap.hist,
		time: snap.time,
		state: {
			tweaking: snap.tweaking,
			posing: snap.posing,
			dirty: snap.dirty,
			propSub: snap.propSub,
		},
		// While tweaking, `#timeline` holds the rig animator's dopesheet, whose playhead is placed by
		// whichever frame lands first after the clip opens — a race in view.html, not the Timeline
		// (it varies on the pre-extraction code too). Its position is left out; the rest is compared.
		tl: digest(snap.tl.replace(/(id="tlPlayhead" style="left: )[^p]*px/, '$1·px')),
		panel: digest(snap.panel),
		props: digest(snap.props),
	};
	results.push({ rec, raw: snap });
	if (!golden) return console.log(`  · ${name}`);
	const want = golden.steps[results.length - 1];
	const diffs = !want
		? ['(no golden step)']
		: Object.keys(rec).filter((k) => JSON.stringify(rec[k]) !== JSON.stringify(want[k]));
	if (diffs.length) {
		failures++;
		console.log(`  ✗ ${results.length}. ${name} — differs in: ${diffs.join(', ')}`);
	} else console.log(`  ✓ ${results.length}. ${name}`);
}

const STRIP = (i) => `S.strip(${i})`;

try {
	await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2', 30000);
	await install();
	await evaluate('playing = false; true');
	await evaluate(`S.click(document.querySelector('#modeSeg button[data-mode="cinematic"]')); true`);
	await waitFor('!!window.RiggerCinematic && !!document.querySelector("#cineAdd")', 30000);
	await settle();
	console.log('\ntimeline actions');

	await act('enter cinematic mode', '');
	await act(
		'cast A',
		`S.set(S.$('#cineAddSel'), 'A'); S.click(S.$('#cineAdd'))`,
		'document.querySelectorAll("#cinePanel .cineActor").length === 1',
	);
	await act(
		'cast B',
		`S.set(S.$('#cineAddSel'), 'B'); S.click(S.$('#cineAdd'))`,
		'document.querySelectorAll("#cinePanel .cineActor").length === 2',
	);
	await act('length 8 s', `S.set(S.$('#cineDur'), 8)`);
	await act('set the time field to 1.5 s', `S.set(S.$('#cineTime'), 1.5)`);
	await act('select A’s strip', `S.drag(${STRIP(0)}, 0.5, 0)`);
	await act('drag A’s strip right', `S.drag(${STRIP(0)}, 0.5, 60)`);
	await act('trim its right edge', `S.drag(${STRIP(0)}, 0.995, -80)`);
	await act(
		'trim its left edge (Alt = off the grid)',
		`S.drag(${STRIP(0)}, 0.005, 37, { altKey: true })`,
	);
	await act('inspector: speed 1.5', `S.set(S.$('[data-sact="speed"]'), 1.5)`);
	await act('inspector: loop N times', `S.set(S.$('[data-sact="loop.mode"]'), 'count')`);
	await act('inspector: 3 times', `S.set(S.$('[data-sact="loop.n"]'), 3)`);
	await act('inspector: additive', `S.set(S.$('[data-sact="blend"]'), 'add')`);
	await act('inspector: blend in 0.25', `S.set(S.$('[data-sact="blendIn"]'), 0.25)`);
	await act('inspector: replace again', `S.set(S.$('[data-sact="blend"]'), 'replace')`);
	await act(
		'inspector: second clip',
		`const s = S.$('[data-sact="clip"]'); S.set(s, s.options[1].value)`,
	);
	await act('add a layer to A (⧉)', `S.click(S.row('.cineTrack [data-tact="addLayer"]'))`);
	await act(
		'＋ strip on the new layer',
		`S.click(document.querySelectorAll('#timeline [data-tact="addStrip"]')[1])`,
	);
	await act('Ctrl+D duplicates it', `S.blur(); S.key('d', { ctrl: true })`);
	await act('Delete removes the copy', `S.blur(); S.key('Delete')`);
	await act('🗑 the layer', `S.click(S.row('[data-tact="delLayer"]'))`);
	await act('select A’s strip again', `S.drag(${STRIP(0)}, 0.5, 0)`);
	await act('mask: add a bone', `const s = S.$('#cineMaskAdd'); S.set(s, s.options[3].value)`);
	await act('mask: add another', `const s = S.$('#cineMaskAdd'); S.set(s, s.options[6].value)`);
	await act('mask: children off', `S.set(S.$('#cineMaskKids'), false)`);
	await act('mask: remove a chip', `S.click(S.$('[data-maskdel]'))`);
	await act('mask: clear', `S.click(S.$('#cineMaskClear'))`);
	await act('time 0.5', `RiggerCinematic.setTime(0.5)`);
	await act('◆ x on A', `S.click(S.actorRow(0).querySelector('[data-key="x"]'))`);
	await act('time 2', `RiggerCinematic.setTime(2)`);
	await act('typing x keys it', `S.set(S.actorRow(0).querySelector('[data-act="x"]'), 120)`);
	await act('◆ alpha on B', `S.click(S.actorRow(1).querySelector('[data-key="alpha"]'))`);
	await act('select an x key', `S.drag(S.row('.cineChanRow .cineKey'), 0.5, 0)`);
	await act('key inspector: ease', `S.set(S.$('[data-kact="ease"]'), 'ease')`);
	await act('key inspector: value', `S.set(S.$('[data-kact="value"]'), -40)`);
	await act('key inspector: time', `S.set(S.$('[data-kact="time"]'), 0.75)`);
	await act('drag the key', `S.drag(S.row('.cineChanRow .cineKey'), 0.5, 45)`);
	await act('Delete the selected key', `S.blur(); S.key('Delete')`);
	await act('◆ visibility on A', `S.click(S.actorRow(0).querySelector('[data-viskey]'))`);
	await act('time 3', `RiggerCinematic.setTime(3)`);
	await act('hide A (keys it)', `S.click(S.actorRow(0).querySelector('[data-act="vis"]'))`);
	await act('drag a visibility key', `S.drag(S.row('.cineVisRow .cineVisKey'), 0.5, 30)`);
	await act('hide B (static)', `S.click(S.actorRow(1).querySelector('[data-act="vis"]'))`);
	await act(
		'double-click deletes a visibility key',
		`S.dbl(document.querySelectorAll('#timeline .cineVisRow .cineVisKey')[1])`,
	);
	await act('◆ camera x', `S.click(S.$('[data-camkey="x"]'))`);
	await act('◆ camera zoom', `S.click(S.$('[data-camkey="zoom"]'))`);
	await act('🎥 live off', `S.click(S.$('#cineCamLive'))`);
	await act('🎥 live on', `S.click(S.$('#cineCamLive'))`);
	await act('time 4', `RiggerCinematic.setTime(4)`);
	await act('＋ cue', `S.click(S.$('#cineAddCue'))`);
	await act('pick fx:burst', `S.set(S.$('#cineCuePick'), 'fx:burst')`);
	await act('pick a KIND seeds the field', `S.set(S.$('#cineCuePick'), 'sfx:')`);
	await act('type a sound cue', `S.set(S.$('[data-cueact="cue"]'), 'sfx:boom')`);
	await act('cue time 4.5', `S.set(S.$('[data-cueact="time"]'), 4.5)`);
	await act('＋ a second cue at the playhead', `S.click(S.$('#cineAddCue'))`);
	await act('pick fx:burst on it', `S.set(S.$('#cineCuePick'), 'fx:burst')`);
	await act('drag the cue', `S.drag(S.row('.cineCueRow .cineCue'), 0.5, -25)`);
	await act('fx row ▼', `S.click(S.row('[data-setz="1"]'))`);
	await act('fx row ▲', `S.click(S.row('[data-setz="-1"]'))`);
	await act('select the cue', `S.drag(S.row('.cineCueRow .cineCue'), 0.5, 0)`);
	await act('🗑 the cue', `S.click(S.$('#cineDelCue'))`);
	await act('bind the set', `S.set(S.$('#cineScene'), 'intro')`);
	await act('frame: desktop', `S.set(S.$('#cineRatio'), 'desktop')`);
	await act('A ▼ (in front)', `S.click(S.actorRow(0).querySelector('[data-act="down"]'))`);
	await act('B y = 30', `S.set(S.actorRow(1).querySelector('[data-act="y"]'), 30)`);
	await act('B flip', `S.set(S.actorRow(1).querySelector('[data-act="flipX"]'), true)`);
	await act('B clip: none', `S.set(S.actorRow(1).querySelector('[data-act="clip"]'), '')`);
	await act(
		'scrub the ruler',
		`const r = S.row('.cineRuler .cineLane'); const b = r.getBoundingClientRect(); r.parentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: b.left + 200, clientY: b.top + 5, pointerId: 1 })); r.parentElement.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + 260, clientY: b.top + 5, pointerId: 1 })); r.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: b.left + 260, clientY: b.top + 5, pointerId: 1 }))`,
	);
	await act('zoom in', `RiggerCinematic.zoom(1.15)`);
	// The playhead scrolls with the lanes: its `left` is a content coordinate, never minus scrollLeft.
	await act(
		'scrub the ruler scrolled right',
		`window.__t0 = RiggerCinematic.getTime(); const tl = S.$('#timeline'); tl.scrollLeft = 120; const r = S.row('.cineRuler .cineLane'); const b = r.getBoundingClientRect(); r.parentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: b.left + 700, clientY: b.top + 5, pointerId: 1 })); r.parentElement.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + 760, clientY: b.top + 5, pointerId: 1 })); r.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: b.left + 760, clientY: b.top + 5, pointerId: 1 }))`,
	);
	// Undo the detour so every later step runs exactly as before it was added.
	await act(
		'scroll back, playhead back',
		`RiggerCinematic.setTime(window.__t0); S.$('#timeline').scrollLeft = 0; RiggerCinematic.renderTimeline()`,
	);
	await act('zoom out', `RiggerCinematic.zoom(1 / 1.15)`);

	// Coalescing: two edits to one field inside 600 ms are ONE step; past it they are two.
	await act('B scale = 1.5', `S.set(S.actorRow(0).querySelector('[data-act="scale"]'), 1.5)`);
	await act(
		'B scale = 2 within 600 ms (coalesces)',
		`window.__clock -= 700; S.set(S.actorRow(0).querySelector('[data-act="scale"]'), 2)`,
	);
	await act(
		'B scale = 2.5 later (new step)',
		`S.set(S.actorRow(0).querySelector('[data-act="scale"]'), 2.5)`,
	);
	await act('Ctrl+Z', `S.blur(); S.key('z', { ctrl: true })`);
	await act('Ctrl+Z again', `S.blur(); S.key('z', { ctrl: true })`);
	await act('↷ Redo button', `S.click(S.$('#cineRedo'))`);
	await act('Ctrl+Y', `S.blur(); S.key('y', { ctrl: true })`);
	await act(
		'Ctrl+Shift+Z with nothing to redo',
		`S.blur(); S.key('z', { ctrl: true, shift: true })`,
	);
	await act(
		'↶ Undo button ×3',
		`S.click(S.$('#cineUndo')); S.click(S.$('#cineUndo')); S.click(S.$('#cineUndo'))`,
	);
	await act(
		'Ctrl+Z is the field’s own while one has focus',
		`S.actorRow(0).querySelector('[data-act="scale"]').focus(); S.key('z', { ctrl: true })`,
	);
	await act(
		'Ctrl+Shift+Z ×3',
		`S.blur(); S.key('z', { ctrl: true, shift: true }); S.key('z', { ctrl: true, shift: true }); S.key('z', { ctrl: true, shift: true })`,
	);

	// Rig extensions: Tweak Mode, ＋ New clip, inline posing.
	await act('select a strip', `S.drag(${STRIP(0)}, 0.5, 0)`);
	await act('double-click → Tweak Mode', `S.dbl(${STRIP(0)})`, 'RiggerCinematic.isTweaking()');
	await act('Esc leaves Tweak Mode', `S.blur(); S.key('Escape')`, '!RiggerCinematic.isTweaking()');
	await act('select a strip again', `S.drag(${STRIP(0)}, 0.5, 0)`);
	await act(
		'✎ Tweak clip button',
		`S.click(S.$('#cineTweakStrip'))`,
		'RiggerCinematic.isTweaking()',
	);
	await act('Ctrl+Z is the animator’s while tweaking', `S.blur(); S.key('z', { ctrl: true })`);
	await act('done', `RiggerCinematic.exitTweak()`, '!RiggerCinematic.isTweaking()');
	await act('select a strip again', `S.drag(${STRIP(0)}, 0.5, 0)`);
	await act(
		'＋ New clip',
		`window.__answer = 'wave'; S.click(S.$('#cineNewClip'))`,
		'RiggerCinematic.isTweaking()',
	);
	await act('done again', `RiggerCinematic.exitTweak()`, '!RiggerCinematic.isTweaking()');
	await act(
		'✎ pose B inline',
		`S.click(S.actorRow(0).querySelector('[data-act="pose"]'))`,
		'RiggerCinematic.isPosing()',
	);
	await act('first key makes the override', `RiggerCinematic.ensureOverrideClip()`);
	await act('✎ again stops posing', `S.click(S.actorRow(0).querySelector('[data-act="pose"]'))`);

	// Document lifecycle.
	await act('rename', `S.set(S.$('#cineName'), 'Intro shot')`);
	await act('Ctrl+S saves', `S.blur(); S.key('s', { ctrl: true })`);
	await act('rename after save keeps the id', `S.set(S.$('#cineName'), 'Intro shot 2')`);
	await act('💾 Save', `S.click(S.$('#cineSave'))`);
	await act('＋ New', `window.__answer = 'Second'; S.click(S.$('#cineNew'))`);
	await act(
		'cast A into it',
		`S.set(S.$('#cineAddSel'), 'A'); S.click(S.$('#cineAdd'))`,
		'document.querySelectorAll("#cinePanel .cineActor").length === 1',
	);
	await act(
		'open the first one',
		`S.set(S.$('#cineOpenSel'), 'intro_shot'); S.click(S.$('#cineOpen'))`,
		'document.querySelectorAll("#cinePanel .cineActor").length === 2',
	);
	await act('🗑 an actor', `S.click(S.actorRow(1).querySelector('[data-act="del"]'))`);
	await act('🗑 the cinematic', `S.click(S.$('#cineDelete'))`);
	await act(
		'leave and come back',
		`S.click(document.querySelector('#modeSeg button[data-mode="preview"]')); S.click(document.querySelector('#modeSeg button[data-mode="cinematic"]'))`,
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	if (thrown.length) {
		failures++;
		console.log(`  ✗ the page threw: ${thrown.join(' | ')}`);
	}
} catch (e) {
	failures++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	server.close();
	await browser.close();
}

if (UPDATE) {
	writeFileSync(GOLDEN, JSON.stringify({ steps: results.map((r) => r.rec) }, null, '\t') + '\n');
	console.log(`\nwrote ${GOLDEN} (${results.length} steps)`);
	process.exit(failures ? 1 : 0);
}
if (!golden) {
	console.log('\n✗ no golden — run with --update to record one');
	process.exit(1);
}
if (results.length !== golden.steps.length) {
	failures++;
	console.log(`  ✗ ran ${results.length} steps, the golden has ${golden.steps.length}`);
}
if (failures) {
	const out = join(tmpdir(), 'cinematic-timeline.actual.json');
	writeFileSync(
		out,
		JSON.stringify(
			results.map((r) => ({ ...r.rec, raw: r.raw })),
			null,
			'\t',
		),
	);
	console.log(`\nactual output (with the raw HTML) written to ${out}`);
	if (pageLog.length) console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
}
console.log(
	`\n${failures === 0 ? '✅ PASS' : '✗ FAIL'} — ${results.length - failures}/${results.length} actions match the golden`,
);
process.exit(failures === 0 ? 0 : 1);
