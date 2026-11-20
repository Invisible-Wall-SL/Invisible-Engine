<script module lang="ts">
	import type { ClipProblem } from '$lib/flipbook/characterSet';

	/** A problem that draws the character wrongly, not merely a note on its Loop. */
	export const drawsWrongly = (p: ClipProblem): boolean =>
		p.kind !== 'savedAsLoop' && p.kind !== 'savedAsOnce';
</script>

<script lang="ts">
	/**
	 * A character's clips, one cell per state and facing the game looks for: made, mirrored,
	 * stood in for or nothing. The character plays a block (`look`) or a sheet (`sheet`, whose
	 * actions are the rows and whose view's facings are the columns), and `grid` is
	 * `characterGrid` of that same one.
	 *
	 * Three hosts: Flipbook's Characters mode opens a cell's clip (`onOpen`); a host with a cell
	 * editor of its own is told which cell was pressed, an empty one too (`onCell`, with the cell it
	 * has `selected`); with neither the grid is read-only.
	 */
	import {
		cellKey,
		cellPlays,
		clipTail,
		type CharacterGrid,
		type GridCell,
	} from '$lib/flipbook/characterSet';
	import type { FlipbookClip } from 'engine-flipbook';
	import type { CharacterClips } from 'engine-layout';
	import type { CharacterSheet } from 'game-config';

	interface Props {
		/** The block the character plays. */
		look?: CharacterClips;
		/** The sheet it plays, read before `look` as the game reads it. */
		sheet?: CharacterSheet;
		/** `characterGrid` of the sheet (else the block), the project's clip ids and the variant. */
		grid: CharacterGrid;
		/** The character's clips by id, for the frame count. */
		clips: Record<string, FlipbookClip>;
		/** A made cell with one that draws wrongly carries a dot. */
		problems?: ClipProblem[];
		/** A cell that plays a clip is a button that opens it. */
		onOpen?: (clipId: string) => void;
		/** Every cell is a button, an empty one too, and this is told which was pressed. Read before
		 *  `onOpen`. */
		onCell?: (cell: GridCell) => void;
		/** The `cellKey` of the cell the host has selected. */
		selected?: string;
	}
	let { look, sheet, grid, clips, problems = [], onOpen, onCell, selected }: Props = $props();

	const art = $derived(sheet ?? look);
	/** A clip id without its character's prefix: `walk_e`. */
	const tail = (clipId: string): string => (art ? clipTail(art, clipId) : clipId);

	function cellTitle(cell: GridCell): string {
		const { status, name, holds } = cell;
		if (holds?.kind === 'still')
			return `A still image, ${holds.text}: drawn as one frame. No clip is looked for here.`;
		const named = cell.named
			? ' The sheet names this clip for the cell.'
			: holds
				? ` The sheet names a rig animation here (${holds.text}), which frame clips do not draw: the clip is found by name.`
				: '';
		if (status.kind === 'made')
			return `${name}: its own clip, drawn as made.${named}${onOpen && !onCell ? ' Click to open it.' : ''}`;
		if (status.kind === 'mirrored')
			return `${name}: no clip of its own. The game draws ${status.clipId} mirrored.${named}`;
		if (status.kind === 'none')
			return name
				? `${name}: no clip, and none stands in. Nothing plays until a clip is saved under this name.${named}`
				: 'The character has no frame clips, so nothing is looked for.';
		return (
			`${name}: no clip of its own. The game stands in ${status.clipId}` +
			`${status.flipX ? ', mirrored' : ''}.${named}`
		);
	}

	function rowTitle(row: CharacterGrid['rows'][number]): string {
		return row.plays.length
			? `Played on: ${row.plays.join(', ')}`
			: 'Nothing starts it: it only stands in for another action.';
	}

	const broken = (clipId: string): boolean =>
		problems.some((p) => p.clipId === clipId && drawsWrongly(p));
</script>

{#snippet cellBody(cell: GridCell)}
	{@const plays = cellPlays(cell)}
	{@const frames = plays ? clips[plays.clipId]?.frames.length : undefined}
	{#if cell.holds?.kind === 'still'}
		<span class="mark">▣</span>
		<span class="fr" data-cell-holds="still">still · {tail(cell.name)}</span>
	{:else if cell.holds}
		<span class="mark">{cell.status.kind === 'none' ? '—' : '≈'}</span>
		<span class="fr" data-cell-holds="rig">rig · {cell.holds.text}</span>
	{:else if cell.status.kind === 'made'}
		<span class="mark">✓</span>
		{#if cell.named}<span class="fr">{tail(cell.name)}</span>{/if}
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
	{#if onCell}
		<button
			class="cell {cell.status.kind}"
			class:named={cell.named}
			class:selected={selected === cellKey(cell)}
			aria-pressed={selected === cellKey(cell)}
			title={cellTitle(cell)}
			data-cell={cell.name}
			onclick={() => onCell(cell)}
		>
			{@render cellBody(cell)}
		</button>
	{:else if onOpen}
		{@const plays = cellPlays(cell)}
		<button
			class="cell {cell.status.kind}"
			class:named={cell.named}
			title={cellTitle(cell)}
			disabled={!plays}
			data-cell={cell.name}
			onclick={() => plays && onOpen(plays.clipId)}
		>
			{@render cellBody(cell)}
		</button>
	{:else}
		<div
			class="cell {cell.status.kind}"
			class:named={cell.named}
			title={cellTitle(cell)}
			data-cell={cell.name}
		>
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
				{#if grid.mirrored.length}
					<th class="gap"></th>
					<th class="group mirror" colspan={grid.mirrored.length}>The game mirrors</th>
				{/if}
			</tr>
			<tr>
				<th></th>
				{#each grid.drawn as facing (facing)}<th class="facing">{facing}</th>{/each}
				{#if grid.mirrored.length}<th class="gap"></th>{/if}
				{#each grid.mirrored as facing (facing)}<th class="facing">{facing}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each grid.rows as row (row.state)}
				<tr>
					<th scope="row" title={rowTitle(row)} data-row={row.state}>
						<b>{row.state}</b>
						{#if row.name}<span class="named-as">{row.name}</span>{/if}
						<span class="role">{row.loop ? 'loop' : row.once ? 'once' : 'stands in'}</span>
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
	.named-as {
		margin-left: 6px;
		color: #cbd5e1;
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
	.cell.named {
		border-style: double;
		border-width: 3px;
	}
	.cell.selected {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
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
