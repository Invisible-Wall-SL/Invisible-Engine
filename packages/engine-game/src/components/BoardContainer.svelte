<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';

	import { getGameContext } from '../game/context';

	type Props = {
		children: Snippet;
		/** Hidden while `false`; left as it is when omitted (every caller but a board kept between its
		 *  showings, the Hold and Win respin board). */
		visible?: boolean;
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
