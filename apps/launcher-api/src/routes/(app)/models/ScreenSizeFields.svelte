<script lang="ts">
	/**
	 * One layer's LOD screen sizes as fields: the share of the screen height from which each master
	 * level draws (and `_LODU`, for a class that has one), and the size under which the model is
	 * hidden. A layer that inherits its sizes shows them greyed out.
	 */
	import {
		MODEL_CLASS_DEFAULTS,
		MODEL_LOD_ULTRA,
		type ModelClass,
		type ModelLodScreenSize,
	} from 'constants-shared/modelTiers';
	import { lodLabel } from '$lib/models/modelProfile';
	import InfoTip from '$lib/ui/InfoTip.svelte';

	interface Props {
		cls: ModelClass;
		/** The sizes in effect: this layer's own, or the ones it inherits. */
		sizes: ModelLodScreenSize;
		/** False while the layer inherits its sizes, or may not be edited. */
		editable: boolean;
		onchange: (next: ModelLodScreenSize) => void;
	}
	const { cls, sizes, editable, onchange }: Props = $props();

	const hasUltra = $derived(
		(MODEL_CLASS_DEFAULTS[cls].lodGenerate as { ultraTris?: number }).ultraTris !== undefined,
	);

	const percent = (fraction: number): string => String(+(fraction * 100).toFixed(3));
	const fraction = (text: string): number | null => {
		const n = Number(text);
		return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.min(n, 400) / 100 : null;
	};

	function setLevel(index: number, text: string) {
		const value = fraction(text);
		if (value === null || !editable) return;
		onchange({ ...sizes, levels: sizes.levels.map((v, i) => (i === index ? value : v)) });
	}
	function setUltra(text: string) {
		const value = fraction(text);
		if (value === null || !editable) return;
		onchange({
			levels: sizes.levels,
			...(value > 0 ? { ultra: value } : {}),
			cullBelow: sizes.cullBelow,
		});
	}
	function setCull(text: string) {
		const value = fraction(text);
		if (value === null || !editable) return;
		onchange({ ...sizes, cullBelow: value });
	}
</script>

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
					disabled={!editable}
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
					disabled={!editable}
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
				disabled={!editable}
				onchange={(e) => setCull(e.currentTarget.value)}
			/>%
		</span>
	</label>
</div>

<style>
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
</style>
