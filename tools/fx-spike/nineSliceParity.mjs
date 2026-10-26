#!/usr/bin/env node
/**
 * NINE-SLICE PARITY — the editor canvas draws a 9-slice where the game does (P10.9 N-slice;
 * check:all runs it as `pnpm --filter fx-spike nine-slice-parity`).
 *
 * `nineSliceParity.entry.ts` draws one art three ways packed (plain, rotated 90° clockwise,
 * trimmed out of a margin), in both modes, into four boxes (its own size, larger, wider, and
 * smaller than two corners so the corners shrink), through the game's views from a real
 * `PIXI.Spritesheet` frame and through the editor's `drawNineSlice`, and compares the two pixel by
 * pixel with nearest sampling. A case fails when more than SHARE of its drawn pixels differ by more
 * than 2 steps: rasterising a fractional piece edge may put a pixel on either side, a misplaced
 * piece moves whole rows.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const SHARE = 0.02;
const DRAW_MS = 60_000;

const dir = mkdtempSync(join(tmpdir(), 'nine-slice-parity-'));
const failed = [];
let results = [];
let browser;
try {
	await writePage(REPO, dir, 'nineSliceParity.entry.ts', 'slice');
	browser = await launchChrome({ name: 'nine-slice-parity' });
	await browser.send('Page.navigate', { url: pathToFileURL(join(dir, 'slice.html')).href });
	const start = Date.now();
	for (;;) {
		if (await browser.evaluate('window.ready === true').catch(() => false)) break;
		const uncaught = browser.pageLog.find((line) => line.startsWith('[uncaught]'));
		if (uncaught) {
			failed.push(uncaught);
			break;
		}
		if (Date.now() - start > DRAW_MS) {
			failed.push(`not drawn in ${DRAW_MS / 1000} s`);
			break;
		}
		await new Promise((wake) => setTimeout(wake, 200));
	}
	results = JSON.parse(
		(await browser.evaluate('JSON.stringify(window.result ?? [])').catch(() => '[]')) || '[]',
	);
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

if (!results.length && !failed.length) failed.push('no case was compared');
for (const r of results) {
	const share = r.drawn ? r.differing / r.drawn : 1;
	const line = `${share <= SHARE ? 'ok  ' : 'FAIL'} ${r.label}: ${r.differing}/${r.drawn} differ`;
	console.log(line);
	if (share > SHARE) failed.push(line);
}
if (failed.length) {
	console.error(`\n✗ nine-slice parity: ${failed.length} failed\n${failed.join('\n')}`);
	process.exit(1);
}
console.log(`\n✓ nine-slice parity: ${results.length} cases, editor = game`);
