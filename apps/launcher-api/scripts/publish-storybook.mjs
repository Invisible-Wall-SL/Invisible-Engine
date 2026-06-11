// Publish a static Storybook build to R2 so the launcher's Invisible Storybook
// tool (/storybook) can serve it. Two destinations:
//
//   --project <client>/<project>  →  <client>/<project>/storybook/   (project-scoped;
//                                    gated by the per-project access model)
//   --shared  (alias --engine)    →  _shared/storybook/engine/       (the engine
//                                    reference storybook, readable by any user
//                                    entitled to the tool)
//
// Without --dir it BUILDS the storybook first (`pnpm exec storybook build` in
// --cwd, output storybook-static/) — run it from the app/game that owns the
// .storybook config, or pass an already-built dir.
//
// Stale keys under the destination prefix are PRUNED (storybook hashes its
// filenames, so without pruning the prefix grows forever).
//
// Env (same contract as the sibling scripts — never hardcode secrets):
//   R2_ENDPOINT          https://<accountid>.r2.cloudflarestorage.com
//   R2_BUCKET            invisibleassets
//   R2_ACCESS_KEY_ID     <R2 API token Access Key ID>
//   R2_SECRET_ACCESS_KEY <R2 API token Secret>
//
// Examples:
//   # Engine reference (apps/lines), build + publish:
//   cd apps/lines && pnpm build-storybook
//   node ../launcher-api/scripts/publish-storybook.mjs --shared --dir storybook-static
//
//   # Book of Borut (its own repo, engine as submodule) — from the game repo root.
//   # Needs @aws-sdk/client-s3 installed in the GAME repo (pnpm add -D
//   # @aws-sdk/client-s3) and a pre-built storybook dir:
//   node ./engine/apps/launcher-api/scripts/publish-storybook.mjs \
//     --project borut/bookofborut --dir storybook-static
//
//   # Preview what would be uploaded/pruned, no writes:
//   node apps/launcher-api/scripts/publish-storybook.mjs --shared --dir storybook-static --dry-run

import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const USAGE =
	'Usage: node publish-storybook.mjs (--project <client>/<project> | --shared) \\\n' +
	'         [--dir <storybook-static>] [--cwd <appDir>] [--dry-run]\n' +
	'\n' +
	'  --project <client>/<project>  publish to <client>/<project>/storybook/ (project-scoped)\n' +
	'  --shared | --engine           publish the engine reference to _shared/storybook/engine/\n' +
	'  --dir <path>                  an already-built storybook-static dir; when omitted the\n' +
	'                                script runs `pnpm exec storybook build` first\n' +
	'  --cwd <path>                  where to run the storybook build (default: process.cwd();\n' +
	'                                must contain the .storybook config)\n' +
	'  --dry-run                     print the upload/prune plan, write nothing\n' +
	'\n' +
	'Env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (upload only).';

if (args.length === 0 || hasFlag('help') || hasFlag('h')) {
	console.info(USAGE);
	process.exit(args.length === 0 ? 1 : 0);
}

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (name) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';

const shared = hasFlag('shared') || hasFlag('engine');
const project = getFlag('project');
if (shared === Boolean(project)) {
	console.error(USAGE);
	console.error('\nPass exactly ONE of --project <client>/<project> or --shared.');
	process.exit(1);
}
let prefix;
if (shared) {
	prefix = '_shared/storybook/engine/';
} else {
	const [client, proj, ...extra] = project.split('/');
	if (!client || !proj || extra.length > 0) {
		console.error(`--project must be <client>/<project> (got '${project}').`);
		process.exit(1);
	}
	prefix = `${r2Slug(client)}/${r2Slug(proj)}/storybook/`;
}

const dryRun = hasFlag('dry-run');
const cwd = resolve(getFlag('cwd') ?? process.cwd());

// 1. Resolve the build dir — given, or produced by a fresh `storybook build`.
let buildDir;
const dirArg = getFlag('dir');
if (dirArg) {
	buildDir = isAbsolute(dirArg) ? dirArg : resolve(cwd, dirArg);
} else {
	console.info(`Building storybook in ${cwd} (pnpm exec storybook build) …`);
	const res = spawnSync('pnpm', ['exec', 'storybook', 'build'], {
		cwd,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	if (res.status !== 0) {
		console.error(`storybook build failed (exit ${res.status ?? 'signal'}).`);
		process.exit(1);
	}
	buildDir = join(cwd, 'storybook-static');
}

// Sanity: a storybook build always has an index.html at its root.
try {
	await stat(join(buildDir, 'index.html'));
} catch {
	console.error(`No index.html in '${buildDir}' — not a storybook-static build dir.`);
	process.exit(1);
}

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.wasm': 'application/wasm',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.atlas': 'text/plain; charset=utf-8',
	'.skel': 'application/octet-stream',
};

async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (entry.isFile()) yield full;
	}
}

const files = [];
for await (const file of walk(buildDir)) {
	files.push({ file, rel: relative(buildDir, file).split(sep).join('/') });
}
files.sort((a, b) => a.rel.localeCompare(b.rel));
console.info(`Publishing ${files.length} file(s) from ${buildDir}\n  → ${prefix}`);

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const haveCreds = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
if (!haveCreds && !dryRun) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}

if (dryRun && !haveCreds) {
	for (const { rel } of files) console.info(`  + ${rel}`);
	console.info(
		`\n--dry-run: would upload ${files.length} file(s) to ${prefix} ` +
			'(no R2 creds — prune plan unknown).',
	);
	process.exit(0);
}

// The SDK normally resolves from apps/launcher-api's node_modules (this script's
// location). In a game repo the engine submodule never installs apps/*, so fall
// back to resolving from the CALLER's repo — `pnpm add -D @aws-sdk/client-s3`
// there makes this work.
let s3sdk;
try {
	s3sdk = await import('@aws-sdk/client-s3');
} catch {
	try {
		s3sdk = createRequire(join(process.cwd(), 'noop.js'))('@aws-sdk/client-s3');
	} catch {
		console.error(
			"Cannot resolve '@aws-sdk/client-s3'. Install it in this repo " +
				'(pnpm add -D @aws-sdk/client-s3) or run this script from the engine monorepo ' +
				'checkout (where apps/launcher-api is installed), passing --dir <path-to-storybook-static>.',
		);
		process.exit(1);
	}
}
const { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = s3sdk;
const s3 = new S3Client({
	region: 'auto',
	endpoint,
	credentials: { accessKeyId, secretAccessKey },
});

// 2. List what's already under the prefix so stale (renamed-hash) keys get pruned.
const existing = [];
let token;
do {
	const res = await s3.send(
		new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
	);
	for (const o of res.Contents ?? []) if (typeof o.Key === 'string') existing.push(o.Key);
	token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token);

const newKeys = new Set(files.map(({ rel }) => `${prefix}${rel}`));
const stale = existing.filter((key) => !newKeys.has(key));

if (dryRun) {
	for (const { rel } of files) console.info(`  + ${rel}`);
	for (const key of stale) console.info(`  - ${key} (stale)`);
	console.info(`\n--dry-run: would upload ${files.length} file(s), prune ${stale.length}.`);
	process.exit(0);
}

// 3. Upload the new build.
let uploaded = 0;
let bytes = 0;
for (const { file, rel } of files) {
	const body = await readFile(file);
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${prefix}${rel}`,
			Body: body,
			ContentType: MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream',
		}),
	);
	uploaded++;
	bytes += body.length;
	if (rel === 'index.html' || uploaded % 25 === 0) {
		console.info(`  ${rel} (${(body.length / 1024).toFixed(0)} KB)`);
	}
}

// 4. Prune keys not present in the new build (≤1000 per delete request).
for (let i = 0; i < stale.length; i += 1000) {
	const batch = stale.slice(i, i + 1000);
	await s3.send(
		new DeleteObjectsCommand({
			Bucket: bucket,
			Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
		}),
	);
}

console.info(
	`\nUploaded ${uploaded} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB; ` +
		`pruned ${stale.length} stale key(s) under ${bucket}/${prefix}`,
);
console.info('Open it in the launcher: app.invisiblewall.org/storybook');
