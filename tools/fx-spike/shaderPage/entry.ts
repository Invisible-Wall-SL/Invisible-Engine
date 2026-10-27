/**
 * The `/shaders` page as `shaderPage.mjs` plays it: the real `+page.svelte` (its canvas, settings and
 * preview) mounted outside SvelteKit, with `$app/*` stubbed (`fxPage/app*.ts`) and every request it
 * makes answered here, in memory:
 *  - `POST /api/shaders/save`, `GET /api/shaders/doc` / `list`: the graph normalized as
 *    `saveShader` stores it (`normalizeShaderGraphDoc`) and read back through JSON, as R2 holds it;
 *  - `GET /api/editor/regions` / `asset`: one atlas page, a white square;
 *  - `/api/lease` (held).
 *
 * The page opens on "Pulse", the reference pulse tint with a glow pass and a scale curve, beside
 * "Frost". `?gl=1` refuses WebGL2, so the preview draws on WebGL1. Thumbnails are off (they are
 * element-based and have their own gates). Every WebGL context keeps its drawing buffer, so the
 * driver can read the preview's pixels. The page exposes `window.shaderPage`: the requests and saves.
 */
import { mount } from 'svelte';
import {
	REFERENCE_GRAPHS,
	normalizeShaderGraphDoc,
	type ShaderGraphDoc,
} from '@fxroot/packages/engine-shadergraph/index';
import { TOOLS } from '@fxroot/apps/launcher-api/src/lib/roles';
import DialogHost from '@fxroot/apps/launcher-api/src/lib/DialogHost.svelte';
import Page from '@fxroot/apps/launcher-api/src/routes/(app)/shaders/+page.svelte';

const gl = new URLSearchParams(location.search).get('gl');
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
	this: HTMLCanvasElement,
	kind: string,
	options?: Record<string, unknown>,
) {
	if (gl === '1' && kind === 'webgl2') return null;
	const keep = kind.startsWith('webgl') ? { ...options, preserveDrawingBuffer: true } : options;
	return getContext.call(this, kind, keep);
} as typeof HTMLCanvasElement.prototype.getContext;

localStorage.setItem('shaders.thumbnails', 'off');

const ATLAS = 'client/project/manifests/atlas_manifest_sparks.json';
const REGIONS = [{ name: 'square', x: 0, y: 0, w: 40, h: 40 }];

const reference = (id: string): ShaderGraphDoc =>
	JSON.parse(JSON.stringify(REFERENCE_GRAPHS.find((d) => d.id === id))) as ShaderGraphDoc;

const pulse: ShaderGraphDoc = {
	...reference('pulseTint'),
	id: 'pulse',
	name: 'Pulse',
	passes: [{ kind: 'glow' }],
	motion: {
		channels: {
			scale: [
				{ t: 0, v: 1, ease: 'smooth' },
				{ t: 1, v: 1.1, ease: 'smooth' },
			],
		},
	},
};
const frost: ShaderGraphDoc = { ...reference('frost'), id: 'frost', name: 'Frost' };

interface Stored {
	text: string;
	etag: string;
}
const store = new Map<string, Stored>();
let etags = 0;
const put = (doc: ShaderGraphDoc): Stored => {
	const stored = {
		text: JSON.stringify(normalizeShaderGraphDoc(doc, doc.id)),
		etag: `"e${++etags}"`,
	};
	store.set(doc.id, stored);
	return stored;
};
put(pulse);
put(frost);

const rows = () =>
	[...store.values()]
		.map((s) => JSON.parse(s.text) as ShaderGraphDoc)
		.map((d) => ({ id: d.id, name: d.name, description: d.description ?? '', shared: false }))
		.sort((a, b) => a.name.localeCompare(b.name));

const requests: string[] = [];
const saved: ShaderGraphDoc[] = [];

async function pageImage(): Promise<Blob> {
	const canvas = new OffscreenCanvas(64, 64);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, 40, 40);
	return canvas.convertToBlob({ type: 'image/png' });
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = new URL(typeof input === 'string' ? input : String(input), location.href);
	const method = init?.method ?? 'GET';
	if (url.protocol === 'file:' && !url.pathname.startsWith('/api')) return realFetch(input, init);
	requests.push(`${method} ${url.pathname}${url.search}`);
	switch (url.pathname) {
		case '/api/lease':
			return json({ held: true, heartbeatMs: 600_000 });
		case '/api/shaders/list':
			return json({ ok: true, shaders: rows() });
		case '/api/shaders/doc': {
			const hit = store.get(url.searchParams.get('id') ?? '');
			if (!hit) return json({ ok: true, doc: null, exists: false });
			return json({ ok: true, doc: JSON.parse(hit.text), etag: hit.etag, exists: true });
		}
		case '/api/shaders/save': {
			const body = JSON.parse(String(init?.body)) as { doc: ShaderGraphDoc; baseEtag?: string };
			const prior = store.get(body.doc.id);
			if (prior && body.baseEtag !== undefined && body.baseEtag !== prior.etag)
				return json({ ok: false, error: 'conflict', message: 'stale' }, 409);
			const stored = put(body.doc);
			saved.push(JSON.parse(stored.text) as ShaderGraphDoc);
			return json({ ok: true, id: body.doc.id, name: body.doc.name, etag: stored.etag });
		}
		case '/api/editor/regions':
			return json({ pageKey: 'page.png', pageWidth: 64, pageHeight: 64, regions: REGIONS });
		case '/api/editor/asset':
			return new Response(await pageImage(), { headers: { 'content-type': 'image/png' } });
	}
	return json({ message: `shaderPage: nothing answers ${method} ${url.pathname}` }, 404);
};

Object.assign(window, { shaderPage: { requests, saved } });

mount(DialogHost, { target: document.body });
mount(Page, {
	target: document.body,
	props: {
		data: {
			clientKey: 'client',
			projectKey: 'project',
			tools: [TOOLS.shaders, TOOLS.fx],
			shaders: rows(),
			atlases: [{ manifestKey: ATLAS, label: 'sparks', regions: REGIONS.map((r) => r.name) }],
			opened: {
				doc: JSON.parse(store.get('pulse')!.text),
				etag: store.get('pulse')!.etag,
				shared: false,
			},
			missing: null,
			canPublishShared: false,
			canCustomGlsl: false,
		},
	},
});
