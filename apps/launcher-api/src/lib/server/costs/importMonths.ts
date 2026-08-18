/**
 * Bulk import of historical spend, typed off provider invoices or dashboards.
 *
 * The monthly table only becomes useful once there's history behind it — the
 * month-over-month change column and the year totals mean nothing with one row. But
 * no provider can be asked for a past month (RunPod publishes no history at all,
 * Railway is current-cycle only, R2's retention is short), so history can only be
 * entered by hand.
 *
 * Hence: forgiving parsing. Someone transcribing a year of invoices off four
 * dashboards should not also have to satisfy a strict grammar, so this accepts the
 * shapes that transcription actually produces — English or Spanish month names,
 * `YYYY-MM`, `03/2026`, provider names or ids, `$1,234.56` or `1.234,56`, separated by
 * commas, tabs, or runs of spaces. Anything it can't read is reported per line rather
 * than failing the whole paste.
 */

import type { ProviderId } from './types';

export interface ParsedCostRow {
	provider: ProviderId;
	year: number;
	month: number;
	usd: number;
	/** The source line, echoed back so the preview can be checked against the paste. */
	source: string;
}

export interface ParseResult {
	rows: ParsedCostRow[];
	/** One message per line that couldn't be read, with the line quoted. */
	errors: string[];
}

/** Accepted names per provider. Matched case-insensitively, spaces stripped. */
const PROVIDER_ALIASES: Record<ProviderId, string[]> = {
	runpod: ['runpod', 'run-pod', 'gpu'],
	railway: ['railway'],
	r2: ['r2', 'cloudflare', 'cloudflarer2', 'cf', 'cfr2'],
	openai: ['openai', 'open-ai', 'gpt', 'chatgpt'],
	anthropic: ['anthropic', 'claude'],
};

/** English and Spanish month names, full and abbreviated — the two languages this
 *  project's invoices actually arrive in. */
const MONTH_NAMES: Record<string, number> = {
	jan: 1,
	january: 1,
	ene: 1,
	enero: 1,
	feb: 2,
	february: 2,
	febrero: 2,
	mar: 3,
	march: 3,
	marzo: 3,
	apr: 4,
	april: 4,
	abr: 4,
	abril: 4,
	may: 5,
	mayo: 5,
	jun: 6,
	june: 6,
	junio: 6,
	jul: 7,
	july: 7,
	julio: 7,
	aug: 8,
	august: 8,
	ago: 8,
	agosto: 8,
	sep: 9,
	sept: 9,
	september: 9,
	septiembre: 9,
	setiembre: 9,
	oct: 10,
	october: 10,
	octubre: 10,
	nov: 11,
	november: 11,
	noviembre: 11,
	dec: 12,
	december: 12,
	dic: 12,
	diciembre: 12,
};

/**
 * Parse a money amount written either way round: `1,234.56` (English) or `1.234,56`
 * (Spanish). Whichever separator appears LAST is the decimal point — the only rule
 * that distinguishes them without knowing the locale up front.
 */
export function parseAmount(raw: string): number | null {
	const cleaned = raw.replace(/[$€\s]/g, '').trim();
	if (!cleaned) return null;
	const normalized =
		cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
			? cleaned.replace(/\./g, '').replace(',', '.')
			: cleaned.replace(/,/g, '');
	const value = Number(normalized);
	return Number.isFinite(value) ? value : null;
}

function matchProvider(token: string): ProviderId | null {
	const key = token.toLowerCase().replace(/[\s_]/g, '');
	for (const [id, aliases] of Object.entries(PROVIDER_ALIASES)) {
		if (aliases.includes(key)) return id as ProviderId;
	}
	return null;
}

/** `2026-03`, `03/2026`, `Mar 2026`, `marzo 2026` → `{year, month}`. */
function matchMonth(tokens: string[]): { year: number; month: number; used: number } | null {
	const joined = tokens.join(' ');

	// YYYY-MM / YYYY/MM
	const iso = joined.match(/^(\d{4})[-/](\d{1,2})\b/);
	if (iso) return { year: Number(iso[1]), month: Number(iso[2]), used: 1 };

	// MM/YYYY
	const slashed = joined.match(/^(\d{1,2})[-/](\d{4})\b/);
	if (slashed) return { year: Number(slashed[2]), month: Number(slashed[1]), used: 1 };

	// "March 2026" / "mar 2026" / "marzo 2026" — two tokens.
	const name = MONTH_NAMES[(tokens[0] ?? '').toLowerCase().replace(/[.,]/g, '')];
	const year = Number((tokens[1] ?? '').replace(/[^\d]/g, ''));
	if (name && year >= 2000 && year <= 2200) return { year, month: name, used: 2 };

	return null;
}

/**
 * Read a pasted block into rows. Blank lines and anything starting `#` are ignored so
 * a paste can carry comments or headers without being cleaned up first.
 */
export function parseCostImport(text: string): ParseResult {
	const rows: ParsedCostRow[] = [];
	const errors: string[] = [];

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		// Commas double as both a field separator and a thousands separator, so split
		// on tabs and runs of two-plus spaces first; fall back to single commas only
		// when that leaves one field.
		let tokens = line.split(/\t|\s{2,}/).filter(Boolean);
		if (tokens.length < 3) tokens = line.split(/[,;]/).filter((t) => t.trim());
		if (tokens.length < 3) tokens = line.split(/\s+/).filter(Boolean);
		tokens = tokens.map((t) => t.trim());

		const month = matchMonth(tokens);
		if (!month) {
			errors.push(`Couldn't read a month from: "${line}"`);
			continue;
		}
		if (month.month < 1 || month.month > 12) {
			errors.push(`Month out of range in: "${line}"`);
			continue;
		}

		const rest = tokens.slice(month.used);
		const providerToken = rest.find((t) => matchProvider(t) != null);
		const provider = providerToken ? matchProvider(providerToken) : null;
		if (!provider) {
			errors.push(`Couldn't read a provider from: "${line}"`);
			continue;
		}

		// The amount is the last token that parses as a number and isn't the provider.
		const amountToken = [...rest]
			.reverse()
			.find((t) => t !== providerToken && parseAmount(t) != null);
		const usd = amountToken ? parseAmount(amountToken) : null;
		if (usd == null) {
			errors.push(`Couldn't read an amount from: "${line}"`);
			continue;
		}
		if (usd < 0) {
			errors.push(`Negative amount in: "${line}"`);
			continue;
		}

		rows.push({ provider, year: month.year, month: month.month, usd, source: line });
	}

	return { rows, errors };
}
