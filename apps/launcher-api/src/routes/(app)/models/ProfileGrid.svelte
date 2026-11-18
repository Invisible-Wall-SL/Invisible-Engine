<script lang="ts">
	/**
	 * One layer of tier settings as a grid: a column per quality tier, a row for the LOD window and
	 * one per map (size or dropped, and encoding). Every cell shows the value in effect and where it
	 * comes from; a value this layer sets carries a reset back to what it inherits.
	 */
	import {
		MODEL_TIERED_MAPS,
		MODEL_TIERS,
		type ModelClass,
		type ModelTextureEncoding,
		type ModelTieredMap,
		type ModelTierId,
		type ModelTierProfile,
	} from 'constants-shared/modelTiers';
	import {
		MODEL_ENCODINGS,
		MODEL_MAP_SIZES,
		MODEL_TIER_LABEL,
		SETTING_SOURCE_LABEL,
		TIERED_MAP_LABEL,
		classLodLevels,
		lodLabel,
		setEncodingOverride,
		setLodsOverride,
		setMapOverride,
		type SettingSource,
		type TierOverrides,
	} from '$lib/models/modelProfile';
	import IconButton from '$lib/ui/IconButton.svelte';

	interface Props {
		cls: ModelClass;
		/** The values in effect, this layer's included. */
		profile: Readonly<Record<ModelTierId, ModelTierProfile>>;
		/** What this layer sets. */
		overrides: TierOverrides | undefined;
		/** The layer being edited. */
		layer: SettingSource;
		/** Where a value this layer does not set comes from. */
		inheritedFrom: (tier: ModelTierId, part: 'lods' | ModelTieredMap) => SettingSource;
		readOnly: boolean;
		onchange: (next: TierOverrides | undefined) => void;
	}
	const { cls, profile, overrides, layer, inheritedFrom, readOnly, onchange }: Props = $props();

	const ENCODING_LABEL: Record<ModelTextureEncoding, string> = {
		uastc: 'UASTC',
		etc1s: 'ETC1S',
		png: 'PNG',
	};

	const levels = $derived(classLodLevels(cls));
	const toLevels = $derived(levels.filter((l) => l >= 0));

	const setsLods = (tier: ModelTierId): boolean => !!overrides?.[tier]?.lods;
	const setsMap = (tier: ModelTierId, map: ModelTieredMap): boolean =>
		overrides?.[tier]?.maps?.[map] !== undefined ||
		overrides?.[tier]?.encoding?.[map] !== undefined;
	const source = (tier: ModelTierId, part: 'lods' | ModelTieredMap): SettingSource =>
		(part === 'lods' ? setsLods(tier) : setsMap(tier, part)) ? layer : inheritedFrom(tier, part);

	function changeLods(tier: ModelTierId, which: 0 | 1, value: string) {
		const next: [number, number] = [profile[tier].lods[0], profile[tier].lods[1]];
		next[which] = Number(value);
		// A window keeps its order: moving one end past the other drags the other along.
		if (next[0] > next[1]) next[which === 0 ? 1 : 0] = Math.max(0, next[which]);
		onchange(setLodsOverride(overrides, tier, next));
	}

	/** The sizes offered, with the one in use when the Game Config sets a size off the list. */
	const sizesWith = (size: number | 'drop'): readonly number[] =>
		size === 'drop' || MODEL_MAP_SIZES.includes(size)
			? MODEL_MAP_SIZES
			: [...MODEL_MAP_SIZES, size].sort((a, b) => b - a);

	function changeSize(tier: ModelTierId, map: ModelTieredMap, value: string) {
		onchange(setMapOverride(overrides, tier, map, value === 'drop' ? 'drop' : Number(value)));
	}

	function resetMap(tier: ModelTierId, map: ModelTieredMap) {
		onchange(setEncodingOverride(setMapOverride(overrides, tier, map, null), tier, map, null));
	}
</script>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th></th>
				{#each MODEL_TIERS as tier (tier)}<th>{MODEL_TIER_LABEL[tier]}</th>{/each}
			</tr>
		</thead>
		<tbody>
			<tr>
				<th scope="row">LOD window</th>
				{#each MODEL_TIERS as tier (tier)}
					{@const from = source(tier, 'lods')}
					<td>
						<div class="pair">
							<select
								aria-label="{MODEL_TIER_LABEL[tier]}: first level shipped"
								value={String(profile[tier].lods[0])}
								disabled={readOnly}
								onchange={(e) => changeLods(tier, 0, e.currentTarget.value)}
							>
								{#each levels as level (level)}
									<option value={String(level)}>{lodLabel(level)}</option>
								{/each}
							</select>
							<span class="to">to</span>
							<select
								aria-label="{MODEL_TIER_LABEL[tier]}: last level shipped"
								value={String(profile[tier].lods[1])}
								disabled={readOnly}
								onchange={(e) => changeLods(tier, 1, e.currentTarget.value)}
							>
								{#each toLevels as level (level)}
									<option value={String(level)}>{lodLabel(level)}</option>
								{/each}
							</select>
						</div>
						<div class="from {from}">
							<span>{SETTING_SOURCE_LABEL[from]}</span>
							{#if setsLods(tier) && !readOnly}
								<IconButton
									icon="reset"
									label="Back to the inherited window"
									onclick={() => onchange(setLodsOverride(overrides, tier, null))}
								/>
							{/if}
						</div>
					</td>
				{/each}
			</tr>
			{#each MODEL_TIERED_MAPS as map (map)}
				<tr>
					<th scope="row">{TIERED_MAP_LABEL[map]}</th>
					{#each MODEL_TIERS as tier (tier)}
						{@const size = profile[tier].maps[map]}
						{@const from = source(tier, map)}
						<td>
							<div class="pair">
								<select
									aria-label="{MODEL_TIER_LABEL[tier]} {TIERED_MAP_LABEL[map]}: largest size"
									value={String(size)}
									disabled={readOnly}
									onchange={(e) => changeSize(tier, map, e.currentTarget.value)}
								>
									{#each sizesWith(size) as side (side)}
										<option value={String(side)}>{side}²</option>
									{/each}
									<option value="drop">Dropped</option>
								</select>
								<select
									aria-label="{MODEL_TIER_LABEL[tier]} {TIERED_MAP_LABEL[map]}: encoding"
									value={profile[tier].encoding[map]}
									disabled={readOnly || size === 'drop'}
									onchange={(e) =>
										onchange(
											setEncodingOverride(
												overrides,
												tier,
												map,
												e.currentTarget.value as ModelTextureEncoding,
											),
										)}
								>
									{#each MODEL_ENCODINGS as encoding (encoding)}
										<option value={encoding}>{ENCODING_LABEL[encoding]}</option>
									{/each}
								</select>
							</div>
							<div class="from {from}">
								<span>{SETTING_SOURCE_LABEL[from]}</span>
								{#if setsMap(tier, map) && !readOnly}
									<IconButton
										icon="reset"
										label="Back to the inherited size and encoding"
										onclick={() => resetMap(tier, map)}
									/>
								{/if}
							</div>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
		margin-bottom: 8px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	th,
	td {
		padding: 8px 12px 8px 0;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		vertical-align: top;
		font-weight: 400;
	}
	tr:last-child th,
	tr:last-child td {
		border-bottom: none;
	}
	thead th {
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #8b8b98;
	}
	tbody th {
		color: #e8e8ee;
		font-weight: 600;
		white-space: nowrap;
		padding-top: 13px;
	}
	.pair {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.to {
		color: #8b8b98;
	}
	select {
		font: inherit;
		font-size: 12px;
		padding: 4px 6px;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		background: #14141a;
		color: #e8e8ee;
	}
	select:disabled {
		opacity: 0.5;
	}
	.from {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 24px;
		margin-top: 2px;
		font-size: 11px;
		color: #6f6f7d;
	}
	.from.project {
		color: #6ea8ff;
	}
	.from.model {
		color: #7ee0c0;
	}
</style>
