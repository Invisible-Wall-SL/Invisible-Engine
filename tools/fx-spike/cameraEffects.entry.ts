/**
 * The `camera-effects` gate's page (`cameraEffects.mjs`) on WebGL1 or WebGL2: every camera kind, and
 * the kinds together, played on two apps built alike in lockstep, one through the live module
 * (`pixi-svelte` `cameraEffects.ts`) and one through the module as it drew before step 8e.2
 * (`cameraEffects.reference.ts`), at resolution 1 and 2. At fixed frames each canvas is read back
 * and hashed: the two must be the same pixels, and the hashes are what `--shoot` writes and
 * `--expect` compares. After each case both stages must be at rest: no filter, no filter area. Only
 * the frames read are drawn: the effects tick every frame, but drawing the rest only costs time.
 */
import {
	Application,
	Container,
	Graphics,
	RenderTexture,
	Sprite,
	type WebGLRenderer,
} from 'pixi.js';
import * as live from '@fxroot/packages/pixi-svelte/src/lib/cameraEffects';
import * as reference from './cameraEffects.reference';

type Run = (app: Application, options: live.CameraEffectOptions) => Promise<void>;

const W = 360;
const H = 240;
const STEP_MS = 32;
/** The frames each case is read at, counted from its first effect. */
const MOMENTS = [1, 2, 3, 4, 6, 9, 13, 17, 23];

/** Each case: what starts at which frame. */
const CASES: { name: string; plays: [number, live.CameraEffectOptions][] }[] = [
	{ name: 'shake', plays: [[0, { kind: 'shake' }]] },
	{ name: 'zoomPunch', plays: [[0, { kind: 'zoomPunch' }]] },
	{ name: 'flash', plays: [[0, { kind: 'flash' }]] },
	{ name: 'chromaticWobble', plays: [[0, { kind: 'chromaticWobble' }]] },
	{ name: 'chromaticWobble x4', plays: [[0, { kind: 'chromaticWobble', intensity: 4 }]] },
	{
		name: 'wobble under a shake',
		plays: [
			[0, { kind: 'chromaticWobble', durationMs: 600 }],
			[0, { kind: 'shake', intensity: 2, durationMs: 600 }],
		],
	},
	{
		name: 'wobble under a zoom punch',
		plays: [
			[0, { kind: 'chromaticWobble' }],
			[2, { kind: 'zoomPunch', intensity: 3 }],
		],
	},
	{
		name: 'wobble ends, the shake goes on',
		plays: [
			[0, { kind: 'chromaticWobble', durationMs: 200 }],
			[2, { kind: 'shake', durationMs: 600 }],
		],
	},
	{
		name: 'two wobbles',
		plays: [
			[0, { kind: 'chromaticWobble', durationMs: 300 }],
			[4, { kind: 'chromaticWobble', intensity: 2, durationMs: 400 }],
		],
	},
	{
		name: 'all four',
		plays: [
			[0, { kind: 'flash' }],
			[0, { kind: 'chromaticWobble' }],
			[1, { kind: 'shake' }],
			[3, { kind: 'zoomPunch' }],
		],
	},
];

const page = window as unknown as {
	ready: boolean;
	result?: { shots: Record<string, string>; differ: string[]; unrested: string[] };
};

/** A game-like stage: a backdrop, art past every edge of the viewport, a sprite with soft edges. */
const scene = (app: Application): void => {
	const art = new Graphics()
		.rect(-80, -80, W + 160, H + 160)
		.fill(0x7a2e8c)
		.rect(0, 0, W, H)
		.fill(0x1d3557);
	for (let i = 0; i < 12; i++)
		art
			.circle(30 + ((i * 53) % W), 20 + ((i * 37) % H), 12 + (i % 5) * 6)
			.fill(((i * 0x3f61a7) & 0xffffff) | 0x404040);
	art.rect(W / 2 - 4, -60, 8, H + 120).fill(0xffd166);
	const card = new Graphics().roundRect(0, 0, 90, 120, 18).fill({ color: 0xffffff, alpha: 0.85 });
	card.circle(45, 60, 28).fill(0xe63946);
	const texture = RenderTexture.create({ width: 90, height: 120 });
	app.renderer.render({ container: card, target: texture });
	const sprite = new Sprite(texture);
	sprite.position.set(W - 130, 50);
	sprite.rotation = 0.2;
	const holder = new Container();
	holder.addChild(art, sprite);
	app.stage.addChild(holder);
};

const makeApp = async (gl: number, resolution: number): Promise<Application> => {
	const app = new Application();
	await app.init({
		width: W,
		height: H,
		background: 0x000000,
		preference: 'webgl',
		preferWebGLVersion: gl === 1 ? 1 : 2,
		antialias: true,
		useBackBuffer: true,
		autoStart: false,
		sharedTicker: false,
		resolution,
		autoDensity: true,
		preserveDrawingBuffer: true,
	});
	document.body.appendChild(app.canvas);
	scene(app);
	return app;
};

/** The canvas as drawn, read off the default framebuffer (bound after the app's render). */
const hashOf = (app: Application): { hash: string; pixels: Uint8Array } => {
	const renderer = app.renderer as WebGLRenderer;
	const { gl } = renderer;
	const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
	gl.readPixels(
		0,
		0,
		gl.drawingBufferWidth,
		gl.drawingBufferHeight,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels,
	);
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < pixels.length; i++) {
		h1 = Math.imul(h1 ^ pixels[i], 0x01000193);
		h2 = Math.imul(h2 + pixels[i], 0x5bd1e995) ^ (h2 >>> 13);
	}
	return {
		hash: `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`,
		pixels,
	};
};

const atRest = (app: Application): boolean =>
	!app.stage.filters?.length &&
	!app.stage.filterArea &&
	app.stage.position.x === 0 &&
	app.stage.position.y === 0 &&
	app.stage.scale.x === 1 &&
	app.stage.scale.y === 1;

(async () => {
	const query = new URLSearchParams(location.search);
	const gl = Number(query.get('gl') ?? 2);
	const shots: Record<string, string> = {};
	const differ: string[] = [];
	const unrested: string[] = [];
	for (const resolution of [1, 2]) {
		const apps = [await makeApp(gl, resolution), await makeApp(gl, resolution)];
		const runs: Run[] = [live.runCameraEffect, reference.runCameraEffect];
		let clock = 1000;
		for (const app of apps) app.ticker.lastTime = clock;
		/** One tick of every effect; drawn only when it is read (an invisible stage draws nothing). */
		const frame = (drawn: boolean): void => {
			clock += STEP_MS;
			for (const app of apps) {
				app.stage.visible = drawn;
				app.ticker.update(clock);
				app.stage.visible = true;
			}
		};
		for (const { name, plays } of CASES) {
			const last = MOMENTS[MOMENTS.length - 1];
			for (let f = 0; f <= last; f++) {
				for (const [at, options] of plays)
					if (at === f) apps.forEach((app, i) => void runs[i](app, options));
				const read = MOMENTS.includes(f + 1);
				frame(read);
				if (!read) continue;
				const label = `res ${resolution} / ${name} @${f + 1}`;
				const [a, b] = apps.map(hashOf);
				shots[label] = a.hash;
				if (a.hash !== b.hash) {
					let count = 0;
					for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) count++;
					differ.push(`${label}: ${count} channel values differ from the reference`);
				}
			}
			live.disposeCameraEffects(apps[0]);
			reference.disposeCameraEffects(apps[1]);
			if (!atRest(apps[0])) unrested.push(`res ${resolution} / ${name}`);
		}
		for (const app of apps) {
			app.canvas.remove();
			app.destroy(true, { children: true, texture: true });
		}
	}
	const renderer = (await makeApp(gl, 1)).renderer as WebGLRenderer;
	if (renderer.context.webGLVersion !== gl)
		console.error(`asked for WebGL${gl}, got WebGL${renderer.context.webGLVersion}`);
	page.result = { shots, differ, unrested };
	page.ready = true;
})();
