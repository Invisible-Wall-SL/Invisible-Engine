#!/usr/bin/env node
/**
 * FX PREVIEWS — a layer's MATERIAL in the launcher's other previews (Invisible Shader Graph step
 * 8d.6, `docs/design/shader-graph-particles.md` §9 "The other previews"), played headless on WebGL1
 * and WebGL2 (check:all runs it as `pnpm --filter fx-spike fx-previews`).
 *
 * The material `custom:solid` paints particles green (blue through its param); the atlas frame is
 * magenta, so a census of the stage's pixels says which renderer drew (`fxPreviews/shared.ts`).
 *
 * 1. The Rigger / Symbols overlay, as the Rigger runs it: the COMMITTED
 *    `static/rigger/vendor/rigger-fx.js` driven through `view.html`'s globals
 *    (`fxPreviews/overlay.entry.ts`):
 *    - the compiled set fetched with the session's cookies and registered: the mesh draws;
 *    - a material param set on the play changes it (a uniform);
 *    - the set's fetch failing (an HTTP error, a network error): the layer draws plain;
 *    - a kind the set lacks (a doc from a newer launcher): plain; a layer with no material: plain;
 *    - a ninth material layer on one overlay: plain, "over the game cap".
 * 2. The Scene Editor's `EditorEffectLayer`, mounted alone through the editor's shared renderer
 *    (`fxPreviews/editor.entry.ts`, built like `fx-page`):
 *    - before the set registers it draws plain; registering it remounts the layer through the mesh;
 *    - a placement's value for a material param changes it; an unknown kind and no material: plain.
 * Never invisible: every plain case draws its sprites.
 *
 *   pnpm --filter fx-spike fx-previews
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { buildLauncherPage } from './launcherPage.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const BUNDLE = join(REPO, 'apps/launcher-api/static/rigger/vendor/rigger-fx.js');
const RUN_MS = 120_000;
/** Pixels a drawing layer covers at the least (60 particles of 32 × 32, overlapping). */
const DRAWN = 500;
const FAILED = /^\[(error|uncaught)\]/;

const began = Date.now();
const dir = mkdtempSync(join(tmpdir(), 'fx-previews-'));
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const px = (p) => `green ${p.green}, blue ${p.blue}, magenta ${p.magenta}, drawn ${p.drawn}`;
const mesh = (p, colour = 'green') => p[colour] > DRAWN && p.magenta === 0;
const plain = (p) => p.magenta > DRAWN && p.green === 0 && p.blue === 0;
const said = (lines, text) => lines.some((l) => l.includes(text));

let browser;
try {
	await writePage(REPO, dir, 'fxPreviews/overlay.entry.ts', 'overlay');
	writeFileSync(
		join(dir, 'overlay.html'),
		readFileSync(join(dir, 'overlay.html'), 'utf8').replace(
			'</body>',
			`<script src="${pathToFileURL(BUNDLE).href}"></script></body>`,
		),
	);
	const editorHtml = await buildLauncherPage({
		entry: 'fxPreviews/editor.entry.ts',
		name: 'editor',
		outDir: join(dir, 'editor'),
	});
	console.log(`pages built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({ name: 'fx-previews', logAll: true });
	const play = async (html, gl) => {
		const logged = browser.pageLog.length;
		const search = `?gl=${gl}&fxdebug=1`;
		await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}${search}` });
		const until = Date.now() + RUN_MS;
		for (;;) {
			const ready = await browser
				.evaluate(`location.search === ${JSON.stringify(search)} && window.ready === true`)
				.catch(() => false);
			if (ready) break;
			if (Date.now() > until) throw new Error(`${html}: not done in ${RUN_MS / 1000} s`);
			await new Promise((wake) => setTimeout(wake, 100));
		}
		const errors = browser.pageLog.slice(logged).filter((l) => FAILED.test(l));
		const result = JSON.parse(await browser.evaluate('JSON.stringify(window.result ?? null)'));
		return { result, errors };
	};

	for (const gl of [1, 2]) {
		console.log(`\nWebGL${gl}: the Rigger / Symbols overlay (the committed rigger-fx.js)`);
		const { result: o, errors: oErrors } = await play(join(dir, 'overlay.html'), gl);
		check('the page ran without errors', !!o && oErrors.length === 0, oErrors.join(' | '));
		if (o) {
			check('the bundle exposes RiggerFxLoadShaderEffects', o.bundleHasLoader === true);
			check(
				'the set is fetched from GET /api/shaders/effects with the session cookies',
				o.requests.length === 3 &&
					o.requests.every((r) => r === 'same-origin /api/shaders/effects'),
				o.requests.join(', '),
			);
			check(
				'a set answering 500 registers nothing and the layer draws plain',
				o.fetchError.loaded === false &&
					plain(o.fetchError.pixels) &&
					said(o.fetchError.lines, 'solid/main: plain, not registered'),
				px(o.fetchError.pixels),
			);
			check(
				'a set fetch that fails on the network: plain',
				o.fetchThrow.loaded === false && plain(o.fetchThrow.pixels),
				px(o.fetchThrow.pixels),
			);
			check(
				'the set registered: the mesh draws, none of the sprites',
				o.registered.loaded === true &&
					mesh(o.registered.pixels) &&
					said(o.registered.lines, 'solid/main: on (custom:solid; 1/8 drawing)') &&
					said(o.registered.lines, 'solid/main: released'),
				px(o.registered.pixels),
			);
			check(
				'a material param set on the play is drawn (uniform)',
				mesh(o.param.pixels, 'blue') && o.param.pixels.green === 0,
				px(o.param.pixels),
			);
			check(
				'a kind the set lacks draws plain',
				plain(o.unknownKind.pixels) &&
					said(o.unknownKind.lines, 'gone/main: plain, not registered (custom:nosuch'),
				px(o.unknownKind.pixels),
			);
			check(
				'a layer with no material draws plain, with no material line',
				plain(o.noMaterial.pixels) && o.noMaterial.lines.length === 0,
				px(o.noMaterial.pixels),
			);
			const on = o.cap.lines.filter((l) => /: on \(custom:solid/.test(l)).length;
			const over = o.cap.lines.filter((l) => l.includes('plain, over the game cap')).length;
			check(
				'nine material layers on one overlay: 8 draw the mesh, the ninth plain',
				on === 8 && over === 1 && o.cap.pixels.magenta > 0 && o.cap.pixels.green > DRAWN,
				`${on} on, ${over} over the cap; ${px(o.cap.pixels)}`,
			);
		}

		console.log(`\nWebGL${gl}: the Scene Editor's EditorEffectLayer`);
		const { result: e, errors: eErrors } = await play(editorHtml, gl);
		check('the page ran without errors', !!e && eErrors.length === 0, eErrors.join(' | '));
		if (e) {
			check(
				'with no set registered the layer draws plain',
				plain(e.unregistered.pixels) && said(e.unregistered.lines, 'plain, not registered'),
				px(e.unregistered.pixels),
			);
			check(
				'registering the set remounts a mounted layer through the mesh',
				plain(e.registers.before) &&
					mesh(e.registers.after) &&
					said(e.registers.lines, 'solid/main: plain, not registered') &&
					said(e.registers.lines, 'solid/main: on (custom:solid'),
				`before: ${px(e.registers.before)}; after: ${px(e.registers.after)}`,
			);
			check(
				'registered: the mesh draws, none of the sprites',
				mesh(e.registered.pixels) && said(e.registered.lines, 'solid/main: released'),
				px(e.registered.pixels),
			);
			check(
				"a placement's value for a material param is drawn",
				mesh(e.param.pixels, 'blue') && e.param.pixels.green === 0,
				px(e.param.pixels),
			);
			check(
				'a kind the set lacks draws plain',
				plain(e.unknownKind.pixels) && said(e.unknownKind.lines, 'plain, not registered'),
				px(e.unknownKind.pixels),
			);
			check(
				'a layer with no material draws plain, with no material line',
				plain(e.noMaterial.pixels) && e.noMaterial.lines.length === 0,
				px(e.noMaterial.pixels),
			);
		}
	}
} finally {
	await browser?.close();
	rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
const took = ((Date.now() - began) / 1000).toFixed(1);
if (failed.length || !results.length) {
	console.error(`\nfx-previews: ${failed.length} of ${results.length} failed (${took} s)`);
	process.exit(1);
}
console.log(`\nfx-previews: ${results.length}/${results.length} (${took} s)`);
