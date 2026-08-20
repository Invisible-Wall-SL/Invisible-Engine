<script lang="ts" module>
	import type { Snippet } from 'svelte';

	import {
		Container,
		Rectangle,
		anchorToPivot,
		type ContainerProps,
		type Sizes,
		type PixiPoint,
	} from 'pixi-svelte';

	type ContainerPropsToOmit =
		| 'eventMode'
		| 'cursor'
		| 'pivot'
		| 'children'
		| 'onpointerover'
		| 'onpointerout'
		| 'onpointerdown'
		| 'onpointerup';

	export type Props = Omit<ContainerProps, ContainerPropsToOmit> & {
		sizes: Sizes;
		onpress: () => void;
		disabled?: boolean;
		anchor?: PixiPoint;
		children: Snippet<
			[
				{
					center: { x: number; y: number };
					hovered: boolean;
					pressed: boolean;
				},
			]
		>;
		debug?: boolean;
	};
</script>

<script lang="ts">
	const { children, sizes, anchor, disabled, onpress, debug, ...containerProps }: Props = $props();
	const center = $derived({
		x: sizes.width * 0.5,
		y: sizes.height * 0.5,
	});

	let hovered = $state(false);
	let pressed = $state(false);

	$effect(() => {
		if (disabled) {
			hovered = false;
			pressed = false;
		}
	});

	// A DISABLED button must not SWALLOW the pointer. Every handler below already early-returns on
	// `disabled`, but the container stayed `eventMode: 'static'`, so it still won the hit test and ate
	// the press — it just did nothing with it. That is why a pointer resting on the spin (or turbo)
	// button made a celebration unskippable: the button is inert under the celebration lock, and the
	// full-screen tap surface of the overlay BENEATH it (`PressToContinue`, `CountUpInteraction`)
	// never saw the gesture, so the player had to move the pointer off the chrome first.
	//
	// `'none'` skips this container AND its children in the hit test, so the press falls through to
	// whatever the overlay put under the chrome. Fixing it here — at the one place a button decides it
	// is inert — is what makes a canvas-top input mask + gesture registry unnecessary.
</script>

<Container
	{...containerProps}
	eventMode={disabled ? 'none' : 'static'}
	cursor={disabled ? 'not-allowed' : 'pointer'}
	pivot={anchorToPivot({ sizes, anchor })}
	onpointerover={() => {
		if (disabled) return;
		hovered = true;
	}}
	onpointerout={() => {
		if (disabled) return;
		hovered = false;
	}}
	onpointerdown={() => {
		if (disabled) return;
		pressed = true;
	}}
	onpointerup={() => {
		if (disabled) return;
		pressed = false;
		onpress();
	}}
>
	{#if debug}
		<Rectangle
			width={sizes.width}
			height={sizes.height}
			alpha={0.5}
			borderWidth={2}
			borderColor={0xffffff}
		/>
	{/if}
	{@render children({ center, hovered, pressed })}
</Container>
