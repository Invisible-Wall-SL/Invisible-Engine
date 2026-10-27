/**
 * The Rigger / Symbols FX overlay (`fxOverlay.client.ts`) as the Rigger runs it: the COMMITTED
 * `static/rigger/vendor/rigger-fx.js`, loaded after this script by `fxPreviews.mjs`, driven through
 * its globals exactly as `view.html` drives them (`RiggerFxLoadShaderEffects`, `RiggerFxCreate`,
 * `play` / `stop`). Each case plays an effect, lets it run, and counts the overlay's pixels.
 *
 * `view.html`'s own `ensureFxBundle` (its source handed in by `fxPreviews.mjs` as
 * `window.ensureFxBundleSource`) is run here too, in a fresh closure per case, against the loaded
 * bundle: it must wait for the set before resolving, for every caller, and give up on it in time.
 */
import { SLOW_MS, census, debugLines, served, sleep, type ShaderAnswer } from './shared';

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
	ensureFxBundleSource?: string;
};

/** `view.html`'s `ensureFxBundle`, with its own fresh `fxLoadFailed` / `fxLoading`. */
const viewEnsure = (): (() => Promise<void>) =>
	new Function(
		`let fxLoadFailed = false, fxLoading = null;\n${page.ensureFxBundleSource}\nreturn ensureFxBundle;`,
	)();

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
	served.shaders = 'hang';
	const hangStart = performance.now();
	await viewEnsure()();
	result.hang = { ms: performance.now() - hangStart, ...(await playOnce('solid')) };
	result.fetchError = { loaded: await load('error'), ...(await playOnce('solid')) };
	result.fetchThrow = { loaded: await load('throw'), ...(await playOnce('solid')) };
	served.shaders = 'slow';
	const ensure = viewEnsure();
	const raceStart = performance.now();
	const asked = served.requests.length;
	const resolvedAt: number[] = [];
	await Promise.all(
		[ensure(), ensure()].map((p) => p.then(() => resolvedAt.push(performance.now()))),
	);
	result.race = {
		answeredAfter: served.answeredAt - raceStart,
		resolvedAfter: resolvedAt.map((t) => t - raceStart),
		beforeAnswer: resolvedAt.filter((t) => t < served.answeredAt).length,
		requests: served.requests.slice(asked).filter((r) => r.includes('/api/shaders/')).length,
		slowMs: SLOW_MS,
		...(await playOnce('solid')),
	};
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
	// One-shot bursts never stopped, as the cinematic's cues fire them: each must end by itself.
	{
		const { api, canvas } = await overlay();
		const since = debugLines.length;
		let last = { green: 0, blue: 0, magenta: 0, drawn: 0 };
		for (let i = 0; i < 9; i++) {
			api.play('burst', AT);
			await sleep(120);
			last = census(canvas);
			await sleep(600);
		}
		result.oneShots = { last, lines: debugLines.slice(since) };
		api.destroy();
	}
	result.requests = served.requests.filter((r) => r.includes('/api/shaders/'));
	page.result = result;
	page.ready = true;
}

main().catch((error) => {
	console.error(`[uncaught] ${error instanceof Error ? error.stack : error}`);
	page.ready = true;
});
