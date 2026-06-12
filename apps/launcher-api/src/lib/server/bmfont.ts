import { error } from '@sveltejs/kit';
import type { FontDescriptorFormat } from 'engine-layout';

/**
 * Minimal, dependency-free BMFont descriptor parser used by `POST /api/fonts/save`
 * to stay AUTHORITATIVE: the server re-reads the just-uploaded descriptor bytes
 * from R2 and re-derives the family `face` + the `<page file>` refs itself, so it
 * never trusts a client-supplied `name`/`pageFiles`.
 *
 * Three dialects, matching `FontDescriptorFormat`:
 * - `xml` / `fnt`: BMFont text/AngelCode. In both, `face` lives on `<info face="…">`
 *   and ONLY `<page file="…">` carries a `file` attribute, so a single `file="…"`
 *   scan is safe. (The `.fnt` dialect is the same key=value grammar quoted.)
 * - `json`: pixi's BMFont JSON dialect — `info.face` (or `data.info.face`) + a
 *   `pages` string array.
 */
export interface ParsedBmfont {
	face: string;
	pageFiles: string[];
}

/** Throwable 400 — surfaces as a clean client error rather than a 500. */
function bad(message: string): never {
	throw error(400, message);
}

function dedupe(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		if (v && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out;
}

function parseTextBmfont(text: string): ParsedBmfont {
	const faceMatch = text.match(/face\s*=\s*"([^"]+)"/);
	const face = faceMatch?.[1]?.trim() ?? '';
	if (!face) bad('Descriptor has no `<info face>` — not a valid BMFont file.');

	const pageFiles: string[] = [];
	const fileRe = /\bfile\s*=\s*"([^"]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = fileRe.exec(text)) !== null) {
		const file = m[1]?.trim();
		if (file) pageFiles.push(file);
	}
	const pages = dedupe(pageFiles);
	if (pages.length === 0) bad('Descriptor declares no `<page file>` images.');
	return { face, pageFiles: pages };
}

function parseJsonBmfont(text: string): ParsedBmfont {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return bad('Descriptor is not valid JSON.');
	}
	const obj = (data ?? {}) as Record<string, unknown>;
	const inner = (obj.data ?? obj) as Record<string, unknown>;
	const info = (inner.info ?? {}) as Record<string, unknown>;
	const face = typeof info.face === 'string' ? info.face.trim() : '';
	if (!face) bad('JSON descriptor has no `info.face`.');

	const rawPages = inner.pages;
	if (!Array.isArray(rawPages)) bad('JSON descriptor has no `pages` array.');
	const pages = dedupe(
		(rawPages as unknown[]).filter((p): p is string => typeof p === 'string').map((p) => p.trim()),
	);
	if (pages.length === 0) bad('JSON descriptor declares no page images.');
	return { face, pageFiles: pages };
}

/** Parse a BMFont descriptor's bytes → `{ face, pageFiles }`. Throws a 400 on garbage. */
export function parseBmfontDescriptor(text: string, format: FontDescriptorFormat): ParsedBmfont {
	if (format === 'json') return parseJsonBmfont(text);
	return parseTextBmfont(text);
}
