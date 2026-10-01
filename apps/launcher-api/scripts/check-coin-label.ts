/**
 * Contract check for the Hold and Win COIN VALUE LABEL (Invisible Symbols State Machine → Coin value
 * label, `doc.coinLabel`): what the doc persists, what it refuses, and that the block reaches BOTH
 * bundle paths — over the REAL implementation rather than a re-typed copy of it.
 *
 *   1. PARITY — `normalizeSymbolsDoc` writes NO `coinLabel` for a project that never authored one,
 *      nor for one whose every field sits at its default or is empty; it round-trips a real label.
 *   2. JUNK — an out-of-range number is clamped, a non-hex tint / blank font / blank tier text is
 *      dropped, a wrong type fails the save loudly, and an unknown key is ignored with a warning.
 *   3. BOTH BUNDLE PATHS — the runtime exporter carries the field, `/api/editor/export-symbols`
 *      forwards it, and the bake's rebuild (`scripts/lib/bakeCoinLabel.mjs`, RUN here on the
 *      normalized doc) hands back the same block the runtime bundle carries.
 *   4. The CLIENT HALF — `setCoinLabel` prunes exactly like the server, so a draft signs the same as
 *      the doc the server hands back, and `docSignature` moves on an edit and back on a reset.
 *
 * What the game PRINTS with the block is `packages/engine-game/fixtures/coinLabel.fixture.ts`.
 *
 * Run:  pnpm --filter launcher-api check:coin-label
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';
import { ZodError } from 'zod';
import { COIN_LABEL_BOUNDS, COIN_LABEL_DEFAULTS, type CoinLabelConfig } from 'engine-layout';
import { emptySymbolsDoc, normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	clearCoinLabel,
	coinLabelTiers,
	docSignature,
	setCoinLabel,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';
import { bakeCoinLabel } from './lib/bakeCoinLabel.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
// The SAVE path: a read drops an unknown enum value instead (docs/conventions/doc-readers.md).
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
/** An unknown key is IGNORED, not refused (`docs/conventions/doc-readers.md`): the doc normalizes as
 *  if it were absent, and the server warns naming it. */
const ignores = (label: string, input: unknown, known: unknown): void => {
	const warned: unknown[][] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => void warned.push(args);
	try {
		check(label, normalizeSymbolsDoc(input), normalizeSymbolsDoc(known));
	} finally {
		console.warn = warn;
	}
	check(`${label} — with a warning`, warned.length > 0, true);
};
const label = (coinLabel: unknown) => normalizeSymbolsDoc({ coinLabel }).coinLabel;

const AUTHORED: CoinLabelConfig = {
	style: { font: 'coinFont', size: 0.4, tint: '#ffcc00' },
	cash: { format: 'betMultiple', decimals: 2, trimZeros: true },
	jackpots: { MINI: { text: 'Mini', style: { font: 'silver' } }, GRAND: { style: { size: 0.5 } } },
	placement: { x: 0.1, y: -0.2, scale: 1.2, maxWidth: 0.8 },
	animation: {
		landPop: { enabled: true, scale: 1.4, ms: 300 },
		countMs: 900,
		boostPop: { enabled: true },
	},
};

// 1. PARITY
{
	const empty = normalizeSymbolsDoc({});
	check('an empty doc writes no coinLabel', 'coinLabel' in empty, false);
	check('…and is byte-identical to the never-authored doc', json(empty), json(emptySymbolsDoc()));
	check(
		'an empty block persists nothing',
		'coinLabel' in normalizeSymbolsDoc({ coinLabel: {} }),
		false,
	);
	check(
		'a block of empty sections persists nothing',
		label({ style: {}, cash: {}, jackpots: { MINI: {} }, placement: {}, animation: {} }),
		undefined,
	);
	check(
		'every field at its coded default persists nothing',
		label({
			style: { font: '  ' },
			cash: { format: 'money', trimZeros: false },
			jackpots: { MINI: { text: '' } },
			placement: {
				x: COIN_LABEL_DEFAULTS.x,
				y: COIN_LABEL_DEFAULTS.y,
				scale: COIN_LABEL_DEFAULTS.scale,
				maxWidth: COIN_LABEL_DEFAULTS.maxWidth,
			},
			animation: { landPop: { enabled: false, scale: 2 }, boostPop: {} },
		}),
		undefined,
	);
	check('a real label round-trips verbatim', label(AUTHORED), AUTHORED);
	const once = normalizeSymbolsDoc({ coinLabel: AUTHORED });
	check('normalising twice is a fixed point', json(normalizeSymbolsDoc(once)), json(once));
	check(
		'a pop at its default scale and length keeps only its switch',
		label({
			animation: {
				landPop: {
					enabled: true,
					scale: COIN_LABEL_DEFAULTS.popScale,
					ms: COIN_LABEL_DEFAULTS.popMs,
				},
			},
		}),
		{ animation: { landPop: { enabled: true } } },
	);
	check(
		'a count length of 0 is kept — "no count" is a real answer',
		label({ animation: { countMs: 0 } }),
		{ animation: { countMs: 0 } },
	);
}

// 2. JUNK
check(
	'numbers outside their range are clamped',
	label({
		style: { size: 99 },
		cash: { decimals: 9 },
		placement: { x: -5, y: 5, scale: 0, maxWidth: 50 },
		animation: { landPop: { enabled: true, scale: 0.2, ms: 99999 }, countMs: -40 },
	}),
	{
		style: { size: COIN_LABEL_BOUNDS.size[1] },
		cash: { decimals: COIN_LABEL_BOUNDS.decimals[1] },
		placement: {
			x: COIN_LABEL_BOUNDS.offset[0],
			y: COIN_LABEL_BOUNDS.offset[1],
			scale: COIN_LABEL_BOUNDS.scale[0],
			maxWidth: COIN_LABEL_BOUNDS.maxWidth[1],
		},
		animation: {
			landPop: {
				enabled: true,
				scale: COIN_LABEL_BOUNDS.popScale[0],
				ms: COIN_LABEL_BOUNDS.popMs[1],
			},
			countMs: COIN_LABEL_BOUNDS.countMs[0],
		},
	},
);
check(
	'…and integers rounded where a count of digits or ms is meant',
	label({ cash: { decimals: 1.6 }, animation: { countMs: 450.4 } }),
	{ cash: { decimals: 2 }, animation: { countMs: 450 } },
);
check(
	'a non-hex tint, a blank font and blank tier text are dropped',
	label({
		style: { tint: 'gold', font: ' ' },
		jackpots: { MINI: { text: '  ', style: { tint: '#12345' } } },
	}),
	undefined,
);
check('a tint is stored lower-case', label({ style: { tint: '#FFCC00' } }), {
	style: { tint: '#ffcc00' },
});
check(
	'font names and tier text are trimmed',
	label({ style: { font: ' gold ' }, jackpots: { MINI: { text: ' Mini ' } } }),
	{
		style: { font: 'gold' },
		jackpots: { MINI: { text: 'Mini' } },
	},
);
ignores('an unknown key at the top', { coinLabel: { colour: '#ffffff' } }, { coinLabel: {} });
ignores(
	'an unknown key in a style',
	{ coinLabel: { style: { size: 0.4, weight: 'bold' } } },
	{ coinLabel: { style: { size: 0.4 } } },
);
ignores(
	'an unknown key in a jackpot',
	{ coinLabel: { jackpots: { MINI: { label: 'x' } } } },
	{ coinLabel: { jackpots: { MINI: {} } } },
);
ignores(
	'an unknown key in a pop',
	{ coinLabel: { animation: { landPop: { enabled: false, ease: 'backOut' } } } },
	{ coinLabel: { animation: { landPop: { enabled: false } } } },
);
rejects('an unknown cash format', { coinLabel: { cash: { format: 'credits' } } });
rejects('a non-number size', { coinLabel: { style: { size: '0.4' } } });
rejects('a non-finite number', { coinLabel: { animation: { countMs: Infinity } } });
rejects('a non-object block', { coinLabel: 'gold' });

// 3. BOTH BUNDLE PATHS
{
	const exporter = read('apps/launcher-api/src/lib/server/symbolExport.ts');
	check(
		'the runtime exporter carries the field into the bundle',
		exporter.includes('...(doc.coinLabel ? { coinLabel: doc.coinLabel } : {}),'),
		true,
	);
	const endpoint = read('apps/launcher-api/src/routes/api/editor/export-symbols/+server.ts');
	check(
		'the export endpoint destructures AND forwards it',
		(endpoint.match(/\n\t\t\tcoinLabel,/g) ?? []).length,
		2,
	);
	const bake = read('apps/launcher-api/scripts/bake-editor-doc.mjs');
	check(
		'the bake rebuilds it off the export response',
		bake.includes('const coinLabel = bakeCoinLabel(s?.coinLabel);'),
		true,
	);
	check(
		'…and assembles it into the baked `symbols` block',
		/\n\t\t\t\tcoinLabel,\n/.test(bake),
		true,
	);
	const normalized = normalizeSymbolsDoc({ coinLabel: AUTHORED }).coinLabel;
	check(
		'the bake hands back exactly what the runtime bundle carries',
		bakeCoinLabel(normalized),
		normalized,
	);
	check('an absent block bakes nothing', bakeCoinLabel(undefined), undefined);
	check(
		'a hand-edited wrong type is refused by the bake too',
		bakeCoinLabel({ style: { size: '1', font: 3 }, animation: { countMs: 'slow' } }),
		undefined,
	);
	const scenes = read('apps/lines/src/editor-scenes.ts');
	check(
		'the game reads it through one accessor, runtime bundle first',
		scenes.includes('export function bakedCoinLabel()'),
		true,
	);
}

// 4. THE CLIENT HALF
{
	const base: SymbolsDoc = { version: 1, symbols: {} };
	const authored = setCoinLabel(base, AUTHORED);
	check('setCoinLabel marks the doc dirty', docSignature(authored) !== docSignature(base), true);
	check(
		'a draft signs the same as the doc the server hands back',
		docSignature(authored),
		docSignature({ ...base, coinLabel: normalizeSymbolsDoc({ coinLabel: AUTHORED }).coinLabel }),
	);
	check(
		'key order does not move the signature',
		docSignature(
			setCoinLabel(base, {
				animation: AUTHORED.animation,
				placement: AUTHORED.placement,
				jackpots: { GRAND: AUTHORED.jackpots!.GRAND, MINI: AUTHORED.jackpots!.MINI },
				cash: AUTHORED.cash,
				style: AUTHORED.style,
			}),
		),
		docSignature(authored),
	);
	check(
		'a field dragged back to its default restores the untouched signature',
		docSignature(setCoinLabel(base, { placement: { scale: COIN_LABEL_DEFAULTS.scale } })),
		docSignature(base),
	);
	check(
		'…and leaves no key',
		'coinLabel' in setCoinLabel(base, { cash: { format: 'money' } }),
		false,
	);
	check(
		'clearCoinLabel restores the untouched signature',
		docSignature(clearCoinLabel(authored)),
		docSignature(base),
	);
	check(
		'clearCoinLabel on a doc without one returns it unchanged',
		clearCoinLabel(base) === base,
		true,
	);
	check('the tool lists the configured tiers', coinLabelTiers(['MINOR', 'MEGA']), [
		'MINOR',
		'MEGA',
	]);
	check('…or the four the presets use', coinLabelTiers([]), ['MINI', 'MINOR', 'MAJOR', 'GRAND']);
}

console.log(
	failures === 0
		? `\ncoin label: OK (${checks} checks)`
		: `\ncoin label: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
