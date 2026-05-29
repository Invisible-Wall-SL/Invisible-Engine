import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// TEMPORARY public diagnostic (no secrets) — reports whether the running
// launcher instance behind this host sees ATLAS_TOOL_URL, and which Railway
// project/service is actually serving it. Remove after debugging.
export const GET: RequestHandler = () => {
	const url = env.ATLAS_TOOL_URL ?? '';
	return json({
		atlasToolUrlConfigured: Boolean(url),
		atlasToolUrlLen: url.length,
		railwayProject: env.RAILWAY_PROJECT_NAME ?? null,
		railwayService: env.RAILWAY_SERVICE_NAME ?? null,
		railwayEnvironment: env.RAILWAY_ENVIRONMENT_NAME ?? null,
		railwayPublicDomain: env.RAILWAY_PUBLIC_DOMAIN ?? null,
	});
};
