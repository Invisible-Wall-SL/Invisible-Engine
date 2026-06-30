<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';

	import { completeActiveScreen, emitFlowSignal } from '../game/flowInterpreterHolder';
	import PressToContinue from './PressToContinue.svelte';

	// The coded press surface behind the engine-layout `tapToContinue` toggle (the
	// `implement` half of the SHARED overlay capability — engine-layout declares the
	// toggle + this `bind` slot, the game owns the wiring; registered via
	// `registerBoundComponents({ TapToContinue })`). `<ComponentInstance>` mounts this
	// over an overlay instance whose `tapToContinue` param is on, passing the authored
	// `tapSignal` AND the per-instance dim/prompt style (`dimColor`/`dimAlpha`/
	// `hidePrompt`). A tap anywhere (full-screen) or the Space key runs BOTH Flow holder
	// APIs (owner chose "Both"): `completeActiveScreen()` runs the active screen's exit +
	// fires its `complete` pin, and `emitFlowSignal(signal)` fires any active-screen
	// `{kind:'signal'}` edge. Both are SAFE no-ops with no active interpreter / no
	// listener (the holder helpers return false). An empty signal only completes.
	//
	// The dim + prompt reuse the SAME primitives as the engine-owned free-spin gate
	// (`FreeSpinIntroGate`): a full-screen `CanvasSizeRectangle` behind the hit area +
	// `PressToContinue` (which owns the `OnPressFullScreen` + Space hotkey + the prompt
	// graphic). PARITY: `dimAlpha` defaults to 0 ⇒ a fully transparent backdrop ⇒ an
	// instance with no dim params renders byte-identically to today's transparent tap.
	type Props = {
		signal?: string;
		dimColor?: number;
		dimAlpha?: number;
		hidePrompt?: boolean;
	};
	const props: Props = $props();

	const onTap = (): void => {
		void completeActiveScreen();
		const signal = props.signal?.trim();
		if (signal) void emitFlowSignal(signal);
	};
</script>

<CanvasSizeRectangle backgroundColor={props.dimColor ?? 0x000000} backgroundAlpha={props.dimAlpha ?? 0} />
<PressToContinue onpress={onTap} hidePrompt={props.hidePrompt} />
