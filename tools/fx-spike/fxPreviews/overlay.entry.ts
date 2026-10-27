/**
 * The Rigger / Symbols FX overlay (`fxOverlay.client.ts`) as the Rigger runs it: the COMMITTED
 * `static/rigger/vendor/rigger-fx.js`, loaded after this script by `fxPreviews.mjs`, driven through
 * its globals exactly as `view.html` drives them (`RiggerFxLoadShaderEffects`, `RiggerFxCreate`,
 * `play` / `stop`). Each case plays an effect, lets it run, and counts the overlay's pixels.
 */
import { census, debugLines, served, sleep, type ShaderAnswer } from './shared';

interface Overlay {
	init(host: HTMLElement): Promise<void>;
	play(id: string, t: object, opts?: object): number;
	stop(handle: number): void;
	destroy(): void;
}
const page = window as unknown as {
	RiggerFxCreate?: () => Overlay;
	RiggerFxLoadShaderEffects?: () => Promise<boolean>;
	result?: unknown;
	ready?: boolean;
};

const AT = { x: 200, y: 150, a: 1, b: 0, c: 0, d: 1 };
const RUN_MS = 900;

async function overlay(): Promise<{ api: Overlay; canvas: HTMLCanvasElement }> {
	const host = document.createElement('div');
	host.style.cssText = 'position:relative;width:400px;height:300px';
	document.body.appendChild(host);
	const api = page.RiggerFxCreate!();
	await api.init(host);
	return { api, canvas: host.querySelector('canvas') as HTMLCanvasElement };
}

async function playOnce(id: string, opts?: object) {
	const { api, canvas } = await overlay();
	const since = debugLines.length;
	const handle = api.play(id, AT, { continuous: true, ...opts });
	await sleep(RUN_MS);
	const pixels = census(canvas);
	api.stop(handle);
	await sleep(50);
	const lines = debugLines.slice(since);
	api.destroy();
	return { pixels, lines };
}

async function load(answer: ShaderAnswer): Promise<boolean> {
	served.shaders = answer;
	return page.RiggerFxLoadShaderEffects!();
}

async function main() {
	while (!page.RiggerFxCreate) await sleep(20);
	const result: Record<string, unknown> = {};
	result.bundleHasLoader = typeof page.RiggerFxLoadShaderEffects === 'function';
	result.fetchError = { loaded: await load('error'), ...(await playOnce('solid')) };
	result.fetchThrow = { loaded: await load('throw'), ...(await playOnce('solid')) };
	result.registered = { loaded: await load('ok'), ...(await playOnce('solid')) };
	result.param = await playOnce('solid', { params: { hue: '#0000ff' } });
	result.unknownKind = await playOnce('gone');
	result.noMaterial = await playOnce('plain');
	const { api, canvas } = await overlay();
	const since = debugLines.length;
	const handles = Array.from({ length: 9 }, () => api.play('solid', AT, { continuous: true }));
	await sleep(RUN_MS);
	const pixels = census(canvas);
	for (const h of handles) api.stop(h);
	await sleep(50);
	result.cap = { pixels, lines: debugLines.slice(since) };
	api.destroy();
	result.requests = served.requests.filter((r) => r.includes('/api/shaders/'));
	page.result = result;
	page.ready = true;
}

main().catch((error) => {
	console.error(`[uncaught] ${error instanceof Error ? error.stack : error}`);
	page.ready = true;
});
