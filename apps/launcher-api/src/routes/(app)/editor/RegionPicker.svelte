<script lang="ts">
	import { fetchRegions, type RegionSet } from './editorRegions.client';
	import RegionThumb from './RegionThumb.svelte';

	interface Sheet {
		key: string;
		name: string;
	}
	interface Props {
		/** Atlas/sheet manifests whose frames can be picked. */
		sheets: Sheet[];
		/** Current frame name (the param value). */
		value?: string;
		/** Called with the chosen frame name, or '' to clear. */
		onSelect: (region: string) => void;
	}
	let { sheets, value = '', onSelect }: Props = $props();

	let open = $state(false);
	let expanded = $state<Record<string, boolean>>({});
	let regionSets = $state<Record<string, RegionSet | null>>({});

	/** Lazy-load a sheet's regions on first expand (cached by `fetchRegions`). */
	async function toggle(key: string): Promise<void> {
		const isOpen = !expanded[key];
		expanded = { ...expanded, [key]: isOpen };
		if (isOpen && regionSets[key] === undefined) {
			regionSets = { ...regionSets, [key]: null };
			const set = await fetchRegions(key);
			regionSets = { ...regionSets, [key]: set };
		}
	}

	function pick(region: string): void {
		onSelect(region);
		open = false;
	}
</script>

<div class="region-picker">
	<div class="bar">
		<button type="button" class="current" onclick={() => (open = !open)}>
			<span class="cur-name">{value || 'Pick a frame…'}</span>
			<span class="caret">{open ? '▾' : '▸'}</span>
		</button>
		{#if value}
			<button type="button" class="clear" title="Clear" onclick={() => onSelect('')}>×</button>
		{/if}
	</div>
	{#if open}
		<div class="sheets">
			{#if sheets.length === 0}
				<p class="note">No atlases or sheets in this project.</p>
			{/if}
			{#each sheets as sheet (sheet.key)}
				<div class="sheet" class:open={expanded[sheet.key]}>
					<button type="button" class="sheetrow" onclick={() => void toggle(sheet.key)}>
						<span class="caret">{expanded[sheet.key] ? '▾' : '▸'}</span>
						<span class="name">{sheet.name}</span>
					</button>
					{#if expanded[sheet.key]}
						{@const set = regionSets[sheet.key]}
						{#if set === null}
							<p class="note">Loading…</p>
						{:else if !set || set.regions.length === 0}
							<p class="note">No frames in this atlas.</p>
						{:else}
							<div class="grid">
								{#each set.regions as r (r.name)}
									<button
										type="button"
										class="frame"
										class:sel={r.name === value}
										title={r.name}
										onclick={() => pick(r.name)}
									>
										<RegionThumb {set} region={r} size={44} />
										<span class="fname">{r.name}</span>
									</button>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.region-picker {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.bar {
		display: flex;
		gap: 4px;
	}
	.current {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-width: 0;
		padding: 4px 8px;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		color: #c8c8d0;
		font-size: 12px;
		cursor: pointer;
		text-align: left;
	}
	.cur-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.caret {
		color: #777;
		flex: none;
	}
	.clear {
		width: 24px;
		flex: none;
		border: 1px solid #444;
		border-radius: 4px;
		background: transparent;
		color: #b06a6a;
		cursor: pointer;
	}
	.sheets {
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		background: #0e0e13;
		padding: 4px;
	}
	.sheetrow {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		background: transparent;
		border: none;
		color: #c8c8d0;
		font-size: 12px;
		cursor: pointer;
		text-align: left;
	}
	.sheetrow .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.note {
		margin: 2px 0 6px 22px;
		font-size: 11px;
		color: #777;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 4px;
		padding: 4px 4px 8px 22px;
	}
	.frame {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		color: #aaa;
		cursor: pointer;
	}
	.frame.sel {
		border-color: #5b8cff;
		background: #1b2236;
	}
	.frame:hover {
		border-color: #444;
	}
	.fname {
		max-width: 52px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 9px;
	}
</style>
