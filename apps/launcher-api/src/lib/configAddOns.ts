/**
 * What a project's Game Config adds on top of its kind (`docs/design/pots-overlay.md` §4): the
 * add-on blocks a tool passes to `kindCapabilities`, and the meter rows the Symbols and Win Text
 * tools list. One home, so every tool reads an add-on the same way.
 */

import type { KindCapabilityConfig } from 'engine-layout';
import { resolveMeters, type GameConfigDoc } from 'game-config';

type AddOnDoc = Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay'> | null | undefined;

/** The add-on blocks the config carries — `kindCapabilities`' presence flags. */
export type ConfigAddOns = Required<Pick<KindCapabilityConfig, 'holdAndWin' | 'potsOverlay'>>;

export const configAddOns = (doc: AddOnDoc): ConfigAddOns => ({
	holdAndWin: !!doc?.holdAndWin,
	potsOverlay: !!doc?.potsOverlay,
});

export interface ConfigMeterRows {
	/** Every meter id (`resolveMeters` order) — one `toMeter:<id>` flight and one pot name each. */
	meterIds: string[];
	/** Each overlay token symbol → the pots it fills. Tokens are never on a strip, so the in-play
	 *  set misses them and a tool adds them from here. */
	tokens: Record<string, string[]>;
}

export function configMeterRows(doc: AddOnDoc): ConfigMeterRows {
	const meters = resolveMeters(doc ?? undefined);
	const tokens: Record<string, string[]> = {};
	for (const meter of meters) {
		if (meter.source === 'overlay') (tokens[meter.symbol] ??= []).push(meter.id);
	}
	return { meterIds: meters.map((meter) => meter.id), tokens };
}
