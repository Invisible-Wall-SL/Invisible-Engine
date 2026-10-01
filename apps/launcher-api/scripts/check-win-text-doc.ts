/**
 * Contract check for the Invisible Win Text DOC on its way to the game — the Hold and Win families
 * (`jackpots` / `respins` / `feature`) must survive the save normalizer, because BOTH bundle paths
 * ship exactly what it returns (`/api/win-text/doc` → `bake-editor-doc.mjs` → `bundle.winText`, and
 * `loadWinTextDoc` → `runtimeBundle.ts`). `normalizeWinTextDoc` rebuilds the doc from a WHITELIST,
 * so a family the schema accepts but the rebuild forgets is silently dropped on save and never
 * reaches a game. And a doc that authored nothing new must normalize byte-for-byte as before.
 *
 * Run:  pnpm --filter launcher-api check:win-text-doc
 *
 * The `--tsconfig` maps SvelteKit's `$env/dynamic/private` to a stub (`scripts/lib/env-stub.ts`),
 * because `winTextStorage.ts` reaches R2 → `env.ts` → that virtual module.
 */

import { resolveWinText, type WinTextDoc } from 'engine-layout';
import { harvestWinText } from '../src/lib/server/localizationHarvest.ts';
import { normalizeWinTextDoc } from '../src/lib/server/winTextStorage.ts';

let failures = 0;
const check = (cond: boolean, msg: string) => {
	if (cond) console.info(`  ✓ ${msg}`);
	else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};
const throws = (fn: () => unknown): boolean => {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
};
/** Run `fn` with the unknown-field warning silenced. */
const quiet = <T>(fn: () => T): T => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		return fn();
	} finally {
		console.warn = warn;
	}
};
/** What the bake and the runtime bundle both test before shipping a doc at all. */
const authorsSomething = (doc: WinTextDoc) =>
	Object.keys(doc).some((k) => k !== 'version' && k !== 'updatedAt');

console.info('§1 the Hold and Win families survive the save normalizer');
const full: WinTextDoc = {
	version: 1,
	jackpots: {
		captions: { MINI: 'Mini', GRAND: 'Grand' },
		award: '{jackpot}!',
		awardDetail: 'WON {amount}',
		fullBoardDetail: 'FULL! {amount}',
		coin: '{jackpot} COIN',
	},
	respins: { counter: '{count} LEFT', award: '{count} SPINS', reset: 'AGAIN!', last: 'LAST!' },
	feature: {
		total: 'TOTAL {amount}',
		intro: 'HOLD ON',
		outro: 'DONE',
		instantCollect: 'INSTANT!',
		luckySpin: 'LUCKY!',
		meterFull: '{meter} ON',
		modifiersActive: '{modifiers} ON',
		modifiersUnlocked: '+{modifiers}',
		collectorLevel: '{level} COLL.',
		potLabel: '{pot}: {level} of {max}',
		specialNames: { payer: 'Payer' },
		collectorLevelNames: { '2': 'Double' },
		potNames: { red: 'Ruby' },
	},
	wheel: {
		coinBoost: 'BOOST ×{count}',
		extraCollect: '+{count}',
		coinBoostDetail: 'ALL ×{count}',
		extraCollectDetail: '{level}!',
	},
};
const normalized = normalizeWinTextDoc(full);
check(JSON.stringify(normalized) === JSON.stringify(full), 'every field round-trips unchanged');
check(
	JSON.stringify(normalizeWinTextDoc(JSON.parse(JSON.stringify(normalized)))) ===
		JSON.stringify(normalized),
	'normalizing twice is a no-op (a load → save → load cycle keeps it)',
);
check(
	resolveWinText(normalized).respins.counter === '{count} LEFT' &&
		resolveWinText(normalized).jackpots.captions.GRAND === 'Grand',
	'the game resolves what was saved',
);
for (const [family, doc] of [
	['jackpots', { jackpots: { coin: 'X' } }],
	['jackpots.captions', { jackpots: { captions: { MINI: 'X' } } }],
	['respins', { respins: { last: 'X' } }],
	['feature', { feature: { luckySpin: 'X' } }],
	['feature.specialNames', { feature: { specialNames: { payer: 'X' } } }],
	['feature.collectorLevelNames', { feature: { collectorLevelNames: { '2': 'X' } } }],
	['feature.potNames', { feature: { potNames: { red: 'X' } } }],
	['wheel', { wheel: { coinBoost: 'X' } }],
] as const) {
	check(authorsSomething(normalizeWinTextDoc(doc)), `a doc authoring only ${family} is shipped`);
}

console.info('§2 blanks prune to unset; unknown fields are refused');
const pruned = normalizeWinTextDoc({
	jackpots: { award: '  ', captions: { MINI: '' } },
	respins: { counter: '' },
	feature: { intro: ' ', specialNames: { payer: '' } },
});
check(JSON.stringify(pruned) === '{"version":1}', 'a cleared family disappears, not saved as ""');
check(!authorsSomething(pruned), '…so the bundles carry no win-text key for it (byte-identical)');
check(
	JSON.stringify(quiet(() => normalizeWinTextDoc({ respins: { countr: 'x' } }))) ===
		JSON.stringify(normalizeWinTextDoc({})),
	'an unknown respin field is ignored (docs/conventions/doc-readers.md)',
);
check(
	throws(() => normalizeWinTextDoc({ jackpots: { award: 3 } })),
	'a non-string template is a 400',
);
check(
	JSON.stringify(quiet(() => normalizeWinTextDoc({ feature: { bonus: 'x' } }))) ===
		JSON.stringify(normalizeWinTextDoc({})),
	'an unknown feature field is ignored',
);

console.info('§3 a doc that authors nothing new normalizes exactly as before');
const legacy = {
	version: 1,
	lineMessage: { default: '{count} {symbolName}', byCount: { '2': 'PAIR!' } },
	amountFormat: '{amount}!',
	winLevels: { big: 'BIG WIN' },
	toast: { full: 'You win {amount}', symbolAsImage: true },
	freeSpins: { retrigger: '+{count}' },
};
check(
	JSON.stringify(normalizeWinTextDoc(legacy)) ===
		'{"version":1,"lineMessage":{"default":"{count} {symbolName}","byCount":{"2":"PAIR!"}},' +
			'"amountFormat":"{amount}!","winLevels":{"big":"BIG WIN"},' +
			'"toast":{"full":"You win {amount}","symbolAsImage":true},"freeSpins":{"retrigger":"+{count}"}}',
	'the legacy fields keep their bytes and their order',
);
check(
	JSON.stringify(normalizeWinTextDoc({})) === '{"version":1}',
	'an empty doc is still {version:1}',
);

console.info('§4 Localization lists the families for a Hold and Win project only');
const items = (doc: WinTextDoc | undefined, holdAndWin: boolean) =>
	harvestWinText(doc, { holdAndWin, jackpots: ['MINI', 'GRAND'] }).flatMap((s) =>
		s.items.map((i) => i.key),
	);
const hw = items(undefined, true);
check(
	hw.includes('RESPINS {count}') && hw.includes('GRAND'),
	'an unauthored Hold and Win project lists the defaults',
);
check(!hw.includes('{amount}'), 'a token-only template is not offered for translation');
const lines = items(undefined, false);
check(
	!lines.includes('RESPINS {count}') && !lines.includes('GRAND'),
	'a lines project lists none of them',
);
check(
	JSON.stringify(lines) ===
		JSON.stringify(harvestWinText(undefined).flatMap((s) => s.items.map((i) => i.key))),
	'…and lists exactly what the call without options does',
);
check(
	items(normalized, true).includes('Grand'),
	'an authored caption is listed in place of the tier name',
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.info('\nwin-text doc contract: all checks passed');
