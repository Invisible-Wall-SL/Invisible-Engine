// One headless-shell page over CDP, pinned the way every harness capture must be: 1280×720, DPR 1,
// time zone UTC, locale en-US, focused. The launch itself is `scripts/playtest/headless-shell.mjs`.
// With `intercept`, requests to the Typekit hosts never reach the network: the mirror answers them
// (`typekit.mjs`), and a kit URL it lacks is refused and recorded in `unmirrored`.

import { spawnHeadlessShell } from '../../playtest/headless-shell.mjs';
import { TYPEKIT_HOSTS } from './typekit.mjs';

const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };

/** Console errors and uncaught exceptions are kept (the last 50) for the report. */
export async function openPage(chromePath, profile, { intercept } = {}) {
	const chrome = spawnHeadlessShell(chromePath, {
		profile,
		width: VIEWPORT.width,
		height: VIEWPORT.height,
	});
	const pending = new Map();
	const consoleLines = [];
	// Every request the page makes to a host other than the harness's own (127.0.0.1): its
	// outcome, in order. A third-party host answers each render on its own terms; one the mirror
	// answered says `mirror`, one it lacked says `unmirrored`.
	const external = [];
	const unmirrored = [];
	const requests = new Map();
	const answered = new Set();
	const keep = (line) => {
		consoleLines.push(line);
		if (consoleLines.length > 50) consoleLines.shift();
	};
	let nextId = 1;
	let buf = Buffer.alloc(0);
	let exited = false;
	let onPaused;
	const gone = () => {
		exited = true;
		for (const resolve of pending.values()) resolve({ error: { message: 'browser exited' } });
		pending.clear();
	};
	chrome.on('exit', gone);
	// 'close' follows 'exit' once stderr has drained, so the reason is complete by then.
	const closed = new Promise((resolve) => chrome.once('close', resolve));
	// A shell that dies at launch resets the CDP pipes. Unheard, that error aborts the whole shard
	// (exit 1, no report, the shell's own reason lost); heard, it is this game's error.
	chrome.stdio[3].on('error', gone);
	chrome.stdio[4].on('error', gone);
	chrome.stdio[4].on('data', (chunk) => {
		buf = Buffer.concat([buf, chunk]);
		let end;
		while ((end = buf.indexOf(0)) >= 0) {
			const msg = JSON.parse(buf.subarray(0, end).toString('utf8'));
			buf = buf.subarray(end + 1);
			if (msg.id && pending.has(msg.id)) {
				pending.get(msg.id)(msg);
				pending.delete(msg.id);
			} else if (msg.method === 'Runtime.exceptionThrown') {
				const d = msg.params.exceptionDetails;
				keep(`[exception] ${d.exception?.description ?? d.text}`);
			} else if (msg.method === 'Fetch.requestPaused') {
				onPaused?.(msg.params);
			} else if (msg.method === 'Network.requestWillBeSent') {
				const url = msg.params.request.url;
				if (
					/^https?:/.test(url) &&
					new URL(url).hostname !== '127.0.0.1' &&
					!answered.has(msg.params.requestId)
				)
					requests.set(msg.params.requestId, url);
			} else if (msg.method === 'Network.responseReceived' && requests.has(msg.params.requestId)) {
				external.push(`${msg.params.response.status} ${requests.get(msg.params.requestId)}`);
				requests.delete(msg.params.requestId);
			} else if (msg.method === 'Network.loadingFailed' && requests.has(msg.params.requestId)) {
				external.push(`${msg.params.errorText} ${requests.get(msg.params.requestId)}`);
				requests.delete(msg.params.requestId);
			} else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
				keep(`[error] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
			}
		}
	});
	const send = (method, params = {}, sessionId) =>
		new Promise((resolve) => {
			if (exited) return resolve({ error: { message: 'browser exited' } });
			const id = nextId++;
			pending.set(id, resolve);
			chrome.stdio[3].write(
				`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
			);
		});
	const { result: created } = await send('Target.createTarget', { url: 'about:blank' });
	if (!created) {
		chrome.kill();
		await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
		throw new Error(
			`the headless shell exited before answering: ${chrome.stderrTail() || '(no stderr)'}`,
		);
	}
	const { result: attached } = await send('Target.attachToTarget', {
		targetId: created.targetId,
		flatten: true,
	});
	const page = (method, params) => send(method, params, attached.sessionId);
	await page('Runtime.enable');
	await page('Page.enable');
	await page('Network.enable');
	if (intercept) {
		// `intercept(url)`: `{ contentType, body }` to serve, `null` to refuse (a kit URL the mirror
		// lacks), `undefined` to let through. Fonts are CORS requests, hence the allow-origin.
		onPaused = ({ requestId, request, networkId }) => {
			const answer = intercept(request.url);
			if (answer === undefined) return page('Fetch.continueRequest', { requestId });
			if (networkId) {
				answered.add(networkId);
				requests.delete(networkId);
			}
			if (answer === null) {
				unmirrored.push(request.url);
				external.push(`unmirrored ${request.url}`);
				return page('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
			}
			external.push(`mirror ${request.url}`);
			return page('Fetch.fulfillRequest', {
				requestId,
				responseCode: 200,
				responseHeaders: [
					{ name: 'Content-Type', value: answer.contentType },
					{ name: 'Access-Control-Allow-Origin', value: '*' },
					{ name: 'Cache-Control', value: 'no-store' },
				],
				body: answer.body.toString('base64'),
			});
		};
		await page('Fetch.enable', {
			patterns: TYPEKIT_HOSTS.map((host) => ({ urlPattern: `*://${host}/*` })),
		});
	}
	await page('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });
	await page('Emulation.setFocusEmulationEnabled', { enabled: true });
	await page('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
	await page('Emulation.setLocaleOverride', { locale: 'en-US' });

	const evaluate = async (expression) => {
		const { result, error } = await page('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (error) throw new Error(error.message);
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
			);
		return result.result.value;
	};
	const key = (type) =>
		page('Input.dispatchKeyEvent', {
			type,
			key: ' ',
			code: 'Space',
			windowsVirtualKeyCode: 32,
			nativeVirtualKeyCode: 32,
		});
	const screenshot = async () => {
		const { result, error } = await page('Page.captureScreenshot', { format: 'png' });
		if (error) throw new Error(`screenshot: ${error.message}`);
		return Buffer.from(result.data, 'base64');
	};
	return {
		page,
		evaluate,
		key,
		screenshot,
		consoleLines,
		external,
		unmirrored,
		/** Chrome's GPU feature status (`chrome://gpu`): which paths this browser renders with. */
		gpuStatus: async () => (await send('SystemInfo.getInfo')).result?.gpu?.featureStatus ?? {},
		navigate: (url) => page('Page.navigate', { url }),
		/** Resolves once the browser has exited, so its profile can be deleted. */
		close: () =>
			new Promise((resolve) => {
				if (exited) return resolve();
				chrome.once('exit', resolve);
				chrome.kill();
			}),
	};
}
