/**
 * Build breakdown — what a published snapshot actually SHIPPED, for checking a publish after the
 * fact: every file in its frozen `deploy/` copy by category and size, how often each file is
 * referenced (by the runtime bundle and by the other shipped files), the logical assets those files
 * make up (a sheet, a rig, a font, a sound…) with how many times the game uses each, and the checks
 * that say whether the right packages went out — dead files, broken references, duplicate bytes,
 * oversized textures, the exporters' own dangling-binding warnings — plus what changed since the
 * previous version.
 *
 * Read-only over the snapshot (`publishedRuntime.ts`): it never touches `deploy/` or the pointer.
 * A snapshot is immutable by id, so the result is cached beside it as `breakdown.json` and computed
 * once; {@link BREAKDOWN_VERSION} invalidates the cache when this module's output changes.
 */
import posix from 'node:path/posix';
import type { RuntimeBundle } from './runtimeBundle';
import { mapWithConcurrency } from './concurrency';
import { SUB } from './projectPaths';
import { currentPointer, readSnapshotBundle, type SnapshotMeta } from './publishedRuntime';
import { getObjectText, listAllObjects, putObjectText } from './r2';

export const BREAKDOWN_VERSION = 1;

/** Largest side a texture should have: most mobile GPUs refuse anything bigger. */
export const MAX_TEXTURE_SIDE = 4096;

/** Text files scanned for references to other shipped files. Bigger ones are skipped. */
const MAX_SCANNED_TEXT_BYTES = 8 * 1024 * 1024;
const READ_CONCURRENCY = 8;

export type CategoryId =
	'art' | 'symbols' | 'pages' | 'fonts' | 'sounds' | 'boot' | 'data' | 'other';

export const CATEGORY_LABELS: Record<CategoryId, string> = {
	art: 'Scene art',
	symbols: 'Symbols',
	pages: 'Atlas pages (shared)',
	fonts: 'Fonts',
	sounds: 'Sounds',
	boot: 'Loading screen',
	data: 'Game data',
	other: 'Other',
};

export type FileKind =
	| 'image'
	| 'gpu-texture'
	| 'spritesheet'
	| 'rig-skeleton'
	| 'rig-atlas'
	| 'font'
	| 'audio'
	| 'index'
	| 'data'
	| 'other';

/** Kinds a player downloads as an ASSET — the ones that are dead weight when nothing loads them. */
const ASSET_KINDS = new Set<FileKind>([
	'image',
	'gpu-texture',
	'spritesheet',
	'rig-skeleton',
	'rig-atlas',
	'font',
	'audio',
	'other',
]);

export interface BreakdownFile {
	rel: string;
	bytes: number;
	category: CategoryId;
	kind: FileKind;
	/** How many references to this file the bundle and the other shipped files hold. */
	refs: number;
	/** Who references it (deduped, capped). */
	referrers: string[];
	/** Pixel size, when a spritesheet or rig atlas states it. */
	dims?: { w: number; h: number };
	/** Another shipped file with the same bytes (same ETag and size). */
	duplicateOf?: string;
}

export type AssetType = 'sheet' | 'image' | 'rig' | 'font' | 'sound' | 'loading splash';

export interface BreakdownAsset {
	id: string;
	name: string;
	type: AssetType;
	category: CategoryId;
	/** The lookup key the game uses (manifest key, rig bundle, font id, sound name). */
	key: string;
	/** Its own files plus every file they reference (atlas pages), shared pages included. */
	files: string[];
	bytes: number;
	/** Bytes of {@link files} other assets also use (shared atlas pages). */
	sharedBytes: number;
	/** How many times the game data names this asset (scene nodes, components, symbols, flow…). */
	uses: number;
	/** Where those uses are, most first. */
	usedIn: { where: string; count: number }[];
}

export interface BreakdownCategory {
	id: CategoryId;
	label: string;
	files: number;
	bytes: number;
}

export type IssueLevel = 'error' | 'warn' | 'info';

export interface BreakdownIssue {
	level: IssueLevel;
	title: string;
	detail: string;
	items: string[];
}

export interface BreakdownDiff {
	previousId: string;
	previousCreatedAt: string;
	added: { rel: string; bytes: number }[];
	removed: { rel: string; bytes: number }[];
	changed: { rel: string; before: number; after: number }[];
	bytesDelta: number;
}

export interface BuildBreakdown {
	version: typeof BREAKDOWN_VERSION;
	computedAt: string;
	snapshot: SnapshotMeta;
	totals: {
		files: number;
		bytes: number;
		/** `runtime.json`, which the player downloads before any asset. */
		bundleBytes: number;
		/** Uncompressed GPU memory of every PNG/WebP/JPEG page whose size is known. */
		gpuBytes: number;
		unreferencedFiles: number;
		unreferencedBytes: number;
		duplicateBytes: number;
	};
	categories: BreakdownCategory[];
	assets: BreakdownAsset[];
	files: BreakdownFile[];
	issues: BreakdownIssue[];
	/** Null when there is no older retained version to compare with. */
	diff: BreakdownDiff | null;
	content: { label: string; value: string }[];
}

export interface ListedFile {
	rel: string;
	bytes: number;
	etag?: string;
}

export interface BreakdownInput {
	meta: SnapshotMeta;
	bundle: RuntimeBundle;
	bundleBytes: number;
	files: ListedFile[];
	/** Bodies of the shipped text files (json/atlas/fnt/xml), keyed by `rel`. */
	texts: Map<string, string>;
	previous?: { meta: SnapshotMeta; files: ListedFile[] } | null;
	now?: Date;
}

// ── Classification ──────────────────────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|webp|jpe?g|avif|gif)$/i;
const GPU_EXT = /\.(ktx2|basis|dds|ktx)$/i;
const AUDIO_EXT = /\.(mp3|ogg|m4a|aac|wav|webm|opus)$/i;
const FONT_EXT = /\.(woff2?|ttf|otf|fnt)$/i;
const TEXT_EXT = /\.(json|atlas|fnt|xml|txt)$/i;
/** Extensions a referenced path can end in — what the text scan looks for. */
const REF_TOKEN =
	/[A-Za-z0-9_\-./@%+]+\.(?:png|webp|jpe?g|avif|gif|ktx2|basis|json|atlas|fnt|xml|mp3|ogg|m4a|aac|wav|webm|opus|woff2?|ttf|otf)\b/gi;

export function categoryOf(rel: string): CategoryId {
	const top = rel.split('/')[0];
	switch (top) {
		case 'editor-art':
			return 'art';
		case 'editor-symbols':
			return 'symbols';
		case '_pages':
			return 'pages';
		case 'editor-fonts':
			return 'fonts';
		case 'sounds':
			return 'sounds';
		case '_boot':
			return 'boot';
		case 'cinematics':
		case 'effects':
		case 'flipbooks':
		case 'editor-shaders':
		case 'flow.json':
		case 'flow-v2.json':
		case 'flow-v2-library.json':
			return 'data';
		default:
			return 'other';
	}
}

function kindOf(rel: string, roles: Map<string, FileKind>): FileKind {
	const role = roles.get(rel);
	if (role) return role;
	const base = posix.basename(rel);
	if (base === 'index.json' || base === 'boot.json') return 'index';
	if (GPU_EXT.test(rel)) return 'gpu-texture';
	if (IMAGE_EXT.test(rel)) return 'image';
	if (AUDIO_EXT.test(rel)) return 'audio';
	if (FONT_EXT.test(rel)) return 'font';
	if (/\.atlas$/i.test(rel)) return 'rig-atlas';
	if (categoryOf(rel) === 'data') return 'data';
	return 'other';
}

/** `deploy/`-relative path, or null when `raw` points outside the tree. */
function normalizeRel(raw: string, fromDir = ''): string | null {
	const clean = raw.split(/[?#]/)[0].replace(/\\/g, '/');
	if (!clean || /^[a-z]+:/i.test(clean)) return null;
	const joined = clean.startsWith('/') ? clean.slice(1) : posix.join(fromDir, clean);
	const norm = posix.normalize(joined);
	return norm.startsWith('..') || norm === '.' ? null : norm;
}

const joinRel = (...parts: (string | undefined)[]) =>
	normalizeRel(parts.filter((p): p is string => !!p).join('/'));

// ── Walking the bundle ──────────────────────────────────────────────────────────────────────────

/** Bundle subtrees that LIST assets rather than use them — excluded from the usage count. */
const INDEX_PATHS = ['editorArt', 'symbols.index', 'fonts.catalog.fonts', 'sounds.catalog.sounds'];

const TOP_LABELS: Record<string, string> = {
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

/** A human label for where in the bundle a value sits. */
function whereLabel(path: (string | number)[], bundle: RuntimeBundle): string {
	const [top, a, b] = path;
	if (top === 'doc' && a === 'scenes' && typeof b === 'number') {
		const scene = bundle.doc?.scenes?.[b];
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

function walkStrings(
	value: unknown,
	visit: (s: string, path: (string | number)[]) => void,
	path: (string | number)[] = [],
): void {
	if (typeof value === 'string') visit(value, path);
	else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, visit, [...path, i]));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) walkStrings(v, visit, [...path, k]);
	}
}

const isUnder = (path: (string | number)[], dotted: string) =>
	dotted.split('.').every((seg, i) => path[i] === seg);

// ── The analysis (pure) ─────────────────────────────────────────────────────────────────────────

class RefGraph {
	readonly count = new Map<string, number>();
	readonly from = new Map<string, Set<string>>();
	readonly out = new Map<string, Set<string>>();
	readonly broken = new Map<string, Set<string>>();

	add(target: string, referrer: string, fromFile?: string): void {
		this.count.set(target, (this.count.get(target) ?? 0) + 1);
		let set = this.from.get(target);
		if (!set) this.from.set(target, (set = new Set()));
		set.add(referrer);
		if (fromFile) {
			let o = this.out.get(fromFile);
			if (!o) this.out.set(fromFile, (o = new Set()));
			o.add(target);
		}
	}

	miss(target: string, referrer: string): void {
		let set = this.broken.get(target);
		if (!set) this.broken.set(target, (set = new Set()));
		set.add(referrer);
	}
}

/** Pixel sizes a spritesheet JSON (`meta.size` + `meta.image`) or a rig `.atlas` states. */
function readDims(rel: string, text: string, dims: Map<string, { w: number; h: number }>): void {
	const dir = posix.dirname(rel);
	if (/\.json$/i.test(rel)) {
		try {
			const meta = (JSON.parse(text) as { meta?: { image?: unknown; size?: unknown } }).meta;
			const size = meta?.size as { w?: unknown; h?: unknown } | undefined;
			if (
				typeof meta?.image === 'string' &&
				typeof size?.w === 'number' &&
				typeof size.h === 'number'
			) {
				const img = normalizeRel(meta.image, dir);
				if (img) dims.set(img, { w: size.w, h: size.h });
			}
		} catch {
			// Not JSON after all — nothing to read.
		}
		return;
	}
	if (/\.atlas$/i.test(rel)) {
		let page: string | null = null;
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
			if (m && page) dims.set(page, { w: +m[1], h: +m[2] });
		}
	}
}

export function analyzeBuild(input: BreakdownInput): BuildBreakdown {
	const { bundle, meta, texts } = input;
	const files = [...input.files].sort((a, b) => a.rel.localeCompare(b.rel));
	const fileSet = new Set(files.map((f) => f.rel));
	const bytesOf = new Map(files.map((f) => [f.rel, f.bytes]));
	const graph = new RefGraph();
	const roles = new Map<string, FileKind>();

	// 1. The bundle's own references: every string that names a shipped file.
	walkStrings(bundle, (s, path) => {
		const rel = normalizeRel(s);
		if (rel && fileSet.has(rel)) graph.add(rel, `runtime.json › ${whereLabel(path, bundle)}`);
	});

	// 2. The asset indices, whose path fields MUST resolve — a miss there is a broken package.
	const assets: BreakdownAsset[] = [];
	const ownFiles = new Map<string, string[]>();
	const expect = (rel: string | null | undefined, referrer: string, role?: FileKind) => {
		if (!rel) return null;
		const norm = normalizeRel(rel);
		if (!norm) return null;
		if (role) roles.set(norm, role);
		if (!fileSet.has(norm)) graph.miss(norm, referrer);
		return norm;
	};
	const addAsset = (
		type: AssetType,
		key: string,
		name: string,
		paths: (string | null)[],
		category?: CategoryId,
	) => {
		const own = paths.filter((p): p is string => !!p);
		const id = `${type}:${key}`;
		if (ownFiles.has(id)) return;
		ownFiles.set(id, own);
		assets.push({
			id,
			name,
			type,
			category: category ?? (own[0] ? categoryOf(own[0]) : 'other'),
			key,
			files: [],
			bytes: 0,
			sharedBytes: 0,
			uses: 0,
			usedIn: [],
		});
	};
	const lastSegment = (key: string) =>
		key
			.replace(/\/+$/, '')
			.split('/')
			.pop()!
			.replace(/\.json$/i, '');

	const indices = [
		{ label: 'scene art index', index: bundle.editorArt },
		{ label: 'symbols index', index: bundle.symbols?.index },
	];
	for (const { label, index } of indices) {
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

	const fontCatalog = bundle.fonts?.catalog;
	for (const f of fontCatalog?.fonts ?? []) {
		const at = (file: string) => {
			const rel = joinRel(fontCatalog.prefix, f.folder, file);
			if (rel) graph.add(rel, 'runtime.json › font catalog');
			return expect(rel, 'font catalog', 'font');
		};
		const paths = [
			f.descriptorFile ? at(f.descriptorFile) : null,
			...(f.pageFiles ?? []).map(at),
			...(f.files ?? []).map((w) => at(w.file)),
		];
		addAsset('font', f.id, f.name === f.id ? f.name : `${f.name} (${f.id})`, paths, 'fonts');
	}

	const soundCatalog = bundle.sounds?.catalog;
	for (const s of soundCatalog?.sounds ?? []) {
		const rel = joinRel(soundCatalog.prefix, s.file);
		if (rel) graph.add(rel, 'runtime.json › sound catalog');
		addAsset('sound', s.name, s.name, [expect(rel, 'sound catalog', 'audio')], 'sounds');
	}

	// 3. References between shipped files: spritesheet → page, atlas → page, font → page, …
	const dims = new Map<string, { w: number; h: number }>();
	for (const [rel, text] of texts) {
		const dir = posix.dirname(rel);
		const seen = new Set<string>();
		for (const m of text.matchAll(REF_TOKEN)) {
			const target = normalizeRel(m[0], dir);
			if (!target || target === rel || seen.has(target)) continue;
			seen.add(target);
			if (fileSet.has(target)) graph.add(target, rel, rel);
		}
		const pages = new Map<string, { w: number; h: number }>();
		readDims(rel, text, pages);
		for (const [page, size] of pages) {
			// The page a spritesheet or rig atlas names is one it NEEDS — a miss is a broken ship.
			if (!fileSet.has(page)) graph.miss(page, rel);
			if (!dims.has(page)) dims.set(page, size);
		}
	}

	// The loading splash is fetched by the game at boot, before the bundle.
	const bootIndex = '_boot/boot.json';
	if (fileSet.has(bootIndex)) {
		graph.add(bootIndex, 'game boot');
		addAsset('loading splash', bootIndex, 'Loading splash', [bootIndex], 'boot');
	}

	// 4. Usage: how many times the game data names each asset's key.
	const usage = new Map<string, Map<string, number>>();
	walkStrings(bundle, (s, path) => {
		if (s.length < 2 || s.length > 400) return;
		if (INDEX_PATHS.some((p) => isUnder(path, p))) return;
		let where = usage.get(s);
		if (!where) usage.set(s, (where = new Map()));
		const label = whereLabel(path, bundle);
		where.set(label, (where.get(label) ?? 0) + 1);
	});

	const fileOwners = new Map<string, number>();
	const closures = new Map<string, string[]>();
	for (const asset of assets) {
		const closure = new Set<string>();
		const stack = [...(ownFiles.get(asset.id) ?? [])];
		while (stack.length) {
			const rel = stack.pop()!;
			if (closure.has(rel) || !fileSet.has(rel)) continue;
			closure.add(rel);
			for (const next of graph.out.get(rel) ?? []) stack.push(next);
		}
		closures.set(asset.id, [...closure].sort());
		for (const rel of closure) fileOwners.set(rel, (fileOwners.get(rel) ?? 0) + 1);
	}

	for (const asset of assets) {
		asset.files = closures.get(asset.id) ?? [];
		asset.bytes = asset.files.reduce((sum, rel) => sum + (bytesOf.get(rel) ?? 0), 0);
		asset.sharedBytes = asset.files
			.filter((rel) => (fileOwners.get(rel) ?? 0) > 1)
			.reduce((sum, rel) => sum + (bytesOf.get(rel) ?? 0), 0);
		const names = new Set([asset.key]);
		if (asset.type === 'rig') names.add(lastSegment(asset.key));
		if (asset.type === 'font') {
			const entry = fontCatalog?.fonts.find((f) => f.id === asset.key);
			if (entry) names.add(entry.name);
		}
		const where = new Map<string, number>();
		for (const name of names) {
			for (const [label, n] of usage.get(name) ?? []) where.set(label, (where.get(label) ?? 0) + n);
		}
		asset.uses = [...where.values()].reduce((a, b) => a + b, 0);
		asset.usedIn = [...where]
			.map(([w, count]) => ({ where: w, count }))
			.sort((a, b) => b.count - a.count || a.where.localeCompare(b.where));
	}
	assets.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

	// 5. Per file.
	const byContent = new Map<string, string>();
	const rows: BreakdownFile[] = files.map((f) => {
		const row: BreakdownFile = {
			rel: f.rel,
			bytes: f.bytes,
			category: categoryOf(f.rel),
			kind: kindOf(f.rel, roles),
			refs: graph.count.get(f.rel) ?? 0,
			referrers: [...(graph.from.get(f.rel) ?? [])].sort().slice(0, 12),
		};
		const d = dims.get(f.rel);
		if (d) row.dims = d;
		if (f.etag && f.bytes > 0) {
			const sig = `${f.etag}:${f.bytes}`;
			const first = byContent.get(sig);
			if (first) row.duplicateOf = first;
			else byContent.set(sig, f.rel);
		}
		return row;
	});

	const categories = (Object.keys(CATEGORY_LABELS) as CategoryId[])
		.map((id) => {
			const inCat = rows.filter((r) => r.category === id);
			return {
				id,
				label: CATEGORY_LABELS[id],
				files: inCat.length,
				bytes: inCat.reduce((s, r) => s + r.bytes, 0),
			};
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
		.reduce((s, r) => s + r.dims!.w * r.dims!.h * 4, 0);
	const sum = (list: { bytes: number }[]) => list.reduce((s, r) => s + r.bytes, 0);

	// 6. Checks.
	const issues: BreakdownIssue[] = [];
	const issue = (level: IssueLevel, title: string, detail: string, items: string[]) => {
		if (items.length) issues.push({ level, title, detail, items });
	};
	issue(
		'error',
		'Referenced but not shipped',
		'The bundle or a shipped file points at these, but the snapshot has no such file — the game ' +
			'requests them and gets a 404.',
		[...graph.broken].map(([rel, from]) => `${rel} ← ${[...from].join(', ')}`),
	);
	const art = bundle.editorArt;
	const symIndex = bundle.symbols?.index;
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
		'Asset files nothing in the bundle or in another shipped file references. They cost storage ' +
			'and copy time on every publish, not player downloads — usually leftovers another tool ' +
			'wrote into deploy/.',
		unreferenced.map((r) => `${r.rel} (${formatBytes(r.bytes)})`),
	);
	issue(
		'warn',
		'Textures over 4096 px',
		`Pages larger than ${MAX_TEXTURE_SIDE}px on a side fail to load on many phones.`,
		oversized.map((r) => `${r.rel} — ${r.dims!.w}×${r.dims!.h}`),
	);
	issue(
		'info',
		'Same bytes shipped twice',
		'Files whose content is identical to another shipped file.',
		duplicates.map((r) => `${r.rel} = ${r.duplicateOf} (${formatBytes(r.bytes)})`),
	);
	issue(
		'info',
		'Region names in more than one sheet',
		'Harmless (sheets register scoped), but usually a superseded sheet that is still referenced.',
		[
			...(art?.collisions ?? []).map(
				(c) => `${c.region}${c.used ? ' (placed)' : ''}: ${c.sheets.join(', ')}`,
			),
			...(symIndex?.collisions ?? []).map((c) => `${c.frame} (symbols): ${c.sheets.join(', ')}`),
		],
	);
	if (meta.flow === 'overridden') {
		issues.unshift({
			level: 'error',
			title: 'Published past flow errors',
			detail: 'An admin overrode the flow gate for this version.',
			items: ['flow: overridden'],
		});
	}
	const unusedAssets = assets.filter((a) => a.uses === 0 && a.type !== 'loading splash');
	issue(
		'info',
		'Assets the game data never names',
		'Shipped and indexed, but no scene, component, symbol or flow names their key. A coded path ' +
			'or a runtime lookup may still use them — check before removing.',
		unusedAssets.map((a) => `${a.type} ${a.name} (${formatBytes(a.bytes)})`),
	);

	return {
		version: BREAKDOWN_VERSION,
		computedAt: (input.now ?? new Date()).toISOString(),
		snapshot: meta,
		totals: {
			files: rows.length,
			bytes: sum(rows),
			bundleBytes: input.bundleBytes,
			gpuBytes,
			unreferencedFiles: unreferenced.length,
			unreferencedBytes: sum(unreferenced),
			duplicateBytes: sum(duplicates),
		},
		categories,
		assets,
		files: rows,
		issues,
		diff: input.previous ? diffFiles(input.previous.meta, input.previous.files, files) : null,
		content: contentSummary(bundle),
	};
}

function diffFiles(
	prevMeta: SnapshotMeta,
	before: ListedFile[],
	after: ListedFile[],
): BreakdownDiff {
	const prev = new Map(before.map((f) => [f.rel, f]));
	const next = new Map(after.map((f) => [f.rel, f]));
	const added = after.filter((f) => !prev.has(f.rel)).map(({ rel, bytes }) => ({ rel, bytes }));
	const removed = before.filter((f) => !next.has(f.rel)).map(({ rel, bytes }) => ({ rel, bytes }));
	const changed = after
		.filter((f) => {
			const p = prev.get(f.rel);
			return p && (p.bytes !== f.bytes || (!!p.etag && !!f.etag && p.etag !== f.etag));
		})
		.map((f) => ({ rel: f.rel, before: prev.get(f.rel)!.bytes, after: f.bytes }));
	const total = (list: ListedFile[]) => list.reduce((s, f) => s + f.bytes, 0);
	return {
		previousId: prevMeta.id,
		previousCreatedAt: prevMeta.createdAt,
		added,
		removed,
		changed,
		bytesDelta: total(after) - total(before),
	};
}

function contentSummary(bundle: RuntimeBundle): { label: string; value: string }[] {
	const count = (v: unknown) =>
		Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
	const locales = Object.keys(bundle.localization?.messages ?? {});
	const source = bundle.localization?.messages?.[bundle.localization.sourceLang];
	const out: { label: string; value: string }[] = [
		{ label: 'Scenes', value: String(count(bundle.doc?.scenes)) },
		{ label: 'Components', value: String(count(bundle.componentDefs)) },
		{ label: 'Symbols', value: String(count(bundle.symbols?.map)) },
		{ label: 'Fonts', value: String(count(bundle.fonts?.catalog?.fonts)) },
		{ label: 'Sounds', value: String(count(bundle.sounds?.catalog?.sounds)) },
		{
			label: 'Languages',
			value: locales.length ? `${locales.length} (${locales.join(', ')})` : '0',
		},
		{ label: 'Text strings', value: String(count(source)) },
		{ label: 'Flipbook clips', value: String(count(bundle.flipbooks)) },
		{ label: 'Effects', value: String(count(bundle.effects)) },
		{ label: 'Shader effects', value: String(count(bundle.shaderEffects)) },
		{ label: 'Cinematics', value: String(count(bundle.cinematics)) },
		{
			label: 'Flow',
			value: bundle.flowV2 ? 'authored (v2)' : bundle.flow ? 'authored (v1)' : 'coded default',
		},
		{ label: 'Game config', value: bundle.config ? 'authored' : 'template default' },
		{ label: 'Win text', value: bundle.winText ? 'authored' : 'coded defaults' },
	];
	if (bundle.doc?.gameType) out.unshift({ label: 'Game type', value: bundle.doc.gameType });
	return out;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ── IO ──────────────────────────────────────────────────────────────────────────────────────────

const snapshotRoot = (client: string, project: string, id: string) =>
	`${SUB.published(client, project)}/${id}/`;

async function listSnapshotFiles(
	client: string,
	project: string,
	id: string,
): Promise<ListedFile[]> {
	const prefix = `${snapshotRoot(client, project, id)}deploy/`;
	return (await listAllObjects(prefix))
		.filter((o) => !o.key.endsWith('/'))
		.map((o) => ({ rel: o.key.slice(prefix.length), bytes: o.size, etag: o.etag }));
}

export class UnknownBreakdownError extends Error {
	constructor(id: string) {
		super(`Version ${id} is not one of this game's retained published versions.`);
		this.name = 'UnknownBreakdownError';
	}
}

/**
 * The breakdown of one retained published version, computed on first request and cached beside the
 * snapshot. Throws {@link UnknownBreakdownError} when the pointer does not name `id`.
 */
export async function loadBuildBreakdown(
	client: string,
	project: string,
	id: string,
): Promise<BuildBreakdown> {
	const pointer = await currentPointer(client, project);
	const meta = pointer?.snapshots.find((s) => s.id === id);
	if (!pointer || !meta) throw new UnknownBreakdownError(id);

	const cacheKey = `${snapshotRoot(client, project, id)}breakdown.json`;
	const cached = await getObjectText(cacheKey);
	if (cached) {
		try {
			const parsed = JSON.parse(cached) as BuildBreakdown;
			if (parsed.version === BREAKDOWN_VERSION) return parsed;
		} catch {
			// Corrupt cache: recompute below and overwrite it.
		}
	}

	const [bundle, bundleText, files] = await Promise.all([
		readSnapshotBundle(client, project, id),
		getObjectText(`${snapshotRoot(client, project, id)}runtime.json`),
		listSnapshotFiles(client, project, id),
	]);
	if (!bundle) throw new UnknownBreakdownError(id);

	const skeletons = new Set(
		[...(bundle.editorArt?.spines ?? []), ...(bundle.symbols?.index?.spines ?? [])].map(
			(r) => r.skeleton,
		),
	);
	const toRead = files.filter(
		(f) => TEXT_EXT.test(f.rel) && f.bytes <= MAX_SCANNED_TEXT_BYTES && !skeletons.has(f.rel),
	);
	const texts = new Map<string, string>();
	const deployRoot = `${snapshotRoot(client, project, id)}deploy/`;
	await mapWithConcurrency(toRead, READ_CONCURRENCY, async (f) => {
		const text = await getObjectText(`${deployRoot}${f.rel}`);
		if (text !== null) texts.set(f.rel, text);
	});

	const older = pointer.snapshots
		.filter((s) => s.id < id)
		.sort((a, b) => b.id.localeCompare(a.id))[0];
	const previous = older
		? { meta: older, files: await listSnapshotFiles(client, project, older.id) }
		: null;

	const breakdown = analyzeBuild({
		meta,
		bundle,
		bundleBytes: bundleText ? new TextEncoder().encode(bundleText).length : 0,
		files,
		texts,
		previous: previous && previous.files.length ? previous : null,
	});
	await putObjectText(cacheKey, JSON.stringify(breakdown), 'application/json').catch((e) =>
		console.warn(`[breakdown] ${project}/${id}: cache write failed:`, e),
	);
	return breakdown;
}
