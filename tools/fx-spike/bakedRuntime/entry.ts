/**
 * The `baked-runtime` gate's page (`bakedRuntime.mjs`): the real `<EffectPlayer>` mounted eleven
 * times in a real WebGL app (four of them the way `<RiggedEffect>` mounts a rig beat), stepped by
 * hand through the app ticker, and each claim checked against what is on the stage. `window.result`
 * lists `[name, ok, detail]`.
 */
import { flushSync, mount } from 'svelte';
import { Particle } from '@barvynkoa/particle-emitter';
import { Application, Sprite, Texture, type Container } from 'pixi.js';
import {
	DEFAULT_EMIT_SPEED,
	effectBakeBeatAlpha,
	effectBakeBeatFades,
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
const FRAME = 1000 / FPS;
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

type HostApi = { fire: (i: number) => void; release: (i: number) => void };

(async () => {
	const app = new Application();
	await app.init({ width: 400, height: 400, autoStart: false, preference: 'webgl' });
	document.body.appendChild(app.canvas);

	const frameTextures = FRAMES.map(() => new Texture({ source: Texture.WHITE.source }));
	const loadedAssets: Record<string, unknown> = {
		[`${ATLAS}::dot`]: new Texture({ source: Texture.WHITE.source }),
	};
	FRAMES.forEach((f, i) => (loadedAssets[`${SHEET}::${f}`] = frameTextures[i]));

	const beatDoc = doc({ bake: bake(true) });
	const LIFE = effectBakeBeatFades(beatDoc).fadeOut;
	const FAST = DEFAULT_EMIT_SPEED * 2;
	const mounts: Mount[] = [
		{ doc: doc(), x: 60, y: 60 },
		{ doc: doc({ bake: bake(true) }), x: 100, y: 300, instanceKey: 'pot-1' },
		{ doc: doc({ bake: bake(true) }), x: 300, y: 300, instanceKey: 'pot-2' },
		{ doc: doc({ bake: bake(true, 'c/p/fx-bakes/sparks/missing.json') }), x: 200, y: 60 },
		{ doc: beatDoc, x: 340, y: 60, forceEmit: true },
		{ doc: doc({ bake: bake(false) }), x: 200, y: 200 },
		{ doc: beatDoc, x: 60, y: 200, beat: { duration: 300 } },
		{ doc: beatDoc, x: 340, y: 200, beat: { duration: 5000, speed: FAST } },
		{ doc: beatDoc, x: 60, y: 340, beat: {}, ownerPos: () => ({ x: 0, y: 0 }) },
		{
			doc: doc({
				bake: bake(true),
				params: [{ id: 'heat', kind: 'number', default: 0, min: 0, max: 1, drives: [] }],
			}),
			x: 200,
			y: 340,
			params: () => ({ heat: 0.5 }),
		},
		{ doc: doc(), x: 120, y: 120, beat: { duration: 300 } },
	];
	const host = mount(Host, {
		target: document.body,
		props: { app, loadedAssets, mounts },
	}) as unknown as HostApi;
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
	const startOf = (i: number) => {
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
	};
	const starts = [1, 2].map(startOf);
	const beatStarts = [6, 7].map(startOf);
	const beatAlphaAtBeat = [6, 7].map((i) => bakedSprite(holders[i])?.alpha ?? -1);
	step(FRAME);
	const beatAlphaRising = bakedSprite(holders[7])?.alpha ?? -1;
	for (let i = 1; i < 20; i++) step(FRAME);

	check('eleven mounts on the stage', holders.length === 11, `${holders.length}`);
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
		check(`an ambient bake draws at full opacity (#${i})`, s?.alpha === 1, `${s?.alpha}`);
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
		[5, 'bake off'],
		[8, 'a rig beat with a trail owner (ownerPos)'],
		[9, 'live parameter values'],
		[10, 'a rig beat on an effect without a bake'],
	] as const)
		check(`${label} ⇒ live`, !bakedSprite(holders[i]) && particles(holders[i]) > 0);

	// A rig beat (`<RiggedEffect>`'s mount) on a baked effect.
	for (const i of [4, 6, 7])
		check(
			`a rig beat on a baked effect ⇒ one sprite, no particles (#${i})`,
			!!bakedSprite(holders[i]) && particles(holders[i]) === 0,
		);
	check(
		'a beat starts on its deterministic frame',
		beatStarts.every((s) => s.shown === s.expected),
		JSON.stringify(beatStarts),
	);
	check(
		'a beat starts faded out, and fades in',
		beatAlphaAtBeat.every((a) => a === 0) && beatAlphaRising > 0 && beatAlphaRising < 1,
		`${JSON.stringify(beatAlphaAtBeat)} → ${beatAlphaRising}`,
	);
	const s4 = bakedSprite(holders[4]);
	check(
		'a beat with no duration keeps looping at full opacity',
		!!s4 && s4.visible && s4.alpha === 1,
		`${s4?.visible} ${s4?.alpha}`,
	);
	const s6 = bakedSprite(holders[6]);
	check(
		`a 300 ms beat has faded out over the longest life (${LIFE.toFixed(3)} s) and stopped drawing`,
		!!s6 && !s6.visible && s6.alpha === 0 && 0.3 + LIFE < 20 / FPS,
		`${s6?.visible} ${s6?.alpha}`,
	);
	const s7 = bakedSprite(holders[7]);
	const at2x = effectBakeFrameAt(beatStarts[1].expected, (20 / FPS) * 2, FPS, FRAMES.length);
	check(
		'a beat at twice the emit speed plays the loop twice as fast',
		!!s7 && Math.abs((frameOf(s7) - at2x + FRAMES.length) % FRAMES.length) <= 1,
		`${s7 ? frameOf(s7) : -1} vs ${at2x}`,
	);
	check('… and is full while it emits', s7?.alpha === 1 && s7.visible, `${s7?.alpha}`);

	// `released`: no strip plays the clip any more — emission ends now and the loop fades out.
	host.release(7);
	flushSync();
	const fast = effectBakeBeatFades(beatDoc, FAST).fadeOut;
	step(FRAME);
	const fading = s7?.alpha ?? -1;
	const fadingExpected = effectBakeBeatAlpha(FRAME / 1000, 0, { fadeIn: 0, fadeOut: fast });
	check(
		'released ⇒ it fades out over the longest life at the beat speed',
		!!s7 && s7.visible && Math.abs(fading - fadingExpected) < 0.02,
		`${fading} vs ${fadingExpected}`,
	);
	for (let i = 0; i < Math.ceil((fast * 1000) / FRAME) + 1; i++) step(FRAME);
	check(
		'… then stops drawing',
		!!s7 && !s7.visible && s7.alpha === 0 && particles(holders[7]) === 0,
		`${s7?.visible} ${s7?.alpha}`,
	);

	// The next beat plays the loop again from the top.
	host.fire(6);
	flushSync();
	step(FRAME);
	const again = bakedSprite(holders[6]);
	check(
		'the next beat re-mounts a fresh sprite on the same deterministic frame, faded out',
		!!again &&
			again !== s6 &&
			again.visible &&
			again.alpha === 0 &&
			frameOf(again) === beatStarts[0].expected,
		`${again ? frameOf(again) : -1} ${again?.alpha}`,
	);
	for (let i = 0; i < 4; i++) step(FRAME);
	check('… and fades in to full', again?.alpha === 1, `${again?.alpha}`);

	// A baked beat on its own draws no random numbers: a seeded sequence does not shift.
	const app2 = new Application();
	await app2.init({ width: 100, height: 100, autoStart: false, preference: 'webgl' });
	const realRandom = Math.random;
	let draws = 0;
	Math.random = () => {
		draws++;
		return realRandom();
	};
	const host2 = mount(Host, {
		target: document.body,
		props: {
			app: app2,
			loadedAssets,
			mounts: [{ doc: beatDoc, x: 50, y: 50, beat: { duration: 200 } }],
		},
	}) as unknown as HostApi;
	flushSync();
	let now2 = 1000;
	for (let i = 0; i < 30; i++) app2.ticker.update((now2 += FRAME));
	host2.fire(0);
	flushSync();
	for (let i = 0; i < 30; i++) app2.ticker.update((now2 += FRAME));
	Math.random = realRandom;
	check('a baked rig beat draws no random numbers', draws === 0, `${draws} draws`);

	Object.assign(window, { result: results, ready: true });
})().catch((e) => {
	console.error(e instanceof Error ? e.stack : String(e));
	Object.assign(window, { result: [['the page ran', false, String(e)]], ready: true });
});
