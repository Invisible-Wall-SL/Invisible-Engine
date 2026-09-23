/**
 * Content-addressed store of atlas PAGES, so a page shared by many rigs (and the editor-art
 * sheet) ships — and encodes — ONCE and the game loads it as a SINGLE GPU texture.
 *
 * Why: each rig spine bundle carried its OWN copy of its atlas page, and the game loaded each
 * copy as a distinct texture. A full-screen background/UI page used by several rigs (e.g.
 * `S_Game_UI2` → R_SpinButtonNew + R_Turbo + R_Auto + the sheet) became 3–4 separate 32 MB
 * textures, and MORE loaded as features mounted over play — a monotonic VRAM climb that
 * eventually OOM-crashed iOS (confirmed live: `managedTextures` grew 25→41 with the same page
 * appearing under multiple rig folders). Deduping to one shared page collapses those copies to
 * 1× and stops the growth.
 *
 * Pages live at `deploy/_pages/<contentHash>.<ext>` (+ a `.ktx2` twin when `ENV.KTX2_ENCODE`).
 * Every atlas/sheet sits at `deploy/<subtree>/<stem>/…`, so it references a shared page by the
 * base-independent relative path {@link PAGE_REF_PREFIX} (`../../_pages/`) — which resolves the
 * same in baked (`static/assets/`) and runtime (`/api/deploy/…`) modes, and through Spine's own
 * atlas loader (which normalizes `page.dirname + pageName`) and the spritesheet loader
 * (`meta.image` relative to the JSON). The dedup KEY is the source object's ETag+size — a cheap
 * HEAD, no byte download; bytes are read only to encode a NEW page's KTX2 twin. A page that
 * isn't byte-identical simply doesn't dedup (safe: more copies, never a wrong merge).
 */
import sharp from 'sharp';
import { ENV } from './env';
import { encodePageToKtx2 } from './ktx2Encode';
import { KTX2_ENCODER_REVISION } from './ktx2Dimensions';
import {
	copyObject,
	getObjectBytes,
	getObjectText,
	headObject,
	objectExists,
	putObjectBytes,
	putObjectText,
} from './r2';

/** Relative path from any atlas/sheet at `deploy/<subtree>/<stem>/` up to `deploy/_pages/`. */
export const PAGE_REF_PREFIX = '../../_pages/';

/**
 * WebP settings for a re-encoded page: **near-lossless**, not ordinary lossy.
 *
 * Measured on the Book of Borut remake's ten PNG pages. Plain lossy WebP is the obvious
 * choice by size (q90 took 20.3 MB → 3.6 MB) and it is the wrong one: on the UI sheet it
 * moved **51,588 fully-opaque pixels by more than 20/255**, with a worst case of 92 — visible
 * banding inside buttons and title art, not just softened alpha edges. Raising the quality
 * does not buy it back either; q90→q98 gained 0.9 dB for 40% more bytes, because the error is
 * structural rather than quantization noise.
 *
 * `nearLossless: 40` holds the worst opaque-pixel error to **4/255** (42.6 dB) and still lands
 * ~68% under PNG — most of the lossy win, effectively none of the risk. `alphaQuality: 100`
 * keeps cut-out edges exact. Dimensions are untouched, so every atlas/sheet coordinate stays
 * valid without a rescale.
 */
const WEBP_OPTS = { nearLossless: true, quality: 40, alphaQuality: 100, effort: 4 } as const;

/**
 * Re-encode a page to WebP at its EXACT source dimensions. Null on any failure ⇒ the caller
 * ships the source bytes verbatim (parity), never a broken page.
 *
 * Deliberately not size-guarded: the filename is what the content cache probes, so making it
 * depend on the encoded size would mean a page that WebP cannot beat gets re-downloaded and
 * re-encoded on EVERY assemble — and that path is already close to the client's 90 s budget
 * (`gotcha_runtime_assemble_outruns_client_timeout`). A packed page WebP loses on is a
 * hypothetical; a blown assemble budget is a bug we have already shipped once.
 */
async function transcodePageToWebp(sourceKey: string): Promise<Buffer | null> {
	try {
		const src = await getObjectBytes(sourceKey);
		if (!src) return null;
		return await sharp(Buffer.from(src.body)).webp(WEBP_OPTS).toBuffer();
	} catch {
		return null;
	}
}

export interface SharedPage {
	/** The shared page filename (e.g. `<hash>.webp`) — reference it as PAGE_REF_PREFIX + this.
	 *  Its extension is the SHIPPED format, which is not always the source's: a PNG/JPEG source
	 *  is re-encoded to `.webp` unless `PAGE_WEBP=0` or the encode failed to beat the original.
	 *  Callers must reference this rather than deriving a name from the source key — PIXI and
	 *  Spine both pick their loader by extension, so a name that disagrees with the bytes only
	 *  surfaces as a broken texture in the game. */
	file: string;
	/** The shared KTX2 twin filename (`<hash>.ktx2`), when it was encoded. */
	ktx2File?: string;
	/** The KTX2 twin's actual pixel dimensions — EQUAL to the source unless it was auto-downscaled
	 *  (`encodePageToKtx2` shrinks pages over the encoder/GPU cap). A referencing atlas/sheet
	 *  rescales its coordinates from its own (source-sized) `size:` line to these dims — identical
	 *  UVs — via #179's `toTexturePackerJson(sx,sy)` / `rewriteAtlasForKtx2`. 0 when no KTX2. */
	ktx2Width: number;
	ktx2Height: number;
}

export class PageStore {
	/** ETag:size → shared page, so an identical source page is written + encoded only once. */
	private readonly byContent = new Map<string, SharedPage>();
	/**
	 * In-flight `ensure` runs keyed by SOURCE key — the single-flight that makes this store safe to
	 * call concurrently.
	 *
	 * `byContent` alone cannot do it: its key is derived from a `headObject` result, so the lookup
	 * and the `set` are separated by five awaits (head → exists → copy → KTX2 encode → meta write).
	 * Callers were sequential when that was written; they are not any more (the art export now runs
	 * its sheets through `mapWithConcurrency`), and two sheets sharing a page would each miss the
	 * cache and then each COPY and each KTX2-ENCODE the same bytes — the expensive half of the
	 * export, done twice, on the read path. Keyed on the source rather than the content because the
	 * content key does not exist until the head returns.
	 */
	private readonly inflight = new Map<string, Promise<SharedPage | null>>();
	/** Every R2 key written under `deployPrefix` — fold into the caller's prune set. */
	readonly written = new Set<string>();

	constructor(private readonly deployPrefix: string) {}

	/**
	 * Ensure the page at `sourceKey` (and its KTX2 twin when enabled) exists once in the shared
	 * store; return its shared filenames, or null when the source is missing. `ext` is the page's
	 * real extension (`webp`/`png`/`jpg`).
	 *
	 * Safe to call concurrently for the same `sourceKey`: the second caller joins the first.
	 */
	async ensure(sourceKey: string, ext: string): Promise<SharedPage | null> {
		const pending = this.inflight.get(sourceKey);
		if (pending) return pending;
		const run = this.ensureOnce(sourceKey, ext).finally(() => this.inflight.delete(sourceKey));
		this.inflight.set(sourceKey, run);
		return run;
	}

	private async ensureOnce(sourceKey: string, ext: string): Promise<SharedPage | null> {
		const head = await headObject(sourceKey);
		if (!head) return null;
		const contentKey = `${head.etag ?? ''}:${head.size}`;
		const cached = this.byContent.get(contentKey);
		if (cached) return cached;

		const hash = contentKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'page';
		// A non-WebP page ships re-encoded (see `ENV.PAGE_WEBP`), so the shipped name is derived
		// from the TARGET format, not the source's. That also migrates an already-deployed project
		// for free: its pages live at `<hash>.png`, this probes `<hash>.webp`, misses the content
		// cache once, re-encodes, and the stale `.png` falls out of `written` and is pruned.
		const reEncode = ENV.PAGE_WEBP && ext !== 'webp';
		let file = `${hash}.${reEncode ? 'webp' : ext}`;
		let pageKey = `${this.deployPrefix}_pages/${file}`;
		// A `_pages/<hash>.meta.json` sidecar records the KTX2 twin's filename + dims, so a cached
		// page (below) is reused WITHOUT re-copying or re-encoding — the same skip-if-exists the
		// per-site encoders use, so the export stays fast on the per-boot `/api/editor/runtime`
		// assemble (`gotcha_ktx2_encode_on_read_path_stalls_runtime`). All reused keys go into
		// `written` so the `_pages/` prune keeps them.
		const metaKey = `${this.deployPrefix}_pages/${hash}.meta.json`;

		// Content-cache: the filename IS the content fingerprint, so an existing page is
		// byte-identical to what a re-copy would produce. Reuse it (+ its KTX2 twin from the meta).
		if (await objectExists(pageKey)) {
			this.written.add(pageKey);
			this.written.add(metaKey);
			const shared: SharedPage = { file, ktx2Width: 0, ktx2Height: 0 };
			const metaTxt = await getObjectText(metaKey);
			const m = metaTxt
				? (JSON.parse(metaTxt) as { ktx2File?: string; w?: number; h?: number; enc?: number })
				: null;
			// Reuse the twin only when it was produced by the CURRENT encoder. The cache key is the
			// source page's ETag+size, which says nothing about how the twin was made — so without
			// this check a fix to the encoder never reaches a project whose art has not changed, and
			// the broken twin is served forever. See `KTX2_ENCODER_REVISION`.
			const reusable =
				!!m?.ktx2File &&
				m.enc === KTX2_ENCODER_REVISION &&
				(await objectExists(`${this.deployPrefix}_pages/${m.ktx2File}`));
			if (reusable && m) {
				shared.ktx2File = m.ktx2File;
				shared.ktx2Width = m.w ?? 0;
				shared.ktx2Height = m.h ?? 0;
				this.written.add(`${this.deployPrefix}_pages/${m.ktx2File}`);
			} else if (ENV.KTX2_ENCODE) {
				await this.encodeTwin(sourceKey, hash, shared);
				await this.writeMeta(metaKey, shared);
			}
			this.byContent.set(contentKey, shared);
			return shared;
		}

		if (reEncode) {
			const webp = await transcodePageToWebp(sourceKey);
			if (webp) {
				await putObjectBytes(pageKey, webp, 'image/webp');
			} else {
				// Undecodable source ⇒ ship it byte-verbatim under its OWN extension rather than a
				// `.webp` name that lies about its bytes. This costs a re-attempt on each assemble
				// (the content cache probes the `.webp` name and keeps missing), which is the right
				// trade: it stays correct, and a page `sharp` cannot read is a real problem to see
				// rather than a state to cache.
				file = `${hash}.${ext}`;
				pageKey = `${this.deployPrefix}_pages/${file}`;
				if (!(await copyObject(sourceKey, pageKey))) return null;
			}
		} else if (!(await copyObject(sourceKey, pageKey))) return null;
		this.written.add(pageKey);
		const shared: SharedPage = { file, ktx2Width: 0, ktx2Height: 0 };
		if (ENV.KTX2_ENCODE) await this.encodeTwin(sourceKey, hash, shared);
		await this.writeMeta(metaKey, shared);
		this.byContent.set(contentKey, shared);
		return shared;
	}

	/** Encode the KTX2 twin for `sourceKey` and record it on `shared`. No-op on any failure — a
	 *  missing twin degrades to the WebP/PNG (parity), never a broken build. */
	private async encodeTwin(sourceKey: string, hash: string, shared: SharedPage): Promise<void> {
		const src = await getObjectBytes(sourceKey);
		const encoded = src ? await encodePageToKtx2(src.body) : null;
		if (!encoded) return;
		const ktx2File = `${hash}.ktx2`;
		await putObjectBytes(`${this.deployPrefix}_pages/${ktx2File}`, encoded.bytes, 'image/ktx2');
		this.written.add(`${this.deployPrefix}_pages/${ktx2File}`);
		shared.ktx2File = ktx2File;
		shared.ktx2Width = encoded.width;
		shared.ktx2Height = encoded.height;
	}

	/** The sidecar the content-cache reads back. `enc` is what makes an encoder fix propagate. */
	private async writeMeta(metaKey: string, shared: SharedPage): Promise<void> {
		await putObjectText(
			metaKey,
			JSON.stringify({
				ktx2File: shared.ktx2File,
				w: shared.ktx2Width,
				h: shared.ktx2Height,
				enc: KTX2_ENCODER_REVISION,
			}),
			'application/json',
		);
		this.written.add(metaKey);
	}
}
