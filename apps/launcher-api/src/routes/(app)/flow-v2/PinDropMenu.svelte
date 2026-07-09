<script module lang="ts">
	import type { NodeKind, TypeRef } from 'engine-flow-v2';

	// One compatible candidate: the node KIND to spawn, its REF (for vocab/library/container
	// kinds), a display label, an optional data `TypeRef` (of the pin that will be wired — drives
	// the accent color), and a short section tag for grouping.
	export type PinDropCandidate = {
		kind: NodeKind;
		ref?: string;
		label: string;
		pinType?: TypeRef;
		section: string;
	};
</script>

<script lang="ts">
	// Invisible Flow v2 — the drag-off-pin contextual node spawner (Unreal-Blueprint's
	// release-on-empty-canvas menu). When a wire is dragged off a pin and dropped on empty
	// canvas, the page opens this floating panel at the drop's SCREEN position, pre-filtered to
	// ONLY the node types whose pins the dragged pin could legally connect to (same rule as
	// `isValidConnection`, computed page-side). Picking an entry spawns + auto-wires it. Styled
	// to match `AddNodePalette` — same search/query pattern, same section-accent language.
	import { typeColor, typeLabel } from './palette';

	let {
		candidates,
		screenX,
		screenY,
		onpick,
		onclose,
	}: {
		candidates: PinDropCandidate[];
		screenX: number;
		screenY: number;
		onpick: (candidate: PinDropCandidate) => void;
		onclose: () => void;
	} = $props();

	let query = $state('');
	const matches = (label: string): boolean =>
		!query.trim() || label.toLowerCase().includes(query.trim().toLowerCase());

	// The filtered list, in catalog order (candidates arrive already ordered by the page).
	const filtered = $derived(candidates.filter((c) => matches(c.label)));

	// Enter picks the top match; Escape closes. Click-away is handled by the backdrop below.
	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const top = filtered[0];
			if (top) onpick(top);
		}
	}

	// The accent bar for a candidate — its wired pin's type color (exec / untyped fall back slate).
	const accent = (c: PinDropCandidate): string => (c.pinType ? typeColor(c.pinType) : '#94a3b8');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose} onkeydown={onKeydown} role="presentation"></div>

<div
	class="menu"
	style="left:{screenX}px; top:{screenY}px"
	role="dialog"
	aria-label="Add a compatible node"
	onkeydown={onKeydown}
>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		class="search"
		type="text"
		placeholder="Filter compatible nodes…"
		autofocus
		bind:value={query}
	/>
	<div class="list">
		{#if filtered.length === 0}
			<p class="empty">No compatible nodes.</p>
		{:else}
			{#each filtered as c (c.kind + ':' + (c.ref ?? '') + ':' + c.label)}
				<button
					class="entry"
					type="button"
					style="border-left-color:{accent(c)}"
					onclick={() => onpick(c)}
					title="{c.kind}{c.ref ? ' · ' + c.ref : ''}"
				>
					<span class="label">{c.label}</span>
					<span class="tag">
						{#if c.pinType}<span class="ptype" style="color:{accent(c)}"
								>{typeLabel(c.pinType)}</span
							>{/if}
						<span class="section">{c.section}</span>
					</span>
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.menu {
		position: fixed;
		z-index: 41;
		width: 250px;
		max-height: 340px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		border-radius: 10px;
		border: 1px solid #2a4a6a;
		background: #0d1420;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
	}
	.search {
		width: 100%;
		box-sizing: border-box;
		background: #11161d;
		border: 1px solid #2a323d;
		border-radius: 6px;
		color: #e2e8f0;
		font-size: 12px;
		padding: 6px 8px;
	}
	.search:focus {
		outline: none;
		border-color: #2563eb;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		overflow-y: auto;
	}
	.empty {
		margin: 4px 2px;
		font-size: 12px;
		color: #64748b;
	}
	.entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		text-align: left;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		border-left: 3px solid #64748b;
		background: #14181f;
		color: #cbd5e1;
		font-size: 12px;
		cursor: pointer;
	}
	.entry:hover {
		border-color: #3a4655;
		background: #1a1f28;
	}
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}
	.ptype {
		font-size: 9px;
		opacity: 0.85;
	}
	.section {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}
</style>
