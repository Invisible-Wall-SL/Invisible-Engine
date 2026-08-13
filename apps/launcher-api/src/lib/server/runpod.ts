import { ENV } from './env';

/**
 * RunPod on-demand pod lifecycle for the ComfyUI R&D pod (`COMFY_RND_URL`).
 *
 * Ported from `services/atlas-tool/runpod_control.py` (the proven-working GraphQL
 * calls): RESUME the pod before use, STOP it when idle, so the GPU only bills while
 * work is happening. Everything here is FAIL-SAFE — any API/network error degrades to
 * `'unknown'`/`{ ok: false }` and never throws, so a control path can always render a
 * sane state instead of crashing the request.
 *
 * When `RUNPOD_API_KEY` + `RUNPOD_POD_ID` are unset (`podControlConfigured()` false)
 * every mutation is a no-op and the /comfyui card falls back to a plain "open the URL"
 * landing. Stdlib `fetch` only; RunPod GraphQL at https://api.runpod.io/graphql.
 */

const GQL_ENDPOINT = 'https://api.runpod.io/graphql';
const UA = 'InvisibleLauncher/1.0';

export type PodStatus = 'running' | 'stopped' | 'starting' | 'unknown';

/** Both control secrets present — the only state in which any mutation runs. */
export function podControlConfigured(): boolean {
	return !!(ENV.RUNPOD_API_KEY && ENV.RUNPOD_POD_ID);
}

interface GqlResult {
	data?: unknown;
	errors?: { message?: string }[];
}

/**
 * POST a GraphQL query to RunPod. Auth is the `?api_key=` query param — the exact,
 * proven-working shape from `runpod_control.py` (RunPod also accepts an
 * `Authorization: Bearer` header, but this is what's confirmed against our pod).
 * Returns the parsed JSON, or `null` on any transport/parse error (caller treats
 * `null` as "unknown / proceed"). `timeoutMs` bounds the call so a hung API can't
 * stall a request.
 */
async function gql(query: string, timeoutMs = 15000): Promise<GqlResult | null> {
	const key = ENV.RUNPOD_API_KEY;
	if (!key) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${GQL_ENDPOINT}?api_key=${encodeURIComponent(key)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': UA },
			body: JSON.stringify({ query }),
			signal: controller.signal,
		});
		if (!res.ok) return null;
		return (await res.json()) as GqlResult;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** First GraphQL error message, if any (used to surface GPU-unavailable to the UI). */
function firstError(result: GqlResult | null): string | undefined {
	const msg = result?.errors?.find((e) => e.message)?.message;
	return msg?.trim() || undefined;
}

/**
 * The pod's coarse lifecycle state, derived from RunPod's `desiredStatus` + whether a
 * runtime exists yet:
 * - `desiredStatus === 'RUNNING'` with a live runtime → `'running'`
 * - `desiredStatus === 'RUNNING'` but no runtime yet → `'starting'` (resuming/booting)
 * - any other desired status (e.g. `'EXITED'`) → `'stopped'`
 * - API/network error or unconfigured → `'unknown'`
 */
export async function podStatus(): Promise<PodStatus> {
	if (!podControlConfigured()) return 'unknown';
	const podId = ENV.RUNPOD_POD_ID;
	const result = await gql(
		`query { pod(input:{podId:"${podId}"}) { desiredStatus runtime { uptimeInSeconds } } }`,
	);
	if (!result) return 'unknown';
	const data = result.data as
		| { pod?: { desiredStatus?: string; runtime?: { uptimeInSeconds?: number } | null } }
		| undefined;
	const pod = data?.pod;
	if (!pod || typeof pod.desiredStatus !== 'string') return 'unknown';
	if (pod.desiredStatus === 'RUNNING') return pod.runtime ? 'running' : 'starting';
	return 'stopped';
}

/**
 * RESUME the pod (`podResume(input:{podId, gpuCount:1})`). On success returns
 * `{ ok: true }`. If RunPod reports no GPU availability (the resume returns an error
 * rather than a pod), returns `{ ok: false, error }` with a readable message so the
 * card can show "GPU unavailable, retry". Never throws.
 */
export async function podResume(): Promise<{ ok: boolean; error?: string }> {
	if (!podControlConfigured()) return { ok: false, error: 'Pod control is not configured.' };
	const podId = ENV.RUNPOD_POD_ID;
	const result = await gql(
		`mutation { podResume(input:{podId:"${podId}", gpuCount:1}) { id desiredStatus } }`,
	);
	if (!result) return { ok: false, error: 'RunPod did not respond — try again.' };
	const err = firstError(result);
	if (err) return { ok: false, error: err };
	const data = result.data as { podResume?: { id?: string } | null } | undefined;
	if (!data?.podResume?.id) {
		return { ok: false, error: 'RunPod could not start the pod (no GPU available?) — retry.' };
	}
	return { ok: true };
}

/** STOP the pod (`podStop(input:{podId})`). Fire-and-forget; never throws. */
export async function podStop(): Promise<void> {
	if (!podControlConfigured()) return;
	const podId = ENV.RUNPOD_POD_ID;
	await gql(`mutation { podStop(input:{podId:"${podId}"}) { id desiredStatus } }`);
}

/** True if ComfyUI answers `/system_stats` at `COMFY_RND_URL` (any 200 = ready). */
export async function comfyReady(): Promise<boolean> {
	const base = ENV.COMFY_RND_URL.replace(/\/$/, '');
	if (!base) return false;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 6000);
	try {
		const res = await fetch(`${base}/system_stats`, {
			headers: { 'user-agent': UA },
			signal: controller.signal,
		});
		return res.status === 200;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * True if ComfyUI has a non-empty queue at `COMFY_RND_URL/queue` (a render is running
 * or pending). Used by the idle watchdog to treat an active queue as activity so it
 * never stops the pod mid-render. Any error → `false` (fail-safe: don't fabricate
 * activity, but the watchdog also honours the last-activity heartbeat).
 */
export async function comfyQueueBusy(): Promise<boolean> {
	const base = ENV.COMFY_RND_URL.replace(/\/$/, '');
	if (!base) return false;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 6000);
	try {
		const res = await fetch(`${base}/queue`, {
			headers: { 'user-agent': UA },
			signal: controller.signal,
		});
		if (!res.ok) return false;
		const data = (await res.json()) as {
			queue_running?: unknown[];
			queue_pending?: unknown[];
		};
		const running = Array.isArray(data.queue_running) ? data.queue_running.length : 0;
		const pending = Array.isArray(data.queue_pending) ? data.queue_pending.length : 0;
		return running + pending > 0;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}
