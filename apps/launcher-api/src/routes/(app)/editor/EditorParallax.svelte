<script lang="ts">
	import type { LayoutNode } from 'engine-layout';
	import { parallaxFields, setNodeParallax } from '$lib/editor/worldCameraEdit';

	/**
	 * A top-level node's PARALLAX on a screen with a world camera (game-families §4.4, P10.12): how
	 * far it moves with the camera per axis. The stage draws it where the camera starts, where every
	 * factor agrees, so it previews unchanged.
	 */
	type Props = { node: LayoutNode; onChange: () => void };
	const { node, onChange }: Props = $props();

	const p = $derived(parallaxFields(node));

	function set(axis: 'x' | 'y', v: number): void {
		if (setNodeParallax(node, axis, v)) onChange();
	}
</script>

<div
	class="row"
	title="How far this layer moves with the camera: 1 = with the world (the default), 0 = fixed to the screen, 0.5 = half as fast (a far backdrop). Only a top-level item of a screen with a world reads it."
>
	<label class="field">
		<span>parallax x</span>
		<input
			type="number"
			step="0.1"
			value={p.x}
			oninput={(e) => set('x', e.currentTarget.valueAsNumber)}
		/>
	</label>
	<label class="field">
		<span>parallax y</span>
		<input
			type="number"
			step="0.1"
			value={p.y}
			oninput={(e) => set('y', e.currentTarget.valueAsNumber)}
		/>
	</label>
</div>

<style>
	.row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
		align-items: flex-end;
	}
	.field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.field input {
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.field input:focus {
		outline: none;
		border-color: #6b5bff;
	}
</style>
