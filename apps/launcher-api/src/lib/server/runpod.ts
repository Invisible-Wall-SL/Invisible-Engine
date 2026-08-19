import { getRunpodIdleConfig, getRunpodPods } from './appSettings';
import { ENV } from './env';
import { leaseMinutesLeft } from './runpodActivity';

/**
 * RunPod on-demand pod lifecycle for the ComfyUI R&D FLEET.
 *
 * A fleet is a list of RunPod pods (different GPU cards) the artist picks from — a
 * single Blackwell pod is often "not enough free GPUs" on resume, so the artist tries
 * the next card. The calls are ported from `services/atlas-tool/runpod_control.py` (the
 * proven-working GraphQL calls): RESUME a pod before use, STOP it when idle, so the GPU
 * only bills while work is happening. Everything is FAIL-SAFE — any API/network error
 * degrades to `'unknown'`/`{ ok: false }` and never throws.
 *
 * `RUNPOD_API_KEY` is the shared secret for all pods. The effective fleet is the
 * admin-managed `app_settings.runpodPods`, or — for back-compat — a single synthesized
 * entry from the legacy `RUNPOD_POD_ID` env when no fleet is configured. Each pod's
 * ComfyUI URL is DERIVED from its id (`podUrl`); no per-pod URL is stored (the legacy
 * synth prefers `COMFY_RND_URL` if set). Stdlib `fetch` only; RunPod GraphQL at
 * https://api.runpod.io/graphql.
 */

const GQL_ENDPOINT = 'https://api.runpod.io/graphql';
const UA = 'InvisibleLauncher/1.0';

export type PodStatus = 'running' | 'stopped' | 'starting' | 'unknown';

/** A pod in the effective fleet: its id, human label, and derived ComfyUI URL. */
export interface FleetPod {
	id: string;
	label: string;
	url: string;
}

/** A probed pod: fleet entry + its live status and ComfyUI readiness. */
export interface PodState extends FleetPod {
	status: PodStatus;
	ready: boolean;
}

/** The ComfyUI proxy URL for a pod, derived from its RunPod id. */
export function podUrl(id: string): string {
	return `https://${id}-8188.proxy.runpod.net`;
}

/**
 * The effective fleet: the admin-managed `runpodPods` list (URLs derived from id), or —
 * when that's empty — a single legacy entry synthesized from `RUNPOD_POD_ID` (URL
 * prefers `COMFY_RND_URL`, else derived) so an existing single-pod deployment keeps
 * working with zero config change. Empty when neither is configured.
 */
export async function getEffectiveFleet(): Promise<FleetPod[]> {
	const pods = await getRunpodPods();
	if (pods.length) {
		return pods.map((p) => ({ id: p.id, label: p.label, url: podUrl(p.id) }));
	}
	const legacy = ENV.RUNPOD_POD_ID.trim();
	if (legacy) {
		const url = ENV.COMFY_RND_URL.replace(/\/$/, '') || podUrl(legacy);
		return [{ id: legacy, label: 'Default', url }];
	}
	return [];
}

/** Pod control is usable when the shared key is set AND the fleet is non-empty. */
export async function podControlConfigured(): Promise<boolean> {
	if (!ENV.RUNPOD_API_KEY) return false;
	const fleet = await getEffectiveFleet();
	return fleet.length > 0;
}

export interface GqlResult {
	data?: unknown;
	errors?: { message?: string }[];
}

/**
 * POST a GraphQL query to RunPod. Auth is the `?api_key=` query param — the exact,
 * proven-working shape from `runpod_control.py`. Returns the parsed JSON, or `null` on
 * any transport/parse error (caller treats `null` as "unknown / proceed"). `timeoutMs`
 * bounds the call so a hung API can't stall a request.
 *
 * Exported so the Admin → Costs collector (`$lib/server/costs/runpod.ts`) reuses this
 * one authenticated transport instead of re-implementing the key handling and timeout.
 */
export async function gql(query: string, timeoutMs = 15000): Promise<GqlResult | null> {
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
 * A pod's coarse lifecycle state, derived from RunPod's `desiredStatus` + whether a
 * runtime exists yet:
 * - `desiredStatus === 'RUNNING'` with a live runtime → `'running'`
 * - `desiredStatus === 'RUNNING'` but no runtime yet → `'starting'` (resuming/booting)
 * - any other desired status (e.g. `'EXITED'`) → `'stopped'`
 * - API/network error, no key, or empty podId → `'unknown'`
 */
export async function podStatus(podId: string): Promise<PodStatus> {
	if (!ENV.RUNPOD_API_KEY || !podId) return 'unknown';
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
 * RESUME a pod (`podResume(input:{podId, gpuCount:1})`). On success returns
 * `{ ok: true }`. If RunPod reports no GPU availability (the resume returns an error
 * rather than a pod), returns `{ ok: false, error }` with a readable message so the
 * card can show it inline ("not enough free GPUs" → try the next pod). Never throws.
 */
export async function podResume(podId: string): Promise<{ ok: boolean; error?: string }> {
	if (!ENV.RUNPOD_API_KEY || !podId) {
		return { ok: false, error: 'Pod control is not configured.' };
	}
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

/** STOP a pod (`podStop(input:{podId})`). Fire-and-forget; never throws. */
export async function podStop(podId: string): Promise<void> {
	if (!ENV.RUNPOD_API_KEY || !podId) return;
	await gql(`mutation { podStop(input:{podId:"${podId}"}) { id desiredStatus } }`);
}

/** True if ComfyUI answers `/system_stats` at `url` (any 200 = ready). */
export async function comfyReady(url: string): Promise<boolean> {
	const base = (url ?? '').replace(/\/$/, '');
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
 * Whether ComfyUI has work queued at `url/queue` — `true` (a render is running or
 * pending), `false` (confirmed empty), or **`null` when we could not tell**.
 *
 * The tri-state is load-bearing for the idle watchdog. ComfyUI serves `/queue` from the
 * same process that runs the graph, so it stops answering while a checkpoint loads or a
 * VAE decodes — exactly when the pod is busiest. Collapsing that silence into `false`
 * let one slow sample read as "idle" and stop a pod mid-render, so unknown stays
 * unknown and the caller decides (the watchdog treats it as busy).
 *
 * The timeout is deliberately generous for the same reason: a pod under load is slow to
 * answer, not idle.
 */
export async function comfyQueueBusy(url: string): Promise<boolean | null> {
	const base = (url ?? '').replace(/\/$/, '');
	if (!base) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15000);
	try {
		const res = await fetch(`${base}/queue`, {
			headers: { 'user-agent': UA },
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			queue_running?: unknown[];
			queue_pending?: unknown[];
		};
		const running = Array.isArray(data.queue_running) ? data.queue_running.length : 0;
		const pending = Array.isArray(data.queue_pending) ? data.queue_pending.length : 0;
		return running + pending > 0;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Probe the whole effective fleet concurrently: each pod's live status + ComfyUI
 * readiness. Resilient — a single pod hanging can't stall the rest (each call is
 * independently timeout-bounded and fail-safe). Shared by the /comfyui endpoints.
 */
export async function probeFleet(): Promise<PodState[]> {
	const fleet = await getEffectiveFleet();
	return Promise.all(
		fleet.map(async (p) => {
			const [status, ready] = await Promise.all([podStatus(p.id), comfyReady(p.url)]);
			return { ...p, status, ready };
		}),
	);
}

/** The /comfyui control-panel payload: the probed fleet plus the idle + lease state. */
export interface FleetPayload {
	configured: boolean;
	idleEnabled: boolean;
	idleMinutes: number;
	leaseMinutes: number;
	pods: { id: string; label: string; url: string; status: PodStatus; ready: boolean }[];
}

/**
 * Build the panel payload. ONE home for the shape: `status`, `start` and `stop` all
 * answer with it, and hand-building it in each endpoint is how a newly added field
 * reaches only some of them.
 */
export async function fleetPayload(): Promise<FleetPayload> {
	const [configured, pods, idle] = await Promise.all([
		podControlConfigured(),
		probeFleet(),
		getRunpodIdleConfig(),
	]);
	return {
		configured,
		idleEnabled: idle.enabled,
		idleMinutes: idle.minutes,
		leaseMinutes: leaseMinutesLeft(),
		pods: pods.map((p) => ({
			id: p.id,
			label: p.label,
			url: p.url,
			status: p.status,
			ready: p.ready,
		})),
	};
}
