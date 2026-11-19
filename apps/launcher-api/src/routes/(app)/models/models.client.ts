/**
 * The Invisible Model Viewer's calls to `/api/models*`, and the upload of a master GLB: a presigned
 * PUT straight to R2 (the launcher never sees the bytes), then a register that validates and
 * commits it.
 */
import type { ModelClass } from 'constants-shared/modelTiers';
import { CLASS_NAME_PREFIX } from '$lib/models/modelReport';
import type { ModelDoc, ModelValidatorIssue } from '$lib/server/modelStorage';
import type { ModelDerivedIndex, ModelDetail, ModelListEntry } from '$lib/server/modelViewer';

const api = (path: string, project: string, query = ''): string =>
	`/api/models${path}?project=${encodeURIComponent(project)}${query}`;

interface ErrorBody {
	message?: string;
	error?: string;
	issues?: ModelValidatorIssue[];
}

async function bodyOf<T>(res: Response): Promise<T & ErrorBody> {
	return (await res.json().catch(() => ({}))) as T & ErrorBody;
}

/** A failed answer's reason: SvelteKit's `error()` sends `message`, the routes' own JSON `error`. */
const reasonOf = (res: Response, body: ErrorBody): string =>
	(body.message ?? (body.error && body.error !== 'conflict' ? body.error : '')) ||
	`HTTP ${res.status}`;

const post = (url: string, body: unknown): Promise<Response> =>
	fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

export async function fetchModels(project: string): Promise<ModelListEntry[]> {
	const res = await fetch(api('', project));
	const body = await bodyOf<{ models?: ModelListEntry[] }>(res);
	if (!res.ok) throw new Error(reasonOf(res, body));
	return body.models ?? [];
}

export async function fetchDetail(project: string, id: string): Promise<ModelDetail> {
	const res = await fetch(api('/detail', project, `&id=${encodeURIComponent(id)}`));
	const body = await bodyOf<ModelDetail>(res);
	if (!res.ok) throw new Error(reasonOf(res, body));
	return body;
}

export type SaveAnswer =
	| { ok: true; doc: ModelDoc; etag: string | null; deriveInputs: string }
	| { ok: false; conflict: boolean; message: string; issues: ModelValidatorIssue[] };

export async function postSave(
	project: string,
	body: {
		id: string;
		baseEtag: string;
		class: ModelClass;
		overrides: unknown;
		lodScreenSize: unknown;
	},
): Promise<SaveAnswer> {
	const res = await post(api('/save', project), body);
	const out = await bodyOf<{ doc?: ModelDoc; etag?: string | null; deriveInputs?: string }>(res);
	if (res.ok && out.doc)
		return {
			ok: true,
			doc: out.doc,
			etag: out.etag ?? null,
			deriveInputs: out.deriveInputs ?? '',
		};
	return {
		ok: false,
		conflict: res.status === 409,
		message: reasonOf(res, out),
		issues: out.issues ?? [],
	};
}

export async function postDerive(
	project: string,
	id: string,
): Promise<{ derived: ModelDerivedIndex; deriveInputs: string; docEtag: string | null }> {
	const res = await post(api('/derive', project), { id });
	const out = await bodyOf<{
		derived?: ModelDerivedIndex;
		deriveInputs?: string;
		docEtag?: string | null;
	}>(res);
	if (!res.ok || !out.derived) throw new Error(reasonOf(res, out));
	return {
		derived: out.derived,
		deriveInputs: out.deriveInputs ?? '',
		docEtag: out.docEtag ?? null,
	};
}

function putWithProgress(
	url: string,
	file: File,
	contentType: string,
	onProgress: (fraction: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url);
		xhr.setRequestHeader('content-type', contentType);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(e.loaded / e.total);
		};
		xhr.onload = () =>
			xhr.status >= 200 && xhr.status < 300
				? resolve()
				: reject(new Error(`The upload failed (HTTP ${xhr.status}).`));
		xhr.onerror = () => reject(new Error('The upload failed (network error).'));
		xhr.send(file);
	});
}

/** Where the Viewer's derive of the open model stands against what is on the page. */
export type DeriveState = 'none' | 'current' | 'stale' | 'unsaved';

export type UploadPhase = 'preparing' | 'uploading' | 'validating';

export type UploadAnswer =
	| { ok: true; doc: ModelDoc; etag: string | null }
	| { ok: false; message: string; issues: ModelValidatorIssue[] };

/**
 * Upload `file` as model `id`'s master. `baseEtag` is the `model.json` ETag the page holds, or
 * `null` for a model that does not exist yet: the register refuses (409) when the model is not
 * that one any more.
 */
export async function uploadMaster(opts: {
	project: string;
	id: string;
	cls: ModelClass;
	baseEtag: string | null;
	file: File;
	onPhase: (phase: UploadPhase, fraction?: number) => void;
}): Promise<UploadAnswer> {
	const { project, id, cls, baseEtag, file, onPhase } = opts;
	try {
		onPhase('preparing');
		const presign = await post(api('/upload', project), { id, bytes: file.size });
		const ticket = await bodyOf<{ upload?: string; url?: string; contentType?: string }>(presign);
		if (!presign.ok || !ticket.upload || !ticket.url)
			return { ok: false, message: reasonOf(presign, ticket), issues: [] };

		onPhase('uploading', 0);
		await putWithProgress(ticket.url, file, ticket.contentType ?? 'model/gltf-binary', (fraction) =>
			onPhase('uploading', fraction),
		);

		onPhase('validating');
		const res = await post(api('/register', project), {
			id,
			upload: ticket.upload,
			class: cls,
			baseEtag,
		});
		const out = await bodyOf<{ doc?: ModelDoc; etag?: string | null }>(res);
		if (res.ok && out.doc) return { ok: true, doc: out.doc, etag: out.etag ?? null };
		return { ok: false, message: reasonOf(res, out), issues: out.issues ?? [] };
	} catch (e) {
		return {
			ok: false,
			message: e instanceof Error ? e.message : 'The upload failed.',
			issues: [],
		};
	}
}

const PREFIX_CLASS = new Map(
	Object.entries(CLASS_NAME_PREFIX).map(([cls, prefix]) => [prefix, cls as ModelClass]),
);

/**
 * A model id and class read off a master's file name. The id is the Blender export's own asset id,
 * the file name without `.glb`, kept EXACTLY (`PR_crate_small.glb` → `PR_crate_small`): the game
 * names the model by that string, so it is never lower-cased or otherwise rewritten here. The class
 * is the prefix's (`PR` → prop), or `null` when the name carries none.
 */
export function modelIdFromFile(fileName: string): { id: string; cls: ModelClass | null } {
	const id = fileName.replace(/\.glb$/i, '');
	const prefix = /^([A-Za-z]{2})_/.exec(id)?.[1].toUpperCase();
	return { id, cls: (prefix && PREFIX_CLASS.get(prefix)) || null };
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024)
		return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	return `${bytes} B`;
}

export const formatCount = (n: number): string => n.toLocaleString('en-US');
