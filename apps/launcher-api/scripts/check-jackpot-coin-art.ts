/**
 * Contract check for Invisible Symbols → "Jackpot coins have their own art" (`jackpotCoinArt`): a Hold
 * and Win coin carrying a jackpot tier draws its tier's row of the symbol map (`COIN:MINI`) when the
 * switch is on and that row is bound, else the coin's own art.
 *
 *   1. THE KEY — one helper names a tier row, and an ordinary symbol is never one.
 *   2. THE DOC — the switch is sparse and default OFF; tier rows are ordinary `symbols` entries that
 *      survive a save whatever the switch says.
 *   3. THE CLIENT — the setter and the page's dirty signature agree with the server.
 *   4. SHIPPING (rule 8) — off, the export drops every tier row, so neither the row nor its art
 *      ships; on, the tier's rig reaches `refs`, and the switch reaches BOTH bundle paths.
 *   5. THE GAME — the real resolver: with the switch off (or no tier row bound) every draw resolves to
 *      the SAME object as a resolver that has never heard of tiers; on, a bound tier draws its own art,
 *      inheriting inside its row, and an unbound tier or state draws the coin. Plus the wiring: the
 *      reader, the resolver's tier key, and `Symbol.svelte` drawing the tier the LABEL shows (held at
 *      the old one until an upgrade's beam lands).
 *
 * Run:  pnpm --filter launcher-api check:jackpot-coin-art
 */

import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import {
	isJackpotArtKey,
	jackpotArtKey,
	jackpotArtKeyParts,
	withoutJackpotArtRows,
} from '../../../packages/engine-layout/src/lib/jackpotCoinArt.ts';
import { createSymbolInfo } from '../../../packages/engine-game/src/game/symbolInfo.ts';
import { createSymbolMap } from '../../../packages/engine-game/src/game/symbolMap.ts';
import type {
	RawSymbol,
	SymbolInfoMap,
	SymbolState,
} from '../../../packages/engine-game/src/game/types.ts';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { collectSymbolRefs, shipJackpotArtOnlyWhenOn } from '../src/lib/server/symbolExport.ts';
import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import { symbolsRouteCarries } from './lib/symbolsRouteBody.ts';
import {
	docSignature,
	jackpotCoinArtEnabled,
	setJackpotCoinArt,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input, 'reject');
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

const sprite = (assetKey: string) => ({ type: 'sprite' as const, assetKey });
const rig = (assetKey: string) => ({ type: 'spine' as const, assetKey, animationName: 'idle' });

console.log('\n1. one helper names a tier row');
check('the key is the wire text of a jackpot cell', jackpotArtKey('COIN', 'MINI'), 'COIN:MINI');
check('…and parses back', jackpotArtKeyParts('COIN:MINI'), { coin: 'COIN', tier: 'MINI' });
check('an ordinary symbol is not a tier row', isJackpotArtKey('COIN'), false);
check('…nor a half key', [':MINI', 'COIN:'].map(isJackpotArtKey), [false, false]);
const plain = { COIN: {}, H1: {} };
check('a map with no tier row is returned AS IS', withoutJackpotArtRows(plain) === plain, true);
check(
	'…and one with tier rows loses only them',
	Object.keys(withoutJackpotArtRows({ COIN: {}, 'COIN:MINI': {}, H1: {} })),
	['COIN', 'H1'],
);

console.log('\n2. the doc: the switch is sparse and OFF by default; tier rows are ordinary rows');
const untouched = normalizeSymbolsDoc({ version: 1, symbols: {} });
check('an untouched doc persists no `jackpotCoinArt`', 'jackpotCoinArt' in untouched, false);
check('…and reads as OFF', jackpotCoinArtEnabled(untouched as SymbolsDoc), false);
check(
	'OFF written explicitly persists nothing (byte-parity)',
	'jackpotCoinArt' in normalizeSymbolsDoc({ jackpotCoinArt: { enabled: false } }),
	false,
);
check('ON round-trips', normalizeSymbolsDoc({ jackpotCoinArt: { enabled: true } }).jackpotCoinArt, {
	enabled: true,
});
rejects('a non-boolean is refused on save', { jackpotCoinArt: { enabled: 'yes' } });
check(
	'a field a newer build wrote is dropped, never the switch or the doc',
	normalizeSymbolsDoc({ jackpotCoinArt: { enabled: true, tiers: [] } }).jackpotCoinArt,
	{ enabled: true },
);
const authored = {
	symbols: { COIN: { static: sprite('coin.webp') }, 'COIN:MINI': { static: sprite('mini.webp') } },
};
check(
	'a tier row survives a save with the switch OFF (flicking it back on restores the art)',
	normalizeSymbolsDoc(authored).symbols['COIN:MINI'],
	{ static: sprite('mini.webp') },
);

console.log('\n3. the client half agrees with the server');
const base: SymbolsDoc = { version: 1, symbols: {} };
check('the setter turns it on', jackpotCoinArtEnabled(setJackpotCoinArt(base, true)), true);
check(
	'…and off again, deleting the key',
	'jackpotCoinArt' in setJackpotCoinArt(setJackpotCoinArt(base, true), false),
	false,
);
check(
	'turning it on marks the page DIRTY',
	docSignature(setJackpotCoinArt(base, true)) !== docSignature(base),
	true,
);
check(
	'…and the doc the server hands back signs the same as the draft',
	docSignature(setJackpotCoinArt(base, true)),
	docSignature({
		...base,
		jackpotCoinArt: normalizeSymbolsDoc({ jackpotCoinArt: { enabled: true } }).jackpotCoinArt,
	}),
);

console.log('\n4. shipping: off ships no tier row and no tier art; on ships both, on both paths');
const withRig = normalizeSymbolsDoc({
	symbols: {
		COIN: { static: rig('rigs/coin') },
		'COIN:GRAND': { static: rig('rigs/grand') },
	},
}) as Parameters<typeof shipJackpotArtOnlyWhenOn>[0];
const off = shipJackpotArtOnlyWhenOn(withRig);
check('off: the shipped map has no tier row', Object.keys(off.symbols), ['COIN']);
check('off: the tier rig is not collected', [...collectSymbolRefs(off).rigKeys], ['rigs/coin']);
const noTiers = normalizeSymbolsDoc({
	symbols: { COIN: { static: rig('rigs/coin') } },
}) as Parameters<typeof shipJackpotArtOnlyWhenOn>[0];
check('a doc with no tier row ships AS IS', shipJackpotArtOnlyWhenOn(noTiers) === noTiers, true);
const on = shipJackpotArtOnlyWhenOn({ ...withRig, jackpotCoinArt: { enabled: true } });
check('on: the tier row ships in the map', Object.keys(on.symbols), ['COIN', 'COIN:GRAND']);
check('on: its rig reaches `refs` (rule 8)', [...collectSymbolRefs(on).rigKeys].sort(), [
	'rigs/coin',
	'rigs/grand',
]);

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}../../../`;
/** Whitespace-blind containment, so a re-wrap of the source cannot fail a claim about its code. */
const squash = (text: string): string => text.replace(/\s+/g, ' ').replace(/([([{]) /g, '$1');
const holds = (source: string, ...snippets: string[]): boolean =>
	snippets.every((snippet) => squash(source).includes(squash(snippet)));
const exporter = readLF(`${here}../src/lib/server/symbolExport.ts`);
const bake = readLF(`${here}bake-editor-doc.mjs`);
check(
	'the exporter ships the doc through the tier filter',
	holds(exporter, 'shipJackpotArtOnlyWhenOn( await canonicalizeSymbolsDocForExport('),
	true,
);
check(
	'the exporter emits the switch',
	exporter.includes('...(jackpotCoinArt ? { jackpotCoinArt } : {})'),
	true,
);
check('the export ENDPOINT forwards it (the bake reads this)', symbolsRouteCarries('jackpotCoinArt'), true); // prettier-ignore
check('the bake whitelist rebuilds it', bake.includes('s?.jackpotCoinArt?.enabled === true'), true);
check('…and puts it on the bundle', /\n\t{4,}jackpotCoinArt,\n/.test(bake), true);

console.log('\n5. the game: unauthored draws are identical; a bound tier draws its own art');
const CODED: SymbolInfoMap = {
	COIN: { static: sprite('coin.webp'), win: sprite('coin_win.webp') },
	H1: { static: sprite('h1.webp') },
};
const BAKED: SymbolInfoMap = {
	COIN: { land: sprite('coin_land.webp') },
	'COIN:MINI': { static: sprite('mini.webp') },
	'COIN:GRAND': { static: sprite('grand.webp'), win: sprite('grand_win.webp') },
};
const STATES = ['static', 'land', 'win', 'explosion'] as SymbolState[];
const SYMBOLS: RawSymbol[] = [
	{ name: 'COIN', value: 2 },
	{ name: 'COIN', jackpot: 'MINI' },
	{ name: 'COIN', jackpot: 'GRAND' },
	{ name: 'COIN', jackpot: 'MAJOR' },
	{ name: 'H1' },
];
const resolverWith = (baked: SymbolInfoMap | undefined, switchOn?: boolean) =>
	createSymbolInfo({
		symbolMap: createSymbolMap({ codedMap: CODED, bakedMap: () => baked }),
		...(switchOn === undefined
			? {}
			: {
					tierArtKey: (raw: RawSymbol) =>
						raw.jackpot !== undefined && switchOn
							? jackpotArtKey(raw.name, raw.jackpot)
							: undefined,
				}),
	});
const draws = (info: ReturnType<typeof createSymbolInfo>) =>
	SYMBOLS.flatMap((rawSymbol) => STATES.map((state) => info.getSymbolInfo({ rawSymbol, state })));
const tierless = draws(resolverWith(BAKED));
check('switch OFF: every draw equals a tier-unaware resolver', draws(resolverWith(BAKED, false)), tierless); // prettier-ignore
check(
	'switch ON, no tier row bound: every draw equals a tier-unaware resolver',
	draws(resolverWith({ COIN: BAKED.COIN }, true)),
	draws(resolverWith({ COIN: BAKED.COIN })),
);
const onInfo = resolverWith(BAKED, true);
const art = (raw: RawSymbol, state: string) =>
	onInfo.getSymbolInfo({ rawSymbol: raw, state: state as SymbolState }).assetKey;
check(
	'ON: a MINI coin draws its tier',
	art({ name: 'COIN', jackpot: 'MINI' }, 'static'),
	'mini.webp',
);
check('…and inherits INSIDE its row (win → static)', art({ name: 'COIN', jackpot: 'MINI' }, 'win'), 'mini.webp'); // prettier-ignore
check('a GRAND coin draws its own win', art({ name: 'COIN', jackpot: 'GRAND' }, 'win'), 'grand_win.webp'); // prettier-ignore
check('an unbound tier (MAJOR) draws the coin', art({ name: 'COIN', jackpot: 'MAJOR' }, 'land'), 'coin_land.webp'); // prettier-ignore
check('a cash coin draws the coin', art({ name: 'COIN', value: 2 }, 'static'), 'coin.webp');
check(
	'`symbolArtName` names the row drawn from (the beat gate asks it)',
	[onInfo.symbolArtName({ name: 'COIN', jackpot: 'MINI' }, 'win' as SymbolState), onInfo.symbolArtName({ name: 'COIN', jackpot: 'MAJOR' }, 'win' as SymbolState)], // prettier-ignore
	['COIN:MINI', 'COIN'],
);
check(
	'the resolved cell is MEMOISED per row (identity is what keeps an animation from restarting)',
	onInfo.getSymbolInfo({ rawSymbol: { name: 'COIN', jackpot: 'MINI', value: 1 }, state: 'static' as SymbolState }) === // prettier-ignore
		onInfo.getSymbolInfo({ rawSymbol: { name: 'COIN', jackpot: 'MINI' }, state: 'static' as SymbolState }), // prettier-ignore
	true,
);

const scenes = readLF(`${root}apps/lines/src/editor-scenes.ts`);
const utils = readLF(`${root}apps/lines/src/game/utils.ts`);
const symbol = readLF(`${root}apps/lines/src/components/Symbol.svelte`);
check(
	'the reader resolves runtime → baked → off',
	holds(
		scenes,
		'runtimeBundle!.symbols?.jackpotCoinArt',
		'bakedBundle.symbols?.jackpotCoinArt',
		'return c?.enabled ?? false;',
	),
	true,
);
check(
	'the game hands the resolver a tier key only while the switch is on',
	holds(
		utils,
		'rawSymbol.jackpot !== undefined && bakedJackpotCoinArt() ? jackpotArtKey(rawSymbol.name, rawSymbol.jackpot) : undefined',
	),
	true,
);
check(
	'a symbol draws the tier its LABEL shows (an upgrade turns the art over with the label)',
	holds(
		symbol,
		'const labelJackpot = $derived(props.labelOverride?.jackpot ?? props.rawSymbol.jackpot);',
		'getSymbolInfo({ rawSymbol: artSymbol, state: props.state })',
	),
	true,
);

console.log(
	failures === 0
		? `\njackpot coin art: OK (${checks} checks)`
		: `\njackpot coin art: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
