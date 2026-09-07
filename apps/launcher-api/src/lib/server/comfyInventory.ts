import { ENV } from './env';
import { comfyReady, podProbe, probeFleet, resolveProxyUrl } from './runpod';

/**
 * "What is actually installed on the pods" — read LIVE from a running ComfyUI rather
 * than from anything we keep in this repo.
 *
 * Why live: the two things an artist wants listed have different homes and different
 * lifetimes, and only the pod knows the truth about either.
 *   * **Models** live on the RunPod **Network Volume** (`/workspace/ComfyUI/models`,
 *     mapped by `services/atlas-comfy-pod/extra_model_paths.yaml`). Persistent, shared
 *     by every pod that mounts the volume — so ANY reachable pod can list them, which
 *     is what makes an always-on CPU pod a valid reader with no GPU billed.
 *   * **Custom node packs** live in the pod's container **image** (baked at pinned SHAs
 *     in the pod Dockerfile). Anything added afterwards with ComfyUI-Manager lands in
 *     the ephemeral container and is GONE when RunPod recreates it on resume — the
 *     single most confusing thing about this fleet, and the reason the panel says so.
 *
 * Everything here is FALLBACK-TOLERANT by design. ComfyUI's model-listing route has
 * moved between releases (`/experiment/models`, `/api/models`, …) and ComfyUI-Manager's
 * API is not a stable contract, so each fact is attempted through a LIST of candidate
 * endpoints and the first one that parses wins. A pod that answers none of them yields
 * an empty section with a reason — never an error page, and never a hard dependency on
 * a route that a core bump may rename.
 *
 * Nothing here can start, stop or otherwise bill a pod: it only ever reads.
 */

/** One model directory on the volume (`checkpoints`, `loras`, …) and its files. */
export interface ModelFolder {
	folder: string;
	files: string[];
	/** True when `files` was capped by `MAX_FILES_PER_FOLDER`. */
	truncated: boolean;
}

/** One installed custom-node pack. `nodes` is how many node classes it registers. */
export interface NodePack {
	name: string;
	nodes: number;
	version?: string;
	/**
	 * Only known when the pod runs our own inventory route (see `PACK_ENDPOINTS`):
	 * `true` = the pack sits on the Network Volume (survives a recreate), `false` = it
	 * is in the container image or was installed at runtime. `undefined` = unknown.
	 */
	onVolume?: boolean;
}

export interface Inventory {
	/** The pod the lists were read from, or `null` when nothing answered. */
	reader: { id: string; label: string } | null;
	models: ModelFolder[];
	packs: NodePack[];
	/** Which endpoint each list came from — surfaced so a wrong-looking list is traceable. */
	modelsVia?: string;
	packsVia?: string;
	/** Human-readable reason when a list is empty. */
	note?: string;
	fetchedAt: number;
}

const UA = 'InvisibleLauncher/1.0';

/** Cache TTL. Reading is cheap for models and expensive for packs — see `scanObjectInfo`. */
const TTL_MS = 60_000;

const MAX_FOLDERS = 48;
const MAX_FILES_PER_FOLDER = 300;

/**
 * Candidate model-index routes, in order. ComfyUI aliases every route under `/api/…`
 * for its frontend, and the model listing itself was introduced as an *experiment* and
 * has been promoted since — so which of these exists depends on the core pin. The
 * per-folder listing is always `${index}/${folder}`, so whichever index answers also
 * decides where the files are read from.
 */
const MODEL_INDEX_PATHS = [
	'/api/experiment/models',
	'/experiment/models',
	'/api/models',
	'/models',
] as const;

/**
 * Candidate node-pack routes, cheapest first.
 *
 * `/invisible/inventory` is OURS — a route we can add to the baked
 * `ComfyUI-Invisible-ErrorRecall` node so a pod can report its packs (and their paths,
 * hence `onVolume`) directly. It does not exist on today's pods; it is listed first so
 * that adding it later needs no launcher change, and costs one 404 until then.
 */
const PACK_ENDPOINTS = [
	'/invisible/inventory',
	'/api/invisible/inventory',
	'/customnode/installed',
	'/api/customnode/installed',
] as const;

/** Hard ceiling on the `/object_info` scan — see `scanObjectInfo`. */
const OBJECT_INFO_MAX_BYTES = 64 * 1024 * 1024;

interface CacheEntry {
	at: number;
	data: Inventory;
}
let cache: CacheEntry | null = null;
/** In-flight dedupe: a page with several tabs open must not fan out N object_info scans. */
let inFlight: Promise<Inventory> | null = null;

function trimUrl(url: string): string {
	return (url ?? '').replace(/\/$/, '');
}

/** GET + parse JSON, timeout-bounded. `null` on any non-200, transport or parse error. */
async function getJson<T>(base: string, path: string, timeoutMs = 8000): Promise<T | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${base}${path}`, {
			headers: { 'user-agent': UA, accept: 'application/json' },
			signal: controller.signal,
		});
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The pod to read from.
 *
 * Preference order, and why: an explicitly configured **volume pod** wins, because the
 * whole point of it is to be always-on and free of GPU billing — a cheap CPU pod that
 * mounts the same Network Volume and serves ComfyUI's HTTP API (`python main.py --cpu`
 * is enough; it never has to generate). Failing that, any ready pod in the R&D fleet.
 * Failing that, `null` and the panel explains itself.
 */
async function pickReader(): Promise<{ url: string; id: string; label: string } | null> {
	const configuredUrl = trimUrl(ENV.COMFY_VOLUME_URL);
	if (configuredUrl && (await comfyReady(configuredUrl))) {
		return { url: configuredUrl, id: 'volume', label: 'Volume pod' };
	}

	const volumePodId = ENV.COMFY_VOLUME_POD_ID.trim();
	if (volumePodId) {
		// The proxy first, then the DIRECT ip:port — a pod that exposes 8188 as TCP has no
		// HTTP proxy on it at all (the hostname answers a bare 404), which is precisely the
		// shape a hand-made CPU pod tends to have. Measured on the first real volume pod:
		// every proxy port 404'd. Without this fallback the reader would be unreachable on
		// a pod that is running ComfyUI perfectly well. Same rule `probeFleet` follows.
		const proxy = await resolveProxyUrl(volumePodId);
		if (proxy) return { url: proxy, id: volumePodId, label: 'Volume pod' };
		const direct = trimUrl((await podProbe(volumePodId)).directUrl ?? '');
		if (direct && (await comfyReady(direct))) {
			return { url: direct, id: volumePodId, label: 'Volume pod' };
		}
	}

	for (const pod of await probeFleet()) {
		if (pod.status !== 'running' || !pod.ready) continue;
		// `pod.url` is the proxy that answered ONLY when one did — otherwise `probeFleet`
		// leaves the DERIVED hostname there, and on a TCP-only pod that hostname 404s
		// every path (measured on the running Blackwell pod: `/system_stats` and
		// `/object_info` alike, a bare `Content-Length: 0` from RunPod's edge). Since
		// `ready` can be true purely on the strength of the direct endpoint, the url must
		// be RE-CONFIRMED rather than trusted: reading the dead hostname is indisputably
		// "the pod answered nothing", which the panel then reports as a ComfyUI whose
		// model API moved — a wrong and very confusing thing to tell someone.
		for (const url of [trimUrl(pod.url), trimUrl(pod.directUrl ?? '')]) {
			if (url && (await comfyReady(url))) return { url, id: pod.id, label: pod.label };
		}
	}
	return null;
}

/** Coerce one listing entry to a filename — ComfyUI has answered both shapes. */
function entryName(entry: unknown): string | null {
	if (typeof entry === 'string') return entry;
	if (entry && typeof entry === 'object') {
		const name = (entry as Record<string, unknown>).name;
		if (typeof name === 'string') return name;
	}
	return null;
}

/** Read the model folders on the volume through whichever index route answers. */
async function readModels(base: string): Promise<{ models: ModelFolder[]; via?: string }> {
	for (const indexPath of MODEL_INDEX_PATHS) {
		const index = await getJson<unknown>(base, indexPath);
		if (!Array.isArray(index) || index.length === 0) continue;

		const folders = index
			.map(entryName)
			.filter((f): f is string => !!f)
			.slice(0, MAX_FOLDERS);
		if (folders.length === 0) continue;

		// Folders are read concurrently: a volume with a dozen model dirs would otherwise
		// serialise a dozen round-trips through the RunPod proxy.
		const models = await Promise.all(
			folders.map(async (folder): Promise<ModelFolder> => {
				const listing = await getJson<unknown>(base, `${indexPath}/${encodeURIComponent(folder)}`);
				const all = Array.isArray(listing)
					? listing.map(entryName).filter((f): f is string => !!f)
					: [];
				all.sort((a, b) => a.localeCompare(b));
				return {
					folder,
					files: all.slice(0, MAX_FILES_PER_FOLDER),
					truncated: all.length > MAX_FILES_PER_FOLDER,
				};
			}),
		);
		return { models: models.filter((m) => m.files.length > 0), via: indexPath };
	}
	return { models: [] };
}

/** Parse whatever a pack endpoint answered into `NodePack[]`, or `null` if unrecognised. */
function parsePacks(payload: unknown): NodePack[] | null {
	// Our own route: `{ packs: [{ name, nodes, version, onVolume }] }`.
	const packs = (payload as { packs?: unknown } | null)?.packs;
	const rows = Array.isArray(payload) ? payload : Array.isArray(packs) ? packs : null;
	if (!rows) return null;

	const out: NodePack[] = [];
	for (const row of rows) {
		if (typeof row === 'string') {
			out.push({ name: row, nodes: 0 });
			continue;
		}
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		// `title`/`cnr_id` are ComfyUI-Manager's names for the same thing.
		const name = [r.name, r.title, r.cnr_id, r.id].find((v) => typeof v === 'string' && v.trim());
		if (typeof name !== 'string') continue;
		const nodes = typeof r.nodes === 'number' ? r.nodes : 0;
		const version = [r.version, r.active_version].find((v) => typeof v === 'string' && v.trim()) as
			| string
			| undefined;
		const onVolume = typeof r.onVolume === 'boolean' ? r.onVolume : undefined;
		out.push({ name, nodes, version, onVolume });
	}
	return out.length ? out : null;
}

/**
 * Last-resort pack listing: derive the packs from `/object_info`, which every ComfyUI
 * serves and which stamps each node class with the `python_module` it came from
 * (`custom_nodes.<pack>` for anything not core).
 *
 * It is STREAM-SCANNED with a regex rather than parsed, on purpose. `/object_info` on a
 * loaded pod is 10–25 MB of JSON, and `JSON.parse`ing that on the launcher would spike
 * hundreds of MB for a handful of strings — this service has already been OOM-killed
 * once by a big in-memory payload (`gotcha_bake_export_502_launcher_oom`). Scanning
 * keeps only a small tail buffer plus the counts, so memory is flat regardless of size,
 * and `OBJECT_INFO_MAX_BYTES` bounds a pathological response.
 */
async function scanObjectInfo(base: string): Promise<NodePack[] | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	try {
		const res = await fetch(`${base}/object_info`, {
			headers: { 'user-agent': UA, accept: 'application/json' },
			signal: controller.signal,
		});
		if (!res.ok || !res.body) return null;

		const counts = new Map<string, number>();
		const decoder = new TextDecoder();
		const reader = res.body.getReader();
		const pattern = /"python_module"\s*:\s*"([^"]+)"/g;
		// Carry the tail across chunks so a match split by a chunk boundary is not lost.
		// 128 chars comfortably exceeds the longest possible match.
		let tail = '';
		let bytes = 0;

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > OBJECT_INFO_MAX_BYTES) {
				await reader.cancel().catch(() => {});
				break;
			}
			const text = tail + decoder.decode(value, { stream: true });
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(text))) {
				const module = match[1];
				if (!module.startsWith('custom_nodes.')) continue;
				const pack = module.slice('custom_nodes.'.length).split('.')[0];
				if (pack) counts.set(pack, (counts.get(pack) ?? 0) + 1);
			}
			tail = text.slice(-128);
		}

		if (counts.size === 0) return null;
		return [...counts.entries()]
			.map(([name, nodes]) => ({ name, nodes }))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Read the installed packs through the cheapest route that answers. */
async function readPacks(base: string): Promise<{ packs: NodePack[]; via?: string }> {
	for (const path of PACK_ENDPOINTS) {
		const payload = await getJson<unknown>(base, path);
		if (payload === null) continue;
		const parsed = parsePacks(payload);
		if (parsed) return { packs: parsed, via: path };
	}
	const scanned = await scanObjectInfo(base);
	return scanned ? { packs: scanned, via: '/object_info' } : { packs: [] };
}

async function build(): Promise<Inventory> {
	const reader = await pickReader();
	if (!reader) {
		return {
			reader: null,
			models: [],
			packs: [],
			note: 'No pod is answering. Start one above to read what is installed.',
			fetchedAt: Date.now(),
		};
	}

	const [models, packs] = await Promise.all([readModels(reader.url), readPacks(reader.url)]);
	const note =
		models.models.length === 0 && packs.packs.length === 0
			? `${reader.label} answered, but not on any listing route this launcher knows. It may be a ComfyUI version whose model API moved.`
			: undefined;

	return {
		reader: { id: reader.id, label: reader.label },
		models: models.models,
		packs: packs.packs,
		modelsVia: models.via,
		packsVia: packs.via,
		note,
		fetchedAt: Date.now(),
	};
}

/**
 * The /comfyui inventory payload, cached for `TTL_MS` and deduped while in flight. Pass
 * `refresh` (the panel's Refresh button) to bypass the cache — a fresh read is what an
 * artist wants right after installing something, and it is the only way to see a change
 * inside the TTL.
 */
export async function fleetInventory({ refresh = false } = {}): Promise<Inventory> {
	if (!refresh && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	if (inFlight) return inFlight;

	inFlight = build()
		.then((data) => {
			cache = { at: Date.now(), data };
			return data;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}
