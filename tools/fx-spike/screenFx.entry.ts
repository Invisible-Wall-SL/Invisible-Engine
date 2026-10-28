/**
 * The `screen-fx` gate's page (`screenFx.mjs`) on WebGL1 or WebGL2: screen transitions
 * (`pixi-svelte/screenFx`) played on a real app with the game's renderer settings
 * (`useBackBuffer`, WebGL forced), two screens built as a game's are (siblings on the stage, a Show
 * and a Hide between them), and every frame read back off the canvas against each screen drawn
 * alone. Each claim is logged as an error when it does not hold; `window.result` lists them all.
 *
 * The screens are opaque and carry one-pixel stripes both ways, so a still shifted, scaled or
 * blurred by a fraction of a pixel shows. Edges are drawn without MSAA (`antialias: false`): a
 * stage filter draws without it by default (design §16.10), which step 3 measures.
 */
import {
	AlphaFilter,
	Application,
	Container,
	GlProgram,
	Graphics,
	RenderTexture,
	TexturePool,
	type WebGLRenderer,
} from 'pixi.js';
import {
	setCustomElementFx,
	type CustomElementFx,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	builtinTwin,
	compileShaderEffect,
	graphBuilder,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import {
	SCREEN_STILL_MAX_PX,
	disposeScreenTransitions,
	playScreenTransition,
	screenTransitionKindRoute,
	setStageFxAntialias,
	stageFilters,
	stagePostFxSlot,
	waitForScreenTransition,
	type ScreenTransitionHandle,
	type ScreenTransitionPlay,
} from '@fxroot/packages/pixi-svelte/src/lib/screenFx';
import { runCameraEffect } from '@fxroot/packages/pixi-svelte/src/lib/cameraEffects';

const STEP_MS = 16;
const BAND = 10_500;
const EXIT_KINDS = [
	'popOut',
	'fadeOut',
	'melt',
	'burn',
	'dissolveOut',
	'crash',
	'crumble',
	'shatter',
	'crystallize',
	'disintegrate',
];

const page = window as unknown as {
	ready: boolean;
	result?: { claims: [string, boolean][]; notes: string[] };
};
const claims: [string, boolean][] = [];
const notes: string[] = [];
const claim = (label: string, ok: boolean): void => {
	claims.push([label, ok]);
	if (!ok) console.error(`screen-fx: ${label}`);
};

// --- the effects -------------------------------------------------------------------------------

const effectOf = (doc: ShaderGraphDoc): CustomElementFx => {
	const result = compileShaderEffect(doc);
	if (!result.ok) throw new Error(`${doc.id}: ${result.issues.map((i) => i.message).join('; ')}`);
	return result.effect;
};
const screensGraph = (
	id: string,
	phase: 'enter' | 'exit',
	wire: (g: ReturnType<typeof graphBuilder>, screens: string, output: string) => void,
): CustomElementFx => {
	const g = graphBuilder({ id, name: id, phase, durationMs: 1000 });
	const screens = g.node('screens');
	wire(g, screens, g.node('output'));
	return effectOf(g.doc());
};
const crossfadeWire = (g: ReturnType<typeof graphBuilder>, screens: string, output: string) => {
	const mix = g.node('mix');
	g.wire(screens, 'from', mix, 'a');
	g.wire(screens, 'to', mix, 'b');
	g.wire(g.node('time'), 'progress', mix, 't');
	g.wire(mix, 'out', output, 'color');
};
const aloneGraph = (id: string, phase: 'enter' | 'exit'): CustomElementFx => {
	const g = graphBuilder({ id, name: id, phase, durationMs: 1000 });
	g.node('output');
	return effectOf(g.doc());
};
const outputAlone = aloneGraph('output-alone', 'enter');
const exitAlone = aloneGraph('exit-alone', 'exit');
const from = screensGraph('from', 'enter', (g, s, o) => g.wire(s, 'from', o, 'color'));
const reverse = screensGraph('reverse', 'enter', (g, s, o) => g.wire(s, 'reverse', o, 'color'));
const crossfade = screensGraph('crossfade', 'enter', crossfadeWire);
const exitCrossfade = screensGraph('exit-crossfade', 'exit', crossfadeWire);
const dissolveTwin = builtinTwin('dissolveOut');
if (!dissolveTwin) throw new Error('no dissolveOut twin');
const exitPlain = effectOf({ ...(dissolveTwin.doc as ShaderGraphDoc), id: 'exit-plain' });
const broken = screensGraph('broken', 'enter', crossfadeWire);
broken.shader = {
	...broken.shader,
	body: broken.shader.body.replace(
		'void main(void)\n{',
		'void main(void)\n{\n    float broken = nope;',
	),
};
const refused = screensGraph('refused', 'enter', crossfadeWire);
refused.shader = { ...refused.shader, body: `#define REFUSED 1\n${refused.shader.body}` };
const registered = setCustomElementFx([
	outputAlone,
	exitAlone,
	from,
	reverse,
	crossfade,
	exitCrossfade,
	exitPlain,
	broken,
	refused,
]);
claim('the registry takes every effect the gate plays (9 of 9)', registered.length === 9);
const kindOf = (effect: CustomElementFx) => effect.spec.kind;

// --- the app and its screens -------------------------------------------------------------------

type Rig = {
	app: Application;
	oldScreen: Container;
	newScreen: Container;
	clock: number;
	timeScale: number;
};

const screenArt = (w: number, h: number, palette: number[], offset: number): Container => {
	const g = new Graphics()
		.rect(0, 0, w / 2, h / 2)
		.fill(palette[0])
		.rect(w / 2, 0, w / 2, h / 2)
		.fill(palette[1])
		.rect(0, h / 2, w / 2, h / 2)
		.fill(palette[2])
		.rect(w / 2, h / 2, w / 2, h / 2)
		.fill(palette[3]);
	for (let x = 8 + offset; x < w / 3; x += 2) g.rect(x, 10, 1, h - 20).fill(0xffffff);
	for (let y = 9 + offset; y < h / 3; y += 2) g.rect(w / 2, y, w / 2 - 6, 1).fill(0x000000);
	g.circle(w * 0.62, h * 0.66, Math.min(w, h) * 0.18).fill(palette[4]);
	g.star(w * 0.3, h * 0.7, 5, Math.min(w, h) * 0.16, Math.min(w, h) * 0.07).fill(palette[5]);
	const screen = new Container();
	screen.addChild(g);
	return screen;
};

const makeRig = async (
	gl: number,
	{ width = 321, height = 201, resolution = 1 } = {},
): Promise<Rig> => {
	const app = new Application();
	await app.init({
		width,
		height,
		background: 0x101418,
		preference: 'webgl',
		preferWebGLVersion: gl === 1 ? 1 : 2,
		antialias: false,
		useBackBuffer: true,
		autoStart: false,
		sharedTicker: false,
		resolution,
		autoDensity: true,
		preserveDrawingBuffer: true,
	});
	document.body.appendChild(app.canvas);
	const oldScreen = screenArt(
		width,
		height,
		[0xc83c28, 0x3246d2, 0xe6c828, 0x782aa0, 0x2ad1c4, 0xffffff],
		0,
	);
	const newScreen = screenArt(
		width,
		height,
		[0x28a05a, 0xdfe6ee, 0x1d3557, 0xf4a261, 0xe63946, 0x111111],
		1,
	);
	newScreen.visible = false;
	app.stage.addChild(oldScreen, newScreen);
	const rig: Rig = { app, oldScreen, newScreen, clock: 1000, timeScale: 1 };
	app.ticker.lastTime = rig.clock;
	return rig;
};

const dropRig = (rig: Rig): void => {
	rig.app.canvas.remove();
	rig.app.destroy(true, { children: true, texture: true });
};

const frame = (rig: Rig, n = 1): void => {
	for (let i = 0; i < n; i++) {
		rig.clock += STEP_MS;
		rig.app.ticker.update(rig.clock);
	}
};

const show = (rig: Rig, which: 'old' | 'new'): void => {
	rig.oldScreen.visible = which === 'old';
	rig.newScreen.visible = which === 'new';
};

let shotWidth = 1;
/** The canvas as drawn, top row first, read off the default framebuffer (bound after the app's
 *  render). */
const shot = (rig: Rig): Uint8Array => {
	const { gl } = rig.app.renderer as WebGLRenderer;
	const w = gl.drawingBufferWidth;
	const h = gl.drawingBufferHeight;
	const raw = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
	const pixels = new Uint8Array(raw.length);
	for (let y = 0; y < h; y++)
		pixels.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
	shotWidth = w;
	return pixels;
};

/** Each screen alone, as the canvas shows it with no transition. */
const references = (rig: Rig): { old: Uint8Array; new: Uint8Array } => {
	show(rig, 'old');
	frame(rig);
	const old = shot(rig);
	show(rig, 'new');
	frame(rig);
	const fresh = shot(rig);
	show(rig, 'old');
	frame(rig);
	return { old, new: fresh };
};

type Difference = { over: number; max: number; first?: [number, number] };

/** How many channel values differ by more than `tolerance`, the largest difference, and where the
 *  first is (x, y on the last canvas read). */
const compare = (
	a: Uint8Array,
	b: Uint8Array | ((i: number) => number),
	tolerance = 0,
): Difference => {
	let over = 0;
	let max = 0;
	let first: [number, number] | undefined;
	for (let i = 0; i < a.length; i++) {
		if ((i & 3) === 3) continue;
		const d = Math.abs(a[i] - (typeof b === 'function' ? b(i) : b[i]));
		if (d > max) max = d;
		if (d > tolerance) {
			over++;
			first ??= [(i >> 2) % shotWidth, Math.floor((i >> 2) / shotWidth)];
		}
	}
	return { over, max, first };
};
const same = (a: Uint8Array, b: Uint8Array): boolean => compare(a, b).over === 0;
const said = (c: Difference): string =>
	`${c.over} values off, largest ${c.max}${c.first ? `, first at ${c.first.join(', ')}` : ''}`;

const host = (rig: Rig) => ({
	ticker: rig.app.ticker,
	renderer: rig.app.renderer,
	timeScale: () => rig.timeScale,
});

const play = (rig: Rig, options: Omit<ScreenTransitionPlay, 'zIndex'>): ScreenTransitionHandle =>
	playScreenTransition(rig.app, { zIndex: BAND, ...options }, host(rig));

/** Start, take the still on the next frame, then show the new screen, as a flow does. */
const begin = async (
	rig: Rig,
	options: Omit<ScreenTransitionPlay, 'zIndex'>,
): Promise<ScreenTransitionHandle> => {
	show(rig, 'old');
	const handle = play(rig, options);
	frame(rig);
	await handle.captured;
	show(rig, 'new');
	return handle;
};

/** Frames until `handle` is done (at most `limit`, then it is ended); how many. */
const playOut = async (rig: Rig, handle: ScreenTransitionHandle, limit = 2000): Promise<number> => {
	let n = 0;
	while (handle.active && n < limit) {
		frame(rig);
		n++;
	}
	handle.end();
	await handle.done;
	return n;
};

const atRest = (rig: Rig): boolean =>
	!rig.app.stage.filters?.length &&
	!rig.app.stage.filterArea &&
	rig.app.stage.children.length === 2 &&
	stageFilters(rig.app, 'transition').length === 0;

const settled = async (p: Promise<unknown>): Promise<boolean> => {
	let done = false;
	void p.then(() => (done = true));
	await Promise.resolve();
	await Promise.resolve();
	return done;
};

const easeInQuad = (t: number): number => t * t;

// --- the claims --------------------------------------------------------------------------------

const routes = (): void => {
	const cases: [string, string, 'in' | 'out' | undefined][] = [
		['a built-in exit', 'dissolveOut', 'out'],
		['a built-in emphasis', 'pulse', undefined],
		['a custom exit not reading Screens', kindOf(exitPlain), 'out'],
		['a custom exit reading Screens', kindOf(exitCrossfade), 'in'],
		['a custom enter', kindOf(crossfade), 'in'],
		['an Output alone', kindOf(outputAlone), 'in'],
		['a kind not registered', 'custom:gone', undefined],
	];
	for (const [label, kind, route] of cases)
		claim(
			`routing: ${label} takes ${route ?? 'the fallback'}`,
			screenTransitionKindRoute(kind) === route,
		);
};

/** The In and Out routes' identities at `resolution`, optionally under pooled textures larger
 *  than the frame. */
const identities = async (gl: number, resolution: number, pooled: boolean): Promise<void> => {
	const rig = await makeRig(gl, { resolution });
	const where = `at resolution ${resolution}${pooled ? ', under pooled textures larger than the frame' : ''}`;
	const ref = references(rig);
	claim(`${where}: the two screens differ`, compare(ref.old, ref.new).over > 1000);
	const optimal = TexturePool.getOptimalSize.bind(TexturePool);
	if (pooled)
		TexturePool.getOptimalSize = (w: number, h: number, r = 1) => {
			const fit = optimal(w, h, r);
			return { width: fit.width + 64, height: fit.height + 32 };
		};
	try {
		// In: an Output alone draws the live stage: the old screen on the capture frame, the new after.
		{
			show(rig, 'old');
			const handle = play(rig, { kind: kindOf(outputAlone), durationMs: 400 });
			frame(rig);
			const atCapture = compare(shot(rig), ref.old);
			await handle.captured;
			show(rig, 'new');
			let worst: Difference = { over: 0, max: 0 };
			let frames = 0;
			while (handle.active) {
				frame(rig);
				if (!handle.active) break;
				frames++;
				const c = compare(shot(rig), ref.new);
				if (c.over > worst.over) worst = c;
			}
			claim(
				`In route ${where}: an Output alone draws the live stage, pixel for pixel (the old screen on the capture frame: ${said(atCapture)}; the new for ${frames} frames: ${said(worst)})`,
				handle.route === 'in' && atCapture.over === 0 && worst.over === 0 && frames >= 20,
			);
			claim(
				`In route ${where}: the stage is at rest after it`,
				atRest(rig) && same(shot(rig), ref.new),
			);
		}
		// In: Screens → From draws the still: the old screen, every frame.
		{
			const handle = await begin(rig, { kind: kindOf(from), durationMs: 400 });
			let worst: Difference = { over: 0, max: 0 };
			let frames = 0;
			while (handle.active) {
				frame(rig);
				if (!handle.active) break;
				frames++;
				const c = compare(shot(rig), ref.old);
				if (c.over > worst.over) worst = c;
			}
			const size = `${rig.app.screen.width} × ${rig.app.screen.height} at ${resolution}`;
			claim(
				`In route ${where}: Screens → From draws the old screen pixel for pixel, the still at its real size (${size}; ${frames} frames: ${said(worst)})`,
				worst.over === 0 && frames >= 20,
			);
		}
		// Out: at t = 0 the still covers the game: the old screen.
		{
			const handle = await begin(rig, { kind: 'dissolveOut', pose: () => ({ progress: 0 }) });
			frame(rig, 3);
			const c = compare(shot(rig), ref.old);
			claim(
				`Out route ${where}: at t = 0 the still draws the old screen pixel for pixel (${said(c)})`,
				handle.route === 'out' && c.over === 0,
			);
			handle.end();
			await handle.done;
			frame(rig);
			claim(
				`Out route ${where}: ended, the stage is at rest`,
				atRest(rig) && same(shot(rig), ref.new),
			);
		}
		// Out: a pass on the still reads its edge pixels inside its frame. An exit graph that is only
		// its Output draws the still as it is (Element FX passes draw at resolution 1).
		if (resolution === 1) {
			const handle = await begin(rig, { kind: kindOf(exitAlone), pose: () => ({ progress: 0.5 }) });
			frame(rig, 3);
			const c = compare(shot(rig), ref.old);
			claim(
				`Out route ${where}: an exit graph of only its Output, half way, draws the old screen pixel for pixel, edges too (${said(c)})`,
				handle.route === 'out' && c.over === 0,
			);
			handle.end();
			await handle.done;
		}
	} finally {
		TexturePool.getOptimalSize = optimal;
	}
	dropRig(rig);
};

const crossfades = async (gl: number): Promise<void> => {
	const rig = await makeRig(gl);
	const ref = references(rig);
	// Half way: the mean of the two screens, within the twins' tolerance.
	{
		const handle = await begin(rig, { kind: kindOf(crossfade), pose: () => ({ progress: 0.5 }) });
		frame(rig, 2);
		const c = compare(shot(rig), (i) => (ref.old[i] + ref.new[i]) / 2, 2);
		claim(
			`a crossfade at 0.5 is the mean of the two screens within 2 steps (${said(c)})`,
			c.over === 0,
		);
		handle.end();
		await handle.done;
	}
	// Played: no frame darker than both screens at any pixel.
	{
		const handle = await begin(rig, { kind: kindOf(crossfade), durationMs: 600 });
		let darker = 0;
		let frames = 0;
		while (handle.active) {
			frame(rig);
			frames++;
			const now = shot(rig);
			for (let i = 0; i < now.length; i++)
				if ((i & 3) !== 3 && now[i] < Math.min(ref.old[i], ref.new[i]) - 2) darker++;
		}
		claim(
			`no frame of a played crossfade is darker than both screens at any pixel (${frames} frames, ${darker} values darker)`,
			darker === 0 && frames >= 30,
		);
	}
	// Reverse reaches the graph.
	{
		const handle = await begin(rig, {
			kind: kindOf(reverse),
			reverse: true,
			pose: () => ({ progress: 0.5 }),
		});
		frame(rig);
		const c = compare(shot(rig), () => 255);
		claim(`Reverse: on, Screens → Reverse reads 1 (${said(c)})`, c.over === 0);
		handle.end();
		await handle.done;
	}
	dropRig(rig);
};

const exits = async (gl: number): Promise<void> => {
	const rig = await makeRig(gl);
	const ref = references(rig);
	const kinds = [...EXIT_KINDS, kindOf(exitPlain)];
	for (const kind of kinds) {
		let progress = 0.2;
		const posed = await begin(rig, { kind, pose: () => ({ progress }) });
		// Mid-play, read early and half way: a break's pieces may have mostly left by then.
		let midway = 0;
		for (const at of [0.2, 0.5]) {
			progress = at;
			frame(rig, 3);
			const now = shot(rig);
			midway = Math.max(midway, Math.min(compare(now, ref.old).over, compare(now, ref.new).over));
		}
		progress = 1;
		frame(rig, 3);
		const atEnd = compare(shot(rig), ref.new, 2);
		posed.end();
		await posed.done;
		const handle = await begin(rig, { kind, durationMs: 400 });
		const frames = await playOut(rig, handle);
		frame(rig);
		const after = compare(shot(rig), ref.new);
		claim(
			`Out route: ${kind} plays (${handle.route}, ${frames} frames; mid-play ${midway} values from either screen), posed at its end shows the new screen (${said(atEnd)}), and ends exactly on it (${said(after)})`,
			handle.route === 'out' && midway > 1000 && frames >= 20 && after.over === 0 && atRest(rig),
		);
		if (atEnd.over) notes.push(`${kind} posed at t = 1 leaves ${said(atEnd)} over the new screen`);
	}
	dropRig(rig);
};

const fallbacks = async (gl: number): Promise<void> => {
	const rig = await makeRig(gl);
	const ref = references(rig);
	const warn = console.warn;
	const warned: string[] = [];
	const report = console.error;
	const errors: string[] = [];
	console.warn = (...args: unknown[]) => {
		const line = args.map(String).join(' ');
		(line.startsWith('Screen transition:') ? warned : errors).push(line);
	};
	console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
	try {
		const cases: [string, string][] = [
			['a kind not registered', 'custom:gone'],
			['a built-in that is not an exit', 'pulse'],
			['a program that does not link', kindOf(broken)],
			['a body the screen shell refuses', kindOf(refused)],
		];
		const results: [string, boolean][] = [];
		for (const [label, kind] of cases) {
			const handle = await begin(rig, { kind, durationMs: 400, pose: () => ({ progress: 0.5 }) });
			frame(rig, 2);
			const a = 1 - easeInQuad(0.5);
			const mid = compare(shot(rig), (i) => ref.old[i] * a + ref.new[i] * (1 - a), 2);
			handle.end();
			await handle.done;
			const played = await begin(rig, { kind, durationMs: 400 });
			const frames = await playOut(rig, played);
			frame(rig);
			const after = compare(shot(rig), ref.new);
			results.push([
				`fallback: ${label} plays a fade out on the still (${handle.route}; half way ${said(mid)}; ${frames} frames, then the new screen: ${said(after)})`,
				handle.route === 'fallback' &&
					played.route === 'fallback' &&
					mid.over === 0 &&
					frames >= 20 &&
					after.over === 0 &&
					atRest(rig),
			]);
		}
		results.push([
			`fallback: each is said once (${warned.join(' | ')})`,
			warned.length === 4 && new Set(warned).size === 4,
		]);
		// A still that cannot be taken: a cut.
		const create = RenderTexture.create;
		RenderTexture.create = () => {
			throw new Error('no memory for the still');
		};
		try {
			show(rig, 'old');
			const handle = play(rig, { kind: kindOf(crossfade) });
			const before = await settled(handle.done);
			frame(rig);
			const cut = (await settled(handle.captured)) && (await settled(handle.done));
			show(rig, 'new');
			frame(rig);
			results.push([
				`a capture that fails is a cut: nothing settles before the frame, both settle on it, the new screen shows, nothing is left (${handle.route}; ${warned.at(-1)})`,
				!before &&
					cut &&
					handle.route === 'cut' &&
					!handle.active &&
					atRest(rig) &&
					same(shot(rig), ref.new),
			]);
		} finally {
			RenderTexture.create = create;
		}
		console.warn = warn;
		console.error = report;
		for (const [label, ok] of results) claim(label, ok);
	} finally {
		console.warn = warn;
		console.error = report;
	}
	// The driver's own lines for the program that does not compile are expected; nothing else.
	const other = errors.filter((e) => !/nope|shader|program/i.test(e));
	claim(
		`the only errors logged are the driver's, for the program that does not compile (${errors.length}; others: ${other.join(' | ').slice(0, 300)})`,
		other.length === 0,
	);
	dropRig(rig);
};

/** A frame that throws, or undefined. */
const frameThrows = (rig: Rig): string | undefined => {
	try {
		frame(rig);
		return undefined;
	} catch (error) {
		return (error as Error).message;
	}
};

/** Params whose every read throws: `playElementFx` then throws as it starts the Out route. */
const throwingParams = new Proxy(
	{},
	{
		get: () => {
			throw new Error('a param read throws');
		},
		ownKeys: () => {
			throw new Error('a param read throws');
		},
		has: () => {
			throw new Error('a param read throws');
		},
	},
);

/** What a throw while a transition starts, and a context lost while it plays, leave. */
const breakdowns = async (gl: number): Promise<void> => {
	const warn = console.warn;
	const warned: string[] = [];
	console.warn = (...args: unknown[]) => warned.push(args.map(String).join(' '));
	const results: [string, boolean][] = [];
	try {
		const rig = await makeRig(gl);
		const ref = references(rig);
		const listeners = rig.app.ticker.count;
		const programFrom = GlProgram.from;
		for (const [label, options, patch] of [
			[
				'the In route (building its program throws)',
				{ kind: kindOf(crossfade) },
				() => {
					GlProgram.from = () => {
						throw new Error('no program');
					};
				},
			],
			[
				'the Out route (playing the exit throws)',
				{ kind: 'burn', params: throwingParams },
				() => {},
			],
		] as const) {
			show(rig, 'old');
			const handle = play(rig, options);
			patch();
			const thrown = frameThrows(rig);
			GlProgram.from = programFrom;
			const settledBoth = (await settled(handle.captured)) && (await settled(handle.done));
			show(rig, 'new');
			const later = frameThrows(rig);
			results.push([
				`a throw as ${label} starts is a cut: the frame does not throw (${thrown ?? 'none'}), the next draws the new screen, both promises settle, no still, no child, no callback left (${handle.route}; ${warned.at(-1)})`,
				thrown === undefined &&
					later === undefined &&
					same(shot(rig), ref.new) &&
					settledBoth &&
					handle.route === 'cut' &&
					handle.still === undefined &&
					atRest(rig) &&
					rig.app.ticker.count === listeners,
			]);
		}
		// A context lost while it plays ends it: nothing held, both settled; restored, the new screen.
		const handle = await begin(rig, { kind: kindOf(crossfade), durationMs: 2000 });
		frame(rig, 5);
		const lose = (rig.app.renderer as WebGLRenderer).gl.getExtension('WEBGL_lose_context');
		lose?.loseContext();
		const lostThrown = frameThrows(rig);
		const ended =
			!handle.active &&
			(await settled(handle.done)) &&
			handle.still === undefined &&
			atRest(rig) &&
			rig.app.ticker.count === listeners;
		lose?.restoreContext();
		await new Promise((wake) => setTimeout(wake, 200));
		frame(rig, 3);
		const back = compare(shot(rig), ref.new);
		results.push([
			`a context lost mid-play ends the transition: no still, no filter or child, both settled, the frame does not throw (${lostThrown ?? 'none'}); restored, the new screen (${said(back)})`,
			!!lose && lostThrown === undefined && ended && back.over === 0,
		]);
		dropRig(rig);
	} finally {
		console.warn = warn;
	}
	for (const [label, ok] of results) claim(label, ok);
};

const lifecycle = async (gl: number): Promise<void> => {
	const rig = await makeRig(gl);
	const ref = references(rig);
	const listeners = rig.app.ticker.count;
	// One at a time.
	{
		const first = await begin(rig, { kind: kindOf(crossfade), durationMs: 2000 });
		frame(rig, 10);
		const firstOn = stageFilters(rig.app, 'transition').length === 1;
		const second = play(rig, { kind: 'dissolveOut', durationMs: 300 });
		const firstEnded =
			!first.active && (await settled(first.done)) && !rig.app.stage.filters?.length;
		let waited = false;
		void waitForScreenTransition(rig.app).then(() => (waited = true));
		frame(rig);
		await second.captured;
		const stillOld = compare(shot(rig), ref.new).over === 0;
		const frames = await playOut(rig, second);
		await Promise.resolve();
		claim(
			`one at a time: a second transition ends the first at its end state (filter off, done) before it freezes the screen; waiting holds until the second ends (${frames} frames)`,
			firstOn && firstEnded && stillOld && second.route === 'out' && waited && atRest(rig),
		);
		const none = await settled(waitForScreenTransition(rig.app));
		claim('waiting with none playing settles at once', none);
	}
	// A resize to the same size keeps it; a resize ends it.
	{
		const handle = await begin(rig, { kind: kindOf(crossfade), durationMs: 2000 });
		frame(rig, 5);
		rig.app.renderer.resize(rig.app.screen.width, rig.app.screen.height);
		frame(rig);
		claim('a resize to the same size keeps the transition playing', handle.active);
		rig.app.renderer.resize(rig.app.screen.width + 10, rig.app.screen.height);
		// Ended before the next frame is drawn (Pixi's resize plugin draws at once).
		frame(rig);
		const ended = !handle.active && (await settled(handle.done)) && atRest(rig);
		rig.app.renderer.resize(rig.app.screen.width - 10, rig.app.screen.height);
		frame(rig);
		claim('a resize ends the transition at its end state', ended && same(shot(rig), ref.new));
	}
	// Dispose ends it and leaves nothing: no child, filter, area or ticker callback.
	for (const kind of [kindOf(crossfade), 'shatter']) {
		const handle = await begin(rig, { kind, durationMs: 2000 });
		frame(rig, 20);
		disposeScreenTransitions(rig.app);
		claim(
			`dispose (${handle.route} route) ends it and leaves nothing: no child, filter, area or ticker callback`,
			!handle.active &&
				(await settled(handle.done)) &&
				atRest(rig) &&
				rig.app.ticker.count === listeners,
		);
	}
	{
		show(rig, 'old');
		const handle = play(rig, { kind: kindOf(crossfade) });
		disposeScreenTransitions(rig.app);
		claim(
			'dispose before the still is taken: a cut, both settled, no callback left',
			handle.route === 'cut' &&
				(await settled(handle.captured)) &&
				(await settled(handle.done)) &&
				rig.app.ticker.count === listeners,
		);
	}
	// The turbo clock and the clamp.
	{
		const lengths: number[] = [];
		for (const [durationMs, timeScale] of [
			[1000, 1],
			[1000, 2],
			[10, 1],
			[60_000, 1],
		]) {
			rig.timeScale = timeScale;
			const handle = await begin(rig, { kind: kindOf(crossfade), durationMs });
			lengths.push(await playOut(rig, handle, 1000));
		}
		rig.timeScale = 1;
		const [normal, turbo, short, long] = lengths;
		claim(
			`the clock: 1000 ms in ${normal} frames, at turbo 2 in ${turbo}; 10 ms clamped to 50 (${short} frames); 60 s clamped to 5 s (${long} frames)`,
			Math.abs(normal - 1000 / STEP_MS) <= 1 &&
				Math.abs(turbo - 500 / STEP_MS) <= 1 &&
				Math.abs(short - 50 / STEP_MS) <= 1 &&
				Math.abs(long - 5000 / STEP_MS) <= 1,
		);
	}
	// A Show made after the call but before the frame is in the still.
	{
		show(rig, 'new');
		const handle = play(rig, { kind: kindOf(from) });
		queueMicrotask(() => show(rig, 'old'));
		await Promise.resolve();
		frame(rig);
		await handle.captured;
		show(rig, 'new');
		frame(rig, 2);
		claim(
			'the still is taken on the next frame: a Show made after the call, before that frame, is in it',
			same(shot(rig), ref.old),
		);
		handle.end();
		await handle.done;
	}
	// The stage's own filters: kept in front, given back exactly; the slots in order.
	{
		const foreign = new AlphaFilter({ alpha: 1 });
		const foreignArea = rig.app.screen.clone();
		rig.app.stage.filters = [foreign];
		rig.app.stage.filterArea = foreignArea;
		const handle = await begin(rig, { kind: kindOf(crossfade), durationMs: 2000 });
		frame(rig);
		const shell = stageFilters(rig.app, 'transition')[0];
		void runCameraEffect(rig.app, { kind: 'chromaticWobble', durationMs: 200 });
		frame(rig);
		const list = rig.app.stage.filters ?? [];
		const ordered =
			list.length === 3 && list[0] === foreign && list[1] === shell && list[2] !== shell;
		frame(rig, 20);
		const afterWobble = rig.app.stage.filters ?? [];
		handle.end();
		await handle.done;
		const back = rig.app.stage.filters ?? [];
		claim(
			'the stage filter owner keeps a foreign filter in front, then the transition, then the camera; gives back the foreign list and area exactly',
			ordered &&
				afterWobble.length === 2 &&
				back.length === 1 &&
				back[0] === foreign &&
				rig.app.stage.filterArea === foreignArea,
		);
		rig.app.stage.filters = null;
		rig.app.stage.filterArea = undefined as unknown as typeof foreignArea;
		foreign.destroy();
	}
	// The still is taken with the stage's filters off: a post FX is not baked into it, so a From
	// transition under it draws the old screen through the post FX once.
	{
		const post = new AlphaFilter({ alpha: 0.5 });
		const slot = stagePostFxSlot(rig.app);
		slot([post]);
		show(rig, 'old');
		frame(rig);
		const graded = shot(rig);
		const handle = await begin(rig, { kind: kindOf(from), pose: () => ({ progress: 0.5 }) });
		frame(rig, 2);
		const c = compare(shot(rig), graded);
		handle.end();
		await handle.done;
		slot(null);
		post.destroy();
		frame(rig);
		claim(
			`the still is taken with the stage's filters off: under a post FX, Screens → From draws the old screen graded once (${said(c)})`,
			compare(graded, ref.old).over > 1000 && c.over === 0 && atRest(rig),
		);
	}
	// A filter someone else put on the stage stays, in front of the transition, so the still keeps
	// it: Screens → From draws what the canvas showed before, from the capture frame on.
	{
		const foreign = new AlphaFilter({ alpha: 0.5 });
		rig.app.stage.filters = [foreign];
		show(rig, 'old');
		frame(rig);
		const before = shot(rig);
		const handle = play(rig, { kind: kindOf(from), pose: () => ({ progress: 0.5 }) });
		frame(rig);
		const atCapture = compare(shot(rig), before);
		await handle.captured;
		show(rig, 'new');
		frame(rig, 2);
		const after = compare(shot(rig), before);
		handle.end();
		await handle.done;
		const kept = rig.app.stage.filters?.length === 1 && rig.app.stage.filters[0] === foreign;
		rig.app.stage.filters = null;
		foreign.destroy();
		frame(rig);
		claim(
			`a foreign stage filter is kept in the still: Screens → From draws what the canvas showed, from the capture frame on (${said(atCapture)}; after ${said(after)})`,
			compare(before, ref.old).over > 1000 && atCapture.over === 0 && after.over === 0 && kept,
		);
	}
	// A crossfade under a post FX: one frame bounds the list, the viewport, so the still is unsquashed;
	// a post FX that pads widens that frame all round, and the still is read inside it, unshifted.
	for (const padding of [0, 8]) {
		const post = new AlphaFilter({ alpha: 1 });
		post.padding = padding;
		const slot = stagePostFxSlot(rig.app);
		slot([post]);
		const handle = await begin(rig, { kind: kindOf(crossfade), pose: () => ({ progress: 0 }) });
		frame(rig, 2);
		const c = compare(shot(rig), ref.old);
		handle.end();
		await handle.done;
		slot(null);
		post.destroy();
		frame(rig);
		claim(
			`a crossfade at its start under a post FX padding ${padding} px draws the old screen unsquashed and unshifted, pixel for pixel (${said(c)})`,
			c.over === 0 && atRest(rig),
		);
	}
	// Under a camera zoom and shake: the In frame stays the viewport, the Out still stays on screen.
	for (const [label, kind, pose] of [
		['In route (Screens → From)', kindOf(from), 0.5],
		['Out route (at t = 0)', 'dissolveOut', 0],
	] as const) {
		void runCameraEffect(rig.app, { kind: 'zoomPunch', intensity: 3, durationMs: 1500 });
		void runCameraEffect(rig.app, { kind: 'shake', intensity: 2, durationMs: 1500 });
		frame(rig, 3);
		const handle = await begin(rig, { kind, pose: () => ({ progress: pose }) });
		let worst: Difference = { over: 0, max: 0 };
		let moved = 0;
		for (let i = 0; i < 12; i++) {
			frame(rig);
			const stage = rig.app.stage;
			if (stage.position.x !== 0 || stage.scale.x !== 1) moved++;
			const c = compare(shot(rig), ref.old, 2);
			if (c.over > worst.over) worst = c;
		}
		handle.end();
		await handle.done;
		frame(rig, 100);
		claim(
			`${label} under a camera zoom and shake draws the old screen where it is (${moved} of 12 frames moved; ${said(worst)} by more than 2)`,
			moved >= 10 && worst.over === 0 && atRest(rig),
		);
	}
	// The post FX slot in the shape the post FX fill it, and the project's anti-aliasing.
	{
		const handle = await begin(rig, { kind: kindOf(crossfade), durationMs: 2000 });
		frame(rig);
		const shell = stageFilters(rig.app, 'transition')[0];
		const post = new AlphaFilter({ alpha: 1 });
		const slot = stagePostFxSlot(rig.app);
		slot([post]);
		void runCameraEffect(rig.app, { kind: 'chromaticWobble', durationMs: 500 });
		frame(rig);
		const list = rig.app.stage.filters ?? [];
		const camera = list[2];
		const area = rig.app.stage.filterArea;
		const ordered = list.length === 3 && list[0] === shell && list[1] === post;
		const view = rig.app.screen;
		const bounded =
			!!area &&
			[area.x, area.y, area.width - view.width, area.height - view.height].every(
				(d) => Math.abs(d) < 0.01,
			);
		const off = list.every((f) => f.antialias === 'off');
		setStageFxAntialias(rig.app, true);
		const on = list.every((f) => f.antialias === 'inherit');
		setStageFxAntialias(rig.app, false);
		const unpadded = shell.padding === 0 && camera?.padding === 0;
		slot(null);
		const left = rig.app.stage.filters ?? [];
		handle.end();
		await handle.done;
		frame(rig, 40);
		claim(
			'the post FX slot: its filters after the transition and before the camera, the whole list bounded to the viewport; null takes them off; every stage filter draws without MSAA unless the project asks (then inherit); the transition and the camera pad nothing',
			ordered &&
				bounded &&
				off &&
				on &&
				unpadded &&
				left.length === 2 &&
				!left.includes(post) &&
				atRest(rig),
		);
		post.destroy();
	}
	{
		const handle = await begin(rig, { kind: kindOf(crossfade), durationMs: 200 });
		await playOut(rig, handle);
		claim(
			'with no foreign filter the stage is given back no list and no area',
			!rig.app.stage.filters?.length && rig.app.stage.filterArea === undefined,
		);
	}
	dropRig(rig);
};

const capped = async (gl: number): Promise<void> => {
	const rig = await makeRig(gl, { width: 2600, height: 300, resolution: 2 });
	const ref = references(rig);
	const handle = await begin(rig, { kind: kindOf(from), pose: () => ({ progress: 0.5 }) });
	frame(rig);
	const still = handle.still;
	const now = shot(rig);
	const w = shotWidth;
	const h = now.length / 4 / shotWidth;
	const spots = [
		[0.4, 0.2],
		[0.75, 0.42],
		[0.1, 0.98],
		[0.9, 0.85],
	].map(([u, v]) => (Math.floor(v * h) * w + Math.floor(u * w)) * 4);
	const off = spots.flatMap((i) => [0, 1, 2].map((k) => Math.abs(now[i + k] - ref.old[i + k])));
	claim(
		`the still is capped at ${SCREEN_STILL_MAX_PX} px a side (2600 × 300 at 2: ${still?.width} × ${still?.height}), and still maps the old screen (largest step off ${Math.max(...off)})`,
		still?.width === SCREEN_STILL_MAX_PX &&
			still.height === Math.round((300 * SCREEN_STILL_MAX_PX) / 2600) &&
			Math.max(...off) <= 2,
	);
	handle.end();
	await handle.done;
	dropRig(rig);
};

/** The GL objects alive, by kind (Pixi may delete one twice), and how many each kind made. */
const glLedger = (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
	const live: Record<string, Set<unknown>> = {};
	const made: Record<string, number> = {};
	for (const name of ['Texture', 'Framebuffer', 'Renderbuffer', 'Buffer', 'Program', 'Shader']) {
		const target = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
		const create = target[`create${name}`].bind(gl);
		const remove = target[`delete${name}`].bind(gl);
		live[name] = new Set();
		made[name] = 0;
		target[`create${name}`] = (...args) => {
			const object = create(...args);
			live[name].add(object);
			made[name]++;
			return object;
		};
		target[`delete${name}`] = (...args) => {
			live[name].delete(args[0]);
			return remove(...args);
		};
	}
	return {
		live: () => Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.size])),
		made,
	};
};

const steady = async (gl: number, count: number): Promise<void> => {
	const rig = await makeRig(gl, { width: 160, height: 100 });
	const ledger = glLedger((rig.app.renderer as WebGLRenderer).gl);
	const kinds = [
		kindOf(crossfade),
		'dissolveOut',
		'fadeOut',
		'custom:gone',
		kindOf(exitPlain),
		'shatter',
	];
	const warn = console.warn;
	console.warn = () => {};
	const run = async (n: number): Promise<void> => {
		for (let i = 0; i < n; i++) {
			// A game's loop yields every frame; Pixi's resource collection runs on the system ticker then.
			if (i % 50 === 49) await new Promise((wake) => requestAnimationFrame(wake));
			const handle = await begin(rig, { kind: kinds[i % kinds.length], durationMs: 50 });
			await playOut(rig, handle);
		}
	};
	const began = performance.now();
	try {
		await run(kinds.length * 4);
		const live = ledger.live();
		const made = { ...ledger.made };
		await run(count);
		const now = ledger.live();
		const grew = Object.keys(live).filter((k) => now[k] !== live[k]);
		const programs = ledger.made.Program - made.Program;
		const stills = ledger.made.Texture - made.Texture;
		notes.push(
			`${count} transitions after the warm-up: made ${JSON.stringify(Object.fromEntries(Object.keys(made).map((k) => [k, ledger.made[k] - made[k]])))}, alive before ${JSON.stringify(live)} and after ${JSON.stringify(now)}, ${((performance.now() - began) / 1000).toFixed(1)} s`,
		);
		claim(
			`${count} transitions after a warm-up (shatter among them) leave nothing allocated: live GL objects unchanged (${grew.join(', ') || 'none grew'}), no program made, every still made freed`,
			grew.length === 0 && programs === 0 && stills >= count && atRest(rig),
		);
		// A shatter disposed mid-play, its pieces cut: its stills go with it.
		const beforeDispose = ledger.live();
		for (let i = 0; i < 5; i++) {
			const handle = await begin(rig, { kind: 'shatter', durationMs: 1000 });
			frame(rig, 10 + i);
			disposeScreenTransitions(rig.app);
			await handle.done;
		}
		frame(rig);
		const afterDispose = ledger.live();
		const kept = Object.keys(beforeDispose).filter((k) => afterDispose[k] !== beforeDispose[k]);
		claim(
			`a shatter disposed mid-play, five times, leaves no GL object behind (${kept.join(', ') || 'none grew'})`,
			kept.length === 0 && atRest(rig),
		);
	} finally {
		console.warn = warn;
	}
	dropRig(rig);
};

(async () => {
	const query = new URLSearchParams(location.search);
	const gl = Number(query.get('gl') ?? 2);
	const count = Number(query.get('transitions') ?? 2000);
	try {
		routes();
		for (const resolution of [1, 1.5, 2]) await identities(gl, resolution, false);
		await identities(gl, 2, true);
		await crossfades(gl);
		await exits(gl);
		await fallbacks(gl);
		await lifecycle(gl);
		await capped(gl);
		await steady(gl, count);
		await breakdowns(gl);
		const version = (await makeRig(gl)).app.renderer as WebGLRenderer;
		claim(`the page runs on WebGL${gl}`, version.context.webGLVersion === gl);
	} catch (error) {
		console.error(`screen-fx: threw ${(error as Error).stack ?? error}`);
	}
	page.result = { claims, notes };
	page.ready = true;
})();
