import type { Breadcrumb, ErrorEvent, Scope } from '@sentry/browser';
import { PRIVATE_DATA_COLLECTION, scrubDeep, scrubUrl } from './scrub';

/**
 * Browser error reporting (Sentry) for every surface that runs in a player's or an artist's
 * browser — the game runtime and the launcher.
 *
 * A NO-OP WITHOUT A DSN, AND FREE WHEN IT IS ONE: the SDK is a dynamic import reached only after
 * a DSN is known, so a build or a page with none never downloads it. Captures issued before the
 * SDK has landed are queued and flushed once it has, so an error thrown during boot — exactly the
 * one worth having — is not lost to the import's latency.
 *
 * Privacy is enforced here rather than trusted to each caller: no default PII (no IP, no cookies),
 * no user object, and every URL / message / breadcrumb / extra goes through `scrub.ts`.
 */

export interface ErrorTrackingOptions {
	/** Unset or empty → nothing is loaded and every call below is a no-op. */
	dsn: string | undefined;
	/** `production`, `preview`, `dev`, … — Sentry's environment filter. */
	environment?: string;
	/** The code identity the error happened in (the runtime commit sha / release version). */
	release?: string;
	/** Fraction of error events sent, 0..1. Default 1. */
	sampleRate?: number;
	tags?: Record<string, string | undefined>;
}

type Sentry = typeof import('./sdk');
type Pending = (sentry: Sentry) => void;

let sentry: Sentry | null = null;
let pending: Pending[] | null = null;

const cleanTags = (tags: Record<string, string | undefined> = {}): Record<string, string> =>
	Object.fromEntries(Object.entries(tags).filter((entry): entry is [string, string] => !!entry[1]));

const run = (fn: Pending): void => {
	if (sentry) fn(sentry);
	else pending?.push(fn);
};

/**
 * Start reporting. Resolves `true` once the SDK is live, `false` when disabled (no DSN) or the
 * SDK failed to load — reporting must never be the thing that breaks the page, so a failure here
 * is swallowed.
 */
export async function initErrorTracking(options: ErrorTrackingOptions): Promise<boolean> {
	const dsn = options.dsn?.trim();
	if (!dsn || typeof window === 'undefined' || sentry || pending) return !!sentry;
	pending = [];
	try {
		const sdk = await import('./sdk');
		sdk.init({
			dsn,
			environment: options.environment,
			release: options.release || undefined,
			sampleRate: options.sampleRate ?? 1,
			dataCollection: PRIVATE_DATA_COLLECTION,
			tracesSampleRate: 0,
			// Release-health sessions are a beacon per page load from every player — data we have
			// no use for, and a partner never agreed to. Errors only.
			integrations: (defaults: { name: string }[]) =>
				defaults.filter((i) => i.name !== 'BrowserSession'),
			initialScope: { tags: cleanTags(options.tags) },
			beforeSend(event: ErrorEvent) {
				delete event.user;
				if (event.request) {
					if (event.request.url) event.request.url = scrubUrl(event.request.url);
					delete event.request.cookies;
					delete event.request.headers;
					delete event.request.query_string;
				}
				return scrubDeep(event);
			},
			beforeBreadcrumb(crumb: Breadcrumb) {
				return scrubDeep(crumb);
			},
		});
		sentry = sdk;
		for (const fn of pending) fn(sdk);
		pending = null;
		return true;
	} catch (err) {
		pending = null;
		console.warn('[error-tracking] SDK failed to load — reporting disabled', err);
		return false;
	}
}

export function isErrorTrackingActive(): boolean {
	return sentry !== null || pending !== null;
}

/** Report a caught error. `tags` index it (searchable); `extra` is detail on the event only;
 *  `fingerprint` groups it, for errors raised from one place whose stack would merge them. */
export function captureError(
	error: unknown,
	context: {
		tags?: Record<string, string | undefined>;
		extra?: Record<string, unknown>;
		fingerprint?: string[];
	} = {},
): void {
	if (!isErrorTrackingActive()) return;
	run((sdk) =>
		sdk.withScope((scope: Scope) => {
			scope.setTags(cleanTags(context.tags));
			if (context.extra) scope.setExtras(context.extra);
			if (context.fingerprint) scope.setFingerprint(context.fingerprint);
			sdk.captureException(error);
		}),
	);
}

/** Tags learnt after boot (the game key once the launch URL has been read, the profile id, …). */
export function setErrorTags(tags: Record<string, string | undefined>): void {
	if (!isErrorTrackingActive()) return;
	run((sdk) => sdk.setTags(cleanTags(tags)));
}
