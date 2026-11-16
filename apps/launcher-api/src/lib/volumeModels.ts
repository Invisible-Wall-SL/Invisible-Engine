/**
 * The RunPod Network Volume's model files, as the /comfyui "Volume models" section shows them.
 * Pure — no I/O — so `scripts/check-volume-models.ts` pins every rule here offline.
 */

/** Where ComfyUI's models live on the volume (`/workspace/ComfyUI/models` on a pod). */
export const VOLUME_MODELS_ROOT = 'ComfyUI/models/';

/** The shared model mirror in R2 — `model_mirror.MIRROR_PREFIX` in atlas-tool. */
export const MIRROR_PREFIX = 'comfyui-models';

/** Same list as atlas-tool's `blueprints.MODEL_FILE_EXTS`: a string ending in one is a model. */
export const MODEL_FILE_EXTS = [
	'.safetensors',
	'.ckpt',
	'.pt',
	'.pth',
	'.bin',
	'.sft',
	'.gguf',
	'.onnx',
] as const;

/** RunPod's network-volume rate for the first TB, $/GB/month (docs.runpod.io billing). */
export const NETWORK_VOLUME_USD_PER_GB_MONTH = 0.07;

/** Where an in-flight S3 multipart upload parks its parts on the volume. */
const S3_UPLOAD_STAGING = '.s3compat_uploads/';

export interface VolumeObject {
	key: string;
	size: number;
	modified: string | null;
}

export interface VolumeFile extends VolumeObject {
	/** First folder under `models/`, e.g. `loras`. */
	folder: string;
	/** Path inside that folder — what a ComfyUI loader input names (`sub/x.safetensors`). */
	path: string;
}

export interface BlueprintUse {
	id: string;
	name: string;
	kind: string;
}

export interface KeepEntry {
	key: string;
	note: string;
}

export interface MirrorEntry {
	size: number;
	/** `false` when the manifest marks the file as deliberately removed from the volume. */
	volume: boolean;
}

export interface ModelRow extends VolumeFile {
	usedBy: BlueprintUse[];
	keep: KeepEntry | null;
	/** The file's manifest entry in the R2 mirror, or null when it is only on the volume. */
	mirror: MirrorEntry | null;
}

export interface FolderGroup {
	folder: string;
	bytes: number;
	files: ModelRow[];
}

export function isModelFile(name: string): boolean {
	const lower = name.toLowerCase();
	return MODEL_FILE_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * An object under `ComfyUI/models/<folder>/…` that is a real model file. Folder markers, the S3
 * upload staging area, files at the models root and non-model files (a README, a `.yaml`) are
 * left out: the section is for the weights the storage bill is made of.
 */
export function toVolumeFile(obj: VolumeObject): VolumeFile | null {
	if (!obj.key.startsWith(VOLUME_MODELS_ROOT) || obj.key.endsWith('/')) return null;
	if (obj.key.includes(S3_UPLOAD_STAGING)) return null;
	const rest = obj.key.slice(VOLUME_MODELS_ROOT.length);
	const slash = rest.indexOf('/');
	if (slash <= 0) return null;
	const path = rest.slice(slash + 1);
	if (!path || !isModelFile(path)) return null;
	return { ...obj, folder: rest.slice(0, slash), path };
}

/** The volume key a `models/<folder>/<path>` file lives at — the inverse of `toVolumeFile`. */
export function volumeKey(folder: string, path: string): string {
	return `${VOLUME_MODELS_ROOT}${folder}/${path}`;
}

/** The R2 mirror key for a volume file — `comfyui-models/<folder>/<path>`, the seeder's layout. */
export function mirrorKey(file: Pick<VolumeFile, 'folder' | 'path'>): string {
	return `${MIRROR_PREFIX}/${file.folder}/${file.path}`;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ +()-]*$/;

/**
 * A folder + path someone typed for an upload, checked before it can become a key. Every
 * segment must be a plain name (no `..`, no leading dot, no backslash) and the file must be a
 * model. Returns the error to show, or null when it is fine.
 */
export function uploadTargetError(folder: string, path: string): string | null {
	if (!SAFE_SEGMENT.test(folder)) return 'Pick a models folder (letters, digits, . _ - only).';
	const parts = path.split('/');
	if (!path || parts.some((p) => !SAFE_SEGMENT.test(p))) {
		return 'The file name may only use letters, digits, spaces and . _ - + ( ) — no leading dot.';
	}
	if (!isModelFile(path)) return `The file must end in ${MODEL_FILE_EXTS.join(', ')}.`;
	return null;
}

/** The comparable form of a model reference: forward slashes, no leading `./` or `/`. */
function normaliseRef(name: string): string {
	return name
		.trim()
		.replaceAll('\\', '/')
		.replace(/^\.?\//, '');
}

/**
 * Every model filename a blueprint names, from its declared `models[]` and from any string input
 * in its graph that ends in a model extension (the same rule atlas-tool's
 * `derive_models_from_graph` uses, so a blueprint that predates `models[]` is still seen).
 */
export function blueprintModelNames(manifest: unknown, graph: unknown): Set<string> {
	const out = new Set<string>();
	const models = (manifest as { models?: unknown } | null)?.models;
	if (Array.isArray(models)) {
		for (const m of models) {
			const filename = (m as { filename?: unknown } | null)?.filename;
			if (typeof filename === 'string' && filename.trim()) out.add(normaliseRef(filename));
		}
	}
	if (graph && typeof graph === 'object') {
		for (const node of Object.values(graph as Record<string, unknown>)) {
			const inputs = (node as { inputs?: unknown } | null)?.inputs;
			if (!inputs || typeof inputs !== 'object') continue;
			for (const value of Object.values(inputs as Record<string, unknown>)) {
				if (typeof value === 'string' && isModelFile(value.trim())) out.add(normaliseRef(value));
			}
		}
	}
	return out;
}

/**
 * Which blueprints use a file. Matched on the path inside the folder and NOT on the folder:
 * ComfyUI reads several folders under more than one name (`unet` / `diffusion_models`,
 * `clip` / `text_encoders`) and a graph names only the file, so a folder test would miss real
 * uses. Over-flagging costs one extra confirmation; under-flagging breaks a render.
 */
export function usesOf(
	file: Pick<VolumeFile, 'path'>,
	blueprints: { use: BlueprintUse; names: Set<string> }[],
): BlueprintUse[] {
	const path = normaliseRef(file.path);
	return blueprints.filter((b) => b.names.has(path)).map((b) => b.use);
}

export function groupByFolder(rows: ModelRow[]): FolderGroup[] {
	const byFolder = new Map<string, ModelRow[]>();
	for (const row of rows) {
		const list = byFolder.get(row.folder) ?? [];
		list.push(row);
		byFolder.set(row.folder, list);
	}
	return [...byFolder.entries()]
		.map(([folder, files]) => ({
			folder,
			bytes: files.reduce((n, f) => n + f.size, 0),
			files: files.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path)),
		}))
		.sort((a, b) => b.bytes - a.bytes || a.folder.localeCompare(b.folder));
}

/** Monthly cost of `bytes` at a $/GB rate (decimal GB, as RunPod sizes volumes). */
export function monthlyUsd(bytes: number, usdPerGb = NETWORK_VOLUME_USD_PER_GB_MONTH): number {
	return (bytes / 1e9) * usdPerGb;
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB`;
	if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
	if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
	return `${bytes} B`;
}

/**
 * What a delete must have been confirmed against. The server re-derives the row and refuses
 * unless the request names every blueprint that uses the file (and acknowledges a Keep), so a
 * stale page — or a blueprint published after it loaded — cannot slip a used file through on
 * the first confirmation alone.
 */
export function deleteRefusal(
	row: Pick<ModelRow, 'usedBy' | 'keep'>,
	confirmed: { blueprints: string[]; keep: boolean },
): string | null {
	const named = new Set(confirmed.blueprints);
	const missing = row.usedBy.filter((b) => !named.has(b.id));
	if (missing.length) {
		return `Used by ${missing.map((b) => b.name || b.id).join(', ')} — confirm those blueprints by name to delete.`;
	}
	if (row.keep && !confirmed.keep) return `Marked Keep (${row.keep.note}) — confirm to delete.`;
	return null;
}
