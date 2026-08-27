/**
 * verify-boot-splash.mjs — does opening a tool across TWO documents show ONE
 * boot splash, or two?
 *
 * Opening one tool can span two documents in a tab: a launcher route that
 * redirects to a static `view.html`, or an in-tool full navigation
 * (`/fx?effect=…`, `/flipbook?clip=…`, Editor → Component Editor). Each
 * document boots its own splash, so the second one replaying the power-on
 * sweep, ASCII logo and BIOS dateline is what reads as the CRT firing twice.
 * `static/shared/boot-splash.js` latches the two together through
 * sessionStorage (twin: `src/lib/splashTrail.ts`).
 *
 * That handoff cannot be caught in one page and is a pain to reproduce by
 * hand — it depends on which document you came from and how long ago. So it is
 * checked HERE instead: enough DOM is stubbed to run the real splash source,
 * unmodified, with one sessionStorage shared between the runs the way a tab
 * shares it.
 *
 * Asserts all three behaviours, because the risk cuts both ways — a latch that
 * never fires leaves the double, and one that never expires means a tool
 * opened cold never shows its logo again:
 *   1. cold open           → full boot (logo + BIOS, power-on sweep)
 *   2. hop, latch warm     → continues (no logo, no BIOS, `iw-warm`)
 *   3. cold open after 1.7s → full boot again (the latch expired)
 *
 * Run: node scripts/verify-boot-splash.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC =
	process.argv[2] ??
	join(
		dirname(fileURLToPath(import.meta.url)),
		'..',
		'apps/launcher-api/static/shared/boot-splash.js',
	);
const code = readFileSync(SRC, 'utf8');

const store = new Map(); // the shared tab storage — survives both "documents"

function makeEl(tag) {
	const el = {
		tag,
		className: '',
		textContent: '',
		innerHTML: '',
		scrollTop: 0,
		scrollHeight: 0,
		children: [],
		parentNode: null,
		setAttribute() {},
		appendChild(c) {
			c.parentNode = el;
			el.children.push(c);
			return c;
		},
		removeChild(c) {
			el.children = el.children.filter((x) => x !== c);
			c.parentNode = null;
		},
	};
	return el;
}

async function runDocument({ url, done_after_ms }) {
	const body = makeEl('body');
	const head = makeEl('head');
	const seen = []; // every innerHTML the screen ever showed

	const win = {
		location: {
			pathname: url.split('?')[0],
			search: url.includes('?') ? '?' + url.split('?')[1] : '',
		},
		addEventListener() {},
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
	};
	const doc = {
		title: 'x',
		currentScript: {
			getAttribute: (a) =>
				({ 'data-tool': 'Invisible Rigger', 'data-phrases': 'Loading rig library' })[a] ?? null,
		},
		head,
		body,
		createElement: makeEl,
		addEventListener() {},
	};
	// watch what gets painted
	const classes = []; // captured at append time — lift() removes the node again
	const origBodyAppend = body.appendChild.bind(body);
	body.appendChild = (c) => {
		classes.push(c.className);
		const el = origBodyAppend(c);
		let v = '';
		Object.defineProperty(c.children[0] ?? {}, 'innerHTML', {
			set(x) {
				seen.push(x);
				v = x;
			},
			get: () => v,
		});
		return el;
	};

	const sandbox = {
		window: win,
		document: doc,
		sessionStorage: {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => store.set(k, String(v)),
		},
		performance: { getEntriesByType: () => [{ type: 'navigate' }] },
		location: win.location,
		console: { info: (...a) => seen.push('[console] ' + a.join(' ')) },
		Object,
		Date,
		Math,
		Number,
		String,
		JSON,
		isFinite,
		Promise,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
	};
	win.window = win;

	const fn = new Function(...Object.keys(sandbox), code);
	fn(...Object.values(sandbox));

	setTimeout(() => win.IWBoot.done(), done_after_ms);
	await new Promise((r) => setTimeout(r, done_after_ms + 1400));

	const painted = seen.join('\n');
	return {
		logo: painted.includes('I N V I S I B L E'),
		bios: painted.includes('BIOS POST'),
		warm: classes.join(' ').includes('iw-warm'),
		continued: painted.includes('[console] [iw-splash] continuing'),
	};
}

const first = await runDocument({ url: '/rigger', done_after_ms: 250 });
const second = await runDocument({ url: '/rigger/view.html?v=1', done_after_ms: 50 });
// ...and a genuinely fresh open later in the same tab must still play in full.
await new Promise((r) => setTimeout(r, 1700)); // > HANDOFF_MS, so the latch goes cold
const third = await runDocument({ url: '/editor', done_after_ms: 250 });

console.log('document 1 (/rigger)           ', first);
console.log('document 2 (/rigger/view.html) ', second);
console.log('document 3 (/editor, 1.7s idle)', third);

const ok =
	first.logo &&
	first.bios &&
	!first.warm &&
	!first.continued &&
	!second.logo &&
	!second.bios &&
	second.warm &&
	second.continued &&
	third.logo &&
	third.bios &&
	!third.warm &&
	!third.continued;
console.log('');
console.log(ok ? 'PASS - hop continues, cold open still plays the full boot' : 'FAIL');
process.exit(ok ? 0 : 1);