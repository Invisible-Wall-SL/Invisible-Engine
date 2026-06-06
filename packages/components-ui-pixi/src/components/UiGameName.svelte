<script lang="ts">
	import { SvelteDate } from 'svelte/reactivity';

	import { Text, REM } from 'pixi-svelte';
	import { WHITE } from 'constants-shared/colors';
	import type { HudTextOverride } from 'engine-layout';

	type Props = {
		name: string;
		/** Editor-authored font/text override (merged over the coded base style). */
		override?: HudTextOverride;
	};

	const props: Props = $props();
	const reactiveDate = new SvelteDate();
	const clock = $derived(
		reactiveDate.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: 'numeric',
			hour12: false,
		}),
	);
	const baseStyle = {
		fontFamily: 'proxima-nova',
		fontSize: REM * 1.5,
		fontWeight: '600',
		lineHeight: REM * 2,
		fill: WHITE,
	} as const;
	// Merge the editor-authored override over the coded base (font/size/fill); the
	// override `text` replaces only the name, not the clock.
	const style = $derived({ ...baseStyle, ...props.override?.style });
	const displayName = $derived(props.override?.text ?? props.name);

	let clockSizes = $state({ width: 0, height: 0 });

	$effect(() => {
		const interval = setInterval(() => {
			reactiveDate.setTime(Date.now());
		}, 1000);

		return () => {
			clearInterval(interval);
		};
	});
</script>

<Text text={clock} onresize={(value) => (clockSizes = value)} {style} />
<Text text={displayName} x={clockSizes.width + 5} {style} />
