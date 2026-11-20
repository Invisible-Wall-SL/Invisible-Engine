<script module lang="ts">
	import type { ClipProblem } from '$lib/flipbook/characterSet';

	/** A problem that draws the character wrongly, not merely a note on its Loop. */
	export const drawsWrongly = (p: ClipProblem): boolean =>
		p.kind !== 'savedAsLoop' && p.kind !== 'savedAsOnce';
</script>

<script lang="ts">
	/**
	 * A character's clips, one cell per state and facing the game looks for: made, mirrored,
	 * stood in for or nothing. Flipbook's Characters mode opens a cell's clip; with no `onOpen`
	 * (Invisible Characters) the grid is read-only.
	 */
	import { cellPlays, type CharacterGrid, type GridCell } from '$lib/flipbook/characterSet';
	import type { FlipbookClip } from 'engine-flipbook';
	import type { CharacterClips } from 'engine-layout';

	interface Props {
		look: CharacterClips;
		grid: CharacterGrid;
		/** The character's clips by id, for the frame count. */
		clips: Record<string, FlipbookClip>;
		/** A made cell with one that draws wrongly carries a dot. */
		problems?: ClipProblem[];
		/** Absent: read-only, no cell opens anything. */
		onOpen?: (clipId: string) => void;
	}
	let { look, grid, clips, problems = [], onOpen }: Props = $props();

	/** A clip id without its character's prefix: `walk_e`. */
	function tail(clipId: string): string {
		const prefix = [look.prefixes.marked, look.prefixes.base].find(
			(p) => p && clipId.startsWith(`${p}_`),
		);
		return prefix ? clipId.slice(prefix.length + 1) : clipId;
	}

	function cellTitle(cell: GridCell): string {
		const { status, name } = cell;
		if (status.kind === 'made')
			return `${name}: its own clip, drawn as made.${onOpen ? ' Click to open it.' : ''}`;
		if (status.kind === 'mirrored')
			return `${name}: no clip of its own. The game draws ${status.clipId} mirrored.`;
		if (status.kind === 'none') return `${name}: no clip, and none stands in. Nothing plays.`;
		return (
			`${name}: no clip of its own. The game stands in ${status.clipId}` +
			`${status.flipX ? ', mirrored' : ''}.`
		);
	}

	const broken = (clipId: string): boolean =>
		problems.some((p) => p.clipId === clipId && drawsWrongly(p));
</script>

{#snippet cellBody(cell: GridCell)}
	{@const plays = cellPlays(cell)}
	{@const frames = plays ? clips[plays.clipId]?.frames.length : undefined}
	{#if cell.status.kind === 'made'}
		<span class="mark">✓</span>
		{#if frames !== undefined}<span class="fr">{frames}f</span>{/if}
		{#if broken(cell.name)}<span class="dot" aria-label="has a problem"></span>{/if}
	{:else if cell.status.kind === 'mirrored'}
		<span class="mark">⇋</span>
		<span class="fr">{tail(cell.status.clipId)}</span>
	{:else if cell.status.kind === 'standIn'}
		<span class="mark">≈</span>
		<span class="fr">{tail(cell.status.clipId)}{cell.status.flipX ? ' ⇋' : ''}</span>
	{:else}
		<span class="mark">—</span>
	{/if}
{/snippet}

{#snippet cellView(cell: GridCell)}
	{#if onOpen}
		{@const plays = cellPlays(cell)}
		<button
			class="cell {cell.status.kind}"
			title={cellTitle(cell)}
			disabled={!plays}
			data-cell={cell.name}
			onclick={() => plays && onOpen(plays.clipId)}
		>
			{@render cellBody(cell)}
		</button>
	{:else}
		<div class="cell {cell.status.kind}" title={cellTitle(cell)} data-cell={cell.name}>
			{@render cellBody(cell)}
		</div>
	{/if}
{/snippet}

<div class="scroll">
	<table class="grid">
		<thead>
			<tr>
				<th></th>
				<th class="group" colspan={grid.drawn.length}>You draw</th>
				<th class="gap"></th>
				<th class="group mirror" colspan={grid.mirrored.length}>The game mirrors</th>
			</tr>
			<tr>
				<th></th>
				{#each grid.drawn as facing (facing)}<th class="facing">{facing}</th>{/each}
				<th class="gap"></th>
				{#each grid.mirrored as facing (facing)}<th class="facing">{facing}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each grid.rows as row (row.state)}
				<tr>
					<th scope="row" title="Played on: {row.plays.join(', ')}">
						<b>{row.state}</b>
						<span class="role">{row.loop ? 'loop' : 'once'}</span>
					</th>
					{#each row.cells as cell, i (cell.facing)}
						{#if i === grid.drawn.length}<td class="gap"></td>{/if}
						<td>{@render cellView(cell)}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}
	.grid {
		border-collapse: separate;
		border-spacing: 4px;
		font-size: 12px;
	}
	.grid th {
		font-weight: 400;
		color: #94a3b8;
		text-align: left;
		white-space: nowrap;
	}
	.grid th.group {
		padding: 2px 6px;
		border-bottom: 2px solid #2f6b5b;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #7ee0c0;
		text-align: center;
	}
	.grid th.group.mirror {
		border-bottom-color: #2f5273;
		color: #93c5fd;
	}
	.grid .facing {
		text-align: center;
		text-transform: uppercase;
		font-size: 11px;
		color: #cbd5e1;
	}
	.grid .gap {
		width: 14px;
	}
	.grid th[scope='row'] b {
		color: #e2e8f0;
		font-family: ui-monospace, monospace;
	}
	.role {
		margin-left: 6px;
		font-size: 10px;
		color: #64748b;
	}
	.cell {
		position: relative;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 100%;
		min-width: 62px;
		height: 30px;
		padding: 0 6px;
		border-radius: 6px;
		border: 1px solid #1f2937;
		background: #10161e;
		color: #cbd5e1;
		font-size: 12px;
		white-space: nowrap;
	}
	button.cell {
		cursor: pointer;
	}
	button.cell:disabled {
		cursor: default;
	}
	.cell.made {
		border-color: #2f6b5b;
		color: #7ee0c0;
	}
	.cell.mirrored {
		border-color: #2f5273;
		border-style: dashed;
		color: #93c5fd;
	}
	.cell.standIn {
		border-color: #7a5a1e;
		border-style: dashed;
		color: #fbbf24;
	}
	.cell.none {
		color: #475569;
	}
	.cell .fr {
		font-size: 10px;
		font-family: ui-monospace, monospace;
		opacity: 0.85;
	}
	.cell .dot {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f87171;
	}
</style>
