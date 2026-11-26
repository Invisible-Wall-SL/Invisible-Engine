<script lang="ts">
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';

	import {
		ZONE_ART_LIMITS,
		zoneArtTakesRig,
		type GameConfigDoc,
		type GameConfigIssue,
		type ZoneArt,
		type ZoneArtSource,
	} from 'game-config';
	import RigSelect from '$lib/characters/RigSelect.svelte';
	import { resolve } from '$app/paths';
	import { componentsHref } from '$lib/componentLinks';
	import CardArt from '../cards/CardArt.svelte';
	import RegionPicker from '../editor/RegionPicker.svelte';
	import {
		addZoneArtVariant,
		clipThumbRef,
		compiledPropText,
		componentSourceOf,
		removeZoneArt,
		rigCrowdWarning,
		rigLooped,
		rigPicked,
		rigSourceOf,
		setZoneArtScale,
		setZoneArtSource,
		shownZoneArtRows,
		zoneArtDefault,
		zoneArtPinNote,
		zoneArtPropsFor,
		zoneArtRigNames,
		zoneArtRows,
		zoneArtSceneryRows,
		type ZoneArtProp,
		type ZoneArtRigs,
	} from './zoneArtDoc';
	import type { SalmonsCodeDrawn } from './zoneArtBuiltIn';

	/**
	 * THE ZONE ART CARD of `/config` (`arcade.zoneArt`, `docs/design/zone-art.md`): per zone family
	 * of the zones the game plays, what each of its zones is drawn with, and under **Scenery** what
	 * each piece its art places on no zone is drawn with (Salmons' trees). The picture is a frame of
	 * a project sheet (the Scene Editor's region picker), a Flipbook clip, or (a zone family only)
	 * one of the project's rigs and one of its animations (a character sheet's rig picker); more
	 * pictures are variants, one per zone (or piece) by the room's seed. Every edit goes through
	 * `./zoneArtDoc`.
	 */
	type Clip = { id: string; name: string; assetKey: string; firstFrame: string };
	let {
		doc = $bindable(),
		zones,
		generator,
		readOnly,
		pickSheets,
		clips,
		rigs,
		props = [],
		projectKey = '',
		issuesFor,
	}: {
		doc: GameConfigDoc;
		/** The zones the game plays: the config's own, or the level the shown seed makes. */
		zones: readonly { id: string }[];
		generator: string | undefined;
		readOnly: boolean;
		pickSheets: { key: string; name: string }[];
		clips: Clip[];
		rigs: ZoneArtRigs;
		/** The project's prop components (defs with a `prop` block), by zone kind. */
		props?: readonly ZoneArtProp[];
		/** For the link to a component in the Scene Editor. */
		projectKey?: string;
		issuesFor: (prefix: string) => GameConfigIssue[];
	} = $props();

	let showRuleOnly = $state(false);
	const rows = $derived(zoneArtRows(zones, doc, generator));
	const hidden = $derived(rows.length - shownZoneArtRows(rows, false).length);
	const shown = $derived(shownZoneArtRows(rows, showRuleOnly));
	const scenery = $derived(zoneArtSceneryRows(doc, generator));
	const clipsById = $derived(new Map(clips.map((c) => [c.id, c])));

	const KINDS = [
		['', 'Default'],
		['sprite', 'Sheet frame'],
		['flipbook', 'Flipbook clip'],
		['rig', 'Rig'],
		['component', 'Component'],
	] as const;

	/** Why picture `index` of a row's "Drawn with" cannot be `kind`, or `''` when it can. */
	function refusal(kind: string, family: string, index = 0): string {
		if (kind === 'flipbook' && !clips.length) return 'This project has no Flipbook clips yet';
		if (kind === 'component') {
			if (!zoneArtTakesRig(family)) return 'Scenery cannot be a component';
			if (index) return 'A component draws the whole family: it is never a variant';
			return zoneArtPropsFor(family, props).length
				? ''
				: `This project has no ${family.replace(/#/g, '')} prop components yet`;
		}
		if (kind !== 'rig') return '';
		if (!zoneArtTakesRig(family))
			return 'Trees cannot be a rig: about 430 rigs cost a phone several milliseconds a frame. Use a frame or a clip.';
		return rigs.list.length ? '' : 'This project has no rigs yet';
	}

	/** A new picture of `kind`, kept from `was` where it is the same kind; none to pick yet ⇒ none. */
	function sourceOfKind(kind: string, was: ZoneArtSource | undefined): ZoneArtSource | undefined {
		if (kind === was?.kind) return was;
		if (kind === 'flipbook' && clips[0]) return { kind: 'flipbook', clip: clips[0].id };
		return undefined;
	}
	/** The first prop component of `family`'s zone kind, pinned at its latest version. */
	function firstComponent(family: string): ZoneArtSource | undefined {
		const prop = zoneArtPropsFor(family, props)[0];
		return prop && componentSourceOf(prop);
	}
	/** A picture still to be completed, shown in its row until it is: a sprite with no frame yet,
	 *  or a rig with no animation of it picked yet. */
	type Pending = { kind: 'sprite' } | { kind: 'rig'; rig: string };
	let pending = $state<Record<string, Pending>>({});
	const keyOf = (family: string, index: number) => `${family}\u0000${index}`;
	function clearPending(family: string, index: number) {
		const { [keyOf(family, index)]: _, ...rest } = pending;
		pending = rest;
	}

	function pickKind(family: string, index: number, was: ZoneArtSource | undefined, kind: string) {
		const key = keyOf(family, index);
		if (kind === 'sprite' && was?.kind !== 'sprite') {
			pending = { ...pending, [key]: { kind: 'sprite' } };
			return;
		}
		if (kind === 'rig' && was?.kind !== 'rig' && rigs.list[0]) {
			pending = { ...pending, [key]: { kind: 'rig', rig: rigs.list[0].name } };
			return;
		}
		clearPending(family, index);
		setZoneArtSource(
			doc,
			family,
			index,
			kind === 'component' && was?.kind !== 'component'
				? firstComponent(family)
				: sourceOfKind(kind, was),
		);
	}
	function pickRegion(family: string, index: number, region: string) {
		clearPending(family, index);
		setZoneArtSource(doc, family, index, region ? { kind: 'sprite', region } : undefined);
	}
	/** Another rig: its animation of the same name, else one of its own to be picked first. */
	function pickRig(family: string, index: number, was: ZoneArtSource | undefined, rig: string) {
		if (!rig) return;
		const kept = rigPicked(was, rig, rigs.animationsOf(rig));
		if (kept) {
			clearPending(family, index);
			setZoneArtSource(doc, family, index, kept);
		} else pending = { ...pending, [keyOf(family, index)]: { kind: 'rig', rig } };
	}
	function pickAnimation(
		family: string,
		index: number,
		was: ZoneArtSource | undefined,
		rig: string,
		animation: string,
	) {
		if (!animation) return;
		clearPending(family, index);
		setZoneArtSource(doc, family, index, rigSourceOf(was, rig, animation));
	}
	// The animations of every rig the card shows are read, once each.
	$effect(() => {
		const shown = [
			...zoneArtRigNames(doc),
			...Object.values(pending).flatMap((p) => (p.kind === 'rig' ? [p.rig] : [])),
		];
		for (const rig of shown) rigs.read(rig);
	});
	function setFps(family: string, index: number, source: ZoneArtSource, value: string) {
		if (source.kind !== 'flipbook') return;
		const n = Number(value);
		const { min, max } = ZONE_ART_LIMITS.fps;
		const { fps: _, ...rest } = source;
		const fps = value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
		setZoneArtSource(doc, family, index, fps ? { ...rest, fps } : rest);
	}
</script>

{#snippet codeDrawn(drawn: SalmonsCodeDrawn)}
	<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
		{#if drawn === 'sea'}
			<polygon points="0,32 32,16 64,32 32,48" fill="#0369a1" />
			<polygon points="19,30 32,27 45,30 32,32" fill="#0284c7" />
		{:else if drawn === 'source'}
			<polygon points="0,32 32,12 64,32 32,52" fill="#28591e" />
			<polygon points="12,32 32,22 52,32 32,42" fill="#7dd3fc" />
		{:else}
			<rect x="14" y="34" width="5" height="16" fill="#5b3a20" />
			<rect x="45" y="34" width="5" height="16" fill="#5b3a20" />
			<polygon points="0,32 32,16 64,32 32,48" fill="#966637" stroke="#4a2e16" stroke-width="2" />
			<line x1="16" y1="24" x2="48" y2="40" stroke="#5b3a20" stroke-opacity="0.6" />
			<line x1="16" y1="40" x2="48" y2="24" stroke="#5b3a20" stroke-opacity="0.6" />
		{/if}
	</svg>
{/snippet}

{#snippet picture(
	family: string,
	index: number,
	source: ZoneArtSource | undefined,
	ruleOnly = false,
)}
	{@const waiting = pending[keyOf(family, index)]}
	{@const kind = waiting?.kind ?? source?.kind ?? ''}
	<div class="picture">
		<select
			value={kind}
			aria-label={index ? `Variant ${index}` : 'Drawn with'}
			onchange={(e) => pickKind(family, index, source, e.currentTarget.value)}
		>
			{#each KINDS as [value, label] (value)}
				{@const refused = value === source?.kind ? '' : refusal(value, family, index)}
				<option {value} disabled={!!refused} title={refused}
					>{index && !value ? 'Remove variant' : label}</option
				>
			{/each}
		</select>
		{#if !kind && !index}
			{@const current = zoneArtDefault(family, generator, pickSheets, ruleOnly)}
			<span class="default">{current.label}</span>
			{#if current.drawn}
				<span class="thumb" title="Drawn in code: a preview in the game's colours"
					>{@render codeDrawn(current.drawn)}</span
				>
			{/if}
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
		{:else if source?.kind === 'component'}
			{@const choices = zoneArtPropsFor(family, props)}
			{@const note = zoneArtPinNote(source, props)}
			{@const latest = choices.find((p) => p.id === source.component)}
			{@const compiled = compiledPropText(doc, family)}
			<select
				value={source.component}
				aria-label="Component"
				onchange={(e) => {
					const picked = choices.find((p) => p.id === e.currentTarget.value);
					if (picked) setZoneArtSource(doc, family, index, componentSourceOf(picked));
				}}
			>
				{#if !latest}
					<option value={source.component}>{source.component} (not in this project)</option>
				{/if}
				{#each choices as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
			<span class="pin">v{source.version}</span>
			{#if latest && latest.version > source.version}
				<button
					class="small"
					onclick={() => setZoneArtSource(doc, family, index, componentSourceOf(latest))}
					>Use v{latest.version}</button
				>
			{/if}
			<a
				class="small"
				href="{resolve('/editor')}?{componentsHref(
					source.component,
					new URLSearchParams({ project: projectKey }),
				).split('?')[1]}">Open</a
			>
			<span class="inline"
				>Collider <code>{compiled || 'compiled on save'}</code>
				<InfoTip
					>What the room plays for this family: the component's collider at the pinned version,
					compiled when the config is saved (arcade.online.props). Fields equal to today's bridge
					are left out. Edit it in the component, then choose the new version here.</InfoTip
				></span
			>
			{#if note}<p class="inline-issue warning">{note}</p>{/if}
		{:else if kind === 'rig'}
			{@const stored = source?.kind === 'rig' ? source : undefined}
			{@const rig = waiting?.kind === 'rig' ? waiting.rig : (stored?.rig ?? '')}
			{@const animations = rigs.animationsOf(rig)}
			{@const animation = waiting ? '' : (stored?.animation ?? '')}
			<RigSelect
				rigs={rigs.list}
				value={rig}
				label="Rig"
				onPick={(picked) => pickRig(family, index, source, picked)}
			/>
			<select
				value={animation}
				aria-label="Animation"
				onchange={(e) => pickAnimation(family, index, source, rig, e.currentTarget.value)}
			>
				{#if !animation}
					<option value="" disabled
						>{animations ? 'Pick an animation…' : 'Reading its animations…'}</option
					>
				{:else if !animations?.includes(animation)}
					<option value={animation}>{animation}{animations ? ' (not in this rig)' : ''}</option>
				{/if}
				{#each animations ?? [] as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
			{#if stored && !waiting}
				<label class="inline"
					><input
						type="checkbox"
						checked={stored.loop !== false}
						onchange={(e) =>
							setZoneArtSource(doc, family, index, rigLooped(stored, e.currentTarget.checked))}
					/>Loop
					<InfoTip
						>Off, it plays once from its start and holds its last pose. On, each zone starts it at a
						point the room's seed picks, so neighbours do not move in step.</InfoTip
					></label
				>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet artCells(key: string, name: string, art: ZoneArt | undefined, ruleOnly = false)}
	<td>
		{@render picture(key, 0, art?.source, ruleOnly)}
		{#each art?.variants ?? [] as variant, i (i)}
			{@render picture(key, i + 1, variant)}
		{/each}
		{#if art && art.source.kind !== 'component' && (art.variants?.length ?? 0) < ZONE_ART_LIMITS.variants}
			<button class="small" onclick={() => addZoneArtVariant(doc, key)}>＋ Variant</button>
		{/if}
	</td>
	<td
		>{#if art && art.source.kind !== 'component'}<input
				type="number"
				step="0.1"
				min={ZONE_ART_LIMITS.scale.min}
				max={ZONE_ART_LIMITS.scale.max}
				placeholder="1"
				value={art.scale ?? ''}
				onchange={(e) => setZoneArtScale(doc, key, e.currentTarget.value)}
			/>{/if}</td
	>
	<td
		>{#if art}<IconButton
				icon="trash"
				danger
				label={`Draw ${name} as today`}
				onclick={() => removeZoneArt(doc, key)}
			/>{/if}</td
	>
{/snippet}

<SectionCard scope="config" id="zoneArt" title="Zone art">
	{#snippet info()}
		<p>
			What each zone family is drawn with: a frame of one of the project's sheets, a Flipbook clip
			or one of the project's rigs playing one of its animations, stamped on every zone of the
			family, fitted inside it and centred, times its scale. Or a prop component of the family's
			kind (a bridge), which draws each zone itself and brings its collider: the room plays the
			collider of the version chosen here. Variants are more pictures: each zone draws one of them,
			chosen by the room's seed, the same on every device. A family with nothing chosen draws as it
			does today. Under Scenery, what the river places on no zone (Salmons' trees), chosen the same
			way. The art is for the eye only: it changes no rule and no level, and ships with the game
			like any art it names.
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
		{#if !shown.length}
			<p class="status">No zone to draw.</p>
		{/if}
		{#if shown.length || scenery.length}
			<table class="tbl">
				<thead>
					<tr>
						<th>Family</th>
						<th>Drawn with</th>
						<th>Scale</th>
						<th></th>
					</tr>
				</thead>
				{#if shown.length}
					<tbody>
						{#each shown as row (row.family)}
							{@const crowd = rigCrowdWarning(row.count, row.art)}
							<tr class:stale={!row.count}>
								<td
									><span
										class="chip"
										title={row.count
											? 'Zone ids that differ only in their numbers'
											: 'No zone of this family in the level shown'}
										>{row.family} × {row.count}</span
									>{#if crowd}<p class="inline-issue warning crowd">{crowd}</p>{/if}</td
								>
								{@render artCells(row.family, row.family, row.art, row.ruleOnly)}
							</tr>
						{/each}
					</tbody>
				{/if}
				{#if scenery.length}
					<tbody class="scenery">
						<tr>
							<th colspan="4" class="sub"
								><span class="inline"
									>Scenery
									<InfoTip
										>What the river places itself, on no zone: the trees of the forest and the
										banks. Each tree draws one of the pictures, chosen by the room's seed and its
										place, the same on every device, at a built-in tree's width times the scale,
										standing on its foot.</InfoTip
									></span
								></th
							>
						</tr>
						{#each scenery as row (row.key)}
							<tr class:stale={row.stale}>
								<td
									><span
										class="chip"
										title={row.stale
											? "This game's art places no scenery"
											: "Every tree of Salmons' forest and banks"}>{row.label}</span
									></td
								>
								{@render artCells(row.key, row.label, row.art)}
							</tr>
						{/each}
					</tbody>
				{/if}
			</table>
		{/if}
		{#each issuesFor('arcade.zoneArt') as issue (issue.path + issue.message)}
			<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
		{/each}
	</fieldset>
</SectionCard>

<style>
	.pin {
		opacity: 0.7;
		font-size: 12px;
	}
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
	.tbl th.sub {
		padding-top: 14px;
	}
	.sub .inline {
		display: inline-flex;
		align-items: center;
		gap: 6px;
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
	.inline-issue.crowd {
		max-width: 220px;
	}
	.inline-issue.error {
		color: #e09090;
	}
</style>
