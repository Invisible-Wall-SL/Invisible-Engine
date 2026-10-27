import {
	SOUND_SLOTS,
	resolveCascade,
	resolveReelBehaviour,
	symbolUses,
	symbolsInPlay,
	symbolsUsed,
	type GameConfigDoc,
} from 'game-config';
import { TOKEN_SOUND_MOMENTS, type SymbolStateName } from 'engine-layout';

/**
 * The per-symbol cue states this project can actually hear, derived from its config.
 *
 * A function rather than an expression inline in the payload because it answers a question with
 * three inputs and one hard-won correction in it (see the field's doc in `/sound`): the state a beat
 * plays and the switch that turns that beat on are not the same fact, and `clearReel` shipped gated
 * on the wrong one.
 */
export const symbolCueStates = (config: GameConfigDoc | undefined): readonly SymbolStateName[] => {
	const behaviour = resolveReelBehaviour(config);
	return [
		'land' as const,
		...(behaviour.swapInPlace && behaviour.swapStyle === 'emerge' ? (['intro'] as const) : []),
		...(resolveCascade(config) || behaviour.clearBoard ? (['clearReel'] as const) : []),
	];
};

/** One place a sound can be chosen, as a path into `SoundsDoc.bindings`. */
export interface SoundMoment {
	/** `slots.<id>`, `symbols.<symbol>.<state|tokenMoment>`, `anticipation.activation|loop` or
	 *  `winTiers.<alias>.sfx|bgm`. */
	path: string;
	/** `ladder` takes 1–16 names, everything else exactly one. */
	kind: 'single' | 'ladder';
	/** A music bed takes music names, everything else sfx. */
	music: boolean;
	/** A slot's catalogue defaults; absent elsewhere. */
	defaults?: string[];
}

/**
 * Every moment `/sound` offers for a project, in the page's order: the catalogue's slots, then each
 * symbol in play × the states it can hear, each pots token × its moments, the anticipation pair and
 * each win tier's two cues. The page builds its rows from the same helpers, so an agent is offered
 * exactly what a person is and no new slot, symbol row or tier.
 */
export function soundMoments(config: GameConfigDoc | null | undefined): SoundMoment[] {
	const out: SoundMoment[] = SOUND_SLOTS.map((slot) => ({
		path: `slots.${slot.id}`,
		kind: slot.kind,
		music: slot.id === 'baseMusic' || slot.id === 'freeSpinMusic',
		defaults: [...slot.defaults],
	}));
	if (config) {
		const states = symbolCueStates(config);
		for (const symbol of symbolsInPlay(config)) {
			for (const state of states) {
				out.push({ path: `symbols.${symbol}.${state}`, kind: 'single', music: false });
			}
		}
		const uses = symbolUses(config);
		for (const token of symbolsUsed(config).filter((name) => uses[name] === 'token')) {
			for (const moment of TOKEN_SOUND_MOMENTS) {
				out.push({ path: `symbols.${token}.${moment}`, kind: 'single', music: false });
			}
		}
	}
	out.push(
		{ path: 'anticipation.activation', kind: 'single', music: false },
		{ path: 'anticipation.loop', kind: 'single', music: false },
	);
	for (const tier of config?.winLevels ?? []) {
		out.push(
			{ path: `winTiers.${tier.alias}.sfx`, kind: 'single', music: false },
			{ path: `winTiers.${tier.alias}.bgm`, kind: 'single', music: true },
		);
	}
	const seen = new Set<string>();
	return out.filter((m) => !seen.has(m.path) && seen.add(m.path));
}
