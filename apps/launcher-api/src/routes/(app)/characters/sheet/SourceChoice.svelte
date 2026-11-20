<script lang="ts">
	/**
	 * THE CHOICE of what draws a character (`docs/design/character-pipeline.md` §12.4): frame
	 * clips, a rig or still images, as three tiles with what each is (`sheetCore.ts`
	 * `SOURCE_KINDS`). It writes nothing: the host is told which was pressed.
	 */
	import { SOURCE_KINDS, type SourceKind } from '$lib/characters/sheetCore';

	interface Props {
		/** The kind shown as chosen, if any. */
		value: SourceKind | undefined;
		/** The kind the sheet stores, marked on its tile. */
		stored?: SourceKind;
		disabled?: boolean;
		onChoose: (kind: SourceKind) => void;
	}
	let { value, stored, disabled = false, onChoose }: Props = $props();
</script>

<div class="choice" role="radiogroup" aria-label="What draws the character" data-source-choice>
	{#each SOURCE_KINDS as kind (kind.value)}
		<button
			type="button"
			role="radio"
			class="tile"
			class:on={value === kind.value}
			aria-checked={value === kind.value}
			data-source-kind={kind.value}
			data-stored={stored === kind.value}
			{disabled}
			onclick={() => onChoose(kind.value)}
		>
			<span class="name">
				{kind.label}
				{#if stored === kind.value}<span class="tag">in use</span>{/if}
			</span>
			<span class="what">{kind.description}</span>
		</button>
	{/each}
</div>

<style>
	.choice {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 8px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		background: #14141a;
		color: #b9b9c4;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.tile:hover:not(:disabled) {
		border-color: #3b4a63;
	}
	.tile.on {
		border-color: #2563eb;
		background: #131c2e;
		box-shadow: inset 0 0 0 1px #2563eb;
	}
	.tile:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		color: #e8e8ee;
	}
	.tag {
		font-size: 10px;
		font-weight: 400;
		padding: 0 6px;
		border-radius: 999px;
		border: 1px solid #1f6f54;
		color: #86efac;
	}
	.what {
		font-size: 11px;
		line-height: 1.45;
		color: #8b8b98;
	}
</style>
