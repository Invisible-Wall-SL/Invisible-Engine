// Verify that win text NAMES the symbol that paid instead of counting it ("4 Bananas", never
// "4 of a kind") — the Invisible Win Text × Invisible Symbols contract.
//
//   node scripts/test-win-text-symbol-names.mjs
//
// Same esbuild-bundle trick as test-tap-to-continue.mjs: the monorepo consumes packages as raw
// TS, so bundle the pure-data modules (no `.svelte`) into one ESM file Node can execute, then
// assert their behaviour against the REAL modules the game and both tools import.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			WIN_TEXT_DEFAULTS,
			resolveWinText,
			resolveToastTemplate,
			resolveWinLineMessage,
			resolveSymbolName,
			hasSymbolNames,
			formatWinText,
			collectWinTextTemplates,
			registerTextResolver,
			clearTextResolver,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-win-text-symbol-names.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `win-text-names-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};

const NAMES = {
	H1: { singular: 'Banana', plural: 'Bananas' },
	H2: { singular: 'Wild' }, // no plural — must reuse the singular, not invent "Wilds"
	S: { singular: 'Book', plural: 'Books' },
};

// --- resolveSymbolName: inflection + fallbacks -------------------------------
console.info('resolveSymbolName');
assert(mod.resolveSymbolName(NAMES, 'H1', 1) === 'Banana', 'count 1 uses the singular');
assert(mod.resolveSymbolName(NAMES, 'H1', 4) === 'Bananas', 'count > 1 uses the plural');
assert(mod.resolveSymbolName(NAMES, 'H1', 0) === 'Bananas', 'count 0 is plural, not singular');
assert(
	mod.resolveSymbolName(NAMES, 'H1') === 'Banana',
	'an unknown count uses the singular (never a guessed plural)',
);
assert(
	mod.resolveSymbolName(NAMES, 'H2', 3) === 'Wild',
	'an unset plural falls back to the singular rather than appending an s',
);
assert(
	mod.resolveSymbolName(NAMES, 'L4', 3) === 'L4',
	'an UNNAMED symbol falls back to its own id — visible, never a blank or undefined',
);
assert(mod.resolveSymbolName(undefined, 'H1', 3) === 'H1', 'no names doc at all ⇒ the id');
assert(
	mod.resolveSymbolName({ H1: { singular: '   ' } }, 'H1', 1) === 'H1',
	'a whitespace-only name is not a name',
);
assert(!mod.hasSymbolNames({}) && mod.hasSymbolNames(NAMES), 'hasSymbolNames tracks emptiness');

// --- the defaults say a WORD, not jargon -------------------------------------
console.info('defaults');
const d = mod.WIN_TEXT_DEFAULTS.toast;
assert(
	![d.full, d.amountOnly, d.countOnly].some((t) => /of a kind/i.test(t)),
	'NO default toast template contains "of a kind"',
);
assert(d.full.includes('{symbolName}'), 'the full toast names the symbol');
assert(d.countOnly.includes('{symbolName}'), 'the count-only toast names the symbol');
assert(
	!d.amountOnly.includes('{symbolName}'),
	'the amount-only toast names no symbol (it has none)',
);

// --- branch selection requires a symbol before it speaks a count -------------
console.info('resolveToastTemplate');
const resolved = mod.resolveWinText(undefined);
assert(
	mod.resolveToastTemplate(resolved, { amount: '$4.00', count: 4, symbolName: 'Bananas' }) ===
		resolved.toast.full,
	'amount + count + name ⇒ the full sentence',
);
assert(
	mod.resolveToastTemplate(resolved, { amount: '$4.00', count: 4 }) === resolved.toast.amountOnly,
	'a count with NO symbol falls back to amount-only — never renders a bare {symbolName}',
);
assert(
	mod.resolveToastTemplate(resolved, { count: 4 }) === undefined,
	'a count alone, with neither amount nor symbol, shows no message at all',
);
assert(
	mod.resolveToastTemplate(resolved, { count: 4, symbolName: 'Bananas' }) ===
		resolved.toast.countOnly,
	'a named symbol with no amount ⇒ the count-only sentence',
);
assert(mod.resolveToastTemplate(resolved, {}) === undefined, 'nothing known ⇒ no message');

// --- the whole sentence, end to end -----------------------------------------
console.info('formatWinText');
const say = (count, symbol) => {
	const vars = {
		amount: '$4.00',
		count,
		symbol,
		symbolName: mod.resolveSymbolName(NAMES, symbol, count),
	};
	return mod.formatWinText(mod.resolveToastTemplate(resolved, vars) ?? '', vars);
};
assert(say(4, 'H1') === 'You win $4.00 with 4 Bananas', `4 × H1 ⇒ "${say(4, 'H1')}"`);
assert(say(1, 'H1') === 'You win $4.00 with 1 Banana', `1 × H1 ⇒ "${say(1, 'H1')}"`);
assert(say(3, 'L4') === 'You win $4.00 with 3 L4', 'an unnamed symbol still forms a full sentence');

// --- localize the TEMPLATE, then interpolate — and localize the NAME at source
console.info('localization order');
mod.registerTextResolver(
	(key) =>
		({
			'You win {amount} with {count} {symbolName}': 'Ganas {amount} con {count} {symbolName}',
			Bananas: 'Plátanos',
		})[key],
);
const localised = say(4, 'H1');
assert(localised === 'Ganas $4.00 con 4 Plátanos', `translated ⇒ "${localised}"`);
assert(
	mod.formatWinText('{count} {symbolName}', { count: 2 }) === '2 {symbolName}',
	'an absent value renders its token verbatim rather than "undefined" (a typo must never crash a live game)',
);
mod.clearTextResolver();

// --- free-spin RETRIGGER sentence ("You won +N Extra Free Spins") ------------
console.info('free spins retrigger');
assert(
	mod.WIN_TEXT_DEFAULTS.freeSpins.retrigger === 'You won +{count} Extra Free Spins',
	'the retrigger default is the "+{count}" celebration sentence',
);
assert(
	mod.resolveWinText(undefined).freeSpins.retrigger === 'You won +{count} Extra Free Spins',
	'an unauthored doc resolves the retrigger default',
);
assert(
	mod.resolveWinText({ freeSpins: { retrigger: 'Nice — {count} more spins!' } }).freeSpins
		.retrigger === 'Nice — {count} more spins!',
	'an authored retrigger template overrides the default',
);
assert(
	mod.formatWinText(mod.resolveWinText(undefined).freeSpins.retrigger, { count: 10 }) ===
		'You won +10 Extra Free Spins',
	'the retrigger sentence interpolates the extra-spins count',
);
// localize the TEMPLATE first, THEN interpolate — the number sits inside the translated sentence.
mod.registerTextResolver(
	(key) => ({ 'You won +{count} Extra Free Spins': 'Has ganado +{count} giros gratis extra' })[key],
);
assert(
	mod.formatWinText(mod.resolveWinText(undefined).freeSpins.retrigger, { count: 10 }) ===
		'Has ganado +10 giros gratis extra',
	'the retrigger sentence localizes the template, then drops the number into the translation',
);
mod.clearTextResolver();

// --- harvest labels carry no jargon either -----------------------------------
console.info('harvest');
const harvested = mod.collectWinTextTemplates({
	lineMessage: { byCount: { 3: '{count} {symbolName}' } },
	toast: { full: 'You win {amount} with {count} {symbolName}' },
});
assert(!harvested.some((h) => /of a kind/i.test(h.label)), 'no harvest label says "of a kind"');
assert(
	harvested.every((h) => h.key === h.source),
	'the harvest key IS the untrimmed source text (the resolver looks up by literal)',
);
assert(
	new Set(harvested.map((h) => h.source)).size === harvested.length,
	'harvest de-duplicates — a countOnly default equal to a byCount template appears once',
);
// The retrigger sentence has a coded default, so it is harvested even when never retyped (like the
// toasts) — otherwise the built-in retrigger copy could never be translated.
assert(
	harvested.some((h) => h.source === 'You won +{count} Extra Free Spins'),
	'the retrigger default is harvested for translation even when the author never retyped it',
);

console.info(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
