/** Character-set presets for the Font Maker's Generate tab. */
export type CharsetPreset = 'digits' | 'currency' | 'alphanumeric' | 'ascii' | 'custom';

export const CHARSET_LABELS: Record<CharsetPreset, string> = {
	digits: 'Digits (0-9)',
	currency: 'Currency',
	alphanumeric: 'Alphanumeric',
	ascii: 'ASCII printable',
	custom: 'Custom',
};

const DIGITS = '0123456789';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CURRENCY = '0123456789.,$€£¥¢+- ';

/** Build the de-duped character list for a preset (or the custom textarea). */
export function charsForPreset(preset: CharsetPreset, custom: string): string[] {
	let source: string;
	switch (preset) {
		case 'digits':
			source = DIGITS;
			break;
		case 'currency':
			source = CURRENCY;
			break;
		case 'alphanumeric':
			source = DIGITS + ALPHA;
			break;
		case 'ascii':
			source = asciiPrintable();
			break;
		case 'custom':
			source = custom;
			break;
	}
	return dedupe(Array.from(source));
}

/** `0x20`–`0x7E` inclusive (space through `~`). */
function asciiPrintable(): string {
	let s = '';
	for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
	return s;
}

function dedupe(chars: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const ch of chars) {
		// Drop control chars but keep the space.
		if (ch === '\n' || ch === '\r' || ch === '\t') continue;
		if (!seen.has(ch)) {
			seen.add(ch);
			out.push(ch);
		}
	}
	return out;
}
