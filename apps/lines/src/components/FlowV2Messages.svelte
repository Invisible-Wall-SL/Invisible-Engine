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
	 *    and sits identically. Priority within that one slot: an EXPLICIT (Show-driven, `messageShown`)
	 *    message claims it; a STATE-GATED message (`visibleWhile`) is the bar's AMBIENT/resting text and
	 *    fills the slot only when nothing else holds it — it yields to a win toast (tracked by
	 *    `stateMessage.current.id`) and refills when the slot clears. We only ever CLEAR a slot we still
	 *    hold. So a "press spin" prompt reads as "only while the game is completely idle".
	 *  - `'anchor'` — an INDEPENDENT `<Text>` overlay at the node's normalized `place`, inside the MAIN
	 *    design canvas so it lands at the same spot across layouts. Use for a persistent / positioned
	 *    prompt that must not share the single slot.
	 *
	 * Independent of `flowV2DrivesScreens` — a book-events-only flow that owns no screens can still
	 * author messages. Inert (renders/sets nothing) when no v2 flow is authored or no message nodes
	 * exist (parity).
	 */
	import { MainContainer } from 'components-layout';
	import { getContextLayout } from 'utils-layout';
	import { resolveLocalizedText } from 'engine-layout';
	import { CatalogText } from 'engine-layout/svelte';
	import { clearMessage, showMessage, stateMessage } from 'state-shared';
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
	// The game's default text font (`HUD_FONT_FAMILY` in engine-layout `builtinComponents`) — so an
	// anchor message with no chosen font reads like the rest of the game's text. `<CatalogText>`
	// resolves this + any picked `style.font` ref through the boot font catalog (web vs bitmap).
	const DEFAULT_FONT_FAMILY = 'proxima-nova';

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

	// Which info-bar messages want the shared slot right now, split by PRIORITY:
	//  - EXPLICIT: raised by a `show` exec (`messageShown`) — an author fired it deliberately, so it
	//    claims the slot (last one wins).
	//  - AMBIENT: shown only by a state gate (`visibleWhile`, e.g. "while idle") — the info bar's
	//    RESTING text ("Click spin button to start"). It fills the slot ONLY when nothing else holds
	//    it, and never overwrites a win toast or an explicit message. This is what makes a standing
	//    "press spin" prompt read as "only while the game is completely idle": the moment the game
	//    puts a win message in the bar, the resting text yields; when the bar clears and the game is at
	//    rest again, it returns.
	const infoBarChoice = $derived.by<{ explicit?: TextMessageNode; ambient?: TextMessageNode }>(
		() => {
			let explicit: TextMessageNode | undefined;
			let ambient: TextMessageNode | undefined;
			for (const n of flow?.textMessages ?? []) {
				if (placementOf(n) !== 'infoBar') continue;
				if (flow?.messageShown(n.id)) explicit = n;
				else if (gateMatches(n.visibleWhile)) ambient = n;
			}
			return { explicit, ambient };
		},
	);

	// Drive the shared message slot. `lastSetId` is the `stateMessage` id WE last wrote (ids are
	// monotonic per `showMessage`), so `weHold` tells whether the slot still carries our message or an
	// external producer (a win toast) has taken it — the ambient/resting message defers to that, and we
	// only ever CLEAR a slot we still hold. `durationMs:0` = hold until we replace/clear it.
	let lastSetId = -1;
	$effect(() => {
		const current = stateMessage.current; // track external changes (win toasts, etc.)
		const { explicit, ambient } = infoBarChoice;
		const weHold = current !== null && current.id === lastSetId;
		// Explicit claims the slot; ambient only fills it when nothing external is already there.
		let want = explicit;
		if (!want && ambient && !(current !== null && !weHold)) want = ambient;
		if (!want) {
			if (weHold) clearMessage();
			lastSetId = -1;
			return;
		}
		const text = resolveLocalizedText(want.text);
		if (!weHold || current?.text !== text) {
			showMessage(text, { durationMs: 0 });
			lastSetId = stateMessage.current?.id ?? -1;
		}
	});
</script>

{#if flow && anchorNodes.length}
	<MainContainer>
		{#each anchorNodes as node (node.id)}
			{#if isVisible(node)}
				<CatalogText
					x={node.place.x * mainLayout.width}
					y={node.place.y * mainLayout.height}
					anchor={0.5}
					text={resolveLocalizedText(node.text)}
					style={{
						fontFamily: node.style?.font ?? DEFAULT_FONT_FAMILY,
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
