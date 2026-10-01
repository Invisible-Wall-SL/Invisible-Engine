<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { BoardContainer, SYMBOL_SIZE } from 'engine-game';

	import HoldAndWinLetter from './HoldAndWinLetter.svelte';
	import { configuredLetters } from '../game/holdAndWinLetters.svelte';
	import { configuredMeters } from '../game/holdAndWinMeters.svelte';
	import { cellWindow, getSymbolX } from '../game/stateGame.svelte';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';

	/**
	 * THE CODED COLUMN LETTERS (design §1.2 Grand) — "G R A N D" above the respin board, one letter
	 * over each reel, lit as its column completes (`holdAndWinLetters.svelte.ts`). The default for a
	 * project that authored none: Phase 6's `letters` component binds the same state through the
	 * `lettersLit` / `letter.<reel>.lit` sources.
	 *
	 * Mounted only while the respin board is up, and only for a config whose board ends on column
	 * letters — every other game mounts nothing here. A zIndex seat over the respin board it shares a
	 * parent with, so its paint order never depends on which mounted first. Above the counter's line,
	 * and above the pots' row too when a config has both.
	 */
	const letters = $derived(stateRespinBoard.shown ? configuredLetters() : []);
	const y = $derived(
		cellWindow(0, 0).top - SYMBOL_SIZE * (configuredMeters().length > 0 ? 1.15 : 0.72),
	);
</script>

{#if letters.length > 0}
	<Container zIndex={1}>
		<BoardContainer>
			{#each letters as letter, reel (reel)}
				<HoldAndWinLetter {reel} {letter} x={getSymbolX(reel)} {y} />
			{/each}
		</BoardContainer>
	</Container>
{/if}
