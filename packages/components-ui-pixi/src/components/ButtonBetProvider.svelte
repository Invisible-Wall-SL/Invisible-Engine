<script lang="ts" module>
	export type { SpinButtonKey as ButtonBetKey } from 'utils-shared/spinStop';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	import { hasContinuePress, stateBetDerived } from 'state-shared';
	import {
		getSpinButtonKey,
		getSpinPressSound,
		runSpinOrSlamStop,
		type SpinButtonKey,
	} from 'utils-shared/spinStop';

	import { getContext } from '../context';

	type Props = {
		children: Snippet<
			[
				{
					key: SpinButtonKey;
					onpress: () => void;
					disabled: boolean;
					spinning: boolean;
					hotkeyDisabled: boolean;
				},
			]
		>;
	};

	const props: Props = $props();
	const context = getContext();

	// The sound is chosen from the SAME `isIdle` read the press body decides on, so a slam can never
	// announce itself with the bet whoosh (it did — the sound was broadcast before the decision).
	const onpress = () => {
		const isIdle = context.stateXstateDerived.isIdle();
		context.eventEmitter.broadcast(getSpinPressSound({ isIdle }));
		runSpinOrSlamStop({ isIdle, broadcast: context.eventEmitter.broadcast });
	};

	// Slam stop is ALWAYS ON: while a round rolls the button is a live STOP that snaps the reels
	// to the already-resolved result and fast-forwards the win presentation (`roundSkip`). The
	// key/press decision lives in `utils-shared/spinStop` so this provider and the flow-driven
	// spin action in the game can't drift.
	const key = $derived(getSpinButtonKey({ isIdle: context.stateXstateDerived.isIdle() }));
	const disabled = $derived(key === 'spin_disabled');
	// Reels rolling on a plain bet (NOT an autoplay sequence) → the spin frame spins.
	const spinning = $derived(
		context.stateXstateDerived.isPlaying() && !stateBetDerived.hasAutoBetCounter(),
	);
	// The BUTTON stays live during a press-to-continue (the overlay covers it, so a click lands on
	// whichever is on top and both fast-forward the presentation — one click, one action either
	// way). Only the Space HOTKEY has to stand down, because it is a second global subscriber that
	// would otherwise fire alongside the overlay's own.
	const hotkeyDisabled = $derived(disabled || hasContinuePress());
</script>

{@render props.children({ key, onpress, disabled, spinning, hotkeyDisabled })}
