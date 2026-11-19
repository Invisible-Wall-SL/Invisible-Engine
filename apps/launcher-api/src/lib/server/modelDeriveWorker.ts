/**
 * The model derive's worker thread (`modelDeriveRunner.ts`): runs `deriveModelTier` off the
 * launcher's event loop. Its KTX2 encode is synchronous wasm that holds a thread for seconds per
 * texture (`ktx2Encode.ts`), and on the main thread that froze every request the launcher serves.
 *
 * Built on its own (`vite.model-worker.config.ts` → `build/model-derive-worker.mjs`, npm packages
 * external) because the SvelteKit server build emits no worker entry. One derive at a time; the
 * texture cache lives on the main thread (R2), so the worker asks for it by message.
 */
import { parentPort } from 'node:worker_threads';
import { deriveModelTier, type ModelDeriveOptions, type ModelTextureCache } from './modelOptimize';

/** main → worker */
export type DeriveRequest =
	| { type: 'derive'; master: Uint8Array; opts: Omit<ModelDeriveOptions, 'cache'>; cached: boolean }
	| { type: 'cache-reply'; reqId: number; bytes: Uint8Array | null };

/** worker → main */
export type DeriveMessage =
	| { type: 'cache-get'; reqId: number; key: string }
	| { type: 'cache-put'; reqId: number; key: string; bytes: Uint8Array }
	| { type: 'done'; result: Awaited<ReturnType<typeof deriveModelTier>> }
	| { type: 'error'; message: string };

const port = parentPort;
if (port) {
	const waiting = new Map<number, (bytes: Uint8Array | null) => void>();
	let seq = 0;
	const ask = (
		msg: { type: 'cache-get'; key: string } | { type: 'cache-put'; key: string; bytes: Uint8Array },
	) =>
		new Promise<Uint8Array | null>((resolve) => {
			const reqId = ++seq;
			waiting.set(reqId, resolve);
			port.postMessage({ ...msg, reqId } satisfies DeriveMessage);
		});
	const cache: ModelTextureCache = {
		get: (key) => ask({ type: 'cache-get', key }),
		put: async (key, bytes) => {
			await ask({ type: 'cache-put', key, bytes });
		},
	};
	port.on('message', (msg: DeriveRequest) => {
		if (msg.type === 'cache-reply') {
			waiting.get(msg.reqId)?.(msg.bytes);
			waiting.delete(msg.reqId);
			return;
		}
		deriveModelTier(msg.master, { ...msg.opts, ...(msg.cached ? { cache } : {}) }).then(
			// Copied, not transferred: a texture's bytes may sit in Node's shared Buffer pool, and
			// transferring that would detach unrelated buffers. A few MB per tier.
			(result) => port.postMessage({ type: 'done', result } satisfies DeriveMessage),
			(e: unknown) =>
				port.postMessage({
					type: 'error',
					message: e instanceof Error ? e.message : String(e),
				} satisfies DeriveMessage),
		);
	});
}
