// Derive (or validate) a project's Atlas Maker manifest FROM the game's
// authoritative TexturePacker sheet, so the hand-authored manifest can never
// silently drift from what the game actually loads (a drifted manifest → blank
// symbols in-game).
//
//   node scripts/derive-atlas-manifest.mjs --client <c> --project <p> --name <sheet> \
//     [--sheet <path-to-game.json>] [--deploy-path <sub>] [--deploy-basename <base>] \
//     [--merge] [--dry-run] [--check-only]
//
// Source frames:
//   --sheet <path>  read the game's TexturePacker JSON from disk, OR
//   (default)       pull R2 `<client>/<project>/deploy/<deploy_path>/<name>.json`.
//
// Output: R2 `<client>/<project>/manifests/atlas_manifest_<name>.json`, an
// atlas-tool manifest {atlas, width, height, deploy_path, deploy_basename,
// regions, rotated_regions}.
//
//   --merge       upsert region GEOMETRY into an existing manifest, PRESERVE its
//                 creative fields (prompt/negative/advanced/…). Auto-on when the
//                 target manifest already exists in R2.
//   --dry-run     print the diff, write nothing.
//   --check-only  run the validator, exit non-zero on missing/mismatch, write nothing.
//
// Real R2 env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
import { readFile } from 'node:fs/promises';
import { framesToRegionBuckets, tpFrameEntries, tpFrameToRegion } from './lib/tpRegions.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const opt = (name, fallback = null) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const CLIENT = opt('client');
const PROJECT = opt('project');
const NAME = opt('name');
const SHEET_PATH = opt('sheet');
const DEPLOY_PATH_ARG = opt('deploy-path');
const DEPLOY_BASENAME_ARG = opt('deploy-basename');
const DRY_RUN = has('dry-run');
const CHECK_ONLY = has('check-only');
let MERGE = has('merge');

if (!CLIENT || !PROJECT || !NAME) {
	console.error('Required: --client <c> --project <p> --name <sheet>');
	process.exit(2);
}
if (!/^[A-Za-z0-9_-]+$/.test(NAME)) {
	console.error(`Invalid --name "${NAME}" (letters/digits/_/- only).`);
	process.exit(2);
}

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}`;
const manifestKey = `${PREFIX}/manifests/atlas_manifest_${NAME}.json`;

// Creative fields the merge MUST preserve on each region (everything that isn't
// derived geometry). Geometry keys are owned by the game sheet and overwritten.
const GEOMETRY_KEYS = new Set([
	'name',
	'x',
	'y',
	'w',
	'h',
	'rotated',
	'off_x',
	'off_y',
	'orig_w',
	'orig_h',
]);

function r2Creds() {
	const endpoint = process.env.R2_ENDPOINT;
	const bucket = process.env.R2_BUCKET;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
	return { bucket, endpoint, accessKeyId, secretAccessKey };
}

/**
 * Build an R2 client, or `null` when creds are absent. A LOCAL-sheet dry-run /
 * check-only needs no R2 (no existing-manifest read, no write), so it must not
 * hard-fail on missing creds. `requireR2()` enforces creds where a read/write is
 * unavoidable.
 */
async function r2Client() {
	const creds = r2Creds();
	if (!creds) return null;
	const { bucket, endpoint, accessKeyId, secretAccessKey } = creds;
	const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
	const s3 = new S3Client({
		region: 'auto',
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
	});
	const getText = async (Key) => {
		try {
			const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
			return await res.Body.transformToString();
		} catch (e) {
			if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey') return null;
			throw e;
		}
	};
	const putText = (Key, Body) =>
		s3.send(
			new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType: 'application/json' }),
		);
	return { bucket, getText, putText };
}

function requireR2(r2, why) {
	if (!r2) {
		console.error(`R2 required to ${why}, but R2_ENDPOINT/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY are unset.`);
		process.exit(2);
	}
	return r2;
}

/** Read the game's TexturePacker sheet from disk (--sheet) or R2 deploy/. */
async function loadGameSheet(r2, deployPath, basename) {
	if (SHEET_PATH) {
		const text = await readFile(SHEET_PATH, 'utf8');
		return { source: SHEET_PATH, json: JSON.parse(text) };
	}
	requireR2(r2, 'pull the game sheet from deploy/ (or pass --sheet)');
	const sub = deployPath ? `${deployPath}/` : '';
	const key = `${PREFIX}/deploy/${sub}${basename}.json`;
	const text = await r2.getText(key);
	if (!text) {
		console.error(`No game sheet at R2 ${key}. Deploy the atlas first or pass --sheet.`);
		process.exit(2);
	}
	return { source: `r2:${key}`, json: JSON.parse(text) };
}

/** Validator (mirror of src/lib/server/atlasManifestCheck.ts) over snake_case regions. */
function validate(manifest, frames) {
	const map = new Map();
	for (const bucket of [manifest.regions, manifest.rotated_regions]) {
		for (const r of bucket ?? []) if (r?.name) map.set(r.name, r);
	}
	const gameNames = new Set(Object.keys(frames));
	const missing = [];
	const extra = [];
	const geometryMismatch = [];
	const rotationMismatch = [];
	for (const [name, f] of Object.entries(frames)) {
		const region = map.get(name);
		if (!region) {
			missing.push(name);
			continue;
		}
		const g = tpFrameToRegion(name, f);
		if (Boolean(region.rotated) !== g.rotated) rotationMismatch.push(name);
		const pick = (...keys) => {
			for (const k of keys) if (typeof region[k] === 'number') return region[k];
			return undefined;
		};
		const compare = [
			['x', region.x ?? 0, g.x],
			['y', region.y ?? 0, g.y],
			['w', region.w ?? 0, g.w],
			['h', region.h ?? 0, g.h],
			['off_x', pick('off_x', 'offX') ?? 0, g.off_x],
			['off_y', pick('off_y', 'offY') ?? 0, g.off_y],
			['orig_w', pick('orig_w', 'origW') ?? g.w, g.orig_w],
			['orig_h', pick('orig_h', 'origH') ?? g.h, g.orig_h],
		];
		for (const [field, mv, gv] of compare) {
			if (mv !== gv) geometryMismatch.push({ name, field, manifest: mv, game: gv });
		}
	}
	for (const name of map.keys()) if (!gameNames.has(name)) extra.push(name);
	missing.sort();
	extra.sort();
	rotationMismatch.sort();
	const ok = !missing.length && !geometryMismatch.length && !rotationMismatch.length;
	return { missing, extra, geometryMismatch, rotationMismatch, ok };
}

/**
 * Merge derived geometry into an existing manifest, preserving creative fields.
 * Returns { manifest, added, removed, moved } for the report.
 */
function mergeManifest(existing, derivedRegions, meta) {
	const prev = new Map();
	for (const bucket of [existing.regions, existing.rotated_regions]) {
		for (const r of bucket ?? []) if (r?.name) prev.set(r.name, r);
	}
	const derivedNames = new Set(derivedRegions.map((r) => r.name));
	const added = [];
	const moved = [];
	const merged = [];
	for (const geom of derivedRegions) {
		const old = prev.get(geom.name);
		if (!old) {
			// New key the game added — empty prompt (default decision).
			added.push(geom.name);
			merged.push({ ...geom, prompt: '' });
			continue;
		}
		const wasRotated = Boolean(old.rotated);
		if (wasRotated !== geom.rotated) moved.push(geom.name);
		// Preserve every NON-geometry field from the old region; overwrite geometry.
		const preserved = {};
		for (const [k, v] of Object.entries(old)) {
			if (!GEOMETRY_KEYS.has(k)) preserved[k] = v;
		}
		merged.push({ ...preserved, ...geom });
	}
	const removed = [...prev.keys()].filter((n) => !derivedNames.has(n));
	const upright = merged.filter((r) => !r.rotated);
	const rotated = merged.filter((r) => r.rotated);
	const manifest = {
		...existing,
		atlas: { ...(existing.atlas ?? {}), ...meta.atlas },
		width: meta.width,
		height: meta.height,
		deploy_path: meta.deploy_path,
		deploy_basename: meta.deploy_basename,
		regions: upright,
		rotated_regions: rotated,
	};
	return { manifest, added, removed, moved };
}

function printDiff(report, mergeReport) {
	console.info('\nValidation vs game sheet:');
	console.info(`  ok: ${report.ok}`);
	if (report.missing.length) console.info(`  missing (game needs, manifest lacks): ${report.missing.join(', ')}`);
	if (report.extra.length) console.info(`  extra (manifest has, game dropped): ${report.extra.join(', ')}`);
	if (report.rotationMismatch.length)
		console.info(`  rotation mismatch: ${report.rotationMismatch.join(', ')}`);
	if (report.geometryMismatch.length) {
		console.info(`  geometry mismatch (${report.geometryMismatch.length}):`);
		for (const g of report.geometryMismatch.slice(0, 40)) {
			console.info(`    ${g.name}.${g.field}: manifest=${g.manifest} game=${g.game}`);
		}
		if (report.geometryMismatch.length > 40) console.info('    …');
	}
	if (mergeReport) {
		if (mergeReport.added.length) console.info(`  + added (empty prompt): ${mergeReport.added.join(', ')}`);
		if (mergeReport.removed.length)
			console.info(`  - removed (game dropped, KEPT — review): ${mergeReport.removed.join(', ')}`);
		if (mergeReport.moved.length)
			console.info(`  ↻ moved bucket (rotation changed): ${mergeReport.moved.join(', ')}`);
	}
}

async function main() {
	// --dry-run / --check-only that source from a local --sheet need no R2 reads,
	// but R2 is still required to read the existing manifest for merge + to write.
	const r2 = await r2Client();

	const deployPath = (DEPLOY_PATH_ARG ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	const basename = DEPLOY_BASENAME_ARG ?? NAME;

	const { source, json: gameJson } = await loadGameSheet(r2, deployPath, basename);
	const frames = gameJson.frames ?? {};
	const frameCount = tpFrameEntries(frames).length;
	const size = gameJson.meta?.size ?? {};
	const pageImage = gameJson.meta?.image ?? `${basename}.png`;
	console.info(`Game sheet: ${source}  (${frameCount} frames, ${size.w ?? 0}×${size.h ?? 0})`);

	// Existing target manifest? merge defaults on when it exists. Without R2 we
	// can't read it — a local-sheet dry-run/check then proceeds as a fresh derive.
	const existingText = r2 ? await r2.getText(manifestKey) : null;
	if (!r2 && (DRY_RUN || CHECK_ONLY)) {
		console.info('No R2 creds → existing manifest not read (fresh derive for this dry-run/check).');
	}
	const existing = existingText ? JSON.parse(existingText) : null;
	if (existing && !has('merge')) {
		MERGE = true;
		console.info('Target manifest exists → --merge auto-enabled (preserving creative fields).');
	}

	const { regions: upright, rotated_regions: rotated } = framesToRegionBuckets(frames);
	const derivedRegions = [...upright, ...rotated];

	// Effective deploy_path/_basename for the written manifest: explicit arg wins,
	// else carry over from the existing manifest, else default to a sprites mirror.
	const effDeployPath =
		DEPLOY_PATH_ARG ?? existing?.deploy_path ?? (SHEET_PATH ? '' : deployPath) ?? '';
	const effDeployBasename = DEPLOY_BASENAME_ARG ?? existing?.deploy_basename ?? basename;
	const pageKey = `${PREFIX}/manifests/${pageImage.replace(/\\/g, '/').split('/').pop()}`;
	const meta = {
		atlas: { source_image_path: pageKey, width: size.w ?? 0, height: size.h ?? 0 },
		width: size.w ?? 0,
		height: size.h ?? 0,
		deploy_path: effDeployPath,
		deploy_basename: effDeployBasename,
	};

	let manifest;
	let mergeReport = null;
	if (MERGE && existing) {
		const r = mergeManifest(existing, derivedRegions, meta);
		manifest = r.manifest;
		mergeReport = { added: r.added, removed: r.removed, moved: r.moved };
	} else {
		manifest = {
			...meta,
			regions: upright.map((r) => ({ ...r, prompt: '' })),
			rotated_regions: rotated.map((r) => ({ ...r, prompt: '' })),
		};
	}

	// Validate the manifest we'd write against the authoritative frames.
	const report = validate(manifest, frames);

	if (CHECK_ONLY) {
		printDiff(report, mergeReport);
		console.info(`\n--check-only: ${report.ok ? 'OK' : 'DRIFT DETECTED'}`);
		process.exit(report.ok ? 0 : 1);
	}

	if (DRY_RUN) {
		printDiff(report, mergeReport);
		console.info(`\n--dry-run: no write. Would write → ${manifestKey}`);
		console.info(
			`  ${manifest.regions.length} regions + ${manifest.rotated_regions.length} rotated_regions, ${manifest.width}×${manifest.height}`,
		);
		const preview = JSON.stringify(manifest, null, 2);
		console.info(`\nMANIFEST preview:\n${preview.slice(0, 1200)}${preview.length > 1200 ? '\n…' : ''}`);
		return;
	}

	requireR2(r2, 'write the derived manifest');
	await r2.putText(manifestKey, JSON.stringify(manifest, null, 2));
	printDiff(report, mergeReport);
	console.info(`\n✅ Wrote ${manifestKey} (${MERGE && existing ? 'merged' : 'fresh'}).`);
	if (!report.ok) {
		console.info('⚠ Written manifest still differs from the game sheet — review the diff above.');
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(2);
});
