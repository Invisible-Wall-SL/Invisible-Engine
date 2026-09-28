// Real-clock repro for the WIN count-up: plays `apps/lines` in a VISIBLE, 60 fps headless Chromium
// and watches every `setWin` → `winUpdate` count-up read-only, exiting 1 on a stall.
//
//   node scripts/playtest/win-countup-repro.mjs [--mode play|recon] [--url <game url>]
//     [--accel] [--tap] [--big-wins 8] [--run-ms 540000] [--spin 749,755|space]
//     [--out <dir>] [--chrome <exe>]
//
// Why: the Browser pane — and a Claude-in-Chrome tab whose window is not in front — is `hidden`,
// so rAF never fires, and hand-stepping Svelte's `raf.tasks` to get past that manufactured a
// count-up "stall" the engine does not have (2026-09-28, docs/status/engine.md). This drives
// Playwright's `chrome-headless-shell` over --remote-debugging-pipe (no network listener) with the
// GPU on, so the page is `visible`, focused and runs the real frame clock. Clicks are CDP input,
// i.e. trusted; nothing in the page's clocks or state is written.
//
// Needs, for the default --url: the book mock forcing free spins
// (`FORCE_TRIGGER=1 PORT=7788 node scripts/mock-rgs-server-book.mjs`), the lines dev server on the
// Play4Fun book transport (`PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=book pnpm --filter lines
// dev`, port 3001) and the headless shell (`npx playwright install chromium-headless-shell`).
//
//   --mode recon  boot, report fps + visibility, screenshot, exit
//   --mode play   spin until --big-wins big count-ups have completed or --run-ms has elapsed
//   --accel       author holdToSpeedUp + tapToSkip on every `winUpdate` node (via the
//                 `__IE_FLOW_V2_DOC__` dev hook), so `WinCountUpProvider` takes its accelerated
//                 `onSettle` path — the reference doc authors neither and runs the single tween
//   --tap         a ~1.2 s hold, then two taps, inside every big count-up (implies --accel: the
//                 reference doc's count-up has no tap surface)
//
// Writes log.txt, summary.json and screenshots to --out (default: a fresh dir under the OS temp).

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
	options: {
		mode: { type: 'string', default: 'play' },
		url: { type: 'string' },
		out: { type: 'string' },
		chrome: { type: 'string' },
		'run-ms': { type: 'string', default: '540000' },
		'big-wins': { type: 'string', default: '8' },
		spin: { type: 'string', default: '749,755' },
		accel: { type: 'boolean', default: false },
		tap: { type: 'boolean', default: false },
	},
});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const GAME_URL =
	opt.url ??
	`http://localhost:3001/?sessionID=countup-${Date.now()}&rgs_url=localhost:7788` +
		'&lang=en&currency=USD&device=desktop&flowV2=lines&flowlog=1';
const OUT = opt.out ?? join(tmpdir(), `ie-countup-${stamp}`);
const RUN_MS = Number(opt['run-ms']);
const TARGET_BIG_WINS = Number(opt['big-wins']);
const SPIN = opt.spin === 'space' ? null : opt.spin.split(',').map(Number);
const ACCEL = opt.accel || opt.tap;
// The viewport the spin coordinates were measured in.
const W = 1456;
const H = 814;
const CX = W / 2;
const CY = H / 2;
// A count-up sitting on its target this long without `countUpComplete` is the reported stall.
const STALL_MS = 4000;
const NO_PROGRESS_MS = 60_000;

/** The newest Playwright `chrome-headless-shell` on this machine. */
const findHeadlessShell = () => {
	const exe = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
	const roots = [
		process.env.PLAYWRIGHT_BROWSERS_PATH,
		process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
		join(homedir(), '.cache', 'ms-playwright'),
		join(homedir(), 'Library', 'Caches', 'ms-playwright'),
	].filter((root) => root && existsSync(root));
	for (const root of roots) {
		const builds = readdirSync(root)
			.filter((dir) => dir.startsWith('chromium_headless_shell-'))
			.sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
		for (const build of builds) {
			for (const platformDir of readdirSync(join(root, build))) {
				const path = join(root, build, platformDir, exe);
				if (existsSync(path)) return path;
			}
		}
	}
	return undefined;
};

const CHROME = opt.chrome ?? findHeadlessShell();
if (!CHROME) {
	console.error(
		'No chrome-headless-shell found — `npx playwright install chromium-headless-shell`.',
	);
	process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'log.txt'), '');
const log = (...parts) => {
	const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
	console.log(line);
	appendFileSync(join(OUT, 'log.txt'), `${line}\n`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Without the GPU flags the shell renders WebGL in software at ~12 fps. Measured on Windows (ANGLE
// on D3D11); elsewhere check the `fps` the run prints first.
const GPU_FLAGS =
	process.platform === 'win32'
		? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
		: ['--enable-gpu', '--ignore-gpu-blocklist'];

const chrome = spawn(
	CHROME,
	[
		'--headless',
		'--remote-debugging-pipe',
		`--user-data-dir=${join(OUT, 'profile')}`,
		`--window-size=${W},${H}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--autoplay-policy=no-user-gesture-required',
		...GPU_FLAGS,
		'about:blank',
	],
	{ stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
let finished = false;
chrome.on('error', (error) => {
	console.error(`Could not start ${CHROME}: ${error.message}`);
	process.exit(1);
});
chrome.on('exit', (code) => {
	if (finished) return;
	console.error(`Chromium exited early (code ${code}).`);
	process.exit(1);
});
const finish = (code) => {
	finished = true;
	chrome.kill();
	process.exit(code);
};
process.on('SIGINT', () => finish(130));

// CDP over the pipe: NUL-terminated JSON, one flattened session for the page.
const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let nextId = 1;
const pending = new Map();
const consoleLines = [];
let buf = Buffer.alloc(0);
fromChrome.on('data', (chunk) => {
	buf = Buffer.concat([buf, chunk]);
	let end;
	while ((end = buf.indexOf(0)) >= 0) {
		const msg = JSON.parse(buf.subarray(0, end).toString('utf8'));
		buf = buf.subarray(end + 1);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		} else if (msg.method === 'Runtime.consoleAPICalled') {
			const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
			consoleLines.push(`[${msg.params.type}] ${text}`);
		} else if (msg.method === 'Runtime.exceptionThrown') {
			const d = msg.params.exceptionDetails;
			consoleLines.push(`[exception] ${d.exception?.description ?? d.text}`);
		}
	}
});
const send = (method, params = {}, sessionId) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		const msg = { id, method, params, ...(sessionId ? { sessionId } : {}) };
		toChrome.write(`${JSON.stringify(msg)}\0`);
	});

const { result: created } = await send('Target.createTarget', { url: 'about:blank' });
const { result: attached } = await send('Target.attachToTarget', {
	targetId: created.targetId,
	flatten: true,
});
const page = (method, params) => send(method, params, attached.sessionId);
await page('Runtime.enable');
await page('Page.enable');
await page('Emulation.setDeviceMetricsOverride', {
	width: W,
	height: H,
	deviceScaleFactor: 1,
	mobile: false,
});
await page('Emulation.setFocusEmulationEnabled', { enabled: true });

const evalJs = async (expression) => {
	const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
	if (r.error) return { __error: r.error.message };
	const details = r.result?.exceptionDetails;
	if (details) return { __error: details.exception?.description ?? details.text };
	return r.result?.result?.value;
};
const mouse = (type, x, y) =>
	page('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
const click = async (x, y) => {
	await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
	await mouse('mousePressed', x, y);
	await sleep(70);
	await mouse('mouseReleased', x, y);
};
const pressSpace = async () => {
	const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
	await page('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: ' ' });
	await sleep(70);
	await page('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};
let shotN = 0;
const shot = async (name) => {
	const r = await page('Page.captureScreenshot', { format: 'png' });
	const file = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
	writeFileSync(file, Buffer.from(r.result.data, 'base64'));
	log('screenshot', file);
};
const measureFps = () =>
	evalJs(`new Promise((resolve) => {
		let frames = 0;
		const t0 = performance.now();
		const report = () => ({ fps: frames, vis: document.visibilityState, focus: document.hasFocus() });
		const f = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else resolve(report()); };
		requestAnimationFrame(f);
		setTimeout(() => resolve(report()), 3000);
	})`);

// READ-ONLY sample of the round: actor state, the win bridge, the flow-trace lines since the last
// sample, and frames rendered since the last sample.
const PROBE = `(async () => {
	const P = (window.__cuP ??= { mods: null, trIdx: 0, frames: 0 });
	if (!P.mods) {
		const [ws, ac] = await Promise.all([import('/src/game/winState.svelte.ts'), import('/src/game/actor.ts')]);
		P.mods = { winState: ws.winState, gameActor: ac.gameActor };
		const f = () => { P.frames++; requestAnimationFrame(f); };
		requestAnimationFrame(f);
	}
	const w = P.mods.winState;
	const tr = window.__IE_FLOW_V2_TRACE__ ?? [];
	const trNew = tr.slice(P.trIdx);
	P.trIdx = tr.length;
	const frames = P.frames;
	P.frames = 0;
	return {
		st: JSON.stringify(P.mods.gameActor.getSnapshot().value),
		lvl: w.winLevelData?.type ?? null,
		alias: w.winLevelData?.alias ?? null,
		dur: w.winLevelData?.presentDuration ?? null,
		amt: w.amount,
		cu: w.countUpAmount,
		done: w.countUpComplete,
		esc: w.escalationActive,
		ad: w.awaitingDismiss,
		handoff: w.cueHandoffAmount,
		trNew,
		frames,
	};
})()`;

// How many Svelte raf tasks are pending — read off the SAME module instance the app runs.
const RAF_TASKS = `(async () => {
	const url = performance.getEntriesByType('resource').map((e) => e.name)
		.find((n) => n.includes('/.vite/deps/svelte_internal_client.js'));
	if (!url) return 'svelte internal client not found';
	const m = await import(url);
	return { rafTasks: m.raf?.tasks?.size ?? 'no raf export' };
})()`;

log('mode', opt.mode, 'accel', ACCEL, 'tap', opt.tap, 'out', OUT);
log('url', GAME_URL);

// --accel: boot once to read the reference doc, patch it, and carry it across one reload through
// sessionStorage into the `__IE_FLOW_V2_DOC__` hook (which wins over `?flowV2=lines`).
if (ACCEL) {
	await page('Page.navigate', { url: GAME_URL });
	await sleep(6000);
	const patched = await evalJs(`(async () => {
		const m = await import('/src/game/flowV2Doc.ts');
		const doc = structuredClone(m.LINES_FLOW_V2_DOC);
		const on = { kind: 'literal', type: { t: 'bool' }, value: true };
		let n = 0;
		for (const node of doc.graph.nodes) {
			if (node.kind !== 'action' || node.ref !== 'winUpdate') continue;
			node.inputs = { ...node.inputs, holdToSpeedUp: on, tapToSkip: on };
			n++;
		}
		sessionStorage.setItem('__cuDoc', JSON.stringify(doc));
		sessionStorage.setItem('__cuLib', JSON.stringify(m.LINES_FLOW_V2_LIBRARY));
		return n;
	})()`);
	log('patched winUpdate nodes', patched);
	if (!(patched > 0)) finish(1);
	await page('Page.addScriptToEvaluateOnNewDocument', {
		source: `(() => {
			const doc = sessionStorage.getItem('__cuDoc');
			if (!doc) return;
			window.__IE_FLOW_V2_DOC__ = JSON.parse(doc);
			window.__IE_FLOW_V2_LIB__ = JSON.parse(sessionStorage.getItem('__cuLib'));
		})();`,
	});
}
await page('Page.navigate', { url: GAME_URL });

const bootStart = Date.now();
let booted = false;
while (!booted && Date.now() - bootStart < 90_000) {
	await sleep(1000);
	const state = await evalJs(`(async () => {
		if (!window.__PIXI_APP__) return 'no-pixi';
		const { gameActor } = await import('/src/game/actor.ts');
		return JSON.stringify(gameActor.getSnapshot().value);
	})()`);
	booted = typeof state === 'string' && state !== 'no-pixi' && state !== '"rendering"';
	if (booted) log('booted', state, `${Date.now() - bootStart}ms`);
}
log('fps', await measureFps());
await shot('boot');
if (!booted) {
	log('BOOT TIMEOUT — is the dev server + mock up, and does --url point at them?');
	log('console', consoleLines.filter((l) => /error|exception/i.test(l)).slice(-20));
	finish(1);
}

if (opt.mode === 'recon') {
	await sleep(1500);
	await click(CX, CY);
	await sleep(3000);
	log('fps after the start click', await measureFps());
	await shot('after-start-click');
	log('console', consoleLines.filter((l) => /error|exception|warn/i.test(l)).slice(-30));
	finish(0);
}

const countUps = [];
let cur = null;
let inFreeSpins = false;
let holdOpen = null;
let held = false;
let lastSpinPress = 0;
let lastClick = Date.now();
let lastChange = Date.now();
let lastSig = '';
let stall = null;
let bigWins = 0;
const t0 = Date.now();

await click(CX, CY); // the loading screen's "press anywhere to continue"

while (Date.now() - t0 < RUN_MS) {
	await sleep(250);
	const s = await evalJs(PROBE);
	if (!s || s.__error) {
		log('probe error', s);
		continue;
	}
	const now = Date.now();
	for (const line of s.trNew) {
		if (line.startsWith('event ▶ freeSpinTrigger')) inFreeSpins = true;
		if (line.startsWith('event ▶ freeSpinEnd')) inFreeSpins = false;
		if (line.startsWith('HOLD ')) holdOpen = line;
		if (line.startsWith('RELEASE ')) holdOpen = null;
		if (line === 'action winUpdate') {
			cur = { start: now, inFreeSpins, samples: 0, frames: 0, targetAt: null, latchAt: null };
		} else if (cur && !cur.endedAt && line.startsWith('action ')) {
			cur.endedAt = now;
			cur.nextAction = line;
		}
	}

	if (cur) {
		cur.samples++;
		cur.frames += s.frames;
		Object.assign(cur, { amt: s.amt, lvl: s.lvl, alias: s.alias, dur: s.dur, handoff: s.handoff });
		if (cur.targetAt === null && s.amt > 0 && s.cu >= s.amt) cur.targetAt = now;
		// `winHide` resets the latch, so a count-up that lands between two samples can end without
		// one sample ever seeing it true; the chain moving on (`endedAt`) is the completion then.
		if (cur.latchAt === null && s.done) cur.latchAt = now;
		if (cur.endedAt) {
			if (held) {
				await mouse('mouseReleased', CX, CY);
				held = false;
			}
			const rec = {
				amt: cur.amt,
				lvl: cur.lvl,
				alias: cur.alias,
				presentDuration: cur.dur,
				handoff: cur.handoff,
				inFreeSpins: cur.inFreeSpins,
				msToTarget: cur.targetAt && cur.targetAt - cur.start,
				msToLatch: cur.latchAt && cur.latchAt - cur.start,
				msToNextAction: cur.endedAt - cur.start,
				fps: Math.round(cur.frames / ((cur.endedAt - cur.start) / 1000)),
				nextAction: cur.nextAction,
			};
			countUps.push(rec);
			if (rec.lvl === 'big') bigWins++;
			log('COUNT-UP', rec);
			cur = null;
		} else if (cur.targetAt && !s.done && now - cur.targetAt > STALL_MS) {
			stall = { kind: 'at-target-not-complete', state: s, cur, raf: await evalJs(RAF_TASKS) };
			log('STALL', stall);
			await shot('stall');
			break;
		} else if (cur.lvl === 'big' && cur.samples === 8) {
			await shot(`bigwin-${bigWins + 1}-counting`);
		}
	}

	const sig = JSON.stringify({ st: s.st, cu: s.cu, done: s.done });
	if (sig !== lastSig || s.trNew.length) {
		lastSig = sig;
		lastChange = now;
	}
	if (s.trNew.length) {
		log(`[${Math.round((now - t0) / 1000)}s ${s.st} fps~${s.frames * 4}]`, s.trNew.join(' | '));
	}
	if (bigWins >= TARGET_BIG_WINS && s.st === '"idle"') break;

	// While a count-up runs, leave it alone unless --tap: a hold that spans several samples
	// (speed-up → `retarget`), then two taps (tier step / slam).
	if (cur) {
		if (opt.tap && cur.lvl === 'big') {
			if (cur.samples === 6) {
				log('hold start', { cu: s.cu, amt: s.amt });
				await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: CX, y: CY });
				await mouse('mousePressed', CX, CY);
				held = true;
			} else if (cur.samples === 11 && held) {
				log('hold end', { cu: s.cu, amt: s.amt });
				await mouse('mouseReleased', CX, CY);
				held = false;
			} else if (cur.samples === 20 || cur.samples === 28) {
				log('tap', { cu: s.cu, amt: s.amt });
				await click(CX, CY);
			}
			lastClick = now;
		}
		continue;
	}
	if (s.st === '"idle"' && now - lastSpinPress > 2000) {
		if (SPIN) await click(SPIN[0], SPIN[1]);
		else await pressSpace();
		lastSpinPress = now;
	} else if (holdOpen && now - lastClick > 1500) {
		await click(CX, CY);
		lastClick = now;
	} else if (now - lastChange > 8000 && now - lastClick > 8000) {
		// A player-gated beat the trace shows no HOLD for (e.g. the outro count-up's tap).
		log('no change for 8s, tapping the centre', s.st);
		await click(CX, CY);
		lastClick = now;
	}
	if (now - lastChange > NO_PROGRESS_MS) {
		stall = { kind: 'no-progress', state: s, holdOpen, raf: await evalJs(RAF_TASKS) };
		log('STALL', stall);
		await shot('stall-no-progress');
		break;
	}
}

const summary = {
	url: GAME_URL,
	accel: ACCEL,
	tap: opt.tap,
	runMs: Date.now() - t0,
	countUps: countUps.length,
	bigWins,
	bigWinsInFreeSpins: countUps.filter((c) => c.lvl === 'big' && c.inFreeSpins).length,
	stall,
	allCountUps: countUps,
	errors: consoleLines.filter((l) => /^\[(error|exception)\]/.test(l)).slice(-40),
};
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
log('SUMMARY', {
	countUps: summary.countUps,
	bigWins,
	inFreeSpins: summary.bigWinsInFreeSpins,
	stall: stall?.kind ?? null,
	consoleErrors: summary.errors.length,
	out: OUT,
});
finish(stall ? 1 : 0);
