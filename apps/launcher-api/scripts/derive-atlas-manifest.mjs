// Derive (or validate) a project's Atlas Maker manifest FROM the game's
// authoritative TexturePacker sheet, so the hand-authored manifest can never
// silently drift from what the game actually loads (a drifted manifest → blank
// symbols in-game).
//
//   node scripts/derive-atlas-manifest.mjs --client <c> --project <p> --name <sheet> \
//     [--sheet <path-to-game.json>] [--deploy-path <sub>] [--deploy-basename <base>] \
//     [--merge] [--force-deploy-path] [--dry-run] [--check-only]
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
//
// ── Bulk mode (--all): build + publish a project asset-map, backfill manifests ──
//   node scripts/derive-atlas-manifest.mjs --all --client <c> --project <p> \
//     --game-root <path-to-game-repo> [--dry-run] [--force-deploy-path] \
//     [--manifests-dir <local-dir>]
//
// Scans the game's COMMITTED `static/assets/` tree (git-tracked files only — so
// stale uncommitted sheets never pollute the map) for deployable sheets:
//   - TexturePacker sprite sheets (`*.json` with frames+meta) → stem + its dir, and
//   - Spine pages (`*.atlas`) → the page-image basename + its dir,
// builds an asset-map `{ "<stem>": { deploy_path, deploy_basename } }`, publishes it
// to R2 `<client>/<project>/asset-map.json`, then backfills deploy_path/_basename on
// existing R2 manifests whose name matches a map stem. `--manifests-dir` lets the
// backfill read manifests from a local dir instead of R2 (offline dry-runs).
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, parse as parsePath, join, relative } from 'node:path';
import { framesToRegionBuckets, tpFrameEntries, tpFrameToRegion } from './lib/tpRegions.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const opt = (name, fallback = null) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const ALL = has('all');
const CLIENT = opt('client');
const PROJECT = opt('project');
const NAME = opt('name');
const SHEET_PATH = opt('sheet');
const GAME_ROOT = opt('game-root');
const MANIFESTS_DIR = opt('manifests-dir');
const DEPLOY_PATH_ARG = opt('deploy-path');
const DEPLOY_BASENAME_ARG = opt('deploy-basename');
const DRY_RUN = has('dry-run');
const CHECK_ONLY = has('check-only');
const FORCE_DEPLOY_PATH = has('force-deploy-path');
let MERGE = has('merge');

if (!CLIENT || !PROJECT) {
	console.error('Required: --client <c> --project <p>');
	process.exit(2);
}
if (ALL) {
	if (!GAME_ROOT) {
		console.error('--all requires --game-root <path-to-game-repo>.');
		process.exit(2);
	}
} else {
	if (!NAME) {
		console.error('Required (single-sheet mode): --name <sheet>');
		process.exit(2);
	}
	if (!/^[A-Za-z0-9_-]+$/.test(NAME)) {
		console.error(`Invalid --name "${NAME}" (letters/digits/_/- only).`);
		process.exit(2);
	}
}

/** A trimmed non-empty string, else undefined (empty/whitespace deploy_path = "unset"). */
const pickStr = (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);

/** Slug rule — byte-identical to `r2Slug` in the launcher + the Python tools. */
const r2Slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';
const PREFIX = `${r2Slug(CLIENT)}/${r2Slug(PROJECT)}`;
const manifestKey = NAME ? `${PREFIX}/manifests/atlas_manifest_${NAME}.json` : null;

/**
 * The directory of `filePath` RELATIVE to the committed `static/assets/` (or bare
 * `assets/`) anchor — i.e. the deploy_path the game loads that file from. The game
 * loads every sheet at a predictable path under `static/assets/`, so the file's dir
 * relative to that segment IS its deploy_path. Returns `null` when no anchor is
 * present (we do NOT guess a layout the game might not honour).
 *   …/static/assets/sprites/symbolsStatic/symbolsStatic.json → 'sprites/symbolsStatic'
 *   …/static/assets/symbolsStatic.json                       → ''
 * @param {string} filePath absolute or relative path under a game's asset tree
 * @returns {string | null} forward-slash deploy_path, or null when un-anchored
 */
function deployPathFromAssets(filePath) {
	const dir = dirname(filePath).split(/[\\/]/).join('/');
	const segs = dir.split('/').filter(Boolean);
	// Find the LAST `static/assets` pair, else the last bare `assets`, and take
	// everything below it as the deploy_path.
	let anchor = -1;
	for (let i = 0; i < segs.length - 1; i++) {
		if (segs[i] === 'static' && segs[i + 1] === 'assets') anchor = i + 1;
	}
	if (anchor === -1) {
		for (let i = 0; i < segs.length; i++) {
			if (segs[i] === 'assets') anchor = i;
		}
	}
	if (anchor === -1) return null;
	return segs.slice(anchor + 1).join('/');
}

/**
 * Auto-derive the game's deploy target from a `--sheet` path (single-sheet mode):
 * the sheet's dir relative to `static/assets/` is the deploy_path, the stem is the
 * basename. Returns `null` when un-anchored (caller warns + skips).
 * @param {string} sheetPath absolute or relative path to the game's TP JSON
 * @returns {{ deployPath: string, deployBasename: string } | null}
 */
function deriveDeployTarget(sheetPath) {
	const deployPath = deployPathFromAssets(sheetPath);
	if (deployPath === null) return null;
	return { deployPath, deployBasename: parsePath(sheetPath).name };
}

/** Does a parsed JSON look like a TexturePacker sprite sheet (frames + meta)? */
function isTexturePackerSheet(json) {
	if (!json || typeof json !== 'object') return false;
	const { frames, meta } = json;
	if (!meta || typeof meta !== 'object') return false;
	if (Array.isArray(frames)) return frames.length > 0;
	return !!frames && typeof frames === 'object' && Object.keys(frames).length > 0;
}

/** The page-image basename declared on a Spine `.atlas` (its first non-empty line). */
function spineAtlasPageBasename(atlasText) {
	for (const raw of atlasText.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length > 0) return parsePath(line).name;
	}
	return '';
}

/**
 * List `static/assets/` files RELATIVE to that dir, COMMITTED ones only (git-tracked)
 * so stale/uncommitted sheets never enter the asset-map. Falls back to a filesystem
 * walk when the game-root isn't a git repo (or git is unavailable).
 * @param {string} gameRoot path to the game repo
 * @param {string} assetsDir absolute path to `<gameRoot>/static/assets`
 * @returns {{ rels: string[], source: 'git' | 'fs' }}
 */
function listAssetFiles(gameRoot, assetsDir) {
	const relAssets = relative(gameRoot, assetsDir).split(/[\\/]/).join('/');
	try {
		const out = execFileSync('git', ['ls-files', '--', `${relAssets}/`], {
			cwd: gameRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const rels = out
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			// `git ls-files` yields paths relative to gameRoot; re-relativise to assetsDir.
			.filter((p) => p.startsWith(`${relAssets}/`))
			.map((p) => p.slice(relAssets.length + 1));
		if (rels.length) return { rels, source: 'git' };
	} catch {
		// not a git repo / git missing → fall through to fs walk
	}
	const rels = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) walk(abs);
			else rels.push(relative(assetsDir, abs).split(/[\\/]/).join('/'));
		}
	};
	walk(assetsDir);
	return { rels, source: 'fs' };
}

/**
 * Scan a game's committed `static/assets/` tree and build the project asset-map:
 * `{ "<stem>": { deploy_path, deploy_basename } }`. Indexes TexturePacker sheets
 * (`*.json` with frames+meta) and Spine pages (`*.atlas`). On duplicate stems keeps
 * the FIRST and warns. Returns `{ map, indexed, duplicates, source }`.
 * @param {string} gameRoot path to the game repo
 */
function buildAssetMap(gameRoot) {
	const assetsDir = join(gameRoot, 'static', 'assets');
	if (!existsSync(assetsDir)) {
		console.error(`No static/assets/ under --game-root "${gameRoot}" (looked at ${assetsDir}).`);
		process.exit(2);
	}
	const { rels, source } = listAssetFiles(gameRoot, assetsDir);
	const map = {};
	const indexed = [];
	const duplicates = [];
	const add = (stem, deployPath, kind, rel) => {
		if (Object.prototype.hasOwnProperty.call(map, stem)) {
			duplicates.push({ stem, kept: map[stem].deploy_path, dropped: deployPath, kind, rel });
			console.warn(
				`⚠ duplicate stem "${stem}" — keeping "${map[stem].deploy_path}", ignoring "${deployPath}" (${rel}).`,
			);
			return;
		}
		map[stem] = { deploy_path: deployPath, deploy_basename: stem };
		indexed.push({ stem, deploy_path: deployPath, kind, rel });
	};
	for (const rel of rels.slice().sort()) {
		const abs = join(assetsDir, rel);
		const deployPath = deployPathFromAssets(abs) ?? '';
		if (rel.toLowerCase().endsWith('.json')) {
			let json;
			try {
				json = JSON.parse(readFileSync(abs, 'utf8'));
			} catch {
				continue; // unreadable/non-JSON → not a sheet
			}
			if (!isTexturePackerSheet(json)) continue; // skip spine skeletons, fonts, audio…
			add(parsePath(rel).name, deployPath, 'tp', rel);
		} else if (rel.toLowerCase().endsWith('.atlas')) {
			let stem;
			try {
				stem = spineAtlasPageBasename(readFileSync(abs, 'utf8')) || parsePath(rel).name;
			} catch {
				stem = parsePath(rel).name;
			}
			add(stem, deployPath, 'spine', rel);
		}
	}
	return { map, indexed, duplicates, source };
}

/**
 * Backfill deploy_path/deploy_basename on the project's existing manifests from the
 * asset-map. Reads manifests from a local `--manifests-dir` when given, else from R2.
 * Returns a per-manifest plan; performs writes unless `dry`.
 * @param {object} r2 R2 client or null
 * @param {Record<string,{deploy_path:string,deploy_basename:string}>} map
 * @param {boolean} dry
 */
async function backfillManifests(r2, map, dry) {
	const plan = { matched: [], unmatched: [], skipped: [] };
	const entries = await listProjectManifests(r2);
	for (const { name, key, text } of entries) {
		let manifest;
		try {
			manifest = JSON.parse(text);
		} catch {
			plan.skipped.push({ name, reason: 'unparseable JSON' });
			continue;
		}
		// Match on the manifest's existing deploy_basename, else its name (the stem
		// the manifest is named for, e.g. atlas_manifest_symbolsStatic → symbolsStatic).
		const stem = pickStr(manifest.deploy_basename) ?? name;
		const hit = map[stem];
		if (!hit) {
			plan.unmatched.push({ name, key, stem });
			continue;
		}
		const hasPath = pickStr(manifest.deploy_path) !== undefined;
		if (hasPath && !FORCE_DEPLOY_PATH) {
			plan.skipped.push({ name, reason: `already deploy_path="${manifest.deploy_path}"` });
			continue;
		}
		const updated = {
			...manifest,
			deploy_path: hit.deploy_path,
			deploy_basename: hit.deploy_basename,
		};
		plan.matched.push({
			name,
			key,
			from: pickStr(manifest.deploy_path) ?? '',
			to: hit.deploy_path,
			basename: hit.deploy_basename,
		});
		if (!dry) {
			requireR2(r2, 'write backfilled manifests');
			await r2.putText(key, JSON.stringify(updated, null, 2));
		}
	}
	return plan;
}

/**
 * List the project's existing atlas manifests. From a local `--manifests-dir` when
 * given (offline-friendly), else from R2 under `<prefix>/manifests/`. Yields
 * `{ name, key, text }` where `name` is the manifest stem (atlas_manifest_<name>).
 * @param {object} r2 R2 client or null
 * @returns {Promise<{ name: string, key: string, text: string }[]>}
 */
async function listProjectManifests(r2) {
	const fromName = (file) => {
		const m = /^atlas_manifest_(.+)\.json$/.exec(file);
		return m ? m[1] : null;
	};
	if (MANIFESTS_DIR) {
		const out = [];
		for (const file of readdirSync(MANIFESTS_DIR)) {
			const name = fromName(file);
			if (!name) continue;
			out.push({
				name,
				key: `${PREFIX}/manifests/${file}`,
				text: readFileSync(join(MANIFESTS_DIR, file), 'utf8'),
			});
		}
		return out;
	}
	requireR2(r2, 'list the project manifests (or pass --manifests-dir)');
	const keys = await r2.listKeys(`${PREFIX}/manifests/`);
	const out = [];
	for (const key of keys) {
		const file = key.split('/').pop() ?? '';
		const name = fromName(file);
		if (!name) continue;
		const text = await r2.getText(key);
		if (text) out.push({ name, key, text });
	}
	return out;
}

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
	const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = await import(
		'@aws-sdk/client-s3'
	);
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
		s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType: 'application/json' }));
	const listKeys = async (Prefix) => {
		const keys = [];
		let ContinuationToken;
		do {
			const res = await s3.send(
				new ListObjectsV2Command({ Bucket: bucket, Prefix, ContinuationToken }),
			);
			for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
			ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
		} while (ContinuationToken);
		return keys;
	};
	return { bucket, getText, putText, listKeys };
}

function requireR2(r2, why) {
	if (!r2) {
		console.error(
			`R2 required to ${why}, but R2_ENDPOINT/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY are unset.`,
		);
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
	if (report.missing.length)
		console.info(`  missing (game needs, manifest lacks): ${report.missing.join(', ')}`);
	if (report.extra.length)
		console.info(`  extra (manifest has, game dropped): ${report.extra.join(', ')}`);
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
		if (mergeReport.added.length)
			console.info(`  + added (empty prompt): ${mergeReport.added.join(', ')}`);
		if (mergeReport.removed.length)
			console.info(`  - removed (game dropped, KEPT — review): ${mergeReport.removed.join(', ')}`);
		if (mergeReport.moved.length)
			console.info(`  ↻ moved bucket (rotation changed): ${mergeReport.moved.join(', ')}`);
	}
}

/** Bulk mode: scan committed assets → asset-map → publish → backfill manifests. */
async function mainAll() {
	const r2 = await r2Client();
	const assetMapKey = `${PREFIX}/asset-map.json`;

	const { map, indexed, duplicates, source } = buildAssetMap(GAME_ROOT);
	const stems = Object.keys(map);
	console.info(
		`Scanned ${GAME_ROOT}/static/assets/ (${source}-tracked) → ${stems.length} deployable ` +
			`assets indexed${duplicates.length ? `, ${duplicates.length} duplicate stem(s) dropped` : ''}.`,
	);
	const tp = indexed.filter((e) => e.kind === 'tp').length;
	const spine = indexed.filter((e) => e.kind === 'spine').length;
	console.info(`  ${tp} TexturePacker sheet(s), ${spine} Spine page(s).`);

	// Publish the asset-map (skip on dry-run).
	if (DRY_RUN) {
		console.info(`\n--dry-run: would publish asset-map → R2 ${assetMapKey}`);
		console.info(`asset-map.json:\n${JSON.stringify(map, null, 2)}`);
	} else {
		requireR2(r2, 'publish the asset-map');
		await r2.putText(assetMapKey, JSON.stringify(map, null, 2));
		console.info(`\n✅ Published asset-map → R2 ${assetMapKey} (${stems.length} entries).`);
	}

	// Backfill the project's existing manifests from the map.
	const haveManifestSource = !!MANIFESTS_DIR || !!r2;
	if (!haveManifestSource && DRY_RUN) {
		console.info(
			'\nBackfill SKIPPED: no R2 creds and no --manifests-dir → cannot list existing ' +
				'manifests. (Scan + map above are live; backfill needs R2 or a local --manifests-dir.)',
		);
		return;
	}
	const plan = await backfillManifests(r2, map, DRY_RUN);

	console.info('\nBackfill plan:');
	console.info(
		`  ${plan.matched.length} matched/backfilled, ${plan.unmatched.length} unmatched, ${plan.skipped.length} skipped.`,
	);
	for (const m of plan.matched) {
		console.info(
			`  ✓ ${m.name}: deploy_path "${m.from || '(empty)'}" → "${m.to}" (basename ${m.basename})` +
				`${DRY_RUN ? ' — would set' : ' — set'}`,
		);
	}
	for (const s of plan.skipped) console.info(`  · ${s.name}: skipped (${s.reason})`);
	if (plan.unmatched.length) {
		console.info(
			`  ⚠ unmatched (no asset for stem — set deploy_path manually): ${plan.unmatched
				.map((u) => `${u.name} (stem "${u.stem}")`)
				.join(', ')}`,
		);
	}
	console.info(
		`\nSummary: ${stems.length} assets indexed · ${plan.matched.length} manifests ${DRY_RUN ? 'would be ' : ''}` +
			`backfilled · ${plan.unmatched.length} unmatched.`,
	);
}

async function main() {
	if (ALL) return mainAll();
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

	// Auto-derive the deploy target FROM the game's committed asset layout when the
	// source is a `--sheet` on disk (the only place the game path is known). When the
	// source is the R2 deploy/ fallback the game path is unknown, so leave it as-is.
	const autoTarget = SHEET_PATH ? deriveDeployTarget(SHEET_PATH) : null;
	if (SHEET_PATH && !autoTarget) {
		console.warn(
			`⚠ --sheet "${SHEET_PATH}" has no static/assets/ (or assets/) segment — ` +
				'cannot auto-derive deploy_path; leaving it as-is. Pass --deploy-path to set it.',
		);
	}

	// Effective deploy_path/_basename for the written manifest, in precedence order:
	//   1. explicit --deploy-path / --deploy-basename arg (manual override, always wins)
	//   2. the value carried on the existing manifest (preserved on --merge)…
	//   3. …unless empty/absent (or --force-deploy-path) — then the auto-derived value
	//   4. else the deployPath used to fetch the R2 fallback, or the sheet name.
	const existingDeployPath = pickStr(existing?.deploy_path);
	const existingDeployBasename = pickStr(existing?.deploy_basename);
	const shouldFillFromAuto =
		!!autoTarget && (FORCE_DEPLOY_PATH || existingDeployPath === undefined);

	let effDeployPath;
	if (DEPLOY_PATH_ARG !== null) effDeployPath = DEPLOY_PATH_ARG;
	else if (shouldFillFromAuto) effDeployPath = autoTarget.deployPath;
	else effDeployPath = existingDeployPath ?? (SHEET_PATH ? '' : deployPath) ?? '';

	let effDeployBasename;
	if (DEPLOY_BASENAME_ARG !== null) effDeployBasename = DEPLOY_BASENAME_ARG;
	else if (shouldFillFromAuto) effDeployBasename = autoTarget.deployBasename;
	else effDeployBasename = existingDeployBasename ?? basename;

	if (autoTarget) {
		const reason =
			DEPLOY_PATH_ARG !== null
				? '(overridden by --deploy-path)'
				: shouldFillFromAuto
					? existingDeployPath === undefined
						? '(was empty → filled)'
						: '(--force-deploy-path → overwritten)'
					: `(kept existing "${existingDeployPath}"; pass --force-deploy-path to overwrite)`;
		console.info(
			`Deploy target from game layout: deploy_path="${autoTarget.deployPath}" ` +
				`deploy_basename="${autoTarget.deployBasename}" → using deploy_path="${effDeployPath}" ${reason}`,
		);
	}
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

	// Deploy-target warning (mirrors atlasManifestCheck.ts): an empty deploy_path
	// means Deploy dumps the sheet to the deploy/ root and the game can't find it.
	if (!pickStr(manifest.deploy_path)) {
		console.warn(
			'⚠ deploy_path is empty: Deploy will write the sheet to the deploy/ root, but the ' +
				'game loads each sheet from static/assets/<deploy_path>/ and will not find it. ' +
				'Pass --sheet (auto-derives) or --deploy-path.',
		);
	}

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
		console.info(
			`\nMANIFEST preview:\n${preview.slice(0, 1200)}${preview.length > 1200 ? '\n…' : ''}`,
		);
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
