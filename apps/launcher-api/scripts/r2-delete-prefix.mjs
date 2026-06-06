// Delete every R2 object under a prefix. DRY-RUN by default (lists what would be
// deleted); pass --yes to actually delete. Used to clear orphaned data, e.g. a
// catalog seeded under a wrong project slug.
//
//   node scripts/r2-delete-prefix.mjs <prefix> [--yes]
//   node scripts/r2-delete-prefix.mjs borut/book_of_borut/            # dry-run
//   node scripts/r2-delete-prefix.mjs borut/book_of_borut/ --yes      # delete
//
// Safety: refuses an empty prefix or one without at least `client/project/` depth
// (two `/`-separated segments) so you can't wipe a whole client by accident.
// Env (for a real run): R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID /
//   R2_SECRET_ACCESS_KEY (same creds as r2-sync-*.mjs).
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const prefix = args.find((a) => !a.startsWith('--'));

if (!prefix) {
	console.error('Usage: node scripts/r2-delete-prefix.mjs <prefix> [--yes]');
	process.exit(1);
}
// Require at least two non-empty path segments (client/project) before allowing a
// delete, so a typo can't target a whole client or the bucket root.
const segments = prefix.replace(/\/+$/, '').split('/').filter(Boolean);
if (segments.length < 2) {
	console.error(
		`Refusing to delete the broad prefix ${JSON.stringify(prefix)} — needs at least client/project depth.`,
	);
	process.exit(1);
}

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}

const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import(
	'@aws-sdk/client-s3'
);
const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

async function listAll(p) {
	const keys = [];
	let ContinuationToken;
	do {
		const res = await s3.send(
			new ListObjectsV2Command({ Bucket: bucket, Prefix: p, ContinuationToken }),
		);
		for (const o of res.Contents ?? []) keys.push(o.Key);
		ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (ContinuationToken);
	return keys;
}

const keys = await listAll(prefix);
console.info(`Found ${keys.length} object(s) under ${bucket}/${prefix}`);
keys.slice(0, 20).forEach((k) => console.info(`  · ${k}`));
if (keys.length > 20) console.info(`  … and ${keys.length - 20} more`);

if (keys.length === 0) {
	console.info('Nothing to delete.');
	process.exit(0);
}
if (!yes) {
	console.info('\n--yes not passed: dry-run only, nothing deleted.');
	process.exit(0);
}

// S3 DeleteObjects takes up to 1000 keys per request.
let deleted = 0;
for (let i = 0; i < keys.length; i += 1000) {
	const batch = keys.slice(i, i + 1000);
	await s3.send(
		new DeleteObjectsCommand({
			Bucket: bucket,
			Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
		}),
	);
	deleted += batch.length;
	console.info(`  deleted ${deleted}/${keys.length}`);
}
console.info(`\nDone. Deleted ${deleted} object(s) under ${prefix}`);
