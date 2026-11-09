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
	anthropicAgents: ['anthropicagents', 'anthropic(agents)', 'claudeagents'],
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
 * that distinguishes them without knowing the locale up front — except that a comma
 * between groups of three with no dot (`1,234`, `12,345,678`) is thousands: money seldom
 * has three decimals. A group led by `0` (`0,125`) is never thousands. A Unicode minus
 * (`−`, as some dashboards copy it) is a minus.
 */
export function parseAmount(raw: string): number | null {
	const cleaned = raw
		.replace(/−/g, '-')
		.replace(/[$€\s]/g, '')
		.trim();
	if (!cleaned) return null;
	const normalized = /^[-+]?[1-9]\d{0,2}(?:,\d{3})+$/.test(cleaned)
		? cleaned.replace(/,/g, '')
		: cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
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

/**
 * Read the month off the START of a line — `2026-03`, `03/2026`, `Mar 2026`, `marzo 2026`,
 * `May 2026,` — and return it with the rest of the line. Matched on the raw line, not on
 * split fields, so it doesn't matter whether the paste separated "May" from "2026" with the
 * same character it separates the fields with.
 */
function matchMonth(line: string): { year: number; month: number; rest: string } | null {
	// YYYY-MM / YYYY/MM (anything glued on, like a `-01` day, belongs to the same field).
	const iso = line.match(/^(\d{4})[-/](\d{1,2})(?!\d)[^\s,;]*/);
	if (iso) return { year: Number(iso[1]), month: Number(iso[2]), rest: line.slice(iso[0].length) };

	// MM/YYYY
	const slashed = line.match(/^(\d{1,2})[-/](\d{4})(?!\d)[^\s,;]*/);
	if (slashed)
		return {
			year: Number(slashed[2]),
			month: Number(slashed[1]),
			rest: line.slice(slashed[0].length),
		};

	// "March 2026" / "mar. 2026" / "marzo, 2026".
	const named = line.match(/^(\p{L}+)[\s.,;/-]*(\d{4})(?!\d)/u);
	const month = named ? MONTH_NAMES[named[1].toLowerCase()] : undefined;
	const year = named ? Number(named[2]) : 0;
	if (named && month && year >= 2000 && year <= 2200)
		return { year, month, rest: line.slice(named[0].length) };

	return null;
}

/** The word before a thousands comma: `1`, `-12`, `$-1`, `$1,234` (a group of three follows). */
const THOUSANDS_HEAD = /^[-+−]?[$€]?[-+−]?[1-9]\d{0,2}(?:,\d{3})*$/;
/** The word before a decimal comma: `12`, `-12`, `$-12`, `0`, `1234`, `1.234`. */
const DECIMAL_HEAD = /^[-+−]?[$€]?[-+−]?(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)$/;

/**
 * Whether the comma between `before` and `after` sits inside one amount: `1,234.56`,
 * `12,50 €`, `1.234,56`, `$-12,50`, `0,125`, `1234,567`. Only a comma with a digit straight
 * after it: a group of three after a thousands head is thousands, any other digits after a
 * decimal head are decimals unless a `.` follows them (`3,12.50` is two fields). `r2,4`,
 * `12.50,3` and `12, 50` are field separators.
 */
function commaInAmount(before: string, after: string): boolean {
	if (/\s$/.test(before) || !/^\d/.test(after)) return false;
	const head = before.split(/\s+/).pop() ?? '';
	const digits = /^\d+/.exec(after)?.[0].length ?? 0;
	if (THOUSANDS_HEAD.test(head) && digits === 3) return true;
	return DECIMAL_HEAD.test(head) && !/^\.\d/.test(after.slice(digits));
}

/**
 * Split what follows the month into fields: on tabs, runs of two-plus spaces and `;`. Commas
 * separate fields only when that leaves a single field and the whole line has at least three
 * comma-separated parts (`commaSeparated`, the month, provider and amount) — and then not a
 * comma inside an amount (`commaInAmount`). So a tab- or space-separated amount is never split.
 */
function splitFields(rest: string, commaSeparated: boolean): string[] {
	const fields = rest
		.split(/\t|\s{2,}|;/)
		.map((f) => f.trim().replace(/,+$/, ''))
		.filter((f) => /[^\s,]/.test(f));
	if (fields.length !== 1 || !commaSeparated) return fields;
	const pieces: string[] = [];
	for (const piece of fields[0].split(',')) {
		const last = pieces.length - 1;
		if (last >= 0 && commaInAmount(pieces[last], piece)) pieces[last] += `,${piece}`;
		else pieces.push(piece);
	}
	return pieces.map((p) => p.trim()).filter(Boolean);
}

/**
 * The provider and amount among `pieces` (fields, or single words when the paste used single
 * spaces): the provider is the first piece naming one; the amount is the last OTHER piece that
 * parses as money.
 */
function readFields(pieces: string[]): { provider: ProviderId | null; usd: number | null } {
	const providerIndex = pieces.findIndex((p) => matchProvider(p) != null);
	const provider = providerIndex >= 0 ? matchProvider(pieces[providerIndex]) : null;
	let usd: number | null = null;
	for (let i = pieces.length - 1; i >= 0 && usd == null; i--) {
		if (i !== providerIndex) usd = parseAmount(pieces[i]);
	}
	return { provider, usd };
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

		const month = matchMonth(line);
		if (!month) {
			errors.push(`Couldn't read a month from: "${line}"`);
			continue;
		}
		if (month.month < 1 || month.month > 12) {
			errors.push(`Month out of range in: "${line}"`);
			continue;
		}

		// Whole fields first (keeps "Cloudflare R2" or "$ 1 234,56" in one piece); a line
		// separated by single spaces is one field, so fall back to its words.
		const commaSeparated = line.split(',').filter((t) => t.trim()).length >= 3;
		const fields = splitFields(month.rest, commaSeparated);
		const byField = readFields(fields);
		const byWord = readFields(fields.flatMap((f) => f.split(/\s+/)));
		const provider = byField.provider ?? byWord.provider;
		if (!provider) {
			errors.push(`Couldn't read a provider from: "${line}"`);
			continue;
		}

		const usd = byField.provider ? (byField.usd ?? byWord.usd) : byWord.usd;
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
