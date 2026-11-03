import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * GitHub Actions OIDC tokens, verified by hand with `node:crypto` (ADR-0013 §4; no new dependency,
 * as `githubApp.ts` signs its RS256 JWT by hand). A job with `id-token: write` mints a token for an
 * audience; GitHub signs it with a key it publishes at its issuer's JWKS address. Here: the
 * signature (RS256 only, a published `kid` only), the issuer, the audience and the time claims.
 * What a token must ALSO say to open something — its repository, workflow, run — is the caller's
 * to check on the claims this answers.
 *
 * The keys are cached by `kid` for an hour. They are fetched at most once a minute, whatever asks —
 * the hourly refresh, or a token naming a `kid` the cache lacks — so a stream of forged `kid`s
 * cannot make the launcher hammer GitHub, and a failed refresh keeps the keys there were.
 * Nothing here logs or echoes a token: an error names the claim that failed, never a value.
 */

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const KEYS_TTL_MS = 60 * 60_000;
const REFETCH_MIN_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Clock skew allowed on `nbf` and `iat`, as GitHub allows on the App's own JWT. */
const SKEW_S = 60;
/** A GitHub OIDC token is ~1–2 KB; anything far larger is not one. */
const MAX_TOKEN_CHARS = 16 * 1024;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** A token refused: 401 when it is not a valid token for this audience, 503 when GitHub's keys
 *  could not be read to tell. */
export class OidcError extends Error {
	constructor(
		message: string,
		readonly status: 401 | 503,
	) {
		super(message);
		this.name = 'OidcError';
	}
}

/** The claims a GitHub Actions token carries, the ones the launcher reads named. */
export interface GithubOidcClaims {
	iss: string;
	aud: string | string[];
	exp: number;
	nbf?: number;
	iat: number;
	repository?: unknown;
	job_workflow_ref?: unknown;
	ref?: unknown;
	event_name?: unknown;
	actor?: unknown;
	environment?: unknown;
	run_id?: unknown;
	run_attempt?: unknown;
	runner_environment?: unknown;
	[claim: string]: unknown;
}

export interface GithubOidcOptions {
	/** The HTTP transport for the JWKS; a fixture hands in a fake. Looked up per call. */
	transport?: typeof fetch;
	now?: () => number;
}

export interface GithubOidc {
	/** The token's claims once it verifies for `audience`; throws `OidcError` otherwise. */
	verify(token: string, audience: string): Promise<GithubOidcClaims>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function decodePart(part: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

export function createGithubOidc(options: GithubOidcOptions = {}): GithubOidc {
	const transport: typeof fetch = options.transport ?? ((input, init) => fetch(input, init));
	const now = options.now ?? (() => Date.now());

	let keys = new Map<string, KeyObject>();
	let fetchedAt = -Infinity;
	let attemptedAt = -Infinity;
	let loading: Promise<void> | null = null;

	const load = async (): Promise<void> => {
		attemptedAt = now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		timer.unref();
		let body: unknown;
		try {
			const res = await transport(JWKS_URL, {
				headers: { Accept: 'application/json', 'User-Agent': 'invisible-launcher' },
				signal: controller.signal,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			body = await res.json();
		} catch {
			throw new OidcError("GitHub's OIDC signing keys could not be read.", 503);
		} finally {
			clearTimeout(timer);
		}
		const next = new Map<string, KeyObject>();
		for (const jwk of isRecord(body) && Array.isArray(body.keys) ? body.keys : []) {
			if (!isRecord(jwk) || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
			if (jwk.use !== undefined && jwk.use !== 'sig') continue;
			if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
			try {
				next.set(
					jwk.kid,
					createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }),
				);
			} catch {
				// A key Node cannot read is one no token verifies against; the others still serve.
			}
		}
		keys = next;
		fetchedAt = now();
	};

	const refresh = (): Promise<void> => {
		if (!loading) loading = load().finally(() => (loading = null));
		return loading;
	};

	/** A fetch at most once a minute, whatever asks (joining one in flight); a failure keeps the
	 *  keys there were. */
	const throttledRefresh = async (): Promise<void> => {
		if (!loading && now() - attemptedAt < REFETCH_MIN_MS) return;
		await refresh().catch(() => undefined);
	};

	const keyFor = async (kid: string): Promise<KeyObject> => {
		// Stale keys beat none: a GitHub hiccup at the hour mark keeps verifying.
		if (now() - fetchedAt > KEYS_TTL_MS) await throttledRefresh();
		if (!keys.has(kid)) await throttledRefresh();
		const key = keys.get(kid);
		if (key) return key;
		if (!keys.size) throw new OidcError("GitHub's OIDC signing keys could not be read.", 503);
		throw new OidcError('The token is signed with a key GitHub does not publish.', 401);
	};

	return {
		async verify(token: string, audience: string): Promise<GithubOidcClaims> {
			if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS || !JWT.test(token)) {
				throw new OidcError('The token is not a JWT.', 401);
			}
			const [head, payload, signature] = token.split('.');
			const header = decodePart(head);
			if (!header) throw new OidcError('The token has no readable header.', 401);
			if (header.alg !== 'RS256') throw new OidcError('The token is not signed with RS256.', 401);
			if (typeof header.kid !== 'string' || !header.kid) {
				throw new OidcError('The token names no signing key (kid).', 401);
			}
			const key = await keyFor(header.kid);
			let signed = false;
			try {
				signed = verify(
					'RSA-SHA256',
					Buffer.from(`${head}.${payload}`),
					key,
					Buffer.from(signature, 'base64url'),
				);
			} catch {
				signed = false;
			}
			if (!signed) throw new OidcError("The token's signature does not verify.", 401);
			const claims = decodePart(payload);
			if (!claims) throw new OidcError('The token has no readable claims.', 401);
			if (claims.iss !== GITHUB_OIDC_ISSUER) {
				throw new OidcError('The token was not issued by GitHub Actions (iss).', 401);
			}
			const aud = claims.aud;
			if (!(aud === audience || (Array.isArray(aud) && aud.includes(audience)))) {
				throw new OidcError('The token is not for this launcher (aud).', 401);
			}
			const at = now() / 1000;
			if (typeof claims.exp !== 'number' || claims.exp <= at) {
				throw new OidcError('The token has expired (exp).', 401);
			}
			if (typeof claims.nbf === 'number' && claims.nbf > at + SKEW_S) {
				throw new OidcError('The token is not valid yet (nbf).', 401);
			}
			if (typeof claims.iat !== 'number') {
				throw new OidcError('The token has no issue time (iat).', 401);
			}
			if (claims.iat > at + SKEW_S) {
				throw new OidcError('The token was issued in the future (iat).', 401);
			}
			return claims as GithubOidcClaims;
		},
	};
}

/** The launcher's verifier, against GitHub's published keys. */
export const githubOidc: GithubOidc = createGithubOidc();
