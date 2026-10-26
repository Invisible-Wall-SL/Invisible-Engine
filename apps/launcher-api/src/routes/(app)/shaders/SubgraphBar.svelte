<script lang="ts">
	import type { CanvasMode } from './shaderEditor';

	// Above the canvas: which graph it shows (Pixel, what the element draws, or Motion, how it
	// moves), where it is (the effect, or a subgraph opened from it, as a breadcrumb back), and the
	// group gestures: Group the selection into a subgraph (Ctrl+G), Open or Ungroup the selected call
	// (Ctrl+Shift+G). Subgraphs are the pixel graph's: in the motion graph those are off, saying why,
	// and the bar names the channels it drives and offers to delete it. The Motion switch carries a
	// dot while the motion graph drives a channel, its error count while it has errors. Errors of the
	// graph shown that no node of it carries show here.
	interface Props {
		mode: CanvasMode;
		onMode: (mode: CanvasMode) => void;
		/** The motion graph's errors, counted on its switch whichever graph is shown. */
		motionErrors?: number;
		/** The effect, then each subgraph opened from it; the last is shown. */
		crumbs: string[];
		onCrumb: (index: number) => void;
		/** How many selected nodes a group would take. */
		groupable: number;
		/** The selected call's subgraph's name, or '' when no call is selected. */
		call: string;
		errors: readonly string[];
		readOnly?: boolean;
		/** Why no subgraph gesture works in the graph shown, else ''. */
		subgraphsOff?: string;
		/** The channels the motion graph drives, and whether the effect has one. */
		driven?: readonly string[];
		hasMotion?: boolean;
		onGroup: () => void;
		onOpen: () => void;
		onUngroup: () => void;
		onDeleteMotion?: () => void;
	}
	let {
		mode,
		onMode,
		motionErrors = 0,
		crumbs,
		onCrumb,
		groupable,
		call,
		errors,
		readOnly = false,
		subgraphsOff = '',
		driven = [],
		hasMotion = false,
		onGroup,
		onOpen,
		onUngroup,
		onDeleteMotion,
	}: Props = $props();

	/** The Motion switch says what the motion graph does, or what is wrong with it. */
	const motionTitle = $derived(
		[
			'The motion graph: how the element moves and how much room it has, each frame.',
			motionErrors
				? `It has ${motionErrors} error${motionErrors === 1 ? '' : 's'}.`
				: driven.length
					? `It drives ${driven.join(', ')}.`
					: '',
		]
			.filter(Boolean)
			.join(' '),
	);
	const MODES: { id: CanvasMode; label: string }[] = [
		{ id: 'pixel', label: 'Pixel' },
		{ id: 'motion', label: 'Motion' },
	];
</script>

<div class="subgraph-bar">
	<div class="modes" role="tablist" aria-label="Which graph the canvas shows">
		{#each MODES as m (m.id)}
			<button
				type="button"
				role="tab"
				aria-selected={mode === m.id}
				class:on={mode === m.id}
				title={m.id === 'motion' ? motionTitle : 'The pixel graph: what the element draws.'}
				onclick={() => onMode(m.id)}
				>{m.label}{#if m.id === 'motion' && motionErrors}<span class="badge">{motionErrors}</span
					>{:else if m.id === 'motion' && driven.length}<span class="live" aria-hidden="true"
					></span>{/if}</button
			>
		{/each}
	</div>
	{#if mode === 'motion'}
		<span class="drives">
			{#if !hasMotion}
				No motion graph yet: add a node from the palette, and its Output comes with it.
			{:else if driven.length}
				Drives <strong>{driven.join(', ')}</strong>
			{:else}
				Drives nothing yet: wire into the Motion Output.
			{/if}
		</span>
	{:else}
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
	{/if}
	<span class="grow"></span>
	{#if call}
		<button
			type="button"
			disabled={!!subgraphsOff}
			title={subgraphsOff || `Edit ${call}'s nodes (or double-click the call)`}
			onclick={onOpen}>Open {call}</button
		>
		<button
			type="button"
			disabled={readOnly || !!subgraphsOff}
			title={subgraphsOff || `Put ${call}'s nodes back in place of this call (Ctrl+Shift+G)`}
			onclick={onUngroup}>Ungroup</button
		>
	{/if}
	<button
		type="button"
		disabled={readOnly || !groupable || !!subgraphsOff}
		title={subgraphsOff ||
			(groupable
				? `Group the ${groupable} selected node${groupable === 1 ? '' : 's'} into a subgraph (Ctrl+G)`
				: 'Select nodes to group them into a subgraph (Ctrl+G)')}
		onclick={onGroup}
		>{groupable ? `Group ${groupable} node${groupable === 1 ? '' : 's'}` : 'Group'}</button
	>
	{#if mode === 'motion'}
		<button
			type="button"
			disabled={readOnly || !hasMotion}
			title={hasMotion
				? 'Delete the whole motion graph: the curves in the effect settings move the element again'
				: 'This effect has no motion graph'}
			onclick={() => onDeleteMotion?.()}>Delete motion graph</button
		>
	{/if}
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
	.modes {
		display: flex;
		flex: none;
		margin-right: 6px;
		border: 1px solid #2a323d;
		border-radius: 4px;
		overflow: hidden;
	}
	.subgraph-bar .modes button {
		border: 0;
		border-radius: 0;
		background: #141a22;
		color: #94a3b8;
		padding: 2px 10px;
	}
	.subgraph-bar .modes button + button {
		border-left: 1px solid #2a323d;
	}
	.subgraph-bar .modes button.on {
		background: #1e3a5f;
		color: #e2e8f0;
	}
	.live {
		display: inline-block;
		width: 5px;
		height: 5px;
		margin: 0 0 1px 5px;
		border-radius: 50%;
		background: #38bdf8;
	}
	.badge {
		margin-left: 5px;
		padding: 0 4px;
		border-radius: 6px;
		font-size: 9px;
		background: #7f1d1d;
		color: #fecaca;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.drives {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: #94a3b8;
	}
	.drives strong {
		color: #38bdf8;
		font-weight: 600;
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
