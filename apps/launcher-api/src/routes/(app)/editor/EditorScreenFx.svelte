<script lang="ts">
	import {
		STAGE_FX_LIMITS,
		STAGE_FX_TRIGGERS,
		type ElementFxEntry,
		type ElementFxKindId,
	} from 'constants-shared/elementFx';
	import { customElementFxVersion } from '$lib/customElementFx.svelte';
	import {
		postFxEntryRefusals,
		postFxKindRefusal,
		postFxLoad,
		postFxLoadText,
	} from '$lib/screenFx';
	import EditorElementFx from './EditorElementFx.svelte';

	/**
	 * Game Settings → SCREEN FX (Shader Graph 8e, `docs/design/shader-graph-screens.md` §9.2): what
	 * plays over the whole game screen. Each row is its own block in `.sfx-rows`, in the order the
	 * stage draws them. POST FX are the `EditorElementFx` section on `settings.postFx`, held to the
	 * stage's rules (`$lib/screenFx`: the runtime's refusals and caps), each with its load on the
	 * reference phone; the anti-aliasing switch writes `settings.stageFxAntialias` (§16.10). Anyone
	 * who saves the Scene Editor sets them (§16.11).
	 */
	interface Props {
		postFx: ElementFxEntry[] | undefined;
		/** The next list; `undefined` ⇒ no post FX. */
		onPostFxChange: (next: ElementFxEntry[] | undefined) => void;
		antialias: boolean;
		onAntialiasChange: (on: boolean) => void;
		/** The `<datalist>` the cue fields suggest from. */
		cueListId?: string;
	}

	const { postFx, onPostFxChange, antialias, onAntialiasChange, cueListId }: Props = $props();

	/** Why each stored entry does not play in the game (`undefined`: it plays, or is off). */
	const refusals = $derived.by(() => {
		customElementFxVersion();
		return postFxEntryRefusals(postFx);
	});
	const kindRefusal = (kind: ElementFxKindId, index: number | undefined): string | undefined =>
		postFxKindRefusal(postFx ?? [], kind, index);
</script>

{#snippet postFxNote(entry: ElementFxEntry, index: number)}
	{@const refusal = refusals[index]}
	{#if refusal}
		<p class="sfx-line warn">Does not play in the game: {refusal}.</p>
	{:else}
		{@const load = postFxLoad(entry.kind)}
		<p class="sfx-line" class:warn={load.kind === 'compiled' && load.over}>
			{postFxLoadText(entry.kind)}
		</p>
	{/if}
{/snippet}

<div class="screen-fx">
	<p class="sfx-note">
		<strong>Screen FX</strong> — effects over the whole game screen. Each runs every frame over the whole
		game, HUD included, so keep them light: a phone pays for every pixel of the screen.
	</p>
	<div class="sfx-rows">
		<div class="sfx-row" data-row="post-fx">
			<EditorElementFx
				title="Post FX"
				entries={postFx}
				onChange={onPostFxChange}
				{cueListId}
				keyable={false}
				triggers={STAGE_FX_TRIGGERS}
				{kindRefusal}
				maxEntries={STAGE_FX_LIMITS.entries}
				rowNote={postFxNote}
				intro="A grade, a vignette, a wave or a shine over the whole game, HUD included, always or on a cue."
			/>
			<p class="sfx-note">
				Runs every frame over the whole game, HUD included. At most {STAGE_FX_LIMITS.entries} post FX,
				drawing {STAGE_FX_LIMITS.filters} filters in all. Exit, enter, motion-only and break kinds do
				not play on the whole screen.
			</p>
		</div>
		<div class="sfx-row" data-row="antialias">
			<label class="sfx-toggle">
				<input
					type="checkbox"
					checked={antialias}
					onchange={(e) => onAntialiasChange(e.currentTarget.checked)}
				/>
				<span>Anti-aliasing under stage effects</span>
			</label>
			<p class="sfx-note">
				Off by default. On, transitions, post FX and the camera effects keep the canvas's
				anti-aliasing, at about four times a stage pass's memory. WebGL2 only: on WebGL1 it changes
				nothing.
			</p>
		</div>
	</div>
</div>

<style>
	.screen-fx,
	.sfx-rows,
	.sfx-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sfx-note,
	.sfx-line {
		margin: 0;
		font-size: 11px;
		line-height: 1.4;
		color: #777;
	}
	.sfx-note strong {
		color: #c8a3ff;
		font-weight: 600;
	}
	.sfx-line {
		margin: 4px 0 2px;
		font-size: 10px;
	}
	.sfx-line.warn {
		color: #d98a3a;
	}
	.sfx-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
		cursor: pointer;
	}
	.sfx-toggle input {
		accent-color: #7ee0c0;
		cursor: inherit;
	}
</style>
