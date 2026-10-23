#!/usr/bin/env node
/**
 * SHADER COMPILE — every Element FX shader compiles and draws on WebGL1 and WebGL2 (check:all runs
 * it as `pnpm --filter fx-spike shader-compile`).
 *
 * Draws every sheet `shaderParity.mjs` shoots (every built-in kind, every starting side, every
 * signed param at its minimum, the reference shader graphs, and every node at every vector width)
 * through the real `ElementFxFilter` in headless Chromium, and fails on any error the page logs or
 * throws: a shader the driver rejects shows there as Pixi's "Could not initialize shader". The
 * headless fixtures cannot see that: they lint GLSL as text, not as a driver compiles it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writeSheets } from './shaderPages.mjs';

const DRAW_MS = 120_000;
const FAILED = /^\[(error|assert|uncaught)\]/;

const dir = mkdtempSync(join(tmpdir(), 'shader-compile-'));
const errors = [];
let drawn = 0;
let browser;
try {
	const { sheets } = await writeSheets(REPO, dir);
	browser = await launchChrome({ name: 'shader-compile' });
	for (const gl of [1, 2]) {
		for (const sheet of sheets) {
			const label = `WebGL${gl} ${sheet.name}`;
			const search = `?gl=${gl}&${sheet.query}`;
			const logged = browser.pageLog.length;
			const failures = () => browser.pageLog.slice(logged).filter((line) => FAILED.test(line));
			await browser.send('Page.navigate', {
				url: `${pathToFileURL(join(dir, `${sheet.page}.html`)).href}${search}`,
			});
			const began = Date.now();
			for (;;) {
				const ready = await browser
					.evaluate(`location.search === ${JSON.stringify(search)} && window.ready === true`)
					.catch(() => false);
				if (ready) break;
				if (failures().some((line) => line.startsWith('[uncaught]'))) break;
				if (Date.now() - began > DRAW_MS) {
					errors.push(`${label}: not drawn in ${DRAW_MS / 1000} s`);
					break;
				}
				await new Promise((wake) => setTimeout(wake, 100));
			}
			for (const line of failures()) errors.push(`${label}: ${line.replaceAll('\0', '').trim()}`);
			drawn++;
		}
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}
if (errors.length) {
	console.error(`shader-compile: ${errors.length} error(s):\n${errors.join('\n')}`);
	process.exit(1);
}
console.log(`shader-compile: ${drawn} sheets drawn on WebGL1 and WebGL2, no shader error`);
