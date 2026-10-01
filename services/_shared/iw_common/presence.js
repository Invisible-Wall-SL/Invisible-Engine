/* "X is editing this <doc>" — the page half of iw_common/presence.py, shared by
   the Atlas Maker and the Sheet Maker. Advisory: it blocks nothing.

   iwPresence.track(doc) names the doc this page is editing ('' = none): the doc
   it was tracking is released, the new one claimed, and the claim is renewed
   every 10 s; a page leaving releases it with a beacon.

   Load it BEFORE anything that wraps window.fetch (the Atlas Maker's
   doc-guard.js): a heartbeat must not queue behind a save or carry its versions.

   __IW_PRESENCE_NOUN__ is replaced by the server. */
/* global __IW_PRESENCE_NOUN__ */
window.iwPresence = (function () {
	var NOUN = __IW_PRESENCE_NOUN__;
	var nativeFetch = window.fetch.bind(window);
	var doc = '';
	var TAB = '';
	var chain = Promise.resolve();

	// One id per browser TAB, kept across the reload that follows most edits: a
	// fresh id per page load would make the reloaded page a stranger to the lease
	// it held a second ago and show the author their own "other tab".
	function tabId() {
		var id = '';
		try {
			id = sessionStorage.getItem('iwPresenceTab') || '';
		} catch {
			/* storage blocked: a per-load id still works, just less smoothly */
		}
		if (!id) {
			id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
			try {
				sessionStorage.setItem('iwPresenceTab', id);
			} catch {
				/* see above */
			}
		}
		return id;
	}

	function banner(holder) {
		var bar = document.getElementById('iwPresence');
		if (!holder) {
			if (bar) bar.remove();
			return;
		}
		if (!bar) {
			bar = document.createElement('div');
			bar.style.cssText =
				'position:sticky;top:0;z-index:9999;flex:none;background:#5a4418;color:#ffe2bd;' +
				'border:1px solid #a4702f;border-radius:6px;padding:7px 12px;margin:6px 0;' +
				'font:13px system-ui,Arial';
			bar.id = 'iwPresence';
			document.body.insertBefore(bar, document.body.firstChild);
		}
		var since = holder.since
			? ' (since ' +
				new Date(holder.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
				')'
			: '';
		bar.textContent = holder.same_user
			? '👤 You also have this ' + NOUN + ' open in another tab' + since + '.'
			: '👤 ' +
				holder.name +
				' is editing this ' +
				NOUN +
				since +
				'. Nothing is locked — ' +
				'if you both change the same thing, whoever saves second is asked before anything ' +
				'is overwritten.';
	}

	// In order, one at a time: a beat still in flight when its doc is released
	// must not land after the release and claim a doc this page has left.
	function post(body) {
		var p = chain.then(function () {
			return nativeFetch('/presence', { method: 'POST', body: JSON.stringify(body) });
		});
		chain = p.catch(function () {});
		return p;
	}

	function beat() {
		var d = doc;
		if (!d) return;
		post({ doc: d, tab: TAB })
			.then(function (r) {
				return r.ok ? r.json() : null;
			})
			.then(function (j) {
				if (d === doc) banner(j && j.holder);
			})
			.catch(function () {});
	}

	function start() {
		TAB = tabId();
		setInterval(beat, 10000);
		window.addEventListener('pagehide', function () {
			if (!doc || !navigator.sendBeacon) return;
			navigator.sendBeacon(
				'/presence',
				new Blob([JSON.stringify({ doc: doc, tab: TAB, release: true })], { type: 'text/plain' }),
			);
		});
	}

	function track(next) {
		next = next || '';
		if (next === doc) return;
		if (!TAB) start();
		if (doc) post({ doc: doc, tab: TAB, release: true }).catch(function () {});
		doc = next;
		banner(null);
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beat);
		else beat();
	}

	return { track: track };
})();
