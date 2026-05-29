<script lang="ts">
	// Invisible Wall emblem — inlined so it inherits `currentColor` (an external
	// <img> SVG would render currentColor as black). Source of truth:
	// Company Website/Images/iw-emblem.svg (also static/brand/iw-emblem.svg).
	let { height = 20 }: { height?: number } = $props();
</script>

<svg
	class="emblem"
	{height}
	width={(height * 366) / 304}
	viewBox="0 0 366 304"
	preserveAspectRatio="xMidYMid meet"
	aria-hidden="true"
>
	<g fill="currentColor">
		<polygon points="20,50 40,73 336,9 336,5" />
		<polygon points="13,55 28,80 21,278 17,278" />
	</g>
</svg>

<style>
	.emblem {
		display: block;
		flex: none;
	}
</style>
