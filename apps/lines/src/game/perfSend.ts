import { DEFAULT_DOC_BASE } from '../editor-scenes';

/**
 * Sends a `?perf=1` reading to the Invisible Profiler (`docs/design/invisible-profiler.md` §1).
 * `PerfHud.svelte` imports this module only when the URL carries `&perfsession=<token>` — a capture
 * session the Profiler opened — so a player never downloads it and a `?perf=1` read without a
 * session never makes a request.
 *
 * The reading goes to the launcher the game already boots from (`?editorDocBase=`, else the
 * studio's), with the token in a header. A reading too large for the launcher's request body goes
 * by a presigned PUT to R2, then is registered. The wire is the launcher's
 * (`apps/launcher-api/src/routes/api/profiler/reports/+server.ts`); the header name and the inline
 * limit below are its `PERF_SESSION_HEADER` and `PERF_INLINE_MAX_BYTES`.
 */
const SESSION_HEADER = 'X-IW-Perf-Session';
const INLINE_MAX_BYTES = 480 * 1024;
/** What a `keepalive` request may carry; a page being hidden may be frozen before a plain fetch ends. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export type SendOutcome = { ok: true } | { ok: false; error: string };

export interface PerfSender {
	send(text: string, opts?: { leaving?: boolean }): Promise<SendOutcome>;
}

async function failure(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? `HTTP ${res.status}`;
}

export function createPerfSender(query: URLSearchParams): PerfSender | undefined {
	const token = query.get('perfsession');
	if (!token) return undefined;
	const base = (query.get('editorDocBase') || DEFAULT_DOC_BASE).replace(/\/+$/, '');
	const headers = { 'content-type': 'application/json', [SESSION_HEADER]: token };
	const post = (path: string, body: string, keepalive = false) =>
		fetch(`${base}/api/profiler/${path}`, { method: 'POST', headers, body, keepalive });

	return {
		async send(text, opts) {
			try {
				const bytes = new Blob([text]).size;
				let res: Response;
				if (bytes <= INLINE_MAX_BYTES) {
					res = await post('reports', text, !!opts?.leaving && bytes <= KEEPALIVE_MAX_BYTES);
				} else {
					const presign = await post('uploads', '{}');
					if (!presign.ok) return { ok: false, error: await failure(presign) };
					const up = (await presign.json()) as { id: string; url: string; contentType: string };
					const put = await fetch(up.url, {
						method: 'PUT',
						headers: { 'content-type': up.contentType },
						body: text,
					});
					if (!put.ok) return { ok: false, error: `upload HTTP ${put.status}` };
					res = await post('reports', JSON.stringify({ upload: up.id }));
				}
				return res.ok ? { ok: true } : { ok: false, error: await failure(res) };
			} catch (e) {
				return { ok: false, error: e instanceof Error ? e.message : String(e) };
			}
		},
	};
}
