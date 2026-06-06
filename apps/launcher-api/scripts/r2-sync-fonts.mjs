// Sync a local game fonts folder to R2: uploads every font file and writes a
// fonts.json catalog (the `FontCatalog` the editor + engine consume), so the
// editor only has to serve files — no scanning at runtime. The font analogue of
// r2-sync-spines.mjs.
//
//   node scripts/r2-sync-fonts.mjs [fontsDir] [client] [project] [--dry-run]
//
// Target is `<client>/<project>/fonts/` in the unified project repo. Each
// subfolder with a BMFont descriptor (`.xml`/`.fnt`) becomes a `kind:'bitmap'`
// entry (name = the BMFont `<info face>`); web font files (`.woff2/.woff/.ttf/
// .otf`) become `kind:'web'` entries (name = the file stem). client/project are
// slug-normalized the SAME way as the launcher + Python tools.
//
// Defaults: fontsDir = the `lines` game fonts, client = borut, project = bookofborut.
// IMPORTANT: pass the project KEY (what the editor reads), NOT the display name —
// e.g. Book of Borut's key is `bookofborut` (r2Slug of itself), so `book_of_borut`
// would write to the WRONG prefix the editor never reads. Same gotcha as
// seed-game-editor.mjs.
// Env for the real upload (NOT --dry-run): R2_ENDPOINT / R2_BUCKET /
//   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (see r2-sync-spines.mjs).
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative, basename, extname, sep } from 'node:path';

const DEFAULT_DIR = 'C:/Invisible Wall SL/Engine/Invisible Engine/apps/lines/static/assets/fonts';

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) || 'default';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const FONTS_DIR = positional[0] ?? DEFAULT_DIR;
const CLIENT = positional[1] ?? process.env.IW_CLIENT ?? 'borut';
const PROJECT = positional[2] ?? process.env.IW_PROJECT ?? 'bookofborut';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}/fonts`;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__']);
const ASSET_EXT = new Set([
	'.xml',
	'.fnt',
	'.json',
	'.png',
	'.webp',
	'.jpg',
	'.jpeg',
	'.woff2',
	'.woff',
	'.ttf',
	'.otf',
]);
const CONTENT_TYPE = {
	'.xml': 'application/xml',
	'.fnt': 'text/plain; charset=utf-8',
	'.json': 'application/json',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
};
/** CSS `@font-face` format token per web-font extension. */
const WEB_FORMAT = {
	'.woff2': 'woff2',
	'.woff': 'woff',
	'.ttf': 'truetype',
	'.otf': 'opentype',
};

const toPosix = (p) => p.split(sep).join('/');

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

/** Pull the BMFont face name + page filenames from an `.xml`/`.fnt` descriptor. */
function parseBmfont(text) {
	const faceM = text.match(/face\s*=\s*"([^"]+)"/i) ?? text.match(/face\s*=\s*([^\s]+)/i);
	const face = faceM ? faceM[1].trim() : '';
	const pages = [];
	const pageRe = /<page[^>]*\bfile\s*=\s*"([^"]+)"|^\s*page\b[^\n]*\bfile\s*=\s*"?([^"\s]+)"?/gim;
	let m;
	while ((m = pageRe.exec(text)) !== null) {
		const file = (m[1] ?? m[2] ?? '').trim();
		if (file && !pages.includes(file)) pages.push(file);
	}
	return { face, pages };
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
		const folder = toPosix(relative(root, dir));
		if (!folder) continue; // descriptors live in subfolders, not the fonts root

		// Bitmap: a BMFont descriptor (.xml/.fnt) drives the entry.
		const descriptor = names.find((n) => /\.(xml|fnt)$/i.test(n));
		if (descriptor) {
			const text = await readFile(join(dir, descriptor), 'utf8');
			const { face, pages } = parseBmfont(text);
			const present = pages.filter((p) => names.includes(p));
			entries.push({
				id: folder,
				name: face || basename(folder),
				kind: 'bitmap',
				folder,
				descriptorFile: descriptor,
				descriptorFormat: /\.fnt$/i.test(descriptor) ? 'fnt' : 'xml',
				pageFiles: present.length ? present : names.filter((n) => /\.(png|webp|jpe?g)$/i.test(n)),
			});
			continue;
		}

		// Web: any downloadable font files in the folder.
		const webFiles = names.filter((n) => /\.(woff2?|ttf|otf)$/i.test(n));
		if (webFiles.length) {
			entries.push({
				id: folder,
				name: basename(folder),
				kind: 'web',
				folder,
				files: webFiles.map((file) => ({
					file,
					format: WEB_FORMAT[extname(file).toLowerCase()] ?? 'truetype',
				})),
			});
		}
	}
	entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	return entries;
}

async function main() {
	await stat(FONTS_DIR); // throws if missing
	console.info(`Scanning ${FONTS_DIR} …`);
	const fonts = await scan(FONTS_DIR);
	const catalog = { prefix: PREFIX, fonts };
	console.info(`Found ${fonts.length} fonts.`);
	fonts.forEach((e) => console.info(`  · ${e.name}  [${e.kind}]  ${e.folder}`));

	if (dryRun) {
		await writeFile('fonts.dryrun.json', JSON.stringify(catalog, null, 2));
		console.info('\n--dry-run: wrote fonts.dryrun.json (no upload).');
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

	const files = (await walk(FONTS_DIR)).filter((f) => ASSET_EXT.has(extname(f).toLowerCase()));
	console.info(`\nUploading ${files.length} font files to ${bucket}/${PREFIX} …`);
	let done = 0;
	for (const f of files) {
		const key = `${PREFIX}/${toPosix(relative(FONTS_DIR, f))}`;
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
			Key: `${PREFIX}/fonts.json`,
			Body: JSON.stringify(catalog),
			ContentType: 'application/json',
		}),
	);
	console.info(`\nDone. Uploaded ${files.length} files + fonts.json under ${PREFIX}/`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
