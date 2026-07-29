<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: Snippet;
		description: Snippet;
		price: Snippet;
		button: Snippet;
		/** Optional card art (Invisible Game Config bet-mode icon). Omitted when the mode has no icon. */
		icon?: Snippet;
	};

	const props: Props = $props();
</script>

<div class="bonus-card-wrap">
	<div class="info">
		{#if props.icon}
			{@render props.icon()}
		{/if}
		{@render props.title()}
		{@render props.description()}
		{@render props.price()}
	</div>
	{@render props.button()}
</div>

<style lang="scss">
	.bonus-card-wrap {
		padding: 0.5rem;
		flex-direction: column;
		display: flex;
		justify-content: space-between;

		border-radius: 10px;
		background: rgba(0, 0, 0, 0.5);
		text-align: left;
		min-width: 155px;
		max-width: 180px;
		gap: 0.5rem;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 0.5em;
	}
</style>
