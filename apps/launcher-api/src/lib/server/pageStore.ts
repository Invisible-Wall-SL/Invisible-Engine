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
	/** Every R2 key written under `deployPrefix` — fold into the caller's prune set. */
	readonly written = new Set<string>();

	constructor(private readonly deployPrefix: string) {}

	/**
	 * Ensure the page at `sourceKey` (and its KTX2 twin when enabled) exists once in the shared
	 * store; return its shared filenames, or null when the source is missing. `ext` is the page's
	 * real extension (`webp`/`png`/`jpg`).
	 */
	async ensure(sourceKey: string, ext: string): Promise<SharedPage | null> {
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
			if (metaTxt) {
				const m = JSON.parse(metaTxt) as { ktx2File?: string; w?: number; h?: number };
				if (m.ktx2File && (await objectExists(`${this.deployPrefix}_pages/${m.ktx2File}`))) {
					shared.ktx2File = m.ktx2File;
					shared.ktx2Width = m.w ?? 0;
					shared.ktx2Height = m.h ?? 0;
					this.written.add(`${this.deployPrefix}_pages/${m.ktx2File}`);
				}
			}
			this.byContent.set(contentKey, shared);
			return shared;
		}

		if (!(await copyObject(sourceKey, pageKey))) return null;
		this.written.add(pageKey);
		const shared: SharedPage = { file, ktx2Width: 0, ktx2Height: 0 };
		if (ENV.KTX2_ENCODE) {
			const src = await getObjectBytes(sourceKey);
			const encoded = src ? await encodePageToKtx2(src.body) : null;
			if (encoded) {
				const ktx2File = `${hash}.ktx2`;
				await putObjectBytes(`${this.deployPrefix}_pages/${ktx2File}`, encoded.bytes, 'image/ktx2');
				this.written.add(`${this.deployPrefix}_pages/${ktx2File}`);
				shared.ktx2File = ktx2File;
				shared.ktx2Width = encoded.width;
				shared.ktx2Height = encoded.height;
			}
		}
		await putObjectText(
			metaKey,
			JSON.stringify({ ktx2File: shared.ktx2File, w: shared.ktx2Width, h: shared.ktx2Height }),
			'application/json',
		);
		this.written.add(metaKey);
		this.byContent.set(contentKey, shared);
		return shared;
	}
}
