// Seed the engine's symbol EXPLOSION into the cross-project spine library at
// `_shared/spines/engine-explosion/`, so every project has something to bind in the
// Symbols State Machine's Explosion column before it has commissioned art of its own —
// the same reason `_shared/sheets/` carries `engine-symbols` / `engine-multiplier`.
//
//   node scripts/seed-shared-engine-explosion.mjs [--dry-run]
//
// WHY A SPINE, NOT A FLIPBOOK CLIP. The explosion IS a 13-frame frame-animation, but the
// Stake engine ships it as a Spine `sequence` attachment (`symbexpl_01`…`_13`, two slots,
// the second `additive`) rather than as an ordered clip. A Flipbook clip is ONE ordered
// frame list, so re-authoring it as a clip would drop the additive second layer — and
// clips have no shared library anyway (`clipDocKey` is per-project only). A shared spine
// bundle needs no new storage concept: `listProjectAssets` already lists `_shared/spines/`
// with a `shared` flag, `resolveBundlePrefix` already falls back to it, and
// `exportSpineBundle` already ships it.
//
// WHY IT MERGES. `_shared/spines/skeletons.json` also holds the engine BOOT MARK entry
// (`R_InvisibleEngine`), which nothing else can regenerate. `r2-sync-spines.mjs` rewrites a
// prefix's index wholesale, so pointing it at `_shared/` would delete that entry. This
// insert-or-replaces one entry keyed by `folder`, exactly like `sharedSpinePromote.ts`.
//
// Re-running is idempotent: same bytes, same entry.
//
// Env for the real upload (NOT --dry-run):
//   R2_ENDPOINT          https://<accountid>.r2.cloudflarestorage.com   (account-level, no bucket)
//   R2_BUCKET            invisibleassets
//   R2_ACCESS_KEY_ID     <R2 API token Access Key ID>
//   R2_SECRET_ACCESS_KEY <R2 API token Secret>
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The engine reference game's copy of the Stake bundle — byte-identical in every apps/* game. */
const SRC_DIR = join(HERE, '../../../apps/lines/static/assets/spines/symbols3');

const BUNDLE = 'engine-explosion';
const PREFIX = `_shared/spines/${BUNDLE}`;
const INDEX_KEY = '_shared/spines/skeletons.json';

// The source bundle's atlas + page are named for `symbols3` — the sheet that ALSO packs the
// wild's art — because upstream keeps both skeletons in one folder. Here the bundle holds only
// the explosion, so the files are renamed to match it (and the atlas' page line rewritten to
// follow). The page pixels are copied verbatim: repacking to drop the wild's regions would mean
// re-encoding art, which is the Sheet Maker's job, not a seeder's.
const SKELETON_FILE = 'explosion.json';
const ATLAS_FILE = 'explosion.atlas';
const PAGE_FILE = 'explosion.webp';

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const dryRun = process.argv.slice(2).includes('--dry-run');

/** Rewrite the atlas' page-name line (the first non-empty line) to the renamed page. */
function retargetAtlasPage(atlasText, pageFile) {
	const lines = atlasText.split(/\r?\n/);
	const i = lines.findIndex((l) => l.trim() !== '');
	if (i === -1) throw new Error('atlas is empty');
	lines[i] = pageFile;
	return lines.join('\n');
}

async function main() {
	const skeletonText = await readFile(join(SRC_DIR, SKELETON_FILE), 'utf8');
	const atlasText = retargetAtlasPage(
		await readFile(join(SRC_DIR, 'symbols3.atlas'), 'utf8'),
		PAGE_FILE,
	);
	const pageBytes = await readFile(join(SRC_DIR, 'symbols3.webp'));

	const skeleton = JSON.parse(skeletonText);
	const animations = Object.keys(skeleton.animations ?? {});
	if (!animations.includes('explosion')) {
		throw new Error(`source skeleton has no 'explosion' animation (found: ${animations})`);
	}

	// Built the same way `spineIndex.ts`'s scan builds one, so a hand-seeded bundle is
	// indistinguishable from a scanned or promoted one.
	const version = /"spine"\s*:\s*"([^"]+)"/.exec(skeletonText)?.[1] ?? '';
	const line = /(\d+)\.(\d+)/.exec(version);
	const entry = {
		name: `${BUNDLE}/explosion`,
		folder: BUNDLE,
		skeleton_file: SKELETON_FILE,
		atlas_file: ATLAS_FILE,
		format: 'json',
		version,
		runtime:
			line && ['4.1', '4.2'].includes(`${line[1]}.${line[2]}`) ? `${line[1]}.${line[2]}` : '4.2',
		pma: /^\s*pma\s*:\s*true\s*$/im.test(atlasText.slice(0, 2000)),
		dir_b64: b64url(BUNDLE),
	};

	console.info(`Source : ${SRC_DIR}`);
	console.info(`Target : ${PREFIX}/`);
	console.info(`Animations: ${animations.join(', ')}`);
	console.info(`Entry  : ${JSON.stringify(entry)}`);

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

	const put = async (key, body, contentType) => {
		await s3.send(
			new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
		);
		console.info(`  put ${key}`);
	};

	await put(`${PREFIX}/${SKELETON_FILE}`, skeletonText, 'application/json');
	await put(`${PREFIX}/${ATLAS_FILE}`, atlasText, 'text/plain; charset=utf-8');
	await put(`${PREFIX}/${PAGE_FILE}`, pageBytes, 'image/webp');

	// Insert-or-replace by `folder`, preserving every other entry (the boot mark especially).
	let skeletons = [];
	try {
		const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: INDEX_KEY }));
		const parsed = JSON.parse(await res.Body.transformToString());
		if (Array.isArray(parsed.skeletons)) skeletons = parsed.skeletons;
	} catch {
		// No index yet (or an unparseable one) — write a fresh one rather than refusing to seed.
	}
	const next = [...skeletons.filter((e) => e.folder !== BUNDLE), entry].sort((a, b) =>
		a.folder.localeCompare(b.folder),
	);
	await put(INDEX_KEY, JSON.stringify({ skeletons: next }, null, '\t'), 'application/json');

	console.info(`\nDone. ${BUNDLE} is bindable as a shared spine bundle (animation 'explosion').`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
