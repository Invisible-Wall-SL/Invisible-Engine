#!/usr/bin/env node
/**
 * SCREEN FX FLOW — `/flow-v2`'s screen transitions and `stage` played headless (Invisible Shader
 * Graph step 8e.6, `docs/design/shader-graph-screens.md` §9.1).
 *
 * `screenFxFlow/entry.ts` mounts the real `/flow-v2` `+page.svelte` outside SvelteKit (its requests
 * answered in memory); this script builds it with Vite and the launcher's Svelte plugin and drives
 * it in headless Chromium through the DOM, as an author would:
 *  1. place a `screenTransition` from the palette: the inspector groups its kinds (the built-in
 *     exits, then the project's Shader Graph effects, by name), costs the one picked against the
 *     transition budget, gives the hint, and links a custom kind to its graph in `/shaders`; the
 *     validator says, as an info, that nothing waits for it;
 *  2. place an `elementEffect` on `stage`: its kind list flags the kinds the stage refuses, and an
 *     exit kind there is warned in the inspector and the issues;
 *  3. the page saves the flow (autosave): the doc sent carries both nodes as set;
 *  4. publish: that doc passes Publish's flow gate (the real `validateFlowV2Against` and
 *     `flowGateRefusal`), the info and the warning never blocking;
 *  5. the Preview runs a load → transition → wait → cue chain and lists both actions with their
 *     lengths, the cue after the wait;
 *  6. with Game Settings' transition cue row on, a flow that never fires `transition` says so; the
 *     starter flow, which does, does not.
 *
 *   pnpm --filter fx-spike screen-fx-flow [--keep <dir>]
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
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'screen-fx-flow-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `doc` through Publish's flow gate: the real server code. */
function publish(doc) {
	const tsx = join(HERE, 'node_modules/.bin/tsx');
	const out = spawnSync(
		tsx,
		[
			'--tsconfig',
			join(REPO, 'apps/launcher-api/tsconfig.scripts.json'),
			join(HERE, 'screenFxFlow/publish.ts'),
		],
		{ input: JSON.stringify(doc), encoding: 'utf8', cwd: join(REPO, 'apps/launcher-api') },
	);
	if (out.status !== 0) throw new Error(`the flow gate failed: ${out.stderr}`);
	return JSON.parse(out.stdout);
}

const enumType = (name) => ({ t: 'enum', name });
const lit = (type, value) => ({ kind: 'literal', type, value });
/** load → screenTransition (Dissolve out, 900 ms) → waitForScreenTransition → uiShow. */
const PREPARED = {
	version: 2,
	templateId: 'lines',
	containers: [],
	graph: {
		nodes: [
			{ id: 'onLoad', kind: 'event', pos: { x: 0, y: 0 }, ref: 'load' },
			{
				id: 'freeze',
				kind: 'action',
				pos: { x: 220, y: 0 },
				ref: 'screenTransition',
				inputs: {
					kind: lit(enumType('ScreenTransitionKind'), 'dissolveOut'),
					durationMs: lit({ t: 'ms' }, 900),
				},
			},
			{ id: 'holdOn', kind: 'action', pos: { x: 440, y: 0 }, ref: 'waitForScreenTransition' },
			{ id: 'after', kind: 'fireCue', pos: { x: 660, y: 0 }, ref: 'uiShow' },
		],
		exec: [
			{ from: { node: 'onLoad', pin: 'exec' }, to: { node: 'freeze', pin: 'exec' } },
			{ from: { node: 'freeze', pin: 'exec' }, to: { node: 'holdOn', pin: 'exec' } },
			{ from: { node: 'holdOn', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
		],
		data: [],
	},
};

/** In-page helpers: the inspector, the palette, the issues, the preview. */
const HELPERS = `(() => {
	const text = (el) => el?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
	const paletteEntry = (name) =>
		[...document.querySelectorAll('.palette .entry.action')].find((b) => text(b).startsWith(name));
	const openActions = () => {
		const head = [...document.querySelectorAll('.palette .section-head')].find((h) => text(h).startsWith('▸ Actions') || text(h).includes('Actions'));
		if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
	};
	const field = (pin) =>
		[...document.querySelectorAll('.datains .field')].find((f) => text(f.querySelector('.pinname')).startsWith(pin));
	const pinSelect = (pin) => field(pin)?.querySelector('.enum-literal select');
	const pick = (select, value) => {
		select.value = value;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const issues = () => [...document.querySelectorAll('.validation .issue')].map(text);
	/** Back to the palette, as the inspector's close button does. */
	const deselect = () => document.querySelector('button.close[title^="Deselect"]')?.click();
	window.flowFx = { text, paletteEntry, openActions, field, pinSelect, pick, issues, deselect };
	return true;
})()`;

let browser;
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'screenFxFlow/entry.ts',
		name: 'screen-fx-flow',
		outDir: join(dir, 'out'),
		title: 'screen fx flow',
	});
	console.log(`flow page built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({ name: 'screen-fx-flow', args: ['--window-size=1600,1000'] });
	const ev = (expr) => browser.evaluate(expr);
	const open = async (doc, cueOn) => {
		await browser.send('Page.navigate', { url: pathToFileURL(html).href });
		await browser.waitFor('document.readyState === "complete"');
		await ev(
			`(${doc ? `localStorage.setItem('screenFxFlow.doc', ${JSON.stringify(JSON.stringify(doc))})` : `localStorage.removeItem('screenFxFlow.doc')`}, localStorage.setItem('screenFxFlow.cueOn', '${cueOn ? '1' : '0'}'), window.leaving = true)`,
		);
		await browser.send('Page.reload', {});
		await browser.waitFor('!window.leaving && !!document.querySelector(".palette")', 60_000);
		await ev(HELPERS);
	};

	console.log('1. place a screenTransition');
	await open(null, true);
	check(
		'the starter flow fires transition: with the cue row on, nothing is said',
		!(await ev(`!!document.querySelector('[data-transition-cue-unfired]')`)),
	);
	await ev('flowFx.openActions(), true');
	await sleep(100);
	const placed = await ev(`(() => {
		const entry = flowFx.paletteEntry('screenTransition');
		if (!entry) return false;
		entry.click();
		return true;
	})()`);
	await sleep(300);
	check(
		'the palette offers it, and a click places it, selected',
		placed && (await ev(`!!document.querySelector('[data-screen-transition]')`)),
	);
	const kinds = await ev(`(() => {
		const s = flowFx.pinSelect('kind');
		return s && {
			groups: [...s.querySelectorAll('optgroup')].map((g) => [g.label, g.children.length, flowFx.text(g.children[0])]),
		};
	})()`);
	check(
		'its kinds: the built-in exits, then the project’s Shader Graph effects, by name',
		kinds?.groups?.[0]?.[0] === 'Built-in (exit)' &&
			kinds.groups[0][1] === 10 &&
			kinds.groups[0][2] === 'Pop out' &&
			kinds.groups[1]?.[0] === 'Custom (Shader Graph)' &&
			kinds.groups[1][1] > 0,
		JSON.stringify(kinds),
	);
	await ev(`flowFx.pick(flowFx.pinSelect('kind'), 'dissolveOut'), true`);
	await sleep(200);
	const note = await ev(`flowFx.text(document.querySelector('[data-screen-transition]'))`);
	check(
		'Dissolve out is costed against the transition budget, with the hint',
		note.includes(
			'Load 1.32 M px × cost 80 = 105.33 M of 263.33 M (the transition budget, cost 200; 1 reads a pixel of 8).',
		) &&
			note.includes(
				'Freezes the screen and goes on at once. Put the screen change right after this node, then Wait for transition.',
			) &&
			!note.includes('Open in Shader Graph'),
		note,
	);
	const custom = await ev(
		`flowFx.pinSelect('kind').querySelector('optgroup:last-of-type option').value`,
	);
	await ev(`flowFx.pick(flowFx.pinSelect('kind'), ${JSON.stringify(custom)}), true`);
	await sleep(200);
	const link = await ev(
		`document.querySelector('[data-screen-transition] a.shader-link')?.getAttribute('href') ?? null`,
	);
	check(
		'a Shader Graph kind links to its graph in /shaders',
		link === `/shaders?graph=${encodeURIComponent(custom.slice('custom:'.length))}&project=project`,
		String(link),
	);
	await ev(`flowFx.pick(flowFx.pinSelect('kind'), 'dissolveOut'), true`);
	await sleep(200);
	check(
		'nothing waits for it: the validator says so, as an info',
		(await ev('flowFx.issues()')).some((i) =>
			i.includes('never reaches a Wait for transition, so it plays under whatever comes next'),
		),
		(await ev('flowFx.issues()')).join(' | '),
	);

	console.log('2. place an elementEffect on the stage');
	await ev('flowFx.deselect(), true');
	await sleep(150);
	await ev('flowFx.openActions(), true');
	await sleep(100);
	await ev(`flowFx.paletteEntry('elementEffect').click(), true`);
	await sleep(300);
	await ev(`flowFx.pick(flowFx.pinSelect('target'), 'stage'), true`);
	await sleep(150);
	const flags = await ev(`(() => {
		const s = flowFx.pinSelect('kind');
		const o = (v) => flowFx.text([...s.options].find((x) => x.value === v));
		return { glow: o('glow'), fadeOut: o('fadeOut'), shake: o('shake') };
	})()`);
	check(
		'on the stage its kind list flags what the stage refuses, and only that',
		flags.fadeOut.endsWith('— does not play on the whole stage') &&
			flags.shake.endsWith('— does not play on the whole stage') &&
			flags.glow === 'glow',
		JSON.stringify(flags),
	);
	await ev(`flowFx.pick(flowFx.pinSelect('kind'), 'fadeOut'), true`);
	await sleep(200);
	check(
		'an exit kind there is warned in the inspector and the issues',
		(await ev(`flowFx.text(document.querySelector('[data-stage-refusal]'))`)).includes(
			'plays nothing on the whole stage: an exit kind ends hidden',
		) && (await ev('flowFx.issues()')).some((i) => i.includes('plays nothing there')),
	);

	console.log('3. save');
	await browser
		.waitFor(
			`flowPage.saved.some((d) => JSON.stringify(d).includes('"fadeOut"') && JSON.stringify(d).includes('"dissolveOut"'))`,
			20_000,
		)
		.catch(() => {});
	const sent = (await ev('flowPage.saved.at(-1)')) ?? { graph: { nodes: [] } };
	const sentNode = (ref) => sent.graph.nodes.find((n) => n.kind === 'action' && n.ref === ref);
	check(
		'the doc sent carries both nodes as set',
		sentNode('screenTransition')?.inputs?.kind?.value === 'dissolveOut' &&
			sentNode('elementEffect')?.inputs?.target?.value === 'stage' &&
			sentNode('elementEffect')?.inputs?.kind?.value === 'fadeOut',
		JSON.stringify([sentNode('screenTransition'), sentNode('elementEffect')]),
	);

	console.log('4. publish');
	const verdict = publish(sent);
	const at = (code) =>
		verdict.issues.filter((i) => i.code === code).map((i) => `${i.severity} ${i.at.node}`);
	check(
		'it passes Publish’s flow gate; the info never blocks',
		verdict.refusal === null &&
			JSON.stringify(at('screen-transition-unwaited')) ===
				JSON.stringify([`info ${sentNode('screenTransition')?.id}`]),
		JSON.stringify(verdict),
	);

	console.log('5. the Preview');
	await open(PREPARED, false);
	await ev(`(() => {
		const s = document.querySelector('select[aria-label="Event to preview"]');
		s.value = 'load';
		s.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	})()`);
	await sleep(100);
	await ev(`document.querySelector('.preview button.run').click(), true`);
	await browser
		.waitFor(`document.querySelectorAll('.preview .timeline li').length >= 3`, 10_000)
		.catch(() => {});
	const rows = await ev(
		`[...document.querySelectorAll('.preview .timeline li')].map((li) => flowFx.text(li))`,
	);
	check(
		'both actions with their lengths; the cue after the wait',
		rows[0]?.startsWith('0 effect screenTransition') &&
			rows[0].endsWith('· 900 ms') &&
			rows[1] === '0 effect waitForScreenTransition · holds 900 ms' &&
			rows[2] === '900 cue uiShow',
		rows.join(' | '),
	);

	console.log('6. the transition cue row on, a flow that never fires transition');
	await open(PREPARED, true);
	check(
		'it says so',
		(await ev(`flowFx.text(document.querySelector('[data-transition-cue-unfired]'))`)).includes(
			'this flow never fires transition, so it never plays',
		),
	);
	await open(PREPARED, false);
	check(
		'with the row off, nothing',
		!(await ev(`!!document.querySelector('[data-transition-cue-unfired]')`)),
	);

	const errors = browser.pageLog.filter((l) => l.startsWith('[uncaught]'));
	check('no uncaught error on the page', errors.length === 0, errors.join(' | '));
	if (keepAt) {
		const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(join(dir, 'flow-page.png'), Buffer.from(data, 'base64'));
	}
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
	`\nscreen fx flow: ${results.length - bad.length}/${results.length} passed in ${((Date.now() - began) / 1000).toFixed(1)} s`,
);
if (failed || bad.length || !results.length) process.exit(1);
