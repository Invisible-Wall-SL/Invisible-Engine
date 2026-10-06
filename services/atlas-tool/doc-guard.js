/* Saving alongside other people — docs/design/multi-user-concurrency.md Phase 3.
   Loaded in <head>, before any other script can call fetch.

   The page has ~40 inline fetch() calls and no wrapper, so this wraps fetch
   itself rather than touching each one:
   - every same-origin POST carries X-IW-Doc-Bases: the version (ETag +
     saved_by.rev) of each doc this page is showing, which the server checks
     before it writes one;
   - every response's X-IW-Doc-Versions is adopted, so the page's next save is
     based on the version it just wrote;
   - a 409 {conflict} is answered HERE, before the caller sees it: the author
     picks "Reload theirs" or "Overwrite with mine", and an overwrite is the SAME
     request re-sent on the version the dialog just showed (If-Match on it) —
     never a blind write. The caller gets the final response, as if nothing
     happened in between.
   The "X is editing this atlas" heartbeat is iw_common/presence.js, loaded
   just before this.

   __IW_DOCS__ / __IW_ME__ are replaced by the server. */
/* global __IW_DOCS__, __IW_ME__ */
(function () {
	var DOCS = __IW_DOCS__;
	var ME = __IW_ME__;
	window.IW_DOCS = DOCS;
	var nativeFetch = window.fetch.bind(window);

	function sameOrigin(u) {
		try {
			return new URL(u, location.href).origin === location.origin;
		} catch {
			return false;
		}
	}

	function adopt(r) {
		var h = r.headers.get('X-IW-Doc-Versions');
		if (!h) return;
		try {
			var v = JSON.parse(h);
			// Only the docs this page is SHOWING. Adopting another atlas's version
			// would let an edit made on this page pass as "seen" for it.
			Object.keys(v).forEach(function (k) {
				if (Object.prototype.hasOwnProperty.call(DOCS, k)) DOCS[k] = v[k];
			});
		} catch {
			/* a malformed header just means no update */
		}
	}

	function isMe(by) {
		if (!by) return false;
		if (ME.uid && by.uid) return by.uid === ME.uid;
		return !!ME.sub && by.sub === ME.sub;
	}

	function who(by) {
		if (!by) return 'Someone';
		if (isMe(by)) return 'You (in another tab)';
		return by.name || by.sub || 'Someone';
	}

	function when(by) {
		if (!by || !by.at) return '';
		var d = new Date(by.at);
		if (isNaN(d.getTime())) return '';
		var t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return d.toDateString() === new Date().toDateString()
			? ' at ' + t
			: ' on ' + d.toLocaleDateString() + ' ' + t;
	}

	function where(by) {
		return by && by.tool === 'sheet' ? ' in the Sheet Maker' : '';
	}

	function label(id) {
		if (id === 'atlas_config.json') return 'the shared settings';
		if (id.indexOf('card:') === 0) return 'the card “' + id.slice(5) + '”';
		var n = id.replace('manifests/', '').replace('atlas_manifest_', '').replace('.json', '');
		return 'the atlas “' + n + '”';
	}

	function el(tag, css, text) {
		var e = document.createElement(tag);
		if (css) e.style.cssText = css;
		if (text) e.textContent = text;
		return e;
	}

	function ask(c) {
		var by = c.saved_by;
		var name = label(c.doc);
		var title, body, buttons;
		if (c.reason === 'unseen') {
			title = 'This page is showing a different atlas';
			body =
				'The active atlas was switched in another tab or by someone else since this page ' +
				'loaded, so this change would land in the wrong atlas. Reload to continue.';
			buttons = [['reload', 'Reload'], ['cancel', 'Cancel']];
		} else if (c.reason === 'exists') {
			title = 'That name is taken';
			body =
				name.charAt(0).toUpperCase() + name.slice(1) + ' already exists — last saved by ' +
				who(by) + where(by) + when(by) + '. Replace it?';
			buttons = [['overwrite', 'Replace it'], ['cancel', 'Cancel']];
		} else if (c.reason === 'deleted') {
			title = 'It was deleted';
			body =
				name.charAt(0).toUpperCase() + name.slice(1) + ' was deleted since this page loaded.';
			buttons = [['overwrite', 'Save it again'], ['reload', 'Reload'], ['cancel', 'Cancel']];
		} else {
			title = 'Someone else saved this';
			body =
				(by
					? who(by) + ' saved ' + name + where(by) + when(by) + ', after this page loaded. '
					: name.charAt(0).toUpperCase() + name.slice(1) + ' changed after this page ' +
						'loaded (a render, another tool, or someone else). ') +
				'Reload theirs to see their version (this change is dropped), or overwrite with ' +
				'yours — this change is applied on top of their version.';
			buttons = [['reload', 'Reload theirs'], ['overwrite', 'Overwrite with mine'], ['cancel', 'Cancel']];
		}
		return new Promise(function (resolve) {
			var shade = el(
				'div',
				'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100000;display:flex;' +
					'align-items:center;justify-content:center'
			);
			var box = el(
				'div',
				'background:#26262d;color:#e8e8ea;border:1px solid #a4702f;border-radius:8px;' +
					'padding:18px 20px;max-width:460px;font:14px system-ui,Arial;' +
					'box-shadow:0 10px 40px rgba(0,0,0,.5)'
			);
			box.setAttribute('role', 'alertdialog');
			box.appendChild(el('div', 'font-weight:600;font-size:15px;margin-bottom:8px', '⚠ ' + title));
			box.appendChild(el('div', 'line-height:1.45;margin-bottom:14px', body));
			var row = el('div', 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap');
			function done(v) {
				document.removeEventListener('keydown', onKey, true);
				shade.remove();
				resolve(v);
			}
			function onKey(e) {
				if (e.key === 'Escape') done('cancel');
			}
			buttons.forEach(function (b, i) {
				var btn = el('button', 'cursor:pointer', b[1]);
				btn.dataset.choice = b[0];
				if (b[0] === 'cancel') btn.className = 'alt';
				btn.onclick = function () {
					done(b[0]);
				};
				row.appendChild(btn);
				if (i === 0) setTimeout(function () { btn.focus(); }, 0);
			});
			box.appendChild(row);
			shade.appendChild(box);
			document.addEventListener('keydown', onKey, true);
			document.body.appendChild(shade);
		});
	}

	window.fetch = async function (input, init) {
		init = init || {};
		var url = typeof input === 'string' ? input : (input && input.url) || String(input);
		var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
		if (!sameOrigin(url)) return nativeFetch(input, init);
		if (method !== 'POST') {
			var got = await nativeFetch(input, init);
			adopt(got);
			return got;
		}
		// One POST at a time from this page. Two overlapping saves (two quick
		// variant picks) would both carry the version from before either landed,
		// and the second would be refused as if someone else had saved. Bounded,
		// so one hung request cannot freeze the page's saves for good.
		var prev = queue;
		var release;
		queue = new Promise(function (res) {
			release = res;
		});
		await Promise.race([prev, new Promise(function (res) { setTimeout(res, 15000); })]);
		try {
			return await send(input, init);
		} finally {
			release();
		}
	};

	var queue = Promise.resolve();

	// Header values must be ISO-8859-1; a doc id is an ASCII slug in practice, but
	// one that is not would make Headers.set throw and break every save.
	function headerJson(v) {
		return JSON.stringify(v).replace(/[\u007f-\uffff]/g, function (ch) {
			return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
		});
	}

	async function send(input, init) {
		var bases = DOCS;
		for (;;) {
			var headers = new Headers(init.headers || {});
			headers.set('X-IW-Doc-Bases', headerJson(bases));
			var r = await nativeFetch(input, Object.assign({}, init, { headers: headers }));
			adopt(r);
			if (r.status !== 409) return r;
			var c = null;
			try {
				c = await r.clone().json();
			} catch {
				return r;
			}
			if (!c || !c.conflict) return r;
			var choice = await ask(c);
			if (choice === 'reload') {
				location.reload();
				return new Promise(function () {});
			}
			if (choice !== 'overwrite' || !c.overwritable) {
				return new Response('ℹ Not saved — someone else changed this first.', {
					status: 409,
					headers: { 'Content-Type': 'text/plain; charset=utf-8' }
				});
			}
			bases = Object.assign({}, DOCS);
			bases[c.doc] = { etag: c.etag || '', rev: c.rev || '' };
		}
	}
})();
