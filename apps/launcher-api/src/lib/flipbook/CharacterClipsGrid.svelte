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
	import FacingGrid from './FacingGrid.svelte';

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

	function open(cell: GridCell): void {
		const plays = cellPlays(cell);
		if (plays) onOpen?.(plays.clipId);
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

<FacingGrid
	drawn={grid.drawn}
	mirrored={grid.mirrored}
	rows={grid.rows}
	look={(cell) => cell.status.kind}
	named={(cell) => cell.named}
	idOf={(cell) => cell.name}
	keyOf={cellKey}
	titleOf={cellTitle}
	body={cellBody}
	onPress={onCell ?? (onOpen ? open : undefined)}
	pressable={(cell) => !!cellPlays(cell)}
	selectable={!!onCell}
	{selected}
/>
