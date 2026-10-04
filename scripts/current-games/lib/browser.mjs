// One headless-shell page over CDP, pinned the way every harness capture must be: 1280×720, DPR 1,
// time zone UTC, locale en-US, focused. The launch itself is `scripts/playtest/headless-shell.mjs`.

import { spawnHeadlessShell } from '../../playtest/headless-shell.mjs';

export const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };

/** Console errors and uncaught exceptions are kept (the last 50) for the report. */
export async function openPage(chromePath, profile) {
	const chrome = spawnHeadlessShell(chromePath, {
		profile,
		width: VIEWPORT.width,
		height: VIEWPORT.height,
	});
	const pending = new Map();
	const consoleLines = [];
	const keep = (line) => {
		consoleLines.push(line);
		if (consoleLines.length > 50) consoleLines.shift();
	};
	let nextId = 1;
	let buf = Buffer.alloc(0);
	let exited = false;
	chrome.on('exit', () => {
		exited = true;
		for (const resolve of pending.values()) resolve({ error: { message: 'browser exited' } });
		pending.clear();
	});
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
	const { result: attached } = await send('Target.attachToTarget', {
		targetId: created.targetId,
		flatten: true,
	});
	const page = (method, params) => send(method, params, attached.sessionId);
	await page('Runtime.enable');
	await page('Page.enable');
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
