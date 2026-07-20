<script lang="ts" module>
	export type EmitterEventBoardFrame =
		| { type: 'boardFrameGlowShow' }
		| { type: 'boardFrameGlowHide' };
</script>

<script lang="ts">
	import { SpineProvider, SpineTrack } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { bakedBoardGlow } from '../editor-scenes';

	const context = getContext();
	const POSITION_ADJUSTMENT = 1.01;

	// The free-spin glow, authored in the Invisible Symbols State Machine (art / `.irig` rig +
	// renamed animations + fit ratio). Every field is a SPARSE override: unset falls through to the
	// coded `reelhouse` constants below, so an un-authored game renders byte-identically. The engine
	// still OWNS the start→idle→exit chaining — the author swaps WHAT plays, not the sequence.
	const glow = bakedBoardGlow();
	const SPINE_KEY = glow?.assetKey ?? 'reelhouse';
	const START = glow?.animations?.start ?? 'reelhouse_glow_start';
	const IDLE = glow?.animations?.idle ?? 'reelhouse_glow_idle';
	const EXIT = glow?.animations?.exit ?? 'reelhouse_glow_exit';
	const SPINE_SCALE = glow?.sizeRatios ?? { width: 0.62, height: 0.66 };

	// Whether the glow should be LIT, tracked by the always-mounted `<Game>` off the
	// `boardFrameGlow*` cues. Driven as STATE rather than by subscribing to the cues here: this
	// component lives inside the base-game block, which unmounts whenever that screen leaves the
	// active set (a flow hiding `basegame` for a transition), and a cue fired while unmounted would
	// be lost with no way to recover it. Reading a flag instead means a remount mid-feature RE-ARMS
	// — it replays start→idle as the board returns — instead of coming back dark forever.
	const { active = false }: { active?: boolean } = $props();

	let animationName = $state<string | undefined>(undefined);
	let loop = $state(false);

	// Both the initial mount and every later edge run through here, so there is ONE path into the
	// chain. Entering `active` from idle-dark plays start (→ idle, via the `complete` listener);
	// leaving it plays exit. Guarded on the current animation so a re-entry mid-exit doesn't
	// restart the chain — it lands back on start once exit finishes and this re-runs.
	$effect(() => {
		if (active) {
			if (!animationName) {
				animationName = START;
				loop = false;
			}
		} else if (animationName && animationName !== EXIT) {
			animationName = EXIT;
			loop = false;
		}
	});
</script>

{#if animationName}
	<SpineProvider
		zIndex={-1}
		key={SPINE_KEY}
		x={context.stateGameDerived.boardLayout().x * POSITION_ADJUSTMENT}
		y={context.stateGameDerived.boardLayout().y * POSITION_ADJUSTMENT}
		width={context.stateGameDerived.boardLayout().width *
			SPINE_SCALE.width *
			context.stateGameDerived.boardLayout().scale}
		height={context.stateGameDerived.boardLayout().height *
			SPINE_SCALE.height *
			context.stateGameDerived.boardLayout().scale}
	>
		<SpineTrack
			trackIndex={0}
			{animationName}
			{loop}
			listener={{
				complete: (entry) => {
					if (entry.animation) {
						if (entry.animation.name === START) {
							animationName = IDLE;
							loop = true;
						}

						if (entry.animation.name === EXIT) {
							animationName = undefined;
							loop = false;
						}
					}
				},
			}}
		/>
	</SpineProvider>
{/if}
