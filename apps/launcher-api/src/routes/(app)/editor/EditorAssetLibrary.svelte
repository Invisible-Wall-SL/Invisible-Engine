<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import {
		fetchRegions,
		regionNaturalSize,
		type RegionDragPayload,
		type RegionSet,
	} from './editorRegions.client';
	import {
		clipFrameAt,
		DEFAULT_CLIP_FPS,
		fetchClips,
		type EditorClip,
	} from './editorFlipbooks.client';
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

	/** The project's authored Invisible FX effects (id + name), fetched once on mount
	 * from `/api/editor/effects` (the same list the `/fx` picker uses). Each is a
	 * draggable row that spawns an `effect` node. `null` = still loading. */
	let effects = $state<{ id: string; name: string }[] | null>(null);
	/** The project's authored Invisible Flipbook clips, from the shared per-page cache (the same
	 * list the Properties picker and the canvas read, so they can't disagree). Each is a draggable
	 * row that spawns a `flipbook` node. `null` = still loading. */
	let clips = $state<EditorClip[] | null>(null);
	onMount(() => {
		void fetch('/api/editor/effects')
			.then((r) => (r.ok ? r.json() : { effects: [] }))
			.then((data: { effects?: { id: string; name: string }[] }) => {
				effects = data.effects ?? [];
			})
			.catch(() => {
				effects = [];
			});
		void fetchClips().then((list) => {
			clips = list;
		});
	});

	const atlasCount = $derived(assets.atlases.length);
	const spineCount = $derived(assets.spines.length);
	const sheetCount = $derived(assets.sheets.length);
	const effectCount = $derived(effects?.length ?? 0);
	const clipCount = $derived(clips?.length ?? 0);

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

	// Hydrate the sheet behind each clip's FIRST frame so the Flipbooks rail shows the art rather
	// than a generic glyph — a clip is only identifiable by what it looks like. Reuses the SAME
	// `regionSets` cache the atlas/sheet groups fill, so a sheet already expanded above is free.
	$effect(() => {
		for (const clip of clips ?? []) {
			const key = clipFrameAt(clip, 0).assetKey;
			if (!key || regionSets[key] !== undefined) continue;
			regionSets = { ...regionSets, [key]: null };
			void fetchRegions(key).then((set) => {
				regionSets = { ...regionSets, [key]: set };
			});
		}
	});

	/** A clip's first frame resolved against the loaded region sets, for its rail thumbnail.
	 * `null` while the sheet loads, or when the frame is gone (a renamed/deleted region — the
	 * `/flipbook` tool is where that is diagnosed; here it just falls back to the glyph). */
	function clipThumb(
		clip: EditorClip,
	): { set: RegionSet; region: RegionSet['regions'][number] } | null {
		const ref = clipFrameAt(clip, 0);
		const set = regionSets[ref.assetKey];
		if (!set) return null;
		const region = set.regions.find((r) => r.name === ref.region);
		return region ? { set, region } : null;
	}

	function onAssetDragStart(
		e: DragEvent,
		asset: { kind: string; key: string; name: string },
	): void {
		if (!e.dataTransfer) return;
		const payload = { kind: asset.kind, key: asset.key, name: asset.name };
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	function onEffectDragStart(e: DragEvent, effect: { id: string; name: string }): void {
		if (!e.dataTransfer) return;
		const payload = { kind: 'effect', key: effect.id, name: effect.name };
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	/** Drag a clip out as a `flipbook` node. Only the ID travels — the frame list belongs to the
	 * clip doc and reaches the game through the flipbook bake, so re-authoring the clip updates
	 * every placement instead of freezing a copy into the layout (the `effect` payload's rule). */
	function onClipDragStart(e: DragEvent, clip: EditorClip): void {
		if (!e.dataTransfer) return;
		const payload = { kind: 'flipbook', key: clip.id, name: clip.name };
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

<PanelSection id="lib-effects" title="Effects" count={effectCount}>
	<ul>
		{#if effects === null}
			<li class="muted">Loading effects…</li>
		{:else}
			{#each effects as fx (fx.id)}
				<li
					draggable="true"
					data-effect-id={fx.id}
					data-effect-name={fx.name}
					ondragstart={(e) => onEffectDragStart(e, fx)}
				>
					<span class="glyph">✨</span>
					<span class="name">{fx.name}</span>
					<span class="tag">effect</span>
				</li>
			{:else}
				<li class="muted">No effects yet — make one in Invisible FX.</li>
			{/each}
		{/if}
	</ul>
</PanelSection>

<PanelSection id="lib-flipbooks" title="Flipbooks" count={clipCount}>
	<ul>
		{#if clips === null}
			<li class="muted">Loading flipbooks…</li>
		{:else}
			{#each clips as clip (clip.id)}
				{@const thumb = clipThumb(clip)}
				<li
					draggable="true"
					data-clip-id={clip.id}
					data-clip-name={clip.name}
					title={`${clip.name} · ${clip.frames.length} frame${clip.frames.length === 1 ? '' : 's'} · ${clip.fps ?? DEFAULT_CLIP_FPS}fps${clip.loop === false ? ' · once' : ' · loop'}`}
					ondragstart={(e) => onClipDragStart(e, clip)}
				>
					{#if thumb}
						<RegionThumb set={thumb.set} region={thumb.region} size={22} />
					{:else}
						<span class="glyph">🎞</span>
					{/if}
					<span class="name">{clip.name}</span>
					<span class="tag">{clip.frames.length}f</span>
				</li>
			{:else}
				<li class="muted">No flipbooks yet — make one in Invisible Flipbook.</li>
			{/each}
		{/if}
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
	.glyph {
		font-size: 12px;
		line-height: 1;
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
