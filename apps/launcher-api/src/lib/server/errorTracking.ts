import { env } from '$env/dynamic/private';
import { PRIVATE_DATA_COLLECTION, scrubDeep, scrubUrl } from 'error-tracking';

/**
 * Server-side error reporting (Sentry) for the launcher. A no-op until `SENTRY_DSN` is set on
 * the Railway service — and then the SDK is imported lazily, so an unset DSN costs nothing at
 * boot. The browser half lives in `hooks.client.ts` (`PUBLIC_SENTRY_DSN`); both scrub through
 * the shared `error-tracking` package, and neither sends cookies, headers or a user.
 */

type Sentry = typeof import('@sentry/node');

let sdk: Sentry | null = null;

export async function initServerErrorTracking(): Promise<void> {
	const dsn = env.SENTRY_DSN?.trim();
	if (!dsn || sdk) return;
	try {
		const sentry = await import('@sentry/node');
		sentry.init({
			dsn,
			environment: env.SENTRY_ENVIRONMENT || 'production',
			release: env.RAILWAY_GIT_COMMIT_SHA || undefined,
			sampleRate: Number(env.SENTRY_SAMPLE_RATE || '1'),
			dataCollection: PRIVATE_DATA_COLLECTION,
			tracesSampleRate: 0,
			initialScope: { tags: { service: 'launcher' } },
			beforeSend(event) {
				delete event.user;
				if (event.request) {
					if (event.request.url) event.request.url = scrubUrl(event.request.url);
					delete event.request.cookies;
					delete event.request.headers;
					delete event.request.query_string;
					delete event.request.data;
				}
				return scrubDeep(event);
			},
			beforeBreadcrumb: (crumb) => scrubDeep(crumb),
		});
		sdk = sentry;
		console.log('[errors] Sentry reporting on');
	} catch (err) {
		console.warn('[errors] Sentry failed to load — server reporting disabled', err);
	}
}

export function captureServerError(
	error: unknown,
	tags: Record<string, string | undefined> = {},
): void {
	if (!sdk) return;
	const sentry = sdk;
	sentry.withScope((scope) => {
		for (const [key, value] of Object.entries(tags)) if (value) scope.setTag(key, value);
		sentry.captureException(error);
	});
}
