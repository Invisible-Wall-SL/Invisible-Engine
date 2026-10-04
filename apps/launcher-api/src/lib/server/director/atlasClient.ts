import { ENV } from '../env';
import { r2Slug } from '../projectPaths';
import { ConflictError } from '../r2';
import { LAUNCH_HEADER, mintToolLaunchToken } from '../toolLaunch';
import { AdapterError, type AdapterContext } from './adapter';

/**
 * How a Director adapter reaches the Atlas Maker (ADR-0002): over atlas-tool's own HTTP API, as the
 * run's owner, with a short-lived `api` launch token minted for the run's project that also names
 * the acting agent (`act`). atlas-tool takes scope and identity from that token only, and stamps
 * every manifest it saves for the call `saved_by.tool = 'director'` with the agent and run.
 *
 * Every call names its atlas (`?manifest=`), which atlas-tool pins for that request alone: Director
 * never switches the project's active atlas under a person working in it.
 */

/** The Atlas Maker's manifest file for an atlas id — also the doc id its CAS is keyed by. */
export const manifestFile = (atlas: string) => `atlas_manifest_${atlas}.json`;
export const manifestDocId = (atlas: string) => `manifests/${manifestFile(atlas)}`;

/** A doc version as atlas-tool's CAS compares it (`docsave.Base`). */
export interface DocBase {
	etag: string;
	rev: string;
}

export interface AtlasCall {
	method: 'GET' | 'POST';
	path: string;
	atlas?: string;
	query?: Record<string, string>;
	body?: unknown;
	/** Sent as `X-IW-Doc-Bases`: the version of each doc the write is based on. */
	bases?: Record<string, DocBase>;
}

export interface AtlasAnswer {
	status: number;
	contentType: string;
	headers: Headers;
	bytes: Uint8Array;
	text: () => string;
	json: <T>() => T;
}

export function launchHeaders(ctx: AdapterContext, now = Date.now()): Record<string, string> {
	const secret = ENV.ATLAS_TOOL_SIGNING_SECRET;
	// The legacy unsigned handoff cannot say who is acting, so no write could be attributed.
	if (!secret) {
		throw new AdapterError(
			503,
			'atlas_unconfigured',
			'The Atlas Maker handoff is not signed (ATLAS_TOOL_SIGNING_SECRET is unset).',
		);
	}
	const { owner, scope, agent, run } = ctx;
	const token = mintToolLaunchToken(
		secret,
		{
			aud: 'atlas',
			sub: r2Slug(owner.id),
			uid: owner.id,
			name: owner.name || owner.email.split('@')[0],
			role: owner.role,
			client: scope!.clientKey,
			project: scope!.projectKey,
			caps: [],
			act: { tool: 'director', agent, run: run.id },
		},
		now,
		'api',
	);
	return { [LAUNCH_HEADER]: token };
}

export async function atlasFetch(ctx: AdapterContext, call: AtlasCall): Promise<AtlasAnswer> {
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	const params = new URLSearchParams(call.query);
	if (call.atlas) params.set('manifest', manifestFile(call.atlas));
	const headers: Record<string, string> = { ...launchHeaders(ctx), accept: 'application/json' };
	if (call.body !== undefined) headers['content-type'] = 'application/json';
	if (call.bases) headers['x-iw-doc-bases'] = JSON.stringify(call.bases);
	const query = params.toString();
	let res: Response;
	try {
		res = await fetch(`${base}${call.path}${query ? `?${query}` : ''}`, {
			method: call.method,
			headers,
			body: call.body === undefined ? undefined : JSON.stringify(call.body),
			redirect: 'manual',
			signal: AbortSignal.timeout(30_000),
		});
	} catch (e) {
		throw new AdapterError(
			503,
			'atlas_unavailable',
			`Could not reach the Atlas Maker: ${(e as Error).message}`,
		);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	const text = () => new TextDecoder().decode(bytes);
	const answer: AtlasAnswer = {
		status: res.status,
		contentType: res.headers.get('content-type') ?? '',
		headers: res.headers,
		bytes,
		text,
		json: <T>() => JSON.parse(text()) as T,
	};
	if (res.status === 409) {
		// docsave's refusal: someone (a person, most often) saved the atlas since it was read.
		throw new ConflictError(call.atlas ? manifestDocId(call.atlas) : call.path);
	}
	if (res.status === 403) {
		throw new AdapterError(403, 'atlas_forbidden', 'The Atlas Maker refused the call.');
	}
	if (res.status === 404) {
		throw new AdapterError(404, 'not_found', jsonError(answer) ?? `${call.path}: not found.`);
	}
	if (res.status === 400) {
		throw new AdapterError(400, 'atlas_refused', jsonError(answer) ?? text().slice(0, 300));
	}
	if (res.status >= 300) {
		throw new AdapterError(
			503,
			'atlas_unavailable',
			`The Atlas Maker answered ${res.status} on ${call.path}.`,
		);
	}
	return answer;
}

function jsonError(answer: AtlasAnswer): string | null {
	try {
		const body = answer.json<{ error?: unknown; message?: unknown }>();
		const why = body.error ?? body.message;
		return typeof why === 'string' ? why : null;
	} catch {
		return null;
	}
}

/** The versions atlas-tool says this request wrote (`X-IW-Doc-Versions`), by doc id. */
export function writtenVersions(answer: AtlasAnswer): Record<string, DocBase> {
	try {
		const parsed: unknown = JSON.parse(answer.headers.get('x-iw-doc-versions') ?? '{}');
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, DocBase>) : {};
	} catch {
		return {};
	}
}
