import type { AnalystElement, AnalystSwatch, ElementStatus } from './schema.ts';

/**
 * Code has the final word (ADR-0005 "Conflict handling", "Palette"). The model proposes; these pure
 * rules decide, in three verdicts, each on the template's facts and never on the model's claim:
 *
 * - **clash** — a rule ABOUT the element (its pattern matches the tokens of the element's name or
 *   its proposed regions) finds the locked item's facts confirm the clash: `left_out`, naming the
 *   item, whatever the model said;
 * - **cleared** — a rule about the element finds the facts clear it: the model's `left_out` or
 *   `lockedItem` claim is dismissed and the element is matched as its regions allow;
 * - **unjudged** — no rule is about the element, or the template carries no facts for it: a claim
 *   the model made (a `left_out`, or a named `lockedItem`) is capped at `needs_you`, for a person.
 *   The model naming a locked item is never a verdict, and never makes a rule fire;
 * - a `matched` claim holds only for region names the template really has; an unknown region
 *   (or no region at all) is `needs_you`;
 * - a palette colour the image's k-means does not support is dropped.
 */

export interface LockedItem {
	id: string;
	label: string;
	/** What the template's config says, as `gamemaker.get_template` describes it. */
	detail: string;
	/** The same facts as data (`templates.ts` `LockedItem.facts`); a rule decides on these. */
	facts?: { betModes?: { id: string; buyBonus: boolean }[] };
}

/** What a rule read off the template's facts about an element; null when the facts are missing. */
export type RuleVerdict =
	/** The facts confirm the clash: the element is left out, naming the item. */
	| { verdict: 'clash'; item: LockedItem }
	/** The facts clear it: the element does not depend on the locked item on this template. */
	| { verdict: 'cleared'; item: LockedItem }
	| null;

export interface LockedRule {
	id: string;
	/** Elements this rule is about, matched anywhere in `tokens()` of the name and regions. */
	element: RegExp;
	/** What this template's facts say about such an element; null when it carries none to read. */
	judge: (locked: LockedItem[]) => RuleVerdict;
}

/**
 * A name or region as words: `BuyBonusButton`, `buy_button` and `bonus-buy` read as "buy bonus
 * button", "buy button" and "bonus buy", so a rule's pattern meets a control however it is spelled.
 * A join with no boundary at all (`buybonus`, `featurebuy`) stays one word, which is why the
 * patterns match inside a word rather than whole words.
 */
export const tokens = (text: string): string =>
	text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/[^A-Za-z0-9]+/g, ' ')
		.trim()
		.toLowerCase();

/**
 * The font of a catalogue a style note names, or null: every word of the font's name, in order and
 * as whole words, inside the note's words (so "Cinzel Decorative, carved" names `CinzelDecorative`
 * and "carved serif capitals" names nothing). Conservative on purpose: a gap dropped for a font
 * the mockup does not use would hide a font the owner needs, while a gap kept for a font the
 * project has costs one line in the review. A name shorter than three letters is never matched.
 */
export function catalogueFontNamed<F extends { name: string }>(
	styleNote: string,
	fonts: readonly F[],
): F | null {
	const note = ` ${tokens(styleNote)} `;
	for (const font of fonts) {
		const name = tokens(font.name);
		if (name.length >= 3 && note.includes(` ${name} `)) return font;
	}
	return null;
}

/**
 * The rules. Each names the template fact it reads, so a false `left_out` can be traced to one line.
 * A buy / purchase control needs a bet mode with `buyBonus` — the FLAG, never the mode's name
 * (`scatter.json` buys through a mode called `bonus`). A template whose facts are missing cannot
 * confirm a clash, nor clear one, so no rule decides on it: code forces or dismisses a `left_out`
 * only on evidence.
 */
export const LOCKED_RULES: LockedRule[] = [
	{
		id: 'buy_without_buy_mode',
		element: /buy|purchase/,
		judge: (locked) => {
			const item = locked.find((l) => l.id === 'bet_modes');
			const modes = item?.facts?.betModes;
			if (!item || !Array.isArray(modes)) return null;
			return modes.some((m) => m.buyBonus === true)
				? { verdict: 'cleared', item }
				: { verdict: 'clash', item };
		},
	},
];

/**
 * The rules' verdict on `element`: a clash with a locked item, a clearance by the template's facts,
 * or null when no rule could judge it. Only a rule ABOUT the element is tried — its pattern matches
 * the tokens of the element's name or of a region it proposes, so a renamed control ("Shop") still
 * meets the rule through a region such as `buy_button`. The locked item the model itself named is
 * not read here: evidence about buy controls says nothing about some other control the model tied
 * to the same item. A clash from any rule wins.
 */
export function judgeLocked(
	element: Pick<AnalystElement, 'name' | 'regions'>,
	locked: LockedItem[],
): RuleVerdict {
	const text = tokens([element.name, ...element.regions].join(' '));
	let cleared: RuleVerdict = null;
	for (const rule of LOCKED_RULES) {
		if (!rule.element.test(text)) continue;
		const verdict = rule.judge(locked);
		if (verdict?.verdict === 'clash') return verdict;
		cleared ??= verdict;
	}
	return cleared;
}

export interface CodedElement {
	n: number;
	box: AnalystElement['box'];
	name: string;
	/** Canonical template region names, as the catalogue spells them. */
	regions: string[];
	status: ElementStatus;
	reason: string;
	lockedItem: { id: string; label: string } | null;
}

export interface RuleContext {
	/** Lower-cased region name → the catalogue's spelling. */
	regions: Map<string, string>;
	locked: LockedItem[];
	image: { w: number; h: number };
}

export const regionIndex = (names: Iterable<string>): Map<string, string> =>
	new Map([...names].map((n) => [n.toLowerCase(), n]));

/** `box` clamped inside the image; null when nothing of it is inside. */
function clamp(box: AnalystElement['box'], w: number, h: number): AnalystElement['box'] | null {
	const x0 = Math.max(0, Math.min(w, box.x));
	const y0 = Math.max(0, Math.min(h, box.y));
	const x1 = Math.max(0, Math.min(w, box.x + box.w));
	const y1 = Math.max(0, Math.min(h, box.y + box.h));
	if (x1 <= x0 || y1 <= y0) return null;
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const MATH_NOTE = 'Math changes are made by a person in Invisible Game Config, outside Director.';

/** Apply every rule to one image's elements; the result is renumbered 1…n in the model's order. */
export function applyCodeRules(elements: AnalystElement[], ctx: RuleContext): CodedElement[] {
	const out: CodedElement[] = [];
	for (const el of elements) {
		const box = clamp(el.box, ctx.image.w, ctx.image.h);
		if (!box) continue;
		const judged = judgeLocked(el, ctx.locked);
		if (judged?.verdict === 'clash') {
			const { item } = judged;
			out.push({
				n: out.length + 1,
				box,
				name: el.name,
				regions: [],
				status: 'left_out',
				reason: `Clashes with the locked ${item.label.toLowerCase()} (${item.detail}). ${MATH_NOTE}`,
				lockedItem: { id: item.id, label: item.label },
			});
			continue;
		}
		const known: string[] = [];
		const unknown: string[] = [];
		for (const r of el.regions) {
			const canonical = ctx.regions.get(r.toLowerCase());
			if (canonical && !known.includes(canonical)) known.push(canonical);
			else if (!canonical) unknown.push(r);
		}
		const notes: string[] = [];
		if (unknown.length)
			notes.push(`no region ${unknown.map((u) => `"${u}"`).join(', ')} in the template`);
		// The model asserts a clash when it says `left_out` or names a locked item. The claim is
		// dismissed only on evidence — a rule about the element read the template's facts and found
		// no clash with the item the model named (or the model named none); otherwise nobody here
		// can confirm or deny it, and a person decides.
		const claim = el.status === 'left_out' || el.lockedItem !== null;
		const dismissed =
			claim &&
			judged?.verdict === 'cleared' &&
			(el.lockedItem === null || el.lockedItem === judged.item.id);
		if (claim) {
			notes.push(
				dismissed
					? `the analyst saw a clash with the ${judged.item.label.toLowerCase()}, but the template's ${judged.item.label.toLowerCase()} (${judged.item.detail}) allow it`
					: `the analyst saw a clash with ${el.lockedItem ?? 'a locked item'}; nothing locked in the template confirms it, so it is your call`,
			);
		}
		// Code never promotes a `needs_you`: a `matched` claim (or a dismissed clash) holds only for
		// real regions, and the model's own `needs_you` stays `needs_you` even when it also listed
		// a region.
		const status: ElementStatus =
			!(claim && !dismissed) && el.status !== 'needs_you' && known.length > 0
				? 'matched'
				: 'needs_you';
		const reason = [el.reason, ...notes].filter(Boolean).join(' — ');
		out.push({
			n: out.length + 1,
			box,
			name: el.name,
			regions: status === 'matched' ? known : [],
			status,
			reason: status === 'needs_you' && !reason ? 'No template region fits this element.' : reason,
			lockedItem: null,
		});
	}
	return out;
}

const hexToRgb = (hex: string): [number, number, number] => [
	parseInt(hex.slice(1, 3), 16),
	parseInt(hex.slice(3, 5), 16),
	parseInt(hex.slice(5, 7), 16),
];

/**
 * The "redmean" approximation of perceptual distance between two sRGB colours
 * (https://www.compuphase.com/cmetric.htm): 0 for equal, ~765 for black vs white.
 */
export function colorDistance(a: string, b: string): number {
	const [r1, g1, b1] = hexToRgb(a);
	const [r2, g2, b2] = hexToRgb(b);
	const rMean = (r1 + r2) / 2;
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

/** How far a proposed swatch may sit from the nearest k-means centre and still count as present. */
export const PALETTE_TOLERANCE = 64;
export const MAX_PALETTE = 8;

export interface PaletteCheck {
	kept: AnalystSwatch[];
	dropped: { name: string; hex: string; nearest: string | null; distance: number }[];
}

/**
 * Keep a proposed colour only when some image's dominant colours support it. Duplicates (same hex,
 * any case) keep their first name; at most {@link MAX_PALETTE} survive, in the order proposed.
 */
export function verifyPalette(
	proposed: AnalystSwatch[],
	support: { hex: string }[][],
	tolerance = PALETTE_TOLERANCE,
): PaletteCheck {
	const centres = support.flat().map((c) => c.hex.toUpperCase());
	const kept: AnalystSwatch[] = [];
	const dropped: PaletteCheck['dropped'] = [];
	const seen = new Set<string>();
	for (const swatch of proposed) {
		const hex = swatch.hex.toUpperCase();
		if (seen.has(hex)) continue;
		seen.add(hex);
		let nearest: string | null = null;
		let distance = Infinity;
		for (const c of centres) {
			const d = colorDistance(hex, c);
			if (d < distance) {
				distance = d;
				nearest = c;
			}
		}
		if (nearest !== null && distance <= tolerance && kept.length < MAX_PALETTE) {
			kept.push({ name: swatch.name, hex });
		} else {
			dropped.push({ name: swatch.name, hex, nearest, distance: Math.round(distance) });
		}
	}
	return { kept, dropped };
}
