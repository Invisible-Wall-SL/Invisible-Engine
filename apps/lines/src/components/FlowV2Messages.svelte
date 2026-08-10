<script lang="ts">
	/**
	 * Invisible Flow v2 (§6.3) — the in-game TEXT MESSAGE overlay. Renders one localized `<Text>` per
	 * authored `textMessage` node at its normalized `place`, inside the MAIN design canvas so a message
	 * lands at the SAME spot across every layout (the box is `mainLayout.width`×`mainLayout.height`,
	 * pivoted to the canvas centre by `<MainContainer>` — so a place of {0.5,0.5} is dead-centre).
	 *
	 * Visibility per node is `gateMatches(node.visibleWhile) OR flow.messageShown(node.id)` — the OR
	 * serves BOTH real use cases with one rule: a STATE-GATED message ("Click spin to start",
	 * `visibleWhile:'idle'`) shows whenever its round-phase gate is on, while a FLOW-DRIVEN message
	 * ("Good luck", a bare `show` exec + `autoHideMs`) shows while the interpreter's reactive
	 * shown-flag is raised. `messageShown` reads a `SvelteSet` in the runtime, so this render re-runs
	 * on every show/hide/auto-hide toggle.
	 *
	 * This overlay is DELIBERATELY independent of the shared single-slot `stateMessage` HUD toast
	 * (which auto-clears at 2600ms and is clobbered by win toasts) and of `flowV2DrivesScreens` — a
	 * book-events-only flow that owns no screens can still author messages. Inert (renders nothing)
	 * when no v2 flow is authored or no message nodes exist (parity).
	 */
	import { Text } from 'pixi-svelte';
	import { MainContainer } from 'components-layout';
	import { getContextLayout } from 'utils-layout';
	import { resolveLocalizedText } from 'engine-layout';
	import type { TextMessageNode } from 'engine-flow-v2';

	import { stateXstateDerived } from '../game/stateXstate';
	import { stateGame } from '../game/stateGame.svelte';
	import type { LinesFlowV2 } from '../game/flowV2Runtime.svelte';

	const { flow }: { flow: LinesFlowV2 | undefined } = $props();

	const { stateLayoutDerived } = getContextLayout();
	// The authored GAME box (doc `mainSizesMap`) — the coordinate space `<MainContainer>` scales,
	// so `place` (a 0..1 fraction) maps to a fixed design point regardless of viewport size.
	const mainLayout = $derived.by(stateLayoutDerived.mainLayout);

	const DEFAULT_FONT_SIZE = 40;
	const DEFAULT_COLOR = 0xffffff;

	/** The reactive round-phase gate. `messageShown` (the flow-driven flag) is OR-ed with this. */
	const gateMatches = (gate: TextMessageNode['visibleWhile']): boolean => {
		switch (gate) {
			case 'always':
				return true;
			case 'idle':
				return stateXstateDerived.isIdle();
			case 'spinning':
				return stateXstateDerived.isPlaying();
			case 'freeSpins':
				// The accurate "free spins active" signal is the game MODE flag — set to `freegame` by the
				// freeSpin book events and back to `basegame` when the feature ends — NOT
				// `stateUi.freeSpinCounterShow`, which is a HUD-visibility flag the intro/outro celebration
				// screens flip off MID-feature (so it would drop the message while free spins are still on).
				return stateGame.gameType === 'freegame';
			default:
				return false; // 'none' | undefined ⇒ visibility driven solely by show/hide exec.
		}
	};
</script>

{#if flow}
	<MainContainer>
		{#each flow.textMessages as node (node.id)}
			{#if gateMatches(node.visibleWhile) || flow.messageShown(node.id)}
				<Text
					x={node.place.x * mainLayout.width}
					y={node.place.y * mainLayout.height}
					anchor={0.5}
					text={resolveLocalizedText(node.text)}
					style={{
						fontFamily: 'proxima-nova',
						fontSize: node.style?.size ?? DEFAULT_FONT_SIZE,
						fontWeight: '700',
						fill: node.style?.color ?? DEFAULT_COLOR,
						align: 'center',
						stroke: { color: 0x000000, width: 4 },
						dropShadow: {
							color: 0x000000,
							alpha: 0.5,
							blur: 4,
							angle: Math.PI / 2,
							distance: 2,
						},
					}}
				/>
			{/if}
		{/each}
	</MainContainer>
{/if}
