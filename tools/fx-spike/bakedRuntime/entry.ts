/**
 * The `baked-runtime` gate's page (`bakedRuntime.mjs`): the real `<EffectPlayer>` mounted six times
 * in a real WebGL app, stepped by hand through the app ticker, and each claim checked against what is
 * on the stage. `window.result` lists `[name, ok, detail]`.
 */
import { flushSync, mount } from 'svelte';
import { Particle } from '@barvynkoa/particle-emitter';
import { Application, Sprite, Texture, type Container } from 'pixi.js';
import {
	effectBakeFrameAt,
	effectBakeInstanceKey,
	effectBakeStartFrame,
	normalizeEffectDoc,
	type EffectDoc,
} from 'engine-fx';
import Host, { type Mount } from './Host.svelte';

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = ''): void =>
	void results.push([name, ok, detail]);

const ATLAS = 'c/p/manifests/sparks.json';
const SHEET = 'c/p/fx-bakes/sparks/fxbake_sparks_0000abcd.json';
const FRAMES = Array.from({ length: 12 }, (_, i) => `bake_0000abcd_${String(i).padStart(3, '0')}`);
const FPS = 24;
const BOUNDS = { x: -40, y: -30, w: 80, h: 60 };

const layer = {
	key: 'spark',
	particleKind: 'sprite',
	art: { assetKey: ATLAS, frames: ['dot'] },
	placement: { space: 'free' },
	config: {
		lifetime: { min: 0.5, max: 0.8 },
		frequency: 0.01,
		emitterLifetime: -1,
		maxParticles: 100,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [{ type: 'blendMode', config: { blendMode: 'add' } }],
	},
};
const bake = (enabled: boolean, assetKey = SHEET) => ({
	enabled,
	fps: FPS,
	loopSeconds: 0.5,
	scale: 0.5,
	seam: 'crossfade',
	result: {
		assetKey,
		frames: FRAMES,
		fps: FPS,
		bounds: BOUNDS,
		blendMode: 'add',
		hash: '0000abcd',
		sheet: { w: 256, h: 256 },
	},
});
const doc = (extra: Record<string, unknown> = {}): EffectDoc =>
	normalizeEffectDoc({ version: 1, id: 'sparks', name: 'Sparks', layers: [layer], ...extra });

(async () => {
	const app = new Application();
	await app.init({ width: 400, height: 400, autoStart: false, preference: 'webgl' });
	document.body.appendChild(app.canvas);

	const frameTextures = FRAMES.map(() => new Texture({ source: Texture.WHITE.source }));
	const loadedAssets: Record<string, unknown> = {
		[`${ATLAS}::dot`]: new Texture({ source: Texture.WHITE.source }),
	};
	FRAMES.forEach((f, i) => (loadedAssets[`${SHEET}::${f}`] = frameTextures[i]));

	const mounts: Mount[] = [
		{ doc: doc(), x: 60, y: 60 },
		{ doc: doc({ bake: bake(true) }), x: 100, y: 300, instanceKey: 'pot-1' },
		{ doc: doc({ bake: bake(true) }), x: 300, y: 300, instanceKey: 'pot-2' },
		{ doc: doc({ bake: bake(true, 'c/p/fx-bakes/sparks/missing.json') }), x: 200, y: 60 },
		{ doc: doc({ bake: bake(true) }), x: 340, y: 60, forceEmit: true },
		{ doc: doc({ bake: bake(false) }), x: 200, y: 200 },
	];
	mount(Host, { target: document.body, props: { app, loadedAssets, mounts } });
	flushSync();

	let now = 1000;
	const step = (ms: number): void => {
		now += ms;
		app.ticker.update(now);
	};
	step(16);
	const holders = app.stage.children as Container[];
	const bakedSprite = (c: Container): Sprite | undefined =>
		c.children.length === 1 &&
		c.children[0] instanceof Sprite &&
		!(c.children[0] instanceof Particle)
			? (c.children[0] as Sprite)
			: undefined;
	const particles = (c: Container): number => {
		let n = 0;
		const walk = (x: Container): void => {
			for (const ch of x.children) {
				if (ch instanceof Particle) n++;
				walk(ch as Container);
			}
		};
		walk(c);
		return n;
	};
	const frameOf = (s: Sprite): number => frameTextures.indexOf(s.texture);
	const starts = [1, 2].map((i) => {
		const s = bakedSprite(holders[i]);
		const at = s?.getGlobalPosition();
		return {
			shown: s ? frameOf(s) : -1,
			expected: at
				? effectBakeStartFrame(
						effectBakeInstanceKey('sparks', mounts[i].instanceKey, at.x, at.y),
						FRAMES.length,
					)
				: -2,
		};
	});

	for (let i = 0; i < 20; i++) step(1000 / FPS);

	check('six mounts on the stage', holders.length === 6, `${holders.length}`);
	const plain = holders[0];
	check(
		'no bake ⇒ the live emitters, unchanged',
		!bakedSprite(plain) && particles(plain) > 0,
		`${particles(plain)} particles`,
	);
	for (const i of [1, 2]) {
		const s = bakedSprite(holders[i]);
		check(
			`bake on + sheet loaded ⇒ one sprite, no particles (#${i})`,
			!!s && particles(holders[i]) === 0,
		);
		check(
			`the sprite sits on the captured box, additive (#${i})`,
			!!s &&
				s.x === BOUNDS.x &&
				s.y === BOUNDS.y &&
				Math.abs(s.width - BOUNDS.w) < 1e-6 &&
				Math.abs(s.height - BOUNDS.h) < 1e-6 &&
				s.blendMode === 'add',
			s ? `${s.x},${s.y} ${s.width}×${s.height} ${s.blendMode}` : 'no sprite',
		);
	}
	check(
		'each copy starts on its deterministic frame',
		starts.every((s) => s.shown === s.expected),
		JSON.stringify(starts),
	);
	check(
		'two copies start on different frames',
		starts[0].shown !== starts[1].shown,
		JSON.stringify(starts),
	);
	const s1 = bakedSprite(holders[1]);
	const expectedNow = effectBakeFrameAt(starts[0].expected, 20 / FPS, FPS, FRAMES.length);
	check(
		'it advances at the bake fps on the app clock',
		!!s1 && Math.abs((frameOf(s1) - expectedNow + FRAMES.length) % FRAMES.length) <= 1,
		`${s1 ? frameOf(s1) : -1} vs ${expectedNow}`,
	);
	for (const [i, label] of [
		[3, 'a sheet not loaded'],
		[4, 'a forced rig beat'],
		[5, 'bake off'],
	] as const)
		check(`${label} ⇒ live`, !bakedSprite(holders[i]) && particles(holders[i]) > 0);

	Object.assign(window, { result: results, ready: true });
})().catch((e) => {
	console.error(e instanceof Error ? e.stack : String(e));
	Object.assign(window, { result: [['the page ran', false, String(e)]], ready: true });
});
