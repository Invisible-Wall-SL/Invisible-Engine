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

export interface SharedPage {
	/** The shared page filename (e.g. `<hash>.webp`) — reference it as PAGE_REF_PREFIX + this. */
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
		const file = `${hash}.${ext}`;
		const pageKey = `${this.deployPrefix}_pages/${file}`;
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

		if (!(await copyObject(sourceKey, pageKey))) return null;
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
