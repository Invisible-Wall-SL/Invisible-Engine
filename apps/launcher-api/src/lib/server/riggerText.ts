import { createHash } from 'node:crypto';

/**
 * Invisible Rigger — **text as LOCALIZED ART in the rig** (design
 * `docs/design/invisible-cinematic.md` §12.4a).
 *
 * The reframing that makes this work: it is not "text in a rig", it is localized ART in a
 * rig. A string is rasterised to an atlas region ONCE, in the browser, from a single
 * localization KEY; from then on it is an ORDINARY Spine region attachment, so region→mesh
 * convert, weights, deform and keyframing all apply with NO new machinery, and the `.irig`
 * stays byte-valid Spine 4.2 (design §2.1) with no sidecar for geometry.
 *
 * WHERE THE ART LIVES — and why it ships (rule 8). The rasterised strings are packed onto a
 * SECOND PAGE inside the rig bundle's own `.atlas`, not into the source sheet:
 *
 *  - `exportSpineBundle` already copies EVERY page `atlasPageNames` finds, so a text page
 *    travels the export → `deploy/` → bake → pull → register chain with the rig, for free.
 *    No new asset class, no new export step, nothing stranded at a source prefix.
 *  - Packing into the SOURCE sheet instead would re-pack it, moving every rect, which
 *    invalidates the frozen geometry of every OTHER rig built on that sheet.
 *
 * The catch it creates: `ensureBundleAtlasFresh` re-synthesises the bundle `.atlas` from the
 * source manifest, which would drop a hand-appended page. So the text page is not appended to
 * the file — it is DERIVED, on every synthesis, from this document (`textAtlasBlock`), and the
 * document's hash is folded into the bundle revision so a text edit is itself drift.
 *
 * LOCALIZATION = ATTACHMENT SWAP. One region per locale, one attachment per locale in the same
 * slot, named `<elementId>@<locale>`; the game calls `skeleton.setAttachment` for the locale it
 * is running (see `localeAttachmentSuffix`). Standard Spine — no format extension.
 */

/** One rasterised locale variant of a text element: its packed rect + the string it shows. */
export interface RigTextVariant {
	/** BCP-47-ish locale tag, e.g. `en`, `pt-BR`. */
	locale: string;
	/**
	 * The string that was rasterised. A CACHE for the author's benefit (so the tool can flag
	 * "the translation changed since this was baked") — NEVER the source of truth, which is
	 * always `RigTextElement.key` resolved through `/localization`.
	 */
	text: string;
	/** On-page rect of this variant on the bundle's text page. */
	x: number;
	y: number;
	w: number;
	h: number;
	/**
	 * The size this variant was rasterised at. Usually the element's `fontSize`; SMALLER when the
	 * bake had to shrink this locale to fit the source locale's width (a translation is routinely
	 * 1.5–2× longer than its English source, and rig text is placed once for every locale).
	 *
	 * Persisted purely so the tool can distinguish "too wide and never fitted" from "too wide and
	 * already fitted as far as it goes" — the first is drift worth re-baking, the second is a
	 * standing warning. Without it the auto-sync would re-bake an unfittable string on every open.
	 */
	fontSize?: number;
}

/**
 * How an element is drawn. Persisted because a re-bake (the translation changed, or a locale
 * was newly reviewed) must reproduce the SAME look — a style that lived only in the panel's
 * form state would silently drift between bakes.
 */
export interface RigTextStyleData {
	/** Fill colour; a bitmap font is tinted by it, so `#ffffff` is the identity. */
	color: string;
	strokeColor?: string;
	strokeWidth?: number;
	letterSpacing?: number;
}

/** One text element: a localization key rendered in a font, once per locale. */
export interface RigTextElement {
	/** Stable slug — the attachment base name and the region path segment. */
	id: string;
	/** The localization key. The ONE source of the strings (`/localization` owns them). */
	key: string;
	/** Catalog font id (`fonts.json` entry id), plus its display name for the UI. */
	fontId: string;
	fontName: string;
	/** Render size in px (bitmap fonts scale off their own baked size). */
	fontSize: number;
	/** The locale whose variant is the SETUP attachment (and the mesh's authoring locale). */
	sourceLocale: string;
	/** Slot the attachments live in (one slot per element). */
	slot: string;
	style: RigTextStyleData;
	variants: RigTextVariant[];
}

/** Everything the Rigger needs to rebuild a rig's text page + its atlas block. */
export interface RigTextDoc {
	version: 1;
	/** The packed page inside the bundle; `null` when the rig has no text elements. */
	page: { file: string; width: number; height: number } | null;
	elements: RigTextElement[];
	updatedAt: string;
}

/** The bundle-relative filename of the text document sidecar. */
export const RIG_TEXT_DOC_FILE = 'text.json';

/** Text page filenames are content-addressed (`rigtext-<hash>.png`) so a save that loses a
 *  conditional write can never leave the winner's document pointing at the loser's pixels. */
export const RIG_TEXT_PAGE_RE = /^rigtext-[0-9a-f]{8,32}\.png$/;

/** R2 key of a bundle's text document. */
export function rigTextDocKey(bundlePrefix: string): string {
	return `${bundlePrefix}/${RIG_TEXT_DOC_FILE}`;
}

export function emptyRigTextDoc(): RigTextDoc {
	return { version: 1, page: null, elements: [], updatedAt: '' };
}

/**
 * The atlas region `path` a variant samples. Slashes are ordinary in Spine region names
 * (and `atlasRegionNames` classifies lines structurally, not by extension), so the
 * namespaced form keeps text regions from ever colliding with sheet art.
 */
export function rigTextRegionName(elementId: string, locale: string): string {
	return `text/${elementId}/${locale}`;
}

/**
 * The attachment name for a variant. The `@<locale>` suffix is the ONLY thing the game needs
 * to perform the locale swap — no sidecar travels with the `.irig`, so a rig that reaches a
 * game through any path (export, library copy, desktop Spine re-import) carries its own
 * localization wiring in names Spine already round-trips.
 */
export function rigTextAttachmentName(elementId: string, locale: string): string {
	return `${elementId}@${locale}`;
}

/**
 * Locale suffix of an attachment name, or `null` when it carries none. This predicate is the
 * whole contract between the Rigger and the runtime, so it is shared rather than
 * re-implemented on each side.
 *
 * The language subtag must be exactly TWO letters. A 2–3 letter rule looked more permissive
 * but classified `logo@big` as locale `big` (caught by the gate), which would have made an
 * ordinary attachment eligible for locale swapping in a shipped rig. `/localization` writes
 * lowercase two-letter codes with an optional region subtag, so nothing real is lost.
 *
 * It is still only HALF the guard. The runtime swap additionally requires a SIBLING attachment
 * `<base>@<the running locale>` to exist before it touches a slot, so a name that slips through
 * this pattern by coincidence can never hide art: with no sibling there is nothing to swap to.
 */
export function localeAttachmentSuffix(
	attachmentName: string,
): { base: string; locale: string } | null {
	const m = /^(.+)@([a-z]{2}(?:-[A-Za-z0-9]{2,8})?)$/.exec(attachmentName);
	if (!m) return null;
	return { base: m[1], locale: m[2] };
}

/** Ids/locales are used as R2-adjacent atlas names — keep them boringly safe. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOCALE_RE = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})?$/;

/**
 * Coerce arbitrary parsed/posted data into a valid document, DROPPING anything malformed
 * rather than throwing — a corrupt sidecar must degrade to "this rig has no text", never
 * break every read path that composes the atlas.
 */
export function normalizeRigTextDoc(input: unknown): RigTextDoc {
	const obj = (input ?? {}) as Partial<RigTextDoc>;
	const rawPage = obj.page as RigTextDoc['page'] | undefined;
	const page =
		rawPage &&
		typeof rawPage.file === 'string' &&
		RIG_TEXT_PAGE_RE.test(rawPage.file) &&
		Number.isFinite(rawPage.width) &&
		Number.isFinite(rawPage.height) &&
		rawPage.width > 0 &&
		rawPage.height > 0
			? {
					file: rawPage.file,
					width: Math.round(rawPage.width),
					height: Math.round(rawPage.height),
				}
			: null;

	const seen = new Set<string>();
	const elements: RigTextElement[] = [];
	for (const raw of Array.isArray(obj.elements) ? obj.elements : []) {
		const e = (raw ?? {}) as Partial<RigTextElement>;
		if (typeof e.id !== 'string' || !ID_RE.test(e.id) || seen.has(e.id)) continue;
		if (typeof e.key !== 'string' || !e.key) continue;
		const variants: RigTextVariant[] = [];
		const seenLocale = new Set<string>();
		for (const rawV of Array.isArray(e.variants) ? e.variants : []) {
			const v = (rawV ?? {}) as Partial<RigTextVariant>;
			if (typeof v.locale !== 'string' || !LOCALE_RE.test(v.locale)) continue;
			if (seenLocale.has(v.locale)) continue;
			if (![v.x, v.y, v.w, v.h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
			if ((v.w as number) <= 0 || (v.h as number) <= 0) continue;
			seenLocale.add(v.locale);
			variants.push({
				locale: v.locale,
				text: typeof v.text === 'string' ? v.text : '',
				x: Math.round(v.x as number),
				y: Math.round(v.y as number),
				w: Math.round(v.w as number),
				h: Math.round(v.h as number),
				// Absent on every variant baked before the fit rule existed — left undefined rather
				// than defaulted, because "unknown" is exactly what it means and the drift check
				// reads it that way.
				...(typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) && v.fontSize > 0
					? { fontSize: Math.round(v.fontSize) }
					: {}),
			});
		}
		if (!variants.length) continue;
		const sourceLocale =
			typeof e.sourceLocale === 'string' && seenLocale.has(e.sourceLocale)
				? e.sourceLocale
				: variants[0].locale;
		seen.add(e.id);
		elements.push({
			id: e.id,
			key: e.key,
			fontId: typeof e.fontId === 'string' ? e.fontId : '',
			fontName: typeof e.fontName === 'string' ? e.fontName : '',
			fontSize:
				typeof e.fontSize === 'number' && Number.isFinite(e.fontSize) && e.fontSize > 0
					? e.fontSize
					: 48,
			sourceLocale,
			slot: typeof e.slot === 'string' && e.slot ? e.slot : `text_${e.id}`,
			style: normalizeStyle(e.style),
			variants,
		});
	}

	return { version: 1, page, elements, updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '' };
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeStyle(input: unknown): RigTextStyleData {
	const s = (input ?? {}) as Partial<RigTextStyleData>;
	const num = (v: unknown, lo: number, hi: number): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
	return {
		color: typeof s.color === 'string' && COLOR_RE.test(s.color) ? s.color : '#ffffff',
		strokeColor:
			typeof s.strokeColor === 'string' && COLOR_RE.test(s.strokeColor) ? s.strokeColor : undefined,
		strokeWidth: num(s.strokeWidth, 0, 64),
		letterSpacing: num(s.letterSpacing, -64, 64),
	};
}

/**
 * The `.atlas` block for a rig's text page — a SECOND page appended to the synthesised
 * source-sheet block by `ensureBundleAtlasFresh`. Empty string when the rig has no text (so
 * the atlas is byte-identical to a text-less rig's: parity by construction).
 *
 * Emitted in the same grammar as `regionsToSpineAtlas`: a blank separator line, the page
 * filename, `size:`/`filter:`, then `<region name>` + `bounds:`. Text regions are never
 * trimmed and never rotated (we pack them ourselves, upright), so there is no `offsets:` /
 * `rotate:` line — which also keeps them clear of the CW-vs-CCW rotation trap that bites
 * packed sheet art.
 */
export function textAtlasBlock(doc: RigTextDoc): string {
	if (!doc.page || !doc.elements.length) return '';
	const lines: string[] = ['', doc.page.file, `size:${doc.page.width},${doc.page.height}`, 'filter:Linear,Linear'];
	let regions = 0;
	for (const el of doc.elements) {
		for (const v of el.variants) {
			lines.push(rigTextRegionName(el.id, v.locale));
			lines.push(`bounds:${v.x},${v.y},${v.w},${v.h}`);
			regions++;
		}
	}
	if (!regions) return '';
	return lines.join('\n') + '\n';
}

/**
 * Content hash of everything in the document that the composed `.atlas` depends on. Folded
 * into the bundle revision so a text-only edit (same source sheet, same page ETag) still reads
 * as drift and re-composes the atlas — otherwise the freshness gate would short-circuit and
 * every consumer would keep serving the pre-text atlas.
 */
export function rigTextRevision(doc: RigTextDoc): string {
	const block = textAtlasBlock(doc);
	if (!block) return '';
	return createHash('sha1').update(block).digest('hex').slice(0, 12);
}

/** Region names a rig's text document contributes — the Rigger lists these alongside the
 *  sheet's own regions so a text variant is attachable like any packed image. */
export function rigTextRegionNames(doc: RigTextDoc): string[] {
	const out: string[] = [];
	for (const el of doc.elements) {
		for (const v of el.variants) out.push(rigTextRegionName(el.id, v.locale));
	}
	return out;
}
