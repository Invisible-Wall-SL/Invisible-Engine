import { loadKTX2, setKTXTranscoderPath } from 'pixi.js';

export type Ktx2TranscoderUrls = { jsUrl: string; wasmUrl: string };

const FETCH_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;

/**
 * Point Pixi's KTX2 loader at the engine's self-hosted transcoder, fetched and checked on the
 * FIRST `.ktx2` load rather than at boot.
 *
 * WHY LAZILY. Only the compressed tier (`preferCompressedTextures` in `apps/lines`) loads a
 * `.ktx2`, so a desktop never downloads the ~520 KB gz transcoder at all. Pixi likewise creates its
 * worker only on the first `.ktx2` load.
 *
 * WHY FETCHED HERE, NOT HANDED TO PIXI AS URLS. Pixi's worker resolves the urls against
 * `location.origin` (not the page), and its failure modes are silent: a transcoder script that
 * 404s throws an uncaught `TypeError` in Pixi's message handler, and a wasm that cannot be fetched
 * leaves Pixi's `LIBKTX(...).then` pending forever, so every `.ktx2` load HANGS instead of
 * rejecting — no fallback could ever run. Fetching both files here, refusing an HTML error page or
 * an invalid module, and handing the worker same-origin `blob:` urls of the checked bytes turns
 * every one of those into a prompt rejection of the load, which `AssetsLoader` answers by loading
 * the entry's WebP/PNG twin (`Asset.fallback`). Each fetch gives up after
 * {@link FETCH_TIMEOUT_MS}, so a stalled request cannot hold the loading screen. A failed check is
 * retried once, after {@link RETRY_DELAY_MS}, so one network blip does not put a low-memory phone on
 * uncompressed pages for the session; a second failure is remembered, and the rest of the `.ktx2`
 * loads fail at once rather than refetching. Both attempts run inside the one promise every
 * concurrent load awaits, which is what lets the retry help the boot's own loads. A `data:` url (a
 * build that still inlines the files) is fetched the same way.
 */
let installed = false;

export function installKtx2Transcoder(urls: Ktx2TranscoderUrls): void {
	if (installed) return;
	installed = true;
	const load = loadKTX2.load.bind(loadKTX2);
	let ready: Promise<void> | undefined;
	loadKTX2.load = async (...args) => {
		ready ??= prepareTranscoder(urls).catch(async () => {
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
			return prepareTranscoder(urls);
		});
		await ready;
		return load(...args);
	};
}

async function prepareTranscoder({ jsUrl, wasmUrl }: Ktx2TranscoderUrls): Promise<void> {
	const [js, wasm] = await Promise.all([fetchBytes(jsUrl), fetchBytes(wasmUrl)]);
	if (!WebAssembly.validate(wasm)) {
		throw new Error(`KTX2 transcoder: ${wasmUrl} is not a WebAssembly module`);
	}
	if (/^\s*</.test(new TextDecoder().decode(new Uint8Array(js, 0, Math.min(64, js.byteLength))))) {
		throw new Error(`KTX2 transcoder: ${jsUrl} answered with markup, not the transcoder script`);
	}
	setKTXTranscoderPath({
		jsUrl: URL.createObjectURL(new Blob([js], { type: 'text/javascript' })),
		wasmUrl: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
	});
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`KTX2 transcoder: ${url} answered ${response.status}`);
	return response.arrayBuffer();
}

let fellBack = false;

/**
 * Say ONCE per session that compressed textures were replaced by their uncompressed twins. One
 * broken transcoder fails every `.ktx2` on the board, and a line per texture would bury the
 * reason. It is a `console.warn`, so an active Sentry client records it as a breadcrumb.
 */
export function noteKtx2Fallback(key: string, error: unknown): void {
	if (fellBack) return;
	fellBack = true;
	const reason = error instanceof Error ? error.message : String(error);
	console.warn(
		`[ktx2] '${key}' failed to load compressed (${reason}); loading its WebP/PNG twin instead. ` +
			`Later fallbacks this session are not logged.`,
	);
}
