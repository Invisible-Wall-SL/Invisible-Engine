/**
 * What must never leave the player's browser inside an error report.
 *
 * The session id is the credential here: every RGS call carries it as `?sid=` (Play4Fun) or
 * `?sessionID=` (our launch URLs), so an error event that quoted a request URL — a fetch
 * breadcrumb, a `TypeError: Failed to fetch <url>` message, the page URL itself — would hand the
 * holder of the tracker account a live wallet session. Launcher tokens (`?token=`, `?k=`) are the
 * same story for the tools. Scrubbing is by PARAMETER NAME, not by value shape, because a partner's
 * token format is theirs to change.
 */

import type { BrowserOptions } from '@sentry/browser';

/**
 * Sentry's `dataCollection` init option, set to collect nothing about the person or the request.
 * Sentry 11 defaults every one of these to ON (user, cookies, headers, bodies, query strings,
 * local variables, GraphQL / AI / MCP payloads, DB and queue arguments), so leaving a key out is
 * the opposite of private. `frameContextLines` (our own source around a frame) stays at Sentry's
 * default of 5. `Required` makes a category added by a Sentry bump fail the typecheck (run in CI)
 * until it is set here. It is shallow: a new sub-key inside `graphQL`, `genAI` or `mcp` is not
 * caught. The scrubbers below are the second line, for what reaches an event through messages,
 * breadcrumbs and extras.
 */
export const PRIVATE_DATA_COLLECTION = {
	userInfo: false,
	cookies: false,
	httpHeaders: false,
	httpBodies: [],
	urlQueryParams: false,
	graphQL: { document: false, variables: false },
	genAI: { inputs: false, outputs: false },
	mcp: { inputs: false, outputs: false },
	databaseQueryData: false,
	queues: false,
	stackFrameVariables: false,
	frameContextLines: 5,
} satisfies Required<NonNullable<BrowserOptions['dataCollection']>>;

const SENSITIVE_PARAM =
	/^(sid|sessionid|session|session_id|token|access_token|auth|key|k|secret|password|signature|sig)$/i;
/** Presigned-URL (R2/S3) credentials: `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`. */
const SENSITIVE_PREFIX = /^x-amz-(signature|credential|security-token)$/i;

const extraSensitive = new Set<string>();

/**
 * Treat one more parameter name as sensitive. A delivery profile names its own session parameter
 * (`session.param`), so the fixed list above cannot be the whole answer for a partner build.
 */
export function addSensitiveParam(name: string): void {
	if (name) extraSensitive.add(name.toLowerCase());
}

const isSensitive = (name: string): boolean =>
	SENSITIVE_PARAM.test(name) ||
	SENSITIVE_PREFIX.test(name) ||
	extraSensitive.has(name.toLowerCase());

export const SCRUBBED = '[scrubbed]';

const PARAM_IN_TEXT = /([?&#;])([\w.-]+)=([^&#\s"'<>]*)/g;

/** Replace the value of every sensitive query/fragment parameter in free text (messages, URLs). */
export function scrubText(text: string): string {
	return text.replace(PARAM_IN_TEXT, (match, sep: string, name: string) =>
		isSensitive(name) ? `${sep}${name}=${SCRUBBED}` : match,
	);
}

/** A URL with its sensitive parameters blanked; anything unparseable goes through {@link scrubText}. */
export function scrubUrl(url: string): string {
	try {
		const parsed = new URL(url);
		let changed = false;
		for (const name of [...parsed.searchParams.keys()]) {
			if (isSensitive(name)) {
				parsed.searchParams.set(name, SCRUBBED);
				changed = true;
			}
		}
		const hash = parsed.hash ? scrubText(parsed.hash) : '';
		if (hash !== parsed.hash) {
			parsed.hash = hash;
			changed = true;
		}
		return changed ? parsed.toString() : url;
	} catch {
		return scrubText(url);
	}
}

/** Deep-scrub every string in a JSON-ish value, with a depth cap so a cycle cannot hang the page. */
export function scrubDeep<T>(value: T, depth = 0): T {
	if (depth > 8) return value;
	if (typeof value === 'string') return scrubText(value) as T;
	if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as T;
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = isSensitive(k) && typeof v === 'string' ? SCRUBBED : scrubDeep(v, depth + 1);
		}
		return out as T;
	}
	return value;
}
