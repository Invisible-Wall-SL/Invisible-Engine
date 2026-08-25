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

/**
 * The hardware behind a pod, as RunPod reports it — what the artist needs in order to
 * pick a card: what it costs per hour, how much VRAM the model has to fit in, and what
 * CPU/RAM it gets. Every field is OPTIONAL: RunPod answers different subsets depending
 * on the pod's state and on schema drift, and a missing figure renders as nothing
 * rather than as a wrong one.
 */
export interface PodSpecs {
	/** GPU model, e.g. `RTX 4090`. */
	gpu?: string;
	/** GPUs attached to the pod (a `2` here means the VRAM figure is per card). */
	gpuCount?: number;
	/** VRAM per GPU, in GB. */
	vramGb?: number;
	/** CPU model, e.g. `AMD EPYC 7763`. */
	cpu?: string;
	vcpuCount?: number;
	/** System RAM, in GB. */
	memoryGb?: number;
	/** USD per hour while the pod runs. */
	costPerHr?: number;
	/**
	 * RunPod's own id for the card (`NVIDIA GeForce RTX 4090`) and the data centre the pod
	 * sits in. Neither is rendered — they are LOOKUP KEYS: `podAvailability` needs both to
	 * ask whether a GPU of this type is free where this pod could actually resume. They ride
	 * along here because the query that would fetch them is the one `podSpecs` already makes.
	 */
	gpuTypeId?: string;
	dataCenterId?: string;
}

/** A probed pod: fleet entry + its live status and ComfyUI readiness. */
export interface PodState extends FleetPod {
	status: PodStatus;
	ready: boolean;
	/** Direct `http://ip:port` when TCP 8188 is exposed — see `directUrlFromPorts`. */
	directUrl?: string;
	/** Hardware + price, best-effort (see `podSpecs`). */
	specs?: PodSpecs;
	/** Is a GPU free to rent? Read only for a pod that isn't holding one — `podAvailability`. */
	availability?: PodAvailability;
}

/**
 * HTTP proxy ports to try, in order.
 *
 * A pod cannot expose ONE container port as both HTTP and TCP, and we need both — TCP
 * 8188 for the direct link the launcher can click, HTTP for the proxy hostname this
 * server probes. So the pod image forwards **8189 → 8188** and the documented config is
 * "HTTP 8189 + TCP 8188" (`services/atlas-comfy-pod/tools/port-forward.py`).
 *
 * 8188 stays in the list because a pod predating that image still serves its proxy
 * there. Getting this wrong is not cosmetic: the proxy url is what `comfyReady` probes,
 * so a wrong port reads as "ComfyUI never came up" and the card sticks on "warming up".
 */
const PROXY_PORTS = [8189, 8188] as const;

/** The ComfyUI proxy URL for a pod, derived from its RunPod id. */
export function podUrl(id: string, port: number = PROXY_PORTS[0]): string {
	return `https://${id}-${port}.proxy.runpod.net`;
}

/**
 * The proxy url that actually ANSWERS for this pod, or `null` if none does.
 *
 * Probed rather than assumed, because the answer depends on how the pod's ports happen
 * to be configured — new pods on 8189, older ones on 8188 — and there is no single
 * correct constant. Ordered, so the common case costs one request.
 */
export async function resolveProxyUrl(id: string): Promise<string | null> {
	for (const port of PROXY_PORTS) {
		const url = podUrl(id, port);
		if (await comfyReady(url)) return url;
	}
	return null;
}

/** One entry of RunPod's `runtime.ports`. */
interface RuntimePort {
	ip?: string;
	isIpPublic?: boolean;
	privatePort?: number;
	publicPort?: number;
	type?: string;
}

/**
 * The DIRECT `http://<ip>:<publicPort>` for ComfyUI, when the pod exposes 8188 as a
 * **TCP** port — otherwise `undefined` and callers fall back to `podUrl()`.
 *
 * Why this exists: the proxy (`<podId>-8188.proxy.runpod.net`) answers a server-side
 * fetch fine, but **403s any browser request carrying `Sec-Fetch-Site: cross-site`** —
 * which is every click from a launcher page. There is no fix on the link (the browser
 * computes that header from the initiator, so no `rel`/`target`/redirect avoids it) and
 * no RunPod toggle. Going direct skips the proxy entirely, so the rule never applies —
 * and it also dodges the proxy dropping ComfyUI's `/ws` socket on long renders (see
 * docs/INFRA.md). Both problems, one link.
 *
 * The port is only usable when RunPod has actually published it: TCP type, a public IP,
 * and both port numbers present. RunPod assigns the external port at RESUME and it
 * CHANGES on every start, so this must be read live on each poll — never cached, and
 * never derivable from the pod id the way the proxy URL is.
 */
export function directUrlFromPorts(ports: RuntimePort[] | null | undefined): string | undefined {
	if (!Array.isArray(ports)) return undefined;
	const p = ports.find(
		(x) =>
			x?.privatePort === 8188 &&
			String(x?.type ?? '').toLowerCase() === 'tcp' &&
			x?.isIpPublic === true &&
			!!x?.ip &&
			!!x?.publicPort,
	);
	return p ? `http://${p.ip}:${p.publicPort}` : undefined;
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
	return (await podProbe(podId)).status;
}

/**
 * `podStatus` plus the pod's live direct URL, from ONE GraphQL call — the fleet is
 * polled every few seconds, so asking twice per pod would double that traffic for a
 * field that arrives in the same `runtime` object.
 */
export async function podProbe(podId: string): Promise<{ status: PodStatus; directUrl?: string }> {
	if (!ENV.RUNPOD_API_KEY || !podId) return { status: 'unknown' };

	type PodData = {
		pod?: {
			desiredStatus?: string;
			runtime?: { uptimeInSeconds?: number; ports?: RuntimePort[] } | null;
		};
	};
	const read = (result: GqlResult | null): PodData['pod'] | undefined => {
		const pod = (result?.data as PodData | undefined)?.pod;
		return pod && typeof pod.desiredStatus === 'string' ? pod : undefined;
	};

	// `ports` is asked for on a best-effort basis. If RunPod's schema ever drops or
	// renames it, the whole query fails and every pod would read 'unknown' — i.e. a
	// running pod would render a "Start" button. Status matters far more than the
	// convenience link, so fall back to the minimal query that has always worked.
	let pod = read(
		await gql(
			`query { pod(input:{podId:"${podId}"}) { desiredStatus runtime { uptimeInSeconds ` +
				`ports { ip isIpPublic privatePort publicPort type } } } }`,
		),
	);
	if (!pod) {
		pod = read(
			await gql(
				`query { pod(input:{podId:"${podId}"}) { desiredStatus runtime { uptimeInSeconds } } }`,
			),
		);
	}
	if (!pod) return { status: 'unknown' };

	if (pod.desiredStatus === 'RUNNING') {
		return {
			status: pod.runtime ? 'running' : 'starting',
			directUrl: directUrlFromPorts(pod.runtime?.ports),
		};
	}
	return { status: 'stopped' };
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
 * VRAM by GPU model, read once from RunPod's `gpuTypes` catalogue.
 *
 * A pod itself only reports which GPU it has (`RTX 4090`), never how much memory that
 * card carries — and "will my model fit" is the question the artist is actually asking.
 * The catalogue is static hardware data, so it is cached for the process lifetime with
 * a long TTL; a failed read caches nothing and simply leaves VRAM blank.
 */
let gpuVramCache: { at: number; table: Map<string, number> } | null = null;
const GPU_TABLE_TTL_MS = 6 * 60 * 60 * 1000;
const GPU_TABLE_RETRY_MS = 10 * 60 * 1000;

/** Match key for a GPU name: case/brand/punctuation-insensitive (`NVIDIA GeForce RTX 4090` → `rtx4090`). */
function gpuKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/nvidia|geforce/g, '')
		.replace(/[^a-z0-9]/g, '');
}

async function gpuVramTable(): Promise<Map<string, number>> {
	if (gpuVramCache && Date.now() - gpuVramCache.at < GPU_TABLE_TTL_MS) return gpuVramCache.table;
	const result = await gql(`query { gpuTypes { id displayName memoryInGb } }`);
	const types = (result?.data as { gpuTypes?: unknown } | undefined)?.gpuTypes;
	if (!Array.isArray(types)) {
		// Negative-cache briefly: without this a rejected query would be re-sent for
		// every pod on every specs refresh, forever.
		const table = gpuVramCache?.table ?? new Map<string, number>();
		gpuVramCache = { at: Date.now() - (GPU_TABLE_TTL_MS - GPU_TABLE_RETRY_MS), table };
		return table;
	}
	const table = new Map<string, number>();
	for (const t of types as { id?: string; displayName?: string; memoryInGb?: number }[]) {
		const gb = typeof t?.memoryInGb === 'number' && t.memoryInGb > 0 ? t.memoryInGb : undefined;
		if (!gb) continue;
		for (const name of [t.id, t.displayName]) {
			if (typeof name === 'string' && name.trim()) table.set(gpuKey(name), gb);
		}
	}
	gpuVramCache = { at: Date.now(), table };
	return table;
}

/**
 * Per-pod specs cache. Specs are hardware facts, not live state, so they do not belong
 * in the 5s status poll — and RunPod only fills some of them in once a pod is actually
 * assigned a machine, so reads are MERGED into the last known good record rather than
 * replacing it. That's what keeps a card showing "RTX 4090 · 24 GB" after it stops.
 * A complete record is re-read rarely; an incomplete one retries soon.
 */
const specsCache = new Map<string, { at: number; specs: PodSpecs }>();
const SPECS_TTL_MS = 10 * 60 * 1000;
const SPECS_RETRY_MS = 60 * 1000;

function specsComplete(s: PodSpecs): boolean {
	return s.costPerHr != null && s.vramGb != null && (s.cpu != null || s.vcpuCount != null);
}

interface PodSpecFields {
	costPerHr?: number | string | null;
	gpuCount?: number | null;
	vcpuCount?: number | null;
	memoryInGb?: number | null;
	machine?: {
		gpuDisplayName?: string | null;
		gpuTypeId?: string | null;
		cpuTypeId?: string | null;
		dataCenterId?: string | null;
	} | null;
}

function positive(value: unknown): number | undefined {
	const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The pod's hardware + hourly price, best-effort and never throwing.
 *
 * Queried in tiers because `machine`'s sub-fields are the part of RunPod's schema we're
 * least sure of, and one unknown field fails the WHOLE query — which would cost the
 * price and RAM figures too. Each tier drops the least certain fields, so a schema
 * change degrades the card by one line instead of blanking it.
 */
export async function podSpecs(podId: string): Promise<PodSpecs | undefined> {
	if (!ENV.RUNPOD_API_KEY || !podId) return undefined;
	const cached = specsCache.get(podId);
	if (cached) {
		const ttl = specsComplete(cached.specs) ? SPECS_TTL_MS : SPECS_RETRY_MS;
		if (Date.now() - cached.at < ttl) return cached.specs;
	}

	// `dataCenterId` gets its OWN top tier rather than joining the tier below it. RunPod
	// documents that field on `Machine`, but a pod hands back a `PodMachineInfo` and we have
	// not confirmed it is there — and one unknown field fails the WHOLE query. Merged into
	// the tier below, an absent field would take `cpuTypeId` down with it and silently cost
	// every card its Processor line. As its own tier it costs one wasted call per refresh and
	// nothing else.
	const fields = [
		`costPerHr gpuCount vcpuCount memoryInGb machine { gpuDisplayName gpuTypeId cpuTypeId dataCenterId }`,
		`costPerHr gpuCount vcpuCount memoryInGb machine { gpuDisplayName gpuTypeId cpuTypeId }`,
		`costPerHr gpuCount vcpuCount memoryInGb machine { gpuDisplayName }`,
		`costPerHr gpuCount vcpuCount memoryInGb`,
	];
	let pod: PodSpecFields | undefined;
	for (const selection of fields) {
		const result = await gql(`query { pod(input:{podId:"${podId}"}) { ${selection} } }`);
		const data = (result?.data as { pod?: PodSpecFields | null } | undefined)?.pod;
		if (data) {
			pod = data;
			break;
		}
	}
	if (!pod) return cached?.specs;

	const gpu = text(pod.machine?.gpuDisplayName) ?? text(pod.machine?.gpuTypeId);
	let vramGb: number | undefined;
	if (gpu || pod.machine?.gpuTypeId) {
		const table = await gpuVramTable();
		vramGb =
			(pod.machine?.gpuTypeId ? table.get(gpuKey(pod.machine.gpuTypeId)) : undefined) ??
			(gpu ? table.get(gpuKey(gpu)) : undefined);
	}

	// Merge: keep every previously known figure a null read would otherwise erase.
	const specs: PodSpecs = { ...(cached?.specs ?? {}) };
	const assign = <K extends keyof PodSpecs>(key: K, value: PodSpecs[K]): void => {
		if (value != null) specs[key] = value;
	};
	assign('gpu', gpu);
	assign('gpuCount', positive(pod.gpuCount));
	assign('vramGb', vramGb);
	assign('cpu', text(pod.machine?.cpuTypeId));
	assign('vcpuCount', positive(pod.vcpuCount));
	assign('memoryGb', positive(pod.memoryInGb));
	assign('costPerHr', positive(pod.costPerHr));
	assign('gpuTypeId', text(pod.machine?.gpuTypeId));
	assign('dataCenterId', text(pod.machine?.dataCenterId));

	specsCache.set(podId, { at: Date.now(), specs });
	return specs;
}

/** RunPod's stock word for a GPU type — High / Medium / Low / None. */
export type StockStatus = 'High' | 'Medium' | 'Low' | 'None';

/**
 * Where an availability reading came from. This is NOT bookkeeping — the UI trusts the two
 * sources differently, and conflating them is what put a wrong badge on every card:
 *
 * - `datacenter` — `gpuAvailability` on a DATA CENTRE. Per region, per card, and the source
 *   RunPod's own console draws its availability indicator from. Trustworthy.
 * - `price` — `gpuTypes(...).lowestPrice.stockStatus`. Reports stock **at the lowest price
 *   point**, a market signal. It read `Low` on all six cards in a region where most were not
 *   rentable at all (2026-08-25), so the panel shows it only when it says `None`.
 */
export type AvailabilitySource = 'datacenter' | 'price';

/**
 * Whether a GPU is free to rent where a pod could actually resume.
 *
 * Until this existed a card only learned the fleet was dry when **Start** failed with
 * "not enough free GPUs" — the artist discovered it one click at a time.
 *
 * Still a hint, not a promise: stock moves between the read and the resume, so the inline
 * Start error stays. This pre-empts most of those clicks; it does not replace the failure path.
 */
export interface PodAvailability {
	source: AvailabilitySource;
	/** RunPod's explicit "can this be rented right now", when the schema hands it over. */
	available?: boolean;
	stockStatus?: StockStatus;
	/**
	 * The data centre this answer covers. ABSENT means it is fleet-wide, which is a weaker
	 * claim than it looks: a stopped pod can only resume where its disk already is, so a
	 * global reading can look healthy while this pod's region has nothing.
	 */
	dataCenterId?: string;
}

/** One row of the availability table: what RunPod says about a card in a data centre. */
interface AvailabilityRow {
	available?: boolean;
	stockStatus?: StockStatus;
}

/**
 * ONE query answers the whole fleet, so this is a table like `gpuVramTable` rather than a
 * per-pod call — six stopped pods cost one request, not six. Cached SHORT: unlike the 6h
 * VRAM table this is live state, and it must never ride inside the 5s status poll uncached.
 */
let availabilityCache: { at: number; table: Map<string, AvailabilityRow> | null } | null = null;
let availabilityInflight: Promise<Map<string, AvailabilityRow> | null> | null = null;
const AVAILABILITY_TTL_MS = 60 * 1000;
const AVAILABILITY_RETRY_MS = 30 * 1000;

/**
 * Why the table is empty, in RunPod's own words. Surfaced in the panel — not just logged —
 * because the first two attempts at this feature failed SILENTLY on a machine whose logs the
 * person looking at the blank badges could not read.
 */
let availabilityError: string | undefined;

/** Why the availability badges are missing, if they are. `undefined` when all is well. */
export function availabilityNote(): string | undefined {
	return availabilityError;
}

/** Only the four values RunPod documents; anything else is treated as no answer. */
function stockStatusOf(value: unknown): StockStatus | undefined {
	switch (text(value)?.toLowerCase()) {
		case 'high':
			return 'High';
		case 'medium':
			return 'Medium';
		case 'low':
			return 'Low';
		case 'none':
			return 'None';
		default:
			return undefined;
	}
}

const STOCK_RANK: Record<StockStatus, number> = { None: 0, Low: 1, Medium: 2, High: 3 };

/** Fleet-wide roll-up of one card across data centres: the BEST answer any of them gave. */
function mergeRows(a: AvailabilityRow | undefined, b: AvailabilityRow): AvailabilityRow {
	if (!a) return { ...b };
	const merged: AvailabilityRow = {};
	if (a.available === true || b.available === true) merged.available = true;
	else if (a.available === false || b.available === false) merged.available = false;
	const seen = [a.stockStatus, b.stockStatus].filter((s): s is StockStatus => !!s);
	if (seen.length) merged.stockStatus = seen.sort((x, y) => STOCK_RANK[y] - STOCK_RANK[x])[0];
	return merged;
}

/** `<dataCentreId>|<gpu key>`, or `*|<gpu key>` for the fleet-wide roll-up. */
function availabilityKey(dataCenterId: string | undefined, gpuTypeId: string): string {
	return `${dataCenterId ? dataCenterId.toLowerCase() : '*'}|${gpuKey(gpuTypeId)}`;
}

/**
 * The four shapes we know of for "which cards are free, per data centre", most informative
 * first. TIERED for the same reason `podSpecs` is: one unknown field fails the WHOLE query,
 * and this feature has now been broken twice by a single field name.
 *
 * The `available` boolean is documented on `GpuAvailability` but has never answered here, so
 * every route is tried with it and then without. `dataCenters` at the root is the shape
 * RunPod's own console sends (`getAllDatacenters`); `myself.datacenters` is what the
 * published schema documents. Both exist in the wild, so ask for both rather than pick.
 */
const AVAILABILITY_TIERS = [
	`query { dataCenters { id gpuAvailability(input:{gpuCount:1, secureCloud:true}) { gpuTypeId available stockStatus } } }`,
	`query { dataCenters { id gpuAvailability(input:{gpuCount:1, secureCloud:true}) { gpuTypeId stockStatus } } }`,
	`query { myself { datacenters { id gpuAvailability(input:{gpuCount:1, secureCloud:true}) { gpuTypeId available stockStatus } } } }`,
	`query { myself { datacenters { id gpuAvailability(input:{gpuCount:1, secureCloud:true}) { gpuTypeId stockStatus } } } }`,
];

type AvailabilityGqlRow = { gpuTypeId?: unknown; available?: unknown; stockStatus?: unknown };
type AvailabilityGqlCentre = { id?: unknown; gpuAvailability?: AvailabilityGqlRow[] | null };

/** Pull the data-centre list out of either shape. */
function centresOf(result: GqlResult | null): AvailabilityGqlCentre[] | undefined {
	const data = result?.data as
		| {
				dataCenters?: AvailabilityGqlCentre[] | null;
				myself?: { datacenters?: AvailabilityGqlCentre[] | null } | null;
		  }
		| undefined;
	const direct = data?.dataCenters;
	if (Array.isArray(direct) && direct.length) return direct;
	const viaMyself = data?.myself?.datacenters;
	if (Array.isArray(viaMyself) && viaMyself.length) return viaMyself;
	return undefined;
}

async function gpuAvailabilityTable(): Promise<Map<string, AvailabilityRow> | null> {
	if (availabilityCache) {
		const ttl = availabilityCache.table ? AVAILABILITY_TTL_MS : AVAILABILITY_RETRY_MS;
		if (Date.now() - availabilityCache.at < ttl) return availabilityCache.table;
	}
	// `probeFleet` probes every pod CONCURRENTLY, so without this the whole stopped fleet
	// misses the cache in the same tick and sends the same query once per pod. Share the
	// in-flight read instead — the cache only helps the ticks that come after it lands.
	availabilityInflight ??= readAvailabilityTable().finally(() => {
		availabilityInflight = null;
	});
	return availabilityInflight;
}

async function readAvailabilityTable(): Promise<Map<string, AvailabilityRow> | null> {
	let firstFailure: string | undefined;

	for (const query of AVAILABILITY_TIERS) {
		const result = await gql(query);
		const centres = centresOf(result);
		if (!centres) {
			firstFailure ??= firstError(result) ?? 'RunPod returned no data centres';
			continue;
		}

		const table = new Map<string, AvailabilityRow>();
		for (const centre of centres) {
			const centreId = text(centre?.id);
			for (const row of centre?.gpuAvailability ?? []) {
				const gpu = text(row?.gpuTypeId);
				if (!gpu) continue;
				const value: AvailabilityRow = {};
				if (typeof row.available === 'boolean') value.available = row.available;
				const stock = stockStatusOf(row.stockStatus);
				if (stock) value.stockStatus = stock;
				if (centreId) table.set(availabilityKey(centreId, gpu), value);
				const anyKey = availabilityKey(undefined, gpu);
				table.set(anyKey, mergeRows(table.get(anyKey), value));
			}
		}
		if (table.size === 0) {
			firstFailure ??= 'RunPod listed data centres but no GPUs in them';
			continue;
		}

		availabilityError = undefined;
		availabilityCache = { at: Date.now(), table };
		return table;
	}

	availabilityError = firstFailure ?? 'RunPod did not answer';
	availabilityCache = { at: Date.now(), table: null };
	return null;
}

/**
 * The COARSE fallback, used only when no data-centre route answered. Kept because half an
 * answer beats none — but it is tagged `price`, and the panel shows it only when it says
 * `None`. "Low" from this field is exactly what shipped the wrong badge.
 */
async function coarseStock(
	gpuTypeId: string,
	dataCenterId?: string,
): Promise<PodAvailability | undefined> {
	const filter = dataCenterId
		? `gpuCount:1, dataCenterId:${JSON.stringify(dataCenterId)}, secureCloud:true`
		: `gpuCount:1, secureCloud:true`;
	// JSON.stringify, not a bare template: a gpu type id is free text from RunPod
	// (`NVIDIA RTX PRO 4500 Blackwell`) and would otherwise break the query on a quote.
	const result = await gql(
		`query { gpuTypes(input:{id:${JSON.stringify(gpuTypeId)}}) { id lowestPrice(input:{${filter}}) { stockStatus } } }`,
	);
	type GpuTypeRow = { id?: unknown; lowestPrice?: { stockStatus?: unknown } | null };
	const rows = (result?.data as { gpuTypes?: GpuTypeRow[] } | undefined)?.gpuTypes;
	if (!Array.isArray(rows) || rows.length === 0) return undefined;
	// Match the row we ASKED for rather than trusting position. A filter that silently
	// widened would otherwise put one card's reading on every row in the fleet.
	const wanted = gpuKey(gpuTypeId);
	const row = rows.find((r) => gpuKey(text(r?.id) ?? '') === wanted);
	const stockStatus = stockStatusOf(row?.lowestPrice?.stockStatus);
	if (!stockStatus) return undefined;
	return dataCenterId
		? { source: 'price', stockStatus, dataCenterId }
		: { source: 'price', stockStatus };
}

/**
 * Is a GPU of this pod's type free where this pod could resume? Best-effort, never throws —
 * no answer means the card renders exactly as it did before this existed.
 */
export async function podAvailability(
	gpuTypeId?: string,
	dataCenterId?: string,
): Promise<PodAvailability | undefined> {
	if (!ENV.RUNPOD_API_KEY || !gpuTypeId) return undefined;
	const dc = dataCenterId || ENV.RUNPOD_DATA_CENTER_ID || undefined;

	const table = await gpuAvailabilityTable();
	if (table) {
		const scoped = dc ? table.get(availabilityKey(dc, gpuTypeId)) : undefined;
		if (scoped) return { source: 'datacenter', ...scoped, dataCenterId: dc };
		// The card is known, but not in a data centre we could name. Report it fleet-wide and
		// let the UI say so, rather than passing a global figure off as a local one.
		const anywhere = table.get(availabilityKey(undefined, gpuTypeId));
		if (anywhere) return { source: 'datacenter', ...anywhere };
	}

	return coarseStock(gpuTypeId, dc);
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
			// Specs are cached hardware facts, so this is almost always free — see `podSpecs`.
			const [probe, specs] = await Promise.all([podProbe(p.id), podSpecs(p.id)]);
			// Readiness must not assume the proxy: exposing 8188 as TCP REMOVES its HTTP
			// proxy (the hostname starts answering 404), which once left a pod reachable
			// by no route the launcher knew about while ComfyUI was running fine. So try
			// the proxy ports in order, and fall back to the direct endpoint — if either
			// answers, the pod is up.
			const proxyUrl = await resolveProxyUrl(p.id);
			const ready = !!proxyUrl || (!!probe.directUrl && (await comfyReady(probe.directUrl)));
			// Stock is only a question for a pod that ISN'T holding a GPU — a running or
			// resuming one already has its card. Asking anyway would spend a call per poll
			// to answer something nobody is looking at. Cached 60s, so this is near-free.
			const availability =
				probe.status === 'running' || probe.status === 'starting'
					? undefined
					: await podAvailability(specs?.gpuTypeId, specs?.dataCenterId);
			return {
				...p,
				// Surface the url that actually answers, so the "paste this" fallback on
				// the card is never a dead hostname.
				url: proxyUrl ?? p.url,
				status: probe.status,
				ready,
				directUrl: probe.directUrl,
				specs,
				availability,
			};
		}),
	);
}

/** The /comfyui control-panel payload: the probed fleet plus the idle + lease state. */
export interface FleetPayload {
	configured: boolean;
	idleEnabled: boolean;
	idleMinutes: number;
	leaseMinutes: number;
	/**
	 * Why the GPU-availability badges are missing, when they are. Present ONLY on failure,
	 * so the panel stays quiet in the normal case. It exists because this feature has now
	 * failed silently twice, on a service whose logs the person staring at the blank badges
	 * cannot read — a diagnostic nobody can reach is not a diagnostic.
	 */
	availabilityNote?: string;
	pods: {
		id: string;
		label: string;
		url: string;
		status: PodStatus;
		ready: boolean;
		directUrl?: string;
		specs?: PodSpecs;
		availability?: PodAvailability;
	}[];
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
		// Only when a badge is actually missing because of it — a pod that simply has no
		// reading yet (never started, so no gpu type known) is not a fault worth reporting.
		availabilityNote: pods.some((p) => p.status !== 'running' && !p.availability)
			? availabilityNote()
			: undefined,
		pods: pods.map((p) => ({
			id: p.id,
			label: p.label,
			url: p.url,
			status: p.status,
			ready: p.ready,
			directUrl: p.directUrl,
			specs: p.specs,
			availability: p.availability,
		})),
	};
}
