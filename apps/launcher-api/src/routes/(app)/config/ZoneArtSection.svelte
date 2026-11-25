<script lang="ts">
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';

	import {
		ZONE_ART_LIMITS,
		type GameConfigDoc,
		type GameConfigIssue,
		type ZoneArtSource,
	} from 'game-config';
	import CardArt from '../cards/CardArt.svelte';
	import RegionPicker from '../editor/RegionPicker.svelte';
	import {
		addZoneArtVariant,
		clipThumbRef,
		removeZoneArt,
		setZoneArtScale,
		setZoneArtSource,
		shownZoneArtRows,
		zoneArtDefault,
		zoneArtRows,
	} from './zoneArtDoc';

	/**
	 * THE ZONE ART CARD of `/config` (`arcade.zoneArt`, `docs/design/zone-art.md`): per zone family
	 * of the zones the game plays, what each of its zones is drawn with. The picture is a frame of a
	 * project sheet (the Scene Editor's region picker) or a Flipbook clip; more pictures are
	 * variants, one per zone by the room's seed. Every edit goes through `./zoneArtDoc`.
	 */
	type Clip = { id: string; name: string; assetKey: string; firstFrame: string };
	let {
		doc = $bindable(),
		zones,
		generator,
		readOnly,
		pickSheets,
		clips,
		issuesFor,
	}: {
		doc: GameConfigDoc;
		/** The zones the game plays: the config's own, or the level the shown seed makes. */
		zones: readonly { id: string }[];
		generator: string | undefined;
		readOnly: boolean;
		pickSheets: { key: string; name: string }[];
		clips: Clip[];
		issuesFor: (prefix: string) => GameConfigIssue[];
	} = $props();

	let showRuleOnly = $state(false);
	const rows = $derived(zoneArtRows(zones, doc, generator));
	const hidden = $derived(rows.length - shownZoneArtRows(rows, false).length);
	const shown = $derived(shownZoneArtRows(rows, showRuleOnly));
	const clipsById = $derived(new Map(clips.map((c) => [c.id, c])));

	const KINDS = [
		['', 'Default'],
		['sprite', 'Sheet frame'],
		['flipbook', 'Flipbook clip'],
	] as const;

	/** A new picture of `kind`, kept from `was` where it is the same kind; none to pick yet ⇒ none. */
	function sourceOfKind(kind: string, was: ZoneArtSource | undefined): ZoneArtSource | undefined {
		if (kind === was?.kind) return was;
		if (kind === 'flipbook' && clips[0]) return { kind: 'flipbook', clip: clips[0].id };
		return undefined;
	}
	/** The kind a row's select shows: a sprite still to pick is shown picked, until it is. */
	let pending = $state<Record<string, 'sprite'>>({});
	const keyOf = (family: string, index: number) => `${family}\u0000${index}`;

	function pickKind(family: string, index: number, was: ZoneArtSource | undefined, kind: string) {
		const key = keyOf(family, index);
		if (kind === 'sprite' && was?.kind !== 'sprite') {
			pending = { ...pending, [key]: 'sprite' };
			return;
		}
		const { [key]: _, ...rest } = pending;
		pending = rest;
		setZoneArtSource(doc, family, index, sourceOfKind(kind, was));
	}
	function pickRegion(family: string, index: number, region: string) {
		const { [keyOf(family, index)]: _, ...rest } = pending;
		pending = rest;
		setZoneArtSource(doc, family, index, region ? { kind: 'sprite', region } : undefined);
	}
	function setFps(family: string, index: number, source: ZoneArtSource, value: string) {
		if (source.kind !== 'flipbook') return;
		const n = Number(value);
		const { min, max } = ZONE_ART_LIMITS.fps;
		const { fps: _, ...rest } = source;
		const fps = value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
		setZoneArtSource(doc, family, index, fps ? { ...rest, fps } : rest);
	}
</script>

{#snippet picture(family: string, index: number, source: ZoneArtSource | undefined)}
	{@const kind = pending[keyOf(family, index)] ?? source?.kind ?? ''}
	<div class="picture">
		<select
			value={kind}
			aria-label={index ? `Variant ${index}` : 'Drawn with'}
			onchange={(e) => pickKind(family, index, source, e.currentTarget.value)}
		>
			{#each KINDS as [value, label] (value)}
				<option
					{value}
					disabled={value === 'flipbook' && !clips.length}
					title={value === 'flipbook' && !clips.length
						? 'This project has no Flipbook clips yet'
						: ''}>{index && !value ? 'Remove variant' : label}</option
				>
			{/each}
		</select>
		{#if !kind && !index}
			{@const current = zoneArtDefault(family, generator, pickSheets)}
			<span class="default">{current.label}</span>
			{#each current.thumbs as thumb (thumb)}
				<span class="thumb" title="Used now"><CardArt value={thumb} size={40} /></span>
			{/each}
		{:else if kind === 'sprite'}
			<RegionPicker
				sheets={pickSheets}
				value={source?.kind === 'sprite' ? source.region : ''}
				scoped
				onSelect={(region) => pickRegion(family, index, region)}
			/>
			{#if source?.kind === 'sprite'}
				<span class="thumb"><CardArt value={source.region} size={40} /></span>
			{/if}
		{:else if source?.kind === 'flipbook'}
			{@const thumb = clipThumbRef(clipsById.get(source.clip))}
			<select
				value={source.clip}
				aria-label="Clip"
				onchange={(e) =>
					setZoneArtSource(doc, family, index, { ...source, clip: e.currentTarget.value })}
			>
				{#if !clipsById.has(source.clip)}
					<option value={source.clip}>{source.clip} (not in this project)</option>
				{/if}
				{#each clips as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
			<label class="inline fps"
				>fps<input
					type="number"
					min={ZONE_ART_LIMITS.fps.min}
					max={ZONE_ART_LIMITS.fps.max}
					placeholder="clip's"
					value={source.fps ?? ''}
					onchange={(e) => setFps(family, index, source, e.currentTarget.value)}
				/></label
			>
			{#if thumb}<span class="thumb"><CardArt value={thumb} size={40} /></span>{/if}
		{/if}
	</div>
{/snippet}

<SectionCard scope="config" id="zoneArt" title="Zone art">
	{#snippet info()}
		<p>
			What each zone family is drawn with: a frame of one of the project's sheets or a Flipbook
			clip, stamped on every zone of the family, fitted inside it and centred, times its scale.
			Variants are more pictures: each zone draws one of them, chosen by the room's seed, the same
			on every device. A family with nothing chosen draws as it does today. The art is for the eye
			only: it changes no rule and no level, and ships with the game like any art it names.
		</p>
	{/snippet}
	<fieldset class="panel" disabled={readOnly}>
		{#if hidden}
			<label class="inline toggle"
				><input type="checkbox" bind:checked={showRuleOnly} />Show rule-only zones
				<InfoTip
					>{hidden} zone famil{hidden === 1 ? 'y is' : 'ies are'} walls and currents the game's rules
					read and its art never draws.</InfoTip
				></label
			>
		{/if}
		{#if shown.length}
			<table class="tbl">
				<thead>
					<tr>
						<th>Family</th>
						<th>Drawn with</th>
						<th>Scale</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each shown as row (row.family)}
						{@const art = row.art}
						<tr class:stale={!row.count}>
							<td
								><span
									class="chip"
									title={row.count
										? 'Zone ids that differ only in their numbers'
										: 'No zone of this family in the level shown'}>{row.family} × {row.count}</span
								></td
							>
							<td>
								{@render picture(row.family, 0, art?.source)}
								{#each art?.variants ?? [] as variant, i (i)}
									{@render picture(row.family, i + 1, variant)}
								{/each}
								{#if art && (art.variants?.length ?? 0) < ZONE_ART_LIMITS.variants}
									<button class="small" onclick={() => addZoneArtVariant(doc, row.family)}
										>＋ Variant</button
									>
								{/if}
							</td>
							<td
								>{#if art}<input
										type="number"
										step="0.1"
										min={ZONE_ART_LIMITS.scale.min}
										max={ZONE_ART_LIMITS.scale.max}
										placeholder="1"
										value={art.scale ?? ''}
										onchange={(e) => setZoneArtScale(doc, row.family, e.currentTarget.value)}
									/>{/if}</td
							>
							<td
								>{#if art}<IconButton
										icon="trash"
										danger
										label={`Draw ${row.family} as today`}
										onclick={() => removeZoneArt(doc, row.family)}
									/>{/if}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="status">No zone to draw.</p>
		{/if}
		{#each issuesFor('arcade.zoneArt') as issue (issue.path + issue.message)}
			<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
		{/each}
	</fieldset>
</SectionCard>

<style>
	.panel {
		min-width: 0;
		margin: 0 0 12px;
		border: 1px solid #1c1c24;
		border-left: 3px solid #7ee0c0;
		border-radius: 10px;
		padding: 12px;
		background: #0e0e14;
	}
	.status {
		margin: 0;
		font-size: 12px;
		color: #b9b9c4;
	}
	label.inline {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8b98;
	}
	label.toggle {
		margin-bottom: 8px;
	}
	.picture {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		margin-bottom: 4px;
	}
	.default {
		font-size: 12px;
		color: #8b8b98;
	}
	.thumb {
		display: inline-flex;
		width: 40px;
		height: 40px;
		align-items: center;
		justify-content: center;
		background: #14141b;
		border-radius: 4px;
	}
	input,
	select {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 6px 8px;
		font-size: 13px;
		font-family: inherit;
		box-sizing: border-box;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	input[type='number'] {
		width: 80px;
	}
	input[type='checkbox'] {
		width: auto;
		margin: 0;
	}
	.fps input {
		width: 70px;
	}
	.tbl {
		border-collapse: collapse;
	}
	.tbl th {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 4px 8px;
		text-align: left;
		border-bottom: 1px solid #1c1c24;
	}
	.tbl td {
		padding: 4px 8px;
		border-bottom: 1px solid #16161d;
		vertical-align: top;
		font-size: 12px;
		color: #b9b9c4;
	}
	tr.stale .chip {
		color: #d3b483;
	}
	button.small {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
	.chip {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #26262f;
		background: #14141b;
		color: #7ee0c0;
		white-space: nowrap;
	}
	.inline-issue {
		margin: 8px 0 0;
		font-size: 12px;
	}
	.inline-issue.warning {
		color: #d3b483;
	}
	.inline-issue.error {
		color: #e09090;
	}
</style>
