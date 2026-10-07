/**
 * Test-only DETERMINISM MODE for the current-games harness (docs/director/DECISIONS/0004,
 * PLAN 1.2).
 *
 * `?ie_determinism=<seed>` makes two renders of the same game + forced book pixel-identical.
 * Without the flag, `installDeterminism()` returns at its first line and
 * `registerDeterminismProbe()` at its first line: nothing below runs, nothing global is replaced.
 *
 * With it, installed from `hooks.client.ts` before any game module evaluates:
 * - **Clock.** `requestAnimationFrame`, `setTimeout`/`setInterval`, `performance.now` and `Date`
 *   read one virtual clock that moves only when the harness steps it, 1/60 s per frame. That covers
 *   the Pixi ticker (and so rig and the particle emitters, which ride `Ticker.shared`), Svelte's
 *   `Tween`/`raf`, and any presentation `Date.now`. GSAP would ride the same rAF + clock; the
 *   runtime does not ship it. CSS and Web Animations (Svelte transitions) are paused, seeked to
 *   the clock and finished at their end.
 * - **Randomness.** `Math.random` is a PRNG seeded from the flag. Only cosmetic code reads it: the
 *   outcome (the book) comes from the RGS, and the client draws nothing that changes it.
 * - **I/O.** A frame does not start while a fetch, XHR, image, external script or stylesheet,
 *   `createImageBitmap`, worker job, `FontFace.load()` or web font is in flight, so how fast the
 *   network answers never changes which frame a load lands on. Every web font the page declares
 *   starts loading at the next settle (or when its stylesheet arrives), and the app starts only
 *   once the fonts declared before it have loaded (`determinismInit`). A frame that waits past
 *   `IO_STALL_MS` counts a stall and gives up on what it waited on, once.
 * - **Ready signal.** `window.__IE_DETERMINISM__` (see `DeterminismApi`): `step(n)` and
 *   `waitFor({ screen, idle, … })`, reading `Game.svelte`'s probe.
 * - **Drawing.** Every frame draws by default. `draw: 'last'` runs the frames without the WebGL
 *   draw and draws once at the end: the same updates, ~100× faster under software GL (a draw is
 *   ~99% of a frame there). Nothing in the game reads a drawn frame back (no render-to-texture);
 *   one that did would read blank in `last`. A harness uses one mode on both sides of a comparison.
 *   Every draw to the screen starts from a cleared canvas (see `clearCanvasBeforeDraws`), as every
 *   frame the browser shows does.
 * - **Time zone and locale** are the browser's; a harness pins them (CDP `setTimezoneOverride`).
 */

const FLAG = 'ie_determinism';
export const DETERMINISM_FRAME_MS = 1000 / 60;
// A fixed wall clock, so a rendered date or time reads the same on every run.
const EPOCH_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
// Real time a frame may wait for in-flight I/O before it gives up and counts a stall.
const IO_STALL_MS = 30_000;
const MICROTASK_TURNS = 64;
// Virtual timer ids start here, clear of any id the real timers handed out before install.
const TIMER_ID_BASE = 1_000_000_000;

export type DeterminismProbeState = {
	/** The active screen set, render order (topmost last). */
	screens: readonly string[];
	/** The game state machine is idle between rounds. */
	idle: boolean;
	/** Assets are loaded. */
	loaded: boolean;
	/** The boot settled and no loading / tap-to-start screen covers the board. */
	playerIn: boolean;
	/** The win tier on show (`winState.winLevelData.alias`), if any. */
	winLevel: string | undefined;
	/** The round's win so far, in book units (`stateBet.winBookEventAmount`, the HUD's Win). */
	win: number;
};

export type DeterminismCondition = {
	/** The screen is the TOPMOST active screen (`inSet` relaxes this to anywhere in the set). */
	screen?: string;
	inSet?: boolean;
	idle?: boolean;
	loaded?: boolean;
	playerIn?: boolean;
	/** A win tier alias (`bigWin`, …) is on show; `null` waits for none. */
	winLevel?: string | null;
	/** Give up after this many frames (default 3600, one virtual minute). */
	maxFrames?: number;
	draw?: DeterminismDraw;
};

/** `every` frame (default) or only the `last` one of a call. */
export type DeterminismDraw = 'every' | 'last';

type RendererLike = {
	render(...args: unknown[]): void;
	view: { renderTarget: object };
	background: { clearBeforeRender: boolean };
	backBuffer?: { useBackBuffer: boolean };
	renderTarget: { bind(options: { target: object; clear: boolean; clearColor: number[] }): void };
};
type PixiAppLike = { render(): void; renderer: RendererLike };

export type DeterminismState = DeterminismProbeState & {
	seed: string;
	frame: number;
	now: number;
	pendingIo: number;
	stalls: number;
	errors: number;
};

export type DeterminismApi = {
	readonly seed: string;
	readonly frameMs: number;
	state(): DeterminismState;
	/** Run `frames` frames (default 1); resolves with the frame number reached. */
	step(frames?: number, options?: { draw?: DeterminismDraw }): Promise<number>;
	/** Step until `condition` holds (checked before the first frame and after each one). */
	waitFor(
		condition: DeterminismCondition,
	): Promise<{ ok: boolean; frame: number; state: DeterminismState }>;
};

declare global {
	var __IE_DETERMINISM__: DeterminismApi | undefined;
}

/** The flag's seed, or `undefined` when determinism mode is off. */
const flagSeed = (): string | undefined => {
	if (typeof location === 'undefined') return undefined;
	return new URLSearchParams(location.search).get(FLAG) ?? undefined;
};

/** FNV-1a of the seed text, so any string seeds the generator. */
const hashSeed = (seed: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
	return h >>> 0;
};

/** mulberry32: small, fast, and the same sequence on every engine. */
const seededRandom = (seed: number): (() => number) => {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

type VirtualTimer = {
	due: number;
	order: number;
	interval: number | undefined;
	run: () => void;
};

let probe: (() => DeterminismProbeState) | undefined;

/**
 * `Game.svelte` hands over a reader of its screen + round state. A no-op when the mode is off;
 * returns the unregister.
 */
export function registerDeterminismProbe(read: () => DeterminismProbeState): () => void {
	if (!globalThis.__IE_DETERMINISM__) return () => {};
	probe = read;
	return () => {
		if (probe === read) probe = undefined;
	};
}

/**
 * SvelteKit's client `init` hook, awaited before the app starts. With the flag, every web font the
 * page has declared by then (the `app.html` kit stylesheet's faces) is loaded first: the boot
 * measures and draws text in real-time continuations, outside any frame, so a face still on the
 * way when a text is first measured would decide its metrics by network order. A face that has
 * not loaded after `IO_STALL_MS` real time is a stall, and the boot goes on. Without the flag it
 * returns `undefined`, which `start()` awaits either way (`await hooks.init?.()`).
 */
let initFonts: (() => Promise<void>) | undefined;
export function determinismInit(): Promise<void> | undefined {
	return initFonts?.();
}

export function installDeterminism(): void {
	const seed = flagSeed();
	if (seed === undefined || globalThis.__IE_DETERMINISM__) return;

	const realSetTimeout = globalThis.setTimeout.bind(globalThis);
	const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
	const RealDate = Date;
	const realFetch = globalThis.fetch.bind(globalThis);
	const realCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);
	const report = (error: unknown) => {
		errors++;
		globalThis.reportError?.(error);
	};

	let now = 0;
	let frame = 0;
	let pendingIo = 0;
	let stalls = 0;
	let errors = 0;
	let nextTimerId = TIMER_ID_BASE;
	let nextOrder = 0;
	let nextRafId = 0;
	let stepping: Promise<unknown> = Promise.resolve();
	const timers = new Map<number, VirtualTimer>();
	const rafCallbacks = new Map<number, FrameRequestCallback>();
	const cssStarts = new WeakMap<Animation, number>();

	// ---- randomness ----
	Math.random = seededRandom(hashSeed(seed));

	// ---- clock ----
	performance.now = () => now;
	globalThis.Date = new Proxy(RealDate, {
		construct: (target, args: unknown[], newTarget) =>
			Reflect.construct(target, args.length ? args : [EPOCH_MS + now], newTarget),
		apply: () => new RealDate(EPOCH_MS + now).toString(),
		get: (target, key, receiver) =>
			key === 'now' ? () => Math.floor(EPOCH_MS + now) : Reflect.get(target, key, receiver),
	});

	globalThis.requestAnimationFrame = (callback) => {
		rafCallbacks.set(++nextRafId, callback);
		return nextRafId;
	};
	globalThis.cancelAnimationFrame = (id) => {
		rafCallbacks.delete(id);
	};

	const addTimer = (handler: TimerHandler, delay: unknown, args: unknown[], repeat: boolean) => {
		if (typeof handler !== 'function')
			throw new TypeError(`${FLAG}: string timers are not supported`);
		const ms = Math.max(1, Number(delay) || 0);
		const id = ++nextTimerId;
		timers.set(id, {
			due: now + ms,
			order: nextOrder++,
			interval: repeat ? ms : undefined,
			run: () => (handler as (...a: unknown[]) => void)(...args),
		});
		return id;
	};
	const clearTimer = (id: number | undefined) => {
		if (id === undefined) return;
		if (!timers.delete(id) && id < TIMER_ID_BASE) realClearTimeout(id);
	};
	const virtualSetTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
		addTimer(handler, delay, args, false);
	const virtualSetInterval = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
		addTimer(handler, delay, args, true);
	globalThis.setTimeout = virtualSetTimeout as typeof setTimeout;
	globalThis.setInterval = virtualSetInterval as typeof setInterval;
	globalThis.clearTimeout = clearTimer as typeof clearTimeout;
	globalThis.clearInterval = clearTimer as typeof clearInterval;

	// ---- I/O tracking ----
	// Each load in flight holds one count, released once by its `end()`. A stall abandons every
	// count of its generation (and every face still loading), so a load that ends after a stall can
	// never release a count a later load holds.
	let ioGeneration = 0;
	const abandonedFaces = new WeakSet<FontFace>();
	const begin = () => {
		const generation = ioGeneration;
		let open = true;
		pendingIo++;
		return () => {
			if (!open) return;
			open = false;
			if (generation === ioGeneration) pendingIo = Math.max(0, pendingIo - 1);
		};
	};
	const abandon = () => {
		stalls++;
		ioGeneration++;
		pendingIo = 0;
		document.fonts?.forEach((face) => {
			if (face.status === 'loading') abandonedFaces.add(face);
		});
	};
	const track = <T>(promise: Promise<T>): Promise<T> => promise.finally(begin());
	globalThis.fetch = (...args: Parameters<typeof fetch>) => track(realFetch(...args));
	for (const method of ['arrayBuffer', 'blob', 'formData', 'json', 'text'] as const) {
		const real = Response.prototype[method] as (this: Response) => Promise<unknown>;
		Object.defineProperty(Response.prototype, method, {
			configurable: true,
			writable: true,
			value(this: Response) {
				return track(real.call(this));
			},
		});
	}
	// A FontFace loading before it is added to `document.fonts` (`registerBakedWebFonts` awaits
	// `load()` first) is invisible to the font wait: track the load itself. The face's own promise
	// is what `load()` returns (`face.load() === face.loaded`).
	if (typeof FontFace !== 'undefined') {
		const realFontLoad = FontFace.prototype.load;
		FontFace.prototype.load = function (this: FontFace) {
			const loading = realFontLoad.call(this);
			track(loading).catch(() => undefined);
			return loading;
		};
	}
	if (realCreateImageBitmap)
		globalThis.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) =>
			track(realCreateImageBitmap(...args))) as typeof createImageBitmap;

	const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
	if (imageSrc?.set) {
		const setSrc = imageSrc.set;
		Object.defineProperty(HTMLImageElement.prototype, 'src', {
			...imageSrc,
			set(this: HTMLImageElement, value: string) {
				setSrc.call(this, value);
				if (this.complete) return;
				const end = begin();
				const done = () => {
					end();
					this.removeEventListener('load', done);
					this.removeEventListener('error', done);
				};
				this.addEventListener('load', done);
				this.addEventListener('error', done);
			},
		});
	}

	// Every declared face that nothing has loaded yet starts loading, so the font wait covers it.
	const loadDeclaredFonts = () => {
		document.fonts?.forEach((face) => {
			if (face.status === 'unloaded') face.load().catch(() => undefined);
		});
	};

	// An external <script> or stylesheet <link> is in flight from its insertion until it loads or
	// fails. Web-font loaders inject both (Typekit: its kit script, then the kit's CSS), and their
	// own give-up timer runs on the virtual clock, so an untracked load raced the frames. Only
	// elements that will fire `load` or `error` count: a script the browser runs (not `nomodule`, a
	// JavaScript type), a stylesheet with an `href` that is not disabled or already loaded. A
	// stylesheet removed before it loads fires nothing, so its removal releases it. A script set
	// through `innerHTML` never runs and fires nothing either, and nothing tells it apart: it would
	// cost one counted stall (nothing in the runtime inserts one).
	const runs = (script: HTMLScriptElement) => {
		const type = script.type.trim().toLowerCase();
		return (
			type === 'module' ||
			(!script.noModule &&
				(type === '' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type)))
		);
	};
	const tracked = new WeakSet<Element>();
	const pendingLinks = new Map<HTMLLinkElement, () => void>();
	const trackLoad = (el: Element) => {
		const external =
			(el instanceof HTMLScriptElement && el.src !== '' && runs(el)) ||
			(el instanceof HTMLLinkElement &&
				el.rel === 'stylesheet' &&
				!!el.getAttribute('href') &&
				!el.disabled &&
				!el.sheet);
		if (!external || !el.isConnected || tracked.has(el)) return;
		tracked.add(el);
		const end = begin();
		const done = () => {
			end();
			if (el instanceof HTMLLinkElement) pendingLinks.delete(el);
			el.removeEventListener('load', done);
			el.removeEventListener('error', done);
			loadDeclaredFonts();
		};
		if (el instanceof HTMLLinkElement) pendingLinks.set(el, done);
		el.addEventListener('load', done);
		el.addEventListener('error', done);
	};
	new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (!(node instanceof Element)) continue;
				trackLoad(node);
				for (const el of node.querySelectorAll('script[src], link[rel="stylesheet"]'))
					trackLoad(el);
			}
			if (record.removedNodes.length)
				for (const [link, done] of pendingLinks) if (!link.isConnected) done();
		}
	}).observe(document, { childList: true, subtree: true });

	const realXhrSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body) {
		realXhrSend.call(this, body);
		this.addEventListener('loadend', begin(), { once: true });
	};

	// A worker is busy from construction until it first speaks or is first given work (Pixi's
	// ImageBitmap probe speaks unprompted; its pool workers wait for a job), then per job until
	// it answers.
	const RealWorker = globalThis.Worker;
	if (RealWorker)
		globalThis.Worker = class TrackedWorker extends RealWorker {
			#boot: (() => void) | undefined;
			#jobs: (() => void)[] = [];
			constructor(...args: ConstructorParameters<typeof Worker>) {
				super(...args);
				this.#boot = begin();
				const answered = () => {
					if (this.#boot) this.#booted();
					else this.#jobs.shift()?.();
				};
				this.addEventListener('message', answered);
				this.addEventListener('error', answered);
			}
			#booted() {
				this.#boot?.();
				this.#boot = undefined;
			}
			postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]): void {
				this.#booted();
				this.#jobs.push(begin());
				super.postMessage(message, options as StructuredSerializeOptions);
			}
			terminate() {
				this.#booted();
				for (const end of this.#jobs.splice(0)) end();
				super.terminate();
			}
		};

	// ---- the frame ----
	const realMacrotask = () => {
		const { port1, port2 } = new MessageChannel();
		return new Promise<void>((resolve) => {
			port1.onmessage = () => {
				port1.close();
				resolve();
			};
			port2.postMessage(null);
		});
	};
	// Microtasks only — a real task (a network answer) never runs between two callbacks of a frame.
	const drainMicrotasks = async () => {
		for (let i = 0; i < MICROTASK_TURNS; i++) await Promise.resolve();
	};
	// A face still loading holds the frame, unless a stall gave up on it.
	const fontsLoading = () => {
		let loading = false;
		document.fonts?.forEach((face) => {
			if (face.status === 'loading' && !abandonedFaces.has(face)) loading = true;
		});
		return loading;
	};
	// Let real tasks run until no I/O is in flight for two turns in a row.
	const settle = async () => {
		const started = RealDate.now();
		let quiet = 0;
		while (quiet < 2) {
			await realMacrotask();
			loadDeclaredFonts();
			quiet = pendingIo > 0 || fontsLoading() ? 0 : quiet + 1;
			if (quiet === 0 && RealDate.now() - started > IO_STALL_MS) {
				// A load that never ends must not cost every later frame the same wait.
				abandon();
				return;
			}
			if (quiet === 0) await new Promise((resolve) => realSetTimeout(resolve, 4));
		}
	};
	const nextDueTimer = (until: number): [number, VirtualTimer] | undefined => {
		let best: [number, VirtualTimer] | undefined;
		for (const entry of timers) {
			const timer = entry[1];
			if (timer.due > until) continue;
			if (
				!best ||
				timer.due < best[1].due ||
				(timer.due === best[1].due && timer.order < best[1].order)
			)
				best = entry;
		}
		return best;
	};
	const seekCssAnimations = () => {
		if (typeof document === 'undefined' || !document.getAnimations) return;
		for (const animation of document.getAnimations()) {
			let start = cssStarts.get(animation);
			if (start === undefined) {
				start = now;
				cssStarts.set(animation, start);
				animation.pause();
			}
			const time = now - start;
			const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
			// A paused animation never finishes on its own; Svelte chains its transitions on `finish`.
			if (time >= end) animation.finish();
			else animation.currentTime = time;
		}
	};
	const pixiApp = () => (globalThis as { __PIXI_APP__?: PixiAppLike }).__PIXI_APP__;
	// Through a back buffer (`useBackBuffer`), Pixi clears the buffer and then blends it onto the
	// canvas without clearing the canvas: the browser clears it once it has shown it. Two draws
	// before the browser shows one leave every translucent pixel over a transparent part of the
	// canvas drawn twice (a HUD text's edges brighten), and how many draws land before it shows one
	// depends on real time, not on the frames. So each draw to the screen first clears the canvas
	// the way the browser does, as for every frame a player sees.
	const wrapped = new WeakSet<object>();
	const clearCanvasBeforeDraws = () => {
		const renderer = pixiApp()?.renderer;
		if (!renderer || wrapped.has(renderer)) return;
		wrapped.add(renderer);
		const render = renderer.render;
		renderer.render = function (this: unknown, ...args: unknown[]) {
			const [first, legacy] = args as [
				{ container?: unknown; target?: object; clear?: unknown } | undefined,
				{ renderTexture?: object } | undefined,
			];
			const isOptions = !!first && 'container' in first;
			const screen = renderer.view.renderTarget;
			const target = (isOptions ? first.target : legacy?.renderTexture) || screen;
			const clear = (isOptions ? first.clear : undefined) ?? renderer.background.clearBeforeRender;
			if (renderer.backBuffer?.useBackBuffer && target === screen && clear)
				renderer.renderTarget.bind({ target: screen, clear: true, clearColor: [0, 0, 0, 0] });
			return render.apply(this, args);
		};
	};
	const runFrame = async (draw: boolean) => {
		await settle();
		clearCanvasBeforeDraws();
		const target = now + DETERMINISM_FRAME_MS;
		for (let due = nextDueTimer(target); due; due = nextDueTimer(target)) {
			const [id, timer] = due;
			now = Math.max(now, timer.due);
			if (timer.interval === undefined) timers.delete(id);
			else timer.due += timer.interval;
			try {
				timer.run();
			} catch (error) {
				report(error);
			}
			await drainMicrotasks();
		}
		now = target;
		frame++;
		// This frame's callbacks, by id: one requested during it runs next frame, one cancelled
		// during it does not run.
		const ids = [...rafCallbacks.keys()];
		const renderer = draw ? undefined : pixiApp()?.renderer;
		const render = renderer?.render;
		if (renderer) renderer.render = () => {};
		try {
			for (const id of ids) {
				const callback = rafCallbacks.get(id);
				if (!callback) continue;
				rafCallbacks.delete(id);
				try {
					callback(now);
				} catch (error) {
					report(error);
				}
				await drainMicrotasks();
			}
		} finally {
			if (renderer && render) renderer.render = render;
		}
		seekCssAnimations();
	};
	// Run frames until `done` (checked before each); under `last`, draw once at the end.
	const runFrames = async (draw: DeterminismDraw | undefined, done: () => boolean) => {
		const every = draw !== 'last';
		let ran = false;
		while (!done()) {
			await runFrame(every);
			ran = true;
		}
		if (ran && !every) {
			clearCanvasBeforeDraws();
			pixiApp()?.render();
		}
	};

	const readProbe = (): DeterminismProbeState => {
		const read = probe?.();
		// The screen set is a Svelte state proxy; hand out a plain copy.
		return read
			? { ...read, screens: [...read.screens] }
			: { screens: [], idle: false, loaded: false, playerIn: false, winLevel: undefined, win: 0 };
	};
	const state = (): DeterminismState => ({
		seed,
		frame,
		now,
		pendingIo,
		stalls,
		errors,
		...readProbe(),
	});
	const holds = (c: DeterminismCondition, s: DeterminismState): boolean =>
		(c.screen === undefined ||
			(c.inSet ? s.screens.includes(c.screen) : s.screens[s.screens.length - 1] === c.screen)) &&
		(c.idle === undefined || s.idle === c.idle) &&
		(c.loaded === undefined || s.loaded === c.loaded) &&
		(c.playerIn === undefined || s.playerIn === c.playerIn) &&
		(c.winLevel === undefined || (s.winLevel ?? null) === c.winLevel);
	// Calls queue behind each other, so two harness calls never interleave their frames.
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = stepping.then(work, work);
		stepping = run.catch(() => undefined);
		return run;
	};

	initFonts = () =>
		new Promise<void>((resolve) => {
			const timer = realSetTimeout(() => {
				abandon();
				resolve();
			}, IO_STALL_MS);
			Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined))).then(
				() => {
					realClearTimeout(timer);
					resolve();
				},
			);
		});

	globalThis.__IE_DETERMINISM__ = {
		seed,
		frameMs: DETERMINISM_FRAME_MS,
		state,
		step: (frames = 1, options = {}) =>
			serial(async () => {
				const target = frame + frames;
				await runFrames(options.draw, () => frame >= target);
				return frame;
			}),
		waitFor: (condition) =>
			serial(async () => {
				const limit = frame + (condition.maxFrames ?? 3600);
				await runFrames(condition.draw, () => holds(condition, state()) || frame >= limit);
				return { ok: holds(condition, state()), frame, state: state() };
			}),
	};
}
