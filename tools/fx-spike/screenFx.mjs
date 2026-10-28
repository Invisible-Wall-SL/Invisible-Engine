#!/usr/bin/env node
/**
 * SCREEN FX — screen transitions (`pixi-svelte/screenFx`, Invisible Shader Graph step 8e.2) and the
 * stage filter owner they share with the camera (check:all runs it as
 * `pnpm --filter fx-spike screen-fx`).
 *
 * `screenFx.entry.ts` plays transitions in headless Chromium on WebGL1 and WebGL2, on an app with the
 * game's renderer settings and two opaque screens striped a pixel wide, every frame read back:
 *  - ROUTING: built-in and custom exits that do not read the Screens node take the Out route, every
 *    other graph the In route, a kind that cannot play the fallback;
 *  - IN: an Output alone draws the live stage pixel for pixel (the old screen on the capture frame,
 *    the new after); Screens → From draws the old screen pixel for pixel, the still at its real
 *    size, at resolution 1, 1.5 (fractional pixels) and 2, and under pooled textures larger than
 *    the frame; a crossfade at 0.5 is the mean within 2 steps; no frame of a played crossfade is
 *    darker than both screens; Reverse reaches the graph;
 *  - OUT: at t = 0 the still draws the old screen pixel for pixel; every built-in exit kind and a
 *    custom exit ends exactly on the new screen;
 *  - FALLBACK: a kind not registered, a built-in that is not an exit, a program that does not link
 *    and a body the shell refuses play a fade out on the still, each said once; a capture that fails
 *    is a cut;
 *  - LIFECYCLE: a second transition ends the first at its end state, a resize ends one, dispose
 *    leaves no child, filter, area or ticker callback; the turbo clock and the 50 ms – 5 s clamp; a
 *    Show made after the call and before the next frame is in the still; the stage's own filters
 *    kept in front and given back exactly, the slots in order;
 *  - the still capped at 4096 px a side;
 *  - STEADY: TRANSITIONS transitions after a warm-up leave the live GL objects unchanged and make no
 *    program.
 *
 *   pnpm --filter fx-spike screen-fx [--transitions 2000] [--gl 1|2]
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const DRAW_MS = 600_000;
const FAILED = /^\[(error|assert|uncaught)\]/;

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const transitions = Number(arg('transitions') ?? 2000);
const only = arg('gl') && Number(arg('gl'));

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'screen-fx-'));
const failed = [];
let held = 0;
let browser;
try {
	await writePage(REPO, dir, 'screenFx.entry.ts', 'screens');
	browser = await launchChrome({ name: 'screen-fx' });
	for (const gl of only ? [only] : [1, 2]) {
		const search = `?gl=${gl}&transitions=${transitions}`;
		const logged = browser.pageLog.length;
		const failures = () => browser.pageLog.slice(logged).filter((line) => FAILED.test(line));
		await browser.send('Page.navigate', {
			url: `${pathToFileURL(join(dir, 'screens.html')).href}${search}`,
		});
		const start = Date.now();
		for (;;) {
			const ready = await browser
				.evaluate(`location.search === ${JSON.stringify(search)} && window.ready === true`)
				.catch(() => false);
			if (ready) break;
			if (failures().some((line) => line.startsWith('[uncaught]'))) break;
			if (Date.now() - start > DRAW_MS) {
				failed.push(`WebGL${gl}: not done in ${DRAW_MS / 1000} s`);
				break;
			}
			await new Promise((wake) => setTimeout(wake, 200));
		}
		for (const line of failures()) failed.push(`WebGL${gl}: ${line.replaceAll('\0', '').trim()}`);
		const raw = await browser.evaluate('JSON.stringify(window.result ?? null)').catch(() => null);
		const result = raw && raw !== 'null' ? JSON.parse(raw) : undefined;
		if (!result) {
			failed.push(`WebGL${gl}: no result`);
			continue;
		}
		console.log(`\nWebGL${gl}`);
		for (const [label, ok] of result.claims) {
			console.log(`  ${ok ? '✓' : '✗'} ${label}`);
			if (ok) held++;
		}
		for (const note of result.notes) console.log(`  · ${note}`);
		if (result.claims.length < 40) failed.push(`WebGL${gl}: only ${result.claims.length} claims`);
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

if (failed.length) {
	console.error(`\nscreen-fx: ${failed.length} failure(s):\n${failed.join('\n')}`);
	process.exit(1);
}
console.log(
	`\nscreen-fx: ${held} claims hold on ${only ? `WebGL${only}` : 'WebGL1 and WebGL2'} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
