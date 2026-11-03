/**
 * The `baked-runtime` gate's PIXEL page (`bakedRuntime.mjs`): does a baked effect LOOK like the live
 * one? An effect is baked by the real `/fx` capture (`captureEffectBake`, scale 1, cut seam) and played
 * by the real `<EffectPlayer>` → `<BakedEffect>`; the same layers are run live through the same
 * mount (`mountEffectForBake`) on the same seeded `Math.random`, so live frame `i` and baked frame `i`
 * are the same particles. Each is rendered over mid grey and over the dark stage background, and the
 * two images are compared pixel by pixel.
 *
 * The sheet reaches the runtime both ways a game loads it: the PNG (decoded and premultiplied on
 * upload, as Pixi's texture loader does) and the premultiplied KTX2 twin's bytes (`premultiplyRgba`,
 * the encoder's own premultiply, uploaded `premultiplied-alpha` as `ktx2AlphaMode` marks it; the
 * UASTC block compression itself is not run here).
 *
 * The effects:
 *  - MIXED: a soft normal cloud under additive sparks whose texture is a glow on an OPAQUE BLACK
 *    square (art that relies on `add` to vanish). Before blend groups the whole effect was flattened
 *    into one normal-blend sheet, and the black squares became a dark outline; that legacy sheet is
 *    rebuilt here too, so the gate shows it catches the bug.
 *  - SMOKE: one normal soft cloud — checks the premultiply round trip leaves no dark fringe.
 *  - BLENDS: a normal cloud, a multiply shade (captured over white) and screen sparks — the other
 *    two blends the inspector offers, three groups.
 *
 * `window.result` lists `[name, ok, detail]`.
 */
import { flushSync, mount } from 'svelte';
import {
	Application,
	BufferImageSource,
	Container,
	Graphics,
	ImageSource,
	Rectangle,
	Sprite,
	Texture,
	type TextureSource,
} from 'pixi.js';
import {
	effectBakeCellOrigin,
	effectBakeFrameCount,
	effectBakeWarmup,
	emitterDeltaSeconds,
	normalizeEffectDoc,
	type EffectBakeResult,
	type EffectDoc,
} from 'engine-fx';
import {
	captureEffectBake,
	mountEffectForBake,
	type BakeCapture,
} from '@fxroot/apps/launcher-api/src/routes/(app)/fx/fxBake.client';
import { premultiplyRgba } from '@fxroot/apps/launcher-api/src/lib/server/ktx2Alpha';
import type { ResolvedArt } from '@fxroot/apps/launcher-api/src/lib/fx/effectEmitter.client';
import Host from './Host.svelte';

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = ''): void =>
	void results.push([name, ok, detail]);

const SIZE = 320;
const MID = SIZE / 2;
const BACKGROUNDS = { 'mid grey': [128, 128, 128], 'dark stage': [11, 14, 19] } as const;
type BgName = keyof typeof BACKGROUNDS;
const FPS = 24;
const ATLAS = 'c/p/manifests/pixels.json';

// --- art: a soft cloud, and a glow on an opaque black square --------------------------------------
function atlasPage(): string {
	const cv = document.createElement('canvas');
	cv.width = 144;
	cv.height = 64;
	const g = cv.getContext('2d') as CanvasRenderingContext2D;
	const cloud = g.createRadialGradient(32, 32, 0, 32, 32, 31);
	cloud.addColorStop(0, 'rgba(225,225,230,0.9)');
	cloud.addColorStop(0.5, 'rgba(210,210,220,0.45)');
	cloud.addColorStop(1, 'rgba(200,200,210,0)');
	g.fillStyle = cloud;
	g.fillRect(0, 0, 64, 64);
	g.fillStyle = '#000';
	g.fillRect(80, 0, 64, 64);
	const glow = g.createRadialGradient(112, 32, 0, 112, 32, 30);
	glow.addColorStop(0, 'rgb(255,220,140)');
	glow.addColorStop(0.35, 'rgb(200,90,20)');
	glow.addColorStop(1, 'rgb(0,0,0)');
	g.fillStyle = glow;
	g.fillRect(80, 0, 64, 64);
	return cv.toDataURL('image/png');
}
const ART: ResolvedArt = {
	pageUrl: atlasPage(),
	pageWidth: 144,
	pageHeight: 64,
	regions: [
		{ name: 'cloud', x: 0, y: 0, w: 64, h: 64 },
		{ name: 'glow', x: 80, y: 0, w: 64, h: 64 },
	],
};
const resolveArt = async (key: string): Promise<ResolvedArt | null> => (key === ATLAS ? ART : null);

const cloudLayer = (key: string) => ({
	key,
	particleKind: 'sprite',
	art: { assetKey: ATLAS, frames: ['cloud'] },
	placement: { space: 'free' },
	config: {
		lifetime: { min: 0.8, max: 1.2 },
		frequency: 0.06,
		emitterLifetime: -1,
		maxParticles: 40,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'alpha',
				config: {
					alpha: {
						list: [
							{ time: 0, value: 0.9 },
							{ time: 1, value: 0 },
						],
					},
				},
			},
			{ type: 'scaleStatic', config: { min: 0.9, max: 1.4 } },
			{ type: 'moveSpeedStatic', config: { min: 10, max: 25 } },
			{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 20 } } },
		],
	},
});
const sparkLayer = {
	key: 'sparks',
	particleKind: 'sprite',
	art: { assetKey: ATLAS, frames: ['glow'] },
	placement: { space: 'free' },
	config: {
		lifetime: { min: 0.4, max: 0.7 },
		frequency: 0.02,
		emitterLifetime: -1,
		maxParticles: 60,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'alpha',
				config: {
					alpha: {
						list: [
							{ time: 0, value: 1 },
							{ time: 1, value: 0.2 },
						],
					},
				},
			},
			{ type: 'scaleStatic', config: { min: 0.4, max: 0.8 } },
			{ type: 'moveSpeedStatic', config: { min: 40, max: 80 } },
			{ type: 'blendMode', config: { blendMode: 'add' } },
		],
	},
};
const docOf = (id: string, layers: unknown[]): EffectDoc =>
	normalizeEffectDoc(
		{
			version: 1,
			id,
			name: id,
			layers,
			bake: { enabled: true, fps: FPS, loopSeconds: 0.5, scale: 1, seam: 'cut' },
		},
		id,
	);

// --- a seeded Math.random, so the live run replays the capture's particles ------------------------
const realRandom = Math.random;
function seed(s: number): void {
	let a = s >>> 0;
	Math.random = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// --- rendering ------------------------------------------------------------------------------------
type Image = Uint8ClampedArray;
const bgFill = (g: Graphics, rgb: readonly number[]): Graphics =>
	g
		.clear()
		.rect(0, 0, SIZE, SIZE)
		.fill((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]);

function snapshot(app: Application, target: Container): Image {
	const px = app.renderer.extract.pixels({
		target,
		frame: new Rectangle(0, 0, SIZE, SIZE),
		resolution: 1,
	});
	return new Uint8ClampedArray(px.pixels);
}

const luma = (d: Image, i: number): number => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

interface Diff {
	/** Mean absolute difference per channel over the effect's box, 0…255. */
	mae: number;
	/** Pixels where live is at least as bright as the background but baked is darker than it. */
	darkRing: number;
	/** Pixels where baked is darker than live by more than the tolerance (a fringe). */
	darker: number;
	/** The box's pixel count. */
	box: number;
}
/** Live vs baked over the box `b` (stage pixels). Luma tolerances, 0…255. */
function diff(live: Image, baked: Image, bg: readonly number[], b: Rectangle): Diff {
	const bgL = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
	let sum = 0;
	let n = 0;
	let darkRing = 0;
	let darker = 0;
	for (let y = Math.max(0, b.y); y < Math.min(SIZE, b.y + b.height); y++)
		for (let x = Math.max(0, b.x); x < Math.min(SIZE, b.x + b.width); x++) {
			const i = (y * SIZE + x) * 4;
			for (let c = 0; c < 3; c++) sum += Math.abs(live[i + c] - baked[i + c]);
			n++;
			const l = luma(live, i);
			const k = luma(baked, i);
			if (l >= bgL - 1 && k < bgL - 4) darkRing++;
			if (k < l - 6) darker++;
		}
	return { mae: sum / (3 * Math.max(1, n)), darkRing, darker, box: n };
}

// --- the sheet, as a game loads it ----------------------------------------------------------------
async function pngSource(capture: BakeCapture): Promise<TextureSource> {
	const blob = await new Promise<Blob>((resolve, reject) =>
		capture.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'),
	);
	// Pixi's `loadTextures` for a straight PNG.
	return new ImageSource({
		resource: await createImageBitmap(blob),
		alphaMode: 'premultiply-alpha-on-upload',
	});
}
function ktx2Source(capture: BakeCapture): TextureSource {
	const { width, height } = capture.canvas;
	const ctx = capture.canvas.getContext('2d') as CanvasRenderingContext2D;
	// The PNG's straight bytes (what `sharp` decodes), premultiplied as the KTX2 encoder does.
	const bytes = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer.slice(0));
	premultiplyRgba(bytes);
	return new BufferImageSource({
		resource: bytes,
		width,
		height,
		alphaMode: 'premultiplied-alpha',
	});
}
function sheetAssets(
	capture: BakeCapture,
	result: EffectBakeResult,
	source: TextureSource,
): Record<string, Texture> {
	const out: Record<string, Texture> = {};
	result.groups.forEach((g, gi) =>
		g.frames.forEach((name, i) => {
			const at = effectBakeCellOrigin(capture.plan, gi * capture.frames + i);
			out[`${result.assetKey}::${name}`] = new Texture({
				source,
				frame: new Rectangle(at.x, at.y, capture.plan.cellW, capture.plan.cellH),
			});
		}),
	);
	return out;
}

interface Run {
	capture: BakeCapture;
	result: EffectBakeResult;
	/** Live frame i over each background; and the legacy one-sheet bake of it. */
	live: Record<BgName, Image>[];
	legacy: Record<BgName, Image>[];
	/** Each frame's live box, stage pixels. */
	box: Rectangle[];
}

async function bakeAndRunLive(doc: EffectDoc): Promise<Run> {
	seed(7);
	const capture = await captureEffectBake({ doc, resolveArt });
	const result: EffectBakeResult = {
		assetKey: `c/p/fx-bakes/${doc.id}/fxbake_${doc.id}_${capture.hash}.json`,
		groups: capture.groups.map((blendMode, g) => ({
			blendMode,
			frames: Array.from({ length: capture.frames }, (_, i) => `px_${g}_${i}`),
		})),
		fps: capture.fps,
		bounds: capture.bounds,
		hash: capture.hash,
		sheet: { w: capture.canvas.width, h: capture.canvas.height },
	};

	const app = new Application();
	await app.init({ width: SIZE, height: SIZE, autoStart: false, preference: 'webgl' });
	seed(7);
	const mounted = await mountEffectForBake(doc, resolveArt, app);
	const dt = emitterDeltaSeconds(1000 / FPS);
	const warm = Math.ceil(effectBakeWarmup(doc) / dt);
	for (let i = 0; i < warm; i++) mounted.step(dt);
	const scene = new Container();
	const bg = new Graphics();
	scene.addChild(bg);
	scene.addChild(mounted.root);
	mounted.root.position.set(MID, MID);
	const live: Run['live'] = [];
	const legacy: Run['legacy'] = [];
	const box: Rectangle[] = [];
	const frames = effectBakeFrameCount(doc.bake ?? { fps: FPS, loopSeconds: 0.5 });
	for (let i = 0; i < frames; i++) {
		mounted.step(dt);
		const b = mounted.root.getLocalBounds();
		const r = new Rectangle(
			Math.floor(b.minX),
			Math.floor(b.minY),
			Math.ceil(b.maxX) - Math.floor(b.minX),
			Math.ceil(b.maxY) - Math.floor(b.minY),
		);
		box.push(new Rectangle(r.x + MID, r.y + MID, r.width, r.height));
		// The legacy bake of this frame: every layer flattened into one premultiplied capture.
		const flat = app.renderer.extract.pixels({
			target: mounted.root,
			frame: r,
			resolution: 1,
			clearColor: [0, 0, 0, 0],
		});
		const flatTex = new Texture({
			source: new BufferImageSource({
				resource: new Uint8Array(flat.pixels.buffer.slice(0)),
				width: flat.width,
				height: flat.height,
				alphaMode: 'premultiplied-alpha',
			}),
		});
		const flatScene = new Container();
		const flatBg = new Graphics();
		const flatSprite = new Sprite(flatTex);
		flatSprite.position.set(r.x + MID, r.y + MID);
		flatScene.addChild(flatBg, flatSprite);
		const l = {} as Record<BgName, Image>;
		const f = {} as Record<BgName, Image>;
		for (const name of Object.keys(BACKGROUNDS) as BgName[]) {
			bgFill(bg, BACKGROUNDS[name]);
			l[name] = snapshot(app, scene);
			bgFill(flatBg, BACKGROUNDS[name]);
			f[name] = snapshot(app, flatScene);
		}
		live.push(l);
		legacy.push(f);
		flatScene.destroy({ children: true });
		flatTex.destroy(true);
	}
	Math.random = realRandom;
	mounted.destroy();
	return { capture, result, live, legacy, box };
}

/** The baked effect played by the real `<EffectPlayer>`, frame by frame, over each background. */
async function playBaked(
	doc: EffectDoc,
	run: Run,
	source: TextureSource,
): Promise<{ blends: string[]; played: { frame: number; images: Record<BgName, Image> }[] }> {
	const app = new Application();
	await app.init({ width: SIZE, height: SIZE, autoStart: false, preference: 'webgl' });
	const bg = new Graphics();
	app.stage.addChild(bg);
	const loadedAssets = sheetAssets(run.capture, run.result, source);
	const bakedDoc = { ...doc, bake: { ...doc.bake!, result: run.result } } as EffectDoc;
	mount(Host, {
		target: document.body,
		props: { app, loadedAssets, mounts: [{ doc: bakedDoc, x: MID, y: MID }] },
	});
	flushSync();
	const holder = app.stage.children[1] as Container;
	const group0 = run.result.groups[0].frames.map(
		(n) => loadedAssets[`${run.result.assetKey}::${n}`],
	);
	let now = 1000;
	const out: { frame: number; images: Record<BgName, Image> }[] = [];
	for (let k = 0; k < run.capture.frames; k++) {
		app.ticker.update((now += k === 0 ? 16 : 1000 / FPS + 0.01));
		const sprites = holder.children as Sprite[];
		const frame = group0.indexOf(sprites[0].texture);
		const images = {} as Record<BgName, Image>;
		for (const name of Object.keys(BACKGROUNDS) as BgName[]) {
			bgFill(bg, BACKGROUNDS[name]);
			images[name] = snapshot(app, app.stage);
		}
		out.push({ frame, images });
	}
	return { blends: (holder.children as Sprite[]).map((s) => s.blendMode), played: out };
}

/** Mean of a diff over every frame; ring/darker summed. */
function summarise(diffs: Diff[]): Diff {
	const box = diffs.reduce((t, d) => t + d.box, 0);
	return {
		mae: diffs.reduce((t, d) => t + d.mae * d.box, 0) / Math.max(1, box),
		darkRing: diffs.reduce((t, d) => t + d.darkRing, 0),
		darker: diffs.reduce((t, d) => t + d.darker, 0),
		box,
	};
}
const fmt = (d: Diff): string =>
	`MAE ${d.mae.toFixed(2)}/255, dark-ring ${d.darkRing}, darker-than-live ${d.darker} of ${d.box} px`;

/**
 * Thresholds. Live and baked draw the same particles, so all that is left is 8-bit rounding: the
 * capture's premultiplied read, the straight-alpha PNG and its premultiply again on upload, each up
 * to half a step — measured at about 0.3/255 on average, never a visible step darker. The mean must
 * stay under 2/255 (the legacy flattened bake of the mixed effect over mid grey is ~11/255), and a
 * dark ring or a pixel more than 6/255 darker than live is never acceptable: zero pixels.
 */
const MAE_MAX = 2;

(async () => {
	const mixedDoc = docOf('mixed', [cloudLayer('cloud'), sparkLayer]);
	const smokeDoc = docOf('smoke', [cloudLayer('smoke')]);
	const withBlend = (
		layer: { key: string; config: { behaviors: unknown[] } },
		key: string,
		blendMode: string,
		extra: unknown[] = [],
	) => ({
		...layer,
		key,
		config: {
			...layer.config,
			behaviors: [
				...layer.config.behaviors.filter((b) => (b as { type: string }).type !== 'blendMode'),
				...extra,
				{ type: 'blendMode', config: { blendMode } },
			],
		},
	});
	const blendsDoc = docOf('blends', [
		cloudLayer('cloud'),
		withBlend(cloudLayer('shade'), 'shade', 'multiply', [
			{ type: 'colorStatic', config: { color: '604830' } },
		]),
		withBlend(sparkLayer, 'sparks', 'screen'),
	]);
	const expected: Record<string, string> = {
		mixed: 'normal,add',
		smoke: 'normal',
		blends: 'normal,multiply,screen',
	};

	for (const doc of [mixedDoc, smokeDoc, blendsDoc]) {
		const run = await bakeAndRunLive(doc);
		check(
			`${doc.id}: the bake holds one group per blend run`,
			run.result.groups.map((g) => g.blendMode).join() === expected[doc.id],
			run.result.groups.map((g) => g.blendMode).join(),
		);
		for (const [label, source] of [
			['PNG', await pngSource(run.capture)],
			['pm KTX2 bytes', ktx2Source(run.capture)],
		] as const) {
			const { blends, played } = await playBaked(doc, run, source);
			check(
				`${doc.id} (${label}): the runtime draws one sprite per group, with its blend`,
				blends.join() === run.result.groups.map((g) => g.blendMode).join(),
				blends.join(),
			);
			check(
				`${doc.id} (${label}): every played frame is a captured frame`,
				played.every((p) => p.frame >= 0),
				played.map((p) => p.frame).join(','),
			);
			for (const name of Object.keys(BACKGROUNDS) as BgName[]) {
				const bg = BACKGROUNDS[name];
				const baked = summarise(
					played.map((p) => diff(run.live[p.frame][name], p.images[name], bg, run.box[p.frame])),
				);
				check(
					`${doc.id} (${label}) over ${name}: no dark ring (baked never darker than the background where live is not)`,
					baked.darkRing === 0,
					fmt(baked),
				);
				check(
					`${doc.id} (${label}) over ${name}: baked matches live (MAE < ${MAE_MAX}/255)`,
					baked.mae < MAE_MAX,
					fmt(baked),
				);
				check(
					`${doc.id} (${label}) over ${name}: no dark fringe (no pixel darker than live by > 6/255)`,
					baked.darker === 0,
					fmt(baked),
				);
			}
		}
		// The gate catches the bug: the legacy one-sheet bake of the mixed effect.
		if (doc.id === 'mixed')
			for (const name of Object.keys(BACKGROUNDS) as BgName[]) {
				const old = summarise(
					run.live.map((l, i) => diff(l[name], run.legacy[i][name], BACKGROUNDS[name], run.box[i])),
				);
				check(
					`mixed, the legacy flattened bake over ${name}: the same test fails it (its dark ring)`,
					old.darkRing > 0,
					fmt(old),
				);
			}
	}
	Object.assign(window, { result: results, ready: true });
})().catch((e) => {
	Math.random = realRandom;
	console.error(e instanceof Error ? e.stack : String(e));
	Object.assign(window, {
		result: [['the pixel page ran', false, String(e)]],
		ready: true,
	});
});
