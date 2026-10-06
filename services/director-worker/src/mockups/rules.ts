import type { AnalystElement, AnalystSwatch, ElementStatus } from './schema.ts';

/**
 * Code has the final word (ADR-0005 "Conflict handling", "Palette"). The model proposes; these pure
 * rules decide:
 *
 * - an element tied to a LOCKED item is `left_out` and names the item — the model's own `left_out`
 *   claim counts for nothing: a rule fires whatever the model said, and a rule that reads the
 *   template's facts and finds NO clash dismisses the claim, so the element is matched as its
 *   regions allow. The template's facts decide either way; a claim no rule can judge (no rule for
 *   it, or a template without the facts) is `needs_you`, for a person;
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
	/** The locked item this rule guards; the model naming it in `lockedItem` makes the rule run. */
	lockedItemId: string;
	/** Elements this rule is about, by their name and proposed regions. */
	element: RegExp;
	/** What this template's facts say about such an element; null when it carries none to read. */
	judge: (locked: LockedItem[]) => RuleVerdict;
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
		lockedItemId: 'bet_modes',
		element: /\b(buy|purchase|bonus buy|feature buy)\b/i,
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
 * or null when no rule could judge it. A rule is tried when its pattern matches the element's name,
 * any region it proposes, or the locked item the model itself named — the model's `lockedItem` is
 * a reason to EVALUATE a rule, never a verdict — so a renamed control ("Shop", "Get bonus") still
 * meets the rule through its region or the model's own claim. A clash from any rule wins. A
 * clearance counts only from a rule whose pattern matched the element: the model naming an item
 * makes the rule run, but evidence about buy controls says nothing about some other control the
 * model tied to the same item.
 */
export function judgeLocked(
	element: Pick<AnalystElement, 'name' | 'regions' | 'lockedItem'>,
	locked: LockedItem[],
): RuleVerdict {
	const text = [element.name, ...element.regions].join(' ');
	let cleared: RuleVerdict = null;
	for (const rule of LOCKED_RULES) {
		const about = rule.element.test(text);
		const named = element.lockedItem !== null && rule.lockedItemId === element.lockedItem;
		if (!about && !named) continue;
		const verdict = rule.judge(locked);
		if (verdict?.verdict === 'clash') return verdict;
		if (about) cleared ??= verdict;
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
		// A `left_out` claim is dismissed only on evidence: a rule read the template's facts and
		// found no clash with the item the model named (or the model named none). Otherwise nobody
		// here can confirm or deny the clash, and a person decides.
		const cleared =
			el.status === 'left_out' &&
			judged?.verdict === 'cleared' &&
			(el.lockedItem === null || el.lockedItem === judged.item.id);
		if (el.status === 'left_out') {
			notes.push(
				cleared
					? `the analyst saw a clash with the ${judged.item.label.toLowerCase()}, but the template's ${judged.item.label.toLowerCase()} (${judged.item.detail}) allow it`
					: `the analyst saw a clash with ${el.lockedItem ?? 'a locked item'}; nothing locked in the template confirms it, so it is your call`,
			);
		}
		// Code never promotes a `needs_you`: a `matched` claim (or a dismissed `left_out`) holds only
		// for real regions, and the model's own `needs_you` stays `needs_you` even when it also
		// listed a region.
		const status: ElementStatus =
			(el.status === 'matched' || cleared) && known.length > 0 ? 'matched' : 'needs_you';
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
