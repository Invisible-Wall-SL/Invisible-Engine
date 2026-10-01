// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Hold and Win win-text families (jackpots / respins / feature): the coded defaults are
// the literals the respin presentation drew, an authored field overrides only itself, a jackpot
// tier speaks its own config name until captioned, localize-then-interpolate holds for the new
// tokens, and the Localization harvest lists the families for a Hold and Win project ONLY — every
// other project's harvest is exactly what it was.
//
//   node scripts/test-win-text-hold-and-win.mjs
//
// Same esbuild-bundle trick as test-win-text-symbol-names.mjs: bundle the real modules and assert
// against them.
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
			WIN_TEXT_FEATURE_FIELDS,
			WIN_TEXT_JACKPOT_FIELDS,
			WIN_TEXT_RESPIN_FIELDS,
			resolveWinText,
			formatWinText,
			jackpotCaption,
			specialDisplayName,
			collectorLevelCaption,
			potCaption,
			collectWinTextTemplates,
			registerTextResolver,
			clearTextResolver,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-win-text-hold-and-win.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `win-text-hw-test-${process.pid}.mjs`);
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- defaults = the literals the presentation drew --------------------------
console.info('defaults');
const D = mod.WIN_TEXT_DEFAULTS;
assert(D.jackpots.award === '{jackpot} JACKPOT', 'banked jackpot banner title');
assert(D.jackpots.awardDetail === '{amount}', 'banked jackpot banner detail is the bare amount');
assert(D.jackpots.fullBoardDetail === 'FULL BOARD  {amount}', 'full-board detail (two spaces)');
assert(D.jackpots.coin === '{jackpot}', 'jackpot coin banner is the tier caption');
assert(same(D.jackpots.captions, {}), 'no caption defaults: a tier speaks its config name');
assert(D.respins.counter === 'RESPINS {count}', 'counter reads "RESPINS 3"');
assert(D.respins.award === '{count} RESPINS', 'award reads "3 RESPINS"');
assert(D.respins.reset === 'RESPINS RESET' && D.respins.last === 'LAST RESPIN', 'reset / last');
assert(D.feature.total === 'BONUS WIN {amount}', 'feature total');
assert(D.feature.intro === '' && D.feature.outro === '', 'intro / outro draw nothing by default');
assert(D.feature.instantCollect === 'INSTANT WIN', 'instant collect banner');
assert(D.feature.luckySpin === 'LUCKY SPIN', 'Lucky Spin banner');
assert(D.feature.meterFull === '{meter} ACTIVATED', 'pot-full line');
assert(D.feature.modifiersActive === '{modifiers} ACTIVE', 'pots-bought modifiers toast');
assert(D.feature.modifiersUnlocked === 'UNLOCKED: {modifiers}', 'mystery unlock toast');
assert(
	same(D.feature.specialNames, {
		collector: 'COLLECTOR',
		multiplier: 'MULTIPLIER',
		payer: 'PAYER',
		mystery: 'MYSTERY',
	}),
	'special names are the coded SPECIAL_NAMES',
);
assert(
	same(mod.resolveWinText(undefined).jackpots, D.jackpots) &&
		same(mod.resolveWinText(undefined).respins, D.respins) &&
		same(mod.resolveWinText(undefined).feature, D.feature),
	'an unauthored doc resolves to exactly the defaults',
);
assert(
	mod.WIN_TEXT_JACKPOT_FIELDS.every((f) => typeof D.jackpots[f] === 'string') &&
		mod.WIN_TEXT_RESPIN_FIELDS.every((f) => typeof D.respins[f] === 'string') &&
		mod.WIN_TEXT_FEATURE_FIELDS.every((f) => typeof D.feature[f] === 'string'),
	'every listed field has a string default',
);

// --- resolve: an authored field overrides only itself ------------------------
console.info('resolve');
const authored = mod.resolveWinText({
	jackpots: { award: '¡{jackpot}!', captions: { GRAND: 'GRANDE' } },
	respins: { counter: '{count} LEFT' },
	feature: { total: 'TOTAL {amount}', specialNames: { payer: 'PAYOUT' } },
});
assert(authored.jackpots.award === '¡{jackpot}!', 'authored award wins');
assert(authored.jackpots.coin === '{jackpot}', 'an unauthored sibling keeps its default');
assert(
	authored.respins.counter === '{count} LEFT' && authored.respins.reset === 'RESPINS RESET',
	'respins merge per field',
);
assert(authored.feature.specialNames.payer === 'PAYOUT', 'authored special name');
assert(
	authored.feature.specialNames.collector === 'COLLECTOR',
	'other special names keep defaults',
);
assert(mod.jackpotCaption(authored, 'GRAND') === 'GRANDE', 'a captioned tier reads its caption');
assert(
	mod.jackpotCaption(authored, 'MINI') === 'MINI',
	'an uncaptioned tier reads its config name',
);
assert(
	mod.jackpotCaption(authored, 'MEGA') === 'MEGA',
	'a tier the defaults never heard of still reads',
);
assert(
	mod.specialDisplayName(authored, 'wheel') === 'WHEEL',
	'an unknown special reads its id in capitals',
);

// --- format: localize the template, then interpolate -------------------------
console.info('format');
const resolved = mod.resolveWinText(undefined);
assert(
	mod.formatWinText(resolved.jackpots.award, { jackpot: mod.jackpotCaption(resolved, 'MINI') }) ===
		'MINI JACKPOT',
	'"MINI JACKPOT" — what the presentation drew',
);
assert(
	mod.formatWinText(resolved.respins.counter, { count: 3 }) === 'RESPINS 3',
	'"RESPINS 3" — what the counter drew',
);
assert(
	mod.formatWinText(resolved.feature.modifiersUnlocked, {
		modifiers: ['payer', 'multiplier'].map((k) => mod.specialDisplayName(resolved, k)).join(', '),
	}) === 'UNLOCKED: PAYER, MULTIPLIER',
	'"UNLOCKED: PAYER, MULTIPLIER" — what the mystery toast drew',
);
mod.registerTextResolver(
	(key) =>
		({
			'{jackpot} JACKPOT': 'JACKPOT {jackpot}',
			GRAND: 'GRANDIOSO',
			PAYER: 'PAGADOR',
			'{meter} ACTIVATED': '{meter} ACTIVADO',
		})[key],
);
assert(
	mod.formatWinText(resolved.jackpots.award, { jackpot: mod.jackpotCaption(resolved, 'GRAND') }) ===
		'JACKPOT GRANDIOSO',
	'the template AND the tier name translate, and the translation may move the token',
);
assert(
	mod.formatWinText(resolved.feature.meterFull, {
		meter: mod.specialDisplayName(resolved, 'payer'),
	}) === 'PAGADOR ACTIVADO',
	'the pot-full line translates with the special name translated at its source',
);
mod.clearTextResolver();

// --- the 4f lines: collector levels, wheel, pots ---------------------------------
// Each reproduces the literal the coded presentation drew before it read these templates.
console.info('collector levels, wheel, pots');
const r0 = mod.resolveWinText(undefined);
assert(
	same(
		[2, 3, 4].map((l) => mod.collectorLevelCaption(r0, l)),
		['DOUBLE', 'TRIPLE', '×4'],
	),
	'collector level names: DOUBLE / TRIPLE, an unnamed level ×n',
);
assert(
	mod.formatWinText(r0.feature.collectorLevel, { level: mod.collectorLevelCaption(r0, 2) }) ===
		'DOUBLE COLLECTOR',
	'"DOUBLE COLLECTOR" — the counter line for a raised collector',
);
assert(
	mod.formatWinText(r0.wheel.coinBoost, { count: 2 }) === 'COIN BOOST ×2' &&
		mod.formatWinText(r0.wheel.extraCollect, { count: 1 }) === '+1 COLLECT',
	'wheel segments: "COIN BOOST ×2", "+1 COLLECT"',
);
assert(
	mod.formatWinText(r0.wheel.coinBoostDetail, { count: 3 }) === 'EVERY COIN ×3' &&
		mod.formatWinText(r0.wheel.extraCollectDetail, {
			level: mod.collectorLevelCaption(r0, 3),
		}) === 'TRIPLE COLLECT',
	'wheel prize banners: "EVERY COIN ×3", "TRIPLE COLLECT"',
);
assert(
	mod.formatWinText(r0.feature.potLabel, { pot: mod.potCaption(r0, 'red'), level: 5, max: 12 }) ===
		'RED 5/12',
	'"RED 5/12" — an unnamed pot reads its id in capitals',
);
const r1 = mod.resolveWinText({
	feature: { potNames: { red: 'Rubí' }, collectorLevelNames: { 2: 'DOBLE' } },
	wheel: { extraCollect: '+{count} RECOGIDA' },
});
assert(
	mod.potCaption(r1, 'red') === 'Rubí' && mod.potCaption(r1, 'blue') === 'BLUE',
	'pot names merge per pot',
);
assert(
	mod.collectorLevelCaption(r1, 2) === 'DOBLE' && mod.collectorLevelCaption(r1, 3) === 'TRIPLE',
	'collector level names merge per level',
);
assert(
	r1.wheel.extraCollect === '+{count} RECOGIDA' && r1.wheel.coinBoost === 'COIN BOOST ×{count}',
	'wheel fields merge per field',
);

// --- harvest -----------------------------------------------------------------
console.info('harvest');
const keys = (items) => items.map((i) => i.key);
const legacyDoc = {
	lineMessage: { default: '{count} {symbolName}' },
	winLevels: { big: 'BIG WIN' },
};
const legacyBefore = [
	'{count} {symbolName}',
	'BIG WIN',
	'You win {amount} with {count} {symbolName}',
	'You win {amount} with {symbolName} on {count} reels',
	'You win {amount}',
	'You won +{count} Extra Free Spins',
];
assert(
	same(keys(mod.collectWinTextTemplates(legacyDoc)), legacyBefore),
	'a non-Hold-and-Win project harvests exactly what it did before',
);
assert(
	same(
		keys(mod.collectWinTextTemplates(legacyDoc, { holdAndWin: false, jackpots: ['MINI'] })),
		legacyBefore,
	),
	'…even when handed tiers, while the kind is not Hold and Win',
);
const hw = keys(
	mod.collectWinTextTemplates(undefined, {
		holdAndWin: true,
		jackpots: ['MINI', 'MINOR', 'MAJOR', 'GRAND'],
	}),
);
for (const expected of [
	'MINI',
	'MINOR',
	'MAJOR',
	'GRAND',
	'{jackpot} JACKPOT',
	'FULL BOARD  {amount}',
	'RESPINS {count}',
	'{count} RESPINS',
	'RESPINS RESET',
	'LAST RESPIN',
	'BONUS WIN {amount}',
	'INSTANT WIN',
	'LUCKY SPIN',
	'{meter} ACTIVATED',
	'{modifiers} ACTIVE',
	'UNLOCKED: {modifiers}',
	'COLLECTOR',
	'MULTIPLIER',
	'PAYER',
	'MYSTERY',
	'{level} COLLECTOR',
	'{pot} {level}/{max}',
	'DOUBLE',
	'TRIPLE',
	'COIN BOOST ×{count}',
	'+{count} COLLECT',
	'EVERY COIN ×{count}',
	'{level} COLLECT',
]) {
	assert(hw.includes(expected), `a Hold and Win project harvests "${expected}"`);
}
assert(
	!hw.includes('{amount}') && !hw.includes('{jackpot}'),
	'token-only templates are not harvested',
);
assert(!hw.includes(''), 'the empty intro / outro are not harvested');
const hwPots = keys(
	mod.collectWinTextTemplates(
		{ feature: { potNames: { red: 'Rubí' } } },
		{
			holdAndWin: true,
			meters: ['red', 'blue'],
		},
	),
);
assert(
	hwPots.includes('Rubí') && hwPots.includes('BLUE') && !hwPots.includes('RED'),
	'each pot harvests its name (authored, else its id)',
);
const hwAuthored = keys(
	mod.collectWinTextTemplates(
		{
			jackpots: { captions: { GRAND: 'GRANDE' } },
			feature: { intro: 'HOLD ON!', total: 'YOU BAGGED {amount}' },
		},
		{ holdAndWin: true, jackpots: ['MINI', 'GRAND'] },
	),
);
assert(
	hwAuthored.includes('GRANDE') && !hwAuthored.includes('GRAND'),
	'a captioned tier harvests its caption',
);
assert(hwAuthored.includes('MINI'), 'an uncaptioned tier harvests its name');
assert(hwAuthored.includes('HOLD ON!'), 'an authored intro is harvested');
assert(
	hwAuthored.includes('YOU BAGGED {amount}') && !hwAuthored.includes('BONUS WIN {amount}'),
	'an authored total replaces the default in the harvest',
);
const strayAuthored = keys(
	mod.collectWinTextTemplates({ respins: { counter: 'SPINS: {count}' } }, { holdAndWin: false }),
);
assert(
	strayAuthored.includes('SPINS: {count}') && !strayAuthored.includes('RESPINS RESET'),
	'what an author wrote is harvested whatever the kind; the defaults are not',
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.info('\nall Hold and Win win-text checks passed');
