// Browser gate for Invisible Characters' rig preview (character pipeline C6b):
// `apps/launcher-api/src/lib/characters/SheetRigPreview.svelte` over `rigLoad.client.ts`.
//
//   node tools/rigger-spike/sheet-rig-preview-browser.mjs [--shot <file.png>]
//
// The REAL component and loader, compiled as Vite compiles them, mounted in a REAL Chromium against
// a fake `/api/characters/rig` that names a rig of `apps/lines/static`. Checks that
//   - every facing of the sheet's view is a tile carrying what the game's resolver answered
//     (`data-rig`, `data-animation`, `data-flip`, `data-skin`), in the compass's areas;
//   - one canvas draws them all: every tile has the rig's pixels in it, a mirrored facing is the
//     mirror image of its twin, and an unmirrored one is the same image;
//   - the rig is drawn the sheet's width wide with its feet on the place;
//   - a rig that cannot be loaded says why on its tile, an action with no animation shows "—";
//   - a rig whose load failed is loaded again at the next read of it, and then drawn; a rig the
//     host has read again (new facts) is loaded again too;
//   - in a Chromium with no WebGL the tiles say the preview could not start, not `drawn`;
//   - unmounting destroys the looks and the application, and the page throws nothing.
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const LAUNCHER = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));
const fromLauncher = createRequire(join(LAUNCHER, 'package.json'));
const { compile, compileModule } = fromLauncher('svelte/compiler');
const esbuild = await import(ESBUILD);

/** `.svelte` and `.svelte.ts` as the Svelte plugin of Vite compiles them, for the browser. */
const svelte = {
	name: 'svelte',
	setup(build) {
		// Vite's `?url` imports (a transcoder's wasm): nothing here fetches one.
		build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'url' }));
		build.onLoad({ filter: /.*/, namespace: 'url' }, () => ({ contents: 'export default "";', loader: 'js' }));
		// Props a mounted component reads live, so the spike can change one as a host does.
		build.onResolve({ filter: /^spike:live-props$/ }, (args) => ({ path: args.path, namespace: 'live-props' }));
		build.onLoad({ filter: /.*/, namespace: 'live-props' }, () => ({
			contents: compileModule(LIVE_PROPS, { filename: 'live-props.svelte.js', generate: 'client', dev: false }).js.code,
			loader: 'js',
			resolveDir: LAUNCHER,
		}));
		build.onLoad({ filter: /\.svelte$/ }, (args) => ({
			contents: compile(readFileSync(args.path, 'utf8'), { filename: args.path, generate: 'client', css: 'injected', dev: false }).js.code,
			loader: 'js',
		}));
		build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, async (args) => {
			const js = await esbuild.transform(readFileSync(args.path, 'utf8'), { loader: 'ts', target: 'esnext' });
			return { contents: compileModule(js.code, { filename: args.path, generate: 'client', dev: false }).js.code, loader: 'js' };
		});
	},
};

const LIVE_PROPS = `
export function liveProps(initial) {
	let current = $state.raw(initial);
	const props = {};
	for (const key of Object.keys(initial)) Object.defineProperty(props, key, { enumerable: true, get: () => current[key] });
	return { props, set(next) { current = { ...current, ...next }; } };
}`;

const entry = `
import { mount, unmount, flushSync } from 'svelte';
import { liveProps } from 'spike:live-props';
import SheetRigPreview from './src/lib/characters/SheetRigPreview.svelte';
import { createRigLoader } from './src/lib/characters/rigLoad.client.ts';

const loader = createRigLoader('p');
const boxes = [];
window.T = {
	loader,
	async facts(rig) { return (await loader.load(rig)).facts; },
	show(props) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const live = liveProps({ load: loader.load, ...props });
		const component = mount(SheetRigPreview, { target, props: live.props });
		flushSync();
		boxes.push({ target, component, live });
		return boxes.length - 1;
	},
	/** Change props of a mounted preview, as its host does. */
	set(i, next) { boxes[i].live.set(next); flushSync(); return true; },
	tiles(i) {
		return [...boxes[i].target.querySelectorAll('[data-rig-tile]')].map((el) => ({
			facing: el.dataset.rigTile, rig: el.dataset.rig, animation: el.dataset.animation, flip: el.dataset.flip,
			skin: el.dataset.skin, state: el.dataset.state, area: el.style.gridArea,
			text: el.querySelector('.stage').textContent.trim(), caption: el.querySelector('figcaption span').textContent,
		}));
	},
	canvases: (i) => boxes[i].target.querySelectorAll('canvas').length,
	box(i) { boxes[i].target.querySelector('.check input').click(); flushSync(); },
	press(i, facing) { boxes[i].target.querySelector('[data-rig-tile="' + facing + '"] .hit').click(); },
	/** Each tile's pixels off the one canvas, read in the frame they were drawn in. */
	pixels(i) {
		return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
			const { target } = boxes[i];
			const canvas = target.querySelector('canvas');
			const copy = document.createElement('canvas');
			copy.width = canvas.width; copy.height = canvas.height;
			const ctx = copy.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(canvas, 0, 0);
			const ratio = canvas.width / canvas.getBoundingClientRect().width;
			const origin = canvas.getBoundingClientRect();
			const out = {};
			for (const stage of target.querySelectorAll('[data-rig-stage]')) {
				const at = stage.getBoundingClientRect();
				const w = Math.round(at.width * ratio), h = Math.round(at.height * ratio);
				const data = ctx.getImageData(Math.round((at.left - origin.left) * ratio), Math.round((at.top - origin.top) * ratio), w, h).data;
				let minX = w, maxX = -1, minY = h, maxY = -1, lit = 0;
				const alpha = new Uint8Array(w * h);
				for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
					const a = data[(y * w + x) * 4 + 3];
					alpha[y * w + x] = a > 40 ? 1 : 0;
					if (a > 40) { lit++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
				}
				out[stage.dataset.rigStage] = { w, h, lit, minX, maxX, minY, maxY, alpha: Array.from(alpha).join('') };
			}
			resolve({ ratio, canvas: [canvas.width, canvas.height], tiles: out });
		})));
	},
	close(i) { unmount(boxes[i].component); boxes[i].target.remove(); },
};
window.ready = true;
`;

const built = await esbuild.build({
	stdin: { contents: entry, resolveDir: LAUNCHER, loader: 'ts' },
	bundle: true,
	format: 'iife',
	platform: 'browser',
	conditions: ['svelte', 'browser', 'production'],
	alias: { $lib: join(LAUNCHER, 'src/lib') },
	plugins: [svelte],
	loader: { '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.glsl': 'text', '.frag': 'text', '.vert': 'text', '.wgsl': 'text' },
	define: { 'import.meta.env.DEV': 'false', 'import.meta.env.SSR': 'false', 'import.meta.env': '{}' },
	write: false,
	logLevel: 'error',
});
const bundle = built.outputFiles[0].text;

const atlasText = readFileSync(join(RIG_ASSETS, 'symbols', 'symbols.atlas'), 'utf8');
const pages = atlasText.split(/\r?\n/).filter((l, i, all) => l.trim() && !l.includes(':') && (i === 0 || all[i - 1].trim() === ''));
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain' };
const asked = [];
/** While set, the rig cannot be read: what a rig that is being saved, or a storage fault, answers. */
let rigFault = false;
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = decodeURIComponent(url.pathname);
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
	if (p === '/') return send(200, 'text/html', '<!doctype html><body style="background:#111"><script src="/bundle.js"></script></body>');
	if (p === '/bundle.js') return send(200, 'text/javascript', bundle);
	if (p === '/api/characters/rig') {
		const name = url.searchParams.get('name');
		asked.push(`${name}@${url.searchParams.get('projectKey')}`);
		if (rigFault) return send(500, MIME['.json'], JSON.stringify({ ok: false, message: 'The rig could not be read: storage did not answer.' }));
		if (name !== 'h3') return send(404, MIME['.json'], JSON.stringify({ ok: false, found: false, reason: `This project has no rig named "${name}".` }));
		return send(200, MIME['.json'], JSON.stringify({ ok: true, found: true, name, shared: false, descriptor: {
			folder: 'symbols', format: 'json', runtime: '4.2', pma: false, atlasText,
			skeletonUrl: '/rigs/symbols/h3.json', pageNames: pages, pageUrls: pages.map((n) => `/rigs/symbols/${n}`),
		} }));
	}
	const file = join(RIG_ASSETS, p.replace(/^\/rigs\//, ''));
	if (p.startsWith('/rigs/') && file.startsWith(RIG_ASSETS) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
	return send(404, 'text/plain', 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const browser = await launchChrome({ name: 'sheet-rig-preview', url: URL_, args: ['--window-size=1400,1000'], cdpTimeoutMs: 60_000 });
const { evaluate, waitFor } = browser;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`); } return cond; };
const q = JSON.stringify;
/** How far two tiles' silhouettes differ, as a share of the larger one; `flip` mirrors the second. */
const apart = (a, b, flip) => {
	let off = 0;
	for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++)
		if (a.alpha[y * a.w + x] !== b.alpha[y * b.w + (flip ? b.w - 1 - x : x)]) off++;
	return off / Math.max(1, a.lit, b.lit);
};

const WIDTH = 120;
const sheet = {
	view: { kind: 'isometric' },
	source: { kind: 'rig', rig: 'h3', rigs: { se: 'ghost' } },
	draw: { width: WIDTH, feet: 1 },
	actions: [{ id: 'h3', when: { motion: 'still' } }, { id: 'nap' }, { id: 'boo', when: { motion: 'moving' } }],
};
try {
	await waitFor('window.ready === true');
	const facts = await evaluate(`T.facts('h3')`);
	ok('the loader reads the rig, and its facts off what it loaded', facts.name === 'h3' && facts.animations.some((a) => a.name === 'h3' && a.durationMs === 2000) && facts.cost.drawCalls === 6, q(facts.animations) + q(facts.cost));
	const ghost = { name: 'ghost', animations: [{ name: 'boo', durationMs: 500 }], skins: [], bones: [], cost: facts.cost };

	console.log('\n1. every facing, through the game\'s resolver');
	const main = await evaluate(`T.show(${q({ sheet, rigs: { h3: facts }, action: 'h3', selected: 'ne' })})`);
	await waitFor(`T.tiles(${main}).every((t) => t.state === 'drawn')`, 30000);
	const tiles = await evaluate(`T.tiles(${main})`);
	ok('four tiles, clockwise from north, each in its compass area', q(tiles.map((t) => [t.facing, t.area])) === q([['ne', 'f-ne'], ['se', 'f-se'], ['sw', 'f-sw'], ['nw', 'f-nw']]), q(tiles.map((t) => [t.facing, t.area])));
	ok('each carries the rig, the animation and the mirror the resolver answered', q(tiles.map((t) => [t.rig, t.animation, t.flip, t.skin])) === q([['h3', 'h3', 'false', ''], ['h3', 'h3', 'false', ''], ['h3', 'h3', 'true', ''], ['h3', 'h3', 'true', '']]), q(tiles));
	ok('one canvas', (await evaluate(`T.canvases(${main})`)) === 1);
	ok('the rig is asked for once, for the page\'s project', q(asked) === q(['h3@p']), q(asked));
	await new Promise((r) => setTimeout(r, 400));
	const shot = await evaluate(`T.pixels(${main})`);
	const px = shot.tiles;
	ok('every tile has the rig drawn in it', ['ne', 'se', 'sw', 'nw'].every((f) => px[f].lit > 500), q(Object.fromEntries(Object.entries(px).map(([f, t]) => [f, t.lit]))));
	ok('an unmirrored facing is the same image as its neighbour', apart(px.ne, px.se, false) < 0.02, apart(px.ne, px.se, false).toFixed(3));
	ok('a mirrored facing is the mirror image of its twin', apart(px.se, px.sw, true) < 0.02 && apart(px.se, px.sw, false) > 0.05, `${apart(px.se, px.sw, true).toFixed(3)} mirrored, ${apart(px.se, px.sw, false).toFixed(3)} as is`);
	const wide = (px.ne.maxX - px.ne.minX + 1) / shot.ratio;
	ok(`the art is about the sheet's width wide (${WIDTH} px box)`, wide > WIDTH * 0.4 && wide < WIDTH * 1.5, `${wide.toFixed(1)} px of art`);

	await evaluate(`(T.box(${main}), true)`);
	await new Promise((r) => setTimeout(r, 300));
	const boxed = (await evaluate(`T.pixels(${main})`)).tiles.ne;
	ok('Box, feet and hand draws the ground line across the tile', boxed.minX <= 2 && boxed.maxX >= boxed.w - 3 && px.ne.minX > 2, `${boxed.minX}..${boxed.maxX} of ${boxed.w}`);
	const shotAt = process.argv.indexOf('--shot');
	if (shotAt > 0) writeFileSync(process.argv[shotAt + 1], Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

	console.log('\n2. what cannot be drawn');
	const failing = await evaluate(`T.show(${q({ sheet, rigs: { h3: facts, ghost }, action: 'boo' })})`);
	await waitFor(`T.tiles(${failing}).some((t) => t.state === 'failed')`, 30000);
	const bad = await evaluate(`T.tiles(${failing})`);
	const se = bad.find((t) => t.facing === 'se');
	ok('a rig that does not load says why on its tile', se.rig === 'ghost' && se.state === 'failed' && se.text.includes('no rig named "ghost"'), q(se));
	const napping = await evaluate(`T.show(${q({ sheet, rigs: { h3: facts }, action: 'nap' })})`);
	const nap = await evaluate(`T.tiles(${napping})`);
	ok('an action with no animation: every tile is empty and says "—"', nap.length === 4 && nap.every((t) => t.state === 'none' && t.text === '—' && t.rig === '' && t.caption === '—'), q(nap));

	console.log('\n3. a rig read again');
	const lit = async (i) => Object.values((await evaluate(`T.pixels(${i})`)).tiles).map((t) => t.lit);
	const asks = () => asked.filter((a) => a === 'h3@p').length;
	rigFault = true;
	await evaluate(`(T.loader.forget('h3'), true)`);
	const retried = await evaluate(`T.show(${q({ sheet, rigs: { h3: facts }, action: 'h3' })})`);
	await waitFor(`T.tiles(${retried}).every((t) => t.state === 'failed')`, 30000);
	const down = await evaluate(`T.tiles(${retried})`);
	ok('a rig whose load fails says why on every tile, and nothing is drawn', down.every((t) => t.text === 'The rig could not be read: storage did not answer.') && (await lit(retried)).every((n) => n === 0), q(down.map((t) => [t.state, t.text])));
	const asksDown = asks();
	rigFault = false;
	await evaluate(`T.set(${retried}, ${q({ statuses: ['wet'] })})`);
	await waitFor(`T.tiles(${retried}).every((t) => t.state === 'drawn')`, 30000);
	await new Promise((r) => setTimeout(r, 400));
	ok('the next time the preview reads its tiles (a prop changed) the rig is loaded again, and drawn', asks() === asksDown + 1 && (await lit(retried)).every((n) => n > 500), `${asks() - asksDown} asked, ${q(await lit(retried))}`);
	const asksDrawn = asks();
	await evaluate(`T.set(${retried}, ${q({ statuses: [], selected: 'ne' })})`);
	await new Promise((r) => setTimeout(r, 300));
	ok('a rig that is loaded is not asked for again by a prop that leaves it as it was', asks() === asksDrawn, `${asks() - asksDrawn} asked`);
	await evaluate(`(T.loader.forget('h3'), T.set(${retried}, ${q({ rigs: { h3: { ...facts } } })}))`);
	for (let i = 0; i < 50 && asks() === asksDrawn; i++) await new Promise((r) => setTimeout(r, 100));
	await new Promise((r) => setTimeout(r, 500));
	ok('a rig the host has read again is loaded again, and drawn from the new copy', asks() === asksDrawn + 1 && (await lit(retried)).every((n) => n > 500), `${asks() - asksDrawn} asked, ${q(await lit(retried))}`);

	console.log('\n4. closing');
	await evaluate(`(T.close(${main}), T.close(${failing}), T.close(${napping}), T.close(${retried}), T.loader.dispose(), true)`);
	await new Promise((r) => setTimeout(r, 300));
	ok('nothing is left on the page', (await evaluate('document.querySelectorAll("canvas, [data-rig-tile]").length')) === 0);
	const thrown = browser.pageLog.filter((l) => l.startsWith('[uncaught]') || l.startsWith('[error]'));
	ok('the page throws nothing', thrown.length === 0, thrown.slice(0, 3).join(' | '));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}\n${browser.pageLog.slice(-6).join('\n')}`);
} finally {
	await browser.close();
}

console.log('\n5. a browser with no WebGL');
const bare = await launchChrome({ name: 'sheet-rig-preview-no-webgl', url: URL_, args: ['--window-size=1400,1000', '--disable-3d-apis'], cdpTimeoutMs: 60_000 });
try {
	await bare.waitFor('window.ready === true');
	ok('the browser has no WebGL', (await bare.evaluate(`!document.createElement('canvas').getContext('webgl2') && !document.createElement('canvas').getContext('webgl')`)) === true);
	const facts = await bare.evaluate(`T.facts('h3')`);
	const i = await bare.evaluate(`T.show(${q({ sheet, rigs: { h3: facts }, action: 'h3' })})`);
	await bare.waitFor(`T.tiles(${i}).every((t) => t.state !== 'loading')`, 30000);
	await new Promise((r) => setTimeout(r, 1500));
	const tiles = await bare.evaluate(`T.tiles(${i})`);
	ok('every tile says the preview could not start, and none says drawn', tiles.length === 4 && tiles.every((t) => t.state === 'failed' && t.text === 'The preview could not start: this browser cannot draw it (WebGL is off or not available).'), q(tiles.map((t) => [t.state, t.text])));
	const napping = await bare.evaluate(`T.show(${q({ sheet, rigs: { h3: facts }, action: 'nap' })})`);
	ok('a facing that draws nothing still says "—"', (await bare.evaluate(`T.tiles(${napping})`)).every((t) => t.state === 'none' && t.text === '—'));
	await bare.evaluate(`(T.close(${i}), T.close(${napping}), T.loader.dispose(), true)`);
	const thrown = bare.pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('no rejection is left unhandled', thrown.length === 0, thrown.slice(0, 3).join(' | '));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}\n${bare.pageLog.slice(-6).join('\n')}`);
} finally {
	await bare.close();
	server.close();
}
console.log(`\n${fail ? '✗ FAIL' : '✅ PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
