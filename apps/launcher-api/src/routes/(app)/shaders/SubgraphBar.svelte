<script lang="ts">
	// Above the canvas: where it is (the effect, or a subgraph opened from it, as a breadcrumb back),
	// and the group gestures: Group the selection into a subgraph (Ctrl+G), Open or Ungroup the
	// selected call (Ctrl+Shift+G). Errors of an opened subgraph that no node of it carries show here.
	interface Props {
		/** The effect, then each subgraph opened from it; the last is shown. */
		crumbs: string[];
		onCrumb: (index: number) => void;
		/** How many selected nodes a group would take. */
		groupable: number;
		/** The selected call's subgraph's name, or '' when no call is selected. */
		call: string;
		errors: readonly string[];
		readOnly?: boolean;
		onGroup: () => void;
		onOpen: () => void;
		onUngroup: () => void;
	}
	let {
		crumbs,
		onCrumb,
		groupable,
		call,
		errors,
		readOnly = false,
		onGroup,
		onOpen,
		onUngroup,
	}: Props = $props();
</script>

<div class="subgraph-bar">
	<nav aria-label="Where the canvas is">
		{#each crumbs as crumb, i (i)}
			{#if i > 0}<span class="sep">›</span>{/if}
			{#if i < crumbs.length - 1}
				<button type="button" class="crumb" onclick={() => onCrumb(i)}>{crumb}</button>
			{:else}
				<strong class:inside={i > 0}>{crumb}</strong>
			{/if}
		{/each}
	</nav>
	<span class="grow"></span>
	{#if call}
		<button type="button" title="Edit {call}'s nodes (or double-click the call)" onclick={onOpen}
			>Open {call}</button
		>
		<button
			type="button"
			disabled={readOnly}
			title="Put {call}'s nodes back in place of this call (Ctrl+Shift+G)"
			onclick={onUngroup}>Ungroup</button
		>
	{/if}
	<button
		type="button"
		disabled={readOnly || !groupable}
		title={groupable
			? `Group the ${groupable} selected node${groupable === 1 ? '' : 's'} into a subgraph (Ctrl+G)`
			: 'Select nodes to group them into a subgraph (Ctrl+G)'}
		onclick={onGroup}
		>{groupable ? `Group ${groupable} node${groupable === 1 ? '' : 's'}` : 'Group'}</button
	>
</div>
{#if errors.length}
	<p class="bar-errors" role="alert">{errors.join(' · ')}</p>
{/if}

<style>
	.subgraph-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		border-bottom: 1px solid #1f2937;
		font-size: 12px;
		min-height: 26px;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.sep {
		color: #64748b;
	}
	.crumb {
		background: none;
		border: 0;
		padding: 0 2px;
		color: #60a5fa;
		cursor: pointer;
		font-size: 12px;
	}
	.crumb:hover {
		text-decoration: underline;
	}
	strong.inside {
		color: #5eead4;
	}
	.grow {
		flex: 1;
	}
	button:not(.crumb) {
		font-size: 11px;
		background: #1f2937;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.bar-errors {
		margin: 0;
		padding: 4px 12px;
		background: #3b1d1d;
		color: #fecaca;
		font-size: 11px;
	}
</style>
