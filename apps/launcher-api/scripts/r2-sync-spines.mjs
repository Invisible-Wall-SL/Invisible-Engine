// Sync a local Spine-assets folder to R2: uploads every asset file and writes a
// skeletons.json index (the same data the Spine Viewer's scan produces), so the
// hosted viewer only has to serve files — no scanning at runtime.
//
//   node scripts/r2-sync-spines.mjs [spinesDir] [client] [project] [--dry-run]
//
// With the unified project repo the target is `<client>/<project>/spines/` —
// client/project are slug-normalized the SAME way as the launcher + Python tools
// (`[^a-z0-9] → _`, lowercased, 60 chars). Bundle subfolders nest under it.
//
// Defaults: spinesDir = HotFruits cluster spines, client = borut, project = hotfruits
//   → prefix = borut/hotfruits/spines
// Env for the real upload (NOT --dry-run):
//   R2_ENDPOINT          https://<accountid>.r2.cloudflarestorage.com   (account-level, no bucket)
//   R2_BUCKET            invisibleassets
//   R2_ACCESS_KEY_ID     <R2 API token Access Key ID>
//   R2_SECRET_ACCESS_KEY <R2 API token Secret>
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative, basename, extname, sep } from 'node:path';

const DEFAULT_DIR =
	'C:/Invisible Wall SL/Projects/iGaming/Borut/HotFruits/engine/apps/cluster/static/assets/spines';

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'default';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const SPINES_DIR = positional[0] ?? DEFAULT_DIR;
const CLIENT = positional[1] ?? process.env.IW_CLIENT ?? 'borut';
const PROJECT = positional[2] ?? process.env.IW_PROJECT ?? 'hotfruits';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}/spines`;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'ComfyUI']);
const ASSET_EXT = new Set(['.atlas', '.json', '.skel', '.png', '.webp', '.jpg', '.jpeg']);
const CONTENT_TYPE = {
	'.atlas': 'text/plain; charset=utf-8',
	'.json': 'application/json',
	'.skel': 'application/octet-stream',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};
const VER_RE = /(\d+)\.(\d+)\.(\d+)/;

const toPosix = (p) => p.split(sep).join('/');
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

async function walk(dir, out = []) {
	for (const ent of await readdir(dir, { withFileTypes: true })) {
		if (ent.isDirectory()) {
			if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
			await walk(join(dir, ent.name), out);
		} else {
			out.push(join(dir, ent.name));
		}
	}
	return out;
}

function isSkeletonJson(head) {
	return head.includes('"skeleton"') && head.includes('"bones"');
}

function detectVersion(file, headBytes) {
	const head = headBytes.toString('latin1');
	if (extname(file).toLowerCase() === '.json') {
		const m = head.match(/"spine"\s*:\s*"([^"]+)"/);
		if (m) return m[1];
	}
	const m = head.match(VER_RE);
	return m ? `${+m[1]}.${+m[2]}.${+m[3]}` : '';
}

function runtimeLine(version) {
	const m = (version || '').match(/(\d+)\.(\d+)/);
	const line = m ? `${m[1]}.${m[2]}` : '';
	return line === '4.1' || line === '4.2' ? line : '4.2';
}

function atlasPma(text) {
	return /^\s*pma\s*:\s*true\s*$/im.test(text.slice(0, 2000));
}

async function scan(root) {
	const files = await walk(root);
	const byDir = new Map();
	for (const f of files) {
		const d = f.slice(0, f.length - basename(f).length - 1);
		if (!byDir.has(d)) byDir.set(d, []);
		byDir.get(d).push(basename(f));
	}

	const entries = [];
	for (const [dir, names] of byDir) {
		const atlases = names.filter((n) => n.toLowerCase().endsWith('.atlas'));
		if (!atlases.length) continue;
		const skels = names.filter((n) => n.toLowerCase().endsWith('.skel'));
		const jsons = [];
		for (const n of names.filter((n) => n.toLowerCase().endsWith('.json'))) {
			const head = (await readFile(join(dir, n))).subarray(0, 512).toString('utf8');
			if (isSkeletonJson(head)) jsons.push(n);
		}
		for (const sk of [...skels, ...jsons]) {
			const stem = basename(sk, extname(sk));
			const atlas = atlases.find((a) => basename(a, extname(a)) === stem) ?? atlases[0];
			const headBytes = (await readFile(join(dir, sk))).subarray(0, 512);
			const version = detectVersion(sk, headBytes);
			const atlasText = await readFile(join(dir, atlas), 'utf8');
			const folder = toPosix(relative(root, dir));
			entries.push({
				name: `${folder}/${stem}`,
				folder,
				skeleton_file: sk,
				atlas_file: atlas,
				format: sk.toLowerCase().endsWith('.skel') ? 'skel' : 'json',
				version,
				runtime: runtimeLine(version),
				pma: atlasPma(atlasText),
				dir_b64: b64url(folder),
			});
		}
	}
	entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	entries.forEach((e, i) => (e.id = i));
	return entries;
}

async function main() {
	await stat(SPINES_DIR); // throws if missing
	console.info(`Scanning ${SPINES_DIR} …`);
	const skeletons = await scan(SPINES_DIR);
	const index = { prefix: PREFIX, skeletons };
	console.info(`Found ${skeletons.length} skeletons.`);
	skeletons.slice(0, 8).forEach((e) => console.info(`  · ${e.name}  [rt ${e.runtime}]`));
	if (skeletons.length > 8) console.info(`  … and ${skeletons.length - 8} more`);

	if (dryRun) {
		await writeFile('skeletons.dryrun.json', JSON.stringify(index, null, 2));
		console.info('\n--dry-run: wrote skeletons.dryrun.json (no upload).');
		return;
	}

	const endpoint = process.env.R2_ENDPOINT;
	const bucket = process.env.R2_BUCKET;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
		console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
		process.exit(1);
	}

	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
	const s3 = new S3Client({
		region: 'auto',
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
	});

	const files = (await walk(SPINES_DIR)).filter((f) => ASSET_EXT.has(extname(f).toLowerCase()));
	console.info(`\nUploading ${files.length} asset files to ${bucket}/${PREFIX} …`);
	let done = 0;
	for (const f of files) {
		const key = `${PREFIX}/${toPosix(relative(SPINES_DIR, f))}`;
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: await readFile(f),
				ContentType: CONTENT_TYPE[extname(f).toLowerCase()] ?? 'application/octet-stream',
			}),
		);
		if (++done % 10 === 0 || done === files.length) console.info(`  ${done}/${files.length}`);
	}

	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${PREFIX}/skeletons.json`,
			Body: JSON.stringify(index),
			ContentType: 'application/json',
		}),
	);
	console.info(`\nDone. Uploaded ${files.length} files + skeletons.json under ${PREFIX}/`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
