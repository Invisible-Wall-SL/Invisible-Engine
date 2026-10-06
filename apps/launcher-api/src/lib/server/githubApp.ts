import { createSign } from 'node:crypto';
import { ENV } from './env';

/**
 * The GitHub App client Invisible Pipeline Changes acts as (ADR-0007): a JWT signed with the App's
 * private key buys a short-lived INSTALLATION token, and every REST call carries that token.
 *
 * Why an App and not another token: the App is installed on this one repository with exactly the
 * permissions the tool needs (pull requests, checks, statuses, actions), its tokens expire in an
 * hour, and its identity — not a person's — opens the agent-edit PRs (PLAN 5.4). The existing
 * `github.ts` (`GITHUB_ACTIONS_TOKEN`, the ComfyUI panel) is deliberately untouched: a different
 * job, a different blast radius.
 *
 * What never leaves this module: the private key and the installation token. Nothing here logs,
 * and every error it throws is GitHub's own message or a sentence naming a variable, never a value.
 * `GITHUB_APP_PRIVATE_KEY` is the one secret whose shape can be wrong (a PEM pasted as one line), so
 * `env.ts` unescapes `\n` before it gets here.
 */

const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 15_000;
/** GitHub rejects an App JWT older than 10 minutes and allows a minute of clock skew on `iat`. */
const JWT_SKEW_S = 60;
const JWT_TTL_S = 9 * 60;
/** An installation token lives an hour; a new one is minted this long before the old one expires,
 *  so a call made just before the deadline never carries a token that dies in flight. */
const TOKEN_MARGIN_MS = 5 * 60_000;

export interface GithubAppConfig {
	appId: string;
	installationId: string;
	privateKey: string;
}

export interface GithubAppOptions {
	/** Read on every mint, not once: a rotated key reaches a running process on its next token. */
	config?: () => GithubAppConfig;
	/** The HTTP transport; a fixture hands in a fake GitHub. Looked up per call, never captured. */
	transport?: typeof fetch;
	now?: () => number;
}

/** A GitHub answer that is not a success, with GitHub's own message. Never carries a secret. */
export class GithubAppError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = 'GithubAppError';
	}
}

export interface GithubRequestInit extends RequestInit {
	/** How long the whole exchange may take, the body included; the default suits a JSON answer. */
	timeoutMs?: number;
}

export interface GithubApp {
	/** The variables that are unset, as one sentence; `null` when the App can act. */
	missing(): string | null;
	/** A REST call as the installation, with its token minted, cached and renewed here. `path` is
	 *  `/repos/...`; a full URL passes through. Throws `GithubAppError` when the request cannot be
	 *  made at all; a non-2xx answer is returned as is. */
	fetch(path: string, init?: GithubRequestInit): Promise<Response>;
	/** A 2xx answer's JSON; any other answer throws `GithubAppError` with GitHub's message. */
	json<T>(path: string, init?: GithubRequestInit): Promise<T>;
	/** A download GitHub answers with a redirect to a signed URL (an artifact): the redirect is
	 *  followed WITHOUT the token, which belongs to GitHub's API and not to the blob store. */
	download(path: string, init?: GithubRequestInit): Promise<Response>;
}

const ENV_CONFIG = (): GithubAppConfig => ({
	appId: ENV.GITHUB_APP_ID,
	installationId: ENV.GITHUB_APP_INSTALLATION_ID,
	privateKey: ENV.GITHUB_APP_PRIVATE_KEY,
});

/** The unset variables of a config, in their documented order. */
export function missingAppConfig(config: GithubAppConfig): string[] {
	const missing: string[] = [];
	if (!config.appId) missing.push('GITHUB_APP_ID');
	if (!config.installationId) missing.push('GITHUB_APP_INSTALLATION_ID');
	if (!config.privateKey) missing.push('GITHUB_APP_PRIVATE_KEY');
	return missing;
}

const base64url = (value: object): string =>
	Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * The App JWT GitHub exchanges for an installation token: RS256 over `{iat, exp, iss}`, with `iat`
 * set a minute back for clock skew and `exp` nine minutes ahead (the cap is ten). Pure — the same
 * key, id and clock give the same token — so a fixture can verify it with the public half.
 */
export function mintAppJwt(appId: string, privateKey: string, nowMs: number): string {
	const iat = Math.floor(nowMs / 1000) - JWT_SKEW_S;
	const signingInput = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
		iat,
		exp: iat + JWT_SKEW_S + JWT_TTL_S,
		iss: appId,
	})}`;
	let signature: string;
	try {
		signature = createSign('RSA-SHA256').update(signingInput).end().sign(privateKey, 'base64url');
	} catch {
		// Node's own error names the decoder, never the key; this names the variable instead.
		throw new GithubAppError('GITHUB_APP_PRIVATE_KEY is not a PEM private key GitHub can verify.');
	}
	return `${signingInput}.${signature}`;
}

export function createGithubApp(options: GithubAppOptions = {}): GithubApp {
	const config = options.config ?? ENV_CONFIG;
	const transport: typeof fetch = options.transport ?? ((input, init) => fetch(input, init));
	const now = options.now ?? (() => Date.now());

	let cached: { token: string; expiresAt: number } | null = null;
	let minting: Promise<string> | null = null;

	const missing = (): string | null => {
		const names = missingAppConfig(config());
		return names.length
			? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not set on the launcher, so Invisible Pipeline Changes cannot reach GitHub.`
			: null;
	};

	const request = async (
		url: string,
		init: GithubRequestInit,
		auth: string | null,
	): Promise<Response> => {
		const { timeoutMs = FETCH_TIMEOUT_MS, ...rest } = init;
		const controller = new AbortController();
		// Left running once the headers are in: the body is read under the same deadline, so a
		// stalled download cannot hang a request. Unref'd, so a finished exchange holds nothing.
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		timer.unref();
		try {
			return await transport(url, {
				...rest,
				headers: {
					...(auth === null
						? {}
						: {
								Authorization: `Bearer ${auth}`,
								Accept: 'application/vnd.github+json',
								'X-GitHub-Api-Version': '2022-11-28',
							}),
					'User-Agent': 'invisible-launcher',
					...(rest.body ? { 'content-type': 'application/json' } : {}),
					...(rest.headers ?? {}),
				},
				signal: controller.signal,
			});
		} catch (err) {
			clearTimeout(timer);
			// A transport error could quote the request; the URL is public and the header is not
			// in any message undici produces, but the message is replaced rather than trusted.
			throw new GithubAppError(
				`GitHub did not answer (${err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'network error'}).`,
			);
		}
	};

	const mint = async (): Promise<string> => {
		const c = config();
		const unset = missing();
		if (unset) throw new GithubAppError(unset, 503);
		const res = await request(
			`${GITHUB_API}/app/installations/${encodeURIComponent(c.installationId)}/access_tokens`,
			{ method: 'POST' },
			mintAppJwt(c.appId, c.privateKey, now()),
		);
		if (res.status !== 201) throw await errorOf(res);
		const body = (await res.json()) as { token?: string; expires_at?: string };
		if (!body.token) throw new GithubAppError('GitHub returned no installation token.');
		const expiresAt = Date.parse(body.expires_at ?? '') || now() + 60 * 60_000;
		cached = { token: body.token, expiresAt };
		return body.token;
	};

	const token = async (): Promise<string> => {
		if (cached && cached.expiresAt - TOKEN_MARGIN_MS > now()) return cached.token;
		// Concurrent callers share one mint: a page load fans out a dozen calls at once, and each
		// minting its own token would be a dozen App JWTs for nothing.
		if (!minting) minting = mint().finally(() => (minting = null));
		return minting;
	};

	const call = async (path: string, init: GithubRequestInit = {}): Promise<Response> => {
		// The token goes to GitHub's API and nowhere else: a full URL (an artifact's download
		// link, read from a GitHub answer) passes only when it is one of the API's own.
		if (/^https?:\/\//.test(path) && !path.startsWith(`${GITHUB_API}/`)) {
			throw new GithubAppError("Refusing to send the App's token to a URL outside api.github.com.");
		}
		const url = /^https?:\/\//.test(path) ? path : `${GITHUB_API}${path}`;
		let res = await request(url, init, await token());
		// A 401 on a token that was valid a moment ago means GitHub revoked it (the App was
		// reinstalled, the key rotated): mint once more, and only once.
		if (res.status === 401 && cached) {
			cached = null;
			res = await request(url, init, await token());
		}
		return res;
	};

	return {
		missing,
		fetch: call,
		async json<T>(path: string, init?: GithubRequestInit): Promise<T> {
			const res = await call(path, init);
			if (!res.ok) throw await errorOf(res);
			return (await res.json()) as T;
		},
		async download(path: string, init: GithubRequestInit = {}): Promise<Response> {
			const res = await call(path, { ...init, redirect: 'manual' });
			if (res.status < 300 || res.status >= 400) return res;
			const location = res.headers.get('location');
			if (!location?.startsWith('https://')) {
				throw new GithubAppError('GitHub redirected the download to no usable URL.');
			}
			// The signed URL is its own authorization: the token goes nowhere near it.
			return request(location, { ...init, redirect: 'follow' }, null);
		},
	};
}

/** GitHub's error body carries the useful sentence (and never the credential). */
async function errorOf(res: Response): Promise<GithubAppError> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return new GithubAppError(`GitHub ${res.status}: ${body?.message ?? res.statusText}`, res.status);
}

/** The launcher's own App, configured from the environment. */
export const githubApp: GithubApp = createGithubApp();
