<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';

	import { getGameContext } from '../game/context';

	type Props = {
		/**
		 * Draw this board layer? Absent ⇒ the prop is never assigned (`propsSyncEffect` skips
		 * `undefined`), so every caller that does not pass it keeps the scene graph it always had.
		 *
		 * It exists so a board can be taken OFF SCREEN without being taken apart. `apps/lines` hands
		 * the board to the cascade overlay mid-round (`boardHide` → overlay → `boardShow`), and
		 * unmounting for that hand-over destroys every symbol cell and rebuilds it on the way back —
		 * which restarts each cell's animation from its first frame. Hidden instead of unmounted, the
		 * cells live across the hand-over and a symbol that did not change keeps playing.
		 */
		visible?: boolean;
		children: Snippet;
	};

	const props: Props = $props();

	const context = getGameContext();
</script>

<Container
	x={context.stateGameDerived.boardLayout().x}
	y={context.stateGameDerived.boardLayout().y}
	pivot={context.stateGameDerived.boardLayout().pivot}
	scale={context.stateGameDerived.boardLayout().scale}
	visible={props.visible}
>
	{@render props.children()}
</Container>
