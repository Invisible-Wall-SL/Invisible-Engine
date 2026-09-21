import { json } from '@sveltejs/kit';
import { requireLauncherAdmin } from '$lib/server/launcherAuth';
import { getObjectText, presignManifestEntries } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const MANIFEST_KEY = 'tools/invisible-launcher/comfyui-nodes.json';

// 6 hours — matches the models manifest so a long multi-zip sync won't outlive the
// presigned URLs mid-download.
const PRESIGN_TTL_SECONDS = 6 * 60 * 60;

// Fallback prefix if the manifest omits `base_prefix`. Every node `zip_key` MUST live
// under `${base_prefix}/` or it is dropped (never presigned) — so this endpoint can
// never mint a signed URL for an arbitrary R2 object.
const DEFAULT_BASE_PREFIX = 'comfyui-nodes';

interface ManifestNode {
	name: string;
	zip_key: string;
	version: string;
	size: number;
	sha256: string;
}

interface NodesManifest {
	version: number;
	base_prefix?: string;
	nodes: ManifestNode[];
}

// Reads `Authorization: Bearer <token>` (a session token from
// POST /api/launcher/login), validates it like the web session cookie, checks the
// caller is the owner, then returns the R2-seeded ComfyUI custom-node manifest with a
// short-lived presigned GET URL added per node so the desktop launcher downloads each
// zip directly from R2 (no portal bandwidth). Presigned URLs and credentials are never
// logged. 401 no/invalid token, 403 wrong role, 404 if the manifest isn't seeded.
//
// OWNER-ONLY BY NATURE, like the models manifest beside it: custom nodes are installed
// into the owner's own ComfyUI, not shipped by a publish. `requireLauncherAdmin`
// compares the literal `admin` role, so there is no capability that opens it.
export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireLauncherAdmin(request);
	if (!auth.ok) return auth.response;

	const text = await getObjectText(MANIFEST_KEY);
	if (text === null) {
		return json({ error: 'Custom-node manifest not available yet' }, { status: 404 });
	}

	const manifest = JSON.parse(text) as NodesManifest;
	const basePrefix = manifest.base_prefix ?? DEFAULT_BASE_PREFIX;

	// SECURITY: presignManifestEntries only signs `zip_key`s under `${basePrefix}/`.
	const signed = await presignManifestEntries(
		manifest.nodes ?? [],
		'zip_key',
		basePrefix,
		PRESIGN_TTL_SECONDS,
	);

	const payload = {
		...manifest,
		base_prefix: basePrefix,
		expires_in: PRESIGN_TTL_SECONDS,
		nodes: signed,
	};

	return new Response(JSON.stringify(payload), {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
};
