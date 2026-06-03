// Pull a project's DEPLOYED atlas assets from R2 (`<client>/<project>/deploy/`) DOWN
// into a local game-assets folder, so a subsequent game build bakes the updated art.
//
// This is the missing link for "edit atlas → rebuild game → see it in the game":
// the Atlas Maker's Deploy writes the composed atlas to R2 `<client>/<project>/deploy/`,
// but a game build inlines whatever art is committed in the game repo's static/ tree.
// Run this BEFORE `pnpm build` (wire it into the desktop launcher's build step, ahead
// of build_game) so the build picks up the freshly-deployed art. See
// docs/design/unified-project-repo.md and docs/tools/atlas-maker.md.
//
//   node scripts/r2-sync-deploy.mjs <targetDir> [client] [project] [options]
//
//   targetDir   where to write — typically the game repo's static/assets/spines dir
//   client/project  default borut / hotfruits (slug-normalized like everywhere else)
//
// Options:
//   --flat            write each file flat into <targetDir>/<filename>
//                     (default: group a flat deploy file by stem →
//                      <targetDir>/<stem>/<filename>, matching static/assets/spines/<group>/;
//                      files already nested under deploy/ keep their sub-path)
//   --map <file.json> explicit overrides: { "<deployFilename>": "<relative/dest/path>" }
//   --dry-run         print the plan, download nothing
//
// Env (real run): R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

const r2Slug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'default';

const args = process.argv.slice(2);
const flat = args.includes('--flat');
const dry = args.includes('--dry-run');
const mapIdx = args.indexOf('--map');
const mapFile = mapIdx >= 0 ? args[mapIdx + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--map');

const TARGET = positional[0];
const CLIENT = positional[1] ?? process.env.IW_CLIENT ?? 'borut';
const PROJECT = positional[2] ?? process.env.IW_PROJECT ?? 'hotfruits';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}/deploy/`;

if (!TARGET) {
	console.error('Usage: node scripts/r2-sync-deploy.mjs <targetDir> [client] [project] [--flat] [--map f.json] [--dry-run]');
	process.exit(1);
}

/** Map a deploy-relative name to its destination path under TARGET. */
function destFor(rel, overrides) {
	if (overrides[rel]) return join(TARGET, overrides[rel]);
	const base = posix.basename(rel);
	if (overrides[base]) return join(TARGET, overrides[base]);
	if (rel.includes('/')) return join(TARGET, rel); // already structured under deploy/
	if (flat) return join(TARGET, base);
	const stem = base.replace(/\.[^.]+$/, ''); // group flat file by stem → <stem>/<file>
	return join(TARGET, stem, base);
}

async function main() {
	const overrides = mapFile ? JSON.parse(await readFile(mapFile, 'utf8')) : {};

	const endpoint = process.env.R2_ENDPOINT;
	const bucket = process.env.R2_BUCKET;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
		console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
		process.exit(1);
	}

	const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
	const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

	// List everything under the project's deploy/ prefix (paginated).
	const keys = [];
	let token;
	do {
		const resp = await s3.send(
			new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }),
		);
		for (const o of resp.Contents ?? []) if (!o.Key.endsWith('/')) keys.push(o.Key);
		token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
	} while (token);

	if (!keys.length) {
		console.info(`No objects under ${bucket}/${PREFIX} — nothing deployed for this project yet.`);
		return;
	}

	const plan = keys.map((key) => {
		const rel = key.slice(PREFIX.length);
		return { key, rel, dest: destFor(rel, overrides) };
	});

	console.info(`${plan.length} deployed file(s) under ${PREFIX} →`);
	plan.forEach((p) => console.info(`  ${p.rel}  ->  ${p.dest}`));

	if (dry) {
		console.info('\n--dry-run: nothing downloaded.');
		return;
	}

	let done = 0;
	for (const p of plan) {
		const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: p.key }));
		const body = Buffer.from(await obj.Body.transformToByteArray());
		await mkdir(dirname(p.dest), { recursive: true });
		await writeFile(p.dest, body);
		done++;
	}
	console.info(`\nDone. Pulled ${done} file(s) into ${TARGET}. Rebuild the game to bake them in.`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
