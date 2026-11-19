<script lang="ts">
	/**
	 * The open model's own settings (`model.json`): its per-tier overrides and its LOD screen
	 * sizes, each shown over what it inherits, plus what the Game Config sets for its class.
	 */
	import {
		MODEL_CLASS_DEFAULTS,
		MODEL_LOD_ULTRA,
		MODEL_TIERED_MAPS,
		MODEL_TIERS,
		type ModelClass,
		type ModelLodScreenSize,
		type ModelTieredMap,
		type ModelTierId,
	} from 'constants-shared/modelTiers';
	import {
		MODEL_TIER_LABEL,
		SETTING_SOURCE_LABEL,
		TIERED_MAP_LABEL,
		effectiveProfile,
		encodingSource,
		lodLabel,
		lodsSource,
		mapSource,
		overrideCount,
		screenSizeSource,
		type InheritedModelSettings,
		type SettingSource,
		type TierOverrides,
	} from '$lib/models/modelProfile';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import ProfileGrid from './ProfileGrid.svelte';

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
	const hasUltra = $derived(
		(MODEL_CLASS_DEFAULTS[cls].lodGenerate as { ultraTris?: number }).ultraTris !== undefined,
	);

	/** Where a value the model does not set comes from: the Game Config or the default. */
	const inheritedFrom = (tier: ModelTierId, part: 'lods' | ModelTieredMap): SettingSource => {
		if (part === 'lods') return lodsSource(cls, tier, inherited, undefined);
		const size = mapSource(cls, tier, part, inherited, undefined);
		return size === 'project' ? size : encodingSource(cls, tier, part, inherited, undefined);
	};

	const percent = (fraction: number): string => String(+(fraction * 100).toFixed(3));
	const fraction = (text: string): number | null => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.min(n, 400) / 100 : null;
	};

	function setLevel(index: number, text: string) {
		const value = fraction(text);
		if (value === null || !screenSize) return;
		onscreen({ ...screenSize, levels: screenSize.levels.map((v, i) => (i === index ? value : v)) });
	}
	function setUltra(text: string) {
		const value = fraction(text);
		if (value === null || !screenSize) return;
		onscreen({
			levels: screenSize.levels,
			...(value > 0 ? { ultra: value } : {}),
			cullBelow: screenSize.cullBelow,
		});
	}
	function setCull(text: string) {
		const value = fraction(text);
		if (value === null || !screenSize) return;
		onscreen({ ...screenSize, cullBelow: value });
	}

	/** What the Game Config sets for this class, against the code defaults. */
	const projectLines = $derived.by(() => {
		const defaults = MODEL_CLASS_DEFAULTS[cls];
		const lines: string[] = [];
		const window = (lods: readonly [number, number]) =>
			lods[0] === lods[1] ? lodLabel(lods[0]) : `${lodLabel(lods[0])} to ${lodLabel(lods[1])}`;
		const size = (v: number | 'drop') => (v === 'drop' ? 'dropped' : `${v}²`);
		for (const tier of MODEL_TIERS) {
			const own = inherited.tiers[tier];
			const base = defaults.tiers[tier];
			if (JSON.stringify(own.lods) !== JSON.stringify(base.lods))
				lines.push(
					`${MODEL_TIER_LABEL[tier]}: LOD window ${window(own.lods)} (default ${window(base.lods)})`,
				);
			for (const map of MODEL_TIERED_MAPS) {
				if (own.maps[map] !== base.maps[map])
					lines.push(
						`${MODEL_TIER_LABEL[tier]}: ${TIERED_MAP_LABEL[map]} ${size(own.maps[map])} (default ${size(base.maps[map])})`,
					);
				if (own.encoding[map] !== base.encoding[map])
					lines.push(
						`${MODEL_TIER_LABEL[tier]}: ${TIERED_MAP_LABEL[map]} as ${own.encoding[map]} (default ${base.encoding[map]})`,
					);
			}
		}
		if (JSON.stringify(inherited.lodScreenSize) !== JSON.stringify(defaults.lodScreenSize))
			lines.push('LOD screen sizes');
		return lines;
	});
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
	<div class="sizes">
		{#if hasUltra}
			<label>
				<span>{lodLabel(MODEL_LOD_ULTRA)} from</span>
				<span class="unit">
					<input
						type="number"
						min="0"
						max="400"
						step="0.1"
						value={sizes.ultra === undefined ? '' : percent(sizes.ultra)}
						disabled={readOnly || !screenSize}
						onchange={(e) => setUltra(e.currentTarget.value)}
					/>%
				</span>
			</label>
		{/if}
		{#each sizes.levels as level, i (i)}
			<label>
				<span>{lodLabel(i)} from</span>
				<span class="unit">
					<input
						type="number"
						min="0"
						max="400"
						step="0.1"
						value={percent(level)}
						disabled={readOnly || !screenSize}
						onchange={(e) => setLevel(i, e.currentTarget.value)}
					/>%
				</span>
			</label>
		{/each}
		<label>
			<span>
				Hidden below
				<InfoTip>Smaller than this on screen, the model is not drawn at all.</InfoTip>
			</span>
			<span class="unit">
				<input
					type="number"
					min="0"
					max="400"
					step="0.1"
					value={percent(sizes.cullBelow)}
					disabled={readOnly || !screenSize}
					onchange={(e) => setCull(e.currentTarget.value)}
				/>%
			</span>
		</label>
	</div>
	{#if !screenSize && !readOnly}
		<div class="row">
			<button type="button" onclick={() => onscreen(structuredClone(inherited.lodScreenSize))}>
				Set sizes for this model
			</button>
		</div>
	{/if}
</SectionCard>

<SectionCard scope="models" id="project" title="Game Config defaults">
	{#snippet info()}
		<p>
			What this project's Game Config sets for every {cls} (its models block), the layer between a model's
			own overrides and the built-in defaults. Shown here to explain the values above; it is not edited
			on this page yet.
		</p>
	{/snippet}
	{#if projectLines.length}
		<ul class="lines">
			{#each projectLines as line (line)}<li>{line}</li>{/each}
		</ul>
	{:else}
		<p class="none">The Game Config sets nothing for a {cls}: the built-in defaults apply.</p>
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
	.sizes {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 20px;
		margin-bottom: 10px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.unit {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #8b8b98;
	}
	input {
		width: 76px;
		font: inherit;
		font-size: 12px;
		padding: 5px 8px;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		background: #14141a;
		color: #e8e8ee;
	}
	input:disabled {
		opacity: 0.6;
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
	.lines {
		margin: 0 0 8px;
		padding-left: 18px;
		font-size: 12px;
		line-height: 1.7;
		color: #b9b9c4;
	}
	.none {
		margin: 0 0 8px;
		font-size: 12px;
		color: #8b8b98;
	}
</style>
