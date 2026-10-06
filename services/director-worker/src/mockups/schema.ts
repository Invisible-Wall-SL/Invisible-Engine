/**
 * What the Mockup analyst returns per image (ADR-0005 "Analysis"), as the structured-output schema
 * the model is held to (`output_config.format`) and as the parser that checks the answer again
 * before any code rule reads it — the schema is the model's contract, the parser is ours.
 *
 * `uncoveredRegions` is NOT asked of the model: one call sees one image, so which template regions
 * no mockup covers is computed by code across every image (`analyze.ts`). `region` is a list,
 * because one mockup element often stands for several template regions (four jackpot plaques, a
 * row of symbols), each of which gets the same crop.
 */

export const ELEMENT_STATUSES = ['matched', 'needs_you', 'left_out'] as const;
export type ElementStatus = (typeof ELEMENT_STATUSES)[number];

export interface AnalystBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface AnalystElement {
	n: number;
	box: AnalystBox;
	name: string;
	/** Template region names, exactly as listed; empty when none fits. */
	regions: string[];
	status: ElementStatus;
	reason: string;
	/** The locked item the model believes this clashes with (`math`, `bet_modes`, …), or null. */
	lockedItem: string | null;
}

export interface AnalystSwatch {
	name: string;
	hex: string;
}

export interface AnalystFontGap {
	text: string;
	styleNote: string;
}

export interface AnalystOutput {
	elements: AnalystElement[];
	palette: AnalystSwatch[];
	fontGaps: AnalystFontGap[];
}

const integer = { type: 'integer' } as const;
const string = { type: 'string' } as const;

export const ANALYST_OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['elements', 'palette', 'fontGaps'],
	properties: {
		elements: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['n', 'box', 'name', 'regions', 'status', 'reason', 'lockedItem'],
				properties: {
					n: integer,
					box: {
						type: 'object',
						additionalProperties: false,
						required: ['x', 'y', 'w', 'h'],
						properties: { x: integer, y: integer, w: integer, h: integer },
					},
					name: string,
					regions: { type: 'array', items: string },
					status: { type: 'string', enum: [...ELEMENT_STATUSES] },
					reason: string,
					lockedItem: { anyOf: [string, { type: 'null' }] },
				},
			},
		},
		palette: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'hex'],
				properties: { name: string, hex: string },
			},
		},
		fontGaps: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['text', 'styleNote'],
				properties: { text: string, styleNote: string },
			},
		},
	},
} as const;

export const HEX = /^#[0-9a-fA-F]{6}$/;

export type ParseResult = { ok: true; output: AnalystOutput } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** The answer as our types, or every reason it is not. Never trusts the model's shape. */
export function parseAnalystOutput(value: unknown): ParseResult {
	const errors: string[] = [];
	if (!isRecord(value)) return { ok: false, errors: ['the answer is not an object'] };
	const elements: AnalystElement[] = [];
	if (!Array.isArray(value.elements)) errors.push('elements: not an array');
	else {
		value.elements.forEach((raw, i) => {
			const at = `elements[${i}]`;
			if (!isRecord(raw)) return errors.push(`${at}: not an object`);
			const box = raw.box;
			if (!isRecord(box) || !isInt(box.x) || !isInt(box.y) || !isInt(box.w) || !isInt(box.h)) {
				return errors.push(`${at}.box: expected integer x, y, w, h`);
			}
			if (!isInt(raw.n)) return errors.push(`${at}.n: expected an integer`);
			if (!isStr(raw.name) || !raw.name.trim()) return errors.push(`${at}.name: expected text`);
			if (!Array.isArray(raw.regions) || !raw.regions.every(isStr)) {
				return errors.push(`${at}.regions: expected a list of names`);
			}
			if (!isStr(raw.status) || !(ELEMENT_STATUSES as readonly string[]).includes(raw.status)) {
				return errors.push(`${at}.status: expected one of ${ELEMENT_STATUSES.join(', ')}`);
			}
			if (!isStr(raw.reason)) return errors.push(`${at}.reason: expected text`);
			if (raw.lockedItem !== null && !isStr(raw.lockedItem)) {
				return errors.push(`${at}.lockedItem: expected text or null`);
			}
			elements.push({
				n: raw.n,
				box: { x: box.x, y: box.y, w: box.w, h: box.h },
				name: raw.name.trim(),
				regions: raw.regions.map((r) => r.trim()).filter(Boolean),
				status: raw.status as ElementStatus,
				reason: raw.reason.trim(),
				lockedItem: raw.lockedItem === null ? null : raw.lockedItem.trim() || null,
			});
		});
	}
	const palette: AnalystSwatch[] = [];
	if (!Array.isArray(value.palette)) errors.push('palette: not an array');
	else {
		value.palette.forEach((raw, i) => {
			if (!isRecord(raw) || !isStr(raw.name) || !isStr(raw.hex)) {
				return errors.push(`palette[${i}]: expected { name, hex }`);
			}
			// A malformed hex is the model's slip, not a reason to refuse the whole answer.
			if (HEX.test(raw.hex.trim())) palette.push({ name: raw.name.trim(), hex: raw.hex.trim() });
		});
	}
	const fontGaps: AnalystFontGap[] = [];
	if (!Array.isArray(value.fontGaps)) errors.push('fontGaps: not an array');
	else {
		value.fontGaps.forEach((raw, i) => {
			if (!isRecord(raw) || !isStr(raw.text) || !isStr(raw.styleNote)) {
				return errors.push(`fontGaps[${i}]: expected { text, styleNote }`);
			}
			fontGaps.push({ text: raw.text.trim(), styleNote: raw.styleNote.trim() });
		});
	}
	if (errors.length) return { ok: false, errors };
	return { ok: true, output: { elements, palette, fontGaps } };
}
