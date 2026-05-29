import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

// TEMPORARY public diagnostic (no secrets — the tool URL is not secret).
// Reports both the raw env var and the effective value (with code default).
export const GET: RequestHandler = () => {
	return json({
		rawEnvSet: Boolean(env.ATLAS_TOOL_URL),
		effectiveUrl: ENV.ATLAS_TOOL_URL,
		railwayProject: env.RAILWAY_PROJECT_NAME ?? null,
		railwayService: env.RAILWAY_SERVICE_NAME ?? null,
	});
};
