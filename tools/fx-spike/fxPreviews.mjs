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
 *    - a ninth material layer on one overlay: plain, "over the game cap";
 *    - a one-shot burst nobody stops ends by itself and gives its slot back: nine in a row all draw
 *      the material.
 *    And `view.html`'s own `ensureFxBundle` (read out of the file, run against the bundle): two
 *    callers both wait for the set's answer (one request), and a set that never answers is given up
 *    on after about 5 s, the layer then plain.
 * 2. The Scene Editor's `EditorEffectLayer`, mounted alone through the editor's shared renderer
 *    (`fxPreviews/editor.entry.ts`, built like `fx-page`):
 *    - before the set registers it draws plain; registering it remounts the layer through the mesh;
 *    - a placement's value for a material param changes it; an unknown kind and no material: plain;
 *    - the page's 8 slots never leak: nine overlays unmounted while their art loads, nine whose
 *      emitter config throws after the material mounted, then one draws "1/8"; nine overlays at
 *      once draw 8 and one plain, and eight again after draw all 8;
 *    - the clock is the game's (`emitterDeltaSeconds`): a one-shot of 1 emitter-second is on screen
 *      within its game time (~430 ms, failing past 1.5×), not ~1000 ms, and then gone.
 * 3. `/shaders`' Particles element (step 8d.7): the real `ParticlePreviewStage`, its clock stepped by
 *    hand (`fxPreviews/shaders.entry.ts`), materials made for particles:
 *    - hidden, or with no effect, it mounts nothing and draws nothing;
 *    - the Burst: the mesh draws a ring (every 15° at its radius, nothing at the centre), its
 *      `?fxdebug=1` line on at 1/8; all gone before 2 s, and replayed after;
 *    - paused, nothing moves; Restart empties it and the ring starts again;
 *    - Strength is a uniform write (no remount), seen while paused;
 *    - the Fountain: a jet through the mesh, rising above the centre;
 *    - an atlas region as the art: the mesh draws it, not the sprite;
 *    - a kind no longer registered: plain, its sprites drawn;
 *    - hidden: released, its load printed (the effect carries its cost); shown again, 1/8: no slot
 *      leaked over every rebuild.
 * 4. `node --check` on every inline script of `view.html`.
 * Never invisible: every plain case draws its sprites.
 *
 *   pnpm --filter fx-spike fx-previews
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { buildLauncherPage } from './launcherPage.mjs';
import { REPO, writePage } from './shaderPages.mjs';

const BUNDLE = join(REPO, 'apps/launcher-api/static/rigger/vendor/rigger-fx.js');
const VIEW = join(REPO, 'apps/launcher-api/static/rigger/view.html');
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

const view = readFileSync(VIEW, 'utf8');
console.log("view.html's inline scripts");
const inline = [...view.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
inline.forEach(([, attrs, body], i) => {
	const file = join(dir, `view${i}.${attrs.includes('module') ? 'mjs' : 'js'}`);
	writeFileSync(file, body);
	const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
	check(`inline script ${i} parses (node --check)`, checked.status === 0, checked.stderr.trim());
});
check('view.html has inline scripts to check', inline.length > 0);
const ensureFxBundle = /\nfunction ensureFxBundle\(\)\{[\s\S]*?\n\}\n/.exec(view)?.[0];
check("view.html's ensureFxBundle found", !!ensureFxBundle);

let browser;
try {
	await writePage(REPO, dir, 'fxPreviews/overlay.entry.ts', 'overlay');
	const source = JSON.stringify(ensureFxBundle ?? '').replaceAll('<', '\\u003c');
	writeFileSync(
		join(dir, 'overlay.html'),
		readFileSync(join(dir, 'overlay.html'), 'utf8').replace(
			'</body>',
			`<script>window.ensureFxBundleSource = ${source};</script>` +
				`<script src="${pathToFileURL(BUNDLE).href}"></script></body>`,
		),
	);
	const editorHtml = await buildLauncherPage({
		entry: 'fxPreviews/editor.entry.ts',
		name: 'editor',
		outDir: join(dir, 'editor'),
	});
	const shadersHtml = await buildLauncherPage({
		entry: 'fxPreviews/shaders.entry.ts',
		name: 'shaders',
		outDir: join(dir, 'shaders'),
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
				o.requests.length === 5 &&
					o.requests.every((r) => r === 'same-origin /api/shaders/effects'),
				o.requests.join(', '),
			);
			check(
				'view.html: a set that never answers is given up on in about 5 s; the layer draws plain',
				o.hang.ms >= 4500 && o.hang.ms < 8000 && plain(o.hang.pixels),
				`${Math.round(o.hang.ms)} ms; ${px(o.hang.pixels)}`,
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
				"view.html: two callers of ensureFxBundle both wait for the set's answer (one request), then the mesh draws",
				o.race.beforeAnswer === 0 &&
					o.race.resolvedAfter.length === 2 &&
					o.race.requests === 1 &&
					o.race.answeredAfter >= o.race.slowMs &&
					mesh(o.race.pixels),
				`answered after ${Math.round(o.race.answeredAfter)} ms, resolved after ${o.race.resolvedAfter.map(Math.round).join(' / ')} ms; ${px(o.race.pixels)}`,
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
			const shots = o.oneShots.lines;
			const shotsOn = shots.filter((l) =>
				/burst\/main: on \(custom:solid; 1\/8 drawing\)/.test(l),
			).length;
			const shotsReleased = shots.filter((l) => l.includes('burst/main: released')).length;
			check(
				'nine one-shot bursts never stopped: each ends by itself, and all nine draw the material',
				shotsOn === 9 &&
					shotsReleased === 9 &&
					!said(shots, 'over the game cap') &&
					mesh(o.oneShots.last),
				`${shotsOn} on at 1/8, ${shotsReleased} released; the ninth: ${px(o.oneShots.last)}`,
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
			check(
				'nine overlays unmounted while their art loads hold no slot: the next draws 1/8',
				!said(e.midLoad.lines, ': on (') &&
					said(e.midLoad.after.lines, 'solid/main: on (custom:solid; 1/8 drawing)') &&
					mesh(e.midLoad.after.pixels),
				`${e.midLoad.lines.length} lines while unmounting; then ${e.midLoad.after.lines[0] ?? 'nothing'}`,
			);
			const thrown = e.throws.lines;
			check(
				'nine layers whose emitter config throws after mounting give their slots back: the next draws 1/8',
				thrown.filter((l) => l.includes('throws/main: on (')).length === 9 &&
					thrown.filter((l) => l.includes('throws/main: released')).length === 9 &&
					said(e.throws.after.lines, 'solid/main: on (custom:solid; 1/8 drawing)'),
				`then ${e.throws.after.lines[0] ?? 'nothing'}`,
			);
			const count = (lines, re) => lines.filter((l) => re.test(l)).length;
			const nineOn = count(e.instances.nine, /solid\/main: on \(/);
			const nineOver = count(e.instances.nine, /over the game cap/);
			const eightOn = count(e.instances.eight, /solid\/main: on \(/);
			check(
				'nine overlays at once: 8 draw the material, the ninth plain; eight again after: all 8',
				nineOn === 8 &&
					nineOver === 1 &&
					eightOn === 8 &&
					!said(e.instances.eight, 'over the game cap'),
				`${nineOn} on + ${nineOver} over the cap, then ${eightOn} on`,
			);
			const c = e.clock;
			const shown = c.lastMs - c.firstMs;
			check(
				"the effect clock is the game's: a one-shot is gone in its game wall time, not its emitter seconds",
				c.firstMs >= 0 &&
					c.peak > DRAWN &&
					shown <= c.expectedMs * 1.5 &&
					shown < c.emitterSeconds * 1000 * 0.75 &&
					c.end.drawn === 0,
				`on screen ${Math.round(shown)} ms (game ${Math.round(c.expectedMs)} ms, wall-clock seconds ${c.emitterSeconds * 1000} ms); peak ${c.peak}; at the end ${px(c.end)}`,
			);
		}

		console.log(`\nWebGL${gl}: /shaders' Particles element`);
		const { result: s, errors: sErrors } = await play(shadersHtml, gl);
		check('the page ran without errors', !!s && sErrors.length === 0, sErrors.join(' | '));
		if (s) {
			check(`drawn on WebGL${gl}`, s.gl === gl, `WebGL${s.gl}`);
			check(
				'hidden, or with no effect, it mounts nothing and draws nothing',
				s.hidden.pixels.drawn === 0 &&
					s.hidden.lines.length === 0 &&
					s.hidden.state === 'none' &&
					s.noEffect.pixels.drawn === 0 &&
					s.noEffect.state === 'none',
				`${px(s.hidden.pixels)}; ${s.hidden.lines.length} lines`,
			);
			const green = (p) => p[1] > 150 && p[0] < 90 && p[2] < 90 && p[3] > 128;
			const ringed = s.burst.ring.filter(green).length;
			check(
				'the Burst draws a ring through the mesh: every 15° at its radius, nothing at the centre',
				s.burst.state === 'on' &&
					mesh(s.burst.pixels) &&
					ringed === 24 &&
					s.burst.centre[3] < 128 &&
					said(s.burst.lines, 'shaders/preview: on (custom:solid; 1/8 drawing)'),
				`${ringed}/24 on the ring, centre alpha ${s.burst.centre[3]}; ${px(s.burst.pixels)}`,
			);
			check(
				'every particle is gone before 2 s, and the ring is replayed after',
				s.gone.drawn === 0 && mesh(s.again),
				`at 1.75 s ${px(s.gone)}; at 2.3 s ${px(s.again)}`,
			);
			check(
				'paused, nothing moves; Restart empties the stage, and playing again starts the ring',
				s.paused.same &&
					mesh(s.paused.pixels) &&
					s.restarted.drawn === 0 &&
					mesh(s.restartedPlaying),
				`paused ${px(s.paused.pixels)}; restarted ${px(s.restarted)}; then ${px(s.restartedPlaying)}`,
			);
			check(
				'Strength is a uniform write: seen while paused, with no remount',
				mesh(s.strength.full) &&
					s.strength.low.green === 0 &&
					s.strength.low.drawn > DRAWN &&
					mesh(s.strength.back) &&
					s.strength.lines.filter((l) => l.includes(': on (')).length === 1,
				`1: ${px(s.strength.full)}; 0.25: ${px(s.strength.low)}; 1: ${px(s.strength.back)}`,
			);
			check(
				'the Fountain draws a jet through the mesh, rising above the centre',
				s.fountain.state === 'on' &&
					mesh(s.fountain.pixels) &&
					s.fountain.halves.above > DRAWN / 2 &&
					s.fountain.halves.below > 0,
				`${px(s.fountain.pixels)}; above ${s.fountain.halves.above}, below ${s.fountain.halves.below}`,
			);
			check(
				'an atlas region as the art: the mesh draws it, not the sprite',
				s.region.state === 'on' && mesh(s.region.pixels),
				px(s.region.pixels),
			);
			check(
				'a kind no longer registered draws plain: the sprites, never invisible',
				s.unregistered.state === 'not registered' &&
					plain(s.unregistered.pixels) &&
					said(s.unregistered.lines, 'shaders/preview: plain, not registered'),
				px(s.unregistered.pixels),
			);
			check(
				'hidden: released with its load (the effect carries its cost), nothing drawn',
				s.hiddenAgain.pixels.drawn === 0 &&
					s.hiddenAgain.lines.some((l) =>
						/shaders\/preview: released, its peak [\d.]+ (k|M)?px covered, load [\d.]+( k| M)?/.test(
							l,
						),
					),
				s.hiddenAgain.lines.join(' | '),
			);
			check(
				'shown again it draws at 1/8: no slot leaked over every rebuild, and destroying it leaves nothing',
				said(s.slots, 'shaders/preview: on (custom:solid; 1/8 drawing)') && s.destroyed === 0,
				s.slots.join(' | '),
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
