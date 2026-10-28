// The build breakdown of a DESKTOP build (☁ Publish / 📦 Deliver from the Invisible Launcher): what
// the finished `build/` folder ships, by category and size; how often each file is referenced and
// each asset is used; what the build LEFT OUT on the way (not pulled, pruned, trimmed by 🗜 Optimize,
// re-encoded by the launcher); and the checks that say whether the right packages went out.
//
// Pure — no IO — so `check-build-breakdown.mjs` runs it offline. `scripts/build-breakdown.mjs`
// reads the build and the notes the build steps left (`apps/launcher-api/scripts/lib/
// buildReportDir.mjs`) and renders the result with {@link renderBreakdownHtml}.
//
// The online twin (a published snapshot, in the Studio launcher) is
// `apps/launcher-api/src/lib/server/buildBreakdown.ts`: same questions, different inputs — online
// has no code, no pull and no optimize pass, and a desktop build has no R2 snapshot.

import posix from 'node:path/posix';

export const BREAKDOWN_VERSION = 1;

/** Largest side a texture should have: most mobile GPUs refuse anything bigger. */
export const MAX_TEXTURE_SIDE = 4096;

export const CATEGORY_LABELS = {
	code: 'Code',
	art: 'Scene art',
	symbols: 'Symbols',
	pages: 'Atlas pages (shared)',
	coded: 'Coded game art',
	fonts: 'Fonts',
	sounds: 'Sounds',
	boot: 'Loading screen',
	data: 'Game data',
	other: 'Other',
};

const IMAGE_EXT = /\.(png|webp|jpe?g|avif|gif|svg)$/i;
const GPU_EXT = /\.(ktx2|basis|dds|ktx)$/i;
const AUDIO_EXT = /\.(mp3|ogg|m4a|aac|wav|webm|opus)$/i;
const FONT_EXT = /\.(woff2?|ttf|otf|fnt)$/i;
const CODE_EXT = /\.(m?js|css|html?|wasm|map)$/i;
/** Text files whose body names other files — what the build script reads. */
export const SCANNED_EXT = /\.(json|atlas|fnt|xml|txt|m?js|css|html?)$/i;
/** A token that looks like a path to a shippable file. */
const REF_TOKEN =
	/[A-Za-z0-9_\-./@%+]+\.(?:png|webp|jpe?g|avif|gif|svg|ktx2|basis|json|atlas|fnt|xml|mp3|ogg|m4a|aac|wav|webm|opus|woff2?|ttf|otf|m?js|css|wasm)\b/gi;
/** A maximal run of path characters: every REF_TOKEN match lies inside one. */
const PATH_RUN = /[A-Za-z0-9_\-./@%+]+/g;
/** No file path is this long; a longer run is a base64 data URI or a minified blob. */
const MAX_PATH_RUN = 1024;

/**
 * REF_TOKEN's tokens in `text`, matched one path-character run at a time. Matching it across a
 * whole bundle backtracks quadratically through a long base64 run (an inlined image or font):
 * a few MB of data URI held a desktop publish on "Writing the build breakdown…" for an hour.
 */
function* refTokens(text) {
	for (const run of text.matchAll(PATH_RUN)) {
		if (run[0].length > MAX_PATH_RUN) continue;
		for (const m of run[0].matchAll(REF_TOKEN)) yield m[0];
	}
}

/** Kinds that are dead weight when nothing loads them (code and indices are loaded by the shell). */
const ASSET_KINDS = new Set([
	'image',
	'gpu-texture',
	'spritesheet',
	'rig-skeleton',
	'rig-atlas',
	'font',
	'audio',
]);

/** Bundle subtrees that LIST assets rather than use them — excluded from the usage count. */
const INDEX_PATHS = ['editorArt', 'symbols.index', 'fonts.catalog.fonts', 'sounds.catalog.sounds'];

const TOP_LABELS = {
	componentVersions: 'pinned components',
	componentDefaults: 'component defaults',
	flowV2: 'flow',
	flowV2Library: 'flow library',
	rigFx: 'rig FX bindings',
	rigFlipbooks: 'rig flipbook bindings',
	shaderEffects: 'shader effects',
	winText: 'win text',
	config: 'game config',
};

export function formatBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Build-relative path, or null when `raw` points outside the build. */
function normalizeRel(raw, fromDir = '') {
	const clean = String(raw).split(/[?#]/)[0].replace(/\\/g, '/');
	if (!clean || /^[a-z]+:/i.test(clean)) return null;
	const joined = clean.startsWith('/') ? clean.slice(1) : posix.join(fromDir, clean);
	const norm = posix.normalize(joined);
	return norm.startsWith('..') || norm === '.' ? null : norm;
}

function walkStrings(value, visit, path = []) {
	if (typeof value === 'string') visit(value, path);
	else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, visit, [...path, i]));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) walkStrings(v, visit, [...path, k]);
	}
}

const isUnder = (path, dotted) => dotted.split('.').every((seg, i) => path[i] === seg);

function whereLabel(path, bundle) {
	const [top, a, b] = path;
	if (top === 'doc' && a === 'scenes' && typeof b === 'number') {
		const scene = bundle?.doc?.scenes?.[b];
		return `scene ${scene?.name || scene?.id || b}`;
	}
	if (top === 'componentDefs' && typeof a === 'string') return `component ${a}`;
	if (top === 'symbols' && a === 'map' && typeof b === 'string') return `symbol ${b}`;
	if (top === 'symbols' && typeof a === 'string') return `symbols ${a}`;
	if (top === 'sounds') return 'sound bindings';
	if (top === 'editorArt') return 'scene art index';
	if (top === 'fonts') return 'font catalog';
	return TOP_LABELS[String(top)] ?? String(top);
}

/** Pixel sizes a spritesheet JSON (`meta.size` + `meta.image`) or a rig `.atlas` states. */
function readDims(rel, text) {
	const out = new Map();
	const dir = posix.dirname(rel);
	if (/\.json$/i.test(rel)) {
		try {
			const meta = JSON.parse(text)?.meta;
			const size = meta?.size;
			if (
				typeof meta?.image === 'string' &&
				typeof size?.w === 'number' &&
				typeof size?.h === 'number'
			) {
				const img = normalizeRel(meta.image, dir);
				if (img) out.set(img, { w: size.w, h: size.h });
			}
		} catch {
			// Not a spritesheet.
		}
	} else if (/\.atlas$/i.test(rel)) {
		let page = null;
		for (const line of text.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				page = null;
				continue;
			}
			if (!trimmed.includes(':') && (IMAGE_EXT.test(trimmed) || GPU_EXT.test(trimmed))) {
				page = normalizeRel(trimmed, dir);
				continue;
			}
			const m = /^size\s*:\s*(\d+)\s*,\s*(\d+)/.exec(trimmed);
			if (m && page) out.set(page, { w: +m[1], h: +m[2] });
		}
	}
	return out;
}

/**
 * @param {object} input
 * @param {{ rel: string, bytes: number, hash?: string }[]} input.files  every file in the build
 * @param {Map<string, string>} input.texts  bodies of the scanned text files, by `rel`
 * @param {object | null} input.bundle  the baked editor bundle the build compiled in
 * @param {string} input.assetsPrefix  where `static/assets/` landed in the build (`assets/`)
 * @param {object | null} input.pull  `pull.json` from `pull-project-assets.mjs`
 * @param {object | null} input.images  `images.json` from the launcher's image pass
 * @param {object | null} input.buildInfo  the build's `build-info.json`
 * @param {object} [input.build]  what the launcher knows about this build (kind, debug, optimize…)
 */
export function analyzeDesktopBuild(input) {
	const { texts, bundle, assetsPrefix = 'assets/', pull, images, buildInfo } = input;
	const files = [...input.files].sort((a, b) => a.rel.localeCompare(b.rel));
	const fileSet = new Set(files.map((f) => f.rel));
	const bytesOf = new Map(files.map((f) => [f.rel, f.bytes]));
	const refCount = new Map();
	const referrers = new Map();
	const out = new Map();
	const broken = new Map();
	const roles = new Map();

	const add = (target, referrer, fromFile) => {
		refCount.set(target, (refCount.get(target) ?? 0) + 1);
		if (!referrers.has(target)) referrers.set(target, new Set());
		referrers.get(target).add(referrer);
		if (fromFile) {
			if (!out.has(fromFile)) out.set(fromFile, new Set());
			out.get(fromFile).add(target);
		}
	};
	const miss = (target, referrer) => {
		if (!broken.has(target)) broken.set(target, new Set());
		broken.get(target).add(referrer);
	};
	/** A bundle path is relative to `static/assets/`, i.e. to `assetsPrefix` in the build. */
	const asset = (rel) => {
		const norm = normalizeRel(rel);
		return norm ? `${assetsPrefix}${norm}` : null;
	};

	const categoryOf = (rel) => {
		if (!rel.startsWith(assetsPrefix)) {
			if (CODE_EXT.test(rel)) return 'code';
			// A file the code imports is emitted beside the chunks (`_app/immutable/assets/…`).
			if (IMAGE_EXT.test(rel) || AUDIO_EXT.test(rel) || FONT_EXT.test(rel)) return 'coded';
			return 'other';
		}
		const inner = rel.slice(assetsPrefix.length);
		const top = inner.split('/')[0];
		if (!inner.includes('/')) return 'other';
		switch (top) {
			case 'editor-art':
				return 'art';
			case 'editor-symbols':
				return 'symbols';
			case '_pages':
				return 'pages';
			case 'editor-fonts':
			case 'fonts':
				return 'fonts';
			case 'sounds':
			case 'audio':
				return 'sounds';
			case '_boot':
				return 'boot';
			case 'cinematics':
			case 'effects':
			case 'flipbooks':
			case 'editor-shaders':
				return 'data';
			default:
				return 'coded';
		}
	};
	const kindOf = (rel) => {
		if (roles.has(rel)) return roles.get(rel);
		const base = posix.basename(rel);
		if (base === 'index.json' || base === 'boot.json') return 'index';
		if (CODE_EXT.test(rel)) return 'code';
		if (GPU_EXT.test(rel)) return 'gpu-texture';
		if (IMAGE_EXT.test(rel)) return 'image';
		if (AUDIO_EXT.test(rel)) return 'audio';
		if (FONT_EXT.test(rel)) return 'font';
		if (/\.atlas$/i.test(rel)) return 'rig-atlas';
		return 'data';
	};

	// 1. The bundle's references — every string that names a shipped asset.
	if (bundle) {
		walkStrings(bundle, (s, path) => {
			const rel = asset(s);
			if (rel && fileSet.has(rel)) add(rel, `bundle › ${whereLabel(path, bundle)}`);
		});
	}

	// 2. Assets, from the bundle's indices. Their path fields MUST resolve.
	const assets = [];
	const ownFiles = new Map();
	const expect = (raw, referrer, role) => {
		if (!raw) return null;
		const rel = asset(raw);
		if (!rel) return null;
		if (role) roles.set(rel, role);
		if (!fileSet.has(rel)) miss(rel, referrer);
		return rel;
	};
	const addAsset = (type, key, name, paths, category) => {
		const id = `${type}:${key}`;
		if (ownFiles.has(id)) return;
		const own = paths.filter(Boolean);
		ownFiles.set(id, own);
		assets.push({
			id,
			name,
			type,
			key,
			category: category ?? (own[0] ? categoryOf(own[0]) : 'other'),
		});
	};
	const lastSegment = (key) =>
		String(key)
			.replace(/\/+$/, '')
			.split('/')
			.pop()
			.replace(/\.json$/i, '');

	for (const [label, index] of [
		['scene art index', bundle?.editorArt],
		['symbols index', bundle?.symbols?.index],
	]) {
		for (const s of index?.sheets ?? []) {
			addAsset('sheet', s.key, lastSegment(s.key), [
				expect(s.json, label, 'spritesheet'),
				expect(s.ktx2Json, label, 'spritesheet'),
			]);
		}
		for (const i of index?.images ?? []) {
			addAsset('image', i.key, lastSegment(i.key), [expect(i.file, label), expect(i.ktx2, label)]);
		}
		for (const r of index?.spines ?? []) {
			addAsset('rig', r.key, lastSegment(r.key), [
				expect(r.skeleton, label, 'rig-skeleton'),
				expect(r.atlas, label, 'rig-atlas'),
				expect(r.ktx2Atlas, label, 'rig-atlas'),
			]);
		}
	}
	const fontCatalog = bundle?.fonts?.catalog;
	for (const f of fontCatalog?.fonts ?? []) {
		const at = (file) => {
			const raw = [fontCatalog.prefix, f.folder, file].filter(Boolean).join('/');
			const rel = asset(raw);
			if (rel && fileSet.has(rel)) add(rel, 'bundle › font catalog');
			return expect(raw, 'font catalog', 'font');
		};
		addAsset(
			'font',
			f.id,
			f.name === f.id ? f.name : `${f.name} (${f.id})`,
			[
				f.descriptorFile ? at(f.descriptorFile) : null,
				...(f.pageFiles ?? []).map(at),
				...(f.files ?? []).map((w) => at(w.file)),
			],
			'fonts',
		);
	}
	const soundCatalog = bundle?.sounds?.catalog;
	for (const s of soundCatalog?.sounds ?? []) {
		const raw = [soundCatalog.prefix, s.file].filter(Boolean).join('/');
		const rel = asset(raw);
		if (rel && fileSet.has(rel)) add(rel, 'bundle › sound catalog');
		addAsset('sound', s.name, s.name, [expect(raw, 'sound catalog', 'audio')], 'sounds');
	}

	// 3. References between shipped files: spritesheet → page, atlas → page, code → chunk or asset.
	const dims = new Map();
	for (const [rel, text] of texts) {
		const dir = posix.dirname(rel);
		const code = CODE_EXT.test(rel);
		const seen = new Set();
		for (const token of refTokens(text)) {
			// Code names a file by a path from the site root, from `static/assets/`, or from itself.
			const candidates = code
				? [normalizeRel(token, dir), normalizeRel(token), asset(token)]
				: [normalizeRel(token, dir)];
			const target = candidates.find((c) => c && c !== rel && fileSet.has(c));
			if (!target || seen.has(target)) continue;
			seen.add(target);
			add(target, rel, rel);
		}
		for (const [page, size] of readDims(rel, text)) {
			if (!fileSet.has(page)) miss(page, rel);
			if (!dims.has(page)) dims.set(page, size);
		}
	}
	const boot = `${assetsPrefix}_boot/boot.json`;
	if (fileSet.has(boot)) {
		add(boot, 'game boot');
		addAsset('loading splash', boot, 'Loading splash', [boot], 'boot');
	}

	// 4. Usage — how many times the game data names each asset's key.
	const usage = new Map();
	if (bundle) {
		walkStrings(bundle, (s, path) => {
			if (s.length < 2 || s.length > 400) return;
			if (INDEX_PATHS.some((p) => isUnder(path, p))) return;
			if (!usage.has(s)) usage.set(s, new Map());
			const where = usage.get(s);
			const label = whereLabel(path, bundle);
			where.set(label, (where.get(label) ?? 0) + 1);
		});
	}
	const owners = new Map();
	for (const a of assets) {
		const closure = new Set();
		const stack = [...ownFiles.get(a.id)];
		while (stack.length) {
			const rel = stack.pop();
			if (closure.has(rel) || !fileSet.has(rel)) continue;
			closure.add(rel);
			for (const next of out.get(rel) ?? []) if (!CODE_EXT.test(next)) stack.push(next);
		}
		a.files = [...closure].sort();
		for (const rel of closure) owners.set(rel, (owners.get(rel) ?? 0) + 1);
	}
	for (const a of assets) {
		a.bytes = a.files.reduce((s, rel) => s + (bytesOf.get(rel) ?? 0), 0);
		a.sharedBytes = a.files
			.filter((rel) => (owners.get(rel) ?? 0) > 1)
			.reduce((s, rel) => s + (bytesOf.get(rel) ?? 0), 0);
		const names = new Set([a.key]);
		if (a.type === 'rig') names.add(lastSegment(a.key));
		if (a.type === 'font') {
			const entry = fontCatalog?.fonts?.find((f) => f.id === a.key);
			if (entry) names.add(entry.name);
		}
		const where = new Map();
		for (const name of names) {
			for (const [label, n] of usage.get(name) ?? []) where.set(label, (where.get(label) ?? 0) + n);
		}
		a.uses = [...where.values()].reduce((x, y) => x + y, 0);
		a.usedIn = [...where]
			.map(([w, count]) => ({ where: w, count }))
			.sort((x, y) => y.count - x.count || x.where.localeCompare(y.where));
	}
	assets.sort((x, y) => y.bytes - x.bytes || x.name.localeCompare(y.name));

	// 5. Per file.
	const firstWithHash = new Map();
	const rows = files.map((f) => {
		const row = {
			rel: f.rel,
			bytes: f.bytes,
			category: categoryOf(f.rel),
			kind: kindOf(f.rel),
			refs: refCount.get(f.rel) ?? 0,
			referrers: [...(referrers.get(f.rel) ?? [])].sort().slice(0, 12),
		};
		const d = dims.get(f.rel);
		if (d) row.dims = d;
		if (f.hash && f.bytes > 0) {
			const first = firstWithHash.get(f.hash);
			if (first) row.duplicateOf = first;
			else firstWithHash.set(f.hash, f.rel);
		}
		return row;
	});
	const sum = (list) => list.reduce((s, r) => s + (r.bytes ?? 0), 0);

	const categories = Object.keys(CATEGORY_LABELS)
		.map((id) => {
			const inCat = rows.filter((r) => r.category === id);
			return { id, label: CATEGORY_LABELS[id], files: inCat.length, bytes: sum(inCat) };
		})
		.filter((c) => c.files > 0)
		.sort((a, b) => b.bytes - a.bytes);

	const unreferenced = rows.filter((r) => r.refs === 0 && ASSET_KINDS.has(r.kind));
	const duplicates = rows.filter((r) => r.duplicateOf);
	const oversized = rows.filter(
		(r) => r.dims && (r.dims.w > MAX_TEXTURE_SIDE || r.dims.h > MAX_TEXTURE_SIDE),
	);
	const gpuBytes = rows
		.filter((r) => r.dims && r.kind === 'image')
		.reduce((s, r) => s + r.dims.w * r.dims.h * 4, 0);

	// 6. What the build left out on the way, step by step.
	const removed = [];
	const step = (id, label, detail, items) => {
		if (items?.length) removed.push({ id, label, detail, items, bytes: sum(items) });
	};
	step(
		'notPulled',
		'Not pulled from the project',
		'In the project’s deploy/ folder, but nothing in this game loads them, so the build never ' +
			'downloaded them. Delete them in the Invisible FTP Browser to tidy the project.',
		pull?.notPulled,
	);
	step(
		'pruned',
		'Removed from static/assets',
		'Local files from an earlier build or a renamed asset that nothing loads any more.',
		pull?.removed,
	);
	step(
		'imageTwins',
		'Image twins dropped (🗜 Optimize)',
		'The same image in two formats; the one the atlas does not name was deleted.',
		pull?.optimize?.imagesDeleted,
	);
	step(
		'audioFormats',
		'Extra audio formats dropped (🗜 Optimize)',
		`Only ${(pull?.optimize?.audioFormats ?? ['mp3']).join(', ')} kept; the manifests were rewritten to match.`,
		pull?.optimize?.audioDeleted,
	);
	step(
		'launcherTwins',
		'PNG twins dropped by the launcher (🗜 Optimize)',
		'A PNG beside the WebP page its atlas already names; removed right before upload.',
		images?.twinsDropped,
	);
	step(
		'launcherAudio',
		'Non-mp3 audio dropped by the launcher (🗜 Optimize)',
		'Removed from the finished build right before upload.',
		images?.audioDropped,
	);
	const reencoded = [
		...(images?.converted ?? []).map((c) => ({
			rel: c.to,
			from: c.from,
			before: c.before,
			after: c.after,
			bytes: c.before - c.after,
			how: 'PNG → near-lossless WebP',
		})),
		...(images?.recompressed ?? []).map((c) => ({
			rel: c.rel,
			before: c.before,
			after: c.after,
			bytes: c.before - c.after,
			how: 'PNG re-packed losslessly',
		})),
	].sort((a, b) => b.bytes - a.bytes);

	// 7. Checks.
	const issues = [];
	const issue = (level, title, detail, items) => {
		if (items?.length) issues.push({ level, title, detail, items });
	};
	issue(
		'error',
		'Referenced but not shipped',
		'The bundle or a shipped file points at these, but the build has no such file — the game ' +
			'requests them and gets a 404.',
		[...broken].map(([rel, from]) => `${rel} ← ${[...from].join(', ')}`),
	);
	const art = bundle?.editorArt;
	const symIndex = bundle?.symbols?.index;
	issue(
		'warn',
		'Placed art no sheet packs',
		'Regions the scenes or symbols place that no exported atlas contains: they render blank.',
		[...(art?.missing ?? []), ...(symIndex?.missing ?? [])].map(String),
	);
	issue(
		'warn',
		'Rigs that resolved to nothing',
		'Rig keys the game names whose bundle was not found: the rig is absent in-game.',
		[...(art?.spinesMissing ?? []), ...(symIndex?.spinesMissing ?? [])].map(String),
	);
	issue(
		'warn',
		'Flipbook frames missing',
		'Clip frames no shipped sheet packs: the animation plays short.',
		(art?.clipMissing ?? []).map((c) => `${c.clipId}: ${c.frames.join(', ')}`),
	);
	issue(
		'warn',
		'Shipped but never loaded',
		'Asset files nothing in the bundle, the code or another shipped file names. Players may ' +
			'never download them, but they make the build and every upload bigger.',
		unreferenced.map((r) => `${r.rel} (${formatBytes(r.bytes)})`),
	);
	issue(
		'warn',
		'Committed in the game but loaded by nothing',
		'The pull left these in static/assets because git tracks them, so they ship.',
		pull?.keptUnloaded,
	);
	issue(
		'warn',
		'Textures over 4096 px',
		`Pages larger than ${MAX_TEXTURE_SIDE}px on a side fail to load on many phones.`,
		oversized.map((r) => `${r.rel} — ${r.dims.w}×${r.dims.h}`),
	);
	if (input.build?.debug) {
		issue('warn', 'Debug tools included', 'This build ships the in-game Invisible Debug tooling.', [
			'🐞 Debug was ticked',
		]);
	}
	issue(
		'info',
		'Same bytes shipped twice',
		'Files whose content is identical to another shipped file.',
		duplicates.map((r) => `${r.rel} = ${r.duplicateOf} (${formatBytes(r.bytes)})`),
	);
	issue(
		'info',
		'Images no atlas names',
		'🗜 Optimize found no descriptor naming these; code may still load them by path.',
		pull?.optimize?.unreferenced,
	);
	issue(
		'info',
		'Assets the game data never names',
		'Shipped and indexed, but no scene, component, symbol or flow names their key. A coded path ' +
			'may still use them — check before removing.',
		assets
			.filter((a) => a.uses === 0 && a.type !== 'loading splash')
			.map((a) => `${a.type} ${a.name} (${formatBytes(a.bytes)})`),
	);
	if (!bundle) {
		issues.push({
			level: 'warn',
			title: 'No baked bundle found',
			detail:
				'The build left no bake.json, so asset uses and the index checks are missing from this ' +
				'report. Builds from an engine older than the breakdown look like this.',
			items: ['bake:doc did not report'],
		});
	}

	const byKind = (kind) => sum(rows.filter((r) => r.kind === kind));
	return {
		version: BREAKDOWN_VERSION,
		computedAt: (input.now ?? new Date()).toISOString(),
		build: {
			...(input.build ?? {}),
			...(buildInfo ?? {}),
			project: pull?.project ?? input.build?.project ?? null,
		},
		totals: {
			files: rows.length,
			bytes: sum(rows),
			codeBytes: byKind('code'),
			gpuBytes,
			assets: assets.length,
			unreferencedFiles: unreferenced.length,
			unreferencedBytes: sum(unreferenced),
			duplicateBytes: sum(duplicates),
			removedBytes: removed.reduce((s, r) => s + r.bytes, 0),
			reencodedBytes: reencoded.reduce((s, r) => s + r.bytes, 0),
		},
		categories,
		assets,
		files: rows,
		removed,
		reencoded,
		issues,
		content: contentSummary(bundle),
	};
}

function contentSummary(bundle) {
	if (!bundle) return [];
	const count = (v) =>
		Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
	const locales = Object.keys(bundle.localization?.messages ?? {});
	const source = bundle.localization?.messages?.[bundle.localization?.sourceLang];
	const rows = [
		['Scenes', String(count(bundle.doc?.scenes))],
		['Components', String(count(bundle.componentDefs))],
		['Symbols', String(count(bundle.symbols?.map))],
		['Fonts', String(count(bundle.fonts?.catalog?.fonts))],
		['Sounds', String(count(bundle.sounds?.catalog?.sounds))],
		['Languages', locales.length ? `${locales.length} (${locales.join(', ')})` : '0'],
		['Text strings', String(count(source))],
		['Flipbook clips', String(count(bundle.flipbooks))],
		['Effects', String(count(bundle.effects))],
		['Shader effects', String(count(bundle.shaderEffects))],
		['Cinematics', String(count(bundle.cinematics))],
		['Flow', bundle.flowV2 ? 'authored (v2)' : bundle.flow ? 'authored (v1)' : 'coded default'],
		['Game config', bundle.config ? 'authored' : 'template default'],
		['Win text', bundle.winText ? 'authored' : 'coded defaults'],
	];
	if (bundle.doc?.gameType) rows.unshift(['Game type', bundle.doc.gameType]);
	return rows.map(([label, value]) => ({ label, value }));
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────────────

/** One self-contained page — no network, opens from disk — that renders `breakdown`. */
export function renderBreakdownHtml(breakdown) {
	const data = JSON.stringify(breakdown).replace(/</g, '\\u003c');
	const b = breakdown.build ?? {};
	const title = `Build breakdown — ${b.project ?? 'game'}${b.version ? ` v${b.version}` : ''}`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main id="app"></main>
<script>window.__BREAKDOWN__ = ${data};</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

function escapeHtml(s) {
	return String(s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);
}

const CSS = `
:root { --bg:#0d0d11; --card:#14141b; --line:#23232e; --text:#e8e8ee; --muted:#9a9aa6; --dim:#7a7a86;
  --accent:#8ea2ff; --err:#f25f5c; --warn:#f4a259; --info:#6c8cff; --ok:#6be19a; }
@media (prefers-color-scheme: light) { :root { --bg:#f6f6f9; --card:#fff; --line:#e3e3ea; --text:#17171c;
  --muted:#5c5c68; --dim:#7a7a86; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width:1180px; margin:0 auto; padding:24px 16px 48px; display:flex; flex-direction:column; gap:18px; }
h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:0; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; min-width:0; }
.meta, .muted { color:var(--muted); font-size:13px; } .muted { margin:0 0 10px; }
code { font-size:12px; word-break:break-all; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; }
.tile { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.tile .k { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); }
.tile .v { font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; display:block; }
.tile .s { font-size:12px; color:var(--muted); }
.tile.warn { border-color:var(--warn); }
.head { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
.count { font-size:12px; color:var(--dim); }
.bar { display:flex; height:14px; border-radius:7px; overflow:hidden; gap:2px; margin-bottom:12px; background:var(--line); }
.bar span { min-width:2px; }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:8px; vertical-align:middle; }
.scroll { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim);
  padding:6px 8px; border-bottom:1px solid var(--line); white-space:nowrap; cursor:pointer; user-select:none; }
td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
tr.sel, tbody tr.click:hover { background:rgba(142,162,255,.08); } tr.click { cursor:pointer; }
tr.dim td { color:var(--muted); }
.where { color:var(--muted); font-size:12px; max-width:320px; }
.filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; align-items:center; }
input, select, button { background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 10px; font:inherit; font-size:13px; }
input[type=search] { flex:1; min-width:180px; } button { cursor:pointer; }
details { margin-bottom:8px; } summary { cursor:pointer; }
.issue { border:1px solid var(--line); border-left:3px solid var(--info); border-radius:8px; padding:10px 12px; }
.issue.error { border-left-color:var(--err); } .issue.warn { border-left-color:var(--warn); }
.issue summary { font-weight:600; }
.issue ul, .step ul { margin:6px 0 0; padding-left:18px; }
.tag { font-size:10px; color:var(--warn); margin-left:6px; }
.good { color:var(--ok); }
dl { display:grid; grid-template-columns:max-content 1fr; gap:6px 18px; margin:0; font-size:13px; }
dt { color:var(--muted); } dd { margin:0; }
`;

// The page's own script: plain DOM, no framework, so the report opens anywhere with no network.
const CLIENT_JS = `
(() => {
const b = window.__BREAKDOWN__;
const COLORS = { code:'#8d99ae', art:'#6c8cff', symbols:'#c77dff', pages:'#4cc9a7', coded:'#48bfe3', fonts:'#f4a259',
  sounds:'#f25f5c', boot:'#ffd166', data:'#b5838d', other:'#5c5c6a' };
const LABEL = Object.fromEntries(b.categories.map((c) => [c.id, c.label]));
const fmt = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const pct = (n) => b.totals.bytes ? ((n / b.totals.bytes) * 100).toFixed(1) + '%' : '—';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);
const dot = (id) => '<span class="dot" style="background:' + (COLORS[id] || '#5c5c6a') + '"></span>';
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString(); };
const state = { category: 'all', aq: '', at: 'all', as: 'bytes', fq: '', fk: 'all', fs: 'bytes', fu: false, flimit: 300 };
const app = document.getElementById('app');

function download(name, type, body) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
const cell = (v) => { const s = String(v ?? ''); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (head, rows) => [head.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\\n');
const base = (b.build.project || 'build') + (b.build.version ? '-v' + b.build.version : '');

function header() {
  const x = b.build; const bits = [];
  if (x.kind) bits.push(x.kind === 'delivery' ? '📦 Deliver' + (x.profile ? ' (' + esc(x.profile) + ')' : '') : '☁ Publish');
  if (x.builtAt) bits.push('built ' + esc(when(x.builtAt)));
  if (x.engineSha) bits.push('engine <code>' + esc(String(x.engineSha).slice(0, 10)) + '</code>');
  if (x.gameSha) bits.push('game <code>' + esc(String(x.gameSha).slice(0, 10)) + '</code>');
  if (x.launcherVersion) bits.push('launcher ' + esc(x.launcherVersion));
  bits.push('🗜 Optimize ' + (x.optimize ? 'on' : 'off'));
  bits.push('🐞 Debug ' + (x.debug ? '<b>on</b>' : 'off'));
  return '<section class="card"><h1>Build breakdown — ' + esc(x.project || 'game') + (x.version ? ' v' + esc(x.version) : '') +
    '</h1><div class="meta">' + bits.join(' · ') + '</div>' +
    '<div class="filters" style="margin:12px 0 0"><button data-dl="assets">Assets CSV</button><button data-dl="files">Files CSV</button>' +
    '<button data-dl="removed">Left-out CSV</button><button data-dl="json">JSON</button></div></section>';
}
function tiles() {
  const t = b.totals; const tile = (k, v, s, warn) => '<div class="tile' + (warn ? ' warn' : '') + '"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + s + '</span></div>';
  return '<section class="tiles">' + tile('Shipped', fmt(t.bytes), t.files + (t.files === 1 ? ' file' : ' files')) + tile('Code', fmt(t.codeBytes), 'JS, CSS, HTML') +
    tile('Assets', t.assets, 'sheets, rigs, fonts, sounds…') + tile('GPU memory (est.)', fmt(t.gpuBytes), 'uncompressed pages') +
    tile('Left out', fmt(t.removedBytes), 'not shipped, by the build') + tile('Re-encoded', fmt(t.reencodedBytes), 'saved by 🗜 Optimize images') +
    tile('Never loaded', fmt(t.unreferencedBytes), t.unreferencedFiles + (t.unreferencedFiles === 1 ? ' file' : ' files') + ' still shipped', t.unreferencedFiles > 0) + '</section>';
}
function categories() {
  let h = '<section class="card"><div class="head"><h2>By category</h2><span class="count">click a row to filter the lists</span></div><div class="bar">';
  for (const c of b.categories) h += '<span title="' + esc(c.label + ': ' + fmt(c.bytes)) + '" style="width:' + (b.totals.bytes ? c.bytes / b.totals.bytes * 100 : 0) + '%;background:' + COLORS[c.id] + '"></span>';
  h += '</div><table><thead><tr><th>Category</th><th class="n">Files</th><th class="n">Size</th><th class="n">Share</th></tr></thead><tbody>';
  h += '<tr class="click' + (state.category === 'all' ? ' sel' : '') + '" data-cat="all"><td>All</td><td class="n">' + b.totals.files + '</td><td class="n">' + fmt(b.totals.bytes) + '</td><td class="n">100%</td></tr>';
  for (const c of b.categories) h += '<tr class="click' + (state.category === c.id ? ' sel' : '') + '" data-cat="' + c.id + '"><td>' + dot(c.id) + esc(c.label) + '</td><td class="n">' + c.files + '</td><td class="n">' + fmt(c.bytes) + '</td><td class="n">' + pct(c.bytes) + '</td></tr>';
  return h + '</tbody></table></section>';
}
function list(items, max) {
  const show = items.slice(0, max); let h = '<ul>' + show.map((i) => '<li><code>' + esc(i) + '</code></li>').join('') + '</ul>';
  if (items.length > max) h += '<details><summary>' + (items.length - max) + ' more</summary><ul>' + items.slice(max).map((i) => '<li><code>' + esc(i) + '</code></li>').join('') + '</ul></details>';
  return h;
}
function checks() {
  const errs = b.issues.filter((i) => i.level === 'error').length, warns = b.issues.filter((i) => i.level === 'warn').length;
  let h = '<section class="card"><div class="head"><h2>Checks</h2><span class="count">' + (b.issues.length ? errs + ' errors · ' + warns + ' warnings' : 'nothing to report') + '</span></div>';
  if (!b.issues.length) h += '<p class="good">✓ Every referenced file shipped, nothing dead, no duplicates, no oversized pages.</p>';
  for (const i of b.issues) {
    h += '<details class="issue ' + i.level + '"' + (i.level === 'error' ? ' open' : '') + '><summary>' + (i.level === 'error' ? '✕ ' : i.level === 'warn' ? '⚠ ' : 'ℹ ') + esc(i.title) + ' <span class="count">(' + i.items.length + ')</span></summary><p class="muted" style="margin:6px 0 0">' + esc(i.detail) + '</p>' + list(i.items, 8) + '</details>';
  }
  return h + '</section>';
}
function removed() {
  let h = '<section class="card"><div class="head"><h2>What the build left out</h2><span class="count">' + fmt(b.totals.removedBytes) + ' not shipped · ' + fmt(b.totals.reencodedBytes) + ' saved by re-encoding</span></div>';
  if (!b.removed.length && !b.reencoded.length) h += '<p class="muted">Nothing was left out' + (b.build.optimize ? '.' : ' — 🗜 Optimize was off.') + '</p>';
  for (const s of b.removed) {
    h += '<details class="step"><summary><b>' + esc(s.label) + '</b> — ' + s.items.length + ' ' + (s.items.length === 1 ? 'file' : 'files') + ', ' + fmt(s.bytes) + '</summary><p class="muted" style="margin:6px 0">' + esc(s.detail) + '</p>' +
      '<div class="scroll"><table><tbody>' + s.items.slice().sort((x, y) => y.bytes - x.bytes).map((i) => '<tr><td><code>' + esc(i.rel) + '</code></td><td class="n">' + fmt(i.bytes) + '</td></tr>').join('') + '</tbody></table></div></details>';
  }
  if (b.reencoded.length) {
    h += '<details class="step"><summary><b>Images re-encoded (🗜 Optimize)</b> — ' + b.reencoded.length + ' ' + (b.reencoded.length === 1 ? 'file' : 'files') + ', ' + fmt(b.totals.reencodedBytes) + ' saved</summary>' +
      '<div class="scroll"><table><thead><tr><th>File</th><th>How</th><th class="n">Before</th><th class="n">After</th><th class="n">Saved</th></tr></thead><tbody>' +
      b.reencoded.map((r) => '<tr><td><code>' + esc(r.rel) + '</code></td><td>' + esc(r.how) + '</td><td class="n">' + fmt(r.before) + '</td><td class="n">' + fmt(r.after) + '</td><td class="n">' + fmt(r.bytes) + '</td></tr>').join('') + '</tbody></table></div></details>';
  }
  return h + '</section>';
}
function assetsCard() {
  const q = state.aq.toLowerCase();
  const rows = b.assets.filter((a) => (state.category === 'all' || a.category === state.category) && (state.at === 'all' || a.type === state.at) &&
    (!q || a.name.toLowerCase().includes(q) || a.key.toLowerCase().includes(q) || a.usedIn.some((u) => u.where.toLowerCase().includes(q))))
    .sort((x, y) => state.as === 'name' ? x.name.localeCompare(y.name) : state.as === 'uses' ? y.uses - x.uses || y.bytes - x.bytes : y.bytes - x.bytes);
  const types = [...new Set(b.assets.map((a) => a.type))].sort();
  let h = '<section class="card"><div class="head"><h2>Assets</h2><span class="count">' + rows.length + ' of ' + b.assets.length + (state.category !== 'all' ? ' · ' + esc(LABEL[state.category]) : '') + '</span></div>' +
    '<p class="muted">Each package the game loads, with every file it pulls in (atlas pages included). <b>Uses</b> is how many times the game data — scenes, components, symbols, flow, effects — names it.</p>' +
    '<div class="filters"><input type="search" data-k="aq" placeholder="Search name, key or where used…" value="' + esc(state.aq) + '">' +
    '<select data-k="at"><option value="all">All types</option>' + types.map((t) => '<option' + (state.at === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
    '<select data-k="as"><option value="bytes"' + (state.as === 'bytes' ? ' selected' : '') + '>Largest first</option><option value="uses"' + (state.as === 'uses' ? ' selected' : '') + '>Most used first</option><option value="name"' + (state.as === 'name' ? ' selected' : '') + '>Name</option></select></div>' +
    '<div class="scroll"><table><thead><tr><th>Name</th><th>Type</th><th>Category</th><th class="n">Files</th><th class="n">Size</th><th class="n">Uses</th><th>Used in</th></tr></thead><tbody>';
  for (const a of rows) {
    h += '<tr' + (a.uses === 0 ? ' class="dim"' : '') + '><td title="' + esc(a.key) + '"><details><summary>' + esc(a.name) + '</summary><ul>' + a.files.map((f) => '<li><code>' + esc(f) + '</code></li>').join('') + '</ul></details></td>' +
      '<td>' + esc(a.type) + '</td><td>' + dot(a.category) + esc(LABEL[a.category] || a.category) + '</td><td class="n">' + a.files.length + '</td>' +
      '<td class="n"' + (a.sharedBytes ? ' title="' + fmt(a.sharedBytes) + ' shared with other assets"' : '') + '>' + fmt(a.bytes) + (a.sharedBytes ? '<span class="tag">*</span>' : '') + '</td>' +
      '<td class="n">' + a.uses + '</td><td class="where" title="' + esc(a.usedIn.map((u) => u.where + ' ×' + u.count).join('\\n')) + '">' + esc(a.usedIn.slice(0, 3).map((u) => u.where + ' ×' + u.count).join(', ')) + (a.usedIn.length > 3 ? ' +' + (a.usedIn.length - 3) : '') + '</td></tr>';
  }
  if (!rows.length) h += '<tr><td colspan="7" class="muted">No assets match.</td></tr>';
  return h + '</tbody></table></div><p class="count">* part of the size is atlas pages shared with other assets.</p></section>';
}
function filesCard() {
  const q = state.fq.toLowerCase();
  const rows = b.files.filter((f) => (state.category === 'all' || f.category === state.category) && (state.fk === 'all' || f.kind === state.fk) && (!state.fu || f.refs === 0) && (!q || f.rel.toLowerCase().includes(q)))
    .sort((x, y) => state.fs === 'rel' ? x.rel.localeCompare(y.rel) : state.fs === 'refs' ? y.refs - x.refs || y.bytes - x.bytes : y.bytes - x.bytes);
  const kinds = [...new Set(b.files.map((f) => f.kind))].sort();
  const total = rows.reduce((s, f) => s + f.bytes, 0);
  let h = '<section class="card"><div class="head"><h2>Files</h2><span class="count">' + rows.length + ' of ' + b.files.length + ' · ' + fmt(total) + '</span></div>' +
    '<div class="filters"><input type="search" data-k="fq" placeholder="Search path…" value="' + esc(state.fq) + '">' +
    '<select data-k="fk"><option value="all">All kinds</option>' + kinds.map((k) => '<option' + (state.fk === k ? ' selected' : '') + '>' + esc(k) + '</option>').join('') + '</select>' +
    '<select data-k="fs"><option value="bytes"' + (state.fs === 'bytes' ? ' selected' : '') + '>Largest first</option><option value="refs"' + (state.fs === 'refs' ? ' selected' : '') + '>Most referenced first</option><option value="rel"' + (state.fs === 'rel' ? ' selected' : '') + '>Path</option></select>' +
    '<label class="count"><input type="checkbox" data-k="fu"' + (state.fu ? ' checked' : '') + '> Unreferenced only</label></div>' +
    '<div class="scroll"><table><thead><tr><th>Path</th><th>Kind</th><th class="n">Size</th><th class="n">Refs</th><th>Referenced by</th><th class="n">Pixels</th></tr></thead><tbody>';
  for (const f of rows.slice(0, state.flimit)) {
    h += '<tr' + (f.refs === 0 && f.kind !== 'code' ? ' class="dim"' : '') + '><td>' + dot(f.category) + '<code>' + esc(f.rel) + '</code>' + (f.duplicateOf ? '<span class="tag" title="same bytes as ' + esc(f.duplicateOf) + '">dup</span>' : '') + '</td>' +
      '<td>' + esc(f.kind) + '</td><td class="n">' + fmt(f.bytes) + '</td><td class="n">' + f.refs + '</td>' +
      '<td class="where" title="' + esc(f.referrers.join('\\n')) + '">' + esc(f.referrers.slice(0, 2).join(', ')) + (f.referrers.length > 2 ? ' +' + (f.referrers.length - 2) : '') + '</td>' +
      '<td class="n">' + (f.dims ? f.dims.w + '×' + f.dims.h : '') + '</td></tr>';
  }
  if (!rows.length) h += '<tr><td colspan="6" class="muted">No files match.</td></tr>';
  h += '</tbody></table></div>';
  if (rows.length > state.flimit) h += '<button data-more>Show all ' + rows.length + '</button>';
  return h + '</section>';
}
function content() {
  if (!b.content.length) return '';
  return '<section class="card"><div class="head"><h2>Game content</h2></div><dl>' + b.content.map((c) => '<dt>' + esc(c.label) + '</dt><dd>' + esc(c.value) + '</dd>').join('') + '</dl>' +
    '<p class="count" style="margin-top:10px">Report made ' + esc(when(b.computedAt)) + '.</p></section>';
}
function render() {
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  app.innerHTML = header() + tiles() + categories() + checks() + removed() + assetsCard() + filesCard() + content();
  if (focus) { const el = app.querySelector('[data-k="' + focus + '"]'); if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); } }
}
app.addEventListener('click', (e) => {
  const row = e.target.closest('[data-cat]'); if (row) { state.category = row.dataset.cat; render(); return; }
  if (e.target.closest('[data-more]')) { state.flimit = Infinity; render(); return; }
  const dl = e.target.closest('[data-dl]'); if (!dl) return;
  const kind = dl.dataset.dl;
  if (kind === 'json') download(base + '-breakdown.json', 'application/json', JSON.stringify(b, null, 2));
  if (kind === 'files') download(base + '-files.csv', 'text/csv', csv(['path','category','kind','bytes','refs','referrers','width','height','duplicate_of'], b.files.map((f) => [f.rel, LABEL[f.category], f.kind, f.bytes, f.refs, f.referrers.join(' | '), f.dims ? f.dims.w : '', f.dims ? f.dims.h : '', f.duplicateOf || ''])));
  if (kind === 'assets') download(base + '-assets.csv', 'text/csv', csv(['name','type','category','key','files','bytes','shared_bytes','uses','used_in'], b.assets.map((a) => [a.name, a.type, LABEL[a.category], a.key, a.files.length, a.bytes, a.sharedBytes, a.uses, a.usedIn.map((u) => u.where + ' x' + u.count).join(' | ')])));
  if (kind === 'removed') download(base + '-left-out.csv', 'text/csv', csv(['step','path','bytes'], [...b.removed.flatMap((s) => s.items.map((i) => [s.label, i.rel, i.bytes])), ...b.reencoded.map((r) => [r.how, r.rel, r.bytes])]));
});
app.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.k; if (!k) return;
  state[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (k[0] === 'f') state.flimit = 300; render();
});
render();
})();
`;
