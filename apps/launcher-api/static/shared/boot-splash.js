/**
 * boot-splash.js — the CRT boot splash for the STATIC tool apps (Rigger, Spine
 * Viewer), which are plain HTML/WebGL pages outside the SvelteKit app.
 *
 * Vanilla twin of `src/lib/BootSplash.svelte` (launcher tools) and
 * `services/_shared/iw_common/splash.py` (Atlas / Sheet Maker). One loading
 * screen for every "Invisible …" tool; three impls because the three origins
 * cannot share code — keep them visually identical (same rule as the tool-bar
 * and colour-field twins, docs/ui-inventory.md §12).
 *
 * Use:
 *   <body>
 *   <script src="/shared/boot-splash.js" data-tool="Invisible Rigger"
 *           data-phrases="Loading rig library|Assembling bone hierarchy"></script>
 *
 * The overlay paints immediately (put the tag first in <body>) and lifts when
 * the app calls `IWBoot.done()`. If the app never calls it, the splash lifts on
 * `window.load` (+ a short settle) and, as a last resort, at MAX_MS — a boot
 * splash must never be able to strand the tool behind itself.
 *
 * NOT for loading something inside an already-open tool — that is the dimmed
 * overlay + card (`#loadingOverlay` here, `<BusyOverlay>` in the launcher).
 */
(function () {
	'use strict';
	if (window.IWBoot) return;

	var script = document.currentScript;
	var TOOL = ((script && script.getAttribute('data-tool')) || document.title || 'Invisible Tool')
		.replace(/\s+/g, ' ')
		.trim();
	var VERSION = (script && script.getAttribute('data-version')) || 'v1.0';
	var SHARED = [
		'Heating cathode-ray tube',
		'Allocating phosphor buffer',
		'Calibrating scanlines',
		'Resolving active project',
		'Checking session token',
		'Mounting cloud asset store',
		'Warming the WebGL context',
		'Defragmenting pixel cache',
		'Brewing fresh phosphor green',
		'Reticulating splines',
	];
	var own = ((script && script.getAttribute('data-phrases')) || '')
		.split('|')
		.map(function (s) {
			return s.trim();
		})
		.filter(Boolean);
	var WORK = own.concat(SHARED);

	var MIN_MS = 900; // floor from first paint, so the logo always plays
	var SETTLE_MS = 400; // grace after window.load when the app never calls done()
	var MAX_MS = 20000; // hard cap — never strand the tool behind the splash
	var FILL = 44;
	var TICK_MIN = 28,
		TICK_MAX = 46;
	var DOT_MS = 14;
	var PAUSE_MIN = 120,
		PAUSE_MAX = 260;
	var LOGO_MS = 45;
	var CURSOR = '<span class="iw-cur"></span>';

	var startedAt = Date.now();
	var ready = false;
	var over = false;
	var root = null;
	var scr = null;
	var lines = [];
	var live = '';

	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	function sleep(ms) {
		return new Promise(function (r) {
			setTimeout(r, ms);
		});
	}
	function jitter(lo, hi) {
		return lo + Math.floor(Math.random() * (hi - lo + 1));
	}
	function done() {
		return ready && Date.now() - startedAt >= MIN_MS;
	}
	function paint() {
		if (!scr) return;
		scr.innerHTML = lines.join('\n') + (lines.length ? '\n' : '') + live + CURSOR;
		scr.scrollTop = scr.scrollHeight;
	}

	function install() {
		if (root) return;
		var css =
			'.iw-crt{position:fixed;inset:0;z-index:99999;overflow:hidden;padding:36px 44px;' +
			'box-sizing:border-box;background:#000;color:#33ff66;' +
			"font-family:'Consolas','Courier New','Lucida Console',monospace;font-size:15px;" +
			'line-height:1.45;text-shadow:0 0 1px #33ff66,0 0 6px rgba(51,255,102,.55);' +
			'animation:iw-power .55s ease-out 1}' +
			'.iw-crt::before{content:"";position:absolute;inset:0;pointer-events:none;' +
			'background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,' +
			'rgba(0,0,0,.18) 3px,rgba(0,0,0,.18) 4px);mix-blend-mode:multiply;z-index:2}' +
			'.iw-crt::after{content:"";position:absolute;inset:0;pointer-events:none;' +
			'background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%);z-index:3}' +
			'.iw-scr{position:relative;z-index:1;margin:0;height:100%;overflow:hidden;' +
			'white-space:pre-wrap;word-break:break-word;font:inherit}' +
			'.iw-ttl{font-size:18px;font-weight:bold;letter-spacing:2px}' +
			'.iw-dim{opacity:.55}.iw-ok{color:#9cff9c}' +
			'.iw-cur{display:inline-block;width:.55em;height:1em;vertical-align:-2px;background:#33ff66;' +
			'box-shadow:0 0 6px #33ff66;animation:iw-blink 1s steps(1) infinite}' +
			'@keyframes iw-blink{50%{opacity:0}}' +
			'@keyframes iw-power{0%{opacity:0;transform:scaleY(.02)}40%{opacity:1;transform:scaleY(1)}' +
			'100%{opacity:1;transform:scaleY(1)}}' +
			'@media (prefers-reduced-motion: reduce){.iw-crt{animation:none}.iw-cur{animation:none}}';
		var style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);

		root = document.createElement('div');
		root.className = 'iw-crt';
		root.setAttribute('role', 'status');
		root.setAttribute('aria-label', 'Opening ' + TOOL);
		scr = document.createElement('pre');
		scr.className = 'iw-scr';
		scr.setAttribute('aria-hidden', 'true');
		root.appendChild(scr);
		document.body.appendChild(root);
	}

	function lift() {
		if (over) return;
		over = true;
		if (root && root.parentNode) root.parentNode.removeChild(root);
		root = null;
		scr = null;
	}

	async function typeLine(text, cls, tail) {
		var open = cls ? '<span class="' + cls + '">' : '';
		var close = cls ? '</span>' : '';
		live = '';
		for (var i = 0; i < text.length; i++) {
			if (done() || over) {
				if (i > 0) lines.push(open + esc(text.slice(0, i)) + close);
				live = '';
				paint();
				return;
			}
			live = open + esc(text.slice(0, i + 1)) + close;
			paint();
			await sleep(jitter(TICK_MIN, TICK_MAX));
		}
		if (tail !== undefined) {
			var pad = Math.max(3, FILL - text.length);
			var dots = '';
			for (var d = 0; d < pad; d++) {
				if (done() || over) {
					lines.push(open + esc(text) + close + dots);
					live = '';
					paint();
					return;
				}
				dots += '.';
				live = open + esc(text) + close + dots;
				paint();
				await sleep(DOT_MS);
			}
			live = open + esc(text) + close + dots + ' [ <span class="iw-ok">' + esc(tail) + '</span> ]';
			paint();
		}
		lines.push(live);
		live = '';
		paint();
		if (!done() && !over) await sleep(jitter(PAUSE_MIN, PAUSE_MAX));
	}

	async function run() {
		install();
		var spaced = TOOL.toUpperCase()
			.split(' ')
			.map(function (w) {
				return w.split('').join(' ');
			})
			.join('   ');
		var logo = [
			'',
			'   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
			'   ┃',
			'   ┃    I N V I S I B L E   W A L L   S L',
			'   ┃    ─────────────────────────────────────',
			'   ┃    ' + spaced + '     ·     ' + VERSION,
			'   ┃',
			'',
		];
		for (var i = 0; i < logo.length; i++) {
			lines.push('<span class="iw-ttl">' + esc(logo[i]) + '</span>');
			paint();
			if (done() || over) break;
			await sleep(LOGO_MS);
		}
		var intro = [
			'BIOS POST 1981  ·  640K base  ·  64512K extended free',
			'(c) Invisible Wall SL  ·  terminal mode',
			'',
		];
		for (var k = 0; k < intro.length && !done() && !over; k++) {
			await typeLine(intro[k], 'iw-dim');
		}
		var pool = WORK.slice();
		var at = pool.length; // force a shuffle on the first pull
		while (!done() && !over) {
			if (at >= pool.length) {
				for (var s = pool.length - 1; s > 0; s--) {
					var j = Math.floor(Math.random() * (s + 1));
					var t = pool[s];
					pool[s] = pool[j];
					pool[j] = t;
				}
				at = 0;
			}
			await typeLine('> ' + pool[at++], '', 'OK');
		}
		lift();
	}

	window.IWBoot = {
		/** The app is up — the splash finishes its line and lifts. */
		done: function () {
			ready = true;
		},
		/** Force the splash away immediately (e.g. a fatal boot error screen). */
		dismiss: lift,
	};

	// Fallbacks: the splash must lift even if the app forgets to call done().
	window.addEventListener('load', function () {
		setTimeout(function () {
			ready = true;
		}, SETTLE_MS);
	});
	setTimeout(lift, MAX_MS);

	// Poll so a `done()` that lands while the typewriter sleeps still lifts promptly.
	var poll = setInterval(function () {
		if (over) clearInterval(poll);
		else if (done()) {
			lift();
			clearInterval(poll);
		}
	}, 60);

	if (document.body) run();
	else document.addEventListener('DOMContentLoaded', run);
})();
