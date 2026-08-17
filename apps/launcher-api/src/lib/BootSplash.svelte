<!--
	The CRT boot splash — the ONE loading screen a tool shows while it is opening.

	Svelte twin of `services/_shared/iw_common/splash.py` (the Atlas / Sheet Maker
	splash) and of `static/shared/boot-splash.js` (the static Rigger / Spine apps),
	so every "Invisible …" tool boots the same way whatever stack it is built on.
	Keep the three visually identical — separate origins/stacks can't share code
	(same rule as the tool-bar and colour-field twins, see docs/ui-inventory.md).

	Contract: the parent mounts it while the tool is opening and flips `ready`
	when the tool has arrived. The splash then finishes the line it is typing and
	calls `onfinished` — never before `minMs`, so the logo always plays instead of
	blinking. It is for a tool that is NOT there yet; loading assets or data INSIDE
	a tool that is already up uses `<BusyOverlay>` instead.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_BOOT_PHRASES } from '$lib/bootPhrases';

	let {
		tool,
		version = 'v1.0',
		phrases = DEFAULT_BOOT_PHRASES,
		ready = false,
		minMs = 900,
		onfinished,
	}: {
		/** Tool name, letter-spaced into the wordmark (e.g. `Invisible Scene Editor`). */
		tool: string;
		version?: string;
		/** WORK pool — see `bootPhrases.ts`. */
		phrases?: readonly string[];
		/** Flip to true once the tool is actually there. */
		ready?: boolean;
		/** Floor from first paint, so a fast boot doesn't flash the screen. */
		minMs?: number;
		onfinished?: () => void;
	} = $props();

	interface Line {
		text: string;
		cls?: string;
		/** Right-aligned status tag, e.g. `OK`. */
		tail?: string;
	}

	const FILL = 44; // column the [ OK ] tag right-aligns at
	const TICK_MIN = 28;
	const TICK_MAX = 46; // jittered per char so it types like a person
	const DOT_MS = 14;
	const PAUSE_MIN = 120;
	const PAUSE_MAX = 260;
	const LOGO_MS = 45; // per logo line — a CRT refresh sweep, not a typewriter
	const CURSOR = '<span class="cur"></span>';

	// ASCII logo — the Invisible Wall corner-bracket emblem with the wordmark inset.
	const spaced = $derived(
		tool
			.trim()
			.toUpperCase()
			.split(/\s+/)
			.map((word) => word.split('').join(' '))
			.join('   '),
	);
	const logo = $derived([
		'',
		'   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
		'   ┃',
		'   ┃    I N V I S I B L E   W A L L   S L',
		'   ┃    ─────────────────────────────────────',
		`   ┃    ${spaced}     ·     ${version}`,
		'   ┃',
		'',
	]);

	const INTRO: Line[] = [
		{ text: 'BIOS POST 1981  ·  640K base  ·  64512K extended free', cls: 'dim' },
		{ text: '(c) Invisible Wall SL  ·  terminal mode', cls: 'dim' },
		{ text: '' },
	];

	let body = $state('');
	let screen = $state<HTMLElement | null>(null);
	const committed: string[] = [];
	let live = '';
	let cancelled = false;
	let finished = false;
	let startedAt = 0;

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const jitter = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	/** True once the tool has arrived AND the screen has had its minimum airtime. */
	const done = () => ready && Date.now() - startedAt >= minMs;

	function paint(): void {
		body = committed.join('\n') + (committed.length ? '\n' : '') + live + CURSOR;
	}

	// Keep the newest line in view on a short screen (the CRT scrolls, it never bars).
	$effect(() => {
		body;
		if (screen) screen.scrollTop = screen.scrollHeight;
	});

	async function typeLine(line: Line): Promise<void> {
		const open = line.cls ? `<span class="${line.cls}">` : '';
		const close = line.cls ? '</span>' : '';
		live = '';
		for (let i = 0; i < line.text.length; i++) {
			// Bail out mid-word the moment the tool is there — commit what's typed.
			if (done() || cancelled) {
				if (i > 0) committed.push(open + esc(line.text.slice(0, i)) + close);
				live = '';
				paint();
				return;
			}
			live = open + esc(line.text.slice(0, i + 1)) + close;
			paint();
			await sleep(jitter(TICK_MIN, TICK_MAX));
		}
		if (line.tail !== undefined) {
			const pad = Math.max(3, FILL - line.text.length);
			let dots = '';
			for (let i = 0; i < pad; i++) {
				if (done() || cancelled) {
					committed.push(open + esc(line.text) + close + dots);
					live = '';
					paint();
					return;
				}
				dots += '.';
				live = open + esc(line.text) + close + dots;
				paint();
				await sleep(DOT_MS);
			}
			live = `${open}${esc(line.text)}${close}${dots} [ <span class="ok">${esc(line.tail)}</span> ]`;
			paint();
		}
		committed.push(live);
		live = '';
		paint();
		// The inter-line pause is the worst place to be slow once the tool is in.
		if (!done() && !cancelled) await sleep(jitter(PAUSE_MIN, PAUSE_MAX));
	}

	/** Yields pool lines forever, reshuffled each cycle so a long boot never repeats itself. */
	function* poolForever(pool: readonly string[]): Generator<Line> {
		const a = [...pool];
		for (;;) {
			for (let i = a.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[a[i], a[j]] = [a[j], a[i]];
			}
			for (const phrase of a) yield { text: `> ${phrase}`, tail: 'OK' };
		}
	}

	function finish(): void {
		if (finished) return;
		finished = true;
		onfinished?.();
	}

	onMount(() => {
		startedAt = Date.now();
		void (async () => {
			for (const line of logo) {
				committed.push(`<span class="ttl">${esc(line)}</span>`);
				paint();
				if (done() || cancelled) break;
				await sleep(LOGO_MS);
			}
			for (const line of INTRO) {
				if (done() || cancelled) break;
				await typeLine(line);
			}
			const pool = poolForever(phrases.length ? phrases : DEFAULT_BOOT_PHRASES);
			while (!done() && !cancelled) {
				const { value } = pool.next();
				if (!value) break;
				await typeLine(value);
			}
			if (!cancelled) finish();
		})();

		// `ready` can flip while the loop is asleep between lines; the timer closes
		// that gap so the splash never outlives the tool by a full pause.
		const poll = window.setInterval(() => {
			if (done()) {
				finish();
				window.clearInterval(poll);
			}
		}, 60);

		return () => {
			cancelled = true;
			window.clearInterval(poll);
		};
	});
</script>

<div class="crt" role="status" aria-live="polite">
	<span class="sr-only">Opening {tool}…</span>
	<pre class="scr" bind:this={screen} aria-hidden="true">{@html body}</pre>
</div>

<style>
	.crt {
		position: fixed;
		inset: 0;
		z-index: 9999;
		overflow: hidden;
		padding: 36px 44px;
		box-sizing: border-box;
		background: #000;
		color: #33ff66;
		font-family: 'Consolas', 'Courier New', 'Lucida Console', monospace;
		font-size: 15px;
		line-height: 1.45;
		text-shadow:
			0 0 1px #33ff66,
			0 0 6px rgba(51, 255, 102, 0.55);
		animation: iw-power 0.55s ease-out 1;
	}

	/* phosphor scanlines */
	.crt::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: repeating-linear-gradient(
			0deg,
			rgba(0, 0, 0, 0) 0px,
			rgba(0, 0, 0, 0) 2px,
			rgba(0, 0, 0, 0.18) 3px,
			rgba(0, 0, 0, 0.18) 4px
		);
		mix-blend-mode: multiply;
		z-index: 2;
	}

	/* vignette + curvature hint */
	.crt::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.55) 100%);
		z-index: 3;
	}

	.scr {
		position: relative;
		z-index: 1;
		margin: 0;
		height: 100%;
		overflow: hidden;
		white-space: pre-wrap;
		word-break: break-word;
		font: inherit;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.scr :global(.ttl) {
		font-size: 18px;
		font-weight: bold;
		letter-spacing: 2px;
	}
	.scr :global(.dim) {
		opacity: 0.55;
	}
	.scr :global(.ok) {
		color: #9cff9c;
	}
	.scr :global(.cur) {
		display: inline-block;
		width: 0.55em;
		height: 1em;
		vertical-align: -2px;
		background: #33ff66;
		box-shadow: 0 0 6px #33ff66;
		animation: iw-blink 1s steps(1) infinite;
	}

	@keyframes iw-blink {
		50% {
			opacity: 0;
		}
	}

	@keyframes iw-power {
		0% {
			opacity: 0;
			transform: scaleY(0.02);
		}
		40% {
			opacity: 1;
			transform: scaleY(1);
		}
		100% {
			opacity: 1;
			transform: scaleY(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.crt {
			animation: none;
		}
		.scr :global(.cur) {
			animation: none;
		}
	}
</style>
