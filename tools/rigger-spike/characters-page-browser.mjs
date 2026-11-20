// Browser gate for Invisible Characters' page (character pipeline C6b): the REAL
// `apps/launcher-api/src/routes/(app)/characters/+page.svelte`, and beside it the real `/flipbook`
// and `/config` pages, each mounted in a REAL Chromium on a Salmons config with every endpoint
// stubbed by this script.
//
//   node tools/rigger-spike/characters-page-browser.mjs [--shots <dir>]
//
// The pages are compiled as Vite compiles them (`svelte/compiler`, esbuild) with `$app/*` stood in
// for; the docs, the looks, a rig's facts and Flipbook's character list come from the launcher's
// own pure modules, bundled for Node. The stubs are `/api/lease`, `/api/game-config` (PUT),
// `/api/characters/whole`, `/api/characters/rig`, `/api/editor/regions`, `/api/editor/asset` (a rig
// of `apps/lines/static` and a generated sheet of ten images), `/api/editor/component` and
// `/api/flipbook/characters`. Checks that a person can
//   a. choose Rig for a character, pick the rig and see it in every facing, with its cost;
//   b. choose Still images and fill a character from the names of a sheet of ten images;
//   c. add a character by name (one create of its look), with the look under Advanced;
//   d. save: the PUT is the loaded config and exactly the edits;
//   e. see, in Flipbook's Characters mode, a clips sheet listed and a rig or stills one not;
//   f. read, in Game Config, what a reset, a family switch and Online off say of the sheets.
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, extname } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const LAUNCHER = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));
const fromLauncher = createRequire(join(LAUNCHER, 'package.json'));
const { compile, compileModule } = fromLauncher('svelte/compiler');
const esbuild = await import(ESBUILD);
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ── the build ───────────────────────────────────────────────────────────────────────────────────

const APP_STUBS = {
	'$app/paths': `export const resolve = (path) => path; export const base = ''; export const assets = '';`,
	'$app/navigation': `
		export const replaceState = (url) => history.replaceState({}, '', url);
		export const pushState = (url) => history.pushState({}, '', url);
		export const goto = async (url) => { location.href = String(url); };
		export const beforeNavigate = () => {};
		export const afterNavigate = () => {};
		export const onNavigate = () => {};
		export const invalidate = async () => {};
		export const invalidateAll = async () => {};
		export const preloadData = async () => ({});`,
	'$app/state': `
		export const page = { get url() { return new URL(location.href); }, params: {}, data: {}, state: {}, status: 200, error: null, form: null };
		export const navigating = { from: null, to: null, type: null };
		export const updated = { current: false, check: async () => false };`,
	'$app/environment': `export const browser = true; export const dev = false; export const building = false; export const version = 'spike';`,
	'$app/forms': `export const enhance = () => ({ destroy() {} }); export const applyAction = async () => {}; export const deserialize = (text) => JSON.parse(text);`,
};

const svelte = (generate) => ({
	name: 'svelte',
	setup(build) {
		build.onResolve({ filter: /^\$app\// }, (args) => ({ path: args.path, namespace: 'app-stub' }));
		build.onLoad({ filter: /.*/, namespace: 'app-stub' }, (args) => {
			if (!APP_STUBS[args.path]) throw new Error(`no stand-in for ${args.path}`);
			return { contents: APP_STUBS[args.path], loader: 'js' };
		});
		build.onResolve({ filter: /\?(url|raw|worker)$/ }, (args) => ({ path: args.path, namespace: 'url' }));
		build.onLoad({ filter: /.*/, namespace: 'url' }, () => ({ contents: 'export default "";', loader: 'js' }));
		// A stylesheet a component imports is injected, as Vite injects it.
		build.onLoad({ filter: /\.css$/ }, (args) => ({
			contents: generate === 'client' ? `const s = document.createElement('style'); s.textContent = ${JSON.stringify(readFileSync(args.path, 'utf8'))}; document.head.append(s);` : '',
			loader: 'js',
		}));
		build.onLoad({ filter: /\.svelte$/ }, (args) => ({
			contents: compile(readFileSync(args.path, 'utf8'), { filename: args.path, generate, css: 'injected', dev: false }).js.code,
			loader: 'js',
		}));
		build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, async (args) => {
			const js = await esbuild.transform(readFileSync(args.path, 'utf8'), { loader: 'ts', target: 'esnext' });
			return { contents: compileModule(js.code, { filename: args.path, generate, dev: false }).js.code, loader: 'js' };
		});
	},
});
const LOADERS = { '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.glsl': 'text', '.frag': 'text', '.vert': 'text', '.wgsl': 'text', '.md': 'text', '.wasm': 'dataurl' };
const DEFINE = { 'import.meta.env.DEV': 'false', 'import.meta.env.SSR': 'false', 'import.meta.env': '{}' };
const ALIAS = { $lib: join(LAUNCHER, 'src/lib') };

/** The launcher's own pure modules, for the stubs to answer as the server would. */
const fixturesEntry = `
import { normalizeGameConfigDoc, withCharacterSheets } from 'game-config';
import { salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import { SALMONS_CHARACTER_COMPONENTS } from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { listedLook } from './src/lib/characters/characterAdd.ts';
import { rigFactsOf } from './src/lib/characters/rigCost.ts';
import { projectCharacters } from './src/lib/flipbook/projectCharacters.ts';

export const load = (raw) => withCharacterSheets(normalizeGameConfigDoc(raw), raw);
export const salmons = () => load(salmonsConfig());
export const components = SALMONS_CHARACTER_COMPONENTS;
export const looks = () => SALMONS_CHARACTER_COMPONENTS.map(listedLook);
export const whole = () => SALMONS_CHARACTER_COMPONENTS.map(({ id, name, scope, characterClips }) => ({ id, name, scope, ...(characterClips ? { characterClips } : {}) }));
export { rigFactsOf, projectCharacters };
`;
const fixturesBuilt = await esbuild.build({
	stdin: { contents: fixturesEntry, resolveDir: LAUNCHER, loader: 'ts' },
	bundle: true, format: 'esm', platform: 'node', conditions: ['svelte', 'node', 'production'],
	alias: ALIAS, plugins: [svelte('server')], loader: LOADERS, define: DEFINE, write: false, logLevel: 'error',
	banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(join(LAUNCHER, 'package.json'))});` },
});
const scratch = mkdtempSync(join(tmpdir(), 'characters-page-'));
const fixturesFile = join(scratch, 'fixtures.mjs');
writeFileSync(fixturesFile, fixturesBuilt.outputFiles[0].text);
const F = await import(pathToFileURL(fixturesFile).href);

const entry = `
import { mount, flushSync } from 'svelte';
import DialogHost from './src/lib/DialogHost.svelte';
const PAGES = {
	'/characters': () => import('./src/routes/(app)/characters/+page.svelte'),
	'/flipbook': () => import('./src/routes/(app)/flipbook/+page.svelte'),
	'/config': () => import('./src/routes/(app)/config/+page.svelte'),
};
const q = (sel) => document.querySelector(sel);
const need = (sel) => { const el = q(sel); if (!el) throw new Error('nothing matches ' + sel); return el; };
window.T = {
	has: (sel) => !!q(sel),
	count: (sel) => document.querySelectorAll(sel).length,
	text: (sel) => (q(sel)?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
	texts: (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
	attr: (sel, name) => q(sel)?.getAttribute(name) ?? null,
	attrs: (sel, name) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute(name)),
	value: (sel) => q(sel)?.value ?? null,
	disabled: (sel) => !!q(sel)?.disabled,
	click(sel) { need(sel).click(); flushSync(); return true; },
	type(sel, value) {
		const el = need(sel);
		el.value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		return true;
	},
	check(sel, on) { const el = need(sel); if (el.checked !== on) el.click(); flushSync(); return true; },
	/** Press a button by its text, inside \`within\`. */
	press(within, label) {
		const el = [...document.querySelectorAll(within + ' button')].find((b) => b.textContent.replace(/\\s+/g, ' ').trim() === label);
		if (!el) throw new Error('no button "' + label + '" in ' + within);
		el.click(); flushSync(); return true;
	},
	cancel() { const text = need('dialog[open]').textContent.replace(/\\s+/g, ' ').trim(); need('dialog[open] .actions button.ghost').click(); flushSync(); return text; },
	/** Change the first select that offers \`option\` to it, as a person does. */
	choose(option) {
		const el = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === option));
		if (!el) throw new Error('no select offers ' + option);
		el.value = option; el.dispatchEvent(new Event('change', { bubbles: true })); flushSync(); return true;
	},
	/** Click the checkbox of the label that says \`label\`. */
	tick(label) {
		const el = [...document.querySelectorAll('label')].find((l) => l.textContent.replace(/\\s+/g, ' ').trim() === label)?.querySelector('input[type=checkbox]');
		if (!el) throw new Error('no checkbox "' + label + '"');
		el.click(); flushSync(); return el.checked;
	},
	confirm() { const el = need('dialog[open] .actions button:last-child'); const text = need('dialog[open]').textContent.replace(/\\s+/g, ' ').trim(); el.click(); flushSync(); return text; },
	dialog: () => q('dialog[open]')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
	show(sel) { need(sel).scrollIntoView({ block: 'start' }); return true; },
	box(sel) { const r = need(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, sw: need(sel).scrollWidth, cw: need(sel).clientWidth }; },
	/** The stills preview: per facing the pixels its canvas holds and how its place is turned. */
	stillTiles(within) {
		return [...document.querySelectorAll(within + ' figure[data-facing]')].map((tile) => {
			const canvas = tile.querySelector('canvas');
			const out = { facing: tile.dataset.facing, plays: tile.dataset.plays, kind: tile.className, caption: tile.querySelector('figcaption span').textContent, lit: 0, colour: '', stripe: '', mirrored: false };
			const place = tile.querySelector('.place');
			out.mirrored = !!place && new DOMMatrix(getComputedStyle(place).transform).a < 0;
			if (!canvas || !canvas.width) return out;
			const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
			let r = 0, g = 0, b = 0, n = 0, left = 0, right = 0;
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				if (data[i + 3] < 128) continue;
				out.lit++;
				const white = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
				if (white) { if (x < width / 2) left++; else right++; } else { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
			}
			out.colour = n ? [r, g, b].map((v) => Math.round(v / n / 16)).join(',') : '';
			out.stripe = left > right ? 'left' : right > left ? 'right' : '';
			return out;
		});
	},
	/** The rig preview: each tile's facts and its pixels off the one canvas. */
	rigTiles(within) {
		return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
			const root = need(within);
			const canvas = root.querySelector('.compass canvas');
			const copy = document.createElement('canvas');
			copy.width = canvas.width; copy.height = canvas.height;
			const ctx = copy.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(canvas, 0, 0);
			const origin = canvas.getBoundingClientRect();
			const ratio = canvas.width / origin.width;
			resolve([...root.querySelectorAll('[data-rig-tile]')].map((tile) => {
				const at = tile.querySelector('[data-rig-stage]').getBoundingClientRect();
				const w = Math.round(at.width * ratio), h = Math.round(at.height * ratio);
				const data = ctx.getImageData(Math.round((at.left - origin.left) * ratio), Math.round((at.top - origin.top) * ratio), w, h).data;
				let lit = 0; const alpha = new Uint8Array(w * h);
				for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 40) { alpha[i] = 1; lit++; }
				return { facing: tile.dataset.rigTile, rig: tile.dataset.rig, animation: tile.dataset.animation, flip: tile.dataset.flip, state: tile.dataset.state, w, h, lit, alpha: Array.from(alpha).join('') };
			}));
		})));
	},
};
const data = await (await fetch('/__data' + location.pathname + location.search)).json();
mount(DialogHost, { target: document.body });
const page = await PAGES[location.pathname]();
mount(page.default, { target: document.getElementById('app'), props: { data } });
flushSync();
window.ready = true;
`;
const built = await esbuild.build({
	stdin: { contents: entry, resolveDir: LAUNCHER, loader: 'ts' },
	bundle: true, format: 'esm', platform: 'browser', conditions: ['svelte', 'browser', 'production'],
	alias: ALIAS, plugins: [svelte('client')], loader: LOADERS, define: DEFINE, write: false, logLevel: 'error',
});
const bundle = built.outputFiles[0].text;

// ── the fixtures ────────────────────────────────────────────────────────────────────────────────

const CLIENT = 'c';
const PROJECT = 'p';
const SHEET_KEY = `${CLIENT}/${PROJECT}/sheets/trial/atlas_manifest_trial.json`;
const PAGE_KEY = `${CLIENT}/${PROJECT}/sheets/trial/trial.png`;
const CELL = 96;
const FACINGS = ['n', 'ne', 'e', 'se', 's'];
/** One colour per image, so a facing is told from its neighbour: the bear's are warm, the
 *  fisherman's cool. Each image has a white stripe on its LEFT, so a mirrored one is told too. */
const COLOURS = {
	bear: [[200, 60, 40], [220, 120, 30], [230, 180, 40], [170, 90, 60], [120, 50, 30]],
	fisherman: [[40, 90, 200], [40, 160, 200], [60, 200, 160], [90, 110, 220], [30, 60, 130]],
};
const REGIONS = ['bear', 'fisherman'].flatMap((who, row) =>
	FACINGS.map((facing, col) => ({ name: `${who}_idle_${facing}`, x: col * CELL, y: row * CELL, w: CELL, h: CELL, colour: COLOURS[who][col] })),
);
function png(width, height, paint) {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4);
	const chunk = (type, body) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(body.length, 0);
		head.write(type, 4, 'latin1');
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
		return Buffer.concat([head, body, tail]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const SHEET_PNG = png(CELL * FACINGS.length, CELL * 2, (x, y) => {
	const region = REGIONS[Math.floor(y / CELL) * FACINGS.length + Math.floor(x / CELL)];
	const cx = x % CELL, cy = y % CELL;
	if (cx < 12 || cx >= CELL - 12 || cy < 8 || cy >= CELL - 4) return [0, 0, 0, 0];
	return cx < 30 ? [255, 255, 255, 255] : [...region.colour, 255];
});

const atlasText = readFileSync(join(RIG_ASSETS, 'symbols', 'symbols.atlas'), 'utf8');
const rigPages = atlasText.split(/\r?\n/).filter((l, i, all) => l.trim() && !l.includes(':') && (i === 0 || all[i - 1].trim() === ''));
const rigFacts = F.rigFactsOf('h3', JSON.parse(readFileSync(join(RIG_ASSETS, 'symbols', 'h3.json'), 'utf8')));

/** A config whose characters each have a sheet of one kind, each the sheet of its own class. */
const kindsDoc = () => F.load({
	family: 'arcade', outcome: 'rules',
	arcade: {
		field: { w: 2000, h: 1200 },
		bodies: Object.fromEntries(['otterLook', 'crateLook', 'foxLook'].map((look) => [look, { shape: 'circle', r: 20, tags: ['player'] }])),
		characters: [
			{ id: 'otter', component: 'otterLook', view: { kind: 'isometric' }, source: { kind: 'rig', rig: 'h3' }, draw: { width: 64 }, actions: [{ id: 'idle', when: { motion: 'still' } }] },
			{ id: 'crate', component: 'crateLook', source: { kind: 'stills' }, draw: { width: 48 }, actions: [{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: { assetKey: SHEET_KEY, region: 'bear_idle_se' } } } }] },
			{ id: 'fox', component: 'foxLook', source: { kind: 'clips', prefix: 'fox' }, draw: { width: 50 }, actions: [{ id: 'idle', when: { motion: 'still' } }, { id: 'walk', when: { motion: 'moving' } }] },
		],
		online: { characters: ['otter', 'crate', 'fox'].map((id) => ({ id, body: `${id}Look`, speed: 200, sheet: id })) },
	},
});
const kindLooks = ['otterLook', 'crateLook', 'foxLook'].map((id) => ({ id, name: id, version: 1, scope: 'project', category: 'ui', root: { id: `${id}-root`, kind: 'container', x: 0, y: 0, children: [] } }));

// ── the stubbed launcher ────────────────────────────────────────────────────────────────────────

const state = { doc: F.salmons(), etag: 'e1', puts: [], componentPosts: [], componentStatus: 200, asked: [] };
const loaded = JSON.stringify(state.doc);
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain' };
const body = (req) => new Promise((resolve) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts).toString('utf8'))); });

function pageData(path) {
	const base = { clientKey: CLIENT, projectKey: PROJECT, tools: [] };
	if (path === '/characters')
		return { ...base, projectName: 'Salmons', gameType: 'arcade', doc: state.doc, source: 'authored', etag: state.etag, templateDefault: state.doc, components: F.looks(), projection: 'isometric', issues: [] };
	if (path === '/flipbook')
		return { ...base, atlases: [], clips: [], openedClip: null, openedEtag: null, canPublishBlueprints: false };
	if (path === '/config')
		return {
			...base, projectName: 'Kinds', gameType: 'arcade', family: 'arcade', doc: kindsDoc(), source: 'authored', etag: 'k1', templateDefault: F.salmons(),
			serverPaylines: null, serverGameKeys: null, components: kindLooks.map((c) => ({ id: c.id, name: c.name, category: c.category, params: [] })),
			templateIsBuiltIn: false, presets: [], pickSheets: [], spines: [], projection: 'isometric', issues: [],
		};
	return null;
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = decodeURIComponent(url.pathname);
	const send = (code, type, payload) => { res.writeHead(code, { 'content-type': type }); res.end(payload); };
	const json = (code, payload) => send(code, MIME['.json'], JSON.stringify(payload));
	if (p.startsWith('/__data/')) return json(200, pageData(p.slice('/__data'.length)));
	if (p === '/bundle.js') return send(200, 'text/javascript', bundle);
	if (pageData(p)) return send(200, 'text/html', '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0b0b10;color:#e8e8ee;font-family:system-ui,sans-serif}</style></head><body><div id="app"></div><script type="module" src="/bundle.js"></script></body></html>');
	state.asked.push(`${req.method} ${p}`);
	if (p === '/api/lease') return json(200, { held: true, heartbeatMs: 600000 });
	if (p === '/api/game-config' && req.method === 'PUT') {
		const sent = JSON.parse(await body(req));
		state.puts.push({ query: url.search, ...sent });
		state.doc = sent.doc;
		state.etag = `e${state.puts.length + 1}`;
		return json(200, { doc: state.doc, etag: state.etag });
	}
	if (p === '/api/characters/whole')
		return json(200, { ok: true, components: F.whole(), clipIds: [], clips: [], projections: ['isometric'], rigs: [{ name: 'h3', shared: false }], sheets: [{ key: SHEET_KEY, name: 'trial' }] });
	if (p === '/api/characters/rig') {
		const name = url.searchParams.get('name');
		if (name !== 'h3') return json(404, { ok: false, found: false, reason: `This project has no rig named "${name}".` });
		return json(200, { ok: true, found: true, name, shared: false, facts: rigFacts, descriptor: {
			folder: 'symbols', format: 'json', runtime: '4.2', pma: false, atlasText,
			skeletonUrl: '/api/editor/asset?key=rigs/symbols/h3.json', pageNames: rigPages, pageUrls: rigPages.map((n) => `/api/editor/asset?key=rigs/symbols/${n}`),
		} });
	}
	if (p === '/api/editor/regions') {
		if (url.searchParams.get('sheet') !== SHEET_KEY) return json(200, { assetKey: url.searchParams.get('sheet'), pageKey: '', pageVersion: '', pageWidth: 0, pageHeight: 0, regions: [] });
		return json(200, { assetKey: SHEET_KEY, pageKey: PAGE_KEY, pageVersion: 'v1', pageWidth: CELL * FACINGS.length, pageHeight: CELL * 2, regions: REGIONS.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })) });
	}
	if (p === '/api/editor/asset') {
		const key = url.searchParams.get('key') ?? '';
		if (key === PAGE_KEY) return send(200, 'image/png', SHEET_PNG);
		const file = join(RIG_ASSETS, key.replace(/^rigs\//, ''));
		if (key.startsWith('rigs/') && file.startsWith(RIG_ASSETS) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	}
	if (p === '/api/editor/component') {
		if (req.method === 'POST') {
			state.componentPosts.push(JSON.parse(await body(req)));
			return state.componentStatus === 200 ? json(200, { ok: true, etag: 'c1' }) : json(state.componentStatus, { message: 'refused' });
		}
		return json(404, { message: 'no such component' });
	}
	if (p === '/api/flipbook/characters') {
		const doc = kindsDoc();
		return json(200, { ok: true, characters: F.projectCharacters(kindLooks, doc), clipIds: ['fox_idle_se'], clips: [] });
	}
	return json(404, { message: `the spike stubs no ${p}` });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await launchChrome({ name: 'characters-page', url: `${ORIGIN}/characters`, args: ['--window-size=1500,1100'], cdpTimeoutMs: 90_000 });
const { evaluate, waitFor } = browser;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`); } return cond; };
const q = JSON.stringify;
const T = (call) => evaluate(`T.${call}`);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, sel) => {
	if (!SHOTS) return;
	if (sel) await T(`show(${q(sel)})`);
	await settle(250);
	writeFileSync(join(SHOTS, `${name}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const open = async (path) => {
	await browser.send('Page.navigate', { url: `${ORIGIN}${path}` });
	await waitFor('window.ready === true && document.readyState === "complete"', 60_000);
	await settle(300);
};
/** How far two tiles' silhouettes differ, as a share of the larger one; `flip` mirrors the second. */
const apart = (a, b, flip) => {
	let off = 0;
	for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++)
		if (a.alpha[y * a.w + x] !== b.alpha[y * b.w + (flip ? b.w - 1 - x : x)]) off++;
	return off / Math.max(1, a.lit, b.lit);
};
/** Every path at which two JSON values differ. */
const diff = (a, b, at = '') => {
	if (JSON.stringify(a) === JSON.stringify(b)) return [];
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [at];
	return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) => diff(a[key], b[key], at ? `${at}.${key}` : key));
};
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const SOURCE = '[data-sheet-card="source"]';
const ACTIONS = '[data-sheet-card="actions"]';
const DRAW = '[data-sheet-card="draw"]';

try {
	await waitFor('window.ready === true', 60_000);
	await waitFor(`T.has('[data-character="bearBot"]')`);
	await settle(400);

	console.log('\n0. the page as loaded');
	ok('Salmons\' two characters are listed, neither has a sheet, and nothing is unsaved', q(await T(`attrs('[data-character]', 'data-character')`)) === q(['bearBot', 'fishermanBot']) && (await T(`has('[data-sheet-state="none"]')`)) && !(await T(`has('.pill.dirty')`)));
	ok('the Character sheet card offers the three sources as ways to start', q(await T(`attrs('[data-start-source] [data-source-kind]', 'data-source-kind')`)) === q(['clips', 'rig', 'stills']));
	await shot('0-start', '[data-sheet-card="sheet"]');

	console.log('\na. a rig on a character');
	await T(`click('[data-character="fishermanBot"]')`);
	await T(`click('[data-start-source] [data-source-kind="rig"]')`);
	await waitFor(`T.has('${SOURCE} [data-source-rig] [data-rig-select]')`);
	ok('choosing Rig opens the Animation source card on it, and writes nothing yet', (await T(`attr('${SOURCE} [data-source-kind="rig"]', 'aria-checked')`)) === 'true' && (await T(`has('${SOURCE} [data-source-pending="rig"]')`)) && !(await T(`has('.pill.dirty')`)));
	await waitFor(`T.count('${SOURCE} [data-rig-select] option') > 1`);
	ok('the project\'s rig is offered', (await T(`texts('${SOURCE} [data-source-rig] [data-rig-select] option')`)).includes('h3'));
	await T(`type('${SOURCE} [data-source-rig] [data-rig-select]', 'h3')`);
	await waitFor(`T.attr('${SOURCE} [data-rig-facts="h3"]', 'data-rig-state') === 'read'`);
	ok('picking it makes the source a rig', (await T(`attr('${SOURCE} [data-source-kind="rig"]', 'data-stored')`)) === 'true' && (await T(`has('.pill.dirty')`)));
	const costLine = await T(`text('${SOURCE} [data-rig-cost-line]')`);
	ok('its cost is one line: draw calls, blend switches, dark-tint slots, with a verdict', /^\d+ draw calls? · \d+ blend switch(es)? · \d+ dark-tint slots?$/.test(costLine) && ['light', 'heavy', 'tooHeavy'].includes(await T(`attr('${SOURCE} [data-rig-cost]', 'data-rig-cost')`)), costLine);
	ok('its animations are listed with their lengths, and a Rigger link names the rig', (await T(`texts('${SOURCE} [data-rig-animations] code')`)).some((t) => /^h3 \(\d+(\.\d+)? s\)$/.test(t)) && (await T(`attr('${SOURCE} [data-rigger-link]', 'href')`)) === '/rigger?project=p&rig=h3', q(await T(`texts('${SOURCE} [data-rig-animations] code')`)));
	ok('a rig can be picked per facing of the view', q(await T(`attrs('${SOURCE} [data-rig-facing]', 'data-rig-facing')`)) === q(['ne', 'se', 'sw', 'nw']));
	await shot('a1-rig-source', SOURCE);

	await T(`type('${DRAW} [data-draw-width]', '120')`);
	ok('the Draw card has a bone picker for the hand, listing the rig\'s bones', (await T(`has('${DRAW} [data-bone-point="hand"] [data-point-bone]')`)) && (await T(`count('${DRAW} [data-bone-point="hand"] option')`)) > 5);
	await T(`type('${ACTIONS} [data-new-action]', 'h3')`);
	await T(`click('${ACTIONS} [data-add-action]')`);
	await waitFor(`T.count('${ACTIONS} [data-rig-tile]') === 4`, 30_000);
	await waitFor(`T.attrs('${ACTIONS} [data-rig-tile]', 'data-state').every((s) => s === 'drawn')`, 60_000);
	await settle(600);
	ok('the grid is the clips grid\'s table: the action\'s row, drawn and mirrored facings', (await T(`has('${ACTIONS} [data-row="h3"]')`)) && q(await T(`attrs('${ACTIONS} table.grid [data-cell]', 'data-cell')`)) === q(['h3|ne', 'h3|se', 'h3|sw', 'h3|nw']), q(await T(`attrs('${ACTIONS} table.grid [data-cell]', 'data-cell')`)));
	ok('an empty cell shows the animation it resolves to by name', q(await T(`texts('${ACTIONS} table.grid [data-rig-cell-draws]')`)) === q(['h3', 'h3', 'h3', 'h3']) && /By name: h3_ne, then h3 on h3\. Draws h3 \(h3\), by name\./.test(await T(`attr('${ACTIONS} [data-cell="h3|ne"]', 'title')`)), await T(`attr('${ACTIONS} [data-cell="h3|ne"]', 'title')`));
	const rigTiles = await T(`rigTiles('${ACTIONS}')`);
	const tile = Object.fromEntries(rigTiles.map((t) => [t.facing, t]));
	ok('the preview draws the rig in every facing of the view', rigTiles.length === 4 && rigTiles.every((t) => t.state === 'drawn' && t.rig === 'h3' && t.animation === 'h3' && t.lit > 500), q(rigTiles.map((t) => [t.facing, t.state, t.lit])));
	ok('a west tile is its twin, mirrored', tile.sw.flip === 'true' && tile.se.flip === 'false' && apart(tile.se, tile.sw, true) < 0.03 && apart(tile.se, tile.sw, false) > 0.05, `${apart(tile.se, tile.sw, true).toFixed(3)} mirrored, ${apart(tile.se, tile.sw, false).toFixed(3)} as is`);
	await shot('a2-rig-actions', `${ACTIONS} table.grid`);

	await T(`click('${ACTIONS} [data-cell="h3|se"]')`);
	ok('pressing a cell opens its editor: an animation of the facing\'s rig, or by name', (await T(`has('${ACTIONS} [data-cell-editor="h3|se"] [data-cell-animation]')`)) && (await T(`texts('${ACTIONS} [data-cell-animation] option')`))[0].startsWith('by name: h3_se, then h3 on h3'), q(await T(`texts('${ACTIONS} [data-cell-animation] option')`)));
	await T(`type('${ACTIONS} [data-cell-animation]', 'h3')`);
	ok('picking one names it in the cell', /Named here: h3\./.test(await T(`attr('${ACTIONS} [data-cell="h3|se"]', 'title')`)) && (await T(`attr('${ACTIONS} [data-cell="h3|se"]', 'class')`)).includes('named'));
	await shot('a3-rig-cell', `${ACTIONS} table.grid`);

	console.log('\nb. ten images on a character');
	await T(`click('[data-character="bearBot"]')`);
	await T(`click('[data-start-source] [data-source-kind="stills"]')`);
	await waitFor(`T.has('${SOURCE} [data-source-stills]')`);
	ok('choosing Still images makes the source still images at once', (await T(`attr('${SOURCE} [data-source-kind="stills"]', 'data-stored')`)) === 'true');
	ok('what the sheet still needs is said, with the Draw card one click away', (await T(`texts('${SOURCE} [data-still-missing] li')`)).some((t) => t.includes('width')) && (await T(`has('${SOURCE} [data-go-draw]')`)), q(await T(`texts('${SOURCE} [data-still-missing] li')`)));
	await T(`type('[data-sheet-card="view"] [data-view-kind]', 'isometric')`);
	await T(`type('[data-sheet-card="view"] [data-view-facings]', '8')`);
	await waitFor(`T.count('${ACTIONS} [data-fill-sheet] option') > 1`);
	await T(`type('${ACTIONS} [data-fill-sheet]', ${q(SHEET_KEY)})`);
	await waitFor(`T.has('${ACTIONS} [data-fill-plan]')`);
	const ambiguous = await T(`texts('${ACTIONS} [data-fill-plan] li')`);
	ok('Fill from names does not guess between two characters: it asks which', (await T(`attr('${ACTIONS} [data-fill-plan]', 'data-fill-ambiguous')`)) === 'true' && q(await T(`attrs('${ACTIONS} [data-fill-prefix]', 'data-fill-prefix')`)) === q(['bear', 'fisherman']) && !(await T(`has('${ACTIONS} [data-fill-apply]')`)), q(ambiguous));
	await shot('b1-fill-ambiguous', `${ACTIONS} [data-fill]`);
	await T(`click('${ACTIONS} [data-fill-prefix="bear"]')`);
	const plan = await T(`texts('${ACTIONS} [data-fill-plan] li')`);
	ok('the plan says what it fills before anything is written', plan[0] === 'idle (a new action): 5 images, 3 facings mirrored, nothing missing.' && !(await T(`has('${ACTIONS} [data-action="idle"]')`)), q(plan));
	await shot('b2-fill-plan', `${ACTIONS} [data-fill]`);
	await T(`click('${ACTIONS} [data-fill-apply]')`);
	await waitFor(`T.has('${ACTIONS} [data-fill-done]')`);
	ok('Apply places the five images and adds the action', /^5 images placed\. Added "idle"\./.test(await T(`text('${ACTIONS} [data-fill-done]')`)) && (await T(`has('${ACTIONS} [data-action="idle"]')`)), await T(`text('${ACTIONS} [data-fill-done]')`));
	await T(`click('${ACTIONS} [data-fill-width]')`);
	ok('one button gives the draw box the widest image\'s width', (await T(`value('${DRAW} [data-draw-width]')`)) === String(CELL));
	await waitFor(`T.stillTiles('${ACTIONS}').length === 8 && T.stillTiles('${ACTIONS}').every((t) => t.lit > 0)`, 30_000);
	const stills = await T(`stillTiles('${ACTIONS}')`);
	const still = Object.fromEntries(stills.map((t) => [t.facing, t]));
	ok('the bear stands in eight directions, every tile with pixels in it', stills.length === 8 && stills.every((t) => t.lit > 1000), q(stills.map((t) => [t.facing, t.lit])));
	ok('five are drawn from their own image, each a different one', ['n', 'ne', 'e', 'se', 's'].every((f) => still[f].plays === `still::${SHEET_KEY}::bear_idle_${f}` && !still[f].mirrored && still[f].stripe === 'left') && new Set(['n', 'ne', 'e', 'se', 's'].map((f) => still[f].colour)).size === 5, q(stills.map((t) => [t.facing, t.colour, t.stripe, t.mirrored])));
	ok('three are their twin\'s image, mirrored', [['sw', 'se'], ['w', 'e'], ['nw', 'ne']].every(([west, east]) => still[west].mirrored && still[west].colour === still[east].colour && still[west].plays === still[east].plays), q(['sw', 'w', 'nw'].map((f) => [f, still[f].colour, still[f].mirrored, still[f].plays])));
	ok('the grid shows each as a still image or its mirror', (await T(`count('${ACTIONS} table.grid [data-cell-holds="still"]')`)) === 5 && (await T(`count('${ACTIONS} table.grid .cell.mirrored')`)) === 3);
	await shot('b3-stills-grid', `${ACTIONS} table.grid`);
	await shot('b4-stills-preview', `${ACTIONS} .compass`);

	await T(`click('${ACTIONS} [data-cell*="bear_idle_e"]')`);
	ok('a cell\'s editor has the project\'s region picker, on the image it holds', (await T(`has('${ACTIONS} [data-cell-editor="idle|e"] [data-cell-still] .region-picker')`)) && (await T(`text('${ACTIONS} [data-cell-still] .cur-name')`)) === 'bear_idle_e' && !(await T(`has('${ACTIONS} [data-cell-clip]')`)));
	await T(`click('${ACTIONS} [data-cell-still] .current')`);
	await T(`click('${ACTIONS} [data-cell-still] .sheetrow')`);
	await waitFor(`T.count('${ACTIONS} [data-cell-still] .frame') === 10`);
	await shot('b5-region-picker', `${ACTIONS} [data-cell-editor]`);
	await T(`click('${ACTIONS} [data-cell-still] .frame[title="fisherman_idle_e"]')`);
	await settle(300);
	ok('picking another image stores it in the cell', (await T(`text('${ACTIONS} [data-cell-editor="idle|e"] [data-cell-holds]')`)) === `Still image: fisherman_idle_e (${SHEET_KEY})`, await T(`text('${ACTIONS} [data-cell-editor] [data-cell-holds]')`));

	console.log('\nc. a character by name');
	const postsBefore = state.componentPosts.length;
	await T(`type('[data-new-character-name]', 'Polar Bear')`);
	ok('the name says what adding it does, as it is typed', (await T(`text('[data-add-plan="create"]')`)) === 'Adds the character "polar_bear" and creates its look "polar_bear".', await T(`text('[data-add-plan]')`));
	await T(`click('[data-add-character]')`);
	await waitFor(`T.has('[data-character="polar_bear"]')`);
	await settle(300);
	const posts = state.componentPosts.slice(postsBefore);
	ok('one create of its look, only if none is stored', posts.length === 1 && posts[0].baseEtag === null && !('force' in posts[0]) && posts[0].id === 'polar_bear' && posts[0].name === 'Polar Bear' && posts[0].scope === 'project' && posts[0].project === PROJECT, q(posts.map((b) => [b.baseEtag, b.force, b.id, b.project])));
	ok('the character is added and selected', (await T(`attr('[data-character="polar_bear"]', 'class')`)).includes('on') && /Added "polar_bear" and created its look/.test(await T(`text('[data-add-note]')`)), await T(`text('[data-add-note]')`));
	ok('its look is under Advanced, on the Character card and beside Add', (await T(`value('details[data-advanced="look"] select')`)) === 'polar_bear' && !(await T(`attr('details[data-advanced="look"]', 'open')`)) && (await T(`has('details[data-advanced="add"] [data-add-with-look]')`)), await T(`value('details[data-advanced="look"] select')`));
	await shot('c1-added', '.list');
	await T(`click('[data-start-source] [data-source-kind="stills"]')`);
	await waitFor(`T.count('${SOURCE} [data-stills-sheet] option') > 1`);
	await T(`type('${SOURCE} [data-stills-sheet]', ${q(SHEET_KEY)})`);
	await waitFor(`T.has('${SOURCE} [data-stills-prefix="fisherman"]')`);
	await T(`click('${SOURCE} [data-stills-prefix="fisherman"]')`);
	await waitFor(`T.stillTiles('${ACTIONS}').length === 8 && T.stillTiles('${ACTIONS}').every((t) => t.lit > 0)`, 30_000);
	const made = await T(`stillTiles('${ACTIONS}')`);
	ok('Images from a sheet makes the whole character in one step: view, width, action and the eight facings', made.every((t) => t.lit > 1000) && (await T(`value('${DRAW} [data-draw-width]')`)) === String(CELL) && (await T(`value('[data-sheet-card="view"] [data-view-facings]')`)) === '8' && /5 images placed\. Added "idle"\./.test(await T(`text('${SOURCE} [data-stills-note]')`)), await T(`text('${SOURCE} [data-stills-note]')`));
	await shot('c2-images-from-sheet', SOURCE);

	console.log('\nd. the save');
	ok('there are unsaved changes and no error blocks the save', (await T(`has('.pill.dirty')`)) && !(await T(`disabled('button.save')`)), await T(`text('.iw-toolbar')`));
	await T(`click('button.save')`);
	await waitFor(`!T.has('.pill.dirty')`, 20_000);
	const put = state.puts.at(-1);
	const before = JSON.parse(loaded);
	const changed = diff(before, put.doc);
	const characters = put.doc.arcade.characters;
	ok('one PUT of the whole config, on the ETag the page loaded', state.puts.length === 1 && put.query === '?project=p' && put.baseEtag === 'e1' && put.force === false, q([state.puts.length, put.query, put.baseEtag, put.force]));
	ok('it differs from the loaded config in the three characters edited and the new body, and nowhere else', q(changed.map((path) => path.split('.').slice(0, 3).join('.')).filter((v, i, all) => all.indexOf(v) === i).sort()) === q(['arcade.bodies.polar_bear', 'arcade.characters.0', 'arcade.characters.1', 'arcade.characters.2'].sort()), q(changed));
	ok('the fisherman is a rig sheet: the rig, the width, the action and the cell named', q(sorted({ source: characters[1].source, draw: characters[1].draw, actions: characters[1].actions })) === q(sorted({ source: { kind: 'rig', rig: 'h3' }, draw: { width: 120 }, actions: [{ id: 'h3', anim: { se: { anim: 'h3' } } }] })), q(characters[1]));
	const stillOf = (who, facing) => ({ still: { assetKey: SHEET_KEY, region: `${who}_idle_${facing}` } });
	ok('the bear is a stills sheet of eight facings: its five images, the one replaced by hand', q(sorted({ view: characters[0].view, source: characters[0].source, draw: characters[0].draw, actions: characters[0].actions })) === q(sorted({ view: { kind: 'isometric', facings: 8 }, source: { kind: 'stills' }, draw: { width: CELL }, actions: [{ id: 'idle', when: { motion: 'still' }, anim: { n: stillOf('bear', 'n'), ne: stillOf('bear', 'ne'), e: stillOf('fisherman', 'e'), se: stillOf('bear', 'se'), s: stillOf('bear', 's') } }] })), q(characters[0]));
	ok('the new character is saved with its look and the fisherman\'s five images', characters[2].id === 'polar_bear' && characters[2].component === 'polar_bear' && characters[2].source.kind === 'stills' && q(Object.keys(characters[2].actions[0].anim).sort()) === q(['e', 'n', 'ne', 's', 'se']), q(characters[2]));
	const untouched = (doc) => q(({ ...doc, arcade: { ...doc.arcade, characters: doc.arcade.characters.slice(0, 2).map(({ id, component, brain, controller, movement, animInputs, name }) => ({ id, component, brain, controller, movement, animInputs, name })), bodies: { ...doc.arcade.bodies, polar_bear: undefined } } }));
	ok('everything the cards did not edit is what was loaded, byte for byte', untouched(put.doc) === untouched(before));

	// With no edit, what the page holds is the stored config: an edit taken back leaves it clean,
	// and a save of an edit followed by a save of its undo PUTs the same bytes again.
	await T(`click('[data-character="fishermanBot"]')`);
	const nameField = 'section input[placeholder="fishermanBot"]';
	const wasNamed = await T(`value(${q(nameField)})`);
	ok('opening a character and its cards edits nothing', !(await T(`has('.pill.dirty')`)) && (await T(`disabled('button.save')`)));
	await T(`type(${q(nameField)}, 'Old Man')`);
	ok('an edit marks the page unsaved', await T(`has('.pill.dirty')`));
	await T(`type(${q(nameField)}, ${q(wasNamed)})`);
	ok('taking it back leaves nothing to save: the page holds the stored config', !(await T(`has('.pill.dirty')`)) && (await T(`disabled('button.save')`)));
	await T(`type(${q(nameField)}, 'Old Man')`);
	await T(`click('button.save')`);
	await waitFor(`!T.has('.pill.dirty') && !T.disabled(${q(nameField)})`, 20_000);
	await T(`type(${q(nameField)}, ${q(wasNamed)})`);
	await T(`click('button.save')`);
	await waitFor(`!T.has('.pill.dirty')`, 20_000);
	ok('a save of an edit, then of its undo: the last PUT is the first one\'s config, byte for byte', state.puts.length === 3 && q(diff(state.puts[1].doc, put.doc)) === q(['arcade.characters.1.name']) && q(state.puts[2].doc) === q(put.doc) && state.puts[2].baseEtag === 'e3', q([state.puts.length, diff(state.puts[1]?.doc, put.doc), diff(state.puts[2]?.doc, put.doc)]));

	console.log('\nthe Whole view');
	await T(`press('.mode-bar', 'Whole')`);
	await waitFor(`T.has('[data-whole]')`);
	await T(`click('[data-whole="salmonsFisherman"]')`).catch(async () => T(`click('[data-whole]:nth-of-type(2)')`));
	await settle(300);
	const wholeKeys = await T(`attrs('[data-whole]', 'data-whole')`);
	ok('the Whole view names the source in plain words and links to the choice', (await T(`has('[data-choose-source]')`)) && /\/characters\?character=\w+&card=source&project=p/.test(await T(`attr('[data-choose-source]', 'href')`)), q([wholeKeys, await T(`text('[data-source]')`), await T(`attr('[data-choose-source]', 'href')`)]));
	ok('its Look row is under Advanced', (await T(`has('details[data-advanced="look"] dl.facts')`)) && !(await T(`texts('.cards > section:first-of-type > dl.facts > dt, .cards dl.facts:not(details dl) > dt')`)).includes('Look'));
	await shot('w1-whole', '.cards');
	await T(`click('[data-choose-source]')`);
	await waitFor(`T.has('${SOURCE} [data-source-choice]')`);
	ok('the link opens the Edit view on the Animation source card', await T(`has('${SOURCE} [data-source-choice]')`));

	console.log('\ne. Flipbook\'s Characters mode');
	await open('/flipbook?mode=characters');
	await waitFor(`T.count('[data-character]') > 0`, 30_000);
	const listed = await T(`attrs('[data-character]', 'data-character')`);
	ok('a character whose sheet is frame clips is listed', listed.includes('fox'), q(listed));
	ok('a character drawn by a rig or by still images is not listed as one with clips to make', !listed.includes('otter') && !listed.includes('crate'), q(listed));
	await shot('e1-flipbook-characters');
	ok('Flipbook\'s page threw nothing', browser.pageLog.filter((l) => l.startsWith('[uncaught]')).length === 0, browser.pageLog.filter((l) => l.startsWith('[uncaught]')).slice(0, 2).join(' | '));

	console.log('\nf. Game Config\'s confirmations');
	await open('/config');
	await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Reset to template default')`, 30_000);
	const COUNTS = '3 character sheets and 3 online class links to their sheets, made in Invisible Characters';
	await T(`press('body', 'Reset to template default')`);
	await waitFor(`T.dialog() !== ''`);
	const reset = await T(`cancel()`);
	ok('Reset to template default names the sheets it takes: a rig, a stills and a clips sheet are three', reset.includes('Reset to the template default?') && reset.includes(COUNTS), reset);
	await shot('f1-config');
	await T(`choose('match3')`);
	await waitFor(`T.dialog() !== ''`);
	const leave = await T(`cancel()`);
	ok('leaving the arcade family names them too', leave.includes('Leave the arcade family?') && leave.includes(COUNTS), leave);
	await T(`tick('Played online')`);
	await waitFor(`T.dialog() !== ''`);
	const offline = await T(`cancel()`);
	ok('turning Online off names the three links, and says the sheets stay', offline.includes('Stop playing online?') && offline.includes('3 classes name a character sheet: the links go with the room, and the sheets stay on their characters.'), offline);
	ok('cancelling each left the config as it was: nothing unsaved', !/Unsaved/.test(await T(`text('.iw-toolbar')`)), await T(`text('.iw-toolbar')`));
	ok('Game Config\'s page threw nothing', browser.pageLog.filter((l) => l.startsWith('[uncaught]')).length === 0, browser.pageLog.filter((l) => l.startsWith('[uncaught]')).slice(0, 2).join(' | '));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}\n${browser.pageLog.slice(-8).join('\n')}`);
	await shot('zz-threw').catch(() => {});
} finally {
	await browser.close();
	server.close();
	rmSync(scratch, { recursive: true, force: true });
}
console.log(`\n${fail ? '✗ FAIL' : '✅ PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
