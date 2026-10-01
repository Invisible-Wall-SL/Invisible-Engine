import { env } from '$env/dynamic/public';
import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { captureError, initErrorTracking } from 'error-tracking';

/** Browser error reporting for the launcher's own pages — a no-op until `PUBLIC_SENTRY_DSN` is set
 *  on the Railway service (read at runtime, so no rebuild). Not awaited: the SDK must never delay
 *  the first paint, and anything thrown before it lands is queued. */
export const init: ClientInit = () => {
	void initErrorTracking({
		dsn: env.PUBLIC_SENTRY_DSN,
		environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production',
		sampleRate: Number(env.PUBLIC_SENTRY_SAMPLE_RATE || '1'),
		tags: { service: 'launcher-client' },
	});
};

// A route chunk missing after a deploy, before the version poll noticed (or a tab that slept).
const STALE_CHUNK =
	/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/;
const STALE_RELOAD_KEY = 'iw-stale-chunk-reload';

/** Full-load the target once; a second failure on the same URL within a minute is a real error. */
function reloadForStaleChunk(href: string): boolean {
	try {
		const last = JSON.parse(sessionStorage.getItem(STALE_RELOAD_KEY) ?? 'null') as {
			href: string;
			at: number;
		} | null;
		if (last && last.href === href && Date.now() - last.at < 60_000) return false;
		sessionStorage.setItem(STALE_RELOAD_KEY, JSON.stringify({ href, at: Date.now() }));
	} catch {
		return false;
	}
	location.href = href;
	return true;
}

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	if (
		error instanceof Error &&
		STALE_CHUNK.test(error.message) &&
		reloadForStaleChunk(event.url.href)
	)
		return { message };
	if (status !== 404) captureError(error, { tags: { route: event.route.id ?? undefined } });
	return { message };
};
