// Render parity: draws rigs with the reference Pixi runtime and with engine-rig/pixi in headless
// Chromium (WebGL via SwiftShader) and pixel-diffs the frames.
//
//   node tools/rig-parity/render.mjs [--filter <substring>] [--dir <folder>] [--size 256] [--max 0.5]
//
// Each rig is drawn at its authored box, for up to three animations at two times. A frame passes
// when at most --max percent of its pixels differ beyond pixelmatch's default threshold.
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { ESBUILD } from '../rigger-spike/esbuild.mjs';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { ROOT } from './load.mjs';
import { findRigs, poseCases } from './rigs.mjs';
import { reference } from './reference.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const filter = arg('--filter', null);
const dir = resolve(arg('--dir', ROOT));
const SIZE = Number(arg('--size', 256));
const MAX = Number(arg('--max', 0.5));
const dumpDir = arg('--dump', null);

const pixelmatch = (await import('pixelmatch')).default;
const { PNG } = await import('pngjs');

const esbuild = await import(ESBUILD);
const work = mkdtempSync(join(tmpdir(), 'rig-render-'));
const ref = await reference();
const nodePaths = [join(ROOT, 'packages/engine-rig/node_modules'), ref.nodeModules];
for (const name of ['ref', 'rig']) {
	await esbuild.build({
		entryPoints: [join(ROOT, 'tools/rig-parity/render/page.ts')],
		bundle: true,
		format: 'iife',
		platform: 'browser',
		outfile: join(work, `${name}.js`),
		nodePaths,
		alias: { RUNTIME: name === 'ref' ? ref.pixiEntry : join(ROOT, 'packages/engine-rig/pixi.ts') },
		define: { RUNTIME_NAME: JSON.stringify(name) },
		logLevel: 'error',
	});
	writeFileSync(
		join(work, `${name}.html`),
		`<!doctype html><body style="margin:0"><script src="/__work/${name}.js"></script></body>`,
	);
}

const types = {
	'.js': 'text/javascript',
	'.html': 'text/html',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.json': 'application/json',
	'.atlas': 'text/plain',
	'.skel': 'application/octet-stream',
};
const server = createServer((req, res) => {
	const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	const file = url.startsWith('/__work/') ? join(work, url.slice(8)) : join(dir, url);
	if (!existsSync(file) || statSync(file).isDirectory()) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
}).listen(0);
const port = server.address().port;

const rigs = findRigs(dir, filter);
const cases = poseCases(rigs);
if (!cases.length) {
	console.log('no rigs found');
	process.exit(1);
}

async function renderAll(name, cases) {
	await browser.evaluate(`location.href = 'http://127.0.0.1:${port}/__work/${name}.html'`);
	await browser.waitFor('window.ready === true', 60_000);
	const out = [];
	for (const c of cases) {
		try {
			out.push(await browser.evaluate(`renderPose(${JSON.stringify({ ...c, size: SIZE })})`));
		} catch (e) {
			out.push({ error: String(e.message ?? e) });
		}
	}
	return out;
}

const browser = await launchChrome({
	name: 'rig-render',
	url: 'about:blank',
	args: [`--window-size=${SIZE + 50},${SIZE + 50}`],
});
const refFrames = await renderAll('ref', cases);
const rigFrames = await renderAll('rig', cases);
await browser.close();
server.close();

let failures = 0;
let compared = 0;
let empty = 0;
const coverage = (buf) => {
	let n = 0;
	for (let i = 3; i < buf.length; i += 4) if (buf[i] > 8) n++;
	return n;
};
let worst = 0;
for (let i = 0; i < cases.length; i++) {
	const c = cases[i];
	const label = `${c.rig} :: ${c.animation ?? 'setup'} @${c.time}`;
	if (typeof refFrames[i] !== 'string') {
		console.log(`skip ${label}: reference failed (${refFrames[i]?.error})`);
		continue;
	}
	if (typeof rigFrames[i] !== 'string') {
		failures++;
		console.log(`✗ ${label}: ${rigFrames[i]?.error}`);
		continue;
	}
	const a = Buffer.from(refFrames[i], 'base64');
	const b = Buffer.from(rigFrames[i], 'base64');
	if (coverage(a) === 0) empty++;
	if (args.includes('--save') && i % 9 === 0 && dumpDir) {
		const png = new PNG({ width: SIZE, height: SIZE });
		png.data = b;
		writeFileSync(join(dumpDir, `sample-${i}.rig.png`), PNG.sync.write(png));
	}
	const diff = Buffer.alloc(a.length);
	const bad = pixelmatch(a, b, diff, SIZE, SIZE, { threshold: 0.1 });
	const pct = (bad / (SIZE * SIZE)) * 100;
	worst = Math.max(worst, pct);
	compared++;
	if (pct > MAX) {
		failures++;
		console.log(`✗ ${label}: ${pct.toFixed(2)}% pixels differ`);
		if (dumpDir) {
			for (const [tag, buf] of [
				['ref', a],
				['rig', b],
				['diff', diff],
			]) {
				const png = new PNG({ width: SIZE, height: SIZE });
				png.data = buf;
				writeFileSync(
					join(dumpDir, `${label.replace(/[^a-z0-9]+/gi, '_')}.${tag}.png`),
					PNG.sync.write(png),
				);
			}
		}
	}
}
console.log(
	`${failures ? '✗' : '✓'} rig render parity: ${rigs.length} rigs, ${compared} frames (${empty} empty in the reference), ${failures} over ${MAX}% (worst ${worst.toFixed(2)}%)`,
);
process.exit(failures ? 1 : 0);
