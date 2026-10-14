/**
 * Upload a DELIVERY build (`scripts/build-delivery.mjs`) into the PARTNER's R2 bucket through the
 * portal, so it is served at `{cdnUrl}/{brand}/games/{versionPath}/{gameAlias}/game.js` — the URL
 * their page composes (`docs/design/delivery-builds.md` §"The embed").
 *
 * WHY THROUGH THE PORTAL. The bucket is in the partner's Cloudflare account and the key pair they
 * gave us is the only credential we hold for it, so it lives in the launcher's env and nowhere else:
 * not on a publisher's machine, not in a game repo. The bytes travel the same way a ☁ Publish's do
 * (`gameBundleRelay.ts`), which also keeps a delivery working from a line that null-routes
 * `*.r2.cloudflarestorage.com`.
 *
 * A VERSION FOLDER IS WRITTEN ONCE. `game.js` has a fixed name and no content hash, so `versionPath`
 * is the only cache-buster their page has, and every file is served `immutable`. Overwriting a
 * folder a partner already points at would serve a mix of two builds to whoever has half of it
 * cached. So a commit SEALS the folder — a record in OUR bucket, `deliveries/<alias>/<version>.json`
 * — and a sealed folder refuses every further write. A new build is a new `versionPath`; a rollback
 * is the partner pointing back at the old one. Until it is sealed a folder is ours to resume into.
 */
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { error, isHttpError } from '@sveltejs/kit';
import { assertSafeRel } from './deployServe';
import { ENV } from './env';
import { bundleContentType, MAX_RELAY_FILE_BYTES, type RelayedFile } from './gameBundleRelay';
import { ConflictError, getObjectText, listAllObjects, precondition, putObjectText } from './r2';

/** What their page loads — fixed across games, so it is what a commit insists on. */
export const DELIVERY_ENTRY = 'game.js';
/** The app-server half of a handover (`build-delivery.mjs` `HOST_PAGE_FILE`). It ships BESIDE the
 *  CDN folder; served from the CDN it would be source handed out to anyone. */
const HOST_PAGE = 'embed.html';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const RECORD_ROOT = 'deliveries';

const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/;

export function deliveryConfigured(): boolean {
	return Boolean(
		ENV.DELIVERY_R2_BUCKET && ENV.DELIVERY_R2_ACCESS_KEY_ID && ENV.DELIVERY_R2_SECRET_ACCESS_KEY,
	);
}

function assertConfigured(): void {
	if (!deliveryConfigured()) {
		throw error(
			503,
			'Partner delivery is not configured on the portal (DELIVERY_R2_BUCKET / ' +
				'DELIVERY_R2_ACCESS_KEY_ID / DELIVERY_R2_SECRET_ACCESS_KEY). Nothing was written.',
		);
	}
}

/** The partner's `gameAlias`: the game's display name with spaces removed. */
export function assertAlias(alias: string): void {
	if (!ALIAS_RE.test(alias)) {
		throw error(400, `Invalid gameAlias '${alias}' — letters, digits, '_' and '-' only.`);
	}
}

export function assertVersionPath(version: string): void {
	if (!VERSION_RE.test(version) || version.includes('..')) {
		throw error(
			400,
			`Invalid versionPath '${version}' — letters, digits, '.', '_' and '-' only (e.g. 'v3').`,
		);
	}
}

/** The CDN folder one delivery lives in, inside the partner's bucket. */
export function deliveryPrefix(alias: string, version: string, brand = ENV.DELIVERY_BRAND): string {
	if (!ALIAS_RE.test(brand)) throw error(500, `DELIVERY_BRAND '${brand}' is not a plain segment.`);
	assertAlias(alias);
	assertVersionPath(version);
	return `${brand}/games/${version}/${alias}/`;
}

/** The partner-bucket key one uploaded file lands on, refused unless it stays inside its folder. */
export function deliveryObjectKey(
	alias: string,
	version: string,
	rel: string,
	brand = ENV.DELIVERY_BRAND,
): string {
	const prefix = deliveryPrefix(alias, version, brand);
	if (!rel || rel.endsWith('/') || rel.startsWith('./') || /^[a-zA-Z]:/.test(rel)) {
		throw error(400, `Invalid delivery path '${rel}'.`);
	}
	assertSafeRel(rel);
	if (rel.split('/').pop() === HOST_PAGE) {
		throw error(
			400,
			`'${rel}' is the host page for the partner's app server — it does not go on the CDN.`,
		);
	}
	return `${prefix}${rel}`;
}

/** Where the partner's page will load this delivery from. */
export function servedUrl(alias: string, version: string, cdnUrl = ENV.DELIVERY_CDN_URL): string {
	return `${cdnUrl}/${deliveryPrefix(alias, version)}${DELIVERY_ENTRY}`;
}

function recordPrefix(alias: string): string {
	assertAlias(alias);
	return `${RECORD_ROOT}/${alias}/`;
}

function recordKey(alias: string, version: string): string {
	assertVersionPath(version);
	return `${recordPrefix(alias)}${version}.json`;
}

/**
 * The `versionPath` to suggest for a game's next delivery: one past the highest `v<N>` it has been
 * delivered under, `v1` for its first. A versionPath we did not mint (`v1.0`, `2026-10`) is never
 * reused because it is sealed, and simply does not move the count.
 */
export function nextVersionPath(sealed: string[]): string {
	let max = 0;
	for (const v of sealed) {
		const m = /^v(\d+)$/.exec(v);
		if (m) max = Math.max(max, Number(m[1]));
	}
	let n = max + 1;
	while (sealed.includes(`v${n}`)) n++;
	return `v${n}`;
}

export interface DeliveryRecord {
	alias: string;
	versionPath: string;
	brand: string;
	url: string;
	files: number;
	bytes: number;
	sealedAt: string;
	by: string;
	/** Path → MD5 of every file sealed, so a later change to the folder is detectable. */
	manifest: Record<string, string>;
	/** `build-info.json` as the build wrote it — which build the partner is running. */
	build: unknown;
}

/** Every versionPath this game has been delivered (sealed) under, oldest first. */
export async function listSealedVersions(alias: string): Promise<string[]> {
	const prefix = recordPrefix(alias);
	return (await listAllObjects(prefix))
		.filter((o) => o.key.endsWith('.json'))
		.sort((a, b) => a.lastModified - b.lastModified)
		.map((o) => o.key.slice(prefix.length, -'.json'.length));
}

export async function readDeliveryRecord(
	alias: string,
	version: string,
): Promise<DeliveryRecord | null> {
	const text = await getObjectText(recordKey(alias, version));
	return text ? (JSON.parse(text) as DeliveryRecord) : null;
}

async function assertNotSealed(alias: string, version: string): Promise<void> {
	const record = await readDeliveryRecord(alias, version);
	if (record) {
		throw error(
			409,
			`${alias} ${version} was already delivered on ${record.sealedAt} and may be live on the ` +
				`partner's page — a delivered folder is never overwritten. Use a new versionPath.`,
		);
	}
}

let client: S3Client | null = null;

function isPreconditionFailed(e: unknown): boolean {
	const meta = (e as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
	return meta.$metadata?.httpStatusCode === 412 || meta.name === 'PreconditionFailed';
}

/** A partner-bucket failure (wrong bucket name, endpoint or token scope) as a 502 that says so,
 *  by error name only — never the SDK's raw response, which can echo request details. */
function partnerFailure(what: string, e: unknown): never {
	if (isHttpError(e)) throw e;
	const name = (e as { name?: string })?.name ?? 'Error';
	throw error(
		502,
		`The partner bucket refused the ${what} (${name}). Check DELIVERY_R2_BUCKET, ` +
			`DELIVERY_R2_ENDPOINT and that the token can read, write and delete in it.`,
	);
}

function partnerS3(): S3Client {
	assertConfigured();
	if (!client) {
		client = new S3Client({
			region: 'auto',
			endpoint: ENV.DELIVERY_R2_ENDPOINT,
			credentials: {
				accessKeyId: ENV.DELIVERY_R2_ACCESS_KEY_ID,
				secretAccessKey: ENV.DELIVERY_R2_SECRET_ACCESS_KEY,
			},
		});
	}
	return client;
}

async function listPartner(prefix: string): Promise<RelayedFile[]> {
	const out: RelayedFile[] = [];
	let token: string | undefined;
	do {
		const res = await partnerS3()
			.send(
				new ListObjectsV2Command({
					Bucket: ENV.DELIVERY_R2_BUCKET,
					Prefix: prefix,
					ContinuationToken: token,
				}),
			)
			.catch((e: unknown) => partnerFailure('listing', e));
		for (const o of res.Contents ?? []) {
			if (typeof o.Key !== 'string' || o.Key.endsWith('/')) continue;
			const etag = (o.ETag ?? '').replace(/"/g, '').toLowerCase();
			out.push({
				path: o.Key.slice(prefix.length),
				size: o.Size ?? 0,
				md5: /^[0-9a-f]{32}$/.test(etag) ? etag : '',
			});
		}
		token = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (token);
	return out;
}

/** What a version folder already holds, so a resumed upload sends only what is missing. */
export function listDeliveredFiles(alias: string, version: string): Promise<RelayedFile[]> {
	return listPartner(deliveryPrefix(alias, version));
}

/**
 * Write one file into an UNSEALED version folder. Written `If-None-Match: *`, so no object is ever
 * overwritten in place: a resumed upload replacing a file that differs deletes it first, and that
 * is only reachable before the seal. A PUT racing the seal can therefore at most ADD a path the
 * sealed manifest does not list — never change a file the partner's page loads.
 */
export async function relayDeliveryFile(
	alias: string,
	version: string,
	rel: string,
	bytes: Uint8Array,
): Promise<{ path: string; bytes: number }> {
	const key = deliveryObjectKey(alias, version, rel);
	if (bytes.byteLength > MAX_RELAY_FILE_BYTES) {
		throw error(413, `'${rel}' is ${bytes.byteLength} bytes — over the per-file relay cap.`);
	}
	await assertNotSealed(alias, version);
	const put = () =>
		partnerS3().send(
			new PutObjectCommand({
				Bucket: ENV.DELIVERY_R2_BUCKET,
				Key: key,
				Body: bytes,
				ContentType: bundleContentType(rel),
				CacheControl: IMMUTABLE,
				IfNoneMatch: '*',
			}),
		);
	try {
		await put();
	} catch (e) {
		if (!isPreconditionFailed(e)) partnerFailure('upload', e);
		await assertNotSealed(alias, version);
		try {
			await partnerS3().send(new DeleteObjectCommand({ Bucket: ENV.DELIVERY_R2_BUCKET, Key: key }));
			await put();
		} catch (retry) {
			partnerFailure('upload', retry);
		}
	}
	return { path: rel, bytes: bytes.byteLength };
}

export interface ServedProbe {
	/** HTTP status of `game.js` at the public URL, or 0 when it could not be reached at all. */
	status: number;
	/** `Access-Control-Allow-Origin` as served — the partner's page fetches the art cross-origin,
	 *  and WebGL refuses a texture without it, so a missing header is a blank game. */
	cors: string | null;
	error?: string;
}

/**
 * Fetch the delivery the way their page will, as a smoke test. Never fails a commit: the folder is
 * already sealed, and a missing custom domain or CORS rule is the partner's bucket setting to fix,
 * not a reason to undo an upload.
 */
async function probeServed(url: string): Promise<ServedProbe> {
	try {
		const res = await fetch(url, {
			method: 'HEAD',
			headers: { origin: 'https://example.com' },
			signal: AbortSignal.timeout(10_000),
		});
		return { status: res.status, cors: res.headers.get('access-control-allow-origin') };
	} catch (e) {
		return { status: 0, cors: null, error: e instanceof Error ? e.message : String(e) };
	}
}

export interface CommitDeliveryRequest {
	alias: string;
	version: string;
	/** EVERY file in the delivery folder with its MD5 — the set the verify and prune are taken
	 *  against. Checking content, not just names, is what stops two publishers who were handed the
	 *  same suggested versionPath sealing a mix of both builds. */
	files: { path: string; md5: string }[];
	build: unknown;
	by: string;
}

export interface CommitDeliveryResult {
	record: DeliveryRecord;
	pruned: number;
	served: ServedProbe;
}

/**
 * Seal a version folder: verify every declared file landed, prune what the build did not produce
 * (left over from an abandoned attempt at the same versionPath), then write the record that makes
 * the folder read-only. The record is written `If-None-Match: *`, so two publishers sealing the
 * same versionPath at once cannot both win.
 */
export async function commitDelivery(req: CommitDeliveryRequest): Promise<CommitDeliveryResult> {
	const { alias, version, files, build, by } = req;
	if (!files.some((f) => f.path === DELIVERY_ENTRY)) {
		throw error(400, `The declared file list has no ${DELIVERY_ENTRY} — that is not a delivery.`);
	}
	const prefix = deliveryPrefix(alias, version);
	const declared = new Map<string, string>();
	for (const f of files) {
		deliveryObjectKey(alias, version, f.path);
		if (!/^[0-9a-f]{32}$/.test(f.md5)) throw error(400, `'${f.path}' has no valid md5.`);
		declared.set(f.path, f.md5);
	}
	await assertNotSealed(alias, version);

	const present = await listPartner(prefix);
	const held = new Map(present.map((f) => [f.path, f.md5]));
	const wrong = [...declared].filter(([path, md5]) => held.get(path) !== md5).map(([p]) => p);
	if (wrong.length > 0) {
		throw error(
			409,
			`${wrong.length} of ${declared.size} file(s) are missing or differ from this build — not ` +
				`sealing a half-uploaded or mixed delivery. Re-run the upload (it resumes). ` +
				`${wrong.slice(0, 5).join(', ')}${wrong.length > 5 ? ', …' : ''}`,
		);
	}

	const stale = present.filter((f) => !declared.has(f.path)).map((f) => `${prefix}${f.path}`);
	for (let i = 0; i < stale.length; i += 1000) {
		const res = await partnerS3()
			.send(
				new DeleteObjectsCommand({
					Bucket: ENV.DELIVERY_R2_BUCKET,
					Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
				}),
			)
			.catch((e: unknown) => partnerFailure('prune', e));
		if (res.Errors?.length) {
			throw error(
				502,
				`The partner bucket would not delete ${res.Errors.length} stale file(s) — not sealing a ` +
					`folder that still holds them (${res.Errors[0].Key ?? '?'}: ${res.Errors[0].Code ?? '?'}).`,
			);
		}
	}

	const url = servedUrl(alias, version);
	const record: DeliveryRecord = {
		alias,
		versionPath: version,
		brand: ENV.DELIVERY_BRAND,
		url,
		files: declared.size,
		bytes: present.filter((f) => declared.has(f.path)).reduce((n, f) => n + f.size, 0),
		sealedAt: new Date().toISOString(),
		by,
		manifest: Object.fromEntries(declared),
		build,
	};
	try {
		await putObjectText(
			recordKey(alias, version),
			`${JSON.stringify(record, null, 2)}\n`,
			'application/json; charset=utf-8',
			precondition(null),
		);
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		await assertNotSealed(alias, version);
		throw error(409, `${alias} ${version} was sealed by another upload at the same moment.`);
	}

	return { record, pruned: stale.length, served: await probeServed(url) };
}
