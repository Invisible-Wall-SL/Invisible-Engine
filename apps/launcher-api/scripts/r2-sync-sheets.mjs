// Sync a local sprite-sheet folder to R2 so the Invisible Editor + the Symbols
// State Machine tool can LIST and PREVIEW its frames. The sibling of
// `r2-sync-spines.mjs`, for sprite sheets instead of spine bundles.
//
//   node scripts/r2-sync-sheets.mjs [spritesDir] [client] [project] [--dry-run]
//
// Each immediate subfolder of `spritesDir` that holds a TexturePacker manifest
// (a `.json` with `frames` + `meta`) is uploaded — its `.json` + page image(s) —
// to `<client>/<project>/sheets/<folder>/`. The tool's `listProjectAssets` then
// lists it (`listSheets` scans the `sheets/` prefix), and `loadRegionSet` reads
// the TexturePacker JSON directly (no conversion) + resolves the page next to it.
// So a game's own committed sheet (e.g. Book of Borut's `symbolsStatic`, whose
// frames are `h1.png … w.png`) becomes previewable without re-authoring it.
//
// client/project are slug-normalized the SAME way as the launcher + Python tools
// (`[^a-z0-9] → _`, lowercased, 60 chars), so the prefix matches what the tool reads.
//
// Defaults: spritesDir = Book of Borut sprites, client = borut, project = bookofborut
//   → prefix = borut/bookofborut/sheets
// Env for the real upload (NOT --dry-run):
//   R2_ENDPOINT          https://<accountid>.r2.cloudflarestorage.com   (account-level, no bucket)
//   R2_BUCKET            invisibleassets
//   R2_ACCESS_KEY_ID     <R2 API token Access Key ID>
//   R2_SECRET_ACCESS_KEY <R2 API token Secret>
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';

const DEFAULT_DIR = 'C:/Invisible Wall SL/Projects/borut/bookofborut/static/assets/sprites';

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'default';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const SPRITES_DIR = positional[0] ?? DEFAULT_DIR;
const CLIENT = positional[1] ?? process.env.IW_CLIENT ?? 'borut';
const PROJECT = positional[2] ?? process.env.IW_PROJECT ?? 'bookofborut';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}/sheets`;

const ASSET_EXT = new Set(['.json', '.png', '.webp', '.jpg', '.jpeg']);
const IMAGE_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const CONTENT_TYPE = {
	'.json': 'application/json',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

const toPosix = (p) => p.split(sep).join('/');

/** Is this JSON a TexturePacker sheet (json-hash or json-array)? */
function isTexturePacker(text) {
	try {
		const j = JSON.parse(text);
		return !!(j && j.frames && j.meta);
	} catch {
		return false;
	}
}

/**
 * One sheet per immediate subfolder of `SPRITES_DIR` that holds a TexturePacker
 * `.json`. Returns `{ folder, files[] }` — the manifest + every image beside it
 * (the page is resolved by basename, so siblings cover the `.png`/`.webp` pair).
 */
async function scanSheets(root) {
	const out = [];
	for (const ent of await readdir(root, { withFileTypes: true })) {
		if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
		const dir = join(root, ent.name);
		const names = (await readdir(dir, { withFileTypes: true }))
			.filter((e) => e.isFile() && ASSET_EXT.has(extname(e.name).toLowerCase()))
			.map((e) => e.name);
		const manifests = [];
		for (const n of names.filter((n) => extname(n).toLowerCase() === '.json')) {
			if (isTexturePacker(await readFile(join(dir, n), 'utf8'))) manifests.push(n);
		}
		if (manifests.length === 0) continue; // not a sprite sheet → skip
		const files = names.filter(
			(n) => extname(n).toLowerCase() === '.json' || IMAGE_EXT.has(extname(n).toLowerCase()),
		);
		out.push({ folder: ent.name, dir, files });
	}
	return out;
}

async function main() {
	console.info(`Scanning ${SPRITES_DIR} …`);
	const sheets = await scanSheets(SPRITES_DIR);
	console.info(`Found ${sheets.length} sprite sheet(s):`);
	sheets.forEach((s) => console.info(`  · ${s.folder}  (${s.files.length} files)`));

	if (dryRun) {
		console.info(`\n--dry-run: would upload to ${PREFIX}/<folder>/ (no upload).`);
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
	const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

	let uploaded = 0;
	for (const sheet of sheets) {
		for (const file of sheet.files) {
			const key = `${PREFIX}/${toPosix(sheet.folder)}/${file}`;
			await s3.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: await readFile(join(sheet.dir, file)),
					ContentType: CONTENT_TYPE[extname(file).toLowerCase()] ?? 'application/octet-stream',
				}),
			);
			uploaded++;
		}
		console.info(`  uploaded ${sheet.folder} (${sheet.files.length} files)`);
	}
	console.info(`\nDone. Uploaded ${uploaded} files across ${sheets.length} sheet(s) under ${PREFIX}/`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
