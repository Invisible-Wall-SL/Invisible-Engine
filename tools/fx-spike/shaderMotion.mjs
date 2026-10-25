#!/usr/bin/env node
/**
 * SHADER MOTION — every node the motion graph runs on the CPU computes what its GLSL computes
 * (check:all runs it as `pnpm --filter fx-spike shader-motion`; Invisible Shader Graph step 8a).
 *
 * `shaderMotion.entry.ts` draws each motion node's GLSL in headless Chromium on WebGL1 and WebGL2,
 * over 2048 samples of its inputs and at two frames of a play, and runs the same node as a motion
 * program (`runMotionProgram`) on the same inputs; each sample must agree within the node's
 * tolerance (float32 arithmetic, and the GPU's sin, cos and pow for the nodes that call them). The
 * three nodes built on `efxHash1` are held to a hash's promise instead: every value within 0…1, the
 * two means within MEAN_GAP and their shares below each tenth within SPREAD_GAP. A node the motion
 * graph gains is compared from the start (one without a case fails).
 *
 *   pnpm --filter fx-spike shader-motion [--only bell,hold]
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writePage } from './shaderPages.mjs';

/** How far apart a hashed node's GPU and CPU means, and shares below each tenth, may be. */
const MEAN_GAP = 0.04;
const SPREAD_GAP = 0.08;
const DRAW_MS = 120_000;
const FAILED = /^\[(error|assert|uncaught)\]/;

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg('only');

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'shader-motion-'));
const errors = [];
const runs = {};
let browser;
try {
	await writePage(REPO, dir, 'shaderMotion.entry.ts', 'motion');
	browser = await launchChrome({ name: 'shader-motion' });
	for (const gl of [1, 2]) {
		const search = `?gl=${gl}${only ? `&nodes=${only}` : ''}`;
		const logged = browser.pageLog.length;
		const failures = () => browser.pageLog.slice(logged).filter((line) => FAILED.test(line));
		await browser.send('Page.navigate', {
			url: `${pathToFileURL(join(dir, 'motion.html')).href}${search}`,
		});
		const start = Date.now();
		for (;;) {
			const ready = await browser
				.evaluate(`location.search === ${JSON.stringify(search)} && window.ready === true`)
				.catch(() => false);
			if (ready) break;
			if (failures().some((line) => line.startsWith('[uncaught]'))) break;
			if (Date.now() - start > DRAW_MS) {
				errors.push(`WebGL${gl}: not drawn in ${DRAW_MS / 1000} s`);
				break;
			}
			await new Promise((wake) => setTimeout(wake, 200));
		}
		for (const line of failures()) errors.push(`WebGL${gl}: ${line.replaceAll('\0', '').trim()}`);
		const result = await browser
			.evaluate('JSON.stringify(window.result ?? null)')
			.catch(() => null);
		if (result && result !== 'null') runs[gl] = JSON.parse(result);
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

const failed = [...errors];
const fmt = (v) => (Math.abs(v) >= 1e-3 || v === 0 ? v.toFixed(4) : v.toExponential(2));
const rows = new Map();
for (const gl of [1, 2]) {
	const run = runs[gl];
	if (!run) {
		failed.push(`WebGL${gl}: nothing compared`);
		continue;
	}
	if (!only) {
		const compared = new Set(run.cases.map((c) => c.label.split(/[ .]/)[0]));
		for (const node of run.nodes)
			if (!compared.has(node)) failed.push(`WebGL${gl}: ${node} has no case`);
	}
	for (const c of run.cases) {
		const row = rows.get(c.label) ?? { label: c.label, gl: {} };
		let worst = '';
		let ratio = 0;
		for (const o of c.outcomes) {
			const at = `${o.frame.looping ? 'looping' : 'counted'} t=${o.frame.t}`;
			if (c.hashed) {
				const gap = Math.abs(o.hashed.meanGpu - o.hashed.meanJs);
				if (!o.hashed.inUnit || gap > MEAN_GAP || o.hashed.spread > SPREAD_GAP)
					failed.push(
						`${c.label}: WebGL${gl}, ${at}: ${o.hashed.inUnit ? '' : 'a value outside 0…1, '}means ${fmt(o.hashed.meanGpu)} on the GPU and ${fmt(o.hashed.meanJs)} here, shares below a tenth up to ${fmt(o.hashed.spread)} apart`,
					);
				worst = `hash: means ${fmt(o.hashed.meanGpu)} / ${fmt(o.hashed.meanJs)}, tenths ${fmt(o.hashed.spread)}`;
				continue;
			}
			const r = o.worst.off / o.worst.tol;
			if (r >= ratio) {
				ratio = r;
				worst = `${fmt(o.worst.off)} of ${fmt(o.worst.tol)}`;
			}
			if (o.failures)
				failed.push(
					`${c.label}: WebGL${gl}, ${at}: ${o.failures} of ${run.samples} samples off, the worst ${fmt(o.worst.gpu)} on the GPU and ${fmt(o.worst.js)} here (inputs ${o.worst.inputs.map(fmt).join(', ')}; tolerance ${fmt(o.worst.tol)})`,
				);
		}
		const edges = c.outcomes.flatMap((o) => o.edge ?? []);
		if (edges.length)
			worst += `; at 0 ÷ 0 (left out): the GPU ${[...new Set(edges.map((e) => fmt(e.gpu)))].join('/')}, here ${[...new Set(edges.map((e) => fmt(e.js)))].join('/')}`;
		row.gl[gl] = worst;
		rows.set(c.label, row);
	}
}
console.log('\nnode output           WebGL1: worst off of its tolerance     WebGL2');
for (const row of rows.values())
	console.log(`${row.label.padEnd(21)} ${(row.gl[1] ?? '—').padEnd(37)} ${row.gl[2] ?? '—'}`);
const seconds = ((Date.now() - began) / 1000).toFixed(1);
if (failed.length) {
	console.error(`\nshader-motion: ${failed.length} failure(s):\n${failed.join('\n')}`);
	process.exit(1);
}
console.log(
	`\nshader-motion: ${rows.size} motion node outputs compute on the CPU what their GLSL draws on WebGL1 and WebGL2 (${runs[1]?.samples} samples each, two frames; ${seconds} s)`,
);
