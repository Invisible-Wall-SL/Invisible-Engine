// Real-clock probe for the OPERATOR HOST SETTINGS (`GameSettings.config`): boots a game in a
// VISIBLE, 60 fps headless Chromium, slams a run of spins with Space, and records what an operator's
// declaration may change — so one run WITHOUT any declaration can be diffed against another, and a
// run WITH one shows it honoured.
//
//   node scripts/playtest/host-settings-probe.mjs --url <game url> [--host '<json>'] [--spins 8]
//     [--label before] [--out <dir>] [--chrome <exe>] [--click x,y] [--answer x,y]
//
// `--inspect 'x,y;x,y'` clicks each point once the game is idle and screenshots after each — to
// look at a menu the operator's declaration changes (the autoplay ladder, the info page).
// `--answer x,y` is for `confirmGameRoundStart`: when a press has sent no bet within 2 s, the probe
// screenshots the question and clicks there (the dialog's CONFIRM, read off that screenshot).
//
// `--host` appends `?host=<json>`, which the Invisible Test Server (and a dev server) turn into the
// `window.params.GameSettings.config` a partner's embed page would carry. Omit it for the neutral
// run. The game URL of an online project carries its read token — pass it at run time, never
// commit it.
//
// What it records (summary.json):
//   - whether the served page carries an injected `window.params`, and what the page reads back;
//   - the operator chrome and any other text the game adds to the DOM;
//   - per spin: when Space went down, when the `bet` POST left and was answered, and the gap to the
//     next spin's POST. Space is pressed every 150 ms, so every spin is SLAMMED and every celebration
//     pressed through: the gap is the shortest round the game allows, which is exactly what
//     `minSpinDuration` and `confirmGameRoundStart` govern, and which must not move when neither is
//     declared.
//   - console errors and exceptions;
//   - screenshots at boot, idle, and after the run.
//
// Same browser launch as `win-countup-repro.mjs`: Playwright's `chrome-headless-shell` over
// --remote-debugging-pipe with the GPU on (the Browser pane is `hidden`, so rAF never fires there).

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
	options: {
		url: { type: 'string' },
		host: { type: 'string' },
		spins: { type: 'string', default: '8' },
		label: { type: 'string', default: 'run' },
		out: { type: 'string' },
		chrome: { type: 'string' },
		click: { type: 'string' },
		answer: { type: 'string' },
		inspect: { type: 'string' },
		'boot-ms': { type: 'string', default: '40000' },
	},
});
if (!opt.url) {
	console.error('--url <game url> is required');
	process.exit(1);
}

const url = new URL(opt.url);
if (opt.host) url.searchParams.set('host', JSON.stringify(JSON.parse(opt.host)));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = opt.out ?? join(tmpdir(), `ie-host-probe-${opt.label}-${stamp}`);
const SPINS = Number(opt.spins);
const W = 1456;
const H = 814;
const TAP = opt.click ? opt.click.split(',').map(Number) : [W / 2, H / 2];

const findHeadlessShell = () => {
	const exe = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
	const roots = [
		process.env.PLAYWRIGHT_BROWSERS_PATH,
		process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
		join(homedir(), '.cache', 'ms-playwright'),
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

const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
/** requestId → what we know of an RGS request. */
const requests = new Map();
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
			continue;
		}
		const p = msg.params;
		if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
			consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
		} else if (msg.method === 'Runtime.exceptionThrown') {
			consoleErrors.push(`[exception] ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`); // prettier-ignore
		} else if (msg.method === 'Network.requestWillBeSent' && /\/rgs\/engine/.test(p.request.url)) {
			requests.set(p.requestId, {
				sentAt: Date.now(),
				body: p.request.postData ?? '',
				url: p.request.url.replace(/([?&](sid|sessionID|k)=)[^&]+/g, '$1…'),
			});
		} else if (msg.method === 'Network.loadingFinished' && requests.has(p.requestId)) {
			const request = requests.get(p.requestId);
			request.answeredAt = Date.now();
			// The round's outcome, so a slow gap can be told apart: a win's presentation is longer.
			send('Network.getResponseBody', { requestId: p.requestId }, attached?.sessionId).then((r) => {
				const body = r.result?.body ?? '';
				request.won = /"event":"(spinWin|bonusWin|enterBonus)"/.test(body);
				request.feature = /"event":"enterBonus"/.test(body);
			});
		}
	}
});
const send = (method, params = {}, sessionId) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`); // prettier-ignore
	});

const { result: created } = await send('Target.createTarget', { url: 'about:blank' });
let attached;
({ result: attached } = await send('Target.attachToTarget', {
	targetId: created.targetId,
	flatten: true,
}));
const page = (method, params) => send(method, params, attached.sessionId);
await page('Runtime.enable');
await page('Page.enable');
await page('Network.enable');
await page('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }); // prettier-ignore
await page('Emulation.setFocusEmulationEnabled', { enabled: true });

const evalJs = async (expression) => {
	const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
	const details = r.result?.exceptionDetails;
	if (r.error || details) return { __error: r.error?.message ?? details.text };
	return r.result?.result?.value;
};
const click = async (x, y) => {
	await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
	await page('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); // prettier-ignore
	await sleep(70);
	await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); // prettier-ignore
};
const pressSpace = async () => {
	const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
	await page('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: ' ' });
	await sleep(40);
	await page('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};
let shotN = 0;
const shot = async (name) => {
	const r = await page('Page.captureScreenshot', { format: 'png' });
	const file = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
	writeFileSync(file, Buffer.from(r.result.data, 'base64'));
	log('screenshot', file);
};

/** What the page itself says about the operator: the served HTML, `window.params`, and DOM text. */
const pageFacts = () =>
	evalJs(`(async () => {
		const html = await fetch(location.href, { cache: 'no-store' }).then((r) => r.text()).catch(() => '');
		const texts = [...document.querySelectorAll('body *')]
			.filter((el) => el.children.length === 0 && el.textContent.trim() && el.offsetParent !== null)
			.map((el) => el.textContent.trim())
			.slice(0, 40);
		return {
			injected: html.includes('window.params='),
			params: window.params ?? null,
			domElements: document.querySelectorAll('body *').length,
			visibleTexts: texts,
			buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
		};
	})()`);

const summary = { label: opt.label, host: opt.host ? JSON.parse(opt.host) : null, spins: [] };

try {
	log('navigate', url.href.replace(/([?&]k=)[^&]+/, '$1…'));
	await page('Page.navigate', { url: url.href });
	await sleep(Number(opt['boot-ms']));
	await shot('boot');
	summary.boot = await pageFacts();
	log('boot facts', summary.boot);

	await click(...TAP);
	await sleep(6000);
	await shot('idle');
	summary.idle = await pageFacts();
	for (const [i, point] of (opt.inspect ? opt.inspect.split(';') : []).entries()) {
		await click(...point.split(',').map(Number));
		await sleep(1500);
		await shot(`inspect-${i + 1}`);
	}

	const betRequests = () =>
		[...requests.values()].filter((r) => /"action":"bet"/.test(r.body)).sort((a, b) => a.sentAt - b.sentAt); // prettier-ignore

	const startBets = betRequests().length;
	const deadline = Date.now() + SPINS * 20_000 + 30_000;
	let presses = 0;
	const ANSWER = opt.answer ? opt.answer.split(',').map(Number) : null;
	let lastBetAt = Date.now();
	let lastCount = betRequests().length;
	summary.answers = 0;
	while (betRequests().length - startBets < SPINS + 1 && Date.now() < deadline) {
		await pressSpace();
		presses += 1;
		await sleep(150);
		if (betRequests().length !== lastCount) {
			lastCount = betRequests().length;
			lastBetAt = Date.now();
		} else if (ANSWER && Date.now() - lastBetAt > 2000) {
			if (summary.answers === 0) await shot('question');
			await click(...ANSWER);
			summary.answers += 1;
			lastBetAt = Date.now();
		}
	}
	await sleep(4000);
	await shot('after-spins');
	summary.after = await pageFacts();

	const bets = betRequests().slice(startBets);
	summary.presses = presses;
	summary.spins = bets.map((r, i) => ({
		answeredInMs: r.answeredAt ? r.answeredAt - r.sentAt : null,
		gapToNextBetMs: bets[i + 1] ? bets[i + 1].sentAt - r.sentAt : null,
		won: r.won ?? null,
		feature: r.feature ?? null,
	}));
	const gaps = summary.spins.map((s) => s.gapToNextBetMs).filter((g) => g !== null);
	const losing = summary.spins.filter((s) => s.won === false && s.gapToNextBetMs !== null);
	summary.losingGapStats = losing.length
		? { n: losing.length, min: Math.min(...losing.map((s) => s.gapToNextBetMs)), max: Math.max(...losing.map((s) => s.gapToNextBetMs)) } // prettier-ignore
		: null;
	summary.gapStats = gaps.length
		? { n: gaps.length, min: Math.min(...gaps), max: Math.max(...gaps), median: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] } // prettier-ignore
		: null;
	summary.rgsRequests = [...requests.values()].map((r) => ({
		url: r.url,
		body: r.body.slice(0, 120),
	}));
	summary.consoleErrors = consoleErrors;
	writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
	log('gaps', summary.gapStats);
	log('losing-round gaps', summary.losingGapStats);
	log('console errors', consoleErrors.length);
	log('out', OUT);
	finish(0);
} catch (error) {
	log('probe failed', error?.stack ?? String(error));
	finish(1);
}
