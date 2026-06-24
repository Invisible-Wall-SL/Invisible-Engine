<script lang="ts">
	import { OnPressFullScreen } from 'components-layout';
	import { OnHotkey } from 'components-shared';

	import { completeActiveScreen, emitFlowSignal } from '../game/flowInterpreterHolder';

	// The coded press surface behind the engine-layout `tapToContinue` toggle (the
	// `implement` half of the SHARED overlay capability — engine-layout declares the
	// toggle + this `bind` slot, the game owns the wiring; registered via
	// `registerBoundComponents({ TapToContinue })`). `<ComponentInstance>` mounts this
	// over an overlay instance whose `tapToContinue` param is on, passing the authored
	// `tapSignal`. A tap anywhere (full-screen) or the Space key runs BOTH Flow holder
	// APIs (owner chose "Both"): `completeActiveScreen()` runs the active screen's exit
	// + fires its `complete` pin, and `emitFlowSignal(signal)` fires any active-screen
	// `{kind:'signal'}` edge. Both are SAFE no-ops with no active interpreter / no
	// listener (the holder helpers return false). An empty signal only completes.
	type Props = { signal?: string };
	const props: Props = $props();

	const onTap = (): void => {
		void completeActiveScreen();
		const signal = props.signal?.trim();
		if (signal) void emitFlowSignal(signal);
	};
</script>

<OnHotkey hotkey="Space" onpress={onTap} />
<OnPressFullScreen onpress={onTap} />
