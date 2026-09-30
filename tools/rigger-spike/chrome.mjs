// The one headless Chromium every browser spike drives. A spike does
//   const browser = await launchChrome({ name: 'skins', url, args: ['--window-size=1600,1000'] });
//   … await browser.evaluate(expr) / browser.waitFor(expr) / browser.pageLog …
//   await browser.close();
// and never spawns Chrome itself: the five copies this replaces had drifted apart (two never closed
// Chrome, two never timed out a CDP call, one never removed its profile).
//
// WHY IT LOOKS LIKE THIS: the copies read the DevTools URL off Chrome's stderr and gave up after
// 20 s, and on the 2-core CI runner Chrome sometimes had not printed it by then — "no devtools
// endpoint" failed a required check on unrelated PRs, and re-runs passed. So:
//   - CDP goes over `--remote-debugging-pipe` (fds 3/4): no port, no URL to parse, and Chrome exits
//     by itself when the spike does, whatever killed it;
//   - "started" means Chrome ANSWERED a CDP call and has a page attached, not that it printed a line;
//   - only that launch is retried, a bounded number of times, each on a fresh profile. It opens
//     about:blank, so a launch that is thrown away never reached the spike's server; the spike's
//     page is navigated to once, after. Nothing past `launchChrome` is retried: a page that hangs
//     fails its CDP call's timeout, and a Chrome that never starts fails with its stderr.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const LAUNCH_ATTEMPTS = 3;
const LAUNCH_TIMEOUT_MS = 45_000;
const POSIX = process.platform !== 'win32';

const BASE_ARGS = [
	'--headless',
	'--remote-debugging-pipe',
	'--no-sandbox',
	'--disable-dev-shm-usage',
	// No GPU in CI or the headless shell; the tools under test need WebGL, so the software rasteriser.
	'--use-gl=angle',
	'--use-angle=swiftshader',
	'--enable-unsafe-swiftshader',
	// Nothing at startup that can wait on the network, the keyring or D-Bus.
	'--no-first-run',
	'--no-default-browser-check',
	'--password-store=basic',
	'--use-mock-keychain',
	'--disable-background-networking',
	'--disable-component-update',
	'--disable-breakpad',
	'--disable-sync',
];

/** `CHROME_PATH` wins (a CI image's system Chrome needs no download); else any Playwright Chromium. */
export function findChromium() {
	if (process.env.CHROME_PATH)
		return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
	const bases = [
		process.env.PLAYWRIGHT_BROWSERS_PATH,
		process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
		join(homedir(), '.cache', 'ms-playwright'),
		join(homedir(), 'Library', 'Caches', 'ms-playwright'),
	].filter((b) => b && existsSync(b));
	const rels = [
		join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
		join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
		join('chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
		join('chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
		join('chrome-win', 'chrome.exe'),
		join('chrome-linux64', 'chrome'),
		join('chrome-linux', 'chrome'),
	];
	for (const base of bases)
		for (const dir of readdirSync(base))
			for (const rel of rels) {
				const p = join(base, dir, rel);
				if (existsSync(p)) return p;
			}
	return null;
}

const describe = (details) => details.exception?.description ?? details.text ?? JSON.stringify(details);

/** One Chrome process and its CDP pipe. Resolves once Chrome answers and a page is attached. */
async function start(binary, name, extraArgs, cdpTimeoutMs) {
	const profile = mkdtempSync(join(tmpdir(), `${name}-cdp-`));
	const chrome = spawn(binary, [...BASE_ARGS, ...extraArgs, `--user-data-dir=${profile}`, 'about:blank'], {
		stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
		// Its own process group, so a kill takes the renderer and GPU processes with it.
		detached: POSIX,
		windowsHide: true,
	});
	let stderr = '';
	chrome.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));
	const exited = new Promise((r) => chrome.once('exit', (code, signal) => r({ code, signal })));
	let gone = null;
	exited.then((e) => (gone = e));

	const kill = () => {
		if (gone) return;
		try {
			if (POSIX) process.kill(-chrome.pid, 'SIGKILL');
			else chrome.kill('SIGKILL');
		} catch {
			// already gone
		}
	};
	const removeProfile = () => {
		try {
			rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		} catch {
			// a temp profile a dying Chrome still holds is not worth failing the gate over
		}
	};
	// A spike that throws past its `finally` (or never had one) still takes Chrome down with it.
	const onExit = () => {
		kill();
		removeProfile();
	};
	process.once('exit', onExit);

	const [toChrome, fromChrome] = [chrome.stdio[3], chrome.stdio[4]];
	toChrome.on('error', () => {});
	let msgId = 0;
	const pending = new Map();
	const listeners = [];
	let buf = '';
	fromChrome.on('data', (chunk) => {
		buf += chunk;
		let end;
		while ((end = buf.indexOf('\0')) >= 0) {
			const msg = JSON.parse(buf.slice(0, end));
			buf = buf.slice(end + 1);
			if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
			else for (const l of listeners) l(msg);
		}
	});
	exited.then(({ code, signal }) => {
		for (const settle of pending.values())
			settle(null, new Error(`Chrome exited (${signal ?? code}) — stderr:\n${stderr}`));
	});

	/** A CDP call; rejects when unanswered in `timeoutMs`, so a hung page fails instead of stalling. */
	const cdp = (method, params = {}, sessionId, timeoutMs = cdpTimeoutMs) =>
		new Promise((resolve, reject) => {
			if (gone) return reject(new Error(`${method}: Chrome has exited — stderr:\n${stderr}`));
			const id = ++msgId;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`${method} got no answer in ${timeoutMs / 1000} s`));
			}, timeoutMs);
			pending.set(id, (msg, err) => {
				clearTimeout(timer);
				pending.delete(id);
				if (err) reject(err);
				else resolve(msg);
			});
			toChrome.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
		});

	const shutdown = async () => {
		process.removeListener('exit', onExit);
		if (!gone) {
			// From the inside first: a killed Chrome can leave children holding the profile open.
			toChrome.write(JSON.stringify({ id: ++msgId, method: 'Browser.close' }) + '\0');
			await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
			kill();
			await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
		}
		toChrome.destroy();
		fromChrome.destroy();
		removeProfile();
	};

	try {
		const began = Date.now();
		await cdp('Browser.getVersion', {}, undefined, LAUNCH_TIMEOUT_MS);
		const { result: targets } = await cdp('Target.getTargets');
		let targetId = targets.targetInfos.find((t) => t.type === 'page')?.targetId;
		if (!targetId) ({ targetId } = (await cdp('Target.createTarget', { url: 'about:blank' })).result);
		const { result: attached } = await cdp('Target.attachToTarget', { targetId, flatten: true });
		return { cdp, listeners, session: attached.sessionId, shutdown, readyMs: Date.now() - began };
	} catch (e) {
		await shutdown();
		throw new Error(`${e.message}${gone ? '' : `\n  stderr so far:\n${stderr}`}`);
	}
}

/**
 * Start a headless Chromium on a fresh profile, attach to its page, enable Runtime and open `url`.
 *
 * @param {object} opts
 * @param {string} opts.name  profile prefix and log label
 * @param {string} [opts.url]  the page to open once Chrome is up
 * @param {string[]} [opts.args]  extra Chrome switches (`--window-size=…`)
 * @param {boolean} [opts.logAll]  keep `console.log` lines in `pageLog` too, not only warn/error
 * @param {number} [opts.cdpTimeoutMs]  how long one CDP call may go unanswered
 */
export async function launchChrome({ name, url, args = [], logAll = false, cdpTimeoutMs = 30_000 }) {
	const binary = findChromium();
	if (!binary) {
		console.error(
			'No Chromium found (set CHROME_PATH, or: npx playwright install chromium-headless-shell) — this gate needs a real browser.',
		);
		process.exit(1);
	}
	const failures = [];
	let chrome;
	for (let attempt = 1; !chrome; attempt++) {
		try {
			chrome = await start(binary, name, args, cdpTimeoutMs);
			console.log(`[chrome] ready in ${chrome.readyMs} ms (attempt ${attempt} of ${LAUNCH_ATTEMPTS})`);
		} catch (e) {
			failures.push(`attempt ${attempt}: ${e.message}`);
			console.log(`[chrome] launch attempt ${attempt} of ${LAUNCH_ATTEMPTS} failed — ${e.message.split('\n')[0]}`);
			if (attempt === LAUNCH_ATTEMPTS)
				throw new Error(`Chrome did not start in ${LAUNCH_ATTEMPTS} attempts:\n${failures.join('\n')}`);
		}
	}
	const { cdp, listeners, session, shutdown } = chrome;

	// A silent browser failure (a GL context that never initialises, a 404) is exactly the class of
	// bug these gates exist to catch; without the page's own console it surfaces as "result was null".
	const pageLog = [];
	listeners.push((msg) => {
		if (msg.method === 'Runtime.consoleAPICalled' && (logAll || msg.params.type !== 'log'))
			pageLog.push(
				`[${msg.params.type}] ` +
					msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
			);
		if (msg.method === 'Runtime.exceptionThrown')
			pageLog.push(`[uncaught] ${describe(msg.params.exceptionDetails)}`);
	});
	await cdp('Runtime.enable', {}, session);
	if (url) await cdp('Page.navigate', { url }, session);

	/** Evaluate an (async) expression in the page and return its value, or throw its error. */
	async function evaluate(expression) {
		const res = await cdp(
			'Runtime.evaluate',
			{ expression, awaitPromise: true, returnByValue: true },
			session,
		);
		if (res.error) throw new Error(JSON.stringify(res.error));
		const r = res.result;
		if (r.exceptionDetails) throw new Error(describe(r.exceptionDetails));
		return r.result.value;
	}

	/** Poll `expr` until it is truthy (throwing reads as not yet), or throw after `ms`. */
	async function waitFor(expr, ms = 20_000) {
		const t0 = Date.now();
		for (;;) {
			const v = await evaluate(expr).catch(() => false);
			if (v) return v;
			if (Date.now() - t0 > ms) throw new Error('timed out waiting for: ' + expr);
			await new Promise((r) => setTimeout(r, 120));
		}
	}

	return { evaluate, waitFor, pageLog, close: shutdown };
}
