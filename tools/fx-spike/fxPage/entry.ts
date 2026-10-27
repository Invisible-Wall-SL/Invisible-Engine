/**
 * The `/fx` page as `fxPage.mjs` plays it: the real `+page.svelte` (and its `FxStage`, inspector and
 * dialogs) mounted outside SvelteKit, with `$app/*` stubbed (`fxPage/app*.ts`) and every request the
 * page makes answered here, in memory:
 *  - `GET /api/shaders/effects`: the reference graphs compiled (`compileShaderEffect`), as the route
 *    answers them, with their costs (`analyzeShaderGraph`);
 *  - `GET /api/editor/regions` / `asset`: one atlas page drawn on a canvas (a soft dot, a square);
 *  - `POST /api/fx/save` and `GET /api/fx/effect`: the effect normalized as `saveEffect` stores it
 *    (`normalizeEffectDoc`, the slugged id) and read back through JSON, as R2 holds it;
 *  - `/api/lease` (held), `/rig-viewer/skeletons` (none).
 *
 * Every WebGL context keeps its drawing buffer, so the driver can read the stage's pixels. The page
 * exposes `window.fxPage`: the requests made and the docs saved.
 */
import { mount } from 'svelte';
import { normalizeEffectDoc, type EffectDoc } from 'engine-fx';
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

const compiled = REFERENCE_GRAPHS.map((doc) => ({ doc, result: compileShaderEffect(doc) }));
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

/** A stored effect whose material names a graph the project no longer has. */
const ghost = normalizeEffectDoc(
	{
		version: 1,
		id: 'ghost',
		name: 'Ghost',
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
				material: { kind: 'custom:gone' },
			},
		],
	},
	'ghost',
);
store.set('ghost', { text: JSON.stringify(ghost), meta: {}, etag: '"g"' });

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
	switch (url.pathname) {
		case '/api/shaders/effects':
			return json({ ok: true, effects, skipped: [], costs });
		case '/api/editor/regions':
			return json({ pageKey: 'page.png', pageWidth: 128, pageHeight: 64, regions: REGIONS });
		case '/api/editor/asset':
			return new Response(await pageImage(), { headers: { 'content-type': 'image/png' } });
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

Object.assign(window, { fxPage: { requests, saved } });

mount(DialogHost, { target: document.body });
mount(Page, {
	target: document.body,
	props: {
		data: {
			clientKey: 'client',
			projectKey: 'project',
			tools: [TOOLS.fx, TOOLS.shaders],
			atlases: [{ manifestKey: ATLAS, label: 'sparks', regions: REGIONS.map((r) => r.name) }],
			effects: [{ id: 'ghost', name: 'Ghost' }],
			openedDoc: null,
			openedMeta: null,
			openedEtag: null,
			eventTypes: [],
		},
	},
});
