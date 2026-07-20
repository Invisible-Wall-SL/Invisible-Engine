/**
 * Invisible Flipbook — the cocos2d **animation plist** (design doc `invisible-flipbook.md`).
 *
 * This is the file that actually STATES an animation, and it is a different thing from the
 * sprite-sheet plist people usually mean. A sheet plist (`frames` + `metadata`) is a texture
 * index: name → rect, unordered by definition. An ANIMATION plist (`animations` + `properties`,
 * loaded by cocos2d's `AnimationCache::addAnimationsWithFile`) names an ordered list of sprite
 * frames plus its timing — so it can repeat a frame (a HOLD), run frames out of numeric order,
 * and carry a real frame rate. Everything filename-based sequence detection can only guess at.
 *
 * We read AND write it, because it is a format this project ships with the game, not just an
 * import path. A file we emit must stay loadable by a stock cocos2d runtime.
 *
 * ## Extending it
 *
 * `AnimationCache` reads exactly `frames`, `delayPerUnit`, `loops` and `restoreOriginalFrame`,
 * and ignores every other key. So our extensions live IN the file under an `iw` prefix rather
 * than in a sidecar — same spirit as the Rigger's `.irig` (a pure Spine JSON any runtime eats,
 * with our extras kept where Spine ignores them), but without a second file to keep in sync.
 * Unknown keys we did not write are PRESERVED on round-trip, so another tool's extensions
 * survive a pass through ours.
 *
 * Deliberately hand-rolled XML: this package is dependency-free so it stays Node-resolvable for
 * fixtures, and the plist subset in play is tiny and fully enumerated below. The parser is
 * strict — it refuses what it does not understand rather than guessing, because a
 * silently-misread animation is exactly the failure this whole feature exists to prevent.
 */

import type { FlipbookClip } from './types';

/** `properties.format` we read and write. cocos2d's version-2 animation format. */
export const ANIMATION_PLIST_FORMAT = 2;

/** Our extension namespace. `AnimationCache` ignores these; humans can see they are ours. */
const IW_PREFIX = 'iw';
/** Explicit loop flag. cocos's `loops` is a play COUNT with no agreed "forever" value, so a
 * round-trip through it is lossy; we record the author's intent alongside it. */
const IW_LOOP = 'iwLoop';
/** The clip id, so a re-import updates the same clip instead of creating a duplicate. */
const IW_ID = 'iwId';
/** Per-frame source sheets, `<index>=<assetKey>`, for a clip spanning a multipacked atlas.
 * cocos resolves frame names globally from its sprite-frame cache, so it does not need this —
 * but our runtime scopes textures per sheet, and a 4-page animation is otherwise ambiguous. */
const IW_SHEETS = 'iwFrameSheets';

export interface PlistAnimation {
	name: string;
	/** Sprite-frame names VERBATIM, in play order. May repeat; need not be monotonic. */
	frames: string[];
	/** Seconds per frame. */
	delayPerUnit: number;
	/** cocos play count. */
	loops: number;
	restoreOriginalFrame: boolean;
	/** Keys we did not author, kept so another tool's extensions survive a round-trip. */
	extra: Record<string, PlistValue>;
}

export interface AnimationPlistDoc {
	animations: PlistAnimation[];
	/** `properties.spritesheets` — the sheet plists whose frames these animations name. */
	spritesheets: string[];
	format: number;
}

export type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

export class AnimationPlistError extends Error {}

// ---------------------------------------------------------------------------
// Minimal plist XML reader. Supported: dict, array, string, integer, real,
// true, false, key. Anything else is refused rather than guessed at.
// ---------------------------------------------------------------------------

interface Cursor {
	s: string;
	i: number;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};

function decodeText(raw: string): string {
	return raw.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e: string) => {
		if (e[0] === '#') {
			const code =
				e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e] ?? m;
	});
}

function skipJunk(c: Cursor): void {
	for (;;) {
		const before = c.i;
		while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++;
		if (c.s.startsWith('<!--', c.i)) {
			const end = c.s.indexOf('-->', c.i);
			c.i = end === -1 ? c.s.length : end + 3;
		} else if (c.s.startsWith('<?', c.i) || c.s.startsWith('<!', c.i)) {
			const end = c.s.indexOf('>', c.i);
			c.i = end === -1 ? c.s.length : end + 1;
		}
		if (c.i === before) return;
	}
}

/** Read the next tag: `{name, closing, selfClosing}`. */
function readTag(c: Cursor): { name: string; closing: boolean; selfClosing: boolean } {
	skipJunk(c);
	if (c.s[c.i] !== '<') throw new AnimationPlistError(`expected a tag at offset ${c.i}`);
	const end = c.s.indexOf('>', c.i);
	if (end === -1) throw new AnimationPlistError('unterminated tag');
	const raw = c.s.slice(c.i + 1, end).trim();
	c.i = end + 1;
	const closing = raw.startsWith('/');
	const selfClosing = raw.endsWith('/');
	const name = raw.replace(/^\//, '').replace(/\/$/, '').trim().split(/\s/)[0];
	return { name, closing, selfClosing };
}

function readTextUntilClose(c: Cursor, tag: string): string {
	const close = `</${tag}`;
	const at = c.s.indexOf(close, c.i);
	if (at === -1) throw new AnimationPlistError(`unterminated <${tag}>`);
	const text = c.s.slice(c.i, at);
	c.i = c.s.indexOf('>', at) + 1;
	return decodeText(text);
}

function parseValue(c: Cursor, tag: { name: string; selfClosing: boolean }): PlistValue {
	switch (tag.name) {
		case 'true':
			if (!tag.selfClosing) readTextUntilClose(c, 'true');
			return true;
		case 'false':
			if (!tag.selfClosing) readTextUntilClose(c, 'false');
			return false;
		case 'string':
			return tag.selfClosing ? '' : readTextUntilClose(c, 'string');
		case 'integer':
		case 'real': {
			if (tag.selfClosing) return 0;
			const n = Number(readTextUntilClose(c, tag.name).trim());
			if (!Number.isFinite(n)) throw new AnimationPlistError(`<${tag.name}> is not a number`);
			return n;
		}
		case 'array': {
			const out: PlistValue[] = [];
			if (tag.selfClosing) return out;
			for (;;) {
				const t = readTag(c);
				if (t.closing && t.name === 'array') return out;
				if (t.closing) throw new AnimationPlistError(`unexpected </${t.name}> inside <array>`);
				out.push(parseValue(c, t));
			}
		}
		case 'dict': {
			const out: Record<string, PlistValue> = {};
			if (tag.selfClosing) return out;
			for (;;) {
				const t = readTag(c);
				if (t.closing && t.name === 'dict') return out;
				if (t.name !== 'key') throw new AnimationPlistError(`expected <key>, saw <${t.name}>`);
				const key = t.selfClosing ? '' : readTextUntilClose(c, 'key');
				const vt = readTag(c);
				if (vt.closing) throw new AnimationPlistError(`<key>${key}</key> has no value`);
				out[key] = parseValue(c, vt);
			}
		}
		// `data` and `date` are legal plist but never appear in an animation file; refusing is
		// safer than returning something the caller might treat as a frame name.
		default:
			throw new AnimationPlistError(`unsupported plist element <${tag.name}>`);
	}
}

const isRecord = (v: unknown): v is Record<string, PlistValue> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse an animation plist. Throws `AnimationPlistError` on anything that is not one —
 * notably a SHEET plist, which is the easy mistake to make and is caught by name.
 */
export function parseAnimationPlist(xml: string): AnimationPlistDoc {
	const c: Cursor = { s: xml, i: 0 };
	let tag = readTag(c);
	if (tag.name === 'plist') tag = readTag(c);
	const root = parseValue(c, tag);
	if (!isRecord(root)) throw new AnimationPlistError('plist root is not a dictionary');

	if (!('animations' in root)) {
		const hint =
			'frames' in root ? ' — this looks like a sprite-SHEET plist, not an animation plist' : '';
		throw new AnimationPlistError(`plist has no 'animations' dictionary${hint}`);
	}
	const animsRaw = root.animations;
	if (!isRecord(animsRaw)) throw new AnimationPlistError("'animations' is not a dictionary");

	const props = isRecord(root.properties) ? root.properties : {};
	const format = typeof props.format === 'number' ? props.format : ANIMATION_PLIST_FORMAT;
	if (format !== ANIMATION_PLIST_FORMAT) {
		throw new AnimationPlistError(
			`unsupported animation plist format ${format} — only version ${ANIMATION_PLIST_FORMAT} is supported`,
		);
	}
	const spritesheets = Array.isArray(props.spritesheets)
		? props.spritesheets.filter((v): v is string => typeof v === 'string')
		: [];

	const animations: PlistAnimation[] = [];
	for (const [name, raw] of Object.entries(animsRaw)) {
		if (!isRecord(raw)) continue;
		const frames = Array.isArray(raw.frames)
			? raw.frames.filter((f): f is string => typeof f === 'string' && f.length > 0)
			: [];
		const extra: Record<string, PlistValue> = {};
		for (const [k, v] of Object.entries(raw)) {
			if (k !== 'frames' && k !== 'delayPerUnit' && k !== 'loops' && k !== 'restoreOriginalFrame') {
				extra[k] = v;
			}
		}
		animations.push({
			name,
			frames,
			delayPerUnit: typeof raw.delayPerUnit === 'number' ? raw.delayPerUnit : 0,
			loops: typeof raw.loops === 'number' ? raw.loops : 1,
			restoreOriginalFrame: raw.restoreOriginalFrame === true,
			extra,
		});
	}
	animations.sort((a, b) => a.name.localeCompare(b.name));
	return { animations, spritesheets, format };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function writeValue(v: PlistValue, indent: string): string {
	if (typeof v === 'boolean') return `${indent}<${v}/>`;
	if (typeof v === 'number') {
		return Number.isInteger(v) ? `${indent}<integer>${v}</integer>` : `${indent}<real>${v}</real>`;
	}
	if (typeof v === 'string') return `${indent}<string>${esc(v)}</string>`;
	if (Array.isArray(v)) {
		if (v.length === 0) return `${indent}<array/>`;
		return [
			`${indent}<array>`,
			...v.map((x) => writeValue(x, `${indent}\t`)),
			`${indent}</array>`,
		].join('\n');
	}
	const keys = Object.keys(v);
	if (keys.length === 0) return `${indent}<dict/>`;
	return [
		`${indent}<dict>`,
		...keys.flatMap((k) => [`${indent}\t<key>${esc(k)}</key>`, writeValue(v[k], `${indent}\t`)]),
		`${indent}</dict>`,
	].join('\n');
}

/**
 * Serialize to a plist a stock cocos2d `AnimationCache` can load. Our `iw*` keys ride alongside
 * the standard ones, where cocos ignores them.
 */
export function serializeAnimationPlist(doc: AnimationPlistDoc): string {
	const animations: Record<string, PlistValue> = {};
	for (const a of [...doc.animations].sort((x, y) => x.name.localeCompare(y.name))) {
		animations[a.name] = {
			// Our extras FIRST so they read as annotations on the standard block below.
			...a.extra,
			frames: a.frames,
			delayPerUnit: a.delayPerUnit,
			loops: a.loops,
			restoreOriginalFrame: a.restoreOriginalFrame,
		};
	}
	const root: PlistValue = {
		animations,
		properties: {
			format: doc.format || ANIMATION_PLIST_FORMAT,
			spritesheets: doc.spritesheets,
		},
	};
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		writeValue(root, ''),
		'</plist>',
		'',
	].join('\n');
}

// ---------------------------------------------------------------------------
// Conversion to / from our clips
// ---------------------------------------------------------------------------

/** Strip a trailing image extension: cocos names sprite frames `foo.png`, our regions are stems. */
export function frameNameToRegion(name: string): string {
	return name.replace(/\.(png|webp|jpe?g)$/i, '');
}

/** Default when an animation carries no usable `delayPerUnit`. Matches `DEFAULT_FLIPBOOK_FPS`. */
const FALLBACK_FPS = 24;

/**
 * Turn one parsed animation into a clip.
 *
 * `sheets` maps the project's sheets to their region names so each frame can be pinned to the
 * sheet that actually packs it — cocos resolves frame names globally from one sprite-frame
 * cache, but our runtime scopes textures per sheet, so a multipacked animation is ambiguous
 * without this. A frame found on the primary sheet stays a bare name; anything else becomes a
 * scoped `<assetKey>::<region>` ref. A frame no sheet packs is kept VERBATIM as a bare name so
 * it surfaces in the normal dangling-frame report rather than vanishing here.
 */
export function animationToClip(
	anim: PlistAnimation,
	sheets: { assetKey: string; regions: string[] }[],
): FlipbookClip {
	const owner = new Map<string, string>();
	for (const sheet of sheets) {
		for (const region of sheet.regions) if (!owner.has(region)) owner.set(region, sheet.assetKey);
	}

	const regions = anim.frames.map(frameNameToRegion);
	// Primary = the sheet holding the most of this animation's frames ⇒ fewest scoped refs.
	const tally = new Map<string, number>();
	for (const r of regions) {
		const key = owner.get(r);
		if (key) tally.set(key, (tally.get(key) ?? 0) + 1);
	}
	let primary = sheets[0]?.assetKey ?? '';
	let best = -1;
	for (const [key, n] of tally) {
		if (n > best) {
			best = n;
			primary = key;
		}
	}

	const frames = regions.map((r) => {
		const key = owner.get(r);
		return key && key !== primary ? `${key}::${r}` : r;
	});

	const iwLoop = anim.extra[IW_LOOP];
	const iwId = anim.extra[IW_ID];
	return {
		id: typeof iwId === 'string' && iwId ? iwId : anim.name,
		name: anim.name,
		assetKey: primary,
		frames,
		fps: anim.delayPerUnit > 0 ? Math.round((1 / anim.delayPerUnit) * 1000) / 1000 : FALLBACK_FPS,
		// Prefer our explicit flag; otherwise infer, since cocos `loops` is a play COUNT with no
		// agreed "forever" value (exporters commonly write 1 whether or not it loops).
		loop: typeof iwLoop === 'boolean' ? iwLoop : anim.loops > 1,
	};
}

/**
 * Turn a clip back into an animation entry. Frame names are written BARE (extension-less region
 * names): cocos looks frames up in one global cache, so a scoped ref would not resolve there.
 * The per-frame sheet mapping is preserved in our `iwFrameSheets` extension so OUR re-import
 * keeps a multipacked clip intact.
 */
export function clipToAnimation(clip: FlipbookClip, fallbackFps = FALLBACK_FPS): PlistAnimation {
	const fps = clip.fps && clip.fps > 0 ? clip.fps : fallbackFps;
	const sheetOf: Record<string, string> = {};
	const frames = clip.frames.map((entry, i) => {
		const at = entry.indexOf('::');
		if (at > 0 && entry.slice(0, at).endsWith('.json')) {
			sheetOf[String(i)] = entry.slice(0, at);
			return entry.slice(at + 2);
		}
		return entry;
	});
	const extra: Record<string, PlistValue> = { [IW_ID]: clip.id, [IW_LOOP]: clip.loop !== false };
	if (Object.keys(sheetOf).length > 0) extra[IW_SHEETS] = sheetOf;
	return {
		name: clip.name || clip.id,
		frames,
		delayPerUnit: Math.round((1 / fps) * 1e6) / 1e6,
		// ALWAYS 1, even for a looping clip. `loops` is a play COUNT with no agreed "forever"
		// value: 0 is not "infinite", it is zero plays, and a stock runtime handed 0 may render
		// nothing at all. 1 is the value every cocos runtime handles identically, so a file we
		// emit always plays. The author's real intent lives in `iwLoop`, which our runtime reads
		// and cocos ignores — looping in cocos is a runtime concern (`RepeatForever`) anyway.
		loops: 1,
		restoreOriginalFrame: false,
		extra,
	};
}

/** Build a whole document from clips — what the export writes. */
export function clipsToAnimationPlist(
	clips: FlipbookClip[],
	spritesheets: string[] = [],
): AnimationPlistDoc {
	return {
		animations: clips.map((c) => clipToAnimation(c)),
		spritesheets,
		format: ANIMATION_PLIST_FORMAT,
	};
}

export { IW_ID, IW_LOOP, IW_SHEETS, IW_PREFIX };
