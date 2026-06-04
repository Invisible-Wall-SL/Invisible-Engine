// Pull a project's deploy-ready assets out of R2 into a game repo's
// `static/assets/`, so `pnpm build` bundles the LATEST edited art (not the
// stale spritesheet committed in the repo). Wire as a `prebuild`/`predeploy`
// hook so every build grabs the current `<client>/<project>/deploy/` tree.
// See docs/design/live-assets.md §2 (Transport — build-time pull).
//
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/pull-project-assets.mjs \
//       --project <client>/<project> --dest <gameRepo>/static/assets [--dry-run]
//
// The R2 source prefix is `<r2Slug(client)>/<r2Slug(project)>/deploy/` and each
// object at `deploy/<rel>` is mirrored verbatim to `<dest>/<rel>`:
//   R2:    borut/book_of_borut/deploy/sprites/symbolsStatic/symbolsStatic.json
//   local: <dest>/sprites/symbolsStatic/symbolsStatic.json
//
// Examples:
//   # Book of Borut (its own repo, engine as submodule):
//   node <engine>/apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project borut/book_of_borut --dest ./static/assets
//
//   # Preview what would be pulled without writing anything:
//   node <engine>/apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project borut/book_of_borut --dest ./static/assets --dry-run

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const USAGE =
	'Usage: node pull-project-assets.mjs --project <client>/<project> --dest <static/assets> [--dry-run]\n' +
	'   or: node pull-project-assets.mjs --client <client> --project <project> --dest <static/assets> [--dry-run]';

if (args.length === 0 || hasFlag('help') || hasFlag('h')) {
	console.info(USAGE);
	process.exit(args.length === 0 ? 1 : 0);
}

// Normalize a client/project name into the R2 path segment both the launcher
// and the Python tools use. MUST stay byte-identical to the launcher's
// `src/lib/server/projectPaths.ts::r2Slug` (`[^a-z0-9] → _`, lowercased, 60 chars).
const r2Slug = (name) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';

// Accept either `--project <client>/<project>` or `--client X --project Y`.
let clientArg = getFlag('client');
let projectArg = getFlag('project');
if (!clientArg && projectArg && projectArg.includes('/')) {
	const idx = projectArg.indexOf('/');
	clientArg = projectArg.slice(0, idx);
	projectArg = projectArg.slice(idx + 1);
}
if (!clientArg || !projectArg) {
	console.error(USAGE);
	console.error('Missing --project (as <client>/<project>) or --client + --project.');
	process.exit(1);
}

const destArg = getFlag('dest');
if (!destArg) {
	console.error(USAGE);
	console.error("Missing --dest (the game repo's static/assets directory to mirror into).");
	process.exit(1);
}
const dest = isAbsolute(destArg) ? destArg : resolve(process.cwd(), destArg);
const dryRun = hasFlag('dry-run');

const client = r2Slug(clientArg);
const project = r2Slug(projectArg);
// Source prefix mirrors projectPaths.ts `SUB.deploy` (`<C>/<P>/deploy`).
const PREFIX = `${client}/${project}/deploy/`;

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}

const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({
	region: 'auto',
	endpoint,
	credentials: { accessKeyId, secretAccessKey },
});

// List every object under deploy/, paginating through all ContinuationToken pages.
async function listAllKeys(prefix) {
	const out = [];
	let token;
	do {
		const res = await s3.send(
			new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
		);
		for (const o of res.Contents ?? []) {
			// Skip the folder placeholder object (key === prefix, zero bytes).
			if (typeof o.Key === 'string' && o.Key !== prefix) out.push(o.Key);
		}
		token = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (token);
	return out;
}

console.info(`Pulling ${bucket}/${PREFIX} → ${dest}${dryRun ? '  (dry run)' : ''}`);
const keys = await listAllKeys(PREFIX);

if (keys.length === 0) {
	console.error(
		`no deploy assets for ${clientArg}/${projectArg} (R2 ${PREFIX}) — has the atlas been deployed?`,
	);
	process.exit(1);
}

let pulled = 0;
let bytes = 0;
for (const key of keys.sort()) {
	const rel = key.slice(PREFIX.length); // deploy/<rel> → <rel>, verbatim
	const outPath = join(dest, ...rel.split('/'));
	if (dryRun) {
		console.info(`  ${key}  →  ${outPath}`);
		pulled++;
		continue;
	}
	const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	const body = await res.Body.transformToByteArray();
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, body);
	pulled++;
	bytes += body.length;
	if (pulled === 1 || pulled % 25 === 0) {
		console.info(`  ${rel} (${(body.length / 1024).toFixed(0)} KB)`);
	}
}

if (dryRun) {
	console.info(
		`\nWould pull ${pulled} file(s) from ${bucket}/${PREFIX} into ${dest.split(sep).join('/')}.`,
	);
} else {
	console.info(
		`\nPulled ${pulled} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB into ${dest.split(sep).join('/')}.`,
	);
}
