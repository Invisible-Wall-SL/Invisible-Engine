/**
 * Inline-image placeholders for a message string.
 *
 * The whole message pipeline is a single STRING (`formatWinText` → `stateMessage` → the info-bar
 * text node), and a sprite can't ride inside a string as a character. So an inline symbol image
 * travels as a private-use SENTINEL the text renderer recognises and swaps for a `<Sprite>`
 * ({@link InlineImageText}). The sentinel carries two things:
 *  - a `token` the game-registered resolver maps to a loaded texture key ({@link registerInlineImageResolver});
 *  - a `fallback` string rendered as plain text when the token can't resolve (no resolver, unknown
 *    symbol, missing art) — so a message never degrades to a blank or a raw id.
 *
 * The sentinel uses Unicode PRIVATE-USE-AREA code points (U+E000..U+E002), which never occur in
 * real copy, so {@link hasInlineImage} is a safe, cheap gate: a string with no sentinel is
 * byte-identical to today and renders through the unchanged plain-text path (parity). They are
 * built with `String.fromCharCode` (not a source-literal escape) so the bytes are unambiguous.
 *
 * Svelte-free + pure, so it lives on the bare `engine-layout` entry alongside `winText.ts` — the
 * game builds the sentinel (`wrapInlineImage`) and the renderer parses it, one source of truth.
 */

const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
const SEP = String.fromCharCode(0xe002);

/** Build the sentinel for one inline image: `token` resolves to a texture, `fallback` is the text
 *  shown if it can't. */
export function wrapInlineImage(token: string, fallback = ''): string {
	return `${OPEN}${token}${SEP}${fallback}${CLOSE}`;
}

export type InlineSegment =
	| { kind: 'text'; value: string }
	| { kind: 'image'; token: string; fallback: string };

/** Cheap gate: does this string carry any inline-image sentinel? False for all authored copy
 *  (parity), so the plain text path is untouched unless the game deliberately emitted one. */
export function hasInlineImage(text: string): boolean {
	return text.includes(OPEN);
}

const PATTERN = new RegExp(`${OPEN}([^${SEP}${CLOSE}]*)${SEP}([^${CLOSE}]*)${CLOSE}`, 'g');

/**
 * Split a string into ordered text / image segments. A malformed / unterminated sentinel is left
 * as literal text (the regex simply doesn't match it), so a stray control char can never crash the
 * renderer — it just shows through.
 */
export function parseInlineImageSegments(text: string): InlineSegment[] {
	const out: InlineSegment[] = [];
	let last = 0;
	PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PATTERN.exec(text)) !== null) {
		if (match.index > last) out.push({ kind: 'text', value: text.slice(last, match.index) });
		out.push({ kind: 'image', token: match[1], fallback: match[2] });
		last = match.index + match[0].length;
	}
	if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
	return out;
}

/** The plain-text form of a string, replacing each image sentinel with its `fallback` — for any
 *  renderer that can't draw a sprite (e.g. the coded HTML `MessageToast`). */
export function stripInlineImage(text: string): string {
	if (!hasInlineImage(text)) return text;
	return parseInlineImageSegments(text)
		.map((seg) => (seg.kind === 'text' ? seg.value : seg.fallback))
		.join('');
}
