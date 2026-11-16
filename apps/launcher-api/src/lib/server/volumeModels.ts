import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
	MIRROR_PREFIX,
	VOLUME_MODELS_ROOT,
	blueprintModelNames,
	isModelFile,
	deleteRefusal,
	groupByFolder,
	mirrorKey,
	toVolumeFile,
	usesOf,
	type BlueprintUse,
	type FolderGroup,
	type KeepEntry,
	type ModelRow,
	type VolumeFile,
	type VolumeObject,
} from '$lib/volumeModels';
import { compareAndSetAppSetting, getAppSetting } from './appSettings';
import { isPrivateComfyHost } from './comfyRegister';
import { ENV } from './env';
import {
	entryFor,
	readManifest,
	removeEntry,
	setOnVolume,
	updateManifest,
	upsertEntry,
	type ManifestEntry,
} from './modelManifest';
import {
	abortMultipartUpload,
	completeMultipartUpload,
	createMultipartUpload,
	deleteObject,
	getObjectStream,
	getObjectText,
	headObject,
	listAllKeys,
	listAllObjects,
	putObjectText,
	uploadPart,
} from './r2';
import { gql, getEffectiveFleet, podStatus } from './runpod';
import { volumeStore, type VolumeUpload } from './volumeStore';

/**
 * The /comfyui "Volume models" section: what is on the RunPod Network Volume, who uses it, and
 * the three things an admin can do about it — delete, keep, and put a file there. Storage access
 * goes only through `volumeStore()` (the seam a Global Volume would replace).
 */

export const KEEP_SETTING = 'runpodVolumeKeep';

/**
 * Kept until someone un-keeps them, before anyone has saved a Keep list: the Wan Animate-2
 * Flipbook trial (PR #1678) puts ~35 GB on the volume that no published blueprint names yet, so
 * without this the page would offer the trial's weights as unused.
 */
const DEFAULT_KEEP: KeepEntry[] = [
	'diffusion_models/wan_animate_2_distill_int8_convrot.safetensors',
	'diffusion_models/wan_animate_2_int8_convrot.safetensors',
	'clip_vision/clip_vision_h.safetensors',
	'vae/Wan2_1_VAE_bf16.safetensors',
	'loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
].map((p) => ({ key: `${VOLUME_MODELS_ROOT}${p}`, note: 'Wan Animate-2 Flipbook trial (#1678)' }));

/** Last listing, persisted so a redeploy still shows it while a fresh read runs. */
const SNAPSHOT_KEY = 'tools/runpod-volume/models-listing.json';
const BLUEPRINT_PREFIX = '_shared/blueprints/';
const BLUEPRINT_TTL_MS = 5 * 60_000;
const VOLUME_INFO_TTL_MS = 10 * 60_000;

/** Bytes buffered per part. Small enough for the launcher's heap; ≤ RunPod's 500 MB part cap. */
const PART_BYTES = 64 * 1024 * 1024;

interface Snapshot {
	objects: VolumeObject[];
	readAt: string;
	label: string;
}

let snapshot: Snapshot | null = null;
let snapshotLoad: Promise<void> | null = null;
let refreshing: Promise<void> | null = null;
let lastRefreshError: string | null = null;
/** Deletes / finished copies made while a refresh reads; replayed onto its (older) listing. */
let patchesDuringRefresh: ((objects: VolumeObject[]) => VolumeObject[])[] = [];

function loadSnapshot(): Promise<void> {
	snapshotLoad ??= (async () => {
		try {
			const text = await getObjectText(SNAPSHOT_KEY);
			if (text && !snapshot) snapshot = JSON.parse(text) as Snapshot;
		} catch (e) {
			console.error('[volume-models] could not read the saved listing:', e);
		}
	})();
	return snapshotLoad;
}

async function saveSnapshot(next: Snapshot): Promise<void> {
	snapshot = next;
	try {
		await putObjectText(SNAPSHOT_KEY, JSON.stringify(next), 'application/json');
	} catch (e) {
		console.error('[volume-models] could not save the listing:', e);
	}
}

/**
 * Start a fresh read of the volume in the background (a large volume can take minutes: RunPod
 * computes an ETag for every file not written through S3). One at a time; a second call joins it.
 */
export function refreshListing(): Promise<void> {
	refreshing ??= (async () => {
		const store = volumeStore();
		try {
			patchesDuringRefresh = [];
			const listed = await store.list(VOLUME_MODELS_ROOT);
			const objects = patchesDuringRefresh.reduce((acc, patch) => patch(acc), listed);
			lastRefreshError = null;
			await saveSnapshot({ objects, readAt: new Date().toISOString(), label: store.label });
		} catch (e) {
			lastRefreshError = e instanceof Error ? e.message : String(e);
			console.error('[volume-models] listing failed:', e);
		} finally {
			patchesDuringRefresh = [];
			refreshing = null;
		}
	})();
	return refreshing;
}

function patchSnapshot(change: (objects: VolumeObject[]) => VolumeObject[]): void {
	if (refreshing) patchesDuringRefresh.push(change);
	if (!snapshot) return;
	void saveSnapshot({ ...snapshot, objects: change(snapshot.objects) });
}

// --- Blueprint references ----------------------------------------------------------------

interface BlueprintNames {
	use: BlueprintUse;
	names: Set<string>;
}

let blueprintCache: { at: number; list: BlueprintNames[] } | null = null;

function parseJson(text: string | null): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Every blueprint in the shared library (Atlas Maker `image` and Flipbook `video` alike) with the
 * model files it names, read straight from R2 — the library's own store — so a reference shows
 * even when atlas-tool is down.
 */
async function readBlueprints(force = false): Promise<BlueprintNames[]> {
	if (!force && blueprintCache && Date.now() - blueprintCache.at < BLUEPRINT_TTL_MS) {
		return blueprintCache.list;
	}
	const keys = await listAllKeys(BLUEPRINT_PREFIX);
	const ids = [
		...new Set(
			keys
				.filter((k) => k.endsWith('/blueprint.json'))
				.map((k) => k.slice(BLUEPRINT_PREFIX.length, -'/blueprint.json'.length))
				.filter((id) => id && !id.includes('/')),
		),
	];
	const list = await Promise.all(
		ids.map(async (id) => {
			const [manifestText, graphText] = await Promise.all([
				getObjectText(`${BLUEPRINT_PREFIX}${id}/blueprint.json`),
				getObjectText(`${BLUEPRINT_PREFIX}${id}/workflow.json`),
			]);
			const manifest = parseJson(manifestText) as { name?: unknown; kind?: unknown } | null;
			return {
				use: {
					id,
					name: typeof manifest?.name === 'string' && manifest.name ? manifest.name : id,
					kind: typeof manifest?.kind === 'string' && manifest.kind ? manifest.kind : 'image',
				},
				names: blueprintModelNames(manifest, parseJson(graphText)),
			};
		}),
	);
	blueprintCache = { at: Date.now(), list };
	return list;
}

// --- Keep list ---------------------------------------------------------------------------

export async function readKeepList(): Promise<KeepEntry[]> {
	return parseKeep(await getAppSetting(KEEP_SETTING));
}

function parseKeep(raw: string | undefined): KeepEntry[] {
	if (raw === undefined) return DEFAULT_KEEP;
	const parsed = parseJson(raw);
	if (!Array.isArray(parsed)) throw new VolumeActionError(500, 'The Keep list is unreadable.');
	return parsed.filter(
		(e): e is KeepEntry =>
			!!e && typeof e.key === 'string' && typeof (e as KeepEntry).note === 'string',
	);
}

/** Read-modify-write under compare-and-set, so two admins' Keep edits never drop each other. */
export async function setKeep(key: string, note: string | null, userId: string): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const raw = await getAppSetting(KEEP_SETTING);
		const list = parseKeep(raw).filter((e) => e.key !== key);
		if (note !== null) list.push({ key, note: note.trim() || 'Kept' });
		if (await compareAndSetAppSetting(KEEP_SETTING, raw, JSON.stringify(list), userId)) return;
	}
	throw new VolumeActionError(409, 'The Keep list kept changing — try again.');
}

// --- Volume facts + render guard ---------------------------------------------------------

export interface VolumeInfo {
	name: string;
	sizeGb: number;
	dataCenterId: string;
}

let volumeInfoCache: { at: number; info: VolumeInfo | null } | null = null;

/** The volume's PROVISIONED size, which is what RunPod bills, from its GraphQL API. */
async function readVolumeInfo(): Promise<VolumeInfo | null> {
	if (volumeInfoCache && Date.now() - volumeInfoCache.at < VOLUME_INFO_TTL_MS) {
		return volumeInfoCache.info;
	}
	const res = await gql('query { myself { networkVolumes { id name size dataCenterId } } }');
	const volumes = (res?.data as { myself?: { networkVolumes?: unknown } } | undefined)?.myself
		?.networkVolumes;
	let info: VolumeInfo | null = null;
	if (Array.isArray(volumes)) {
		const v = volumes.find((x) => (x as { id?: unknown })?.id === ENV.RUNPOD_VOLUME_ID) as
			{ name?: string; size?: number; dataCenterId?: string } | undefined;
		if (v && typeof v.size === 'number') {
			info = { name: v.name ?? '', sizeGb: v.size, dataCenterId: v.dataCenterId ?? '' };
		}
	}
	volumeInfoCache = { at: Date.now(), info };
	return info;
}

export interface RenderActivity {
	/** Jobs queued or running on the serverless endpoint; null = could not tell. */
	endpointJobs: number | null;
	runningPods: string[];
}

async function runningPods(): Promise<string[]> {
	const fleet = await getEffectiveFleet();
	const states = await Promise.all(fleet.map(async (p) => ({ p, s: await podStatus(p.id) })));
	return states.filter((x) => x.s === 'running' || x.s === 'starting').map((x) => x.p.label);
}

/** Jobs queued or running on the serverless endpoint; null = not configured or no answer. */
async function endpointJobs(): Promise<number | null> {
	if (!ENV.RUNPOD_ENDPOINT_ID || !ENV.RUNPOD_API_KEY) return null;
	try {
		const res = await fetch(
			`https://api.runpod.ai/v2/${encodeURIComponent(ENV.RUNPOD_ENDPOINT_ID)}/health`,
			{
				headers: { authorization: `Bearer ${ENV.RUNPOD_API_KEY}` },
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!res.ok) return null;
		const body = (await res.json()) as { jobs?: { inQueue?: number; inProgress?: number } };
		return Number(body.jobs?.inQueue ?? 0) + Number(body.jobs?.inProgress ?? 0);
	} catch (e) {
		console.error('[volume-models] endpoint health unreachable:', e);
		return null;
	}
}

async function renderActivity(): Promise<RenderActivity> {
	const [pods, jobs] = await Promise.all([runningPods(), endpointJobs()]);
	return { endpointJobs: jobs, runningPods: pods };
}

// --- The view ----------------------------------------------------------------------------

export interface MirrorOnlyRow {
	key: string;
	folder: string;
	path: string;
	size: number;
	/** false = removed from the volume on purpose; true = the volume simply never got it. */
	expected: boolean;
	/**
	 * false = the object is in R2 with no manifest entry — an upload whose copy never finished.
	 * Desktops cannot see it; **copy to volume** finishes the job and indexes it.
	 */
	indexed: boolean;
}

export interface VolumeView {
	configured: boolean;
	missing: string[];
	label: string;
	readAt: string | null;
	refreshing: boolean;
	error: string | null;
	volume: VolumeInfo | null;
	usedBytes: number;
	folders: FolderGroup[];
	mirrorOnly: MirrorOnlyRow[];
	pendingUploads: number;
	activity: RenderActivity;
	canCheckRenders: boolean;
	jobs: TransferJob[];
}

function manifestByKey(models: ManifestEntry[]): Map<string, ManifestEntry> {
	return new Map(models.map((m) => [m.key, m]));
}

async function buildRows(
	files: VolumeFile[],
	forceBlueprints = false,
): Promise<{ rows: ModelRow[]; manifest: ManifestEntry[] }> {
	const [blueprints, keep, manifest] = await Promise.all([
		readBlueprints(forceBlueprints),
		readKeepList(),
		readManifest()
			.then((m) => m.models)
			.catch((e) => {
				console.error('[volume-models] manifest unreadable:', e);
				return [] as ManifestEntry[];
			}),
	]);
	const keepByKey = new Map(keep.map((k) => [k.key, k]));
	const mirror = manifestByKey(manifest);
	const rows = files.map((f) => {
		const m = mirror.get(mirrorKey(f));
		return {
			...f,
			usedBy: usesOf(f, blueprints),
			keep: keepByKey.get(f.key) ?? null,
			mirror: m ? { size: Number(m.size ?? 0), volume: m.volume !== false } : null,
		};
	});
	return { rows, manifest };
}

export async function volumeView(opts: { refresh?: boolean } = {}): Promise<VolumeView> {
	const store = volumeStore();
	const missing = store.missing();
	const configured = missing.length === 0;
	if (configured) {
		await loadSnapshot();
		if (opts.refresh || !snapshot) void refreshListing();
	}
	const files = (snapshot?.objects ?? [])
		.map(toVolumeFile)
		.filter((f): f is VolumeFile => f !== null);
	const [{ rows, manifest }, volume, activity, pending, mirrorObjects] = await Promise.all([
		buildRows(files),
		readVolumeInfo(),
		renderActivity(),
		configured ? store.pendingUploads(VOLUME_MODELS_ROOT).catch(() => []) : Promise.resolve([]),
		listAllObjects(`${MIRROR_PREFIX}/`).catch((e) => {
			console.error('[volume-models] could not list the R2 mirror:', e);
			return [];
		}),
	]);
	const onVolume = new Set(files.map((f) => mirrorKey(f)));
	const indexed = new Set(manifest.map((m) => m.key));
	const candidates = [
		...manifest.map((m) => ({
			key: m.key,
			size: Number(m.size ?? 0),
			expected: m.volume !== false,
			indexed: true,
		})),
		...mirrorObjects
			.filter((o) => !indexed.has(o.key))
			.map((o) => ({ key: o.key, size: o.size, expected: true, indexed: false })),
	];
	const mirrorOnly: MirrorOnlyRow[] = snapshot
		? candidates
				.filter((m) => m.key.startsWith(`${MIRROR_PREFIX}/`) && !onVolume.has(m.key))
				.map((m) => {
					const rel = m.key.slice(MIRROR_PREFIX.length + 1);
					const slash = rel.indexOf('/');
					return {
						...m,
						folder: slash < 0 ? '' : rel.slice(0, slash),
						path: slash < 0 ? rel : rel.slice(slash + 1),
					};
				})
				.filter((m) => m.folder && isModelFile(m.path))
		: [];
	return {
		configured,
		missing,
		label: store.label,
		readAt: snapshot?.readAt ?? null,
		refreshing: refreshing !== null,
		error: lastRefreshError,
		volume,
		usedBytes: rows.reduce((n, r) => n + r.size, 0),
		folders: groupByFolder(rows),
		mirrorOnly,
		pendingUploads: pending.length,
		activity,
		canCheckRenders: !!ENV.RUNPOD_ENDPOINT_ID,
		jobs: listJobs(),
	};
}

// --- Delete ------------------------------------------------------------------------------

export class VolumeActionError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

export interface DeleteRequest {
	key: string;
	confirmBlueprints: string[];
	confirmKeep: boolean;
	/** Also delete the R2 mirror copy and its manifest entry — desktops stop syncing it. */
	alsoMirror: boolean;
}

/**
 * Delete one model file from the volume. Re-derives everything the page showed — the file's
 * users read fresh from R2, its Keep, a transfer writing it, renders in flight — because the
 * page may be minutes old. Without `alsoMirror` a mirrored file stays in R2 and its manifest
 * entry is marked `volume: false`, so `pull-models.py` will not quietly put it back and
 * **Copy to volume** can restore it.
 */
export async function deleteFromVolume(req: DeleteRequest, by: string): Promise<void> {
	const store = volumeStore();
	if (store.missing().length) throw new VolumeActionError(503, 'The volume is not configured.');
	const file = toVolumeFile({ key: req.key, size: 0, modified: null });
	if (!file) throw new VolumeActionError(400, 'That is not a model file on the volume.');
	if (jobs.some((j) => j.state === 'running' && j.target === req.key)) {
		throw new VolumeActionError(409, 'A transfer is writing this file right now.');
	}
	const head = await store.head(req.key);
	if (!head) throw new VolumeActionError(404, 'The file is no longer on the volume — Refresh.');

	const { rows } = await buildRows([{ ...file, size: head.size }], true);
	const refusal = deleteRefusal(rows[0], {
		blueprints: req.confirmBlueprints,
		keep: req.confirmKeep,
	});
	if (refusal) throw new VolumeActionError(409, refusal);

	const pods = await runningPods();
	if (pods.length) {
		throw new VolumeActionError(
			409,
			`${pods.join(', ')} ${pods.length > 1 ? 'are' : 'is'} running on this volume — stop ` +
				'it first, so nothing loads the file while it goes.',
		);
	}
	// Last, so the answer is as fresh as it can be when the file goes.
	const queued = await endpointJobs();
	if (ENV.RUNPOD_ENDPOINT_ID && queued === null) {
		throw new VolumeActionError(
			503,
			'Could not ask the serverless endpoint whether a render is running — try again.',
		);
	}
	if (queued) {
		throw new VolumeActionError(
			409,
			`${queued} render job(s) are queued or running on the serverless endpoint — a worker may be ` +
				'loading this file. Try again when they finish.',
		);
	}

	// Mark the mirror entry BEFORE the file goes: a mark on a file still present is harmless,
	// a delete with no mark is one `pull-models.py` silently undoes. No entry = a no-op.
	const r2Key = mirrorKey(file);
	await updateManifest(setOnVolume(r2Key, false));
	await store.remove(req.key);
	console.log(`[volume-models] ${by} deleted ${req.key} (${head.size} bytes)`);
	patchSnapshot((objects) => objects.filter((o) => o.key !== req.key));

	if (req.alsoMirror && rows[0].mirror) {
		// Entry first, object second: an orphaned object is harmless, a dangling entry 404s.
		await updateManifest(removeEntry(r2Key));
		await deleteObject(r2Key);
		console.log(`[volume-models] ${by} removed ${r2Key} from the R2 mirror`);
	}
}

export async function abortPendingUploads(): Promise<number> {
	const store = volumeStore();
	const pending = await store.pendingUploads(VOLUME_MODELS_ROOT);
	const live = new Set(jobs.filter((j) => j.state === 'running').map((j) => j.target));
	let n = 0;
	for (const u of pending) {
		if (live.has(u.key)) continue;
		await store.abortUpload(u.key, u.uploadId);
		n++;
	}
	return n;
}

// --- Transfers (R2 mirror or a public URL → the volume) ----------------------------------

export interface TransferJob {
	id: string;
	source: string;
	target: string;
	/** Also written into the R2 mirror + manifest (always, for an R2 source). */
	mirror: boolean;
	bytes: number;
	total: number | null;
	state: 'running' | 'done' | 'failed' | 'cancelled';
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	by: string;
}

const jobs: TransferJob[] = [];
const cancelled = new Set<string>();
const MAX_KEPT_JOBS = 20;

function listJobs(): TransferJob[] {
	return jobs.map((j) => ({ ...j }));
}

export function cancelTransfer(id: string): boolean {
	const job = jobs.find((j) => j.id === id && j.state === 'running');
	if (!job) return false;
	cancelled.add(id);
	return true;
}

const MAX_REDIRECTS = 5;

/**
 * Open a public https download, refusing any hop — the first URL or a redirect — that names or
 * resolves to a private address, so this can never be pointed at Railway's internal network.
 */
async function openPublicUrl(raw: string): Promise<Response> {
	let url = raw;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') throw new VolumeActionError(400, 'Only https:// URLs.');
		if (parsed.username || parsed.password) {
			throw new VolumeActionError(400, 'A URL cannot carry a user name or password.');
		}
		if (isPrivateComfyHost(parsed.hostname)) {
			throw new VolumeActionError(400, `${parsed.hostname} is a private address.`);
		}
		const addrs = await lookup(parsed.hostname, { all: true });
		if (addrs.some((a) => isPrivateComfyHost(a.address))) {
			throw new VolumeActionError(400, `${parsed.hostname} resolves to a private address.`);
		}
		const res = await fetch(url, {
			redirect: 'manual',
			headers: { 'user-agent': 'InvisibleLauncher/1.0' },
			signal: AbortSignal.timeout(60_000),
		});
		const location = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && location) {
			url = new URL(location, url).toString();
			continue;
		}
		if (!res.ok || !res.body) {
			throw new VolumeActionError(502, `The download answered HTTP ${res.status}.`);
		}
		return res;
	}
	throw new VolumeActionError(502, 'The download redirected too many times.');
}

export interface TransferRequest {
	/** An R2 mirror key (`comfyui-models/…`) or a public https URL. */
	source: string;
	folder: string;
	path: string;
	/** For a URL source: also keep a copy in the R2 mirror (so desktops can Sync it). */
	mirror: boolean;
}

/**
 * Start a copy onto the volume and return at once; the page polls the job. One at a time —
 * each holds a 64 MB part in memory, and this service has been OOM-killed before.
 */
export async function startTransfer(req: TransferRequest, by: string): Promise<TransferJob> {
	const store = volumeStore();
	if (store.missing().length) throw new VolumeActionError(503, 'The volume is not configured.');
	const target = `${VOLUME_MODELS_ROOT}${req.folder}/${req.path}`;
	const fromR2 = req.source.startsWith(`${MIRROR_PREFIX}/`);
	if (fromR2 && req.source !== mirrorKey(req)) {
		throw new VolumeActionError(400, 'A mirror file is copied to its own folder and name.');
	}
	if (!fromR2 && !/^https:\/\//i.test(req.source)) {
		throw new VolumeActionError(400, 'The source must be an R2 mirror key or an https:// URL.');
	}
	// Reserve the slot before any await, so two starts in the same instant cannot both pass.
	if (transferRunning()) {
		throw new VolumeActionError(409, 'A transfer is already running — wait for it to finish.');
	}
	const job: TransferJob = {
		id: randomUUID(),
		source: req.source,
		target,
		mirror: fromR2 || req.mirror,
		bytes: 0,
		total: null,
		state: 'running',
		error: null,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		by,
	};
	jobs.unshift(job);
	jobs.splice(MAX_KEPT_JOBS);
	try {
		if (await store.head(target)) {
			throw new VolumeActionError(409, 'That file is already on the volume. Delete it first.');
		}
	} catch (e) {
		jobs.splice(jobs.indexOf(job), 1);
		throw e;
	}
	void runTransfer(job, fromR2).catch((e) => {
		job.state = cancelled.has(job.id) ? 'cancelled' : 'failed';
		job.error = job.state === 'cancelled' ? null : e instanceof Error ? e.message : String(e);
		job.finishedAt = new Date().toISOString();
		cancelled.delete(job.id);
		console.error(`[volume-models] transfer ${job.id} ${job.state}:`, e);
	});
	return { ...job };
}

export function transferRunning(): boolean {
	return jobs.some((j) => j.state === 'running');
}

interface Sink {
	put(n: number, body: Uint8Array): Promise<void>;
	complete(): Promise<void>;
	abort(): Promise<void>;
}

function volumeSink(upload: VolumeUpload): Sink {
	return {
		put: (n, body) => upload.putPart(n, body),
		complete: () => upload.complete(),
		abort: () => upload.abort(),
	};
}

async function runTransfer(job: TransferJob, fromR2: boolean): Promise<void> {
	const store = volumeStore();
	const r2Key = `${MIRROR_PREFIX}/${job.target.slice(VOLUME_MODELS_ROOT.length)}`;
	let body: ReadableStream<Uint8Array>;
	if (fromR2) {
		const obj = await getObjectStream(job.source);
		if (!obj) throw new Error(`${job.source} is not in the R2 mirror.`);
		body = obj.body as ReadableStream<Uint8Array>;
		job.total = obj.contentLength;
	} else {
		if (job.mirror && (await headObject(r2Key))) {
			throw new Error(`${r2Key} is already in the R2 mirror — use Copy to volume instead.`);
		}
		const res = await openPublicUrl(job.source);
		const len = Number(res.headers.get('content-length'));
		job.total = Number.isFinite(len) && len > 0 ? len : null;
		body = res.body as ReadableStream<Uint8Array>;
	}

	const sinks: Sink[] = [volumeSink(await store.createUpload(job.target))];
	if (!fromR2 && job.mirror) sinks.push(await r2Sink(r2Key));
	const hash = createHash('sha256');
	const reader = body.getReader();
	let buffer = new Uint8Array(PART_BYTES);
	let filled = 0;
	let part = 0;

	const flush = async () => {
		if (filled === 0) return;
		part++;
		const chunk = buffer.subarray(0, filled);
		for (const sink of sinks) await sink.put(part, chunk);
		buffer = new Uint8Array(PART_BYTES);
		filled = 0;
	};

	try {
		for (;;) {
			if (cancelled.has(job.id)) throw new Error('Cancelled.');
			const { done, value } = await reader.read();
			if (done) break;
			hash.update(value);
			job.bytes += value.byteLength;
			let offset = 0;
			while (offset < value.byteLength) {
				const n = Math.min(PART_BYTES - filled, value.byteLength - offset);
				buffer.set(value.subarray(offset, offset + n), filled);
				filled += n;
				offset += n;
				if (filled === PART_BYTES) await flush();
			}
		}
		await flush();
		if (part === 0) throw new Error('The source was empty.');
		if (job.total !== null && job.bytes !== job.total) {
			throw new Error(`Read ${job.bytes} bytes but the source declared ${job.total}.`);
		}
		for (const sink of sinks) await sink.complete();
	} catch (e) {
		await reader.cancel().catch(() => {});
		await Promise.all(sinks.map((s) => s.abort().catch(() => {})));
		throw e;
	}

	const landed = await store.head(job.target);
	if (!landed || landed.size !== job.bytes) {
		throw new Error(`The volume holds ${landed?.size ?? 0} bytes, not the ${job.bytes} sent.`);
	}
	if (job.mirror) {
		const entry = entryFor(r2Key, job.bytes, hash.digest('hex'));
		const upsert = upsertEntry(entry);
		const onVolume = setOnVolume(r2Key, true);
		await updateManifest((models) => upsert(models) && (onVolume(models) || true));
	}
	patchSnapshot((objects) => [
		...objects.filter((o) => o.key !== job.target),
		{ key: job.target, size: job.bytes, modified: new Date().toISOString() },
	]);
	job.state = 'done';
	job.finishedAt = new Date().toISOString();
	console.log(
		`[volume-models] ${job.by} copied ${job.source} → ${job.target} (${job.bytes} bytes)`,
	);
}

async function r2Sink(key: string): Promise<Sink> {
	const uploadId = await createMultipartUpload(key, 'application/octet-stream');
	return {
		put: (n, body) => uploadPart(key, uploadId, n, body),
		complete: async () => {
			await completeMultipartUpload(key, uploadId);
		},
		abort: () => abortMultipartUpload(key, uploadId),
	};
}
