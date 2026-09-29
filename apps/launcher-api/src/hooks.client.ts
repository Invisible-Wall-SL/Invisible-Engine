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

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	if (status !== 404) captureError(error, { tags: { route: event.route.id ?? undefined } });
	return { message };
};
