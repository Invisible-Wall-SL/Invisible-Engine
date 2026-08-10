<script lang="ts">
	/**
	 * Invisible Flow v2 (§6.3) — the in-game TEXT MESSAGE renderer. Each authored `textMessage` node
	 * is visible when `gateMatches(node.visibleWhile) OR flow.messageShown(node.id)` — the OR serves
	 * BOTH use cases with one rule: a STATE-GATED message ("Click spin to start", `visibleWhile:'idle'`)
	 * shows whenever its round-phase gate is on, while a FLOW-DRIVEN message ("Good luck", a bare `show`
	 * exec + `autoHideMs`) shows while the interpreter's reactive shown-flag is raised. `messageShown`
	 * reads a `SvelteSet` in the runtime, so this render re-runs on every show/hide/auto-hide toggle.
	 *
	 * A node's `placement` picks WHERE it draws:
	 *  - `'infoBar'` (default) — routed through the game's SHARED single-slot message channel
	 *    (`showMessage`/`stateMessage`), the exact slot win toasts + other messages use, so it looks
	 *    and sits identically. Only ONE message occupies that slot: the last visible info-bar node
	 *    wins, and we only ever CLEAR the slot when we're the one holding it (never wipe a win toast we
	 *    didn't set). A simultaneous win toast can still replace an info-bar message — that is the
	 *    single-slot's nature, matching every other producer.
	 *  - `'anchor'` — an INDEPENDENT `<Text>` overlay at the node's normalized `place`, inside the MAIN
	 *    design canvas so it lands at the same spot across layouts. Use for a persistent / positioned
	 *    prompt that must not share the single slot.
	 *
	 * Independent of `flowV2DrivesScreens` — a book-events-only flow that owns no screens can still
	 * author messages. Inert (renders/sets nothing) when no v2 flow is authored or no message nodes
	 * exist (parity).
	 */
	import { Text } from 'pixi-svelte';
	import { MainContainer } from 'components-layout';
	import { getContextLayout } from 'utils-layout';
	import { resolveLocalizedText } from 'engine-layout';
	import { clearMessage, showMessage } from 'state-shared';
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

	const isVisible = (node: TextMessageNode): boolean =>
		gateMatches(node.visibleWhile) || (flow?.messageShown(node.id) ?? false);

	// Default placement is `'infoBar'` (matches `TEXT_MESSAGE_DEFAULTS`).
	const placementOf = (node: TextMessageNode): NonNullable<TextMessageNode['placement']> =>
		node.placement ?? 'infoBar';

	const anchorNodes = $derived(
		(flow?.textMessages ?? []).filter((n) => placementOf(n) === 'anchor'),
	);

	// The info-bar message to occupy the shared slot RIGHT NOW: the LAST authored visible one (a later
	// node overrides an earlier — a stable, order-based single-slot priority).
	const activeInfoBar = $derived.by<TextMessageNode | undefined>(() => {
		let pick: TextMessageNode | undefined;
		for (const n of flow?.textMessages ?? []) {
			if (placementOf(n) === 'infoBar' && isVisible(n)) pick = n;
		}
		return pick;
	});

	// Drive the shared message slot from `activeInfoBar`. `ownsSlot` is a plain (non-reactive) flag so
	// writing it never re-triggers this effect; it guards the clear so we never wipe a message some
	// OTHER producer (a win toast) put in the slot. `durationMs:0` = hold until we replace/clear it —
	// the node's own `visibleWhile` gate / `autoHideMs` (via `messageShown`) decides when that is.
	let ownsSlot = false;
	$effect(() => {
		const node = activeInfoBar;
		if (node) {
			showMessage(resolveLocalizedText(node.text), { durationMs: 0 });
			ownsSlot = true;
		} else if (ownsSlot) {
			clearMessage();
			ownsSlot = false;
		}
	});
</script>

{#if flow && anchorNodes.length}
	<MainContainer>
		{#each anchorNodes as node (node.id)}
			{#if isVisible(node)}
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
