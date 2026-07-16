<script lang="ts">
	import { Container, BitmapText, type BitmapTextProps } from 'pixi-svelte';

	type Props = Omit<BitmapTextProps, 'scale' | 'onresize'> & {
		maxWidth: number;
		/** The text's RENDERED size — measured, with the shrink-to-fit scale already applied, i.e. the
		 *  box it actually occupies. Fires whenever the text or that scale changes. For a caller that
		 *  must LAY OUT around the text (e.g. keeping a win amount inside the reel window); it can't be
		 *  derived from `maxWidth`, which is only the cap, not the drawn width. */
		onresize?: (sizes: { width: number; height: number }) => void;
	};

	const { maxWidth, onresize, ...textProps }: Props = $props();
	let baseSizes = $state({ width: 0, height: 0 });
	const responsiveScale = $derived(maxWidth / (baseSizes.width || 1));
	const appliedScale = $derived(Math.min(responsiveScale, 1));

	$effect(() => {
		onresize?.({ width: baseSizes.width * appliedScale, height: baseSizes.height * appliedScale });
	});
</script>

<Container visible={false}>
	<BitmapText {...textProps} onresize={(sizes) => (baseSizes = sizes)} />
</Container>

<Container>
	<BitmapText {...textProps} scale={appliedScale} />
</Container>
