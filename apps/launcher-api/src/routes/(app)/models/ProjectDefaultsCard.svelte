<script lang="ts">
	/**
	 * The project's defaults per model class (the Game Config's `models` block): the layer between
	 * a model's own overrides and the code defaults. Read-only it lists what the stored block sets
	 * for the open model's class. In an edit session (`ProjectDefaultsEdit`) it edits the block one
	 * class at a time: the Overrides grid pointed at this layer, and the class's LOD screen sizes.
	 */
	import { resolve } from '$app/paths';
	import {
		MODEL_CLASSES,
		MODEL_CLASS_DEFAULTS,
		MODEL_TIERED_MAPS,
		MODEL_TIERS,
		isModelClass,
		type ModelClass,
	} from 'constants-shared/modelTiers';
	import {
		MODEL_TIER_LABEL,
		SETTING_SOURCE_LABEL,
		TIERED_MAP_LABEL,
		lodLabel,
		overrideCount,
		type InheritedModelSettings,
		type SettingSource,
	} from '$lib/models/modelProfile';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import SaveStatusBadge from '$lib/SaveStatusBadge.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import ProfileGrid from './ProfileGrid.svelte';
	import type { ProjectDefaultsEdit } from './projectDefaultsEdit.svelte';
	import ScreenSizeFields from './ScreenSizeFields.svelte';

	interface Props {
		/** The open model's class: what the read-only card lists, and the class an edit opens on. */
		cls: ModelClass;
		/** What the stored Game Config makes that class inherit. */
		stored: InheritedModelSettings;
		projectKey: string;
		/** The user holds Invisible Game Config, so may edit these defaults. */
		canEdit: boolean;
		session: ProjectDefaultsEdit;
		/** Leave the edit session. The page asks first when the draft is not saved. */
		ondone: () => void;
	}
	const { cls, stored, projectKey, canEdit, session, ondone }: Props = $props();

	/** What the stored Game Config sets for the open model's class, against the code defaults. */
	const lines = $derived.by(() => {
		const defaults = MODEL_CLASS_DEFAULTS[cls];
		const out: string[] = [];
		const window = (lods: readonly [number, number]) =>
			lods[0] === lods[1] ? lodLabel(lods[0]) : `${lodLabel(lods[0])} to ${lodLabel(lods[1])}`;
		const size = (v: number | 'drop') => (v === 'drop' ? 'dropped' : `${v}²`);
		for (const tier of MODEL_TIERS) {
			const set = stored.tiers[tier];
			const base = defaults.tiers[tier];
			if (JSON.stringify(set.lods) !== JSON.stringify(base.lods))
				out.push(
					`${MODEL_TIER_LABEL[tier]}: LOD window ${window(set.lods)} (default ${window(base.lods)})`,
				);
			for (const map of MODEL_TIERED_MAPS) {
				if (set.maps[map] !== base.maps[map])
					out.push(
						`${MODEL_TIER_LABEL[tier]}: ${TIERED_MAP_LABEL[map]} ${size(set.maps[map])} (default ${size(base.maps[map])})`,
					);
				if (set.encoding[map] !== base.encoding[map])
					out.push(
						`${MODEL_TIER_LABEL[tier]}: ${TIERED_MAP_LABEL[map]} as ${set.encoding[map]} (default ${base.encoding[map]})`,
					);
			}
		}
		if (JSON.stringify(stored.lodScreenSize) !== JSON.stringify(defaults.lodScreenSize))
			out.push('LOD screen sizes');
		return out;
	});

	// The edit session: what its draft sets for the class it shows, over the code defaults.
	const own = $derived(session.own);
	const layer = $derived(session.layer);
	const count = $derived(overrideCount(own.tiers) + (own.lodScreenSize ? 1 : 0));
	const sizesFrom = $derived<SettingSource>(own.lodScreenSize ? 'project' : 'default');
	const fromDefault = (): SettingSource => 'default';

	function pick(next: string): void {
		if (isModelClass(next)) session.cls = next;
	}
</script>

<SectionCard scope="models" id="project" title="Game Config defaults">
	{#snippet info()}
		<p>
			What this project's Game Config sets for every model of a class (its models block): the layer
			between a model's own overrides and the built-in defaults.
		</p>
		<p>
			Edit the defaults to change them for the whole project, one class at a time. While you edit,
			the open model is shown against your changes. A saved change to a LOD window or a map puts the
			derive of that class's models out of date.
		</p>
		<p>
			They are saved inside the Game Config, which one person edits at a time: while you edit here,
			Invisible Game Config and the tools that save into it are read-only for everyone else, until
			you press Done.
		</p>
	{/snippet}
	{#snippet actions()}
		{#if session.editing}
			<span class="count" class:unsaved={session.dirty && !session.readOnly}>
				{session.readOnly ? 'Read-only' : session.dirty ? 'Unsaved' : 'Editing'}
			</span>
			{#if count}
				<span class="count project">{count} set</span>
				{#if session.canEdit}
					<IconButton
						icon="reset"
						label="Clear everything the Game Config sets for a {session.cls}"
						onclick={() => session.clearClass()}
					/>
				{/if}
			{/if}
		{/if}
	{/snippet}

	{#if session.editing}
		<div class="bar">
			<label class="pick">
				<span>Class</span>
				<select value={session.cls} onchange={(e) => pick(e.currentTarget.value)}>
					{#each MODEL_CLASSES as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>
			</label>
			<span class="grow"></span>
			{#if session.readOnly}
				<PresenceBanner lease={session.lease} />
			{:else}
				<SaveStatusBadge
					state={session.saveState}
					okAccent
					conflictLabel="⚠ The Game Config changed"
					onSave={() => void session.save()}
					onRetry={() => void session.save()}
				/>
			{/if}
			<button
				type="button"
				disabled={session.busy || session.saveState.busy}
				title="Stop editing and let others edit the Game Config again."
				onclick={() => ondone()}
			>
				Done
			</button>
		</div>
		{#if session.saveState.status === 'conflict'}
			<div class="conflict" role="alert">
				<span>
					Someone saved the Game Config after you opened it here, so your defaults were not saved.
				</span>
				<button type="button" disabled={session.busy} onclick={() => void session.reload(false)}>
					Load theirs
				</button>
				<button
					type="button"
					disabled={session.busy}
					title="Take their Game Config and keep the defaults on this card, unsaved, so you can save them over it."
					onclick={() => void session.reload(true)}
				>
					Keep my defaults
				</button>
			</div>
		{/if}
		{#if session.saveState.status === 'error' && session.saveState.message}
			<p class="err" role="alert">{session.saveState.message}</p>
		{/if}
		{#if session.error}<p class="err" role="alert">{session.error}</p>{/if}

		<ProfileGrid
			cls={session.cls}
			profile={layer.tiers}
			overrides={own.tiers}
			layer="project"
			inheritedFrom={fromDefault}
			readOnly={!session.canEdit}
			onchange={(next) => session.setTiers(next)}
		/>

		<div class="sub">
			<h3>LOD screen sizes</h3>
			<InfoTip>
				From how much of the screen height each level of a {session.cls} draws. Sizes set here replace
				the built-in ones as a whole, for every {session.cls} without sizes of its own.
			</InfoTip>
			<span class="count {sizesFrom}">{SETTING_SOURCE_LABEL[sizesFrom]}</span>
			{#if own.lodScreenSize && session.canEdit}
				<IconButton
					icon="reset"
					label="Back to the built-in screen sizes"
					onclick={() => session.setScreenSize(undefined)}
				/>
			{/if}
		</div>
		{#key session.cls}
			<ScreenSizeFields
				cls={session.cls}
				sizes={layer.lodScreenSize}
				editable={session.canEdit && !!own.lodScreenSize}
				onchange={(next) => session.setScreenSize(next)}
			/>
		{/key}
		{#if !own.lodScreenSize && session.canEdit}
			<div class="row">
				<button type="button" onclick={() => session.setScreenSize(layer.lodScreenSize)}>
					Set sizes for every {session.cls}
				</button>
			</div>
		{/if}
	{:else}
		{#if lines.length}
			<ul class="lines">
				{#each lines as line (line)}<li>{line}</li>{/each}
			</ul>
		{:else}
			<p class="note">The Game Config sets nothing for a {cls}: the built-in defaults apply.</p>
		{/if}
		{#if !canEdit}
			<p class="note">Editing these defaults needs access to Invisible Game Config.</p>
		{:else}
			{#if session.missing}
				<p class="note caution" role="status">
					This project has no usable Game Config yet, so there is nowhere to keep its defaults. Save
					one in
					<a href="{resolve('/config')}?project={encodeURIComponent(projectKey)}"
						>Invisible Game Config</a
					> first.
				</p>
			{/if}
			{#if session.error}<p class="err" role="alert">{session.error}</p>{/if}
			<div class="row">
				<button type="button" disabled={session.busy} onclick={() => void session.begin(cls)}>
					{session.busy ? 'Opening the Game Config…' : 'Edit the defaults'}
				</button>
			</div>
		{/if}
	{/if}
</SectionCard>

<style>
	.count {
		font-size: 11px;
		padding: 1px 8px;
		border: 1px solid #2a2a35;
		border-radius: 999px;
		color: #8b8b98;
	}
	.count.project {
		border-color: #2c4a7a;
		color: #6ea8ff;
	}
	.count.unsaved {
		border-color: #5a4520;
		color: #d3b483;
	}
	.bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 12px;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.grow {
		flex: 1;
	}
	button,
	select {
		font: inherit;
		font-size: 12px;
		padding: 5px 10px;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		background: #14141a;
		color: #e8e8ee;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.conflict {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		margin: 0 0 12px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.conflict span {
		flex: 1;
		min-width: 240px;
	}
	.err {
		margin: 0 0 12px;
		font-size: 12px;
		color: #ff9a9a;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 6px 0 8px;
	}
	h3 {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		color: #b9b9c4;
	}
	.row {
		margin-bottom: 8px;
	}
	.lines {
		margin: 0 0 8px;
		padding-left: 18px;
		font-size: 12px;
		line-height: 1.7;
		color: #b9b9c4;
	}
	.note {
		margin: 0 0 8px;
		font-size: 12px;
		line-height: 1.6;
		color: #8b8b98;
	}
	.note.caution {
		color: #d3b483;
	}
	a {
		color: #7ee0c0;
	}
</style>
