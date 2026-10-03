<script lang="ts">
	import type { Snippet } from 'svelte';
	import { wheelSegmentAngle, wheelSegmentCentre, type HoldAndWinWheelPrize } from 'engine-game';
	import { parseScopedFrameRef, readWheelSkin, type WheelSkin } from 'engine-layout';
	import { CatalogText } from 'engine-layout/svelte';
	import { Container, Graphics, Sprite, type GraphicsProps } from 'pixi-svelte';

	import { wheelPrizeText } from '../game/holdAndWinText';
	import { stateWheel, wheelRotation } from '../game/holdAndWinWheel.svelte';

	/**
	 * THE PRE-FEATURE WHEEL'S ART, centred on the origin (`holdAndWinWheel.svelte.ts`): one segment per
	 * configured prize with its label ("COIN BOOST ×2", "+1 COLLECT", "GRAND"), turning with the spin,
	 * a pointer at the top and the landed segment outlined. Drawn by the coded wheel (board-centred,
	 * `HoldAndWinWheel`) and by an authored `wheel` component (`HoldAndWinWheelPart`), so both show the
	 * same beat. Draws nothing until a wheel is up.
	 *
	 * An authored wheel (Phase 12c) swaps in its art — a face that turns, a rim and a pointer that
	 * stay put — and its own nodes turn with the face in place of the coded segments. The labels and
	 * the landed outline keep their coded drawing unless switched off. The spin stays here either way.
	 */
	type PixiGraphics = Parameters<GraphicsProps['draw']>[0];

	const CODED_LOOK = readWheelSkin(() => undefined);
	const {
		radius,
		look = CODED_LOOK,
		skin,
	}: {
		radius: number;
		/** An authored wheel's art and label params; absent ⇒ the coded wheel. */
		look?: WheelSkin;
		/** The author's own nodes inside the part: they turn with the face, over its art and under the
		 *  rim. */
		skin?: Snippet;
	} = $props();

	const wheel = $derived(stateWheel.current);
	const artSize = $derived(look.artSize ?? radius * 2);
	const fallbackKey = (key: string) => parseScopedFrameRef(key).region || undefined;

	/** Screen angle of the pointer: straight up. */
	const POINTER = -Math.PI / 2;
	/** The coded pointer's size, and where its tip sits (in radii, up from the centre) — where an
	 *  authored pointer image's bottom edge goes. */
	const POINTER_SIZE = 0.14;
	const POINTER_TIP = -1 + POINTER_SIZE / 2;
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
		const size = radius * POINTER_SIZE;
		g.moveTo(-size * 0.7, -radius - size * 0.9)
			.lineTo(size * 0.7, -radius - size * 0.9)
			.lineTo(0, -radius + size * 0.5)
			.closePath()
			.fill({ color: 0xffffff })
			.stroke({ color: 0x1a1a1a, width: 4 });
	};

	const labelSize = $derived(radius * 0.09 * look.labelScale);
	/** Labels run along the rim (upright on the landed segment, which ends under the pointer), so a
	 *  long one breaks at its last space: "COIN BOOST / ×2". */
	const twoLines = (label: string) => {
		const cut = label.lastIndexOf(' ');
		return cut > 0 ? `${label.slice(0, cut)}\n${label.slice(cut + 1)}` : label;
	};
</script>

<!-- One always-mounted container per layer: pixi-svelte appends a child when it MOUNTS, so a layer
     that appears later must not land above the ones drawn over it. -->
{#if wheel}
	<Container rotation={wheelRotation.current}>
		<Container>
			{#if look.face}
				<Sprite
					key={look.face}
					fallbackKey={fallbackKey(look.face)}
					anchor={0.5}
					width={artSize}
					height={artSize}
				/>
			{:else if !skin}
				<Graphics draw={drawSegments} />
			{/if}
		</Container>
		<Container>
			{#if skin}
				{@render skin()}
			{/if}
		</Container>
		<Container>
			{#if look.showLabels}
				{#each wheel.prizes as prize, index (index)}
					{@const angle = POINTER + wheelSegmentCentre(index, wheel.prizes.length)}
					<CatalogText
						x={Math.cos(angle) * radius * 0.58}
						y={Math.sin(angle) * radius * 0.58}
						rotation={angle + Math.PI / 2}
						anchor={0.5}
						text={twoLines(wheelPrizeText(prize))}
						style={{
							align: 'center',
							fontFamily: look.labelFontFamily ?? 'Arial',
							fontWeight: 'bold',
							fontSize: labelSize,
							fill: look.labelFill ?? 0xffffff,
							stroke: { color: 0x000000, width: 4 },
						}}
					/>
				{/each}
			{/if}
		</Container>
		<Container>
			{#if look.showLanded}
				<Graphics draw={drawLanded} />
			{/if}
		</Container>
	</Container>
	<Container>
		{#if look.rim}
			<Sprite
				key={look.rim}
				fallbackKey={fallbackKey(look.rim)}
				anchor={0.5}
				width={artSize}
				height={artSize}
			/>
		{/if}
	</Container>
	<Container>
		{#if look.pointer}
			<Sprite
				key={look.pointer}
				fallbackKey={fallbackKey(look.pointer)}
				anchor={{ x: 0.5, y: 1 }}
				y={POINTER_TIP * radius}
			/>
		{:else}
			<Graphics draw={drawPointer} />
		{/if}
	</Container>
{/if}
