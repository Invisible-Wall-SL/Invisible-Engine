import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import { getObjectText, presignGet } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const MANIFEST_KEY = 'tools/invisible-launcher/models-manifest.json';

// Same gate as the tunnel bundle: only the owner role may presign model downloads.
const MODELS_ROLE = 'admin';

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

function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1];
}

// Reads `Authorization: Bearer <token>` (a session token from
// POST /api/launcher/login), validates it like the web session cookie, checks the
// owner role, then returns the R2-seeded models manifest with a short-lived
// presigned GET URL added per model so the desktop launcher downloads each file
// directly from R2 (no portal bandwidth). Presigned URLs and credentials are never
// logged. 401 no/invalid token, 403 wrong role, 404 if the manifest isn't seeded.
export const GET: RequestHandler = async ({ request }) => {
	const token = bearer(request.headers.get('authorization'));
	const user = await validateSession(token);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (user.role !== MODELS_ROLE) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const text = await getObjectText(MANIFEST_KEY);
	if (text === null) {
		return json({ error: 'Models manifest not available yet' }, { status: 404 });
	}

	const manifest = JSON.parse(text) as ModelsManifest;
	const basePrefix = manifest.base_prefix ?? DEFAULT_BASE_PREFIX;
	const allowedPrefix = `${basePrefix}/`;

	const signed: (ManifestModel & { url: string })[] = [];
	for (const model of manifest.models ?? []) {
		// SECURITY: only presign keys under the manifest's base prefix.
		if (typeof model.key !== 'string' || !model.key.startsWith(allowedPrefix)) {
			continue;
		}
		const url = await presignGet(model.key, PRESIGN_TTL_SECONDS);
		signed.push({ ...model, url });
	}

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
