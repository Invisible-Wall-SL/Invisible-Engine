// What a rig really costs the game's Pixi `RigView` to draw, against what Invisible Characters
// says it costs (`apps/launcher-api/src/lib/characters/rigCost.ts`).
//
//   node tools/rigger-spike/rig-draw-calls-browser.mjs
//
// In a REAL Chromium (software rasteriser), each rig below is loaded through `engine-rig/pixi` and
// drawn alone on a Pixi stage in its setup pose and in 17 poses of every animation: the WebGL draw
// calls of each render are counted on the context itself and compared, pose for pose, with
// `rigPoseCost` of the same skeleton (equal, but under a clipping mask, where a slot the mask hides
// whole is counted and not drawn). Then the rig's stated cost (`rigCostOfData`, read with no
// atlas, as the launcher's server reads it) is compared with the dearest pose measured. The three
// first rigs are the ones the C6a cost was measured on (docs/status/game-families.md).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const LAUNCHER = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));

const RIGS = [
	['symbols', 'h3.json', 'symbols.atlas'],
	['loader', 'loader.json', 'loader.atlas'],
	['reelhouse', 'reelhouse_glow.json', 'reelhouse_glow.atlas'],
	['symbols', 'h2.json', 'symbols.atlas'],
	['symbols3', 'W.json', 'symbols3.atlas'],
	['anticipation', 'anticipation.json', 'anticipation.atlas'],
];

const entry = `
import * as RIG from 'engine-rig/pixi';
import { Application, ImageSource } from 'pixi.js';
import { rigCostOfData, rigPoseCost, readRigJson } from './src/lib/characters/rigCost.ts';

const POSES = 16;
window.measure = async (dir, skeletonFile, atlasFile) => {
	const base = '/rigs/' + dir + '/';
	const atlas = new RIG.TextureAtlas(await (await fetch(base + atlasFile)).text());
	for (const page of atlas.pages) {
		const bitmap = await createImageBitmap(await (await fetch(base + page.name)).blob());
		page.setTexture(RIG.RigPageTexture.from(new ImageSource({ resource: bitmap })));
	}
	const json = await (await fetch(base + skeletonFile)).text();
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(json);

	const app = new Application();
	await app.init({ width: 512, height: 512, preference: 'webgl', autoStart: false });
	document.body.appendChild(app.canvas);
	const gl = app.renderer.gl;
	let calls = 0;
	for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
		const real = gl[name].bind(gl);
		gl[name] = (...args) => { calls += 1; return real(...args); };
	}
	const render = () => { calls = 0; app.render(); return calls; };
	const empty = render();

	const view = new RIG.RigView({ skeletonData: data, autoUpdate: false });
	view.position.set(256, 256);
	view.scale.set(0.25);
	app.stage.addChild(view);

	const poses = [];
	const pose = (animation, at) => {
		const measured = render() - empty;
		const stated = rigPoseCost(view.skeleton);
		const clipping = view.skeleton.drawOrder.some((slot) => slot.getAttachment() instanceof RIG.ClippingAttachment);
		poses.push({ animation, at, measured, stated: stated.drawCalls, slots: stated.drawnSlots, dark: stated.darkTintSlots, clipping });
	};
	view.update(0);
	pose('(setup)', 0);
	for (const animation of data.animations) {
		for (let i = 0; i <= POSES; i += 1) {
			view.skeleton.setToSetupPose();
			view.state.clearTracks();
			view.state.setAnimation(0, animation.name, false);
			const at = (animation.duration * i) / POSES;
			view.update(at);
			pose(animation.name, at);
			if (animation.duration === 0) break;
		}
	}
	const out = {
		bones: data.bones.length,
		empty,
		poses,
		ofLoaded: rigCostOfData(data),
		ofJson: rigCostOfData(readRigJson(json)),
	};
	app.destroy(true, { children: true });
	return out;
};
window.ready = true;
`;

const esbuild = await import(ESBUILD);
const built = await esbuild.build({
	stdin: { contents: entry, resolveDir: LAUNCHER, loader: 'ts' },
	bundle: true,
	format: 'iife',
	platform: 'browser',
	write: false,
	logLevel: 'error',
});
const bundle = built.outputFiles[0].text;

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain' };
const server = createServer((req, res) => {
	const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
	if (p === '/') return send(200, 'text/html', '<!doctype html><body><script src="/bundle.js"></script></body>');
	if (p === '/bundle.js') return send(200, 'text/javascript', bundle);
	const file = join(RIG_ASSETS, p.replace(/^\/rigs\//, ''));
	if (p.startsWith('/rigs/') && file.startsWith(RIG_ASSETS) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
	return send(404, 'text/plain', 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await launchChrome({ name: 'rig-draw-calls', url: `http://127.0.0.1:${server.address().port}/`, cdpTimeoutMs: 120_000 });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`); } return cond; };
try {
	await browser.waitFor('window.ready === true');
	for (const [dir, skeleton, atlas] of RIGS) {
		const r = await browser.evaluate(`window.measure(${JSON.stringify(dir)}, ${JSON.stringify(skeleton)}, ${JSON.stringify(atlas)})`);
		const off = r.poses.filter((p) => p.measured !== p.stated);
		const drawn = r.poses.filter((p) => p.animation !== '(setup)');
		const most = Math.max(...r.poses.map((p) => p.measured));
		const mean = drawn.reduce((sum, p) => sum + p.measured, 0) / Math.max(1, drawn.length);
		const setup = r.poses[0];
		console.log(`\n${dir}/${skeleton} — ${r.bones} bones, ${r.poses.length} poses; an empty stage is ${r.empty} draw call(s)`);
		console.log(`  measured: setup ${setup.measured}, mean of the animations' poses ${mean.toFixed(1)}, most ${most}`);
		console.log(`  stated:   ${JSON.stringify(r.ofJson)}`);
		const unclipped = off.filter((p) => !p.clipping);
		const under = off.filter((p) => p.measured > p.stated);
		ok('every pose with no clipping mask: the draw calls counted on the context are the ones stated', unclipped.length === 0, `${unclipped.length} of ${r.poses.length} differ, e.g. ${JSON.stringify(unclipped.slice(0, 3))}`);
		ok('a pose with a clipping mask is never drawn in more than stated (a slot the mask hides whole is still counted)', under.length === 0, JSON.stringify(under.slice(0, 3)));
		if (off.length) console.log(`  (${off.length} masked poses are drawn in fewer: by ${Math.max(...off.map((p) => p.stated - p.measured))} at most)`);
		ok('the rig\'s stated cost is its dearest pose measured', r.ofJson.drawCalls === most, `${r.ofJson.drawCalls} against ${most}`);
		ok('read with no atlas it says the same as loaded', JSON.stringify(r.ofJson) === JSON.stringify(r.ofLoaded), JSON.stringify(r.ofLoaded));
	}
	const thrown = browser.pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page throws nothing', thrown.length === 0, thrown.slice(0, 3).join(' | '));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}\n${browser.pageLog.slice(-5).join('\n')}`);
} finally {
	await browser.close();
	server.close();
}
console.log(`\n${fail ? '✗ FAIL' : '✅ PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
