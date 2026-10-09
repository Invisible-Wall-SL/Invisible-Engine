// Plays a published (or locally built) game in the headless shell against the real Invisible Test
// Server in local mode, round by round, with forced beats, and records what a playtest checks: every
// RGS request and answer (the wire), the probe state after each round, console errors and a
// screenshot at each named moment. Built on the current-games harness (`scripts/current-games/lib`):
// the snapshot is served as the launcher would, the mock deals from the game's manifest entry.
//
//   node scripts/playtest/sample-play.mjs --plan <plan.json> --out <dir> [--chrome <exe>]
//
// plan.json: { key, snapshotDir (runtime.json + deploy/), entry (the test server's games.json
//   entry, or `entryFile` + `entryKey`), runtimeDir (a built `apps/lines`), seed?, env? (the test
//   server's, e.g. FORCE_TRIGGER), query?, rounds: [round…] }. A round is one spin, played until the
//   game is idle again (tapping past every hold), with optional:
//   label            names its screenshot `<nn>-<label>.png`
//   force            a beat posted to the authoring mock first (`…/force?beat=`); a refusal is recorded
//   clicks           [[x, y]…] at 1280×720 instead of Space (a buy: button, option, confirm)
//   midShots         frame offsets at which to take extra screenshots
//   holdCheck        N frames with no input once the feature is in: how many 60-frame slices moved
//                    (an auto respin mode keeps playing, a manual one waits on its SPIN press)
//   reloadOnEvent / reloadAfterPlays (+ reloadOnReels) / reloadAfterFrames
//                    reload the page (same session) mid-round, then finish it
//   cutAfterPlays    hang every in-feature request after the n-th (a dropped connection), then reload:
//                    the facade's resume replays the open round
//   reload           a bare reload between rounds
// Output: <out>/result.json (per round: the wire, the probe state, and a summary row whose money
// check is after = before − stake + win and whose HUD check is the HUD win = the paid win) and the
// screenshots. Results are deterministic per seed (`?ie_determinism=<seed>`).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { openPage } from '../current-games/lib/browser.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const { values: opt } = parseArgs({
	options: { plan: { type: 'string' }, out: { type: 'string' }, chrome: { type: 'string' } },
});
const plan = JSON.parse(readFileSync(opt.plan, 'utf8'));
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const entry =
	plan.entry ?? JSON.parse(readFileSync(plan.entryFile, 'utf8')).games[plan.entryKey ?? plan.key];

// Every RGS exchange, recorded in the page before the app's own code runs.
const WIRE_HOOK = `(() => {
	const log = (window.__SAMPLE_WIRE__ = []);
	const orig = window.fetch.bind(window);
	let plays = 0;
	window.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input.url;
		// \`__SAMPLE_CUT__ = n\`: the connection dies after the n-th in-feature request is sent —
		// every later request hangs, as on a dropped network, until the page reloads.
		if (init && init.body === '[{"action":"play"}]' && window.__SAMPLE_CUT__ !== undefined)
			if (++plays > window.__SAMPLE_CUT__) return new Promise(() => {});
		const res = await orig(input, init);
		if (/\\/api\\//.test(url) && !/editor\\/runtime/.test(url)) {
			const body = init && typeof init.body === 'string' ? init.body : null;
			res.clone().text().then((text) => {
				let json = null;
				try { json = JSON.parse(text); } catch {}
				log.push({ url: url.replace(/^https?:\\/\\/[^/]+/, ''), req: body, status: res.status, res: json ?? text.slice(0, 400) });
			});
		}
		return res;
	};
})();`;

const work = mkdtempSync(join(tmpdir(), 'sample-play-'));
const tree = testServerTree(join(work, 'tree'), plan.runtimeDir, plan.key, entry);
const server = await startTestServer(tree, { SEED: String(plan.seed ?? 7), ...(plan.env ?? {}) });
const snap = await serveSnapshot({
	dir: plan.snapshotDir,
	name: plan.key,
	snapshotId: 'sample',
	...(plan.bundleFile ? { bundleFile: plan.bundleFile } : {}),
});
const page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
await page.page('Page.addScriptToEvaluateOnNewDocument', { source: WIRE_HOOK });

const sid = `sample-${plan.key}-${Date.now()}`;
const rgs = `${server.origin}/api/${plan.key}/authoring`;
const params = new URLSearchParams({
	runtime: '1',
	project: entry.projectKey ?? plan.key,
	k: 'sample-play',
	editorDocBase: snap.origin,
	rgs_url: rgs.replace(/^http:\/\//, ''),
	sessionID: sid,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: String(plan.seed ?? 7),
	...(plan.query ?? {}),
});
const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
const state = () => api('state()');
const step = (n) => api(`step(${n}, { draw: 'last' })`);
const waitFor = async (until, maxFrames) =>
	api(`waitFor(${JSON.stringify({ ...until, maxFrames, draw: 'last' })})`);
const space = async () => {
	await page.key('keyDown');
	await step(2);
	await page.key('keyUp');
};
const click = async (x, y) => {
	for (const type of ['mousePressed', 'mouseReleased'])
		await page.page('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
	await step(30);
};
const wire = () => page.evaluate('window.__SAMPLE_WIRE__');
const shot = async (n, label) => {
	await step(1);
	await new Promise((r) => setTimeout(r, 200));
	const file = `${String(n).padStart(2, '0')}-${label}.png`;
	writeFileSync(join(out, file), await page.screenshot());
	return file;
};

/**
 * Per round: the events dealt, the stake, the win the server paid, the balance before and after,
 * and whether money adds up (after = before − stake + win; a free or bought round's stake is what
 * the balance fell by on its first answer) and the HUD's win matches the paid win.
 */
function summarize(res) {
	let balance = res.boot?.balance ?? null;
	const rows = [];
	const balanceOf = (w) => w.res?.platform?.balance;
	for (const r of res.rounds) {
		if (r.reload) {
			const cfg = r.wire.flatMap((w) => w.res?.events ?? []).find((e) => e.event === 'config');
			rows.push({
				label: r.label,
				reload: true,
				potLevels: JSON.stringify(
					cfg?.context?.potsOverlay?.pots?.map((p) => [p.id, p.level]) ?? null,
				),
				errors: r.state.errors,
			});
			balance =
				r.wire
					.map((w) => w.res?.platform?.balance)
					.filter((b) => typeof b === 'number')
					.pop() ?? balance;
			continue;
		}
		if (r.forceRefused) {
			rows.push({ label: r.label, forceRefused: r.forceRefused });
			continue;
		}
		const events = r.wire.flatMap((w) => (w.res?.events ?? []).map((e) => e.event));
		const bet = r.wire.flatMap((w) => w.res?.events ?? []).find((e) => e.event === 'bet');
		const over = r.wire
			.flatMap((w) => w.res?.events ?? [])
			.filter((e) => e.event === 'gameRoundOver');
		const win = over.length ? over[over.length - 1].context.win : null;
		const balances = r.wire.map(balanceOf).filter((b) => typeof b === 'number');
		const last = balances[balances.length - 1];
		const before = balance;
		const stake = bet ? bet.context.total : null;
		rows.push({
			label: r.label,
			settled: r.settled,
			stake,
			win,
			before,
			after: last,
			moneyOk:
				before != null && last != null && win != null && stake != null
					? last === before - stake + win
					: null,
			hudWin: r.state.win,
			hudOk: win == null ? null : r.state.win === win,
			events: [...new Set(events)].join(' '),
			screens: r.screensSeen.join(' '),
			...(r.holdCheck ? { holdCheck: r.holdCheck } : {}),
			...(r.resumed ? { resumed: r.resumed } : {}),
			errors: r.state.errors,
			stalls: r.state.stalls,
		});
		if (last !== undefined) balance = last;
	}
	return rows;
}

/** Navigate (again, same session id on a reload) and play past the boot splash. */
async function boot() {
	await page.navigate(`${server.origin}/${plan.key}/?${params}`);
	await new Promise((r) => setTimeout(r, 500));
	let ready = false;
	for (let i = 0; i < 300 && !ready; i++) {
		ready = await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false);
		if (!ready) await new Promise((r) => setTimeout(r, 100));
	}
	if (!ready) throw new Error('the runtime never installed determinism mode');
	await waitFor({ loaded: true }, 3600);
	for (let i = 0; i < 20 && !(await state()).playerIn; i++) {
		await space();
		await step(60);
	}
	// The boot splash (engine mark → game mark) plays over the board after `playerIn`.
	await step(600);
	await new Promise((r) => setTimeout(r, 800));
}

const result = { key: plan.key, rounds: [], errors: [] };
try {
	await boot();
	const booted = await state();
	result.boot = {
		state: booted,
		stale: await page.evaluate('window.__IE_RUNTIME_STALE__ ?? null'),
		shot: await shot(0, 'boot'),
		balance: (await wire())
			.map((w) => w.res?.platform?.balance)
			.filter((b) => typeof b === 'number')
			.pop(),
	};
	if (!(await waitFor({ idle: true }, 3600)).ok) throw new Error('never idle after boot');
	for (const [i, round] of plan.rounds.entries()) {
		if (round.reload) {
			await boot();
			const w = await wire();
			result.rounds.push({
				label: round.label,
				reload: true,
				wire: w,
				state: await state(),
				shot: await shot(i + 1, round.label),
			});
			continue;
		}
		const before = (await wire()).length;
		if (round.force) {
			const res = await fetch(
				`${rgs}/force?sid=${encodeURIComponent(sid)}&beat=${encodeURIComponent(round.force)}`,
				{ method: 'POST' },
			);
			if (!res.ok) {
				result.rounds.push({
					label: round.label,
					forceRefused: `${res.status} ${await res.text()}`,
				});
				continue;
			}
		}
		// `clicks`: [[x, y], …] at 1280×720 (a buy: the button, the option, the confirm), each
		// followed by 30 frames; `shotEachClick` keeps a picture after each, to find the next one.
		if (round.cutAfterPlays !== undefined)
			await page.evaluate(`window.__SAMPLE_CUT__ = ${round.cutAfterPlays}`);
		const betsBefore = (await wire()).filter((w) => /"action":"bet"/.test(w.req ?? '')).length;
		const betSent = async () =>
			(await wire()).filter((w) => /"action":"bet"/.test(w.req ?? '')).length > betsBefore;
		// `clicks`: [[x, y], …] at 1280×720 (a buy: the button, the option, the confirm), each
		// followed by 30 frames; `shotEachClick` keeps a picture after each, to find the next one.
		if (round.clicks) {
			// A banner left on show swallows the first click: the sequence is retried once.
			for (let attempt = 0; attempt < 2 && !(await betSent()); attempt++) {
				for (const [c, [x, y]] of round.clicks.entries()) {
					await click(x, y);
					if (round.shotEachClick) await shot(i + 1, `${round.label}-${attempt}-click${c}`);
				}
				for (let f = 0; f < 6 && !(await betSent()); f++) await step(20);
			}
		} else {
			// A win banner left on show takes a tap without spinning: tap again until a bet goes out.
			for (let tap = 0; tap < 4 && !(await betSent()); tap++) {
				await space();
				for (let f = 0; f < 6 && !(await betSent()); f++) await step(20);
			}
		}
		const started = { ok: await betSent() };
		// `holdCheck: N`: once the feature is in (its first respin answer is back, then 600 frames),
		// run N frames with no input in `holdCheck / 60` slices and count how many slices changed
		// pixels. An auto mode keeps playing; a manual one waits on its SPIN press and stays still.
		let holdCheck;
		if (round.holdCheck) {
			const plays = async () =>
				(await wire()).slice(before).filter((w) => /^\[\{"action":"play"\}\]$/.test(w.req ?? ''))
					.length;
			for (let f = 0; f < 3000 && (await plays()) < 1; f += 30) await step(30);
			await step(600);
			const frames = [];
			for (let f = 0; f <= round.holdCheck; f += 60) {
				await step(f ? 60 : 1);
				frames.push(PNG.sync.read(await page.screenshot()));
			}
			let moving = 0;
			for (let k = 1; k < frames.length; k++) {
				const { width, height } = frames[k];
				const diff = pixelmatch(frames[k - 1].data, frames[k].data, null, width, height, {
					threshold: 0.1,
				});
				if (diff > width * height * 0.002) moving++;
			}
			holdCheck = { frames: round.holdCheck, slices: frames.length - 1, slicesThatMoved: moving };
			await shot(i + 1, `${round.label}-held`);
		}
		// `reloadAfterPlays: n` (+ `reloadOnReels: r`): reload the page (same session) once n
		// in-feature answers have come back (counting only boards r reels wide, when given), then
		// finish the round from the resumed state.
		let resumed;
		// `reloadOnEvent: name`: reload on the first frame an answer carrying that event is back —
		// with the round still open on the server (before its in-feature requests and collect).
		if (round.reloadOnEvent) {
			const has = async () =>
				(await wire())
					.slice(before)
					.some((w) => (w.res?.events ?? []).some((e) => e.event === round.reloadOnEvent));
			for (let f = 0; f < 3000 && !(await has()); f++) await step(1);
		}
		if (round.reloadAfterFrames) {
			for (let f = 0; f < round.reloadAfterFrames; f += 30) await step(30);
		}
		if (round.cutAfterPlays !== undefined) for (let f = 0; f < 600; f += 30) await step(30);
		if (
			round.reloadAfterPlays ||
			round.reloadAfterFrames ||
			round.reloadOnEvent ||
			round.cutAfterPlays !== undefined
		) {
			const plays = async () =>
				(await wire())
					.slice(before)
					.filter((w) => /^\[\{"action":"play"\}\]$/.test(w.req ?? ''))
					.filter(
						(w) =>
							!round.reloadOnReels ||
							(w.res?.events ?? []).some(
								(e) => e.event === 'playedSpin' && e.context.length === round.reloadOnReels,
							),
					).length;
			for (let f = 0; f < 12000 && (await plays()) < (round.reloadAfterPlays ?? 0); f += 5) {
				await step(5);
				if (f % 300 === 295) await space();
			}
			const atReload = await plays();
			const kept = await wire();
			await shot(i + 1, `${round.label}-before-reload`);
			await boot();
			await shot(i + 1, `${round.label}-after-reload`);
			// The page's own wire log starts over: carry the pre-reload half.
			await page.evaluate(`window.__SAMPLE_WIRE__.unshift(...${JSON.stringify(kept)})`);
			resumed = { atReload, screens: (await state()).screens };
		}
		// Tap past any hold (intro / outro / tap-to-continue) until the round settles.
		const max = round.maxFrames ?? 30000;
		let settled = false;
		let peakWin = 0;
		const seen = new Set();
		for (let ran = 0; ran < max && !settled; ran += 300) {
			const r = await waitFor({ idle: true }, 300);
			settled = r.ok;
			peakWin = Math.max(peakWin, r.state.win);
			for (const s of r.state.screens) seen.add(s);
			if (!settled && round.midShots?.includes(ran)) await shot(i + 1, `${round.label}-mid${ran}`);
			if (!settled) await space();
		}
		const s = await state();
		const all = await wire();
		result.rounds.push({
			label: round.label,
			started: started.ok,
			holdCheck,
			resumed,
			settled,
			state: s,
			peakWin,
			screensSeen: [...seen],
			wire: all.slice(before),
			shot: await shot(i + 1, round.label),
		});
	}
} catch (e) {
	result.errors.push(String(e?.stack ?? e));
}
result.console = page.consoleLines;
result.summary = summarize(result);
result.final = await state().catch(() => null);
result.serverLog = server.log().slice(-3000);
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
await page.close();
server.stop();
await snap.close();
rmSync(work, { recursive: true, force: true });
for (const row of result.summary) console.log(JSON.stringify(row));
console.log(
	`${plan.key}: ${result.rounds.length} round(s), errors ${result.errors.length}, console ${result.console.length}, final ${JSON.stringify(result.final)}`,
);
