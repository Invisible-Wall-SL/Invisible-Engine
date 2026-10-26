#!/usr/bin/env node
/**
 * PARTICLE MATERIAL — the material renderer (`pixi-svelte` `particleMaterial/`, Invisible Shader
 * Graph step 8d.2) draws a layer's particles as the plain sprites do and carries each particle's own
 * inputs (check:all runs it as `pnpm --filter fx-spike particle-material`).
 *
 * `particleMaterial.entry.ts` runs real emitters of the library through the renderer in headless
 * Chromium, on WebGL1 and WebGL2:
 *  - PARITY: an Output-alone material against the plain sprites it hides, one emitter drawn both ways
 *    in the same state, at two moments: static, rotated, trimmed and trimmed-rotated frames, a
 *    flipbook, the `fxSprite` pivot and offset, tint, the colour overlay, fade, Add, a group alpha
 *    and tint below 1, a padded material with `addAtBack`, a scaled and turned parent. Judged as the
 *    twins are (`shaderTwins.mjs`): a pixel DIFFERS when a channel is more than THRESHOLD steps out;
 *    a cell fails when more than SHARE of its drawn pixels differ, or on any PATCH (a differing pixel
 *    with four differing neighbours);
 *  - INPUTS: progress (over the life, and looped at the effect's length), seconds, strength, looping,
 *    seed and both indexes, written as colour by probe graphs and read back at each particle, within
 *    2 steps of what it carries; seeds whole and spread, the indexes as `fxMaterial` specifies;
 *  - PLAIN: no effect, a body the shell refuses, a program the driver refuses (logged once), Max
 *    particles over the cap or driven past the layer's, frames on two textures: each layer plain, its
 *    sprites shown and drawn, no mesh;
 *  - STEADY: FRAMES frames after a warm-up allocate no GPU buffer and keep the mirror's arrays;
 *  - the CPU time to mirror 512 particles, logged.
 *
 *   pnpm --filter fx-spike particle-material [--frames 20000] [--dump <dir>]
 *
 * `--dump` writes the parity canvases, each moment through the material and plain, as PNGs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const THRESHOLD = 2;
const SHARE = 0.0025;
/**
 * The share for a case whose quads are not the sprites': a trimmed frame (the sprite's quad is its
 * trimmed box, the material's the whole frame) or a padded material. Their outlines are drawn from
 * different corners, which SwiftShader snaps to 1/16 of a pixel, so along a trimmed edge a pixel
 * centre can fall inside one and outside the other: one-pixel lines, never a patch, about 0.2–0.45%
 * of the drawn pixels with these particles' sizes.
 */
const EDGE_SHARE = 0.01;
const DRAW_MS = 240_000;
const FAILED = /^\[(error|assert|uncaught)\]/;

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const frames = Number(arg('frames') ?? 20000);
const dumpDir = arg('dump') && resolve(arg('dump'));
const pct = (v) => `${(100 * v).toFixed(v && v < 0.001 ? 3 : 2)}%`;

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'particle-material-'));
const failed = [];
const runs = {};
let browser;
try {
	await writePage(REPO, dir, 'particleMaterial.entry.ts', 'material');
	browser = await launchChrome({ name: 'particle-material' });
	for (const gl of [1, 2]) {
		const search = `?gl=${gl}&threshold=${THRESHOLD}&frames=${frames}${dumpDir ? '&dump' : ''}`;
		const logged = browser.pageLog.length;
		const failures = () => browser.pageLog.slice(logged).filter((line) => FAILED.test(line));
		await browser.send('Page.navigate', {
			url: `${pathToFileURL(join(dir, 'material.html')).href}${search}`,
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
		const result = await browser
			.evaluate('JSON.stringify(window.result ?? null)')
			.catch(() => null);
		if (result && result !== 'null') runs[gl] = JSON.parse(result);
		else failed.push(`WebGL${gl}: no result`);
		if (dumpDir && runs[gl]) {
			mkdirSync(dumpDir, { recursive: true });
			runs[gl].dumps.forEach((url, i) =>
				writeFileSync(
					join(dumpDir, `gl${gl}-${i >> 1}-${i % 2 ? 'plain' : 'material'}.png`),
					Buffer.from(url.split(',')[1], 'base64'),
				),
			);
		}
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

for (const gl of [1, 2]) {
	const run = runs[gl];
	if (!run) continue;
	console.log(`\nWebGL${gl}`);
	console.log(`  parity (largest difference, share > ${THRESHOLD}, patches; drawn px)`);
	if (!run.parity.length) failed.push(`WebGL${gl}: no parity case drawn`);
	for (const { label, moment, edges, cell } of run.parity) {
		const share = cell.over / Math.max(1, cell.drawn);
		const allowed = edges ? EDGE_SHARE : SHARE;
		console.log(
			`    ${`${label} @${moment}${edges ? ' (edges)' : ''}`.padEnd(50)} ${String(cell.max).padStart(3)} ${pct(share).padStart(7)} ${String(cell.patch).padStart(3)}  ${cell.drawn}`,
		);
		if (cell.drawn < 500)
			failed.push(`WebGL${gl}, ${label} @${moment}: only ${cell.drawn} px drawn`);
		if (share > allowed || cell.patch)
			failed.push(
				`WebGL${gl}, ${label} @${moment}: ${pct(share)} of ${cell.drawn} drawn pixels differ by more than ${THRESHOLD} (${pct(allowed)} allowed), ${cell.patch} in patches (largest ${cell.max})`,
			);
	}
	console.log('  inputs (particles, worst step off)');
	for (const [name, input] of Object.entries(run.inputs))
		console.log(`    ${name.padEnd(10)} ${input.particles} ${input.worst}`);
	console.log('  plain (why, drawn px)');
	for (const p of run.plain) console.log(`    ${p.label.padEnd(48)} ${p.reason} ${p.drawn}`);
	const s = run.steady;
	console.log(
		`  steady: ${s.frames} frames in ${(s.ms / 1000).toFixed(1)} s, ${s.peak} live at most, ${s.bufferData} bufferData, ${s.createBuffer} createBuffer, arrays kept: ${s.same}`,
	);
	console.log(`  sync: ${run.sync.particles} particles mirrored in ${run.sync.ms.toFixed(3)} ms`);
}

if (failed.length) {
	console.error(`\nparticle-material: ${failed.length} failure(s):\n${failed.join('\n')}`);
	process.exit(1);
}
console.log(
	`\nparticle-material: the material draws as the plain sprites, carries every per-particle input, falls back plain, and holds steady on WebGL1 and WebGL2 (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
