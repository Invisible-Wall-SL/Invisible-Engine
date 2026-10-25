/**
 * The page `shaderTwins.mjs` drives: every graph twin of a built-in (`BUILTIN_TWINS`) played beside
 * its built-in through the real Element FX runtime, on WebGL1 or WebGL2 (`?gl=`), and compared.
 *
 * Each CASE (the defaults, on a portrait card and a landscape one; each number param at its min and
 * its max; each other choice option, each switch flipped, another colour, strength 0.3 and 2, and
 * playing in a loop) is posed or played to the same moments on both: the same card, the same frame,
 * the same seed drawn for the element (the page seeds `Math.random` before each play), the same
 * params. A case's built-in plays and twin plays are drawn as one texture, a row each and a cell per
 * moment, and read back; the page reports, per cell, how many drawn pixels differ by more than each
 * of a few channel steps, and how many the built-in draws past the twin's room, and leaves the
 * verdict to the script.
 *
 * Pixels are compared with both motions held at rest (a twin keeps the room its motion graph grows),
 * so a shader is judged by what it draws; the motions are compared as numbers (where the corners of
 * the element's box land, its alpha), the built-in's sampler against the twin's curves and motion
 * graph, in every case, and so is the room each asks its passes for.
 *
 * A BREAK's twin (step 8b: the element as it is, and a Break Output) plays with its motion as
 * compiled, the fade it carries for older runtimes included. Its pieces fly past any room and into
 * any neighbour, so each play is drawn alone, the element in the middle of three times its box, and
 * the built-in's drawing is compared with the twin's as a cell is.
 */
import {
	Application,
	Container,
	FillGradient,
	Graphics,
	Matrix,
	RenderTexture,
	type Renderer,
	type Ticker,
} from 'pixi.js';
import {
	elementFxSpec,
	resolveElementFxParams,
	setCustomElementFx,
	type ElementFxKind,
	type ElementFxKindId,
	type ElementFxParamValue,
} from '@fxroot/packages/constants-shared/elementFx';
import {
	BUILTIN_TWINS,
	compileShaderEffect,
	isBreakTwin,
	type BuiltinTwin,
} from '@fxroot/packages/engine-shadergraph/index';
import { customKindImpl } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/custom';
import {
	REST,
	type FxFrame,
	type Motion,
} from '@fxroot/packages/pixi-svelte/src/lib/elementFx/frame';
import { KINDS, type KindImpl } from '@fxroot/packages/pixi-svelte/src/lib/elementFx/kinds';
import {
	playElementFx,
	stopElementFx,
} from '@fxroot/packages/pixi-svelte/src/lib/elementFx/runtime';

const MOMENTS = [0.06, 0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.96];
/** Where a param that only has to be shown wired is checked: while it sets in, and later on. */
const SOME = [0.18, 0.7];
/** A colour no kind defaults to. */
const OTHER_COLOR = '#e0457b';
/** Channel steps (of 255) the page counts differing pixels past. */
const STEPS = [1, 2, 4, 8, 16, 32, 64, 128];
/**
 * The cards' boxes in their own space: the parity harness's portrait card, and a landscape one
 * twice as wide as tall, so a size read off the width, the height or the shorter side shows which.
 */
const BOXES = {
	portrait: { width: 124, height: 144 },
	landscape: { width: 240, height: 120 },
} as const;
type Shape = keyof typeof BOXES;

/** The room the runtime's filter area gives a box on every side (`areaFor`). */
const marginOf = (shape: Shape): number =>
	Math.min(256, Math.max(8, 0.25 * Math.max(BOXES[shape].width, BOXES[shape].height)));

interface Case {
	label: string;
	params: Record<string, ElementFxParamValue>;
	moments: readonly number[];
	intensity?: number;
	looping?: boolean;
	/** Unset: portrait. */
	shape?: Shape;
}

/**
 * What a twin is played with: the defaults, and every param moved. A pass twin (the Output alone,
 * then the built-in's own pass, its params tied by id) draws the element as it is before that pass,
 * which the fixture proves exactly; its number params only have to be shown to reach the pass, so
 * they are checked at fewer moments (glow's widest reach costs seconds a cell in a software GPU).
 */
const casesFor = (kind: ElementFxKind, passOnly: boolean): Case[] => {
	const cases: Case[] = [
		{ label: 'defaults', params: {}, moments: MOMENTS },
		{ label: 'landscape', params: {}, moments: MOMENTS, shape: 'landscape' },
	];
	for (const p of elementFxSpec(kind).params) {
		if (p.kind === 'number') {
			for (const value of [p.min, p.max])
				if (value !== p.default)
					cases.push({
						label: `${p.id}=${value}`,
						params: { [p.id]: value },
						moments: passOnly ? SOME : MOMENTS,
					});
		} else if (p.kind === 'choice') {
			for (const option of p.options.filter((o) => o !== p.default))
				cases.push({ label: `${p.id}=${option}`, params: { [p.id]: option }, moments: SOME });
		} else if (p.kind === 'bool') {
			cases.push({ label: `${p.id}=${!p.default}`, params: { [p.id]: !p.default }, moments: SOME });
		} else {
			cases.push({
				label: `${p.id}=${OTHER_COLOR}`,
				params: { [p.id]: OTHER_COLOR },
				moments: SOME,
			});
		}
	}
	cases.push({ label: 'intensity=0.3', params: {}, intensity: 0.3, moments: SOME });
	cases.push({ label: 'intensity=2', params: {}, intensity: 2, moments: SOME });
	cases.push({ label: 'looping', params: {}, looping: true, moments: SOME });
	return cases;
};

/** The frame the runtime gives a play of `c` at `moment` (a loop's on its second time round). */
const frameOf = (kind: ElementFxKind, c: Case, moment: number): FxFrame => {
	const durationMs = elementFxSpec(kind).durationMs;
	return {
		t: moment,
		seconds: ((c.looping ? 1 + moment : moment) * durationMs) / 1000,
		playSeconds: durationMs / 1000,
		intensity: c.intensity ?? 1,
		params: resolveElementFxParams(kind, c.params),
		looping: !!c.looping,
		width: BOXES[c.shape ?? 'portrait'].width,
		height: BOXES[c.shape ?? 'portrait'].height,
	};
};

/**
 * The test card: the parity harness's (a rounded card, a star, a bar), its gradient running across
 * it and a translucent disc on it, so the brightness, the relief and the premultiplied edges vary.
 */
const makeCard = (fill: FillGradient, shape: Shape): Container => {
	const card = new Container();
	const { width, height } = BOXES[shape];
	const [w, h] = [width - 4, height - 4];
	card.addChild(
		new Graphics()
			.roundRect(-w / 2, -h / 2, w, h, 18)
			.fill(fill)
			.stroke({ width: 4, color: 0xffffff }),
		...(shape === 'portrait'
			? [
					new Graphics().star(0, -10, 5, 34, 16).fill(0xffffff),
					new Graphics().rect(-40, 30, 80, 16).fill(0x111111),
					new Graphics().circle(32, 42, 16).fill({ color: 0x22ff88, alpha: 0.5 }),
				]
			: [
					new Graphics().star(-50, -4, 5, 34, 16).fill(0xffffff),
					new Graphics().rect(10, 18, 80, 16).fill(0x111111),
					new Graphics().circle(70, -20, 16).fill({ color: 0x22ff88, alpha: 0.5 }),
				]),
	);
	return card;
};

/** `Math.random`, seeded: the same seed draws the same numbers on both sides of a pair. */
const seedRandom = (seed: number): void => {
	let s = seed;
	Math.random = () => {
		s = (s * 16807) % 2147483647;
		return (s - 1) / 2147483646;
	};
};

/** A ticker the page steps by hand, by exactly the time it is told. */
const handTicker = () => {
	const ticks: ((t: { deltaMS: number }) => void)[] = [];
	const ticker = {
		add: (fn: (t: { deltaMS: number }) => void) => ticks.push(fn),
		remove: (fn: (t: { deltaMS: number }) => void) => {
			const at = ticks.indexOf(fn);
			if (at >= 0) ticks.splice(at, 1);
		},
	} as unknown as Ticker;
	return { ticker, advance: (ms: number) => [...ticks].forEach((fn) => fn({ deltaMS: ms })) };
};

/** `kind` played on `card`, posed (or looped round) to `moment`. */
const play = (
	renderer: Renderer,
	card: Container,
	kind: ElementFxKindId,
	c: Case,
	moment: number,
	durationMs: number,
	seed: number,
): void => {
	const { ticker, advance } = handTicker();
	seedRandom(seed);
	const handle = playElementFx(
		card,
		{
			kind,
			params: c.params,
			durationMs,
			intensity: c.intensity ?? 1,
			...(c.looping ? { repeat: 0 } : { pose: () => ({ progress: moment }) }),
		},
		{ ticker, renderer },
	);
	if (!handle.active) console.error(`${kind}: did not play`);
	if (c.looping) advance((1 + moment) * durationMs);
};

/**
 * A break's cases: the defaults on both cards at every moment; each param moved, both strengths and
 * a loop while it cracks or sets in and later on.
 */
const breakCasesFor = (kind: ElementFxKind): Case[] =>
	casesFor(kind, false).map((c) =>
		c.label === 'defaults' || c.label === 'landscape' ? c : { ...c, moments: SOME },
	);

/** A rectangle of a cell, in its pixels. */
interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The cell at `x0` in the top row (the built-in) against the one below it (the twin), `height`
 * rows down. Per step: its drawn pixels whose largest channel difference is past it (`over`), and
 * those of them whose four neighbours are past it too (`solid`: inside a patch that differs, not a
 * pixel or a line on the edge of a threshold); and the largest difference. `beyond` counts the
 * built-in's drawn pixels outside the twin's `room`.
 */
const compare = (
	pixels: Uint8ClampedArray,
	stride: number,
	x0: number,
	width: number,
	height: number,
	room: Region,
) => {
	const over = STEPS.map(() => 0);
	const solid = STEPS.map(() => 0);
	const diff = new Uint8Array(width * height);
	const inside = (r: Region, x: number, y: number): boolean =>
		x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
	let drawn = 0;
	let max = 0;
	let beyond = 0;
	for (let y = 0; y < height; y++) {
		let a = (y * stride + x0) * 4;
		let b = ((y + height) * stride + x0) * 4;
		for (let x = 0; x < width; x++, a += 4, b += 4) {
			if (pixels[a + 3] && !inside(room, x, y)) beyond++;
			if (!pixels[a + 3] && !pixels[b + 3]) continue;
			drawn++;
			const d = Math.max(
				Math.abs(pixels[a] - pixels[b]),
				Math.abs(pixels[a + 1] - pixels[b + 1]),
				Math.abs(pixels[a + 2] - pixels[b + 2]),
				Math.abs(pixels[a + 3] - pixels[b + 3]),
			);
			diff[y * width + x] = d;
			if (d > max) max = d;
			for (let s = 0; s < STEPS.length && d > STEPS[s]; s++) over[s]++;
		}
	}
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const i = y * width + x;
			const d = Math.min(diff[i], diff[i - 1], diff[i + 1], diff[i - width], diff[i + width]);
			for (let s = 0; s < STEPS.length && d > STEPS[s]; s++) solid[s]++;
		}
	}
	return { drawn, max, over, solid, beyond };
};

/** One cell of the texture as a PNG, for `--dump`. */
const cellPng = (
	pixels: Uint8ClampedArray,
	stride: number,
	x0: number,
	y0: number,
	width: number,
	height: number,
): string => {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
	const image = ctx.createImageData(width, height);
	for (let y = 0; y < height; y++)
		image.data.set(
			pixels.subarray(((y0 + y) * stride + x0) * 4, ((y0 + y) * stride + x0 + width) * 4),
			y * width * 4,
		);
	ctx.putImageData(image, 0, 0);
	return canvas.toDataURL('image/png');
};

/** Where the corners of the element's box land under `m`, as the runtime places them. */
const corners = (m: Motion, width: number, height: number): number[] => {
	const x0 = -width / 2;
	const y0 = -height / 2;
	const px = x0 + m.pivotX * width;
	const py = y0 + m.pivotY * height;
	const matrix = new Matrix().setTransform(
		px + m.x,
		py + m.y,
		px,
		py,
		m.scaleX,
		m.scaleY,
		m.rotation,
		m.skewX,
		m.skewY,
	);
	return [
		[x0, y0],
		[x0 + width, y0],
		[x0, y0 + height],
		[x0 + width, y0 + height],
	].flatMap(([x, y]) => {
		const p = matrix.apply({ x, y });
		return [p.x, p.y];
	});
};

/** How far apart the two motions put the box's corners (px) and its alpha, at `frame`. */
const motionApart = (builtIn: KindImpl, twin: KindImpl, frame: FxFrame) => {
	const a: Motion = { ...REST, ...(builtIn.motion?.(frame) ?? {}) };
	const b: Motion = { ...REST, ...(twin.motion?.(frame) ?? {}) };
	const ca = corners(a, frame.width, frame.height);
	const cb = corners(b, frame.width, frame.height);
	let px = 0;
	for (let i = 0; i < ca.length; i += 2)
		px = Math.max(px, Math.hypot(ca[i] - cb[i], ca[i + 1] - cb[i + 1]));
	return { px, alpha: Math.abs(a.alpha - b.alpha) };
};

/**
 * A break's twin against its built-in: each play drawn alone (the element in the middle of three
 * times its box, the pieces about it), the two drawings compared as a cell.
 */
const compareBreak = (
	renderer: Renderer,
	fill: FillGradient,
	twin: BuiltinTwin,
	twinImpl: KindImpl,
	step: number,
	dumpPast: number,
	dumps: { label: string; builtIn: string; twin: string }[],
) => {
	const kind = twin.kind;
	const durationMs = elementFxSpec(kind).durationMs;
	const cells = [];
	const motions = [];
	let seed = 1;
	for (const c of breakCasesFor(kind)) {
		const shape = c.shape ?? 'portrait';
		const box = BOXES[shape];
		const [w, h] = [3 * box.width, 3 * box.height];
		const target = RenderTexture.create({ width: w, height: 2 * h });
		for (const moment of c.moments) {
			const at = (seed += 7919);
			const drawn = new Uint8ClampedArray(w * 2 * h * 4);
			for (const side of [0, 1]) {
				const parent = new Container();
				const card = parent.addChild(makeCard(fill, shape));
				card.position.set(w / 2, h / 2);
				const played: ElementFxKindId = side ? `custom:${kind}` : kind;
				play(renderer, card, played, c, moment, durationMs, at);
				renderer.render({ container: parent, target, clear: true });
				const { pixels } = (
					renderer as unknown as {
						texture: { getPixels(t: RenderTexture): { pixels: Uint8ClampedArray } };
					}
				).texture.getPixels(target);
				drawn.set(pixels.subarray(0, w * h * 4), side * w * h * 4);
				stopElementFx(card);
				parent.destroy({ children: true });
			}
			const diff = compare(drawn, w, 0, w, h, { x: 0, y: 0, width: w, height: h });
			cells.push({ label: c.label, moment, area: box.width * box.height, ...diff });
			const off = diff.over[step] / Math.max(1, diff.drawn) > dumpPast || diff.solid[step] > 0;
			if (Number.isFinite(dumpPast) && off)
				dumps.push({
					label: `${kind}-${c.label}-${moment}`,
					builtIn: cellPng(drawn, w, 0, 0, w, h),
					twin: cellPng(drawn, w, 0, h, w, h),
				});
			motions.push({
				label: c.label,
				moment,
				...motionApart(KINDS[kind], twinImpl, frameOf(kind, c, moment)),
				room: 0,
			});
		}
		target.destroy(true);
	}
	return { cells, motions };
};

(async () => {
	const query = new URLSearchParams(location.search);
	const only = (query.get('twins') ?? '').split(',').filter(Boolean);
	const dumpPast = Number(query.get('dump') ?? 'NaN');
	const step = Math.max(0, STEPS.indexOf(Number(query.get('threshold') ?? '2')));
	const twins = BUILTIN_TWINS.filter((t) => !only.length || only.includes(t.kind));
	const app = new Application();
	await app.init({
		width: 16,
		height: 16,
		preference: 'webgl',
		preferWebGLVersion: query.get('gl') === '1' ? 1 : 2,
		antialias: false,
		autoStart: false,
		sharedTicker: false,
		resolution: 1,
	});
	const renderer = app.renderer;
	const effects = twins.map((t) => {
		const r = compileShaderEffect(t.doc);
		if (!r.ok) throw new Error(`${t.kind}: ${r.issues.map((i) => i.message).join('; ')}`);
		return r.effect;
	});
	// The twins play with their motion at rest (compared as numbers below), as the built-ins do; the
	// room a motion graph grows stays. A break's plays as compiled.
	setCustomElementFx(
		effects.map((e) => {
			if (e.break) return e;
			const program = e.motion?.program;
			const padding = program?.outputs.padding;
			return {
				...e,
				motion:
					program && padding !== undefined
						? { channels: {}, program: { ops: program.ops, outputs: { padding } } }
						: undefined,
			};
		}),
	);
	const fill = new FillGradient({
		type: 'linear',
		start: { x: 0, y: 0 },
		end: { x: 1, y: 1 },
		textureSpace: 'local',
		colorStops: [
			{ offset: 0, color: 0xff4d6d },
			{ offset: 0.5, color: 0xffb703 },
			{ offset: 1, color: 0x3a86ff },
		],
	});
	// A row of built-in plays over a row of twin plays, a card per cell: the runtime puts each back
	// at rest after its play, so the cards serve every case.
	const holders = Object.fromEntries(
		(Object.keys(BOXES) as Shape[]).map((shape) => {
			const holder = new Container();
			for (let k = 0; k < 2 * MOMENTS.length; k++) holder.addChild(makeCard(fill, shape));
			return [shape, holder];
		}),
	) as Record<Shape, Container>;
	const report = console.error.bind(console);
	const results = [];
	const dumps: { label: string; builtIn: string; twin: string }[] = [];
	const began = performance.now();
	for (const [i, twin] of twins.entries()) {
		const twinBegan = performance.now();
		const kind = twin.kind;
		const durationMs = elementFxSpec(kind).durationMs;
		const builtIn = KINDS[kind];
		const twinImpl = customKindImpl(effects[i]);
		if (isBreakTwin(twin)) {
			console.error = (...args: unknown[]) => report(`${kind}:`, ...args);
			results.push({
				kind,
				...compareBreak(renderer, fill, twin, twinImpl, step, dumpPast, dumps),
				ms: Math.round(performance.now() - twinBegan),
			});
			console.error = report;
			continue;
		}
		const cells = [];
		const motions = [];
		let seed = 1;
		const passOnly = twin.doc.nodes.length === 1 && !!twin.doc.passes?.length;
		for (const c of casesFor(kind, passOnly)) {
			console.error = (...args: unknown[]) => report(`${kind} ${c.label}:`, ...args);
			const seeds = c.moments.map(() => (seed += 7919));
			const shape = c.shape ?? 'portrait';
			const holder = holders[shape];
			const cards = holder.children;
			cards.forEach((card, k) => {
				const at = k % MOMENTS.length;
				const side = Math.floor(k / MOMENTS.length);
				card.visible = at < c.moments.length;
				if (!card.visible) return;
				// The built-in plays with its motion at rest too.
				KINDS[kind] = side ? builtIn : { ...builtIn, motion: undefined };
				const played: ElementFxKindId = side ? `custom:${kind}` : kind;
				play(renderer, card, played, c, c.moments[at], durationMs, seeds[at]);
			});
			KINDS[kind] = builtIn;
			// Each cell reaches as far past the filter area as the most room any card's passes take.
			const padding = (card: Container): number =>
				(card.filters ?? []).reduce((sum, f) => sum + f.padding, 0);
			const pads = cards.map(padding);
			const reach = Math.ceil(marginOf(shape) + Math.max(...pads)) + 2;
			const box = BOXES[shape];
			const [w, h] = [box.width + 2 * reach, box.height + 2 * reach];
			// Where each twin play may draw: its filter area and its passes' padding, in its cell.
			const rooms = c.moments.map((_, k): Region => {
				const card = cards[MOMENTS.length + k];
				const area = card.filterArea ?? { x: 0, y: 0, width: 0, height: 0 };
				const pad = padding(card);
				return {
					x: Math.ceil(w / 2 + area.x - pad),
					y: Math.ceil(h / 2 + area.y - pad),
					width: Math.floor(area.width + 2 * pad),
					height: Math.floor(area.height + 2 * pad),
				};
			});
			cards.forEach((card, k) =>
				card.position.set(
					(k % MOMENTS.length) * w + w / 2,
					Math.floor(k / MOMENTS.length) * h + h / 2,
				),
			);
			const target = RenderTexture.create({ width: c.moments.length * w, height: 2 * h });
			renderer.render({ container: holder, target, clear: true });
			const { pixels } = (
				renderer as unknown as {
					texture: { getPixels(t: RenderTexture): { pixels: Uint8ClampedArray } };
				}
			).texture.getPixels(target);
			for (const card of cards) stopElementFx(card);
			console.error = report;
			const stride = target.width;
			c.moments.forEach((moment, k) => {
				const diff = compare(pixels, stride, k * w, w, h, rooms[k]);
				cells.push({ label: c.label, moment, area: box.width * box.height, ...diff });
				const off = diff.over[step] / Math.max(1, diff.drawn) > dumpPast || diff.solid[step] > 0;
				if (Number.isFinite(dumpPast) && off)
					dumps.push({
						label: `${kind}-${c.label}-${moment}`,
						builtIn: cellPng(pixels, stride, k * w, 0, w, h),
						twin: cellPng(pixels, stride, k * w, h, w, h),
					});
				// The room each asks for, as numbers: a room of nothing is 0, where a built-in still adds
				// its 2 px margin.
				const [asked, given] = [pads[k], pads[MOMENTS.length + k]].map((pad) =>
					Math.max(0, pad - 2),
				);
				motions.push({
					label: c.label,
					moment,
					...motionApart(builtIn, twinImpl, frameOf(kind, c, moment)),
					room: Math.abs(asked - given),
				});
			});
			target.destroy(true);
		}
		results.push({
			kind,
			ms: Math.round(performance.now() - twinBegan),
			cells,
			motions,
		});
	}
	const page = window as unknown as { result: unknown; dumps: unknown; ready: boolean };
	page.result = { steps: STEPS, ms: Math.round(performance.now() - began), twins: results };
	page.dumps = dumps;
	page.ready = true;
})().catch((error: unknown) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
