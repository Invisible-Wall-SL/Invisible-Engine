<script lang="ts" module>
	export type Graphics3dOption = { value: string; label: string };

	export type Graphics3dPanelProps = {
		/** The settings this device and build may offer, in order. */
		options: readonly Graphics3dOption[];
		/** The setting kept now. */
		current: string;
		/** What the current choice loads, e.g. "Medium (half)". */
		loads: string;
		/** Shown when the last change waits for the next load (MSAA, model files). */
		note?: string;
		onpick: (value: string) => void;
		onclose: () => void;
	};
</script>

<script lang="ts">
	import { zIndex } from 'constants-shared/zIndex';
	import { Popup } from 'components-shared';

	/**
	 * The 3D view's Graphics panel (`docs/design/3d-games.md` T4), compiled only into the `arcade3d`
	 * runtime: the shared Settings modal carries no 3D control (it is in every runtime), so the 3D
	 * seam shows its own, opened by the Flow action `openGraphics` a 3D layout's HUD button calls
	 * (`engine-flow-v2` `withView3d`).
	 */

	const props: Graphics3dPanelProps = $props();
</script>

<Popup zIndex={zIndex.modal} onclose={props.onclose}>
	<div class="panel" role="dialog" aria-label="Graphics">
		<h2>Graphics</h2>
		<div class="options" role="radiogroup">
			{#each props.options as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={option.value === props.current}
					class:selected={option.value === props.current}
					onclick={() => props.onpick(option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		<p class="loads">{props.loads}</p>
		{#if props.note}
			<p class="note">{props.note}</p>
		{/if}
	</div>
</Popup>

<style>
	.panel {
		/* Above the popup's click-to-close layer, as the Settings modal's content is. */
		position: relative;
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		min-width: min(360px, 80vw);
		color: #fff;
		font-family: 'proxima-nova', system-ui, sans-serif;
	}

	h2 {
		margin: 0;
		font-size: 1.4rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr));
		gap: 0.5rem;
	}

	button {
		padding: 0.6rem 0.8rem;
		border: 1px solid rgba(255, 255, 255, 0.35);
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.06);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button.selected {
		border-color: #f2a541;
		background: rgba(242, 165, 65, 0.25);
	}

	.loads,
	.note {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.note {
		color: #f2c27a;
		opacity: 1;
	}
</style>
