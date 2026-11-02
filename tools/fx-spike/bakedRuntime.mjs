#!/usr/bin/env node
/**
 * BAKED RUNTIME — the game side of a baked effect (`invisible-fx.md` §"Baked effects"), in headless
 * Chromium: `bakedRuntime/entry.ts` mounts the real `<EffectPlayer>` eleven times in a real WebGL
 * app and steps it through the app ticker:
 *  - no bake ⇒ the live emitters (particles on the stage);
 *  - bake on + every frame loaded ⇒ one sprite, no particles, on the captured box, additive;
 *  - each copy starts on the frame `effectBakeStartFrame` names for its key and position, two copies
 *    on different frames, and the loop advances at the bake's fps on the app clock;
 *  - a sheet not loaded, a bake turned off, a trail owner, live parameter values ⇒ live;
 *  - a rig beat (`<RiggedEffect>`'s mount) on a baked effect ⇒ the loop, from its deterministic
 *    frame, fading in, at the beat's emit speed, fading out over the longest particle life once
 *    `emitFor` runs out or the beat is released, then not drawn; the next beat starts it again;
 *    and it draws no random numbers.
 *
 *   pnpm --filter fx-spike baked-runtime
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { buildLauncherPage } from './launcherPage.mjs';

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'baked-runtime-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
let results = [];
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'bakedRuntime/entry.ts',
		name: 'baked-runtime',
		outDir: join(dir, 'out'),
	});
	browser = await launchChrome({ name: 'baked-runtime', logAll: true });
	await browser.send('Page.navigate', { url: pathToFileURL(html).href });
	const until = Date.now() + 60_000;
	while (!(await browser.evaluate('window.ready === true').catch(() => false))) {
		if (Date.now() > until) throw new Error('timed out waiting for the page');
		await sleep(100);
	}
	results = JSON.parse(await browser.evaluate('JSON.stringify(window.result)'));
	for (const [name, ok, detail] of results)
		console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
	const errors = browser.pageLog.filter((l) => /^\[(error|uncaught)\]/.test(l));
	if (errors.length) {
		failed = true;
		console.error(errors.slice(0, 5).join('\n'));
	}
} catch (error) {
	failed = true;
	console.error(error);
	if (browser) console.error(browser.pageLog.slice(-20).join('\n'));
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}
const bad = results.filter(([, ok]) => !ok);
if (failed || bad.length || !results.length) {
	console.error(`baked runtime: ${bad.length} of ${results.length} checks failed`);
	process.exit(1);
}
console.log(
	`baked runtime: live by default, baked when on and loaded, desynced, on rig beats, live otherwise — ${results.length}/${results.length} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
