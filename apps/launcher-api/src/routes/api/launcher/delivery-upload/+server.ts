import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { relayFileLimitBytes } from '$lib/server/gameBundleRelay';
import { requireLauncherPublisher } from '$lib/server/launcherAuth';
import {
	assertAlias,
	assertVersionPath,
	commitDelivery,
	deliveryConfigured,
	deliveryPrefix,
	listDeliveredFiles,
	listSealedVersions,
	nextVersionPath,
	readDeliveryRecord,
	relayDeliveryFile,
	servedUrl,
} from '$lib/server/partnerDelivery';
import type { RequestHandler } from './$types';

// Uploads a delivery build (`scripts/build-delivery.mjs`) into the PARTNER's R2 bucket through the
// portal — see `$lib/server/partnerDelivery.ts` for why it is relayed and why a delivered folder
// is never overwritten.
//
//   GET  ?alias=<gameAlias>[&version=<versionPath>]   config, delivered versions, suggested next
//                                                     versionPath; with &version, what it holds
//   PUT  ?alias=…&version=…&path=<rel>  raw bytes  → {brand}/games/{version}/{alias}/{rel}
//   POST ?alias=…&version=…  {files[], build}      → verify + prune + seal; reports the served URL
//
// Bearer token from POST /api/launcher/login and the `gamePublish` capability, like every other
// publish step. 401/403 auth, 400 bad alias/version/path/body, 409 already delivered or the upload
// is incomplete, 413 too big, 503 the partner bucket is not configured. Never logs the body.
const NO_STORE = { 'cache-control': 'no-store' };

function params(url: URL): { alias: string; version: string } {
	return {
		alias: url.searchParams.get('alias') ?? '',
		version: url.searchParams.get('version') ?? '',
	};
}

export const GET: RequestHandler = async ({ request, url }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	const { alias, version } = params(url);
	const base = {
		configured: deliveryConfigured(),
		cdnUrl: ENV.DELIVERY_CDN_URL,
		brand: ENV.DELIVERY_BRAND,
		maxFileBytes: relayFileLimitBytes(),
	};
	if (!alias) return json(base, { headers: NO_STORE });

	assertAlias(alias);
	const delivered = await listSealedVersions(alias);
	const suggestedVersion = nextVersionPath(delivered);
	if (!version) return json({ ...base, delivered, suggestedVersion }, { headers: NO_STORE });

	assertVersionPath(version);
	const record = await readDeliveryRecord(alias, version);
	const files = record ? undefined : await listDeliveredFiles(alias, version);
	return json(
		{
			...base,
			delivered,
			suggestedVersion,
			folder: deliveryPrefix(alias, version),
			url: servedUrl(alias, version),
			record,
			files,
		},
		{ headers: NO_STORE },
	);
};

export const PUT: RequestHandler = async ({ request, url }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	const { alias, version } = params(url);
	const path = url.searchParams.get('path') ?? '';
	if (!alias || !version || !path) {
		return json(
			{ error: 'alias, version and path are required' },
			{ status: 400, headers: NO_STORE },
		);
	}

	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength === 0) {
		return json({ error: `'${path}' arrived empty` }, { status: 400, headers: NO_STORE });
	}

	const result = await relayDeliveryFile(alias, version, path, body);
	return json(result, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	const { alias, version } = params(url);
	if (!alias || !version) {
		return json({ error: 'alias and version are required' }, { status: 400, headers: NO_STORE });
	}

	let body: { files?: unknown; build?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const files = Array.isArray(body.files) ? body.files.filter((f) => typeof f === 'string') : [];
	if (files.length === 0) {
		return json({ error: 'files must be a non-empty list' }, { status: 400, headers: NO_STORE });
	}

	const result = await commitDelivery({
		alias,
		version,
		files,
		build: body.build ?? null,
		by: auth.user.email,
	});
	return json(result, { headers: NO_STORE });
};
