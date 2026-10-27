/**
 * What both `fxPreviews` pages share: the compiled material, the effects and the atlas they serve
 * from an in-memory `fetch`, WebGL contexts that keep their drawing buffer (`?gl=1` refuses WebGL2),
 * and a pixel census of a canvas.
 *
 * The material `custom:solid` paints each particle its `color` param (default green) inside the
 * particle's own alpha; the atlas frame is magenta. So green or blue pixels mean the mesh drew, and
 * magenta means the plain sprites did.
 */
import { compileShaderEffect, graphBuilder } from '@fxroot/packages/engine-shadergraph/index';

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

function solid() {
	const g = graphBuilder({
		id: 'solid',
		name: 'Solid',
		phase: 'emphasis',
		durationMs: 1000,
		params: [{ id: 'color', label: 'Colour', kind: 'color', default: '#00ff00' }],
	});
	const split = g.node('unpremultiply');
	const tint = g.node('param', { param: 'color' });
	const join = g.node('premultiply');
	const out = g.node('output');
	g.wire(tint, 'out', join, 'rgb');
	g.wire(split, 'alpha', join, 'alpha');
	g.wire(join, 'out', out, 'color');
	const result = compileShaderEffect(g.doc());
	if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('; '));
	return result.effect;
}

export const SHADER_EFFECTS = [solid()];

const config = {
	lifetime: { min: 2, max: 2 },
	frequency: 0.02,
	emitterLifetime: -1,
	maxParticles: 60,
	addAtBack: false,
	pos: { x: 0, y: 0 },
	behaviors: [
		{
			type: 'spawnShape',
			config: { type: 'rect', data: { x: -70, y: -50, w: 140, h: 100 } },
		},
	],
};

const effect = (id: string, material?: Record<string, unknown>) => ({
	id,
	name: id,
	layers: [
		{
			key: 'main',
			config,
			art: { assetKey: 'atlas', frames: ['sq'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			...(material ? { material } : {}),
		},
	],
	params: [
		{
			id: 'hue',
			kind: 'color',
			default: '#00ff00',
			drives: [{ id: 'h', layer: 'main', path: 'material.param.color' }],
		},
	],
});

/** By id: a material that compiles, one whose graph the set lacks, and none. */
export const EFFECTS: Record<string, unknown> = {
	solid: effect('solid', { kind: 'custom:solid' }),
	gone: effect('gone', { kind: 'custom:nosuch' }),
	plain: effect('plain'),
};

/** How `GET /api/shaders/effects` answers: the set, a 500, or a network failure. */
export type ShaderAnswer = 'ok' | 'error' | 'throw';

export const served = { shaders: 'ok' as ShaderAnswer, requests: [] as string[] };

async function atlasPage(): Promise<Blob> {
	const canvas = new OffscreenCanvas(64, 64);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#ff00ff';
	ctx.fillRect(0, 0, 32, 32);
	return canvas.convertToBlob({ type: 'image/png' });
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = new URL(String(input), 'http://launcher.test');
	served.requests.push(`${init?.credentials ?? '-'} ${url.pathname}${url.search}`);
	if (url.pathname === '/api/shaders/effects') {
		if (served.shaders === 'throw') throw new TypeError('Failed to fetch');
		// An error answer whose body still parses as a set: only `ok` may register it.
		if (served.shaders === 'error') return json({ effects: SHADER_EFFECTS, error: 'nope' }, 500);
		return json({ effects: SHADER_EFFECTS, skipped: [], costs: [] });
	}
	if (url.pathname === '/api/editor/effect') {
		const doc = EFFECTS[url.searchParams.get('id') ?? ''];
		return doc ? json({ doc }) : json({ error: 'missing' }, 404);
	}
	if (url.pathname === '/api/editor/regions')
		return json({
			pageKey: 'page',
			pageWidth: 64,
			pageHeight: 64,
			regions: [{ name: 'sq', x: 0, y: 0, w: 32, h: 32 }],
		});
	if (url.pathname === '/api/editor/asset') return new Response(await atlasPage());
	return json({ error: `unserved ${url.pathname}` }, 404);
};

/** Pixels of `canvas` by colour: the mesh's green / blue, the plain sprites' magenta. */
export function census(canvas: HTMLCanvasElement) {
	const c = document.createElement('canvas');
	c.width = canvas.width;
	c.height = canvas.height;
	const g = c.getContext('2d') as CanvasRenderingContext2D;
	g.drawImage(canvas, 0, 0);
	const d = g.getImageData(0, 0, c.width, c.height).data;
	const out = { green: 0, blue: 0, magenta: 0, drawn: 0 };
	for (let i = 0; i < d.length; i += 4) {
		const [r, gr, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
		if (a < 128) continue;
		out.drawn++;
		if (gr > 150 && r < 90 && b < 90) out.green++;
		else if (b > 150 && r < 90 && gr < 90) out.blue++;
		else if (r > 150 && b > 150 && gr < 90) out.magenta++;
	}
	return out;
}

export const sleep = (ms: number) => new Promise<void>((wake) => setTimeout(wake, ms));

/** `[fxdebug]` lines the material mount logs, kept as they are printed. */
export const debugLines: string[] = [];
const log = console.log;
console.log = (...args: unknown[]) => {
	const line = args.map(String).join(' ');
	if (line.startsWith('[fxdebug]')) debugLines.push(line);
	log(...args);
};
