/**
 * The wire of a `?perf=1` reading to the Invisible Profiler, with no import of the game — so
 * `perfSend.fixture.ts` runs it in Node. `perfSend.ts` gives it the launcher base and the session
 * token from the URL.
 *
 * The reading is posted with the token in a header. A reading too large for the launcher's request
 * body goes by a presigned PUT to R2, then is registered. When that upload cannot go (R2 refusing
 * the games origin's PUT is one way), the caller's `fallback` — the same reading without its
 * per-texture list and spike records — is posted inline instead, so the reading is kept, only
 * shorter. The wire is the launcher's (`apps/launcher-api/src/routes/api/profiler/reports/
 * +server.ts`); the header name and the inline limit below are its `PERF_SESSION_HEADER` and
 * `PERF_INLINE_MAX_BYTES`.
 */
const SESSION_HEADER = 'X-IW-Perf-Session';
export const INLINE_MAX_BYTES = 480 * 1024;
/** What a `keepalive` request may carry; a page being hidden may be frozen before a plain fetch ends. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export type SendOutcome = { ok: true; trimmed?: boolean } | { ok: false; error: string };

export interface PerfSender {
	send(text: string, opts?: { leaving?: boolean; fallback?: string }): Promise<SendOutcome>;
}

/**
 * Why the launcher refused, in words a tester can act on: its own message when it gave one (an
 * expired session, a deleted project), else what the bare status means.
 */
async function failure(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	if (body?.message) return body.message;
	const what =
		res.status >= 500
			? ' — the launcher is restarting or down; tap Send again in a minute'
			: res.status === 404
				? ' — this launcher has no Profiler to take it'
				: '';
	return `the launcher answered HTTP ${res.status}${what}`;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function perfSenderTo(
	base: string,
	token: string,
	fetchFn: typeof fetch = fetch,
): PerfSender {
	const root = base.replace(/\/+$/, '');
	const host = hostOf(root);
	/** A request that got no answer: offline, or a network that blocks the launcher. */
	const unreachable = (e: unknown) =>
		`could not reach ${host} (${reason(e)}) — check the phone is online and its network allows ${host}`;
	const headers = { 'content-type': 'application/json', [SESSION_HEADER]: token };
	const post = (path: string, body: string, keepalive = false) =>
		fetchFn(`${root}/api/profiler/${path}`, { method: 'POST', headers, body, keepalive });

	/** Presigned PUT, then register. A failure at any step is returned, never thrown. */
	const upload = async (
		text: string,
	): Promise<{ ok: true; res: Response } | { ok: false; error: string }> => {
		try {
			const presign = await post('uploads', '{}');
			if (!presign.ok) return { ok: false, error: await failure(presign) };
			const up = (await presign.json()) as { id: string; url: string; contentType: string };
			const put = await fetchFn(up.url, {
				method: 'PUT',
				headers: { 'content-type': up.contentType },
				body: text,
			});
			if (!put.ok) return { ok: false, error: `the storage upload answered HTTP ${put.status}` };
			return { ok: true, res: await post('reports', JSON.stringify({ upload: up.id })) };
		} catch (e) {
			// A PUT the browser blocks (CORS) rejects rather than answering.
			return { ok: false, error: `the storage upload was blocked (${reason(e)})` };
		}
	};

	return {
		async send(text, opts) {
			try {
				const bytes = new Blob([text]).size;
				let res: Response;
				if (bytes <= INLINE_MAX_BYTES) {
					res = await post('reports', text, !!opts?.leaving && bytes <= KEEPALIVE_MAX_BYTES);
				} else {
					const uploaded = await upload(text);
					if (!uploaded.ok) {
						const fallback = opts?.fallback;
						if (!fallback || new Blob([fallback]).size > INLINE_MAX_BYTES) return uploaded;
						const short = await post('reports', fallback);
						return short.ok
							? { ok: true, trimmed: true }
							: { ok: false, error: await failure(short) };
					}
					res = uploaded.res;
				}
				return res.ok ? { ok: true } : { ok: false, error: await failure(res) };
			} catch (e) {
				return { ok: false, error: unreachable(e) };
			}
		},
	};
}
