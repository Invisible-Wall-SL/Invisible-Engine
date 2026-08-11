/* Invisible ColorField — vanilla twin of $lib/ColorField.svelte, for the static/Python tools.
 *
 * Photoshop-style picker (swatch → popover with SV square + hue slider + hex box; click-drag
 * with pointer capture that keeps tracking outside the picker; stays open while picking;
 * commits & closes on click-away; Esc reverts). It ENHANCES existing `<input type="color">`
 * elements: the native input stays in the DOM (hidden) as the value-holder, keeping its id /
 * class / value and firing `input` (live) + `change` (on close) — so the surrounding code that
 * reads `.value` or listens for those events keeps working untouched.
 *
 * Usage: include this script; it auto-enhances every `input[type=color]` on load and any added
 * later (MutationObserver). Or call `window.IWColorField.enhance(root)` manually.
 *
 * ⚠ Twin of `$lib/ColorField.svelte` and the copy inlined in `services/atlas-tool/ui_server.py`
 * (a separate origin can't share the file). Keep behaviour in sync — see docs/ui-inventory.md §11.
 */
(function () {
	if (window.IWColorField) return;

	function clamp(n, lo, hi) {
		return n < lo ? lo : n > hi ? hi : n;
	}
	function normHex(hex) {
		var s = String(hex || '#000000')
			.trim()
			.replace(/^#/, '');
		if (/^[0-9a-fA-F]{3}$/.test(s))
			s = s
				.split('')
				.map(function (c) {
					return c + c;
				})
				.join('');
		if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#000000';
		return '#' + s.toLowerCase();
	}
	function hexToRgb(hex) {
		var n = parseInt(normHex(hex).slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	function rgbToHex(r, g, b) {
		return (
			'#' +
			[r, g, b]
				.map(function (v) {
					return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
				})
				.join('')
		);
	}
	function rgbToHsv(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		var mx = Math.max(r, g, b),
			mn = Math.min(r, g, b),
			d = mx - mn,
			h = 0;
		if (d) {
			if (mx === r) h = ((g - b) / d) % 6;
			else if (mx === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
			if (h < 0) h += 360;
		}
		return [h, mx === 0 ? 0 : d / mx, mx];
	}
	function hsvToRgb(h, s, v) {
		var c = v * s,
			x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
			m = v - c,
			r = 0,
			g = 0,
			b = 0;
		if (h < 60) (r = c), (g = x);
		else if (h < 120) (r = x), (g = c);
		else if (h < 180) (g = c), (b = x);
		else if (h < 240) (g = x), (b = c);
		else if (h < 300) (r = x), (b = c);
		else (r = c), (b = x);
		return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
	}

	var CSS =
		'.iw-cf-swatch{display:inline-block;width:34px;height:22px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:4px;cursor:pointer;vertical-align:middle;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}' +
		'.iw-cf-swatch:disabled{opacity:.4;cursor:default}' +
		'.iw-cf-pop{position:fixed;z-index:100000;width:208px;padding:10px;background:#1c1c22;border:1px solid rgba(255,255,255,.14);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.5);user-select:none;font-family:system-ui,sans-serif}' +
		'.iw-cf-sv{position:relative;width:188px;height:132px;border-radius:4px;cursor:crosshair;touch-action:none}' +
		'.iw-cf-sv-thumb{position:absolute;width:12px;height:12px;transform:translate(-50%,-50%);border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}' +
		'.iw-cf-hue{position:relative;margin-top:10px;width:188px;height:12px;border-radius:6px;cursor:ew-resize;touch-action:none;background:linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)}' +
		'.iw-cf-hue-thumb{position:absolute;top:50%;width:10px;height:16px;transform:translate(-50%,-50%);border:2px solid #fff;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}' +
		'.iw-cf-foot{display:flex;align-items:center;gap:8px;margin-top:10px}' +
		'.iw-cf-preview{width:22px;height:22px;border-radius:4px;border:1px solid rgba(255,255,255,.2);flex:0 0 auto}' +
		'.iw-cf-hex{flex:1 1 auto;min-width:0;padding:4px 6px;font-family:ui-monospace,monospace;font-size:12px;text-transform:lowercase;color:#e8e8ee;background:#101014;border:1px solid rgba(255,255,255,.14);border-radius:4px}' +
		'.iw-cf-hex:focus{outline:none;border-color:#7ee0c0}';

	function injectCss() {
		if (document.getElementById('iw-cf-css')) return;
		var st = document.createElement('style');
		st.id = 'iw-cf-css';
		st.textContent = CSS;
		document.head.appendChild(st);
	}

	// One shared popover instance
	var pop, svEl, svThumb, hueEl, hueThumb, previewEl, hexEl;
	var target = null; // native input being edited
	var swatch = null; // its swatch button
	var hue = 0,
		sat = 0,
		val = 1,
		snapshot = '';

	function buildPop() {
		pop = document.createElement('div');
		pop.className = 'iw-cf-pop';
		pop.style.display = 'none';
		pop.innerHTML =
			'<div class="iw-cf-sv"><div class="iw-cf-sv-thumb"></div></div>' +
			'<div class="iw-cf-hue"><div class="iw-cf-hue-thumb"></div></div>' +
			'<div class="iw-cf-foot"><span class="iw-cf-preview"></span><input class="iw-cf-hex" spellcheck="false"></div>';
		document.body.appendChild(pop);
		svEl = pop.querySelector('.iw-cf-sv');
		svThumb = pop.querySelector('.iw-cf-sv-thumb');
		hueEl = pop.querySelector('.iw-cf-hue');
		hueThumb = pop.querySelector('.iw-cf-hue-thumb');
		previewEl = pop.querySelector('.iw-cf-preview');
		hexEl = pop.querySelector('.iw-cf-hex');
		svEl.addEventListener('pointerdown', function (e) {
			startDrag(e, 'sv');
		});
		hueEl.addEventListener('pointerdown', function (e) {
			startDrag(e, 'hue');
		});
		hexEl.addEventListener('input', onHexInput);
		hexEl.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') closePicker(true);
		});
	}

	function currentHex() {
		return rgbToHex.apply(null, hsvToRgb(hue, sat, val));
	}

	function render() {
		var hex = currentHex();
		svEl.style.background =
			'linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,rgba(255,255,255,0)),hsl(' +
			hue +
			' 100% 50%)';
		svThumb.style.left = sat * 100 + '%';
		svThumb.style.top = (1 - val) * 100 + '%';
		hueThumb.style.left = (hue / 360) * 100 + '%';
		previewEl.style.background = hex;
		return hex;
	}

	function commitLive() {
		var hex = render();
		if (target) {
			target.value = hex;
			target.dispatchEvent(new Event('input', { bubbles: true }));
		}
		if (swatch) swatch.style.background = hex;
		hexEl.value = hex;
	}

	function seedFrom(hex) {
		var hsv = rgbToHsv.apply(null, hexToRgb(hex));
		if (hsv[1] > 0) hue = hsv[0];
		sat = hsv[1];
		val = hsv[2];
		hexEl.value = normHex(hex);
	}

	function onHexInput() {
		var raw = hexEl.value.trim();
		if (/^#?[0-9a-fA-F]{6}$/.test(raw) || /^#?[0-9a-fA-F]{3}$/.test(raw)) {
			seedFrom(raw);
			commitLive();
		}
	}

	function position() {
		var r = swatch.getBoundingClientRect();
		var pw = pop.offsetWidth,
			ph = pop.offsetHeight,
			m = 6;
		var left = r.left,
			top = r.bottom + m;
		if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
		if (left < 8) left = 8;
		if (top + ph > window.innerHeight - 8) top = r.top - ph - m;
		if (top < 8) top = 8;
		pop.style.left = Math.round(left) + 'px';
		pop.style.top = Math.round(top) + 'px';
	}

	function openPicker(input, btn) {
		if (input.disabled) return;
		if (!pop) buildPop();
		target = input;
		swatch = btn;
		snapshot = normHex(input.value);
		seedFrom(input.value);
		render();
		pop.style.display = 'block';
		position();
		window.addEventListener('pointerdown', onDocDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('resize', position);
		window.addEventListener('scroll', position, true);
	}

	function closePicker(commit) {
		if (!target) return;
		pop.style.display = 'none';
		if (commit) target.dispatchEvent(new Event('change', { bubbles: true }));
		target = null;
		swatch = null;
		window.removeEventListener('pointerdown', onDocDown, true);
		window.removeEventListener('keydown', onKey, true);
		window.removeEventListener('resize', position);
		window.removeEventListener('scroll', position, true);
	}

	function cancelPicker() {
		if (!target) return;
		if (target.value !== snapshot) {
			target.value = snapshot;
			target.dispatchEvent(new Event('input', { bubbles: true }));
			if (swatch) swatch.style.background = snapshot;
		}
		closePicker(false);
	}

	function onDocDown(e) {
		if (pop.contains(e.target) || (swatch && swatch.contains(e.target))) return;
		closePicker(true);
	}
	function onKey(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelPicker();
		} else if (e.key === 'Enter') {
			closePicker(true);
		}
	}

	function dragSV(e) {
		var r = svEl.getBoundingClientRect();
		sat = clamp((e.clientX - r.left) / r.width, 0, 1);
		val = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
		commitLive();
	}
	function dragHue(e) {
		var r = hueEl.getBoundingClientRect();
		hue = clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
		commitLive();
	}
	function startDrag(e, kind) {
		e.preventDefault();
		var el = e.currentTarget;
		el.setPointerCapture(e.pointerId);
		var move = kind === 'sv' ? dragSV : dragHue;
		function up(ev) {
			el.releasePointerCapture(ev.pointerId);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		}
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		move(e);
	}

	function enhanceOne(input) {
		if (input.dataset.iwCf) return;
		input.dataset.iwCf = '1';
		injectCss();
		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'iw-cf-swatch';
		btn.style.background = normHex(input.value);
		if (input.title) btn.title = input.title;
		if (input.disabled) btn.disabled = true;
		input.style.display = 'none';
		input.parentNode.insertBefore(btn, input.nextSibling);
		btn.addEventListener('click', function (e) {
			e.preventDefault();
			if (target === input) closePicker(true);
			else openPicker(input, btn);
		});
		// keep swatch coloured if code sets the input value programmatically
		input.addEventListener('change', function () {
			btn.style.background = normHex(input.value);
		});
	}

	function enhance(root) {
		(root || document).querySelectorAll('input[type="color"]').forEach(enhanceOne);
	}

	function boot() {
		enhance(document);
		new MutationObserver(function (muts) {
			for (var i = 0; i < muts.length; i++) {
				var added = muts[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var n = added[j];
					if (n.nodeType !== 1) continue;
					if (n.matches && n.matches('input[type="color"]')) enhanceOne(n);
					else if (n.querySelectorAll) enhance(n);
				}
			}
		}).observe(document.documentElement, { childList: true, subtree: true });
	}

	window.IWColorField = { enhance: enhance };
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
})();
