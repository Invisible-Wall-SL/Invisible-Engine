/**
 * Network sniffer — monkey-patches fetch + XMLHttpRequest in the page so every
 * outbound request is logged to the console and captured to window.eaSniffed.
 *
 * Usage (paste into the iframe console where the game runs):
 *   1. Paste this whole file.
 *   2. Click Spin in the game once or twice.
 *   3. Run:  copy(eaSniffed)
 *   4. Paste back into chat.
 */

(function () {
	if (window.eaSniffed) {
		console.log('[sniff] already installed — clearing previous capture');
		window.eaSniffed.length = 0;
		return;
	}

	const captured = [];
	window.eaSniffed = captured;

	const summarize = (entry) => {
		const tag = entry.method.padEnd(4) + ' ' + entry.url;
		console.log(`[sniff] ${tag}`, entry);
	};

	// ----- fetch -----
	const origFetch = window.fetch.bind(window);
	window.fetch = async (input, init = {}) => {
		const url = typeof input === 'string' ? input : input.url;
		const method = (init.method || (input && input.method) || 'GET').toUpperCase();
		const reqBody = init.body ?? (input && input.body) ?? null;
		const t0 = performance.now();
		const entry = {
			kind: 'fetch',
			method,
			url,
			origin: location.origin,
			requestBody: typeof reqBody === 'string' ? reqBody : reqBody ? '[non-string body]' : null,
			requestHeaders: init.headers ?? null,
			ts: new Date().toISOString(),
		};
		try {
			const res = await origFetch(input, init);
			const clone = res.clone();
			let text = '';
			try {
				text = await clone.text();
			} catch {}
			entry.status = res.status;
			entry.statusText = res.statusText;
			entry.ms = Math.round(performance.now() - t0);
			entry.responseBody = text.length > 8000 ? text.slice(0, 8000) + '…[truncated]' : text;
			captured.push(entry);
			summarize(entry);
			return res;
		} catch (err) {
			entry.error = String(err);
			entry.ms = Math.round(performance.now() - t0);
			captured.push(entry);
			summarize(entry);
			throw err;
		}
	};

	// ----- XMLHttpRequest -----
	const OrigXHR = window.XMLHttpRequest;
	function PatchedXHR() {
		const xhr = new OrigXHR();
		const entry = {
			kind: 'xhr',
			method: 'GET',
			url: '',
			origin: location.origin,
			requestBody: null,
			ts: new Date().toISOString(),
		};
		const origOpen = xhr.open;
		xhr.open = function (method, url) {
			entry.method = String(method).toUpperCase();
			entry.url = url;
			return origOpen.apply(xhr, arguments);
		};
		const origSend = xhr.send;
		xhr.send = function (body) {
			entry.requestBody = typeof body === 'string' ? body : body ? '[non-string body]' : null;
			const t0 = performance.now();
			xhr.addEventListener('loadend', () => {
				entry.status = xhr.status;
				entry.statusText = xhr.statusText;
				entry.ms = Math.round(performance.now() - t0);
				const txt = typeof xhr.responseText === 'string' ? xhr.responseText : '';
				entry.responseBody = txt.length > 8000 ? txt.slice(0, 8000) + '…[truncated]' : txt;
				captured.push(entry);
				summarize(entry);
			});
			return origSend.apply(xhr, arguments);
		};
		return xhr;
	}
	PatchedXHR.prototype = OrigXHR.prototype;
	window.XMLHttpRequest = PatchedXHR;

	console.log('[sniff] installed — fetch + XHR captured into window.eaSniffed');
	console.log('[sniff] click Spin a few times, then run:  copy(eaSniffed)');
})();
