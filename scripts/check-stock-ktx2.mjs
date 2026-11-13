/**
 * The engine's stock art (`apps/lines/src/game/assets.ts`) ships a KTX2 twin of every page big
 * enough to earn one, and this holds the twins to the art they were encoded from.
 *
 *     pnpm check:stock-ktx2            # the gate: offline, no encode
 *     node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *       scripts/check-stock-ktx2.mjs --write   # encode the twins and write the manifest
 *
 * WHY. Phones load the compressed tier (`preferCompressedTextures`, `apps/lines/src/editor-scenes.ts`)
 * and every project page there has a `.pm.ktx2` twin, but the stock sheets the shared runtime
 * registers for every game had none, so they decoded to full RGBA on the GPU: 42 MB of
 * `overlay-buffaloduel`'s 65 MB of uncompressed textures on that tier (2026-11-12).
 *
 * HOW. The same encoder the launcher runs (`encodePageToKtx2`: UASTC q1 + Zstd, premultiplied,
 * named `.pm.ktx2`), with the page PADDED to whole 4×4 blocks rather than floored, so no descriptor
 * coordinate moves: a rig atlas gets its `size:` line and a sheet its `meta.size`, nothing else. Each
 * twinned descriptor gets a twin descriptor beside it (`x.ktx2.atlas`, `x.ktx2.json`, `x.ktx2.xml`)
 * naming the twin page. `apps/lines/src/game/stockTwins.json` records, per descriptor, the hash of
 * the descriptor and of every page a twin was encoded from; the runtime registers a twin only on
 * the compressed tier and only where the build ships it (`stockTwins.ts`, `config-vite`
 * `stockTwins.js`), with the original as the entry's `fallback`.
 *
 * The gate fails when a stock page or descriptor changed after its twin was encoded, a twin is
 * missing or altered, a twin descriptor is not what this script would write, a stock descriptor
 * that should have a twin has none (or one that should not, has one), or the encoder revision moved
 * on (`KTX2_ENCODER_REVISION`): each is fixed by `--write`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import stockTable, { gameAssetsBase } from '../apps/lines/src/game/assets.ts';
import {
	BLOCK,
	KTX2_ENCODER_REVISION,
	MIN_ENCODE_PIXELS,
	paddedSize,
} from '../apps/launcher-api/src/lib/server/ktx2Dimensions.ts';
import {
	paddedTwinAtlas,
	paddedTwinFont,
	paddedTwinSheet,
} from '../apps/launcher-api/src/lib/server/ktx2Descriptors.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/lines/static/assets');
const MANIFEST = join(ROOT, 'apps/lines/src/game/stockTwins.json');
const write = process.argv.includes('--write');

/** A file's SHA-256 in Subresource Integrity form (`sha256-<base64>`): hex would read as a secret. */
const sha256 = (bytes) => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
const read = (rel) => readFileSync(join(ASSETS, rel));

/** A PNG's or WebP's pixel size from its header (no decoder needed for the gate). */
function imageSize(bytes) {
	if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
		const chunk = bytes.toString('ascii', 12, 16);
		if (chunk === 'VP8X')
			return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
		if (chunk === 'VP8 ')
			return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
		if (chunk === 'VP8L') {
			const v = bytes.readUInt32LE(21);
			return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
		}
	}
	throw new Error('not a PNG or WebP');
}

/** A KTX2 file's pixel size from its header. */
const ktx2Size = (bytes) => ({ width: bytes.readUInt32LE(20), height: bytes.readUInt32LE(24) });

/** The `.pm.ktx2` twin name of a page, beside it. */
const twinOf = (rel) => rel.replace(/\.(png|webp|jpe?g)$/i, '.pm.ktx2');
/** The twin descriptor of a descriptor, beside it: `x.atlas` → `x.ktx2.atlas`. */
const twinDescriptorOf = (rel) => rel.replace(/(\.[^./]+)$/, '.ktx2$1');

/** Each atlas page block's name and whether it declares premultiplied pixels (`pma: true`). */
function atlasPages(text) {
	const pages = [];
	let expectPage = true;
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			continue;
		}
		if (expectPage) {
			expectPage = false;
			pages.push({ name: line.trim(), pma: false });
			continue;
		}
		if (/^\s*pma\s*:\s*true\s*$/i.test(line)) pages[pages.length - 1].pma = true;
	}
	return pages;
}

/** The pages a stock descriptor names, relative to the assets root. */
function pagesOf(rel, type) {
	const dir = posix.dirname(rel);
	if (type === 'sprite') return [{ file: rel, pma: false }];
	const text = read(rel).toString('utf8');
	if (type === 'spine')
		return atlasPages(text).map((p) => ({ file: posix.join(dir, p.name), pma: p.pma }));
	if (type === 'font')
		return [...text.matchAll(/<page\b[^>]*\bfile="([^"]+)"/g)].map((m) => ({
			file: posix.join(dir, m[1]),
			pma: false,
		}));
	const image = JSON.parse(text)?.meta?.image;
	return image ? [{ file: posix.join(dir, image), pma: false }] : [];
}

/** The descriptor `rel` rewritten to name each twinned page's twin at its padded size. */
function twinDescriptor(type, text, twins) {
	const padded = twins.map((t) => ({
		page: basename(t.file),
		twin: basename(t.twin),
		width: t.width,
		height: t.height,
	}));
	if (type === 'spine') return paddedTwinAtlas(text, padded);
	if (type === 'font') return paddedTwinFont(text, padded);
	return paddedTwinSheet(text, padded);
}

/**
 * Every stock descriptor (deduplicated: several keys share an atlas), its type and its pages, with
 * the pages that earn a twin and why the others do not.
 */
function stockDescriptors() {
	const base = gameAssetsBase();
	const out = new Map();
	for (const entry of Object.values(stockTable)) {
		if (entry.type === 'audio') continue;
		const href = String(typeof entry.src === 'string' ? entry.src : entry.src.atlas);
		const rel = decodeURIComponent(href.slice(base.length));
		if (out.has(rel)) continue;
		const pages = pagesOf(rel, entry.type).map((page) => {
			const size = imageSize(read(page.file));
			const area = size.width * size.height;
			const padded = paddedSize(size.width, size.height);
			const skip =
				area < MIN_ENCODE_PIXELS
					? `under ${MIN_ENCODE_PIXELS} px`
					: !padded
						? 'would need a downscale'
						: entry.type === 'sprite' && (size.width % BLOCK !== 0 || size.height % BLOCK !== 0)
							? 'a standalone image whose size is not whole blocks: a padded twin would draw it larger'
							: undefined;
			return { ...page, ...size, padded, skip };
		});
		out.set(rel, { rel, type: entry.type, pages });
	}
	return [...out.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

async function encodeAll() {
	const { encodePageToKtx2 } = await import('../apps/launcher-api/src/lib/server/ktx2Encode.ts');
	const manifest = { encoder: KTX2_ENCODER_REVISION, descriptors: {} };
	for (const d of stockDescriptors()) {
		const twins = [];
		for (const page of d.pages) {
			if (page.skip) {
				console.log(`  - ${page.file}: no twin (${page.skip})`);
				continue;
			}
			const source = read(page.file);
			const encoded = await encodePageToKtx2(new Uint8Array(source), {
				pad: true,
				sourcePremultiplied: page.pma,
			});
			if (!encoded) throw new Error(`${page.file}: the encoder returned no twin`);
			const twin = twinOf(page.file);
			writeFileSync(join(ASSETS, twin), encoded.bytes);
			twins.push({
				file: page.file,
				sha256: sha256(source),
				twin,
				twinSha256: sha256(encoded.bytes),
				width: encoded.width,
				height: encoded.height,
			});
			console.log(
				`  + ${twin} ${encoded.width}x${encoded.height} (${(encoded.bytes.length / 1e6).toFixed(2)} MB)`,
			);
		}
		if (twins.length === 0) continue;
		const text = read(d.rel);
		const twin = d.type === 'sprite' ? twins[0].twin : twinDescriptorOf(d.rel);
		if (d.type !== 'sprite')
			writeFileSync(join(ASSETS, twin), twinDescriptor(d.type, text.toString('utf8'), twins));
		manifest.descriptors[d.rel] = { type: d.type, sha256: sha256(text), twin, pages: twins };
	}
	writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(
		`wrote ${Object.keys(manifest.descriptors).length} twinned descriptor(s) to ${MANIFEST}`,
	);
}

/** Every way the committed twins disagree with the stock art: `[]` when they agree. */
function problems(manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))) {
	const out = [];
	if (manifest.encoder !== KTX2_ENCODER_REVISION)
		out.push(`encoded at revision ${manifest.encoder}, the encoder is at ${KTX2_ENCODER_REVISION}`);
	const expected = new Map(
		stockDescriptors()
			.filter((d) => d.pages.some((p) => !p.skip))
			.map((d) => [d.rel, d]),
	);
	for (const rel of expected.keys())
		if (!manifest.descriptors[rel]) out.push(`${rel}: has a page that earns a twin, and no twin`);
	for (const [rel, entry] of Object.entries(manifest.descriptors)) {
		const d = expected.get(rel);
		if (!d) {
			out.push(`${rel}: has a twin it should not (no page of it earns one)`);
			continue;
		}
		if (!existsSync(join(ASSETS, rel))) {
			out.push(`${rel}: missing`);
			continue;
		}
		const text = read(rel);
		if (sha256(text) !== entry.sha256) out.push(`${rel}: changed since its twin was encoded`);
		const earning = d.pages.filter((p) => !p.skip).map((p) => p.file);
		const twinned = entry.pages.map((p) => p.file);
		if (earning.join() !== twinned.join())
			out.push(`${rel}: twins ${twinned.join(', ')} but ${earning.join(', ')} earn one`);
		for (const page of entry.pages) {
			if (!existsSync(join(ASSETS, page.file))) {
				out.push(`${page.file}: missing`);
				continue;
			}
			if (sha256(read(page.file)) !== page.sha256)
				out.push(`${page.file}: changed since its twin was encoded`);
			if (page.twin !== twinOf(page.file))
				out.push(`${page.file}: twin is not ${twinOf(page.file)}`);
			if (!existsSync(join(ASSETS, page.twin))) {
				out.push(`${page.twin}: missing`);
				continue;
			}
			const twinBytes = read(page.twin);
			if (sha256(twinBytes) !== page.twinSha256) out.push(`${page.twin}: altered`);
			const size = ktx2Size(twinBytes);
			const src = imageSize(read(page.file));
			if (size.width !== page.width || size.height !== page.height)
				out.push(
					`${page.twin}: is ${size.width}x${size.height}, recorded ${page.width}x${page.height}`,
				);
			if (size.width % BLOCK || size.height % BLOCK)
				out.push(`${page.twin}: ${size.width}x${size.height} is not whole 4x4 blocks`);
			if (size.width < src.width || size.height < src.height || size.width - src.width >= BLOCK)
				out.push(`${page.twin}: is not ${page.file} padded to whole blocks`);
		}
		if (d.type === 'sprite') {
			if (entry.twin !== entry.pages[0]?.twin) out.push(`${rel}: its twin is not its page's twin`);
			continue;
		}
		if (entry.twin !== twinDescriptorOf(rel))
			out.push(`${rel}: twin is not ${twinDescriptorOf(rel)}`);
		const twinPath = join(ASSETS, entry.twin);
		if (!existsSync(twinPath)) out.push(`${entry.twin}: missing`);
		else if (
			readFileSync(twinPath, 'utf8') !== twinDescriptor(d.type, text.toString('utf8'), entry.pages)
		)
			out.push(`${entry.twin}: is not what --write writes for ${rel}`);
	}
	return out;
}

if (write) {
	await encodeAll();
} else {
	const found = problems();
	if (found.length) {
		console.error('FAIL: the stock KTX2 twins disagree with the stock art:');
		for (const p of found) console.error(`  - ${p}`);
		console.error(
			'Run: node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-stock-ktx2.mjs --write',
		);
		process.exit(1);
	}
	const count = Object.keys(JSON.parse(readFileSync(MANIFEST, 'utf8')).descriptors).length;
	console.log(`PASS: ${count} stock descriptor(s) carry KTX2 twins that match their art.`);
}
