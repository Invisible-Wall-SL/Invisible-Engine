/**
 * The `/fx` page as `fxPage.mjs` plays it: the real `+page.svelte` (and its `FxStage`, inspector and
 * dialogs) mounted outside SvelteKit, with `$app/*` stubbed (`fxPage/app*.ts`) and every request the
 * page makes answered here, in memory:
 *  - `GET /api/shaders/effects`: the reference graphs compiled (`compileShaderEffect`), Ripple made
 *    for particles, as the route answers them, with their costs (`analyzeShaderGraph`);
 *  - `GET /api/editor/regions` / `asset`: one atlas page drawn on a canvas (a soft dot, a square);
 *  - `POST /api/fx/save` and `GET /api/fx/effect`: the effect normalized as `saveEffect` stores it
 *    (`normalizeEffectDoc`, the slugged id) and read back through JSON, as R2 holds it;
 *  - `/api/lease` (held), `/rig-viewer/skeletons` (none);
 *  - "Bake now": `POST /api/fx/bake/upload-url`, the presigned `PUT` (held in memory) and
 *    `POST /api/fx/bake` (the sheet's JSON, `effectBakeSheetJson`), which `regions` / `asset` then
 *    serve back as any atlas.
 *
 * Every WebGL context keeps its drawing buffer, so the driver can read the stage's pixels. The page
 * exposes `window.fxPage`: the requests made, the docs saved and the baked pages uploaded.
 *
 * `?bake=1` opens a saved, bakeable effect: a normal puff under additive sparks, both on the dot —
 * two blend groups. `?bursts=1` opens one of three one-shot layers over a continuous one.
 *
 * `fxPage.apps` holds every Pixi `Application` the page made, and `fxPage.emitters` every particle
 * `Emitter`, so a driver can read the stage.
 */
import { mount } from 'svelte';
import { Application } from 'pixi.js';
import { Emitter } from '@barvynkoa/particle-emitter';
import {
	effectBakeGroupFrameNames,
	effectBakeSheetJson,
	normalizeEffectDoc,
	type EffectDoc,
} from 'engine-fx';
import {
	REFERENCE_GRAPHS,
	analyzeShaderGraph,
	compileShaderEffect,
} from '@fxroot/packages/engine-shadergraph/index';
import { TOOLS } from '@fxroot/apps/launcher-api/src/lib/roles';
import DialogHost from '@fxroot/apps/launcher-api/src/lib/DialogHost.svelte';
import Page from '@fxroot/apps/launcher-api/src/routes/(app)/fx/+page.svelte';

const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
	this: HTMLCanvasElement,
	kind: string,
	options?: Record<string, unknown>,
) {
	const keep = kind.startsWith('webgl') ? { ...options, preserveDrawingBuffer: true } : options;
	return getContext.call(this, kind, keep);
} as typeof HTMLCanvasElement.prototype.getContext;

const apps: Application[] = [];
const appInit = Application.prototype.init;
Application.prototype.init = function (this: Application, ...args: Parameters<typeof appInit>) {
	apps.push(this);
	return appInit.apply(this, args);
};
const emitters: Emitter[] = [];
const emitterInit = Emitter.prototype.init;
Emitter.prototype.init = function (this: Emitter, ...args: Parameters<typeof emitterInit>) {
	if (!emitters.includes(this)) emitters.push(this);
	return emitterInit.apply(this, args);
};

const ATLAS = 'client/project/manifests/atlas_manifest_sparks.json';
const REGIONS = [
	{ name: 'dot', x: 0, y: 0, w: 48, h: 48 },
	{ name: 'square', x: 64, y: 8, w: 32, h: 32 },
];

async function pageImage(): Promise<Blob> {
	const canvas = new OffscreenCanvas(128, 64);
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.5, 'rgba(255,240,200,0.9)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 48, 48);
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(64, 8, 32, 32);
	return canvas.convertToBlob({ type: 'image/png' });
}

/** Ripple is made for particles: the Material picker lists it first. */
const compiled = REFERENCE_GRAPHS.map((doc) => ({
	doc,
	result: compileShaderEffect(doc.id === 'ripple' ? { ...doc, madeFor: 'particles' } : doc),
}));
const effects = compiled.flatMap(({ result }) => (result.ok ? [result.effect] : []));
const costs = compiled
	.filter(({ result }) => result.ok)
	.map(({ doc }) => {
		const { cost, samples } = analyzeShaderGraph(doc);
		return { id: doc.id, shared: false, cost, samples };
	});

const slug = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';

interface Stored {
	text: string;
	meta: unknown;
	etag: string;
}
const store = new Map<string, Stored>();
const requests: string[] = [];
const saved: { sent: EffectDoc; stored: EffectDoc }[] = [];
let etags = 0;

/** An effect of one layer on the dot with `material` (a stored doc, as the loader reads it). */
const effectWith = (id: string, name: string, material: Record<string, unknown>): EffectDoc =>
	normalizeEffectDoc(
		{
			version: 1,
			id,
			name,
			layers: [
				{
					key: 'main',
					particleKind: 'sprite',
					art: { assetKey: ATLAS, frames: ['dot'] },
					placement: { space: 'free' },
					config: {
						lifetime: { min: 0.5, max: 0.8 },
						frequency: 0.02,
						emitterLifetime: -1,
						maxParticles: 100,
						pos: { x: 0, y: 0 },
						addAtBack: false,
						behaviors: [],
					},
					material,
				},
			],
		},
		id,
	);
/** A stored effect whose material names a graph the project no longer has. */
const ghost = effectWith('ghost', 'Ghost', { kind: 'custom:gone' });
store.set('ghost', { text: JSON.stringify(ghost), meta: {}, etag: '"g"' });

/**
 * `?opened=1`: the page opens on an effect with a material (the loader's `openedDoc`, as a reload of
 * `/fx?effect=…` does) and the compiled set answers late, after the stage's first build.
 */
const opening = new URLSearchParams(location.search).has('opened');
const opened = effectWith('lit', 'Lit', { kind: 'custom:noiseDissolve' });

const baking = new URLSearchParams(location.search).has('bake');
const sparks = normalizeEffectDoc(
	{
		version: 1,
		id: 'sparks',
		name: 'Sparks',
		layers: [
			{
				key: 'puff',
				particleKind: 'sprite',
				art: { assetKey: ATLAS, frames: ['dot'] },
				placement: { space: 'free' },
				config: {
					lifetime: { min: 0.8, max: 1 },
					frequency: 0.05,
					emitterLifetime: -1,
					maxParticles: 40,
					pos: { x: 0, y: 0 },
					addAtBack: false,
					behaviors: [
						{ type: 'alphaStatic', config: { alpha: 0.6 } },
						{ type: 'scaleStatic', config: { min: 0.8, max: 1 } },
						{ type: 'moveSpeedStatic', config: { min: 5, max: 10 } },
						{ type: 'colorStatic', config: { color: '6080a0' } },
					],
				},
			},
			{
				key: 'spark',
				particleKind: 'sprite',
				art: { assetKey: ATLAS, frames: ['dot'] },
				placement: { space: 'free' },
				config: {
					lifetime: { min: 0.6, max: 1 },
					frequency: 0.01,
					emitterLifetime: -1,
					maxParticles: 300,
					pos: { x: 0, y: 0 },
					addAtBack: false,
					behaviors: [
						{
							type: 'alpha',
							config: {
								alpha: {
									list: [
										{ time: 0, value: 1 },
										{ time: 1, value: 0 },
									],
								},
							},
						},
						{ type: 'scaleStatic', config: { min: 0.4, max: 0.6 } },
						{
							type: 'moveSpeedStatic',
							config: { min: 15, max: 30 },
						},
						{ type: 'rotationStatic', config: { min: 0, max: 360 } },
						{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 10 } } },
						{ type: 'blendMode', config: { blendMode: 'add' } },
					],
				},
			},
		],
	},
	'sparks',
);
store.set('sparks', { text: JSON.stringify(sparks), meta: {}, etag: '"s"' });

const bursting = new URLSearchParams(location.search).has('bursts');
/** A layer on the dot: a burst of `emitterLifetime` seconds, or continuous at -1. */
const dotLayer = (key: string, emitterLifetime: number, x: number) => ({
	key,
	particleKind: 'sprite',
	art: { assetKey: ATLAS, frames: ['dot'] },
	placement: { space: 'free', offset: { x, y: 0 } },
	config: {
		lifetime: { min: 0.4, max: 0.8 },
		frequency: emitterLifetime > 0 ? 0.002 : 0.02,
		emitterLifetime,
		maxParticles: 200,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{ type: 'moveSpeedStatic', config: { min: 60, max: 120 } },
			{ type: 'spawnBurst', config: { start: 0, spacing: 30, distance: 0 } },
		],
	},
});
const bursts = normalizeEffectDoc(
	{
		version: 1,
		id: 'bursts',
		name: 'Bursts',
		layers: [
			dotLayer('ambient', -1, 0),
			dotLayer('burst-a', 0.12, -200),
			dotLayer('burst-b', 0.12, 0),
			dotLayer('burst-c', 0.06, 200),
		],
	},
	'bursts',
);
/** Baked pages PUT to the fake R2, by key; and each bake's sheet JSON. */
const r2 = new Map<string, Blob>();
const sheets = new Map<string, unknown>();
const uploads: { key: string; bytes: number }[] = [];

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = new URL(typeof input === 'string' ? input : String(input), location.href);
	const method = init?.method ?? 'GET';
	if (
		url.protocol === 'file:' &&
		!url.pathname.startsWith('/api') &&
		!url.pathname.startsWith('/rig')
	)
		return realFetch(input, init);
	requests.push(`${method} ${url.pathname}${url.search}`);
	if (url.host === 'r2.test' && method === 'PUT') {
		const blob = init?.body as Blob;
		const key = url.pathname.slice(1);
		r2.set(key, blob);
		uploads.push({ key, bytes: blob.size });
		return new Response(null, { status: 200 });
	}
	switch (url.pathname) {
		case '/api/shaders/effects':
			if (opening) await new Promise((r) => setTimeout(r, 1500));
			return json({ ok: true, effects, skipped: [], costs });
		case '/api/editor/regions': {
			const sheet = sheets.get(url.searchParams.get('sheet') ?? '') as
				| {
						frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
						meta: { size: { w: number; h: number } };
				  }
				| undefined;
			if (sheet) {
				const png = (url.searchParams.get('sheet') ?? '').replace(/\.json$/, '.png');
				return json({
					pageKey: png,
					pageWidth: sheet.meta.size.w,
					pageHeight: sheet.meta.size.h,
					regions: Object.entries(sheet.frames).map(([name, f]) => ({ name, ...f.frame })),
				});
			}
			return json({ pageKey: 'page.png', pageWidth: 128, pageHeight: 64, regions: REGIONS });
		}
		case '/api/editor/asset': {
			const baked = r2.get(url.searchParams.get('key') ?? '');
			return new Response(baked ?? (await pageImage()), {
				headers: { 'content-type': 'image/png' },
			});
		}
		case '/api/fx/bake/upload-url': {
			const body = JSON.parse(String(init?.body)) as { effectId: string; hash: string };
			const key = `client/project/fx-bakes/${body.effectId}/fxbake_${body.effectId}_${body.hash}.png`;
			return json({ url: `https://r2.test/${key}`, key, contentType: 'image/png' });
		}
		case '/api/fx/bake': {
			const body = JSON.parse(String(init?.body)) as {
				effectId: string;
				hash: string;
				frames: number;
				groups?: number;
				plan: {
					cellW: number;
					cellH: number;
					gap: number;
					cols: number;
					width: number;
					height: number;
				};
			};
			const stem = `client/project/fx-bakes/${body.effectId}/fxbake_${body.effectId}_${body.hash}`;
			if (!r2.has(`${stem}.png`)) return json({ message: 'no page' }, 409);
			const groups = body.groups ?? 1;
			sheets.set(
				`${stem}.json`,
				effectBakeSheetJson(body.plan, body.frames * groups, `${stem}.png`, body.hash),
			);
			return json({
				ok: true,
				assetKey: `${stem}.json`,
				groups: effectBakeGroupFrameNames(body.hash, body.frames, groups),
			});
		}
		case '/api/lease':
			return json({ held: true, heartbeatMs: 600_000 });
		case '/rig-viewer/skeletons':
			return json({ skeletons: [] });
		case '/api/fx/save': {
			const body = JSON.parse(String(init?.body)) as { doc: EffectDoc; meta: unknown };
			const id = slug(body.doc.id);
			const doc = normalizeEffectDoc(body.doc, id);
			doc.id = id;
			const text = JSON.stringify(doc, null, 2);
			const etag = `"e${++etags}"`;
			store.set(id, { text, meta: body.meta, etag });
			saved.push({ sent: body.doc, stored: JSON.parse(text) as EffectDoc });
			return json({ ok: true, id, name: doc.name, layers: doc.layers.length, etag });
		}
		case '/api/fx/effect': {
			const hit = store.get(url.searchParams.get('id') ?? '');
			if (!hit) return json({ message: 'no such effect' }, 404);
			return json({ doc: JSON.parse(hit.text), meta: hit.meta, etag: hit.etag });
		}
	}
	return json({ message: `fxPage: nothing answers ${method} ${url.pathname}` }, 404);
};

Object.assign(window, { fxPage: { requests, saved, uploads, r2, apps, emitters } });

mount(DialogHost, { target: document.body });
mount(Page, {
	target: document.body,
	props: {
		data: {
			clientKey: 'client',
			projectKey: 'project',
			tools: [TOOLS.fx, TOOLS.shaders],
			atlases: [{ manifestKey: ATLAS, label: 'sparks', regions: REGIONS.map((r) => r.name) }],
			effects: [
				{ id: 'ghost', name: 'Ghost' },
				...(baking ? [{ id: 'sparks', name: 'Sparks' }] : []),
			],
			openedDoc: bursting ? bursts : baking ? sparks : opening ? opened : null,
			openedMeta: null,
			openedEtag: null,
			eventTypes: [],
		},
	},
});
