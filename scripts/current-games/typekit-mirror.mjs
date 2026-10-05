// Refresh the Typekit mirror the current-games harness renders with (`lib/typekit.mjs`): fetch the
// runtime's kit(s) from Adobe — the stylesheet, the script and every font file the stylesheet
// names — and upload them to R2 under `_ci/typekit-mirror/` (blobs by sha256, then `current.json`
// last, in one write). Players are not touched: they keep loading from Adobe. The "Typekit mirror"
// workflow (`.github/workflows/typekit-mirror.yml`) runs this with the release's read-write `R2_*`
// secrets; it also runs from a machine that can reach Adobe with the same env.
//
//   node scripts/current-games/typekit-mirror.mjs refresh [--dry-run] [--kit <id>]… [--out <dir>]
//   node scripts/current-games/typekit-mirror.mjs show
//
// `refresh` mirrors the kit ids harvested from the runtime's sources plus any `--kit` (a branch
// that changes the kit refreshes with both ids until it merges, since main's runtime still loads
// the old one). `--out` also writes the mirror as a local dir, which `run.mjs --typekit <dir>`
// renders with. `--dry-run` fetches and reports, and writes nothing to R2. `show` prints what R2
// holds (either R2 env set).

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
	blobKey,
	crawlKit,
	kitIds,
	MANIFEST_KEY,
	manifestFor,
	writeMirrorDir,
} from './lib/typekit.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const WRITE_ENV = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
const READ_ENV = [
	'CURRENT_GAMES_R2_ENDPOINT',
	'CURRENT_GAMES_R2_BUCKET',
	'CURRENT_GAMES_R2_ACCESS_KEY_ID',
	'CURRENT_GAMES_R2_SECRET_ACCESS_KEY',
];

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		'dry-run': { type: 'boolean', default: false },
		kit: { type: 'string', multiple: true, default: [] },
		out: { type: 'string' },
	},
});
const command = positionals[0];
const log = (...parts) => console.log(`[typekit-mirror] ${parts.join(' ')}`);

async function r2(names) {
	const missing = names.filter((n) => !process.env[n]);
	if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
	const [endpoint, bucket, accessKeyId, secretAccessKey] = names.map((n) => process.env[n]);
	const s3 = await import('@aws-sdk/client-s3');
	const client = new s3.S3Client({
		region: 'auto',
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
	});
	return { s3, bucket, client };
}

const isMissing = (e) =>
	e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;

async function show() {
	const names = WRITE_ENV.every((n) => process.env[n]) ? WRITE_ENV : READ_ENV;
	const { s3, bucket, client } = await r2(names);
	try {
		const got = await client.send(new s3.GetObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY }));
		const manifest = JSON.parse(await got.Body.transformToString('utf8'));
		log(
			`mirror ${manifest.hash}: kits ${manifest.kits.join(', ')}, ${manifest.files.length} files, fetched ${manifest.fetchedAt}`,
		);
		for (const f of manifest.files)
			log(`  ${f.size.toString().padStart(8)} ${f.contentType.padEnd(16)} ${f.url}`);
	} catch (e) {
		if (!isMissing(e)) throw e;
		log(`no mirror in R2 (${MANIFEST_KEY}): run \`refresh\``);
		process.exitCode = 1;
	}
}

async function refresh() {
	const kits = [...new Set([...kitIds(ROOT), ...opt.kit])].sort();
	if (!kits.length)
		throw new Error('no kit id: none harvested from the runtime, none given with --kit');
	log(`kits: ${kits.join(', ')}`);
	const files = [];
	for (const kit of kits) files.push(...(await crawlKit(kit)));
	const manifest = manifestFor(kits, files);
	const bytes = files.reduce((n, f) => n + f.body.length, 0);
	log(`${files.length} files, ${(bytes / 1024).toFixed(0)} KiB, hash ${manifest.hash}`);
	for (const f of manifest.files)
		log(`  ${f.size.toString().padStart(8)} ${f.contentType.padEnd(16)} ${f.url}`);
	if (opt.out) log(`written to ${writeMirrorDir(resolve(opt.out), manifest, files)}`);
	if (opt['dry-run']) return log('dry run: nothing written to R2');
	const { s3, bucket, client } = await r2(WRITE_ENV);
	const bySha = new Map(manifest.files.map((f) => [f.sha256, f]));
	let uploaded = 0;
	for (const file of files) {
		const entry = bySha.get(manifest.files.find((f) => f.url === file.url).sha256);
		const key = blobKey(entry.sha256);
		const exists = await client.send(new s3.HeadObjectCommand({ Bucket: bucket, Key: key })).then(
			() => true,
			(e) => (isMissing(e) ? false : Promise.reject(e)),
		);
		if (exists) continue;
		await client.send(
			new s3.PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: file.body,
				ContentType: entry.contentType,
			}),
		);
		uploaded++;
	}
	// Last, and in one write: a render that reads the manifest finds every blob it names.
	await client.send(
		new s3.PutObjectCommand({
			Bucket: bucket,
			Key: MANIFEST_KEY,
			Body: JSON.stringify(manifest, null, '\t'),
			ContentType: 'application/json',
		}),
	);
	log(`uploaded ${uploaded} new blob(s); ${MANIFEST_KEY} now ${manifest.hash}`);
	if (process.env.GITHUB_STEP_SUMMARY) {
		const { appendFileSync } = await import('node:fs');
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### Typekit mirror\nkits ${kits.join(', ')} · ${files.length} files · hash \`${manifest.hash}\` · ${uploaded} new blob(s)\n`,
		);
	}
}

try {
	if (command === 'refresh') await refresh();
	else if (command === 'show') await show();
	else {
		console.error(
			'usage: typekit-mirror.mjs refresh [--dry-run] [--kit <id>]… [--out <dir>] | show',
		);
		process.exit(2);
	}
} catch (e) {
	console.error(`[typekit-mirror] ${e.message}`);
	process.exit(1);
}
