/**
 * Run a model derive OFF the event loop (asset review #4): `deriveModelTier`'s KTX2 encodes are
 * synchronous wasm, seconds per texture, and on the main thread they froze every request the
 * launcher serves. Derives go to ONE worker thread (`modelDeriveWorker.ts`), one at a time (each
 * holds hundreds of MB at its peak), in arrival order.
 *
 * The worker is a separate bundle (`build/model-derive-worker.mjs`, built by the launcher's
 * `build`); `scripts/start.mjs` points `MODEL_DERIVE_WORKER` at it. Without it — `vite dev`, a
 * `tsx` script, a gate that does not build it — the derive runs in-process, as before.
 */
import type { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { ENV } from './env';
import { deriveModelTier, type DerivedModelTier, type ModelDeriveOptions } from './modelOptimize';
import type { DeriveMessage, DeriveRequest } from './modelDeriveWorker';

let worker: Worker | null = null;

/** Longest a derive may run before its worker is stopped: far above a real one (seconds per
 *  texture), below where a stuck one would hold the assemble slots (`runtimeBundleCache.ts`). */
export const MODEL_DERIVE_TIMEOUT_MS = 120_000;
/** The worker's own heap ceiling, so a runaway derive dies alone rather than the launcher. */
const WORKER_HEAP_MB = 2048;

/** `Worker` IS an EventEmitter; `@types/node` 26 declares its events through an internal generic
 *  this tsconfig does not resolve, so reach them through the plain emitter type. */
const events = (w: Worker) => w as unknown as EventEmitter;
let queue: Promise<unknown> = Promise.resolve();

function workerAt(path: string): Worker {
	if (worker) return worker;
	const w = new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
	// An idle worker must not keep the process (or a gate) alive.
	w.unref();
	events(w).on('exit', () => {
		if (worker === w) worker = null;
	});
	worker = w;
	return w;
}

function deriveInWorker(
	path: string,
	master: Uint8Array,
	opts: ModelDeriveOptions,
): Promise<DerivedModelTier> {
	return new Promise((resolve, reject) => {
		const w = workerAt(path);
		const { cache, ...rest } = opts;
		const timer = setTimeout(() => {
			done();
			worker = null;
			void w.terminate();
			reject(new Error(`the derive did not finish in ${MODEL_DERIVE_TIMEOUT_MS / 1000} s`));
		}, timeoutMs());
		const done = () => {
			clearTimeout(timer);
			events(w).off('message', onMessage);
			events(w).off('error', onError);
			events(w).off('exit', onExit);
		};
		const onError = (e: Error) => {
			done();
			worker = null;
			void w.terminate();
			reject(e);
		};
		const onExit = (code: number) => {
			done();
			reject(new Error(`the model derive worker exited (code ${code})`));
		};
		const onMessage = (msg: DeriveMessage) => {
			if (msg.type === 'cache-get' || msg.type === 'cache-put') {
				const answer =
					msg.type === 'cache-get'
						? (cache?.get(msg.key) ?? Promise.resolve(null))
						: (cache?.put(msg.key, msg.bytes) ?? Promise.resolve()).then(() => null);
				answer.then(
					(bytes) =>
						w.postMessage({
							type: 'cache-reply',
							reqId: msg.reqId,
							bytes: bytes ?? null,
						} satisfies DeriveRequest),
					// A cache that cannot answer is a miss (get) or a lost write (put): never fatal.
					() =>
						w.postMessage({
							type: 'cache-reply',
							reqId: msg.reqId,
							bytes: null,
						} satisfies DeriveRequest),
				);
				return;
			}
			done();
			if (msg.type === 'done') resolve(msg.result);
			else reject(new Error(msg.message));
		};
		w.ref();
		events(w).on('message', onMessage);
		events(w).on('error', onError);
		events(w).on('exit', onExit);
		w.postMessage({ type: 'derive', master, opts: rest, cached: !!cache } satisfies DeriveRequest);
	}).finally(() => worker?.unref()) as Promise<DerivedModelTier>;
}

let fingerprint: { path: string; hash: string } | null = null;

/**
 * A hash of the derive code that will run: the built worker bundle's bytes. The derived-tier cache
 * keys on it, so a launcher deploy that changes what a derive produces never serves tiers an older
 * build derived, without anyone having to remember a revision bump. `''` without a worker.
 */
export function deriveCodeFingerprint(): string {
	const path = ENV.MODEL_DERIVE_WORKER;
	if (!path || !existsSync(path)) return '';
	if (fingerprint?.path !== path)
		fingerprint = {
			path,
			hash: createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16),
		};
	return fingerprint.hash;
}

/** The timeout in force (a gate shortens it through `MODEL_DERIVE_TIMEOUT_MS`). */
const timeoutMs = () => ENV.MODEL_DERIVE_TIMEOUT_MS || MODEL_DERIVE_TIMEOUT_MS;

/** `deriveModelTier`, on the worker thread when the launcher has one built. */
export function deriveModelTierOffThread(
	master: Uint8Array,
	opts: ModelDeriveOptions,
): Promise<DerivedModelTier> {
	const path = ENV.MODEL_DERIVE_WORKER;
	if (!path || !existsSync(path)) return deriveModelTier(master, opts);
	const run = queue.then(() => deriveInWorker(path, master, opts));
	queue = run.catch(() => undefined);
	return run;
}
