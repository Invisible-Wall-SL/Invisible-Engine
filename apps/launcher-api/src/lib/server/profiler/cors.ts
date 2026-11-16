import { PERF_SESSION_HEADER } from './captureToken';

/**
 * CORS for the two routes the `?perf=1` probe posts to from the games origin. Any origin: the
 * probe authenticates with its capture token in a header, never a cookie, and no response carries
 * `Allow-Credentials`, so a page elsewhere cannot borrow a signed-in user's session through them.
 * `hooks.server.ts` sets these on EVERY response of these paths, errors included.
 */
export const PROFILER_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': `Content-Type, ${PERF_SESSION_HEADER}`,
	'Access-Control-Max-Age': '86400',
};

export const PROFILER_CORS_PATHS = ['/api/profiler/reports', '/api/profiler/uploads'];

export function isProfilerCorsPath(pathname: string): boolean {
	return PROFILER_CORS_PATHS.includes(pathname.replace(/\/+$/, ''));
}
