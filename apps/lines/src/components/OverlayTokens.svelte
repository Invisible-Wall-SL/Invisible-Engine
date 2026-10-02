<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { BoardContainer } from 'engine-game';

	import OverlayToken from './OverlayToken.svelte';
	import { overlayTokenKey, stateOverlay } from '../game/stateOverlay.svelte';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';

	/**
	 * THE OVERLAY LAYER (`docs/design/pots-overlay.md` §3.4) — the tokens a pots overlay drops, drawn
	 * over the reel board's symbols and under everything the game draws above the board (the win
	 * line, the flights). It shares the board's seats, so a stepped or perspective board places its
	 * tokens where its own symbols stand.
	 *
	 * MOUNTED FOR EVERY GAME, DRAWS NOTHING WITHOUT A TOKEN: the outer container is unconditional so
	 * its seat in the board stack is fixed at mount (pixi-svelte freezes child order then). A game
	 * whose RGS never drops a token pays one empty container. Hidden while the respin board covers the
	 * reels, as the reel board is.
	 */
</script>

<Container visible={!stateRespinBoard.shown}>
	{#if stateOverlay.tokens.length > 0}
		<BoardContainer>
			{#each stateOverlay.tokens as token (overlayTokenKey(token.reel, token.row))}
				<OverlayToken {token} />
			{/each}
		</BoardContainer>
	{/if}
</Container>
