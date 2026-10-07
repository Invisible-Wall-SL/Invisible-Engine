<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		anchorToPivot,
		Container,
		RigProvider,
		RigSlot,
		RigTrack,
		type Sizes,
	} from 'pixi-svelte';
	import { MainContainer } from 'components-layout';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE, BOARD_DIMENSIONS } from '../game/constants';

	type Props = {
		children: Snippet<[{ sizes: Sizes }]>;
	};

	const props: Props = $props();

	type AnimationName = 'intro' | 'idle';

	const context = getContext();
	const BACKGROUND_RATIO = 920 / 720;
	const BACKGROUND_WIDTH = SYMBOL_SIZE * BOARD_DIMENSIONS.y;
	const BACKGROUND_SIZES = {
		width: BACKGROUND_WIDTH,
		height: BACKGROUND_WIDTH / BACKGROUND_RATIO,
	};
	const PANEL_SIZES = {
		width: SYMBOL_SIZE * BOARD_DIMENSIONS.y,
		height: SYMBOL_SIZE * BOARD_DIMENSIONS.y,
	};

	let animationName = $state<AnimationName>('intro');
</script>

<MainContainer>
	<Container
		x={context.stateGameDerived.boardLayout().x}
		y={context.stateGameDerived.boardLayout().y}
		pivot={anchorToPivot({ anchor: 0.5, sizes: BACKGROUND_SIZES })}
	>
		<RigProvider
			key="fsIntro"
			width={PANEL_SIZES.width}
			x={PANEL_SIZES.width * 0.5}
			y={PANEL_SIZES.height * 0.4}
		>
			<RigTrack
				trackIndex={0}
				{animationName}
				loop={animationName === 'idle'}
				listener={{
					complete: () => (animationName = 'idle'),
				}}
			/>
			<RigSlot slotName="slot_text_placeholder">
				{@render props.children({ sizes: BACKGROUND_SIZES })}
			</RigSlot>
		</RigProvider>
	</Container>
</MainContainer>
