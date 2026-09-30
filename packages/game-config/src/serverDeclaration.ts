/**
 * The rest of what an RGS DECLARES in its boot `config` about the game's math — `maxWinMp`,
 * `symbolsPay.scatter`, `maxWays` — compared with what the authored config says.
 *
 * Same policy as the paytable (`serverPaytable.ts`): WARN, NEVER ADOPT. The info page and the
 * presentation are built from Invisible Game Config; a server that disagrees is a changed math or a
 * stale config, and which one is a question for the math, not the client. A field the server does
 * not declare decides nothing, so a server that states none of them is compared on nothing.
 *
 * Dependency-free (a leaf package): the engine hands in the declaration it read off
 * `__IE_SERVER_CONFIG__`, already in the engine's symbol names.
 */

import { resolveBetModes } from './betModes';
import type { GameConfigDoc } from './types';
import { resolveWinModel } from './winModel';

export interface ServerMathDeclaration {
	/** `maxWinMp` — the win cap as a multiple of the stake, one entry per bet option as far as the
	 *  wire shows. Only the first (the base option) is compared: what a later entry caps is not yet
	 *  in the protocol reference. */
	maxWinMp?: number[];
	/** `symbolsPay.scatter`, mapped to engine names — which symbols pay as scatters. */
	scatterSymbols?: string[];
	/** `maxWays` — the ways count of a ways game. */
	maxWays?: number;
}

/** One human-readable line per disagreement; empty when the two agree or the server says nothing. */
export const serverDeclarationDrift = (
	doc: GameConfigDoc,
	declared: ServerMathDeclaration,
): string[] => {
	const drift: string[] = [];

	const serverCap = declared.maxWinMp?.[0];
	if (typeof serverCap === 'number' && serverCap > 0) {
		const modes = resolveBetModes(doc);
		const base = modes.find((mode) => mode.kind === 'base') ?? modes[0];
		const shown = base?.maxWin ?? 0;
		if (shown > 0 && shown !== serverCap) {
			drift.push(
				`max win: the info page states ${shown}× (the base mode's max_win), the server caps at ${serverCap}×`,
			);
		}
	}

	if (Array.isArray(declared.scatterSymbols) && declared.scatterSymbols.length) {
		const server = [...new Set(declared.scatterSymbols)].sort();
		const authored = Object.entries(doc.symbols ?? {})
			.filter(([, symbol]) => symbol?.special_properties?.includes?.('scatter'))
			.map(([name]) => name)
			.sort();
		if (server.join() !== authored.join()) {
			drift.push(
				`scatter symbols: authored [${authored.join(', ') || 'none'}], the server pays [${server.join(', ')}] as scatters`,
			);
		}
	}

	const model = resolveWinModel(doc);
	if (model.type === 'ways' && typeof declared.maxWays === 'number' && declared.maxWays > 0) {
		const rows = Array.isArray(doc.numRows) ? doc.numRows : [];
		const ways = rows.reduce((product, count) => product * count, 1);
		if (ways !== declared.maxWays) {
			drift.push(`ways: the authored board gives ${ways}, the server declares ${declared.maxWays}`);
		}
	}

	return drift;
};
