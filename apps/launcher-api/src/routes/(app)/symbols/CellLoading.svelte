<script lang="ts">
	// Indeterminate loading bar for a symbol grid cell — shown while its preview
	// fetches from R2 (the sprite-sheet region scan, or the spine skeleton + pages).
	// Sized to the cell so it reads at any grid scale.
	let { size = 56 }: { size?: number } = $props();
</script>

<div class="wrap" style:width="{size}px" style:height="{size}px">
	<div class="track" style:width="{Math.round(size * 0.6)}px">
		<div class="fill"></div>
	</div>
</div>

<style>
	.wrap {
		display: grid;
		place-items: center;
	}
	.track {
		height: 4px;
		border-radius: 2px;
		background: #20202a;
		overflow: hidden;
	}
	.fill {
		width: 40%;
		height: 100%;
		border-radius: 2px;
		background: #5b8cff;
		animation: slide 1.1s ease-in-out infinite;
	}
	@keyframes slide {
		0% {
			transform: translateX(-110%);
		}
		100% {
			transform: translateX(260%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fill {
			animation-duration: 2.4s;
		}
	}
</style>
