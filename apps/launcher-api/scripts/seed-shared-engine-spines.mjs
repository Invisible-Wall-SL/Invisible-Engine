// Seed the engine's own Spine set into the cross-project library at `_shared/spines/`, so a
// project has animation to bind before it has commissioned any — the same reason
// `_shared/sheets/` carries `engine-symbols` / `engine-multiplier`.
//
//   node scripts/seed-shared-engine-spines.mjs [--dry-run] [--only <bundle>]
//
// ONE BUNDLE PER SKELETON, NOT PER FOLDER. Upstream packs several skeletons into one folder
// behind a shared atlas (`symbols/` holds h1…l4; `symbols3/` holds the wild AND the explosion).
// The launcher cannot address that: a spine cell/node stores a bundle PREFIX plus an animation
// name — there is no skeleton selector — and both `resolveEditorSpine` and `exportSpineBundle`
// take the FIRST `skeletons.json` entry for a folder. Seeding `symbols/` whole would therefore
// publish nine skeletons of which only `h1` could ever resolve, and binding `h3` would preview
// wrong and ship wrong. Splitting per skeleton is what makes every animation bindable.
//
// The cost is honest and worth stating: the split families re-copy their shared atlas page once
// per skeleton (`symbols.webp` × 9 ≈ 6.6MB of the ~13.5MB total). That is R2-side only. A GAME
// ships nothing it has not bound, and both export paths (`editorArtExport` and `symbolExport`)
// now dedup identical pages content-addressed into `_pages/`, so a project binding many engine
// symbol spines carries ONE page rather than one per symbol.
//
// WHY IT MERGES. `_shared/spines/skeletons.json` also holds the engine BOOT MARK entry
// (`R_InvisibleEngine`), which nothing else can regenerate. `r2-sync-spines.mjs` rewrites a
// prefix's index wholesale, so pointing it at `_shared/` would delete it. This
// insert-or-replaces by `folder`, exactly like `sharedSpinePromote.ts`.
//
// Re-running is idempotent: same bytes, same entries.
//
// Env for the real upload (NOT --dry-run):
//   R2_ENDPOINT          https://<accountid>.r2.cloudflarestorage.com   (account-level, no bucket)
//   R2_BUCKET            invisibleassets
//   R2_ACCESS_KEY_ID     <R2 API token Access Key ID>
//   R2_SECRET_ACCESS_KEY <R2 API token Secret>
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The engine reference game's copy of the Stake set — byte-identical in every apps/* game. */
const SRC_ROOT = join(HERE, '../../../apps/lines/static/assets/spines');
const INDEX_KEY = '_shared/spines/skeletons.json';

/**
 * `<source folder>/<skeleton file>` → shared bundle name. Written out rather than derived: this
 * is a CURATED library, and the skeleton stems upstream ships (`mm_bg`, `mm_bigwin`, `multiframe`)
 * name the sheet they were packed from, not the thing an author is looking for. `engine-` matches
 * the `_shared/sheets/` naming; the symbol skeletons take `engine-symbol-<id>` so they sort
 * together and read as the symbol they draw.
 *
 * `engine-explosion` keeps its name from the first seeding pass — it is already documented and
 * bound; renaming it would orphan any cell pointing at it.
 */
const BUNDLES = {
	'anticipation/anticipation.json': 'engine-anticipation',
	'bigwin/mm_bigwin.json': 'engine-bigwin',
	'bonusButton/buy_button.json': 'engine-buy-button',
	'clusterWin/clusterpay.json': 'engine-cluster-pay',
	'foregroundAnimation/mm_bg.json': 'engine-foreground',
	'foregroundFeatureAnimation/mm_bg_feature.json': 'engine-foreground-feature',
	'fsIntro/fs_screen.json': 'engine-fs-screen',
	'fsIntro/fs_screen_number.json': 'engine-fs-screen-number',
	'fsIntro/fs_total_number.json': 'engine-fs-total-number',
	'globalMultiplier/multiframe.json': 'engine-global-multiplier',
	'loader/loader.json': 'engine-loader',
	'reelhouse/reelhouse_glow.json': 'engine-reelhouse-glow',
	'symbols/h1.json': 'engine-symbol-h1',
	'symbols/h2.json': 'engine-symbol-h2',
	'symbols/h3.json': 'engine-symbol-h3',
	'symbols/h4.json': 'engine-symbol-h4',
	'symbols/h5.json': 'engine-symbol-h5',
	'symbols/l1.json': 'engine-symbol-l1',
	'symbols/l2.json': 'engine-symbol-l2',
	'symbols/l3.json': 'engine-symbol-l3',
	'symbols/l4.json': 'engine-symbol-l4',
	'symbols2/M.json': 'engine-symbol-m',
	'symbols2/S.json': 'engine-symbol-s',
	'symbols3/W.json': 'engine-symbol-w',
	'symbols3/explosion.json': 'engine-explosion',
	'transition/transition.json': 'engine-transition',
	'tumbleWin/tumble_win.json': 'engine-tumble-win',
	'tumbleWin/tumble_multiplier.json': 'engine-tumble-multiplier',
	'winMeterExplosion/ui_explosion.json': 'engine-win-meter-explosion',
};

const CONTENT_TYPE = {
	'.json': 'application/json',
	'.atlas': 'text/plain; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyAt = args.indexOf('--only');
const only = onlyAt === -1 ? undefined : args[onlyAt + 1];

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const stemOf = (file) => file.replace(/\.[^.]+$/, '');

/** The page filenames an atlas declares — the first non-empty line of each page block. Mirrors
 *  `atlasPageNames` in `src/lib/server/spine.ts`; a region name can carry an image extension, so
 *  pages are identified structurally by position, never by extension. */
function atlasPageNames(text) {
	const out = [];
	let expectPage = true;
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			continue;
		}
		if (/^\s/.test(line) || line.includes(':')) {
			expectPage = false;
			continue;
		}
		if (expectPage) {
			expectPage = false;
			out.push(line.trim());
		}
	}
	return out;
}

/**
 * Read one source skeleton + its folder's atlas + page, renamed onto the bundle's own stem so a
 * split bundle carries no trace of the folder it was packed with. The page PIXELS are copied
 * verbatim — repacking to drop the sibling skeletons' regions would mean re-encoding art, which
 * is the Sheet Maker's job, not a seeder's, and the extra regions are inert.
 */
async function readBundle(source, bundle) {
	const [folder, skeletonFile] = source.split('/');
	const dir = join(SRC_ROOT, folder);
	const skeletonText = await readFile(join(dir, skeletonFile), 'utf8');

	const srcAtlas = (await readdir(dir)).find((n) => n.toLowerCase().endsWith('.atlas'));
	if (!srcAtlas) throw new Error(`${folder}: no .atlas`);
	const srcAtlasText = await readFile(join(dir, srcAtlas), 'utf8');

	const pages = atlasPageNames(srcAtlasText);
	if (pages.length !== 1) throw new Error(`${folder}: expected 1 page, got ${pages.length}`);
	const pageExt = extname(pages[0]).toLowerCase();

	const stem = stemOf(skeletonFile);
	const pageOut = `${stem}${pageExt}`;
	const atlasText = srcAtlasText
		.split(/\r?\n/)
		.map((l) => (l.trim() === pages[0] ? pageOut : l))
		.join('\n');

	const version = /"spine"\s*:\s*"([^"]+)"/.exec(skeletonText)?.[1] ?? '';
	const line = /(\d+)\.(\d+)/.exec(version);
	const runtime =
		line && ['4.1', '4.2'].includes(`${line[1]}.${line[2]}`) ? `${line[1]}.${line[2]}` : '4.2';

	return {
		bundle,
		prefix: `_shared/spines/${bundle}`,
		animations: Object.keys(JSON.parse(skeletonText).animations ?? {}),
		files: [
			[`${stem}.json`, skeletonText],
			[`${stem}.atlas`, atlasText],
			[pageOut, await readFile(join(dir, pages[0]))],
		],
		// Built the same way `spineIndex.ts`'s scan builds one, so a hand-seeded bundle is
		// indistinguishable from a scanned or promoted one.
		entry: {
			name: `${bundle}/${stem}`,
			folder: bundle,
			skeleton_file: `${stem}.json`,
			atlas_file: `${stem}.atlas`,
			format: 'json',
			version,
			runtime,
			pma: /^\s*pma\s*:\s*true\s*$/im.test(atlasText.slice(0, 2000)),
			dir_b64: b64url(bundle),
		},
	};
}

async function main() {
	const wanted = Object.entries(BUNDLES).filter(([, b]) => !only || b === only);
	if (only && wanted.length === 0) throw new Error(`--only ${only}: no such bundle`);

	const built = [];
	for (const [source, bundle] of wanted) built.push(await readBundle(source, bundle));

	let bytes = 0;
	for (const b of built) {
		const size = b.files.reduce((n, [, body]) => n + Buffer.byteLength(body), 0);
		bytes += size;
		console.info(
			`${b.bundle.padEnd(28)} ${b.entry.skeleton_file.padEnd(22)} ` +
				`${(size / 1e6).toFixed(2).padStart(5)}MB  [${b.animations.join(', ')}]`,
		);
	}
	console.info(`\n${built.length} bundles, ${(bytes / 1e6).toFixed(1)}MB`);

	if (dryRun) {
		console.info('\n--dry-run: nothing uploaded.');
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

	const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
	const s3 = new S3Client({
		region: 'auto',
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
	});
	const put = (key, body, contentType) =>
		s3.send(
			new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
		);

	console.info('');
	for (const b of built) {
		for (const [name, body] of b.files) {
			await put(`${b.prefix}/${name}`, body, CONTENT_TYPE[extname(name).toLowerCase()]);
		}
		console.info(`  put ${b.prefix}/ (${b.files.length} files)`);
	}

	// Insert-or-replace by `folder`, preserving every other entry (the boot mark especially).
	let skeletons = [];
	try {
		const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: INDEX_KEY }));
		const parsed = JSON.parse(await res.Body.transformToString());
		if (Array.isArray(parsed.skeletons)) skeletons = parsed.skeletons;
	} catch {
		// No index yet (or an unparseable one) — write a fresh one rather than refusing to seed.
	}
	const seeded = new Set(built.map((b) => b.bundle));
	const next = [
		...skeletons.filter((e) => !seeded.has(e.folder)),
		...built.map((b) => b.entry),
	].sort((a, b) => a.folder.localeCompare(b.folder));
	await put(INDEX_KEY, JSON.stringify({ skeletons: next }, null, '\t'), 'application/json');
	console.info(`  put ${INDEX_KEY} (${next.length} entries)`);

	console.info(`\nDone. ${built.length} shared bundles seeded.`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
