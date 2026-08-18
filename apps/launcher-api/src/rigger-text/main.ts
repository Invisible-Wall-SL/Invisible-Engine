/**
 * Invisible Rigger — rig TEXT as localized art (design `docs/design/invisible-cinematic.md`
 * §12.4a). The vendored, non-Svelte IIFE the raw-WebGL `/rigger` page loads via a `<script>`
 * tag, exactly like `rigger-fx.js`.
 *
 * It owns the two things `view.html` cannot do in plain script: the PIXI-based string
 * rasterisation (`$lib/text/rigTextRaster.client.ts`) and the network round trip that turns a
 * localization key into packed rig art (catalog → strings → bake → presigned page upload →
 * conditional document write → atlas re-compose).
 *
 * It deliberately does NOT touch the skeleton. Writing the slot + per-locale attachments into
 * `rawDoc` stays in `view.html`, which owns that document and its dirty/undo semantics — this
 * module only reports the region names those attachments should point at.
 */
import type { CatalogFont } from '$lib/fontLoad.client';
import {
	bakeRigTextPage,
	rasterizeString,
	setFontCatalog,
	type RigTextRequest,
	type RigTextStyle,
} from '$lib/text/rigTextRaster.client';

/** A localization key as `/api/rigger/strings` reports it. */
interface StringEntry {
	key: string;
	source: string;
	/** Locale → translation. EVERY translation the project has, reviewed or not. */
	translations: Record<string, string>;
	/** How many of `translations` nobody has vetted — a label for the panel, not a gate. */
	unreviewed: number;
}
interface StringsPayload {
	sourceLang: string;
	targetLangs: string[];
	entries: StringEntry[];
}

/** An element as the tool holds it — the persisted shape minus the derived variants. */
interface RigTextElementInput {
	id: string;
	key: string;
	fontId: string;
	fontName: string;
	fontSize: number;
	sourceLocale: string;
	slot: string;
	style: RigTextStyle;
}

interface SaveArgs {
	/** base64url bundle dir (the rig entry's `dir_b64`). */
	dir: string;
	atlasFile: string;
	projectKey: string;
	elements: RigTextElementInput[];
	/** The ETag the tool loaded the document with; `null` = "there was none" (create). */
	baseEtag: string | null;
	force?: boolean;
}

interface SaveResult {
	ok: boolean;
	/** Present on success: the persisted document + the atlas region names it added. */
	etag?: string | null;
	regions?: string[];
	/** `elementId@locale` → region name, so the caller can write the attachments. */
	attachments?: { elementId: string; locale: string; region: string; text: string }[];
	failed?: { elementId: string; locale: string; reason: string }[];
	/** Locales that baked but could not be fitted to the source width — they ship, too wide. */
	warnings?: { elementId: string; locale: string; reason: string }[];
	error?: string;
	message?: string;
	status?: number;
}

let strings: StringsPayload = { sourceLang: 'en', targetLangs: [], entries: [] };
let fonts: CatalogFont[] = [];

async function loadFonts(): Promise<CatalogFont[]> {
	const res = await fetch('/api/fonts/catalog');
	if (!res.ok) throw new Error(`font catalog failed (${res.status})`);
	const data = (await res.json()) as { fonts?: CatalogFont[] };
	fonts = data.fonts ?? [];
	setFontCatalog(fonts);
	return fonts;
}

async function loadStrings(): Promise<StringsPayload> {
	const res = await fetch('/api/rigger/strings');
	if (!res.ok) throw new Error(`localization keys failed (${res.status})`);
	strings = (await res.json()) as StringsPayload;
	return strings;
}

async function loadDoc(dir: string): Promise<unknown> {
	const res = await fetch('/api/rigger/text?dir=' + encodeURIComponent(dir));
	if (!res.ok) throw new Error(`rig text document failed (${res.status})`);
	return res.json();
}

/**
 * Every locale an element bakes in: its source locale plus EVERY translation of its key.
 *
 * This is also the drift oracle the auto-sync compares the baked art against (`view.html`'s
 * `textElementDrift`), which is why it is exported rather than kept private — "what should be
 * baked" must have exactly one definition, or the tool would re-bake forever chasing a locale
 * set the bake itself never produces.
 */
function localesFor(el: RigTextElementInput): { locale: string; text: string }[] {
	const entry = strings.entries.find((e) => e.key === el.key);
	if (!entry) return [];
	const out = [{ locale: el.sourceLocale || strings.sourceLang, text: entry.source }];
	for (const [locale, text] of Object.entries(entry.translations)) {
		if (locale === out[0].locale) continue;
		out.push({ locale, text });
	}
	return out.filter((v) => !!v.text);
}

function regionName(elementId: string, locale: string): string {
	return `text/${elementId}/${locale}`;
}

async function preview(text: string, style: RigTextStyle): Promise<HTMLCanvasElement | null> {
	return rasterizeString({ elementId: 'preview', locale: 'preview', text, style });
}

/**
 * Bake every element's locale variants onto one page, upload it, and write the document.
 *
 * Ordering is deliberate: the PAGE is uploaded FIRST and the document (which names it) only
 * after. A page with no document is an unreferenced object the endpoint's sweep collects; a
 * document naming a page that was never uploaded would compose an atlas whose second page
 * 404s — which a spine runtime reports as an opaque texture failure. The endpoint additionally
 * refuses a document whose page does not exist, so this ordering is enforced, not just assumed.
 */
async function save(args: SaveArgs): Promise<SaveResult> {
	const requests: RigTextRequest[] = [];
	const texts = new Map<string, string>();
	for (const el of args.elements) {
		const sourceLocale = el.sourceLocale || strings.sourceLang;
		for (const v of localesFor(el)) {
			requests.push({
				elementId: el.id,
				locale: v.locale,
				text: v.text,
				style: { ...el.style, fontId: el.fontId, fontSize: el.fontSize },
				// Marks the width budget every other locale of this element is fitted to.
				isSource: v.locale === sourceLocale,
			});
			texts.set(`${el.id}@${v.locale}`, v.text);
		}
	}

	const { page, failed, warnings } = await bakeRigTextPage(requests);
	if (args.elements.length && !page) {
		return {
			ok: false,
			error: 'bake-failed',
			message:
				'Nothing could be rasterised — check the font loaded and the key has a source string.',
			failed,
		};
	}

	if (page) {
		const urlRes = await fetch('/api/rigger/text/page-url', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dir: args.dir, file: page.file }),
		});
		if (!urlRes.ok) {
			return {
				ok: false,
				error: 'upload-url-failed',
				status: urlRes.status,
				message: `Could not get an upload URL for the text page (${urlRes.status}).`,
			};
		}
		const { url, contentType } = (await urlRes.json()) as { url: string; contentType: string };
		// The presigned signature bakes in the Content-Type, so it MUST match exactly.
		const put = await fetch(url, {
			method: 'PUT',
			headers: { 'content-type': contentType },
			body: page.blob,
		});
		if (!put.ok) {
			return {
				ok: false,
				error: 'upload-failed',
				status: put.status,
				message: `Uploading the text page to storage failed (${put.status}).`,
			};
		}
	}

	const rectFor = (elementId: string, locale: string) =>
		page?.rects.find((r) => r.elementId === elementId && r.locale === locale) ?? null;

	const doc = {
		version: 1,
		page: page ? { file: page.file, width: page.width, height: page.height } : null,
		elements: args.elements
			.map((el) => ({
				id: el.id,
				key: el.key,
				fontId: el.fontId,
				fontName: el.fontName,
				fontSize: el.fontSize,
				sourceLocale: el.sourceLocale,
				slot: el.slot,
				style: {
					color: el.style.color,
					strokeColor: el.style.strokeColor,
					strokeWidth: el.style.strokeWidth,
					letterSpacing: el.style.letterSpacing,
				},
				variants: localesFor(el)
					.map((v) => {
						const rect = rectFor(el.id, v.locale);
						return rect
							? { locale: v.locale, text: v.text, ...rectXY(rect), fontSize: rect.fontSize }
							: null;
					})
					.filter((v): v is NonNullable<typeof v> => v !== null),
			}))
			.filter((el) => el.variants.length > 0),
	};

	const res = await fetch('/api/rigger/text', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			dir: args.dir,
			atlasFile: args.atlasFile,
			projectKey: args.projectKey,
			doc,
			...(args.force ? { force: true } : { baseEtag: args.baseEtag }),
		}),
	});
	const payload = (await res.json().catch(() => null)) as
		| { ok?: boolean; etag?: string | null; regions?: string[]; error?: string; message?: string }
		| null;
	if (!res.ok || !payload?.ok) {
		return {
			ok: false,
			status: res.status,
			error: payload?.error ?? 'save-failed',
			message: payload?.message ?? `Saving the rig text failed (${res.status}).`,
			failed,
		};
	}

	const attachments: NonNullable<SaveResult['attachments']> = [];
	for (const el of doc.elements) {
		for (const v of el.variants) {
			attachments.push({
				elementId: el.id,
				locale: v.locale,
				region: regionName(el.id, v.locale),
				text: texts.get(`${el.id}@${v.locale}`) ?? '',
			});
		}
	}

	return { ok: true, etag: payload.etag ?? null, regions: payload.regions, attachments, failed, warnings };
}

function rectXY(rect: { x: number; y: number; w: number; h: number }): {
	x: number;
	y: number;
	w: number;
	h: number;
} {
	return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

const api = {
	loadFonts,
	loadStrings,
	loadDoc,
	preview,
	save,
	localesFor,
	regionName,
	get fonts(): CatalogFont[] {
		return fonts;
	},
	get strings(): StringsPayload {
		return strings;
	},
};

export type RigTextApi = typeof api;

declare global {
	interface Window {
		RiggerText: RigTextApi;
	}
}

if (typeof window !== 'undefined') {
	window.RiggerText = api;
}

export default api;
