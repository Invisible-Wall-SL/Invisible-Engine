/**
 * Twin descriptors for pages encoded PADDED (`encodePageToKtx2(…, { pad: true })`): the same
 * descriptor naming each twinned page's `.pm.ktx2` instead, at its padded size, every coordinate
 * untouched. The padding is transparent texels past the right and bottom edges, so a region, frame
 * or glyph keeps its pixel coordinates; only the declared page size changes.
 *
 * Pure (no R2, no encoder), so the font export (`fontExport.ts`) and the engine's stock twins
 * (`scripts/check-stock-ktx2.mjs`) write descriptors one way and a guard can drive it directly.
 */

/** A page's twin: the page name as the descriptor writes it, and the twin's name and size. */
export interface PaddedTwin {
	page: string;
	twin: string;
	width: number;
	height: number;
}

const byPage = (twins: readonly PaddedTwin[]) => new Map(twins.map((t) => [t.page, t]));

/** A rig atlas naming each twinned page's twin, with that page block's `size:` line its size. */
export function paddedTwinAtlas(text: string, twins: readonly PaddedTwin[]): string {
	const pages = byPage(twins);
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	let expectPage = true;
	let page: PaddedTwin | null = null;
	return text
		.split(/\r?\n/)
		.map((line) => {
			if (line.trim() === '') {
				expectPage = true;
				page = null;
				return line;
			}
			if (expectPage) {
				expectPage = false;
				page = pages.get(line.trim()) ?? null;
				return page ? page.twin : line;
			}
			const size = /^(\s*)size\s*:\s*\d+\s*,\s*\d+\s*$/i.exec(line);
			return size && page ? `${size[1]}size:${page.width},${page.height}` : line;
		})
		.join(eol);
}

/** A TexturePacker sheet whose `meta.image` is its page's twin, `meta.size` the twin's size. */
export function paddedTwinSheet(text: string, twins: readonly PaddedTwin[]): string | null {
	const sheet = JSON.parse(text) as { meta?: { image?: string; size?: unknown } };
	const twin = sheet.meta?.image ? byPage(twins).get(sheet.meta.image) : undefined;
	if (!sheet.meta || !twin) return null;
	sheet.meta.image = twin.twin;
	sheet.meta.size = { w: twin.width, h: twin.height };
	return `${JSON.stringify(sheet, null, '\t')}\n`;
}

/**
 * A BMFont descriptor (XML or text `.fnt`) naming each twinned page's twin. A one-page font's
 * `scaleW`/`scaleH` become the twin's size; a font of several pages keeps them (they describe every
 * page at once, and a glyph rect is in pixels either way).
 */
export function paddedTwinFont(text: string, twins: readonly PaddedTwin[]): string {
	const pages = byPage(twins);
	let out = text.replace(/(\bpage\b[^\n>]*\bfile=")([^"]+)(")/g, (match, head, file, tail) => {
		const twin = pages.get(file);
		return twin ? `${head}${twin.twin}${tail}` : match;
	});
	const pageCount = [...text.matchAll(/\bpage\b[^\n>]*\bfile="/g)].length;
	if (pageCount === 1 && twins.length === 1) {
		out = out
			.replace(/\bscaleW=("?)\d+\1/, `scaleW=$1${twins[0].width}$1`)
			.replace(/\bscaleH=("?)\d+\1/, `scaleH=$1${twins[0].height}$1`);
	}
	return out;
}
