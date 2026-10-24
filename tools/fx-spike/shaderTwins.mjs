#!/usr/bin/env node
/**
 * SHADER TWINS — every graph twin of a built-in Element FX draws what its built-in draws (check:all
 * runs it as `pnpm --filter fx-spike shader-twins`; Invisible Shader Graph step 6).
 *
 * For every `BUILTIN_TWINS` entry, `shaderTwins.entry.ts` plays the built-in kind and its compiled
 * twin (`custom:<kind>`) through the real runtime in headless Chromium, on WebGL1 and WebGL2: the
 * same card, the same params, the same seed drawn for the element, posed at the same moments (8 for
 * the defaults and for each number param at its min and its max, 2 for a pass twin's; 2 for each
 * other choice option, a switch flipped, another colour, twice the strength, and a loop on its
 * second time round). Each pair is read back and compared pixel by pixel, with both motions at rest;
 * the motions are compared as numbers.
 *
 * THE TOLERANCE. A pixel DIFFERS when one of its channels is more than THRESHOLD steps (of 255)
 * apart. A cell fails when more than SHARE of its drawn pixels differ, or when any differing pixel
 * has four differing neighbours (a PATCH). Why: the twin's GLSL is generated, the hand-written
 * pass's operations in another order, through locals, with an unpremultiply and a premultiply where
 * the pass stays premultiplied. That moves a value by its float's last bits, which a channel shows
 * as a step at most (when this was written, the largest difference was 1 on every twin but three).
 * Where a hard threshold (a step, a seam, a dissolve with no edge) passes through a pixel, those bits
 * can flip it all the way; such pixels stand alone or in one-pixel lines along the threshold (then:
 * at most 0.12% of a cell, never a patch). A real look difference, a wrong constant or a param read
 * wrong, moves a region: it makes patches, however faint, or many differing pixels. Mutation-checked:
 * one wrong constant in a twin fails it, down to a 1% change in a highlight's weight; a change that
 * moves no channel by more than 2 steps passes, as it is meant to.
 *
 * Motions: the element's box corners within MOTION_PX of each other and its alpha within
 * MOTION_ALPHA, unless the twin names its motion gap (`BuiltinTwin.motionGap`: what the built-in
 * moves by that a curve cannot follow); then the gap is reported, not failed.
 *
 *   pnpm --filter fx-spike shader-twins [--only freeze,burn] [--dump <dir>]
 *
 * `--dump` writes each failing cell's two renders as PNGs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const THRESHOLD = 2;
const SHARE = 0.0025;
const MOTION_PX = 0.25;
const MOTION_ALPHA = 0.5 / 255;
const DRAW_MS = 300_000;
const FAILED = /^\[(error|assert|uncaught)\]/;

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg('only');
const dumpDir = arg('dump') && resolve(arg('dump'));

const pct = (v) => `${(100 * v).toFixed(v && v < 0.001 ? 3 : 2)}%`;

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'shader-twins-'));
const errors = [];
const runs = {};
let browser;
try {
	await writePage(REPO, dir, 'shaderTwins.entry.ts', 'twins');
	browser = await launchChrome({ name: 'shader-twins' });
	for (const gl of [1, 2]) {
		const query = [`gl=${gl}`, `threshold=${THRESHOLD}`];
		if (only) query.push(`twins=${only}`);
		if (dumpDir) query.push(`dump=${SHARE}`);
		const search = `?${query.join('&')}`;
		const logged = browser.pageLog.length;
		const failures = () => browser.pageLog.slice(logged).filter((line) => FAILED.test(line));
		await browser.send('Page.navigate', {
			url: `${pathToFileURL(join(dir, 'twins.html')).href}${search}`,
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
		if (dumpDir) {
			const dumps = JSON.parse(await browser.evaluate('JSON.stringify(window.dumps ?? [])'));
			mkdirSync(dumpDir, { recursive: true });
			for (const { label, builtIn, twin } of dumps)
				for (const [side, url] of [
					['builtin', builtIn],
					['twin', twin],
				])
					writeFileSync(
						join(dumpDir, `gl${gl}-${label.replace(/[^\w.=-]/g, '_')}-${side}.png`),
						Buffer.from(url.split(',')[1], 'base64'),
					);
		}
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

const failed = [...errors];
const kinds = [...new Set(Object.values(runs).flatMap((r) => r.twins.map((t) => t.kind)))];
if (!kinds.length) failed.push('no twin was compared');
const rows = [];
for (const kind of kinds) {
	const row = { kind, gl: {}, motion: '', ms: 0 };
	for (const gl of [1, 2]) {
		const run = runs[gl];
		const twin = run?.twins.find((t) => t.kind === kind);
		if (!twin) {
			failed.push(`${kind}: not compared on WebGL${gl}`);
			continue;
		}
		const at = run.steps.indexOf(THRESHOLD);
		const stat = { max: 0, share: 0, patch: 0, cell: undefined };
		for (const cell of twin.cells) {
			const share = cell.drawn ? cell.over[at] / cell.drawn : 0;
			const patch = cell.solid[at];
			stat.max = Math.max(stat.max, cell.max);
			stat.patch = Math.max(stat.patch, patch);
			if (share > stat.share) Object.assign(stat, { share, cell });
			if (share > SHARE || patch)
				failed.push(
					`${kind}: WebGL${gl}, ${cell.label}, at ${cell.moment}: ${pct(share)} of its ${cell.drawn} drawn pixels differ by more than ${THRESHOLD}, ${patch} in patches (largest difference ${cell.max})`,
				);
		}
		row.gl[gl] = stat;
		row.ms += twin.ms;
	}
	const twin = (runs[1] ?? runs[2])?.twins.find((t) => t.kind === kind);
	if (twin) {
		const px = Math.max(0, ...twin.motions.map((m) => m.px));
		const alpha = Math.max(0, ...twin.motions.map((m) => m.alpha));
		const off = twin.motions.find((m) => m.px > MOTION_PX || m.alpha > MOTION_ALPHA);
		const atDefaults = Math.max(
			0,
			...twin.motions.filter((m) => m.label === 'defaults').map((m) => m.px),
		);
		row.motion = `${px.toFixed(3)} px, alpha ${alpha.toFixed(4)}${off && twin.motionGap ? ` (its gap; ${atDefaults.toFixed(3)} px at the defaults)` : ''}`;
		if (off && !twin.motionGap)
			failed.push(
				`${kind}: its motion is ${off.px.toFixed(3)} px and alpha ${off.alpha.toFixed(4)} off the built-in's (${off.label}, at ${off.moment})`,
			);
	}
	rows.push(row);
}

const statOf = (s) =>
	s
		? `${String(s.max).padStart(3)} ${pct(s.share).padStart(7)}${s.cell ? ` ${s.cell.label}@${s.cell.moment}` : ''}`.padEnd(
				34,
			)
		: '—'.padEnd(34);
console.log(
	`\ntwin          WebGL1: largest, worst share > ${THRESHOLD}  WebGL2: largest, worst share > ${THRESHOLD}  motion (box corners, alpha)`,
);
for (const row of rows)
	console.log(`${row.kind.padEnd(13)} ${statOf(row.gl[1])} ${statOf(row.gl[2])} ${row.motion}`);
const seconds = ((Date.now() - began) / 1000).toFixed(1);
const pages = [1, 2]
	.map((gl) => (runs[gl] ? `WebGL${gl} ${(runs[gl].ms / 1000).toFixed(1)} s` : ''))
	.filter(Boolean)
	.join(', ');
if (failed.length) {
	console.error(`\nshader-twins: ${failed.length} failure(s):\n${failed.join('\n')}`);
	process.exit(1);
}
console.log(
	`\nshader-twins: ${kinds.length} twins draw as their built-ins on WebGL1 and WebGL2, within ${THRESHOLD} steps but for ${pct(SHARE)} of a cell's pixels and no patch (${pages}; ${seconds} s in all)`,
);
