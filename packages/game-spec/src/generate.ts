import type { GameSpec } from './schema';

const color = (n: number) => `0x${n.toString(16).padStart(6, '0')}`;
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const SCATTER_KINDS = new Set(['scatter', 'wildScatter']);

/** game/paytable.ts — the display paytable (server-shape) + line count. */
export const generatePaytable = (spec: GameSpec): string => {
	const numLines = spec.bet.numLines ?? spec.paylines?.length ?? 0;
	const entries = spec.symbols
		.filter((s) => s.pay && Object.keys(s.pay).length)
		.map((s) => {
			const occurs = Object.keys(s.pay!).map(Number).sort((a, b) => a - b);
			const pay = occurs.map((o) => s.pay![String(o)]);
			const mode = SCATTER_KINDS.has(s.kind) ? 'scatter' : 'line';
			const trigger = s.trigger ? `, trigger: ${q(s.trigger)}` : '';
			return `\t{ on: { occurs: [${occurs.join(', ')}], of: ${q(s.id)}, mode: '${mode}' }, pay: [${pay.join(', ')}]${trigger} },`;
		})
		.join('\n');

	return `// GENERATED from the game spec — do not edit by hand.
import type { ServerPayEntry } from 'utils-shared/paytable';

export const NUM_LINES = ${numLines};

export const PAYTABLE: ServerPayEntry[] = [
${entries}
];
`;
};

/** game/infoManifest.ts — feeds the shared <InfoOverlay>. */
export const generateInfoManifest = (spec: GameSpec): string => {
	const themeEntries: string[] = [];
	const t = spec.theme ?? {};
	if (t.fontFamily) themeEntries.push(`\t\tfontFamily: ${q(t.fontFamily)},`);
	if (t.titleColor !== undefined) themeEntries.push(`\t\ttitleColor: ${color(t.titleColor)},`);
	if (t.textColor !== undefined) themeEntries.push(`\t\ttextColor: ${color(t.textColor)},`);
	if (t.accentColor !== undefined) themeEntries.push(`\t\taccentColor: ${color(t.accentColor)},`);
	if (t.dimColor !== undefined) themeEntries.push(`\t\tdimColor: ${color(t.dimColor)},`);
	if (t.dimAlpha !== undefined) themeEntries.push(`\t\tdimAlpha: ${t.dimAlpha},`);
	const themeBlock = themeEntries.length ? `\ttheme: {\n${themeEntries.join('\n')}\n\t},\n` : '';

	const rules = (spec.info?.rules ?? [])
		.map((r) => `\t\t{\n\t\t\theading: ${q(r.heading)},\n\t\t\tbody: ${q(r.body)},\n\t\t},`)
		.join('\n');

	return `// GENERATED from the game spec — do not edit by hand.
import type { InfoManifest, InfoSymbolIcon } from 'components-ui-pixi';

import config from './config';
import { PAYTABLE, NUM_LINES } from './paytable';
import { getSymbolInfo } from './utils';
import { SYMBOL_SIZE } from './constants';
import type { SymbolName } from './types';

const symbols: Record<string, InfoSymbolIcon> = {};
for (const entry of PAYTABLE) {
	const info = getSymbolInfo({ rawSymbol: { name: entry.on.of as SymbolName }, state: 'static' }) as {
		type: 'sprite' | 'spine';
		assetKey: string;
		animationName?: string;
		sizeRatios: { width: number; height: number };
	};
	symbols[entry.on.of] = {
		type: info.type,
		assetKey: info.assetKey,
		animationName: info.animationName,
		sizeRatios: info.sizeRatios,
	};
}

export const infoManifest: InfoManifest = {
	paytable: PAYTABLE,
	numLines: NUM_LINES,
	paylines: Object.values(config.paylines) as number[][],
	numRows: config.numRows[0] ?? 3,
	symbolSize: SYMBOL_SIZE,
	symbols,
${themeBlock}	rules: [
${rules}
	],
};
`;
};
