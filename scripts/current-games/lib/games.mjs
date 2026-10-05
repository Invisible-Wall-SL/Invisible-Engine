// The game list and each game's published snapshot, all READ-ONLY.
//
// List: `GET $PIPELINE_GAMES_URL` with `Authorization: Bearer $PIPELINE_CI_TOKEN` (the launcher's
// `/api/pipeline/games`), or `--games-file` for a local run. Snapshot: from R2 with a read-only key
// (`CURRENT_GAMES_R2_*`) — `publishedPointerKey` → `<id>/runtime.json` + `<id>/deploy/**` — and the
// game's mock contract from `test_server/games.json`. The Typekit mirror (`typekit.mjs`) reads
// `_ci/typekit-mirror/**` through the same key. Nothing here writes to R2.

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

export const R2_ENV = [
	'CURRENT_GAMES_R2_ENDPOINT',
	'CURRENT_GAMES_R2_BUCKET',
	'CURRENT_GAMES_R2_ACCESS_KEY_ID',
	'CURRENT_GAMES_R2_SECRET_ACCESS_KEY',
];
export const LIST_ENV = ['PIPELINE_GAMES_URL', 'PIPELINE_CI_TOKEN'];

/** The env vars a remote run needs that are unset — named, so a missing secret says which. */
export const missingEnv = (names) => names.filter((n) => !process.env[n]);

export async function listGames({ gamesFile }) {
	if (gamesFile) return JSON.parse(readFileSync(gamesFile, 'utf8')).games;
	const missing = missingEnv(LIST_ENV);
	if (missing.length) throw new Error(`missing secret(s): ${missing.join(', ')}`);
	// Checked here, with a message that never quotes it: `fetch` puts a bad URL in its TypeError.
	if (
		!URL.canParse(process.env.PIPELINE_GAMES_URL) ||
		new URL(process.env.PIPELINE_GAMES_URL).protocol !== 'https:'
	)
		throw new Error('PIPELINE_GAMES_URL is not an absolute https URL');
	const res = await fetch(process.env.PIPELINE_GAMES_URL, {
		headers: { authorization: `Bearer ${process.env.PIPELINE_CI_TOKEN}` },
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`game list: HTTP ${res.status} from PIPELINE_GAMES_URL`);
	return (await res.json()).games;
}

let client;
async function r2() {
	if (client) return client;
	const missing = missingEnv(R2_ENV);
	if (missing.length) throw new Error(`missing secret(s): ${missing.join(', ')}`);
	const s3 = await import('@aws-sdk/client-s3');
	client = {
		s3,
		bucket: process.env.CURRENT_GAMES_R2_BUCKET,
		send: new s3.S3Client({
			region: 'auto',
			endpoint: process.env.CURRENT_GAMES_R2_ENDPOINT,
			credentials: {
				accessKeyId: process.env.CURRENT_GAMES_R2_ACCESS_KEY_ID,
				secretAccessKey: process.env.CURRENT_GAMES_R2_SECRET_ACCESS_KEY,
			},
		}),
	};
	return client;
}

const isMissing = (e) => e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;

/** An object's text, or `null` when it does not exist. */
export async function getText(key) {
	const { s3, bucket, send } = await r2();
	try {
		const got = await send.send(new s3.GetObjectCommand({ Bucket: bucket, Key: key }));
		return await got.Body.transformToString('utf8');
	} catch (e) {
		if (isMissing(e)) return null;
		throw e;
	}
}

/** Save an object to `file`, creating its folder. */
export async function download(key, file) {
	const { s3, bucket, send } = await r2();
	const got = await send.send(new s3.GetObjectCommand({ Bucket: bucket, Key: key }));
	mkdirSync(dirname(file), { recursive: true });
	await pipeline(got.Body, createWriteStream(file));
}

async function listKeys(prefix) {
	const { s3, bucket, send } = await r2();
	const keys = [];
	let token;
	do {
		const page = await send.send(
			new s3.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
		);
		for (const o of page.Contents ?? [])
			if (!o.Key.endsWith('/') && !o.Key.split('/').includes('..')) keys.push(o.Key);
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	return keys;
}

/** The test server's manifest: each game's mock protocol + the contract frozen at its publish. */
export async function fetchManifest({ manifestFile }) {
	if (manifestFile) return JSON.parse(readFileSync(manifestFile, 'utf8')).games ?? {};
	const text = await getText('test_server/games.json');
	return text ? (JSON.parse(text).games ?? {}) : {};
}

const DONE = '.current-games-complete';
const POINTER_KEY = /^[\w.-]+(\/[\w.-]+)*\/pointer\.json$/;
const CONCURRENCY = 12;

/**
 * The game's current published snapshot: `{ id, prefix }`, or `null` when its pointer does not
 * exist (never published). A game in the list with `local.snapshot` (a fixture) has the id `local`. Read
 * once per run (the plan), so every render of the run uses the same snapshot even if the game is
 * republished mid-run.
 */
export async function currentSnapshot(game) {
	if (game.local?.snapshot) return { id: 'local' };
	// The key arrives from the launcher and names a folder on this disk: plain segments only.
	const segments = String(game.publishedPointerKey).split('/');
	if (!POINTER_KEY.test(game.publishedPointerKey) || segments.some((p) => /^\.+$/.test(p)))
		throw new Error(`refusing pointer key ${JSON.stringify(game.publishedPointerKey)}`);
	const text = await getText(game.publishedPointerKey);
	if (text === null) return null;
	const pointer = JSON.parse(text);
	if (typeof pointer.current !== 'string' || !/^[\w-]+$/.test(pointer.current))
		throw new Error(`${game.publishedPointerKey}: no valid current snapshot`);
	return {
		id: pointer.current,
		prefix: `${game.publishedPointerKey.replace(/pointer\.json$/, '')}${pointer.current}/`,
	};
}

/**
 * Snapshot `current` (from `currentSnapshot`) under `<cache>/snapshots/<prefix>`: `{ id, dir }`. A
 * snapshot is immutable by id, so a complete one is never downloaded twice.
 */
export async function fetchSnapshot(game, cache, current) {
	if (game.local?.snapshot) return { id: 'local', dir: game.local.snapshot };
	const { id, prefix } = current;
	if (!/^[\w-]+$/.test(id) || !prefix.endsWith(`/${id}/`))
		throw new Error(`refusing snapshot ${JSON.stringify(current)}`);
	const dir = join(cache, 'snapshots', prefix);
	if (existsSync(join(dir, DONE))) return { id, dir };
	const keys = await listKeys(`${prefix}deploy/`);
	let next = 0;
	const worker = async () => {
		while (next < keys.length) {
			const key = keys[next++];
			const file = resolve(dir, key.slice(prefix.length));
			if (!file.startsWith(resolve(dir) + sep)) throw new Error(`refusing object key ${key}`);
			await download(key, file);
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	// Last, like the publish writes it: a snapshot without runtime.json is not served.
	await download(`${prefix}runtime.json`, join(dir, 'runtime.json'));
	writeFileSync(join(dir, DONE), new Date().toISOString());
	return { id, dir };
}
