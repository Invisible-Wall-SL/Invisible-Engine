#!/usr/bin/env node
/**
 * CAMERA EFFECTS — the flow's `cameraEffect` kinds (`pixi-svelte` `cameraEffects.ts`) draw exactly as
 * they drew before Invisible Shader Graph step 8e.2 moved the chromatic wobble onto the stage filter
 * owner (`screenFx/stageFilters.ts`). check:all runs it as `pnpm --filter fx-spike camera-effects`.
 *
 * `cameraEffects.entry.ts` plays every kind, and the kinds together (a wobble under a shake and a
 * zoom punch, a wobble ending while a shake goes on, two wobbles, all four), in headless Chromium on
 * WebGL1 and WebGL2 at resolution 1 and 2, through the live module and through the module as it was
 * (`cameraEffects.reference.ts`), each frame stepped by a fixed 32 ms. At nine moments of each case
 * the two canvases must be the same pixels, and after each the stage must be at rest (no filter, no
 * filter area, its transform back).
 *
 *   pnpm --filter fx-spike camera-effects [--shoot <file>] [--expect <file>] [--gl 1|2]
 *
 * `--shoot` writes every moment's hash; `--expect` fails on any hash that differs from such a file.
 * A move is shot on its base first (`--shoot`), then checked after (`--expect`), on one machine: the
 * hashes depend on the browser's rasteriser, so they are not committed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const DRAW_MS = 180_000;
const FAILED = /^\[(error|assert|uncaught)\]/;

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? resolve(process.argv[i + 1]) : undefined;
};
const shootTo = arg('shoot');
const expectFrom = arg('expect');
const only = process.argv.includes('--gl')
	? Number(process.argv[process.argv.indexOf('--gl') + 1])
	: undefined;

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'camera-effects-'));
const failed = [];
const shots = {};
let compared = 0;
let browser;
try {
	await writePage(REPO, dir, 'cameraEffects.entry.ts', 'camera');
	browser = await launchChrome({ name: 'camera-effects' });
	for (const gl of only ? [only] : [1, 2]) {
		const search = `?gl=${gl}`;
		const logged = browser.pageLog.length;
		const failures = () => browser.pageLog.slice(logged).filter((line) => FAILED.test(line));
		await browser.send('Page.navigate', {
			url: `${pathToFileURL(join(dir, 'camera.html')).href}${search}`,
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
		const count = Object.keys(result.shots).length;
		compared += count;
		console.log(`WebGL${gl}: ${count} moments, live against the reference`);
		for (const line of result.differ) failed.push(`WebGL${gl}, ${line}`);
		for (const name of result.unrested)
			failed.push(`WebGL${gl}, ${name}: the stage is not back at rest after it`);
		if (!count) failed.push(`WebGL${gl}: no moment drawn`);
		shots[gl] = result.shots;
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

if (shootTo) {
	writeFileSync(shootTo, `${JSON.stringify(shots, null, '\t')}\n`);
	console.log(`shot ${compared} moments to ${shootTo}`);
}
if (expectFrom) {
	const before = JSON.parse(readFileSync(expectFrom, 'utf8'));
	let same = 0;
	for (const gl of Object.keys(before)) {
		for (const [label, hash] of Object.entries(before[gl])) {
			const now = shots[gl]?.[label];
			if (now === hash) same++;
			else failed.push(`WebGL${gl}, ${label}: ${now ? 'differs from' : 'missing beside'} the shot`);
		}
	}
	console.log(`${same} moments as shot in ${expectFrom}`);
}

if (failed.length) {
	console.error(`\ncamera-effects: ${failed.length} failure(s):\n${failed.join('\n')}`);
	process.exit(1);
}
console.log(
	`\ncamera-effects: ${compared} moments of every camera kind draw as before on ${only ? `WebGL${only}` : 'WebGL1 and WebGL2'}, each stage back at rest (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
