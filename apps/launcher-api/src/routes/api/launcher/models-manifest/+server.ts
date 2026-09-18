import { json } from '@sveltejs/kit';
import { requireLauncherAdmin } from '$lib/server/launcherAuth';
import { getObjectText, presignManifestEntries } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const MANIFEST_KEY = 'tools/invisible-launcher/models-manifest.json';

// 6 hours — long enough that a multi-GB sync of many checkpoints won't outlive
// the presigned URLs mid-download.
const PRESIGN_TTL_SECONDS = 6 * 60 * 60;

// Fallback prefix if the manifest omits `base_prefix`. Every model key MUST live
// under `${base_prefix}/` or it is dropped (never presigned) — so this endpoint
// can never mint a signed URL for an arbitrary R2 object.
const DEFAULT_BASE_PREFIX = 'comfyui-models';

interface ManifestModel {
	key: string;
	dir: string;
	name: string;
	size: number;
	sha256: string;
}

interface ModelsManifest {
	version: number;
	base_prefix?: string;
	models: ManifestModel[];
}

// Reads `Authorization: Bearer <token>` (a session token from
// POST /api/launcher/login), validates it like the web session cookie, checks the
// caller is the owner, then returns the R2-seeded models manifest with a short-lived
// presigned GET URL added per model so the desktop launcher downloads each file
// directly from R2 (no portal bandwidth). Presigned URLs and credentials are never
// logged. 401 no/invalid token, 403 wrong role, 404 if the manifest isn't seeded.
//
// OWNER-ONLY BY NATURE, like the tunnel bundle: these are the multi-GB checkpoints for
// the owner's own GPU box, not a step of anyone's publish. `requireLauncherAdmin`
// compares the literal `admin` role, so there is no capability that opens it.
export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireLauncherAdmin(request);
	if (!auth.ok) return auth.response;

	const text = await getObjectText(MANIFEST_KEY);
	if (text === null) {
		return json({ error: 'Models manifest not available yet' }, { status: 404 });
	}

	const manifest = JSON.parse(text) as ModelsManifest;
	const basePrefix = manifest.base_prefix ?? DEFAULT_BASE_PREFIX;

	// SECURITY: presignManifestEntries only signs keys under `${basePrefix}/`.
	const signed = await presignManifestEntries(
		manifest.models ?? [],
		'key',
		basePrefix,
		PRESIGN_TTL_SECONDS,
	);

	const payload = {
		...manifest,
		base_prefix: basePrefix,
		expires_in: PRESIGN_TTL_SECONDS,
		models: signed,
	};

	return new Response(JSON.stringify(payload), {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
};
