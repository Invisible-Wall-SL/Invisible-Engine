<script lang="ts">
	/**
	 * The open model's own settings (`model.json`): its per-tier overrides and its LOD screen
	 * sizes, each shown over what it inherits.
	 */
	import type {
		ModelClass,
		ModelLodScreenSize,
		ModelTieredMap,
		ModelTierId,
	} from 'constants-shared/modelTiers';
	import {
		SETTING_SOURCE_LABEL,
		effectiveProfile,
		encodingSource,
		lodsSource,
		mapSource,
		overrideCount,
		screenSizeSource,
		type InheritedModelSettings,
		type SettingSource,
		type TierOverrides,
	} from '$lib/models/modelProfile';
	import IconButton from '$lib/ui/IconButton.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import ProfileGrid from './ProfileGrid.svelte';
	import ScreenSizeFields from './ScreenSizeFields.svelte';

	interface Props {
		cls: ModelClass;
		inherited: InheritedModelSettings;
		overrides: TierOverrides | undefined;
		/** The model's own screen sizes, or `undefined` while it inherits them. */
		screenSize: ModelLodScreenSize | undefined;
		readOnly: boolean;
		onoverrides: (next: TierOverrides | undefined) => void;
		onscreen: (next: ModelLodScreenSize | undefined) => void;
	}
	const { cls, inherited, overrides, screenSize, readOnly, onoverrides, onscreen }: Props =
		$props();

	const profile = $derived(effectiveProfile(inherited.tiers, overrides));
	const sizes = $derived(screenSize ?? inherited.lodScreenSize);
	const sizesFrom = $derived(screenSizeSource(cls, inherited, screenSize));

	/** Where a value the model does not set comes from: the Game Config or the default. */
	const inheritedFrom = (tier: ModelTierId, part: 'lods' | ModelTieredMap): SettingSource => {
		if (part === 'lods') return lodsSource(cls, tier, inherited, undefined);
		const size = mapSource(cls, tier, part, inherited, undefined);
		return size === 'project' ? size : encodingSource(cls, tier, part, inherited, undefined);
	};
</script>

<SectionCard scope="models" id="overrides" title="Overrides">
	{#snippet info()}
		<p>
			What this model ships on each tier, where it should differ from its class: the window of LOD
			levels, and for each map its largest size (or dropped) and its encoding. Saved in the model's
			model.json.
		</p>
		<p>
			The most specific setting wins: this model, then the Game Config's setting for the class, then
			the built-in default. Under each value is the one in effect.
		</p>
		<p>
			UASTC is the high-quality encoding (larger download), ETC1S the small one, PNG lossless and
			uncompressed on the GPU: for a decal that must stay pixel-exact.
		</p>
	{/snippet}
	{#snippet actions()}
		{#if overrideCount(overrides)}
			<span class="count">{overrideCount(overrides)} set</span>
			{#if !readOnly}
				<IconButton
					icon="reset"
					label="Clear every override of this model"
					onclick={() => onoverrides(undefined)}
				/>
			{/if}
		{/if}
	{/snippet}
	<ProfileGrid
		{cls}
		{profile}
		{overrides}
		layer="model"
		{inheritedFrom}
		{readOnly}
		onchange={onoverrides}
	/>
</SectionCard>

<SectionCard scope="models" id="screen" title="LOD screen sizes">
	{#snippet info()}
		<p>
			When each level draws, by how much of the screen height the model covers: a level is used from
			its size up to the next richer level's. Below "Hidden below" the model is not drawn.
		</p>
		<p>
			Sizes are per master level, so a tier that leaves the top levels out shows its first level at
			every larger size. This model's own sizes replace the inherited ones as a whole.
		</p>
	{/snippet}
	{#snippet actions()}
		<span class="count {sizesFrom}">{SETTING_SOURCE_LABEL[sizesFrom]}</span>
		{#if screenSize && !readOnly}
			<IconButton
				icon="reset"
				label="Back to the inherited screen sizes"
				onclick={() => onscreen(undefined)}
			/>
		{/if}
	{/snippet}
	<ScreenSizeFields {cls} {sizes} editable={!readOnly && !!screenSize} onchange={onscreen} />
	{#if !screenSize && !readOnly}
		<div class="row">
			<button type="button" onclick={() => onscreen(structuredClone(inherited.lodScreenSize))}>
				Set sizes for this model
			</button>
		</div>
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
	.count.model {
		border-color: #2a6a55;
		color: #7ee0c0;
	}
	.count.project {
		border-color: #2c4a7a;
		color: #6ea8ff;
	}
	.row {
		margin-bottom: 8px;
	}
	button {
		font: inherit;
		font-size: 12px;
		padding: 5px 10px;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		background: #14141a;
		color: #e8e8ee;
		cursor: pointer;
	}
</style>
