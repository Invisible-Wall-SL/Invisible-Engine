/**
 * EAGaming browser-console probe.
 *
 * EAGaming sits behind Cloudflare managed challenge, so server-side fetches
 * (Node, curl) get bounced. Running from the live game tab inherits the
 * already-solved challenge, the session cookies, and a real browser TLS
 * fingerprint — Cloudflare lets us straight through.
 *
 * Usage:
 *   1. Open https://eagaming.com/game/hot-fruits/ in a normal browser tab.
 *   2. Wait for the game to load (Cloudflare challenge auto-resolves).
 *   3. Open DevTools (F12), go to the Console tab.
 *   4. Paste this entire file's contents and press Enter.
 *   5. Run:  await eaProbe()
 *   6. When it finishes, run:  copy(eaProbeResults)
 *   7. Paste the clipboard contents back into Claude.
 */

(function () {
	const sid = new URLSearchParams(location.search).get('sid')
		|| (window.gameConfig && window.gameConfig.sid)
		|| prompt('Could not auto-detect sid. Paste it here:');

	if (!sid) {
		console.error('[probe] no sid — aborting');
		return;
	}

	let seq = 0;
	const results = [];
	window.eaProbeResults = results;

	const post = async (label, body) => {
		const url = `/game/engine?sid=${encodeURIComponent(sid)}&seq=${seq++}`;
		const t0 = performance.now();
		let entry;
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				credentials: 'include',
			});
			const text = await res.text();
			let json = null;
			try {
				json = text ? JSON.parse(text) : null;
			} catch {}
			entry = {
				label,
				url,
				seq: seq - 1,
				status: res.status,
				statusText: res.statusText,
				ms: Math.round(performance.now() - t0),
				requestBody: body,
				response: json,
				rawText: json ? null : text.slice(0, 4000),
			};
		} catch (err) {
			entry = {
				label,
				url,
				seq: seq - 1,
				error: String(err),
				requestBody: body,
			};
		}
		results.push(entry);
		console.log(
			`[probe] ${label.padEnd(24)} seq=${entry.seq} status=${entry.status ?? 'ERR'} ms=${entry.ms ?? '-'}`,
			entry.response ?? entry.rawText ?? entry.error,
		);
		return entry;
	};

	window.eaProbe = async function () {
		results.length = 0;
		seq = 0;
		console.log(`[probe] starting — sid=${sid}`);

		await post('empty', []);
		await post('bet-play-observed', [
			{ action: 'bet', context: [5, 2] },
			{ action: 'play', context: null },
		]);
		await post('bet-amount-10', [
			{ action: 'bet', context: [10, 1] },
			{ action: 'play', context: null },
		]);
		for (const action of ['authenticate', 'state', 'balance', 'endRound', 'event', 'replay']) {
			await post(`single-${action}`, [{ action, context: null }]);
		}

		console.log('[probe] done. Run `copy(eaProbeResults)` to copy all results to clipboard.');
		console.log('[probe] Or inspect window.eaProbeResults directly.');
		return results;
	};

	console.log('play4fun-js-min.js?v=1:1 [Violation] Added non-passive event listener to a scroll-blocking 'touchstart' event. Consider marking event handler as 'passive' to make the page more responsive. See https://www.chromestatus.com/feature/5745543795965952
n.createHTMLElement @ play4fun-js-min.js?v=1:1
n.Awake @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
Promise.then
n.LaunchGame @ play4fun-js-min.js?v=1:1
r.LaunchGame @ play4fun-js-min.js?v=1:1
r.InitGame @ play4fun-js-min.js?v=1:1
baseScriptLoaded @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:52
onload @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:59
play4fun-js-min.js?v=1:1 [Violation] Added non-passive event listener to a scroll-blocking 'touchmove' event. Consider marking event handler as 'passive' to make the page more responsive. See https://www.chromestatus.com/feature/5745543795965952
n.createHTMLElement @ play4fun-js-min.js?v=1:1
n.Awake @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
Promise.then
n.LaunchGame @ play4fun-js-min.js?v=1:1
r.LaunchGame @ play4fun-js-min.js?v=1:1
r.InitGame @ play4fun-js-min.js?v=1:1
baseScriptLoaded @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:52
onload @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:59
cocos2d-js-min.js:1 [Violation] Added non-passive event listener to a scroll-blocking 'mousewheel' event. Consider marking event handler as 'passive' to make the page more responsive. See https://www.chromestatus.com/feature/5745543795965952
(anonymous) @ cocos2d-js-min.js:1
registerSystemEvent @ cocos2d-js-min.js:1
_initEvents @ cocos2d-js-min.js:1
_initEngine @ cocos2d-js-min.js:1
_prepareFinished @ cocos2d-js-min.js:1
(anonymous) @ cocos2d-js-min.js:1
_loadPreviewScript @ cocos2d-js-min.js:1
prepare @ cocos2d-js-min.js:1
run @ cocos2d-js-min.js:1
(anonymous) @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
Promise.then
a.loadGame @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
Promise.then
a.Load @ play4fun-js-min.js?v=1:1
o.LoadProject @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
Promise.then
n.LaunchGame @ play4fun-js-min.js?v=1:1
r.LaunchGame @ play4fun-js-min.js?v=1:1
r.InitGame @ play4fun-js-min.js?v=1:1
baseScriptLoaded @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:52
onload @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:59
cocos2d-js-min.js:1 Play4Fun v2.4.4
play4fun-js-min.js?v=1:1 [Violation] Added non-passive event listener to a scroll-blocking 'touchmove' event. Consider marking event handler as 'passive' to make the page more responsive. See https://www.chromestatus.com/feature/5745543795965952
a.removeZoomEvent @ play4fun-js-min.js?v=1:1
a.Awake @ play4fun-js-min.js?v=1:1
n.LaunchGame_Completed @ play4fun-js-min.js?v=1:1
(anonymous) @ play4fun-js-min.js?v=1:1
Promise.then
n.LaunchGame @ play4fun-js-min.js?v=1:1
r.LaunchGame @ play4fun-js-min.js?v=1:1
r.InitGame @ play4fun-js-min.js?v=1:1
baseScriptLoaded @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:52
onload @ embed.html?sid=S23de49ea&brandName=eagaming&locale=en:59
cocos2d-js-min.js:1 LoadScene preload: 221.671875 ms
cocos2d-js-min.js:1 LoadScene loading: 7.532958984375 ms
cocos2d-js-min.js:1 LoadScene main-game: 46.126953125 ms
cocos2d-js-min.js:1 [Violation] 'setTimeout' handler took 137ms');
})();
