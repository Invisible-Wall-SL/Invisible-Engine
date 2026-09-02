import { ENV } from './env';
import { githubConfigured, githubError, githubFetch } from './github';

/**
 * The R&D pod IMAGE: read its build state, ask CI to rebuild it, and move a pod onto a
 * build — the server half of ComfyUI Node Manager **Phase 1**
 * (`docs/design/comfyui-node-manager.md`).
 *
 * Why this exists: adding a custom node used to mean a repo checkout, a PR, a 30-minute
 * wait watched in GitHub's UI, and then the RunPod console to redeploy a pod. Everything
 * needed to do that from `/comfyui` already existed except the wiring — CI already declares
 * `workflow_dispatch`, and already tags every build with an immutable `:<sha>` next to
 * `:latest`.
 *
 * TWO different APIs, deliberately kept in one module because they are one workflow:
 * - GitHub REST for the build (dispatch + read runs), through the shared `github.ts`
 *   transport — see there for which credential it uses and why there are two candidates.
 * - RunPod REST (`https://rest.runpod.io/v1`) for the pod's image. NOT the GraphQL endpoint
 *   the rest of `runpod.ts` uses: changing a pod's image is only exposed on REST.
 *
 * Everything here is FAIL-SAFE in the same way as `runpod.ts` — no throw, and an error is
 * returned as text for the caller to SHOW rather than swallow. That is not politeness: this
 * panel's last three bugs were all invisible failures.
 */

/** The image CI publishes. Same value as `.github/workflows/atlas-comfy-pod.yml`. */
export const POD_IMAGE_REPO = 'ghcr.io/invisible-wall-sl/atlas-comfy-pod';

/** The workflow that builds it, by file name — the form GitHub's API accepts as an id. */
const BUILD_WORKFLOW = 'atlas-comfy-pod.yml';

const RUNPOD_REST = 'https://rest.runpod.io/v1';
const FETCH_TIMEOUT_MS = 8_000;

/** One CI build of the pod image. */
export interface ImageBuild {
	/** `queued` / `in_progress` / `completed` — GitHub's own vocabulary, unmapped. */
	status: string;
	/** `success` / `failure` / `cancelled` … only once `status` is `completed`. */
	conclusion?: string;
	/** The commit built — this is the immutable tag CI pushed. */
	sha: string;
	/** Run page, so a failure is one click from its log rather than a hunt. */
	url?: string;
	startedAt?: string;
	/** The full image reference a pod should be pointed at for this build. */
	image: string;
}

export interface BuildState {
	/** `false` when `GITHUB_ACTIONS_TOKEN` is unset — the UI then explains rather than fails. */
	configured: boolean;
	latest?: ImageBuild;
	/** Present only on failure, and shown verbatim. */
	error?: string;
}

/**
 * The immutable tag for a commit.
 *
 * The FULL 40-char sha, because that is literally what CI pushes (`:${{ github.sha }}` in
 * `atlas-comfy-pod.yml`). A 12-char tag was pushed to pods for a while and never existed in
 * GHCR, so RunPod answered `manifest unknown` and the pod would not create. Abbreviate for
 * display only — never for a tag.
 */
export function imageForSha(sha: string): string {
	return `${POD_IMAGE_REPO}:${sha}`;
}

interface WorkflowRun {
	status?: string;
	conclusion?: string | null;
	head_sha?: string;
	html_url?: string;
	run_started_at?: string;
	created_at?: string;
}

/**
 * The most recent build of the pod image on `main`.
 *
 * Cached briefly: the panel polls while a build runs, and GitHub's authed limit is shared
 * with everything else the launcher does against that API.
 */
let buildCache: { at: number; state: BuildState } | null = null;
const BUILD_TTL_MS = 15_000;

export async function latestImageBuild(force = false): Promise<BuildState> {
	if (!force && buildCache && Date.now() - buildCache.at < BUILD_TTL_MS) return buildCache.state;
	if (!githubConfigured()) return { configured: false };

	const repo = ENV.GITHUB_ENGINE_REPO;
	const res = await githubFetch(
		`/repos/${repo}/actions/workflows/${BUILD_WORKFLOW}/runs?branch=main&per_page=1`,
	);
	if (typeof res === 'string') return { configured: true, error: res };
	if (!res.ok) return { configured: true, error: await githubError(res) };

	const data = (await res.json().catch(() => null)) as { workflow_runs?: WorkflowRun[] } | null;
	const run = data?.workflow_runs?.[0];
	if (!run?.head_sha) {
		return { configured: true, error: 'GitHub returned no runs for the pod-image workflow.' };
	}

	const state: BuildState = {
		configured: true,
		latest: {
			status: run.status ?? 'unknown',
			conclusion: run.conclusion ?? undefined,
			sha: run.head_sha,
			url: run.html_url,
			startedAt: run.run_started_at ?? run.created_at,
			image: imageForSha(run.head_sha),
		},
	};
	buildCache = { at: Date.now(), state };
	return state;
}

/**
 * Ask CI to rebuild the image. The workflow already declares `workflow_dispatch`, so this
 * needs no change on that side — only a token allowed to press the button.
 *
 * Returns `{ ok: false, error }` rather than throwing, and busts the build cache on success
 * so the panel shows the new run on its next read instead of a stale one.
 */
export async function triggerImageBuild(): Promise<{ ok: boolean; error?: string }> {
	const repo = ENV.GITHUB_ENGINE_REPO;
	const res = await githubFetch(`/repos/${repo}/actions/workflows/${BUILD_WORKFLOW}/dispatches`, {
		method: 'POST',
		body: JSON.stringify({ ref: 'main' }),
	});
	if (typeof res === 'string') return { ok: false, error: res };
	// GitHub answers 204 with no body.
	if (res.status !== 204) return { ok: false, error: await githubError(res) };
	buildCache = null;
	return { ok: true };
}

/** The pod fields worth showing before and after an image change. */
export interface PodImageState {
	imageName?: string;
	/** Kept because they are what a careless PATCH could plausibly disturb. */
	ports?: string[];
	volumeMountPath?: string;
	networkVolumeId?: string;
}

interface RunpodRestPod {
	imageName?: string;
	ports?: unknown;
	volumeMountPath?: string;
	networkVolumeId?: string;
}

function readPodImageState(pod: RunpodRestPod | null | undefined): PodImageState {
	const ports = Array.isArray(pod?.ports) ? pod.ports.map((p) => String(p)) : undefined;
	return {
		imageName: typeof pod?.imageName === 'string' ? pod.imageName : undefined,
		ports,
		volumeMountPath: typeof pod?.volumeMountPath === 'string' ? pod.volumeMountPath : undefined,
		networkVolumeId: typeof pod?.networkVolumeId === 'string' ? pod.networkVolumeId : undefined,
	};
}

async function runpodRest(
	path: string,
	init?: RequestInit,
): Promise<{ pod?: RunpodRestPod; error?: string }> {
	const key = ENV.RUNPOD_API_KEY;
	if (!key) return { error: 'RUNPOD_API_KEY is not set on the launcher.' };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(`${RUNPOD_REST}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${key}`,
				accept: 'application/json',
				'user-agent': 'invisible-launcher',
				...(init?.body ? { 'content-type': 'application/json' } : {}),
			},
			signal: controller.signal,
		});
		const body = (await res.json().catch(() => null)) as
			| (RunpodRestPod & { error?: string; message?: string })
			| null;
		if (!res.ok) {
			return { error: `RunPod ${res.status}: ${body?.error ?? body?.message ?? res.statusText}` };
		}
		return { pod: body ?? {} };
	} catch (err) {
		return { error: err instanceof Error ? err.message : 'RunPod request failed.' };
	} finally {
		clearTimeout(timer);
	}
}

/** Read a pod's image + the config a PATCH could disturb. Pure read. */
export async function podImageState(
	podId: string,
): Promise<{ state?: PodImageState; error?: string }> {
	const { pod, error } = await runpodRest(`/pods/${encodeURIComponent(podId)}`);
	if (error) return { error };
	return { state: readPodImageState(pod) };
}

/**
 * Point a pod at a different image.
 *
 * READ FIRST, ALWAYS. The GET is not decoration — it is what makes this safe to ship without
 * ever having called RunPod's REST API from here. It validates the base URL and the auth
 * before anything mutates, so a wrong guess fails as a read; and it captures the pod's ports
 * and volume mount so the caller can prove a PATCH sending ONLY `imageName` left them alone.
 * RunPod documents this call as "potentially triggering a reset", and a reset that silently
 * dropped `/workspace` or the TCP port would cost far more than a wrong badge.
 *
 * Returns before/after so the UI can show what actually changed rather than assert success.
 */
export async function setPodImage(
	podId: string,
	imageName: string,
): Promise<{ ok: boolean; before?: PodImageState; after?: PodImageState; error?: string }> {
	const before = await podImageState(podId);
	if (before.error || !before.state) {
		return { ok: false, error: before.error ?? 'Could not read the pod before changing it.' };
	}
	if (before.state.imageName === imageName) {
		return { ok: true, before: before.state, after: before.state };
	}

	const patched = await runpodRest(`/pods/${encodeURIComponent(podId)}`, {
		method: 'PATCH',
		body: JSON.stringify({ imageName }),
	});
	if (patched.error) return { ok: false, before: before.state, error: patched.error };

	// Read back rather than trust the PATCH response: the question is what the pod IS now.
	const after = await podImageState(podId);
	return {
		ok: true,
		before: before.state,
		after: after.state ?? readPodImageState(patched.pod),
		error: after.error,
	};
}
