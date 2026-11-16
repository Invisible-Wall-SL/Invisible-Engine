import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent, request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { isPrivateComfyHost } from './comfyRegister';

/**
 * A download from a public https URL that can never reach a private address — Railway's internal
 * network included — even under DNS rebinding: the address is checked inside the socket's own
 * `lookup`, so the address checked IS the address connected to, on every redirect hop.
 */

type Resolve = (
	hostname: string,
	callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolve: Resolve = (hostname, callback) => dnsLookup(hostname, { all: true }, callback);

/** A socket `lookup` that resolves every address and refuses the host if ANY is private. */
export function pinnedLookup(resolve: Resolve = systemResolve): LookupFunction {
	return (hostname, options, callback) => {
		resolve(hostname, (err, addresses) => {
			if (err) return callback(err, '', 0);
			const family = options.family === 4 || options.family === 6 ? options.family : 0;
			const usable = addresses.filter((a) => !family || a.family === family);
			if (!usable.length) {
				return callback(
					Object.assign(new Error(`${hostname} has no address`), { code: 'ENOTFOUND' }),
					'',
					0,
				);
			}
			if (addresses.some((a) => isPrivateComfyHost(a.address))) {
				return callback(new Error(`${hostname} resolves to a private address.`), '', 0);
			}
			if (options.all)
				return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, usable);
			callback(null, usable[0].address, usable[0].family);
		});
	};
}

/** Why `raw` may not be fetched, before any socket opens; null when it may. */
export function publicUrlError(raw: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return 'That is not a valid URL.';
	}
	if (parsed.protocol !== 'https:') return 'Only https:// URLs.';
	if (parsed.username || parsed.password) return 'A URL cannot carry a user name or password.';
	// An IP literal is connected to without a lookup, so it is checked here.
	if (isPrivateComfyHost(parsed.hostname)) return `${parsed.hostname} is a private address.`;
	return null;
}

export interface PublicDownload {
	body: ReadableStream<Uint8Array>;
	contentLength: number | null;
}

export interface DownloadOptions {
	/** How long the server may take to send its response headers. */
	headersMs?: number;
	/** How long a read of the body may wait for its next chunk. */
	idleMs?: number;
	maxRedirects?: number;
	lookup?: LookupFunction;
}

function get(url: string, opts: Required<DownloadOptions>): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const req = request(url, {
			method: 'GET',
			lookup: opts.lookup,
			// Its own agent: a pooled socket from the global one would skip this lookup.
			agent: new Agent({ lookup: opts.lookup, keepAlive: false }),
			headers: { 'user-agent': 'InvisibleLauncher/1.0' },
		});
		// Headers only: a deadline cleared once they arrive, so a multi-GB body is not cut off.
		const deadline = setTimeout(
			() => req.destroy(new Error('The download did not answer in time.')),
			opts.headersMs,
		);
		req.once('response', (res) => {
			clearTimeout(deadline);
			resolve(res);
		});
		req.once('error', (e) => {
			clearTimeout(deadline);
			reject(e);
		});
		req.end();
	});
}

/**
 * `source`, erroring when a read waits more than `idleMs` for its next chunk. Timed per read and
 * only while the consumer is waiting, so a slow consumer (a 64 MB part going up) is not a stall.
 */
export function withIdleTimeout(
	source: ReadableStream<Uint8Array>,
	idleMs: number,
): ReadableStream<Uint8Array> {
	const reader = source.getReader();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const stalled = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('The download stalled — no data for too long.')),
					idleMs,
				);
			});
			try {
				const { done, value } = await Promise.race([reader.read(), stalled]);
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (e) {
				await reader.cancel(e).catch(() => {});
				controller.error(e);
			} finally {
				clearTimeout(timer);
			}
		},
		cancel: (reason) => reader.cancel(reason),
	});
}

/** Open a public https download, following redirects, each hop checked the same way. */
export async function openPublicDownload(
	raw: string,
	options: DownloadOptions = {},
): Promise<PublicDownload> {
	const opts: Required<DownloadOptions> = {
		headersMs: options.headersMs ?? 60_000,
		idleMs: options.idleMs ?? 120_000,
		maxRedirects: options.maxRedirects ?? 5,
		lookup: options.lookup ?? pinnedLookup(),
	};
	let url = raw;
	for (let hop = 0; hop <= opts.maxRedirects; hop++) {
		const bad = publicUrlError(url);
		if (bad) throw new Error(bad);
		const res = await get(url, opts);
		const status = res.statusCode ?? 0;
		const location = res.headers.location;
		if (status >= 300 && status < 400 && location) {
			res.destroy();
			url = new URL(location, url).toString();
			continue;
		}
		if (status < 200 || status >= 300) {
			res.destroy();
			throw new Error(`The download answered HTTP ${status}.`);
		}
		const len = Number(res.headers['content-length']);
		return {
			body: withIdleTimeout(Readable.toWeb(res) as ReadableStream<Uint8Array>, opts.idleMs),
			contentLength: Number.isFinite(len) && len > 0 ? len : null,
		};
	}
	throw new Error('The download redirected too many times.');
}
