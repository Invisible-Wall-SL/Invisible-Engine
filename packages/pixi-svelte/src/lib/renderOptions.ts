/**
 * How the WebGL context and the frame are set up: whether the frame draws through Pixi's back
 * buffer, whether it is multisampled, whether the canvas is opaque. Decided once, before the
 * context exists (each of these is a context attribute or a renderer option that cannot change
 * later), from the render tier (`renderTier.ts`), what the game's content needs, the page behind the
 * canvas, and the test switches below.
 *
 * WHY IT MATTERS ON A PHONE. Every one of these is cheap on a desktop GPU and costs on a tiled one
 * (Apple's, and the canvas compositor on iOS):
 * - **The back buffer** draws the frame into an offscreen multisampled renderbuffer, resolves it
 *   with a full-screen blit and copies the result onto the canvas with a full-screen blended
 *   triangle: two extra full-screen passes a frame, and a 4× sample buffer that lives in memory.
 *   Only the ADVANCED blend modes need it (`overlay`, `lighten`: filters that read the backdrop,
 *   `advancedBlendModes.ts`); without it the canvas is multisampled itself.
 * - **A transparent canvas** makes the page compositor blend the whole canvas over the page every
 *   frame. When the page behind it is one solid colour, an opaque canvas cleared to that colour
 *   draws the same pixels.
 *
 * TEST SWITCHES (URL query; each turns exactly one thing on or off, read with `?perf=1`):
 * `?backbuffer=0|1`, `?aa=0|1`, `?opaque=0|1`, `?fx=0` (Element FX filter passes off, their motion
 * kept), `?lazyresolve=0`, `?invalidate=0` (`backBufferPasses.ts`). `?render=`, `?quality=` and `?particles=` are
 * their own (`renderTier.ts`, the asset tier, `particleBudget.ts`).
 *
 * Plain functions over plain data, so `renderOptions.fixture.ts` can pin every decision in Node.
 */

export interface RenderSwitches {
	/** `?backbuffer=0|1`: force Pixi's back buffer off or on. */
	backBuffer?: boolean;
	/** `?aa=0|1`: force multisampling off or on. */
	antialias?: boolean;
	/** `?opaque=0|1`: force the canvas opaque (cleared to the page's colour, black if unknown) or not. */
	opaque?: boolean;
	/** `?fx=0`: Element FX play without their filter passes (motion only). */
	elementFxFilters?: boolean;
	/** `?lazyresolve=0`: resolve the back buffer after every filter draw, as Pixi does
	 *  (`backBufferPasses.ts`). */
	lazyResolve?: boolean;
	/** `?invalidate=0`: store the back buffer's depth/stencil at the end of the frame, as Pixi does
	 *  (`backBufferPasses.ts`). */
	discardDepthStencil?: boolean;
}

const bool = (raw: string | null): boolean | undefined =>
	raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : undefined;

/** The test switches in a query string (`location.search`). Absent or unreadable ⇒ unset. */
export function readRenderSwitches(search: string): RenderSwitches {
	const q = new URLSearchParams(search);
	const out: RenderSwitches = {};
	const backBuffer = bool(q.get('backbuffer'));
	const antialias = bool(q.get('aa'));
	const opaque = bool(q.get('opaque'));
	if (backBuffer !== undefined) out.backBuffer = backBuffer;
	if (antialias !== undefined) out.antialias = antialias;
	if (opaque !== undefined) out.opaque = opaque;
	if (q.get('fx') === '0') out.elementFxFilters = false;
	if (q.get('lazyresolve') === '0') out.lazyResolve = false;
	if (q.get('invalidate') === '0') out.discardDepthStencil = false;
	return out;
}

/** This page's switches (none outside a browser). */
export const renderSwitches = (): RenderSwitches =>
	typeof window === 'undefined' ? {} : readRenderSwitches(window.location.search);

let fxFilters: boolean | undefined;

/** Element FX filter passes are on unless `?fx=0` (read once: the query never changes in a page). */
export const elementFxFiltersOn = (): boolean =>
	(fxFilters ??= renderSwitches().elementFxFilters !== false);

/**
 * Blend modes Pixi draws with a GPU blend state. Any other mode under a blend key is treated as
 * backdrop-reading, so an unknown or misspelt one keeps the back buffer rather than risk drawing
 * wrong. `additive` is the rig format's name for `add`; the numbers are Pixi 7's enum for the same
 * four (an old particle config may store one).
 */
const NATIVE_BLEND_MODES = new Set<string | number>([
	'',
	'normal',
	'add',
	'additive',
	'multiply',
	'screen',
	'none',
	'erase',
	'min',
	'max',
	'inherit',
	'normal-npm',
	'add-npm',
	'screen-npm',
	0,
	1,
	2,
	3,
]);

/** A value stored under a blend key that needs the backdrop. */
const isBackdropBlend = (value: unknown): boolean => {
	if (typeof value === 'string') return !NATIVE_BLEND_MODES.has(value.trim().toLowerCase());
	if (typeof value === 'number') return !NATIVE_BLEND_MODES.has(value);
	if (Array.isArray(value)) return value.some(isBackdropBlend);
	return false;
};

/**
 * The key every render blend mode is stored under: a layout node's and a symbol layer's
 * `blendMode`, a particle behaviour's `config.blendMode`, a baked effect group's `blendMode`. Other
 * `blend…` keys are not render blends: a cinematic track's `blend: 'replace'` mixes animations, its
 * `blendIn`/`blendOut` are durations.
 */
const BLEND_MODE_KEY = /^blend[-_]?modes?$/i;

/**
 * Whether any authored data can draw a blend mode that reads the backdrop. One walk of everything
 * the game renders from (layout nodes, component defs, symbol layers, effects, particle configs,
 * flows): a {@link BLEND_MODE_KEY} holding anything but a GPU-native mode. Conservative by design: a
 * mode stored on a kind that ignores it (a rig node) still counts, and so does any value it does not
 * recognise.
 */
export function needsBackdropBlend(data: unknown): boolean {
	const seen = new Set<object>();
	const walk = (value: unknown): boolean => {
		if (!value || typeof value !== 'object' || seen.has(value)) return false;
		seen.add(value);
		if (Array.isArray(value)) return value.some(walk);
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			if (BLEND_MODE_KEY.test(key) && isBackdropBlend(item)) return true;
			if (walk(item)) return true;
		}
		return false;
	};
	return walk(data);
}

/**
 * What the game knows about its content before the renderer exists. Unset ⇒ unknown, which keeps
 * the back buffer (every app but the shared runtime, the tools, a dev boot with no doc yet).
 */
export interface RenderNeeds {
	backdropBlend?: boolean;
}

let needs: RenderNeeds = {};

/** Called by a game before `<App>` mounts. */
export function declareRenderNeeds(next: RenderNeeds): void {
	needs = { ...next };
}

export const renderNeeds = (): RenderNeeds => needs;

/**
 * Defaults when no switch says otherwise.
 *
 * The back buffer stays on for every game until the owner approves the pixels it changes
 * (`docs/status/engine.md`, 2026-11-09 iPhone entry): the canvas's own MSAA rasterises in the other
 * vertical orientation from the back buffer, so the 4× sample pattern falls differently on every
 * antialiased edge, the internal edges of rig meshes included (measured: 6–7% of a frame's pixels,
 * nearly all by 1–2 levels). `?backbuffer=0` shows it.
 *
 * The opaque canvas is on: with no blend reading the backdrop, it draws the same bytes as the
 * transparent canvas over the page's solid colour (every live game, main against this, byte for
 * byte).
 */
export const AUTO_BACK_BUFFER = false;
export const AUTO_OPAQUE = true;

export interface RenderOptions {
	antialias: boolean;
	useBackBuffer: boolean;
	/** The canvas has no alpha channel and is cleared to {@link RenderOptions.background}. */
	opaque: boolean;
	/** CSS colour the opaque canvas is cleared to. */
	background?: string;
	/** Why each choice was made, for the `?perf=1` readout. */
	why: { backBuffer: string; antialias: string; opaque: string };
}

export interface RenderOptionInputs {
	/** The render tier's MSAA (`renderSettings().antialias`). */
	tierAntialias: boolean;
	switches: RenderSwitches;
	needs: RenderNeeds;
	/** The solid colour behind the canvas, when the page has exactly one ({@link solidBackdrop}). */
	backdrop?: string;
	autoBackBuffer?: boolean;
	autoOpaque?: boolean;
}

export function resolveRenderOptions({
	tierAntialias,
	switches,
	needs: content,
	backdrop,
	autoBackBuffer = AUTO_BACK_BUFFER,
	autoOpaque = AUTO_OPAQUE,
}: RenderOptionInputs): RenderOptions {
	const antialias = switches.antialias ?? tierAntialias;
	let useBackBuffer = true;
	let backBufferWhy = 'default (on)';
	if (switches.backBuffer !== undefined) {
		useBackBuffer = switches.backBuffer;
		backBufferWhy = `?backbuffer=${useBackBuffer ? 1 : 0}`;
	} else if (content.backdropBlend === true) {
		backBufferWhy = 'content blends with the backdrop';
	} else if (content.backdropBlend === false && autoBackBuffer) {
		useBackBuffer = false;
		backBufferWhy = 'no backdrop blend in the content';
	} else if (content.backdropBlend === undefined) {
		backBufferWhy = 'content unknown (on)';
	}
	let opaque = false;
	let opaqueWhy = 'default (transparent)';
	if (switches.opaque !== undefined) {
		opaque = switches.opaque;
		opaqueWhy = `?opaque=${opaque ? 1 : 0}`;
	} else if (autoOpaque && content.backdropBlend !== false) {
		opaqueWhy = 'the content may blend with the backdrop, whose alpha an opaque canvas changes';
	} else if (autoOpaque && backdrop) {
		opaque = true;
		opaqueWhy = 'the page behind is one solid colour';
	} else if (autoOpaque) {
		opaqueWhy = 'the page behind is not one known solid colour';
	}
	return {
		antialias,
		useBackBuffer,
		opaque,
		...(opaque ? { background: backdrop ?? '#000000' } : {}),
		why: {
			backBuffer: backBufferWhy,
			antialias:
				switches.antialias !== undefined
					? `?aa=${antialias ? 1 : 0}`
					: `render tier (${antialias ? 'on' : 'off'})`,
			opaque: opaqueWhy,
		},
	};
}

/** The computed style an element shows behind it, as `getComputedStyle` gives it. */
export interface BackdropLayer {
	backgroundColor: string;
	backgroundImage: string;
}

/** `rgb(…)` / `rgba(…)` → `[r, g, b, a]`, or `undefined` for any other syntax. */
export function parseCssColor(css: string): [number, number, number, number] | undefined {
	const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(
		css.trim(),
	);
	if (!m) return css.trim() === 'transparent' ? [0, 0, 0, 0] : undefined;
	const alpha =
		m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : +m[4];
	return [+m[1], +m[2], +m[3], alpha];
}

/**
 * The one solid colour seen through a transparent canvas, from the canvas's parent up to the root
 * (`layers`, nearest first): the first opaque background colour, provided nothing on the way paints
 * an image or a translucent colour. `undefined` when there is none (the browser's own canvas, an
 * embedding page, a gradient), which keeps the canvas transparent.
 */
export function solidBackdrop(layers: readonly BackdropLayer[]): string | undefined {
	for (const layer of layers) {
		if (layer.backgroundImage && layer.backgroundImage !== 'none') return undefined;
		const rgba = parseCssColor(layer.backgroundColor);
		if (!rgba) return undefined;
		if (rgba[3] === 0) continue;
		if (rgba[3] < 1) return undefined;
		const hex = rgba
			.slice(0, 3)
			.map((c) => Math.round(c).toString(16).padStart(2, '0'))
			.join('');
		return `#${hex}`;
	}
	return undefined;
}

/**
 * Whether the elements painted under the canvas at each sampled point (`document.elementsFromPoint`,
 * topmost first) are only its own ancestors: anything else (an embedding page's own canvas, a
 * sibling's background) would be hidden by an opaque canvas.
 */
export function onlyAncestorsBelow(
	stacks: readonly (readonly unknown[])[],
	canvas: unknown,
	ancestors: ReadonlySet<unknown>,
): boolean {
	return stacks.every((stack) => {
		const at = stack.indexOf(canvas);
		if (at < 0) return false;
		return stack.slice(at + 1).every((el) => ancestors.has(el));
	});
}

/**
 * The one solid colour the page shows behind a canvas about to be mounted in `parent`, or
 * `undefined` when it is not provably one colour (an embedding page's own canvas or a sibling's
 * background under ours, an image, a translucent colour). The canvas is put in place at the
 * window's size, as Pixi's `resizeTo` will make it, to read what is painted under it, and taken out
 * again before Pixi sees it. Browser only.
 */
export function measurePageBackdrop(
	parent: Element,
	canvas: HTMLCanvasElement,
): string | undefined {
	const ancestors = new Set<Element>();
	const layers: BackdropLayer[] = [];
	for (let el: Element | null = parent; el; el = el.parentElement) {
		ancestors.add(el);
		const style = getComputedStyle(el);
		layers.push({ backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage });
	}
	canvas.style.width = `${window.innerWidth}px`;
	canvas.style.height = `${window.innerHeight}px`;
	parent.appendChild(canvas);
	try {
		const rect = canvas.getBoundingClientRect();
		const stacks: Element[][] = [];
		for (const fx of [0.1, 0.5, 0.9])
			for (const fy of [0.1, 0.5, 0.9]) {
				const x = rect.left + fx * rect.width;
				const y = rect.top + fy * rect.height;
				if (x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)
					stacks.push(document.elementsFromPoint(x, y));
			}
		return stacks.length && onlyAncestorsBelow(stacks, canvas, ancestors)
			? solidBackdrop(layers)
			: undefined;
	} finally {
		canvas.remove();
		canvas.removeAttribute('style');
	}
}

let applied: RenderOptions | undefined;

/** What `<InitialiseApplication>` created the renderer with, for the `?perf=1` readout. */
export function noteAppliedRenderOptions(options: RenderOptions): void {
	applied = options;
}

export const appliedRenderOptions = (): RenderOptions | undefined => applied;
