import { error } from '@sveltejs/kit';
import { RUNTIMES } from 'constants-shared/runtimes';
import { createKeyedMutex } from './concurrency';
import { githubApp, type GithubApp } from './githubApp';
import { blobSha } from './pipelineAgents';
import { approverName, forgetChanges, isOnHold, readPull, repo } from './pipelineChanges';
import { locateCentralDirectory, parseCentralDirectory, readZipEntry, type ZipEntry } from './zip';

/**
 * Re-record runtime bytes from Invisible Pipeline Changes. A change that edits what the released
 * runtimes are built from fails `check:runtime-bytes` until `scripts/runtime-bytes/<id>.json` say
 * the new bytes; those are Linux's, and the failed CI run uploads the ones it built as the
 * `runtime-bytes` artifact (`.github/workflows/runtime-bytes.yml`). This takes them from there,
 * as the App, and commits them onto the change's own branch: no build here, no other file, and
 * only after the artifact has been read as strictly as the gate itself writes it.
 */

export const RUNTIME_BYTES_WORKFLOW_PATH = '.github/workflows/runtime-bytes.yml';
export const RUNTIME_BYTES_ARTIFACT = 'runtime-bytes';
const MANIFEST_DIR = 'scripts/runtime-bytes';
/** The manifests are ~48 kB each today; these leave room to grow and none to hide a payload. */
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const ARTIFACT_TIMEOUT_MS = 60_000;

export type RuntimeBytesCode =
	'no_run' | 'no_artifact' | 'head_moved' | 'invalid_artifact' | 'nothing_to_change' | 'on_hold';

/** A refusal: 409, with the sentence for the page and a code to tell the cases apart. */
function refuse(code: RuntimeBytesCode, message: string): never {
	throw error(409, { message, code });
}

interface RuntimeRow {
	id: string;
	families: string;
	view?: string;
}
const ROWS: readonly RuntimeRow[] = RUNTIMES;

const SHA256 = /^[0-9a-f]{64}$/;
const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: string[]): boolean =>
	Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** A build-relative file path as the gate records one: never absolute, never a way out. */
function isBuildPath(path: string): boolean {
	if (!path || path.length > 300 || path.startsWith('/') || path.includes('\\')) return false;
	if ([...path].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return false;
	return path.split('/').every((part) => part && part !== '.' && part !== '..');
}

/** Code is `index.html` and `_app/immutable/**`: what `manifestOf` puts under `files`. */
const isCodePath = (path: string): boolean =>
	path === 'index.html' || path.startsWith('_app/immutable/');

/**
 * One manifest as `check-runtime-bytes.mjs` writes it, or a 409 saying what is off. Returns the
 * text the gate would have written (tab-indented, a newline at the end), rebuilt from the checked
 * fields in the gate's own key order, so what is committed is only what was validated.
 */
export function validateManifest(row: RuntimeRow, text: string): string {
	const bad = (why: string): never =>
		refuse('invalid_artifact', `The ${row.id} manifest in the artifact is not valid: ${why}.`);
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return bad('it is not JSON');
	}
	if (!isObject(raw)) return bad('it is not an object');
	const threeD = row.view === '3d';
	const keys = ['runtime', 'PUBLIC_IE_FAMILIES', ...(threeD ? ['PUBLIC_IE_3D'] : [])];
	if (!sameKeys(raw, [...keys, 'files', 'other', 'total']))
		return bad('its keys are not the gate’s');
	if (raw.runtime !== row.id) return bad('it names another runtime');
	if (raw.PUBLIC_IE_FAMILIES !== row.families) return bad('its families differ from the runtime’s');
	if (threeD && raw.PUBLIC_IE_3D !== '1') return bad('its PUBLIC_IE_3D differs from the runtime’s');
	const { files, other, total } = raw;
	if (!isObject(files) || !isObject(other) || !isObject(total)) {
		return bad('files, other and total must be objects');
	}
	if (Object.keys(files).length + Object.keys(other).length > MAX_ENTRIES)
		return bad('too many files');
	const codeOut: Record<string, { sha256: string; gzip: number }> = {};
	let gzip = 0;
	for (const [path, entry] of Object.entries(files)) {
		if (!isBuildPath(path) || !isCodePath(path))
			return bad(`${path.slice(0, 80)} is not a code path`);
		if (!isObject(entry) || !sameKeys(entry, ['sha256', 'gzip']))
			return bad(`${path} has other fields`);
		if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256) || !isCount(entry.gzip)) {
			return bad(`${path} has no sha256 and gzip size`);
		}
		codeOut[path] = { sha256: entry.sha256, gzip: entry.gzip };
		gzip += entry.gzip;
	}
	const otherOut: Record<string, { sha256: string }> = {};
	for (const [path, entry] of Object.entries(other)) {
		if (!isBuildPath(path) || isCodePath(path))
			return bad(`${path.slice(0, 80)} is not an other path`);
		if (!isObject(entry) || !sameKeys(entry, ['sha256'])) return bad(`${path} has other fields`);
		if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) {
			return bad(`${path} has no sha256`);
		}
		otherOut[path] = { sha256: entry.sha256 };
	}
	if (!sameKeys(total, ['files', 'gzip'])) return bad('its total has other fields');
	if (total.files !== Object.keys(codeOut).length || total.gzip !== gzip) {
		return bad('its total does not add up');
	}
	const out = {
		runtime: row.id,
		PUBLIC_IE_FAMILIES: row.families,
		...(threeD ? { PUBLIC_IE_3D: '1' } : {}),
		files: codeOut,
		other: otherOut,
		total: { files: Object.keys(codeOut).length, gzip },
	};
	return `${JSON.stringify(out, null, '\t')}\n`;
}

/**
 * The manifests an artifact holds, validated: `<id>.json` at its root for ids in the runtime list
 * and nothing else, each and the whole under a size cap. Returns `[id, text]` in the list's order;
 * anything else is a 409 `invalid_artifact` naming it.
 */
export function validateArtifact(zip: Buffer): [string, string][] {
	const bad = (why: string): never =>
		refuse('invalid_artifact', `The artifact is not valid: ${why}.`);
	if (zip.length > MAX_ARTIFACT_BYTES)
		return bad('it is larger than a runtime-bytes artifact can be');
	let entries: ZipEntry[];
	try {
		const cd = locateCentralDirectory(zip, 0);
		entries = parseCentralDirectory(zip.subarray(cd.offset, cd.offset + cd.size), cd.count);
	} catch {
		return bad('it is not a readable zip');
	}
	if (!entries.length) return bad('it holds no files');
	const names = new Set<string>();
	let declared = 0;
	for (const e of entries) {
		const id = /^([a-z0-9]+)\.json$/.exec(e.name)?.[1];
		if (!id || !ROWS.some((r) => r.id === id))
			return bad(`${e.name.slice(0, 80)} is not a runtime's manifest`);
		if (names.has(e.name)) return bad(`${e.name} is there twice`);
		names.add(e.name);
		if (e.size > MAX_MANIFEST_BYTES) return bad(`${e.name} is larger than a manifest can be`);
		declared += e.size;
	}
	if (declared > MAX_ARTIFACT_BYTES)
		return bad('its files add up to more than a runtime-bytes artifact can be');
	const out: [string, string][] = [];
	for (const row of ROWS) {
		const name = `${row.id}.json`;
		if (!names.has(name)) continue;
		let body: Buffer | null;
		try {
			body = readZipEntry(zip, name, MAX_MANIFEST_BYTES);
		} catch {
			return bad(`${name} cannot be unpacked`);
		}
		if (!body) return bad(`${name} cannot be unpacked`);
		out.push([row.id, validateManifest(row, body.toString('utf8'))]);
	}
	return out;
}

interface GhRun {
	id: number;
	path: string;
	event: string;
	status: string | null;
	conclusion: string | null;
	head_sha: string;
	repository?: { full_name: string };
	head_repository?: { full_name: string } | null;
}

interface GhArtifact {
	id: number;
	name: string;
	expired: boolean;
	size_in_bytes: number;
}

/** The runtime-bytes run of THIS repository that CI made for the pull request on `sha`; newest. */
export const runtimeBytesRunOf = (runs: GhRun[], sha: string): GhRun | undefined =>
	runs
		.filter(
			(r) =>
				r.path === RUNTIME_BYTES_WORKFLOW_PATH &&
				r.event === 'pull_request' &&
				r.head_sha === sha &&
				r.repository?.full_name === repo() &&
				r.head_repository?.full_name === repo(),
		)
		.sort((a, b) => b.id - a.id)[0];

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** One line, no backticks: the name goes into a commit message, where a bare `@name` pages someone. */
export const clickerOf = (user: Parameters<typeof approverName>[0]): string =>
	approverName(user)
		.replace(/[`@\s]+/g, ' ')
		.trim() || 'a launcher user';

export const rerecordMessage = (number: number): string =>
	`ci: re-record runtime bytes from CI's Linux build (#${number})`;

export interface RerecordResult {
	number: number;
	commit: string;
	runtimes: string[];
	runId: number;
}

/** Two clicks on one change at once would commit twice from the same head; the second finds it moved. */
const recording = createKeyedMutex();

/**
 * Commit the manifests of the change's failed `runtime-bytes` run onto its branch. `headSha` is the
 * head the page showed: a head that moved since is a 409, as is every case that has nothing to
 * take (no run, no artifact, an artifact that fails validation, manifests that already match).
 * The ref moves with `force: false` from the very head the run built, so a push that lands during
 * this call is never overwritten. The caller has passed the `pipelineMerge` gate.
 */
export async function rerecordRuntimeBytes(
	input: { number: number; headSha: string; user: Parameters<typeof approverName>[0] },
	app: GithubApp = githubApp,
): Promise<RerecordResult> {
	const { number, headSha } = input;
	return recording(String(number), async () => {
		const r = repo();
		const pull = await readPull(number, app);
		if (pull.state !== 'open') throw error(409, `#${number} is not open.`);
		if (isOnHold(pull)) refuse('on_hold', `#${number} is on hold: resume it first.`);
		if (pull.head.sha !== headSha) {
			refuse(
				'head_moved',
				`#${number} has a new head (${pull.head.sha.slice(0, 7)}) since this page was read; reload it.`,
			);
		}
		const { workflow_runs } = await app.json<{ workflow_runs: GhRun[] }>(
			`/repos/${r}/actions/runs?head_sha=${headSha}&per_page=100`,
		);
		const run = runtimeBytesRunOf(workflow_runs, headSha);
		if (!run) refuse('no_run', 'CI has no runtime-bytes run for this head.');
		if (run.status !== 'completed')
			refuse('no_run', 'The runtime-bytes run for this head has not finished.');
		if (run.conclusion === 'success') {
			refuse(
				'nothing_to_change',
				'The runtime-bytes run for this head passed: the manifests match.',
			);
		}
		const { artifacts } = await app.json<{ artifacts: GhArtifact[] }>(
			`/repos/${r}/actions/runs/${run.id}/artifacts?name=${RUNTIME_BYTES_ARTIFACT}&per_page=10`,
		);
		const artifact = artifacts
			.filter((a) => a.name === RUNTIME_BYTES_ARTIFACT && !a.expired)
			.sort((a, b) => b.id - a.id)[0];
		if (!artifact) {
			refuse(
				'no_artifact',
				'The runtime-bytes run left no manifests to take (GitHub keeps them for a time).',
			);
		}
		if (artifact.size_in_bytes > MAX_ARTIFACT_BYTES) {
			refuse(
				'invalid_artifact',
				'The artifact is not valid: it is larger than a runtime-bytes artifact can be.',
			);
		}
		const res = await app.download(`/repos/${r}/actions/artifacts/${artifact.id}/zip`, {
			timeoutMs: ARTIFACT_TIMEOUT_MS,
		});
		if (!res.ok) {
			refuse('no_artifact', `GitHub ${res.status} when the manifests were downloaded.`);
		}
		const manifests = validateArtifact(Buffer.from(await res.arrayBuffer()));

		const listing = await app.json<{ name: string; sha: string }[]>(
			`/repos/${r}/contents/${MANIFEST_DIR}?ref=${headSha}`,
		);
		const current = new Map(listing.map((f) => [f.name, f.sha]));
		const changed = manifests.filter(([id, text]) => current.get(`${id}.json`) !== blobSha(text));
		if (!changed.length) {
			refuse(
				'nothing_to_change',
				'The manifests in the artifact are the ones already on this branch.',
			);
		}

		const base = await app.json<{ tree: { sha: string } }>(`/repos/${r}/git/commits/${headSha}`);
		const blobs = await Promise.all(
			changed.map(([, text]) =>
				app.json<{ sha: string }>(`/repos/${r}/git/blobs`, {
					method: 'POST',
					body: JSON.stringify({ content: text, encoding: 'utf-8' }),
				}),
			),
		);
		const tree = await app.json<{ sha: string }>(`/repos/${r}/git/trees`, {
			method: 'POST',
			body: JSON.stringify({
				base_tree: base.tree.sha,
				tree: changed.map(([id], i) => ({
					path: `${MANIFEST_DIR}/${id}.json`,
					mode: '100644',
					type: 'blob',
					sha: blobs[i].sha,
				})),
			}),
		});
		const ids = changed.map(([id]) => id);
		const made = await app.json<{ sha: string }>(`/repos/${r}/git/commits`, {
			method: 'POST',
			body: JSON.stringify({
				message: `${rerecordMessage(number)}\n\nRe-recorded ${ids.join(', ')} from Invisible Pipeline Changes, clicked by ${clickerOf(input.user)}.`,
				tree: tree.sha,
				parents: [headSha],
			}),
		});
		const moved = await app.fetch(`/repos/${r}/git/refs/heads/${encodePath(pull.head.ref)}`, {
			method: 'PATCH',
			body: JSON.stringify({ sha: made.sha, force: false }),
		});
		if (moved.status === 422) {
			refuse(
				'head_moved',
				`The branch of #${number} moved while the manifests were committed; reload it.`,
			);
		}
		if (!moved.ok) {
			const body = (await moved.json().catch(() => null)) as { message?: string } | null;
			throw error(
				502,
				`GitHub ${moved.status} moving the branch: ${body?.message ?? moved.statusText}`,
			);
		}
		forgetChanges();
		return { number, commit: made.sha, runtimes: ids, runId: run.id };
	});
}
