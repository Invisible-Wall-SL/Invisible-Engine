import { bakedSymbolFx } from '../editor-scenes';
import { coinLabelFor } from './coinLabel';
import { getActiveGameConfig } from './gameConfig';
import { symbolPlaceholder } from './symbolPlaceholder';
import type { RawSymbol, SymbolState } from './types';
import { getSymbolInfo } from './utils';

/**
 * Would `Symbol.svelte` draw NOTHING for this symbol in this state? True when no art is bound and no
 * placeholder disc stands in for it, it carries no coin label or multiplier stamp, and it has no
 * per-state Element FX: the only things that component draws without art. Such a symbol never
 * reports completion either (nothing in it plays), so not mounting it at all is indistinguishable
 * from mounting it — and a Hold and Win respin strip is mostly blanks like this, each of which used
 * to cost a whole `Symbol` as it rolled past.
 */
export const symbolDrawsNothing = (rawSymbol: RawSymbol, state: SymbolState): boolean =>
	getSymbolInfo({ rawSymbol, state }).missingArt &&
	symbolPlaceholder(getActiveGameConfig(), rawSymbol.name) === undefined &&
	!coinLabelFor(rawSymbol) &&
	!rawSymbol.multiplier &&
	!bakedSymbolFx()[rawSymbol.name];
