// Screenshot proof that the expanding wild (`expandWild`) and the growing wild (`growWild`) play in
// the built `apps/lines` runtime (docs/design/expanding-and-growing-wilds.md). Modelled on
// `scripts/win-parity/run.mjs`: the harness's `cg-lines` stand-in snapshot, the real test server's
// mock with `FORCE_WILDS=1` (every feature wild lands on every spin), `?ie_determinism=<seed>`
// (stepped frames, no wall clock), the committed reference flow (`?flowV2=lines`, whose trace says
// the frame each book event started on). Per session the snapshot's config gets the block, with `W`
// added to the strips of reels 1–3 (the resolvers keep only a wild that is dealt), and the manifest
// entry carries it in server names (`WILD`), as `mockContract.ts` derives it.
//
// SESSIONS (`--session` picks; default all):
//   expand-onWin    expandingWilds { symbols: ['W'] }        — paid expansions drawn, unpaid not
//   expand-always   expandingWilds { symbols: ['W'], show: 'always' }
//   grow            growingWild { symbol: 'W' }              — the plus-grow from the centre reel
//
// Each spin: the frame before the press, frames every `--every` from the first wild event for
// `--window` frames, the settled board. `<out>/<session>/spins.json` lists each spin's wire events
// (`expandedWild`, `growingWild`, the reels its line wins cross ⇒ `paid`) and the flow trace.
//
//   node scripts/playtest/wilds-screens.mjs [--build <dir>] [--out <dir>] [--seed <s>]
//        [--spins <n>] [--every <frames>] [--window <frames>] [--session <name>]... [--coded]
//
// `--build` defaults to `.cache/current-games/runtimes/working-tree` (build it with the harness's
// `buildWorkingTree`); `--coded` boots without `?flowV2=lines` (the coded book-event handlers).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { openPage } from '../current-games/lib/browser.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		build: { type: 'string', default: join(ROOT, '.cache/current-games/runtimes/working-tree') },
		chrome: { type: 'string' },
		out: { type: 'string', default: join(ROOT, '.cache/wilds-screens') },
		seed: { type: 'string', default: 'wilds' },
		spins: { type: 'string', default: '6' },
		every: { type: 'string', default: '4' },
		window: { type: 'string', default: '240' },
		session: { type: 'string', multiple: true, default: [] },
		coded: { type: 'boolean', default: false },
	},
});
const GAME = 'cg-lines';
const SPINS = Number(opt.spins);
const EVERY = Number(opt.every);
const WINDOW = Number(opt.window);
const WILD_REELS = [1, 2, 3];
const out = resolve(opt.out);
const log = (line) => console.log(`[wilds-screens] ${line}`);

const SESSIONS = {
	'expand-onWin': {
		config: { expandingWilds: { symbols: ['W'] } },
		grid: { expandingWilds: { symbols: [{ symbol: 'WILD', reels: WILD_REELS }] } },
	},
	'expand-always': {
		config: { expandingWilds: { symbols: ['W'], show: 'always' } },
		grid: { expandingWilds: { symbols: [{ symbol: 'WILD', reels: WILD_REELS }] } },
	},
	grow: {
		config: { growingWild: { symbol: 'W' } },
		grid: { growingWild: { symbol: 'WILD', reels: [2], freeSpinReels: [2], pattern: 'plus' } },
	},
};
const chosen = opt.session.length ? opt.session : Object.keys(SESSIONS);
for (const s of chosen) if (!SESSIONS[s]) throw new Error(`unknown session ${s}`);
if (!existsSync(join(opt.build, 'index.html'))) throw new Error(`no built runtime at ${opt.build}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fixtures'), { recursive: true });
execFileSync(
	process.execPath,
	[
		'--experimental-strip-types',
		'--import',
		'./scripts/ts-loader.mjs',
		'scripts/current-games/fixtures.mjs',
		'--out',
		join(out, 'fixtures'),
	],
	{ cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
);
const game = JSON.parse(readFileSync(join(out, 'fixtures', 'games.json'), 'utf8')).games.find(
	(g) => g.key === GAME,
);
const snapshotDir = game.local.snapshot;
const published = JSON.parse(readFileSync(join(snapshotDir, 'runtime.json'), 'utf8'));

/** `W` on every fifth cell of reels 1–3, base and free strips, so the resolvers see it dealt. */
const withWildOnStrips = (config) => {
	const paddingReels = Object.fromEntries(
		Object.entries(config.paddingReels).map(([mode, reels]) => [
			mode,
			reels.map((strip, reel) =>
				WILD_REELS.includes(reel)
					? strip.flatMap((cell, i) =>
							i % 5 === 2
								? [cell, typeof cell === 'string' ? 'W' : { ...cell, name: 'W' }]
								: [cell],
						)
					: strip,
			),
		]),
	);
	return { ...config, paddingReels };
};

// Every RGS exchange, recorded before the app's own code runs (as `sample-play.mjs` does).
const WIRE_HOOK = `(() => {
	const log = (window.__WIRE__ = []);
	const orig = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input.url;
		const res = await orig(input, init);
		if (/\\/api\\//.test(url) && !/editor\\/runtime/.test(url)) {
			const body = init && typeof init.body === 'string' ? init.body : null;
			res.clone().text().then((text) => {
				let json = null;
				try { json = JSON.parse(text); } catch {}
				log.push({ req: body, res: json });
			});
		}
		return res;
	};
})();`;

/** The reels a line win crosses (the facade's `reelsPaidBy`). */
const reelsPaidBy = (win) => {
	if (!win || win.mode === 'scatter') return [];
	const ctx = win.context;
	if (Array.isArray(ctx)) return ctx.map((c) => c.reel);
	if (!Array.isArray(ctx?.payline)) return [];
	const reels = ctx.payline.map((_r, reel) => reel);
	return ctx.direction === 'right'
		? reels.slice(reels.length - win.occurs)
		: reels.slice(0, win.occurs);
};

const summarize = (exchanges) => {
	const events = exchanges.flatMap((w) => w.res?.events ?? []);
	const paid = new Set(
		events.filter((e) => e.event === 'spinWin').flatMap((e) => reelsPaidBy(e.context)),
	);
	return {
		events: events.map((e) => e.event),
		playedSpin: events.find((e) => e.event === 'playedSpin')?.context,
		expandedWild: events
			.filter((e) => e.event === 'expandedWild')
			.map((e) => ({ ...e.context, paid: paid.has(e.context.reel) })),
		growingWild: events.filter((e) => e.event === 'growingWild').map((e) => e.context),
		symbolSetInMatrix: events.filter((e) => e.event === 'symbolSetInMatrix').map((e) => e.context),
		spinWins: events
			.filter((e) => e.event === 'spinWin')
			.map((e) => ({
				symbol: e.context?.symbol,
				occurs: e.context?.occurs,
				reels: reelsPaidBy(e.context),
				win: e.context?.win,
			})),
		paidReels: [...paid].sort(),
	};
};

const chrome = headlessShell(opt.chrome);

async function session(name) {
	const spec = SESSIONS[name];
	const dir = join(out, name);
	mkdirSync(dir, { recursive: true });
	const bundleFile = join(out, `runtime-${name}.json`);
	writeFileSync(
		bundleFile,
		JSON.stringify({
			...published,
			config: { ...withWildOnStrips(published.config), ...spec.config },
		}),
	);
	const entry = {
		...game.local.manifestEntry,
		grid: { ...game.local.manifestEntry.grid, ...spec.grid },
	};
	const tree = testServerTree(join(out, 'trees', name), opt.build, GAME, entry);
	const server = await startTestServer(tree, { SEED: opt.seed, FORCE_WILDS: '1' });
	const snap = await serveSnapshot({
		dir: snapshotDir,
		bundleFile,
		name: game.name,
		snapshotId: name,
		assetBase: `${server.origin}/${GAME}/`,
	});
	const profile = mkdtempSync(join(tmpdir(), 'ws-profile-'));
	const page = await openPage(chrome, profile);
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: WIRE_HOOK });
	const result = {
		session: name,
		config: spec.config,
		grid: spec.grid,
		spins: [],
		error: undefined,
	};
	try {
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? GAME,
			k: 'wilds-screens',
			editorDocBase: snap.origin,
			rgs_url: `${server.origin}/api/${GAME}/authoring`.replace(/^http:\/\//, ''),
			sessionID: `ws-${name}`,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
			flowlog: '1',
			...(opt.coded ? {} : { flowV2: 'lines' }),
		});
		await page.navigate(`${server.origin}/${GAME}/?${params}`);
		let ready = false;
		for (let i = 0; i < 300 && !ready; i++) {
			ready = await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false);
			if (!ready) await new Promise((r) => setTimeout(r, 100));
		}
		if (!ready) throw new Error('the runtime never installed determinism mode');
		const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
		const state = () => api('state()');
		const step = (n) => api(`step(${Number(n)}, { draw: 'last' })`);
		const waitFor = async (until, maxFrames = 7200) => {
			const r = await api(`waitFor(${JSON.stringify({ ...until, maxFrames, draw: 'last' })})`);
			if (!r.ok)
				throw new Error(`not reached: ${JSON.stringify(until)} — ${JSON.stringify(r.state)}`);
			return r.state;
		};
		const space = async () => {
			await page.key('keyDown');
			await step(2);
			await page.key('keyUp');
		};
		const trace = async () => (await page.evaluate('window.__IE_FLOW_V2_TRACE__ ?? []')) ?? [];
		const wire = async () => (await page.evaluate('window.__WIRE__')) ?? [];
		await step(10);
		await waitFor({ loaded: true, idle: true });
		if (!(await state()).playerIn) await space();
		await waitFor({ playerIn: true, idle: true });
		await step(30);
		const settle = async () => {
			for (let ran = 0; ran < 7200; ran += 600) {
				const r = await api(
					`waitFor(${JSON.stringify({ idle: true, maxFrames: 600, draw: 'last' })})`,
				);
				if (r.ok) return;
				await space();
			}
			throw new Error('the round never settled');
		};
		for (let i = 0; i < SPINS; i++) {
			const wireBefore = (await wire()).length;
			const traceBefore = (await trace()).length;
			const rec = { index: i, frames: [], beatFrame: undefined, trace: [] };
			result.spins.push(rec);
			const shot = async (label) => {
				const s = await state();
				const file = join(dir, `spin${i}-${label}-f${s.frame}.png`);
				writeFileSync(file, await page.screenshot());
				rec.frames.push({ label, frame: s.frame, file });
			};
			await shot('0-before-press');
			await space();
			await waitFor({ idle: false }, 600);
			// The reference flow authors no `expandWild` / `growWild` node, so the coded handler plays
			// them unseen by the trace: capture every EVERY frames from the press through the reveal
			// and the rewrite until `winInfo` + WINDOW/4 frames (or idle, or WINDOW frames after the
			// reveal), each frame labelled with the last flow event that had started.
			const pressFrame = (await state()).frame;
			let revealAt;
			let winAt;
			let beat;
			for (let ran = 0; ran < 3600; ran += EVERY) {
				await step(EVERY);
				const s = await state();
				const lines = (await trace()).slice(traceBefore).filter((l) => /^event/.test(l));
				if (revealAt === undefined && lines.some((l) => /reveal/.test(l))) revealAt = s.frame;
				if (winAt === undefined && lines.some((l) => /winInfo/.test(l))) winAt = s.frame;
				if (lines.some((l) => /expandWild|growWild/.test(l))) beat ??= s.frame;
				const last = (lines.at(-1) ?? 'press').replace(/^event ▶ /, '');
				await shot(`1-${String(s.frame - pressFrame).padStart(4, '0')}-${last}`);
				if (s.idle) break;
				if (winAt !== undefined && s.frame - winAt >= WINDOW / 4) break;
				if (revealAt !== undefined && s.frame - revealAt >= WINDOW) break;
			}
			Object.assign(rec, { pressFrame, revealAt, winAt, beatFrame: beat });
			await settle();
			await step(30);
			await shot('3-settled');
			rec.trace = (await trace()).slice(traceBefore).filter((l) => /^event/.test(l));
			Object.assign(rec, summarize((await wire()).slice(wireBefore)));
			log(
				`${name} spin ${i}: expandedWild ${JSON.stringify(rec.expandedWild)} growingWild ${JSON.stringify(rec.growingWild)} paidReels ${JSON.stringify(rec.paidReels)} beat@${beat}`,
			);
		}
		const final = await state();
		result.errors = final.errors;
		result.renderer = await page.evaluate('window.__PIXI_APP__?.renderer?.name ?? null');
	} catch (e) {
		result.error = e.stack ?? e.message;
	} finally {
		result.console = [...page.consoleLines];
		writeFileSync(join(dir, 'spins.json'), JSON.stringify(result, null, '\t'));
		await page.close();
		server.stop();
		await snap.close();
		rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	}
	if (result.error) console.error(`[wilds-screens] ${name}: ${result.error}`);
	return result;
}

for (const name of chosen) await session(name);
log(`done → ${out}`);
