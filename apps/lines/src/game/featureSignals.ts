import { FLIGHT_METER_PREFIX, type SignalSource } from 'engine-layout';
import { eventScope } from 'utils-event-emitter';

import type { EmitterEvent, eventEmitter } from './eventEmitter';

type EventOf<T extends EmitterEvent['type']> = Extract<EmitterEvent, { type: T }>;
type Handlers = Parameters<typeof eventEmitter.subscribe>[0];

/**
 * The FEATURE-PART signals (`docs/design/hold-and-win.md` §8, Phase 12a) — the engine's own Hold and
 * Win beats, and the operator platform's jackpot, reaching component cues and `hiddenUntilSignal`
 * gates with no Flow wiring. Each rides a cue the beat already broadcasts (`RespinBoard.svelte`,
 * `HoldAndWinBanner.svelte`, the flights) and passes on the cue's `scope`: a fire about ONE pot, tier
 * or column reaches only the component instances scoped to it, so a frog authored once inside the Pot
 * component celebrates on the pot that activated. The catalog side (names, labels, what each is scoped
 * by) is `engine-layout`'s `ENGINE_SIGNAL_CATALOG`.
 *
 * The Hold and Win family is registered only for a Hold and Win game (`holdAndWin`): a registered
 * name always beats the open bus, so registering `featureEnter` or `coinLand` in a lines game would
 * silently take the name away from a scene cue an author fires from a Flow. The platform jackpot is
 * any kind's. Svelte-free, so the launcher's `check:signal-scope` drives it with a real emitter.
 */
export const featureComponentSignals = (
	emitter: typeof eventEmitter,
	holdAndWin: boolean,
): Record<string, SignalSource> => {
	const on = <T extends EmitterEvent['type']>(
		type: T,
		when: (event: EventOf<T>) => boolean = () => true,
	): SignalSource => ({
		subscribe: (run) =>
			emitter.subscribe({
				[type]: (event: EventOf<T>) => {
					if (when(event)) run(eventScope(event));
				},
			} as Handlers),
	});
	const platform = { platformJackpotWin: on('platformJackpotCelebration') };
	if (!holdAndWin) return platform;
	return {
		...platform,
		potFill: on('potFill'),
		potLand: on('flightArrive', (event) => event.flight.startsWith(FLIGHT_METER_PREFIX)),
		potLevelUp: on('potLevelUp'),
		potStageUp: on('potStageUp'),
		potFull: on('potFull'),
		potActivate: on('potsConsume'),
		respinReset: on('respinCounterUpdate', (event) => event.reset),
		respinLast: on('respinCounterUpdate', (event) => !event.reset && event.left === 1),
		coinLand: on('respinCoinsLand'),
		coinCollect: on('respinCoinCollect'),
		coinBoost: on('respinCoinBoost'),
		coinUpgrade: on('respinCoinUpgrade'),
		jackpotWin: on('respinJackpotWin'),
		letterLit: on('respinColumnComplete', (event) => event.newlyLit),
		wheelSpin: on('wheelSpin'),
		wheelLand: on('wheelLand'),
		featureEnter: on('respinBoardShow'),
		featureExit: on('respinBoardHide'),
	};
};
