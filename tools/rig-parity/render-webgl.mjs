// Render parity for the static tools' runtime: draws rigs with the reference WebGL runtime and with engine-rig/webgl (as the `spine` global) in
// headless Chromium through each one's SceneRenderer, and pixel-diffs the frames — plain, and with
// the mesh debug overlay the Rigger draws.
//
//   node tools/rig-parity/render-webgl.mjs [--filter <substring>] [--dir <folder>] [--size 256] [--max 0.5]
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
const esbuild = await import(ESBUILD);
const work = mkdtempSync(join(tmpdir(), 'rig-render-webgl-'));
await esbuild.build({
	entryPoints: [join(ROOT, 'packages/engine-rig/webgl.ts')],
	bundle: true,
	format: 'iife',
	globalName: 'spine',
	platform: 'browser',
	outfile: join(work, 'rig.js'),
	logLevel: 'error',
});
writeFileSync(join(work, 'ref.js'), readFileSync((await reference()).webglScript));
for (const name of ['ref', 'rig'])
	writeFileSync(
		join(work, `${name}.html`),
		`<!doctype html><body style="margin:0"><script src="/__work/${name}.js"></script><script src="/__work/page.js"></script></body>`,
	);
writeFileSync(
	join(work, 'page.js'),
	readFileSync(join(ROOT, 'tools/rig-parity/render/webglPage.js')),
);

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
	if (!existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
}).listen(0);
const port = server.address().port;

const hideBlend = arg('--hide-blend', null);
const cases = poseCases(findRigs(dir, filter))
	.flatMap((c) => [c, { ...c, debug: true }])
	.map((c) => (hideBlend === null ? c : { ...c, hideBlend: Number(hideBlend) }));
if (!cases.length) {
	console.log('no rigs found');
	process.exit(1);
}
const browser = await launchChrome({
	name: 'rig-render-webgl',
	url: 'about:blank',
	args: [`--window-size=${SIZE + 50},${SIZE + 50}`],
});
async function renderAll(name) {
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
const ref = await renderAll('ref');
const rig = await renderAll('rig');
await browser.close();
server.close();

let failures = 0;
let compared = 0;
let worst = 0;
for (let i = 0; i < cases.length; i++) {
	const c = cases[i];
	const label = `${c.rig} :: ${c.animation ?? 'setup'} @${c.time}${c.debug ? ' +debug' : ''}`;
	if (typeof ref[i] !== 'string') {
		console.log(`skip ${label}: reference failed (${String(ref[i]?.error).split('\n')[0]})`);
		continue;
	}
	if (typeof rig[i] !== 'string') {
		failures++;
		console.log(`✗ ${label}: ${rig[i]?.error}`);
		continue;
	}
	const a = Buffer.from(ref[i], 'base64');
	const b = Buffer.from(rig[i], 'base64');
	const diff = Buffer.alloc(a.length);
	const bad = pixelmatch(a, b, diff, SIZE, SIZE, { threshold: 0.1 });
	const pct = (bad / (SIZE * SIZE)) * 100;
	worst = Math.max(worst, pct);
	compared++;
	if (pct > MAX) {
		failures++;
		console.log(`✗ ${label}: ${pct.toFixed(2)}% pixels differ`);
		if (dumpDir) {
			const { PNG } = await import('pngjs');
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
	`${failures ? '✗' : '✓'} rig WebGL render parity: ${compared} frames, ${failures} over ${MAX}% (worst ${worst.toFixed(2)}%)`,
);
process.exit(failures ? 1 : 0);
