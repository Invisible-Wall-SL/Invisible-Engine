<script lang="ts">
	type PaneKey = 'before' | 'after' | 'diff';
	type Mode = 'side' | PaneKey;
	interface Pane {
		key: PaneKey;
		caption: string;
		label: string;
		src: string | undefined;
	}

	let {
		before,
		after,
		diff,
		alt,
	}: { before?: string; after?: string; diff?: string; alt: string } = $props();

	const all = $derived<Pane[]>([
		{ key: 'before', caption: 'before (main)', label: 'Before', src: before },
		{ key: 'after', caption: 'after (this change)', label: 'After', src: after },
		{ key: 'diff', caption: 'diff', label: 'Diff', src: diff },
	]);
	const panes = $derived(all.filter((p) => p.src));

	let mode = $state<Mode>('side');
	const shown = $derived.by(() => {
		if (mode === 'side') return panes;
		const one = panes.filter((p) => p.key === mode);
		return one.length ? one : panes;
	});
	const single = $derived(shown.length === 1 && panes.length > 1);

	let failed = $state<Record<string, boolean>>({});
</script>

<div class="compare">
	{#if panes.length > 1}
		<div class="modes" role="group" aria-label="Compare view">
			<button
				type="button"
				class="mode"
				aria-pressed={mode === 'side'}
				onclick={() => (mode = 'side')}
			>
				Side by side
			</button>
			{#each panes as p (p.key)}
				<button
					type="button"
					class="mode"
					aria-pressed={mode === p.key}
					onclick={() => (mode = p.key)}
				>
					{p.label}
				</button>
			{/each}
		</div>
	{/if}

	<div class="figures">
		{#each shown as p (p.key)}
			<figure class:single>
				{#if p.src && failed[p.src]}
					<div class="gone">image unavailable</div>
				{:else if p.src}
					<a href={p.src} target="_blank" rel="external noopener" class="frame">
						<img
							src={p.src}
							alt={`${alt}: ${p.caption}`}
							loading="lazy"
							onerror={() => {
								if (p.src) failed[p.src] = true;
							}}
						/>
					</a>
				{/if}
				<figcaption>{p.caption}</figcaption>
			</figure>
		{/each}
	</div>
</div>

<style>
	.compare {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.modes {
		display: inline-flex;
		flex-wrap: wrap;
		align-self: flex-start;
		gap: 2px;
		padding: 3px;
		background: #121218;
		border: 1px solid #222;
		border-radius: 8px;
	}
	.mode {
		padding: 4px 10px;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: #a3a3a3;
		font-family: inherit;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.mode:hover {
		color: #e8e8ee;
	}
	.mode[aria-pressed='true'] {
		background: #6b5bff;
		color: #fff;
	}
	.mode:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.figures {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	figure {
		flex: 1 1 220px;
		min-width: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	figure.single {
		flex-basis: 100%;
	}
	figcaption {
		font-size: 11px;
		color: #9a9aa6;
	}
	.frame {
		display: block;
		border: 1px solid #23232e;
		border-radius: 8px;
		overflow: hidden;
		background-color: #15151c;
		background-image:
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%),
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			8px 8px;
	}
	.frame:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	img {
		display: block;
		width: 100%;
		height: auto;
	}
	.gone {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 90px;
		padding: 8px;
		border: 1px dashed #2a2a33;
		border-radius: 8px;
		background: #0d0d12;
		color: #80808c;
		font-size: 12px;
	}
</style>
