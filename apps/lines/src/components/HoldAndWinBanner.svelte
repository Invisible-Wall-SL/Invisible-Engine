<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { MainContainer } from 'components-layout';
	import { BoardContainer, SYMBOL_SIZE } from 'engine-game';
	import { Container, Rectangle, Text } from 'pixi-svelte';
	import { HOLD_AND_WIN_BANNER_SCREENS } from 'engine-layout';
	import { isComponentMounted, sceneMountKey } from 'engine-layout/svelte';

	import { stateGameDerived } from '../game/stateGame.svelte';
	import { stateHoldAndWinBanner } from '../game/holdAndWinBanner.svelte';

	/**
	 * THE CODED HOLD AND WIN BANNER — the Lucky Spin intro, a jackpot celebration (large) and a coin
	 * jackpot in the tally (small), centred on the board (`holdAndWinBanner.svelte.ts`). Mounted in the
	 * flights band at a zIndex seat above the flight layer and the wheel, so a coin flying into the
	 * Total Win bar passes under it, and below the pinned takeovers (a big win follows it, never
	 * overlaps it).
	 *
	 * Nothing is mounted until a banner is up, so a game that never receives a Hold and Win event pays
	 * nothing for it. A Lucky Spin / jackpot banner steps aside while the flow shows the authored
	 * screen for that beat (`HOLD_AND_WIN_BANNER_SCREENS`), which draws it instead.
	 */
	const authoredScreen = (kind: string): string | undefined =>
		(HOLD_AND_WIN_BANNER_SCREENS as Record<string, string>)[kind];
	const banner = $derived.by(() => {
		const current = stateHoldAndWinBanner.current;
		const screen = current && authoredScreen(current.kind);
		return screen && isComponentMounted(sceneMountKey(screen)) ? null : current;
	});
	const centre = $derived.by(() => {
		const { width, height } = stateGameDerived.boardLayout();
		return { x: width / 2, y: height / 2 };
	});

	const pop = new Tween(1);
	let seen = 0;
	$effect(() => {
		const id = banner?.id ?? 0;
		if (!id || id === seen) return;
		seen = id;
		pop.set(0.6, { duration: 0 }).then(() => pop.set(1, { duration: 450, easing: backOut }));
	});

	const large = $derived(banner?.size === 'large');
	const titleSize = $derived(SYMBOL_SIZE * (large ? 0.55 : 0.28));
	const detailSize = $derived(SYMBOL_SIZE * (large ? 0.3 : 0.2));
	const width = $derived(SYMBOL_SIZE * (large ? 4.2 : 2.2));
	const height = $derived(banner?.detail ? titleSize + detailSize * 1.9 : titleSize * 1.6);
</script>

{#if banner}
	<Container zIndex={2}>
		<MainContainer>
			<BoardContainer>
				<Container x={centre.x} y={centre.y} scale={pop.current}>
					<Rectangle
						anchor={0.5}
						{width}
						{height}
						borderRadius={height / 4}
						backgroundColor={0x000000}
						backgroundAlpha={0.72}
						borderColor={0xffd24a}
						borderWidth={large ? 6 : 3}
					/>
					<Text
						anchor={0.5}
						y={banner.detail ? -detailSize * 0.6 : 0}
						text={banner.title}
						style={{
							fontFamily: 'Arial',
							fontWeight: 'bold',
							fontSize: titleSize,
							fill: 0xffd24a,
							stroke: { color: 0x000000, width: large ? 8 : 5 },
						}}
					/>
					{#if banner.detail}
						<Text
							anchor={0.5}
							y={titleSize * 0.55}
							text={banner.detail}
							style={{
								fontFamily: 'Arial',
								fontWeight: 'bold',
								fontSize: detailSize,
								fill: 0xffffff,
								stroke: { color: 0x000000, width: 5 },
							}}
						/>
					{/if}
				</Container>
			</BoardContainer>
		</MainContainer>
	</Container>
{/if}
