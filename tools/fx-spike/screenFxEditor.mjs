#!/usr/bin/env node
/**
 * SCREEN FX EDITOR — the Scene Editor's Game Settings → Screen FX played headless (Invisible Shader
 * Graph step 8e.6, `docs/design/shader-graph-screens.md` §9.2).
 *
 * `screenFxEditor/entry.ts` mounts the real `/editor` `+page.svelte` outside SvelteKit (its requests
 * answered in memory, see there); this script builds it with Vite and the launcher's Svelte plugin
 * and drives it in headless Chromium through the DOM, as an author would:
 *  1. the post FX pickers grey the kinds the stage refuses, each with the runtime's reason (an exit,
 *     an enter, a motion-only and a break kind), and offer the rest;
 *  2. add Glow and a graph compiled with a cost: each row has its load line (no compiled cost /
 *     cost × the reference phone's pixels against the post FX budget); the trigger offers Always and
 *     On cue only; put the graph on a cue with a stop cue; Add is off at two entries;
 *  2b. the transition cue row: the wipe by default; the built-in exits, then the project's effects;
 *     set Dissolve out, 900 ms, strength 1.5: its status and its load against the transition
 *     budget;
 *  3. flip "Anti-aliasing under stage effects", with its memory note;
 *  4. save: the doc sent carries all three, sparsely;
 *  5. reopen on that doc as the server stores it (the real `normalizeDoc`): the block reads back
 *     identical (the cue row, rows, triggers, cues, load lines, the greyed kinds, the switch), and
 *     saving it again sends the same settings.
 * Screenshots of the block before the save and after the reopen, and of the stage at rest, under
 * the post FX and midway through the transition, are kept with `--keep <dir>`.
 *
 *   pnpm --filter fx-spike screen-fx-editor [--keep <dir>]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { buildLauncherPage } from './launcherPage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const keepAt = process.argv.includes('--keep')
	? resolve(process.argv[process.argv.indexOf('--keep') + 1])
	: undefined;
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'screen-fx-editor-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `doc` as the editor's save stores it and its load reads it: the real server reader. */
function normalizeLikeTheServer(doc) {
	const tsx = join(HERE, 'node_modules/.bin/tsx');
	const out = spawnSync(
		tsx,
		[
			'--tsconfig',
			join(REPO, 'apps/launcher-api/tsconfig.scripts.json'),
			join(HERE, 'screenFxEditor/normalize.ts'),
		],
		{ input: JSON.stringify(doc), encoding: 'utf8', cwd: join(REPO, 'apps/launcher-api') },
	);
	if (out.status !== 0) throw new Error(`normalizeDoc failed: ${out.stderr}`);
	return JSON.parse(out.stdout);
}

/** In-page helpers, installed on every load: what an author sees in the block, and their gestures. */
const HELPERS = `(() => {
	const block = () => document.querySelector('.screen-fx');
	const postFx = () => block()?.querySelector('[data-row="post-fx"]');
	const addSelect = () => [...postFx().querySelectorAll('select')].at(-1);
	const rows = () => [...postFx().querySelectorAll('.fx-row')];
	const pick = (select, value) => {
		select.value = value;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const field = (row, label) =>
		[...row.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent.trim() === label)
			?.querySelector('input, select');
	const option = (select, kind) => [...select.options].find((o) => o.value === kind);
	const state = () => ({
		rows: rows().map((row) => ({
			on: row.querySelector('.fx-head input[type=checkbox]')?.checked,
			title: row.querySelector('.fx-title strong')?.textContent.trim(),
			when: row.querySelector('.fx-when')?.textContent.replace(/\\s+/g, ' ').trim(),
			line: row.querySelector('.sfx-line')?.textContent.replace(/\\s+/g, ' ').trim(),
			lineWarn: row.querySelector('.sfx-line')?.classList.contains('warn'),
			play: !!row.querySelector('.icon.play'),
		})),
		addDisabled: addSelect().disabled,
		full: [...postFx().querySelectorAll('.hint')].some((h) => h.textContent.includes('At most 2 here')),
		greyed: [...addSelect().options].filter((o) => o.disabled).map((o) => \`\${o.value}: \${o.title}\`),
		aa: block().querySelector('[data-row="antialias"] input[type=checkbox]').checked,
		cue: cueState(),
	});
	const cueRow = () => block().querySelector('[data-row="transition-cue"]');
	const cueField = (label) =>
		[...cueRow().querySelectorAll('label.sfx-field')].find((l) => l.querySelector('span')?.textContent.trim() === label)
			?.querySelector('input, select');
	const cueState = () => ({
		kind: cueField('The transition cue plays').value,
		durationMs: cueField('Duration ms')?.value ?? null,
		strength: cueField('Strength')?.value ?? null,
		lines: [...cueRow().querySelectorAll('.sfx-line')].map((l) => ({
			text: l.textContent.replace(/\\s+/g, ' ').trim(),
			warn: l.classList.contains('warn'),
		})),
	});
	const setField = (input, value) => {
		input.value = value;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	};
	window.sfx = { block, postFx, addSelect, rows, pick, field, option, state, cueRow, cueField, cueState, setField };
	return true;
})()`;

let browser;
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'screenFxEditor/entry.ts',
		name: 'screen-fx-editor',
		outDir: join(dir, 'out'),
		title: 'screen fx editor',
	});
	console.log(`editor page built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({
		name: 'screen-fx-editor',
		args: ['--window-size=1600,1000'],
		logAll: true,
	});
	const ev = (expr) => browser.evaluate(expr);
	const open = async (doc) => {
		// `?fxdebug=1`: the game's runtime says what it plays on the stage (▶ below).
		await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?fxdebug=1` });
		await browser.waitFor('document.readyState === "complete"');
		await ev(
			doc
				? `localStorage.setItem('screenFxEditor.doc', ${JSON.stringify(JSON.stringify(doc))}), true`
				: `localStorage.removeItem('screenFxEditor.doc'), true`,
		);
		// Marks the page being left, so the wait below cannot be met by its block before the reload.
		await ev('window.leaving = true');
		await browser.send('Page.reload', {});
		await browser.waitFor('!window.leaving && !!document.querySelector(".screen-fx")', 60_000);
		await ev(HELPERS);
		// Open Game Settings, as the author clicks its heading.
		await ev(`(() => {
			const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('summary')?.textContent.includes('Game Settings'));
			d.open = true;
			d.scrollIntoView();
			return true;
		})()`);
		await sleep(200);
	};
	/** The stage, as a PNG: what the author sees of it. */
	const stageShot = async () => {
		const clip = await ev(`(() => {
			const r = document.querySelector('canvas.hud-layer').parentElement.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		})()`);
		const { data } = await browser.send('Page.captureScreenshot', {
			format: 'png',
			clip: { ...clip, scale: 1 },
		});
		return data;
	};
	/** The ▶ overlay on the stage now: there, drawn (a 2D copy of the shared renderer's frame, not
	 *  a context of its own), and how many surfaces it hid. */
	const stageOverlayState = `(() => {
		const stage = document.querySelector('canvas.hud-layer').parentElement;
		const overlay = stage.querySelector('[data-element-fx-overlay] canvas');
		const ctx = overlay?.getContext('2d');
		let drawn = false;
		if (ctx && overlay.width && overlay.height) {
			const { data } = ctx.getImageData(0, 0, overlay.width, overlay.height);
			for (let i = 3; i < data.length && !drawn; i += 4 * 97) drawn = data[i] > 0;
		}
		return {
			overlay: !!overlay,
			drawn,
			hiddenSurfaces: [...stage.querySelectorAll('canvas')].filter((c) => c.style.visibility === 'hidden').length,
		};
	})()`;
	const shot = async (name) => {
		// The sidebar from the block's top down, as the author sees it scrolled to it.
		const rect = await ev(`(() => {
			const b = sfx.block();
			b.scrollIntoView({ block: 'start' });
			const r = b.closest('aside').getBoundingClientRect();
			return { x: r.x, y: 0, width: r.width, height: innerHeight };
		})()`);
		const { data } = await browser.send('Page.captureScreenshot', {
			format: 'png',
			clip: { ...rect, scale: 1 },
		});
		const path = join(dir, `${name}.png`);
		writeFileSync(path, Buffer.from(data, 'base64'));
		return path;
	};

	console.log('1. the pickers grey what the stage refuses, with the reason');
	await open(null);
	const opened = await ev('editorPage.opened.settings ?? null');
	check('the project opens with no Screen FX', opened === null || !('postFx' in opened));
	const options = await ev(`(() => {
		const s = sfx.addSelect();
		const o = (k) => { const x = sfx.option(s, k); return x && { disabled: x.disabled, text: x.textContent.trim(), title: x.title }; };
		return { fadeOut: o('fadeOut'), fadeIn: o('fadeIn'), shake: o('shake'), shatter: o('shatter'), glow: o('glow'), ripple: o('custom:ripple') };
	})()`);
	for (const [kind, reason] of [
		['fadeOut', 'an exit kind ends hidden, so it would hide the whole game'],
		['fadeIn', 'an enter kind starts hidden, so it would hide the whole game'],
		['shake', 'a motion-only kind moves its element'],
		['shatter', 'a break cuts its element up'],
	]) {
		const o = options[kind];
		check(
			`${kind} is greyed with its reason`,
			!!o && o.disabled && o.text.includes(reason) && o.title.includes(reason),
			JSON.stringify(o),
		);
	}
	check(
		'Glow and a compiled graph are offered',
		options.glow?.disabled === false &&
			options.glow.text === 'Glow' &&
			options.ripple?.disabled === false,
		JSON.stringify([options.glow, options.ripple]),
	);
	check(
		'no post FX yet: the intro',
		await ev(`sfx.postFx().textContent.includes('HUD included, always or on a cue')`),
	);

	console.log('2. two post FX, their load lines, a cue, the cap');
	await ev(`sfx.pick(sfx.addSelect(), 'glow'), true`);
	await ev(`sfx.pick(sfx.addSelect(), 'custom:ripple'), true`);
	await sleep(100);
	let state = await ev('sfx.state()');
	check(
		'two rows, Glow and the graph',
		state.rows.length === 2 && state.rows[0].title === 'Glow' && state.rows[1].title === 'Ripple',
		JSON.stringify(state.rows.map((r) => [r.title, r.when])),
	);
	check(
		'Glow says it has no compiled cost, guessing nothing',
		state.rows[0].line?.startsWith('No compiled cost for this kind') && !state.rows[0].lineWarn,
		state.rows[0].line,
	);
	check(
		'the graph: its cost × the reference phone’s pixels against the post FX budget',
		/^Load 1\.32 M px × cost \d+ = [\d.]+ M of 79\.00 M \(the post FX budget, cost 60; \d+ reads a pixel of 4\)\.$/.test(
			state.rows[1].line ?? '',
		),
		state.rows[1].line,
	);
	check(
		'Add is off at two entries, and says why',
		state.addDisabled && state.full,
		JSON.stringify([state.addDisabled, state.full]),
	);
	const triggerOptions = await ev(
		`[...sfx.field(sfx.rows()[1], 'Trigger').options].map((o) => o.textContent.trim())`,
	);
	check(
		'the trigger offers Always and On cue only',
		JSON.stringify(triggerOptions) === JSON.stringify(['Always (loops while shown)', 'On cue']),
		JSON.stringify(triggerOptions),
	);
	const kindInRow = await ev(`(() => {
		const s = sfx.field(sfx.rows()[0], 'Kind');
		return { fadeOut: sfx.option(s, 'fadeOut').disabled, glow: sfx.option(s, 'glow').disabled, shine: sfx.option(s, 'shine').disabled };
	})()`);
	check(
		'a row’s own Kind picker greys the same kinds, and its own kind is not counted against the caps',
		kindInRow.fadeOut && !kindInRow.glow && !kindInRow.shine,
		JSON.stringify(kindInRow),
	);
	await ev(`sfx.pick(sfx.field(sfx.rows()[1], 'Trigger'), 'cue'), true`);
	await sleep(50);
	await ev(`(() => {
		const row = sfx.rows()[1];
		for (const [label, value] of [['Cue', 'gradeOn'], ['Stop cue', 'gradeOff']]) {
			const input = sfx.field(row, label);
			input.value = value;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
		return true;
	})()`);
	await sleep(100);
	state = await ev('sfx.state()');
	check('the graph plays on its cue', state.rows[1].when === 'on cue gradeOn', state.rows[1].when);

	console.log('2a. ▶ plays a post FX over the whole stage, through the game’s runtime');
	check(
		'each post FX row has its ▶',
		state.rows.length === 2 && state.rows.every((r) => r.play),
		JSON.stringify(state.rows.map((r) => r.play)),
	);
	const restingStage = await stageShot();
	await ev(`sfx.rows()[0].querySelector('.icon.play').click(), true`);
	await browser
		.waitFor(`!!document.querySelector('[data-element-fx-overlay] canvas')`, 10_000)
		.catch(() => {});
	await sleep(500);
	const playing = await ev(stageOverlayState);
	const glowing = await stageShot();
	writeFileSync(join(dir, 'stage-resting.png'), Buffer.from(restingStage, 'base64'));
	writeFileSync(join(dir, 'stage-post-fx.png'), Buffer.from(glowing, 'base64'));
	check(
		'Glow plays on a Pixi surface laid over the frame (the shared renderer), the surfaces it stands in for hidden',
		playing.overlay && playing.drawn && playing.hiddenSurfaces > 0,
		JSON.stringify(playing),
	);
	check(
		'…in the runtime’s stage mode, as a post FX in its slot',
		browser.pageLog.some((l) =>
			l.includes('[fxdebug] post fx glow on the stage: on (1/2 entries, 1/4 filters)'),
		),
		browser.pageLog.filter((l) => l.includes('fxdebug')).join(' | '),
	);
	check('the stage looks different while it plays', glowing !== restingStage);
	await ev(
		`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`,
	);
	await sleep(300);
	const stopped = await ev(stageOverlayState);
	check(
		'Escape ends it: the overlay gone, every surface shown again, the stage as it was',
		!stopped.overlay && stopped.hiddenSurfaces === 0 && (await stageShot()) === restingStage,
		JSON.stringify(stopped),
	);

	console.log('2b. the transition cue row');
	const cueOptions = await ev(`(() => {
		const s = sfx.cueField('The transition cue plays');
		return {
			first: s.options[0].textContent.trim(),
			groups: [...s.querySelectorAll('optgroup')].map((g) => [g.label, g.children.length, g.children[0].value]),
		};
	})()`);
	check(
		'the wipe by default; the built-in exits, then the project’s compiled effects',
		cueOptions.first === 'The wipe' &&
			cueOptions.groups[0][0] === 'Built-in (exit)' &&
			cueOptions.groups[0][1] === 10 &&
			cueOptions.groups[1]?.[0] === 'Custom (Shader Graph)' &&
			cueOptions.groups[1][2].startsWith('custom:'),
		JSON.stringify(cueOptions),
	);
	check(
		'off, it says the wipe plays, and offers no length or strength',
		(await ev('sfx.cueState()')).lines[0]?.text.includes('plays the wipe') &&
			(await ev('sfx.cueState()')).durationMs === null,
		JSON.stringify(await ev('sfx.cueState()')),
	);
	await ev(`sfx.pick(sfx.cueField('The transition cue plays'), 'dissolveOut'), true`);
	await sleep(50);
	await ev(`sfx.setField(sfx.cueField('Duration ms'), '900'), true`);
	await sleep(50);
	await ev(`sfx.setField(sfx.cueField('Strength'), '1.5'), true`);
	await sleep(100);
	const cue = await ev('sfx.cueState()');
	check(
		'Dissolve out, 900 ms, strength 1.5: it plays instead of the wipe, with its load against the transition budget',
		cue.kind === 'dissolveOut' &&
			cue.durationMs === '900' &&
			cue.strength === '1.5' &&
			cue.lines[0]?.text.includes('instead of the wipe') &&
			!cue.lines[0]?.warn &&
			cue.lines[1]?.text ===
				'Load 1.32 M px × cost 80 = 105.33 M of 263.33 M (the transition budget, cost 200; 1 reads a pixel of 8).',
		JSON.stringify(cue),
	);

	console.log('2c. ▶ plays the cue row on the stage, into a screen not shown');
	const into = await ev(`(() => {
		const s = sfx.cueField('Preview into');
		return { options: [...s.options].map((o) => [o.value, o.textContent.trim()]) };
	})()`);
	const intro = into.options.find(([, name]) => name === 'Free-spin intro');
	check(
		'it plays into the screens shown now, or a screen the stage does not show',
		into.options[0]?.[1] === 'The screens shown now' && !!intro,
		JSON.stringify(into.options),
	);
	const shownGroup = (id) => ev(`!!document.querySelector('.scene-group[data-scene-id="${id}"]')`);
	const introShownBefore = await shownGroup(intro?.[0]);
	await ev(`sfx.pick(sfx.cueField('Preview into'), ${JSON.stringify(intro?.[0] ?? '')}), true`);
	await ev(`sfx.cueRow().querySelector('.sfx-icon.play').click(), true`);
	await browser
		.waitFor(`!!document.querySelector('[data-element-fx-overlay] canvas')`, 10_000)
		.catch(() => {});
	await sleep(450);
	const midway = await ev(stageOverlayState);
	const introShownDuring = await shownGroup(intro?.[0]);
	const midShot = await stageShot();
	writeFileSync(join(dir, 'stage-transition.png'), Buffer.from(midShot, 'base64'));
	check(
		'the stage freezes and the screen it plays into comes in under the transition',
		!introShownBefore && introShownDuring && midway.overlay && midway.drawn,
		JSON.stringify({ introShownBefore, introShownDuring, midway }),
	);
	check('the stage looks different while it plays', midShot !== restingStage);
	await browser
		.waitFor(`!document.querySelector('[data-element-fx-overlay]')`, 10_000)
		.catch(() => {});
	await sleep(300);
	const ended = await ev(stageOverlayState);
	check(
		'played out, the screen goes back and the stage is as it was',
		!ended.overlay &&
			ended.hiddenSurfaces === 0 &&
			!(await shownGroup(intro?.[0])) &&
			(await stageShot()) === restingStage,
		JSON.stringify(ended),
	);
	// Stopped as soon as its stage is drawn, before the still is taken (the next frame): the screen
	// it would have shown must never come in.
	const raced = await ev(`new Promise((resolve) => {
		sfx.cueRow().querySelector('.sfx-icon.play').click();
		const began = performance.now();
		const poll = () => {
			const overlay = document.querySelector('[data-element-fx-overlay] canvas');
			const ctx = overlay?.getContext('2d');
			let drawn = false;
			if (ctx && overlay.width && overlay.height) {
				const { data } = ctx.getImageData(0, 0, overlay.width, overlay.height);
				for (let i = 3; i < data.length && !drawn; i += 4 * 97) drawn = data[i] > 0;
			}
			if (drawn) {
				document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				resolve(true);
			} else if (performance.now() - began > 5000) resolve(false);
			else setTimeout(poll, 0);
		};
		poll();
	})`);
	await sleep(600);
	const afterRace = await ev(stageOverlayState);
	check(
		'stopped before its still is taken, the screen it plays into never comes in',
		raced &&
			!afterRace.overlay &&
			afterRace.hiddenSurfaces === 0 &&
			!(await shownGroup(intro?.[0])) &&
			(await stageShot()) === restingStage,
		JSON.stringify({ raced, afterRace }),
	);

	console.log('3. the anti-aliasing switch');
	const note = await ev(
		`sfx.block().querySelector('[data-row="antialias"]').textContent.replace(/\\s+/g, ' ')`,
	);
	check(
		'off by default, with its memory note',
		!state.aa &&
			note.includes('Anti-aliasing under stage effects') &&
			note.includes('about four times a stage pass') &&
			note.includes('WebGL2 only'),
		note,
	);
	await ev(`sfx.block().querySelector('[data-row="antialias"] input').click(), true`);
	await sleep(50);
	state = await ev('sfx.state()');
	check('flipped on', state.aa);
	const before = await shot('screen-fx-set');

	console.log('4. save');
	await ev(
		`[...document.querySelectorAll('button.save-btn')].find((b) => !b.disabled).click(), true`,
	);
	await browser
		.waitFor(
			`editorPage.saved.some((d) => d.settings?.stageFxAntialias === true && d.settings?.postFx?.[1]?.stopCue === 'gradeOff' && d.settings?.transitionCue?.intensity === 1.5)`,
			20_000,
		)
		.catch(() => {});
	const sent = (await ev('editorPage.saved.at(-1)')) ?? {};
	check(
		'the doc sent carries the cue row, the post FX and the switch, sparsely',
		JSON.stringify(sent.settings) ===
			JSON.stringify({
				transitionCue: { kind: 'dissolveOut', durationMs: 900, intensity: 1.5 },
				postFx: [
					{ id: 'efx1', kind: 'glow', trigger: 'always' },
					{
						id: 'efx2',
						kind: 'custom:ripple',
						trigger: 'cue',
						cue: 'gradeOn',
						stopCue: 'gradeOff',
					},
				],
				stageFxAntialias: true,
			}),
		JSON.stringify(sent.settings),
	);
	const stored = normalizeLikeTheServer(sent);
	check(
		'the server stores them as sent',
		JSON.stringify(stored.settings) === JSON.stringify(sent.settings),
		JSON.stringify(stored.settings),
	);

	console.log('5. reopen');
	await open(stored);
	const reopened = await ev('sfx.state()');
	check(
		'the block reads back identical: the cue row, rows, triggers, cues, load lines, greyed kinds, the switch',
		JSON.stringify(reopened) === JSON.stringify(state),
		`\n      before ${JSON.stringify(state)}\n      after  ${JSON.stringify(reopened)}`,
	);
	check(
		'full, each greyed kind still names its own reason: the stage’s refusal, else the cap',
		reopened.greyed.includes(
			'fadeOut: an exit kind ends hidden, so it would hide the whole game',
		) && reopened.greyed.includes('glow: the stage plays at most 2 post FX at once'),
		reopened.greyed.slice(0, 3).join(' | '),
	);
	const after = await shot('screen-fx-reopened');
	// Off and on again: an edit, so Save sends the doc; the settings must come back unchanged.
	await ev(`sfx.block().querySelector('[data-row="antialias"] input').click(), true`);
	await ev(`sfx.block().querySelector('[data-row="antialias"] input').click(), true`);
	await sleep(50);
	await ev(
		`[...document.querySelectorAll('button.save-btn')].find((b) => !b.disabled).click(), true`,
	);
	await browser.waitFor('editorPage.saved.length > 0', 20_000).catch(() => {});
	const resent = (await ev('editorPage.saved.at(-1)')) ?? {};
	check(
		'saved again, it sends the same settings',
		JSON.stringify(resent.settings) === JSON.stringify(sent.settings),
		JSON.stringify(resent.settings),
	);
	if (keepAt) console.log(`  screenshots: ${before}, ${after}`);
	const errors = browser.pageLog.filter(
		(l) => l.startsWith('[uncaught]') || l.startsWith('[error]'),
	);
	check(
		'no uncaught error on the page',
		!errors.some((l) => l.startsWith('[uncaught]')),
		errors.join(' | '),
	);
} catch (e) {
	failed = true;
	console.error(e);
	if (browser) console.error(browser.pageLog.slice(-30).join('\n'));
} finally {
	await browser?.close();
	if (!keepAt) rmSync(dir, { recursive: true, force: true });
}

const bad = results.filter((r) => !r.ok);
console.log(
	`\nscreen fx editor: ${results.length - bad.length}/${results.length} passed in ${((Date.now() - began) / 1000).toFixed(1)} s`,
);
if (failed || bad.length || !results.length) process.exit(1);
