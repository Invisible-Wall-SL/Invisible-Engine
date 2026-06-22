<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		fetchRegions,
		regionNaturalSize,
		type RegionDragPayload,
		type RegionSet,
	} from './editorRegions.client';
	import PanelSection from './PanelSection.svelte';
	import RegionThumb from './RegionThumb.svelte';

	/** The project's editor-relevant assets (mirrors `ProjectAssets` from
	 * `$lib/server/projectAssets`, structurally — that module can't enter the
	 * browser bundle, so the shape is restated here). */
	interface AssetLists {
		atlases: { name: string; key: string; kind: string }[];
		spines: { name: string; key: string; kind: string; shared: boolean }[];
		sheets: { name: string; key: string; kind: string }[];
	}

	interface Props {
		assets: AssetLists;
		/** Which sheet/atlas keys are expanded — `bind`able so the Scene Editor can
		 * persist + restore the open set (the Component Editor omits it). */
		expanded?: Record<string, boolean>;
		/** Extra controls injected into the Spines section header (the Scene Editor's
		 * "Upload spines" button + status). Omitted by the Component Editor. */
		spineActions?: Snippet;
	}
	let { assets, expanded = $bindable({}), spineActions }: Props = $props();

	/** Per-key region set (loaded lazily on first expand; `null` while loading). */
	let regionSets = $state<Record<string, RegionSet | null>>({});

	const atlasCount = $derived(assets.atlases.length);
	const spineCount = $derived(assets.spines.length);
	const sheetCount = $derived(assets.sheets.length);

	async function toggleExpand(key: string): Promise<void> {
		const open = !expanded[key];
		expanded = { ...expanded, [key]: open };
		if (open && regionSets[key] === undefined) {
			regionSets = { ...regionSets, [key]: null };
			const set = await fetchRegions(key);
			regionSets = { ...regionSets, [key]: set };
		}
	}

	// Hydrate the region set for any key that starts out expanded (the Scene Editor
	// restores its persisted open set before mount) so its thumbnails appear without
	// a manual re-toggle.
	$effect(() => {
		for (const key of Object.keys(expanded)) {
			if (expanded[key] && regionSets[key] === undefined) {
				regionSets = { ...regionSets, [key]: null };
				void fetchRegions(key).then((set) => {
					regionSets = { ...regionSets, [key]: set };
				});
			}
		}
	});

	function onAssetDragStart(
		e: DragEvent,
		asset: { kind: string; key: string; name: string },
	): void {
		if (!e.dataTransfer) return;
		const payload = { kind: asset.kind, key: asset.key, name: asset.name };
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	function onRegionDragStart(
		e: DragEvent,
		set: RegionSet,
		region: RegionSet['regions'][number],
	): void {
		if (!e.dataTransfer) return;
		const payload: RegionDragPayload = {
			kind: 'region',
			key: set.assetKey,
			name: region.name,
			region: region.name,
			pageKey: set.pageKey,
			rect: { x: region.x, y: region.y, w: region.w, h: region.h },
			rotated: region.rotated,
			offX: region.offX,
			offY: region.offY,
			origW: region.origW,
			origH: region.origH,
		};
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}
</script>

{#snippet expandable(key: string, name: string, tag: string)}
	<li class="group" class:open={expanded[key]}>
		<button type="button" class="grouprow" onclick={() => void toggleExpand(key)}>
			<span class="caret">{expanded[key] ? '▾' : '▸'}</span>
			<span class="name">{name}</span>
			<span class="tag">{tag}</span>
		</button>
		{#if expanded[key]}
			{@const set = regionSets[key]}
			{#if set === null}
				<p class="region-note">Loading regions…</p>
			{:else if !set || set.regions.length === 0}
				<p class="region-note">No regions found in this {tag}.</p>
			{:else}
				<div class="region-grid">
					{#each set.regions as r (r.name)}
						{@const ns = regionNaturalSize(r)}
						<div
							class="region"
							draggable="true"
							role="button"
							tabindex="0"
							aria-label={`Drag region ${r.name} (${ns.w}×${ns.h})`}
							title={`${r.name} · ${ns.w}×${ns.h}`}
							ondragstart={(e) => onRegionDragStart(e, set, r)}
						>
							<RegionThumb {set} region={r} size={48} />
							<span class="region-name">{r.name}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</li>
{/snippet}

<PanelSection id="lib-atlases" title="Atlases" count={atlasCount}>
	<ul>
		{#each assets.atlases as a (a.key)}
			{#if a.kind === 'atlas-manifest'}
				{@render expandable(a.key, a.name, 'manifest')}
			{:else}
				<li
					draggable="true"
					data-asset-kind={a.kind}
					data-asset-key={a.key}
					data-asset-name={a.name}
					ondragstart={(e) => onAssetDragStart(e, a)}
				>
					<span class="name">{a.name}</span>
					<span class="tag">page</span>
				</li>
			{/if}
		{:else}
			<li class="muted">No atlases yet.</li>
		{/each}
	</ul>
</PanelSection>

<PanelSection id="lib-spines" title="Spines" count={spineCount} actions={spineActions}>
	<ul>
		{#each assets.spines as s (s.key)}
			<li
				draggable="true"
				data-asset-kind={s.kind}
				data-asset-key={s.key}
				data-asset-name={s.name}
				ondragstart={(e) => onAssetDragStart(e, s)}
			>
				<span class="name">{s.name}</span>
				<span class="tag">spine</span>
				{#if s.shared}<span class="badge">shared</span>{/if}
			</li>
		{:else}
			<li class="muted">No spines yet.</li>
		{/each}
	</ul>
</PanelSection>

<PanelSection id="lib-sheets" title="Sheets" count={sheetCount}>
	<ul>
		{#each assets.sheets as sh (sh.key)}
			{@render expandable(sh.key, sh.name, 'sheet')}
		{:else}
			<li class="muted">No sheets yet.</li>
		{/each}
	</ul>
</PanelSection>

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		font-size: 12px;
		border-radius: 6px;
		background: #16161c;
		border: 1px solid #1f1f28;
	}
	li[draggable='true'] {
		cursor: grab;
	}
	li[draggable='true']:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	li[draggable='true']:active {
		cursor: grabbing;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		font-size: 10px;
		color: #777;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.badge {
		font-size: 10px;
		color: #c8a3ff;
		background: #2a2430;
		padding: 1px 6px;
		border-radius: 999px;
	}
	li.muted {
		background: transparent;
		border: 1px dashed #1f1f28;
		color: #666;
		justify-content: center;
		padding: 10px;
	}
	li.group {
		display: block;
		padding: 0;
		background: #16161c;
		border: 1px solid #1f1f28;
		overflow: hidden;
	}
	li.group.open {
		border-color: #2a2a33;
	}
	.grouprow {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		background: transparent;
		border: none;
		color: #e8e8ee;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
	}
	.grouprow:hover {
		background: #1a1a22;
	}
	.caret {
		color: #777;
		width: 10px;
		font-size: 10px;
	}
	.region-note {
		margin: 0;
		padding: 6px 10px 8px 24px;
		color: #666;
		font-size: 11px;
	}
	.region-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 6px;
		padding: 6px 8px 10px;
	}
	.region {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 4px;
		border-radius: 6px;
		border: 1px solid transparent;
		cursor: grab;
	}
	.region:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	.region:active {
		cursor: grabbing;
	}
	.region-name {
		font-size: 9px;
		color: #888;
		max-width: 52px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
