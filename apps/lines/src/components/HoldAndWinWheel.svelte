<script lang="ts">
	import { MainContainer } from 'components-layout';
	import {
		BoardContainer,
		wheelPrizeLabel,
		wheelSegmentAngle,
		wheelSegmentCentre,
		type HoldAndWinWheelPrize,
	} from 'engine-game';
	import { Container, Graphics, Text, type GraphicsProps } from 'pixi-svelte';

	import { stateGameDerived } from '../game/stateGame.svelte';
	import { stateWheel, wheelRotation } from '../game/holdAndWinWheel.svelte';

	/**
	 * THE CODED PRE-FEATURE WHEEL (`holdAndWinWheel.svelte.ts`) — a segmented circle centred on the
	 * board, one segment per configured prize with its label ("COIN BOOST ×2", "+1 COLLECT", "GRAND"),
	 * a pointer at the top and the landed segment outlined. Mounted in the flights band at a zIndex
	 * seat between the flight layer and the banner (the prize banner reads over it).
	 *
	 * Nothing is mounted until a wheel is up, so a game that never receives `holdAndWinWheel` pays
	 * nothing for it.
	 */
	type PixiGraphics = Parameters<GraphicsProps['draw']>[0];

	const wheel = $derived(stateWheel.current);
	const layout = $derived(stateGameDerived.boardLayout());
	const centre = $derived({ x: layout.width / 2, y: layout.height / 2 });
	const radius = $derived(Math.min(layout.width, layout.height) * 0.46);

	/** Screen angle of the pointer: straight up. */
	const POINTER = -Math.PI / 2;
	const JACKPOT_COLOURS: Record<string, number> = {
		MINI: 0x3fbf5a,
		MINOR: 0x2f7be0,
		MAJOR: 0xe0452f,
		GRAND: 0xe0b030,
	};
	const colourOf = (prize: HoldAndWinWheelPrize, index: number): number => {
		if (prize.type === 'jackpot') return JACKPOT_COLOURS[prize.jackpot] ?? 0xb06030;
		if (prize.type === 'coinBoost') return index % 2 ? 0x7a3fd0 : 0x9a5fe8;
		return index % 2 ? 0x1f6fb0 : 0x2f8fd0;
	};

	const drawSegments = (g: PixiGraphics) => {
		if (!wheel) return;
		const count = wheel.prizes.length;
		const half = wheelSegmentAngle(count) / 2;
		wheel.prizes.forEach((prize, index) => {
			const mid = POINTER + wheelSegmentCentre(index, count);
			g.moveTo(0, 0)
				.arc(0, 0, radius, mid - half, mid + half)
				.lineTo(0, 0)
				.fill({ color: colourOf(prize, index) })
				.stroke({ color: 0x1a1a1a, width: 4 });
		});
		g.circle(0, 0, radius).stroke({ color: 0xffd24a, width: 10 });
		g.circle(0, 0, radius * 0.16)
			.fill({ color: 0xffd24a })
			.stroke({ color: 0x7a3d00, width: 6 });
	};

	const drawLanded = (g: PixiGraphics) => {
		if (!wheel || wheel.landed === null) return;
		const count = wheel.prizes.length;
		const half = wheelSegmentAngle(count) / 2;
		const mid = POINTER + wheelSegmentCentre(wheel.landed, count);
		g.moveTo(0, 0)
			.arc(0, 0, radius, mid - half, mid + half)
			.lineTo(0, 0)
			.fill({ color: 0xffffff, alpha: 0.18 })
			.stroke({ color: 0xffffff, width: 8 });
	};

	const drawPointer = (g: PixiGraphics) => {
		const size = radius * 0.14;
		g.moveTo(-size * 0.7, -radius - size * 0.9)
			.lineTo(size * 0.7, -radius - size * 0.9)
			.lineTo(0, -radius + size * 0.5)
			.closePath()
			.fill({ color: 0xffffff })
			.stroke({ color: 0x1a1a1a, width: 4 });
	};

	const labelSize = $derived(radius * 0.09);
	/** Labels run along the rim (upright on the landed segment, which ends under the pointer), so a
	 *  long one breaks at its last space: "COIN BOOST / ×2". */
	const twoLines = (label: string) => {
		const cut = label.lastIndexOf(' ');
		return cut > 0 ? `${label.slice(0, cut)}\n${label.slice(cut + 1)}` : label;
	};
</script>

{#if wheel}
	<Container zIndex={1}>
		<MainContainer>
			<BoardContainer>
				<Container x={centre.x} y={centre.y}>
					<Container rotation={wheelRotation.current}>
						<Graphics draw={drawSegments} />
						{#each wheel.prizes as prize, index (index)}
							{@const angle = POINTER + wheelSegmentCentre(index, wheel.prizes.length)}
							<Text
								x={Math.cos(angle) * radius * 0.58}
								y={Math.sin(angle) * radius * 0.58}
								rotation={angle + Math.PI / 2}
								anchor={0.5}
								text={twoLines(wheelPrizeLabel(prize))}
								style={{
									align: 'center',
									fontFamily: 'Arial',
									fontWeight: 'bold',
									fontSize: labelSize,
									fill: 0xffffff,
									stroke: { color: 0x000000, width: 4 },
								}}
							/>
						{/each}
						<Graphics draw={drawLanded} />
					</Container>
					<Graphics draw={drawPointer} />
				</Container>
			</BoardContainer>
		</MainContainer>
	</Container>
{/if}
