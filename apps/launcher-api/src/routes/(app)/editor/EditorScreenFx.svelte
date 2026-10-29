<script lang="ts">
	import {
		STAGE_FX_LIMITS,
		STAGE_FX_TRIGGERS,
		findElementFxSpec,
		type ElementFxEntry,
		type ElementFxKindId,
	} from 'constants-shared/elementFx';
	import {
		SCREEN_TRANSITION_LIMITS,
		isScreenTransitionKind,
		readScreenTransition,
		type ScreenTransitionSpec,
	} from 'constants-shared/screenTransition';
	import { customElementFxVersion } from '$lib/customElementFx.svelte';
	import {
		postFxEntryRefusals,
		postFxKindRefusal,
		postFxLoad,
		postFxLoadText,
		screenTransitionKindGroups,
		screenTransitionKindLabel,
		transitionCueLine,
		transitionLoad,
		transitionLoadText,
	} from '$lib/screenFx';
	import EditorElementFx from './EditorElementFx.svelte';

	/**
	 * Game Settings → SCREEN FX (Shader Graph 8e, `docs/design/shader-graph-screens.md` §9.2): what
	 * plays over the whole game screen. Each row is its own block in `.sfx-rows`. THE TRANSITION CUE
	 * row writes `settings.transitionCue`: the wipe (unset) or a transition, with its length and
	 * strength, and says what the game makes of it (`transitionCueLine`). POST FX are the
	 * `EditorElementFx` section on `settings.postFx`, held to the stage's rules (`$lib/screenFx`: the
	 * runtime's refusals and caps), each with its load on the reference phone; the anti-aliasing
	 * switch writes `settings.stageFxAntialias` (§16.10). Anyone who saves the Scene Editor sets them
	 * (§16.11).
	 */
	interface Props {
		/** The stored row, as saved (a kind this page cannot play is kept and shown). */
		transitionCue: ScreenTransitionSpec | undefined;
		/** The next row; `undefined` ⇒ the wipe. */
		onTransitionCueChange: (next: ScreenTransitionSpec | undefined) => void;
		/** Whether the project's flow fires `transition` (`undefined`: no stored flow). */
		flowFiresTransition?: boolean;
		postFx: ElementFxEntry[] | undefined;
		/** The next list; `undefined` ⇒ no post FX. */
		onPostFxChange: (next: ElementFxEntry[] | undefined) => void;
		antialias: boolean;
		onAntialiasChange: (on: boolean) => void;
		/** The `<datalist>` the cue fields suggest from. */
		cueListId?: string;
		/** ▶ on a post FX row: play it over the whole stage; false when no stage is showing. */
		previewPostFx?: (entry: ElementFxEntry) => boolean;
		/** ▶ on the cue row: play it over the whole stage, into screen `into` (shown for the play)
		 *  or into the stage as it is; false when no stage is showing. */
		previewTransition?: (cue: ScreenTransitionSpec, into: string | undefined) => boolean;
		/** The project's screens the cue row's ▶ can play into: those the stage does not show now. */
		offStageScreens?: readonly { id: string; name: string }[];
	}

	const {
		transitionCue,
		onTransitionCueChange,
		flowFiresTransition,
		postFx,
		onPostFxChange,
		antialias,
		onAntialiasChange,
		cueListId,
		previewPostFx,
		previewTransition,
		offStageScreens = [],
	}: Props = $props();

	/** The screen the cue row's ▶ plays into ('' ⇒ the stage as it is). */
	let previewInto = $state('');
	/** The cue row's ▶ found no stage to play on. */
	let cueMissed = $state(false);
	function playCue(): void {
		if (!transitionCue || !previewTransition) return;
		const into = offStageScreens.some((screen) => screen.id === previewInto)
			? previewInto
			: undefined;
		cueMissed = !previewTransition(transitionCue, into);
	}

	/** The pickers' groups, once the page has registered the project's effects. */
	const kindGroups = $derived.by(() => {
		customElementFxVersion();
		return screenTransitionKindGroups();
	});
	const cueLine = $derived.by(() => {
		customElementFxVersion();
		return transitionCueLine(transitionCue, flowFiresTransition);
	});
	const cueKind = $derived(transitionCue?.kind);
	/** The stored kind, when no group lists it (a graph deleted since): shown, flagged, kept. */
	const staleKind = $derived(
		cueKind && !kindGroups.some((group) => group.kinds.includes(cueKind)) ? cueKind : undefined,
	);
	const cueSpec = $derived.by(() => {
		customElementFxVersion();
		return cueKind ? findElementFxSpec(cueKind) : undefined;
	});

	/** The row through the game's own reader (lengths and strength clamped), or the wipe. */
	function commitCue(next: Partial<ScreenTransitionSpec> | undefined): void {
		onTransitionCueChange(next ? readScreenTransition(next) : undefined);
	}

	/** A new kind keeps the length and strength; its params belong to the old kind and go. */
	function setCueKind(kind: string): void {
		if (!kind) return commitCue(undefined);
		if (!isScreenTransitionKind(kind)) return;
		commitCue({ kind, durationMs: transitionCue?.durationMs, intensity: transitionCue?.intensity });
	}

	/** One number field; blank (or the value it means unset) leaves it to the effect. */
	function setCueNumber(field: 'durationMs' | 'intensity', value: number): void {
		if (!transitionCue) return;
		const next: Partial<ScreenTransitionSpec> = { ...transitionCue };
		const unset = field === 'intensity' ? 1 : undefined;
		if (!Number.isFinite(value) || value === unset) delete next[field];
		else next[field] = field === 'durationMs' ? Math.round(value) : value;
		commitCue(next);
	}

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
		<strong>Screen FX</strong> — effects over the whole game screen, HUD included: a transition between
		screens, and post FX that run every frame. Keep them light: a phone pays for every pixel of the screen.
	</p>
	<div class="sfx-rows">
		<div class="sfx-row" data-row="transition-cue">
			<label class="sfx-field">
				<span>The transition cue plays</span>
				<select value={cueKind ?? ''} onchange={(e) => setCueKind(e.currentTarget.value)}>
					<option value="">The wipe</option>
					{#if staleKind}
						<option value={staleKind}>{screenTransitionKindLabel(staleKind)} — not compiled</option>
					{/if}
					{#each kindGroups as group (group.label)}
						<optgroup label={group.label}>
							{#each group.kinds as kind (kind)}
								<option value={kind}>{screenTransitionKindLabel(kind)}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
			{#if transitionCue}
				<div class="sfx-pair">
					<label class="sfx-field">
						<span>Duration ms</span>
						<input
							type="number"
							min={SCREEN_TRANSITION_LIMITS.durationMs.min}
							max={SCREEN_TRANSITION_LIMITS.durationMs.max}
							step="10"
							value={transitionCue.durationMs ?? ''}
							placeholder={cueSpec ? String(cueSpec.durationMs) : 'its own'}
							onchange={(e) => setCueNumber('durationMs', e.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="sfx-field">
						<span>Strength</span>
						<input
							type="number"
							min={SCREEN_TRANSITION_LIMITS.intensity.min}
							max={SCREEN_TRANSITION_LIMITS.intensity.max}
							step="0.05"
							value={transitionCue.intensity ?? ''}
							placeholder="1"
							onchange={(e) => setCueNumber('intensity', e.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
			{/if}
			{#if transitionCue && previewTransition}
				<div class="sfx-pair sfx-play">
					<label class="sfx-field">
						<span>Preview into</span>
						<select bind:value={previewInto}>
							<option value="">The screens shown now</option>
							{#each offStageScreens as screen (screen.id)}
								<option value={screen.id}>{screen.name}</option>
							{/each}
						</select>
					</label>
					<button
						type="button"
						class="sfx-icon play"
						title="Preview on the stage: the stage as shown freezes and the transition plays into the screen picked here (Esc stops it)"
						aria-label="Preview"
						onclick={playCue}>▶</button
					>
				</div>
				{#if cueMissed}
					<p class="sfx-line warn">
						Nothing on the stage to play it on: open the Screens side first.
					</p>
				{/if}
			{/if}
			<p class="sfx-line" class:warn={cueLine.warn} data-status={cueLine.status}>{cueLine.text}</p>
			{#if transitionCue && cueLine.status === 'screen'}
				{@const load = transitionLoad(transitionCue.kind)}
				<p class="sfx-line load" class:warn={load.kind === 'compiled' && load.over}>
					{transitionLoadText(transitionCue.kind)}
				</p>
			{/if}
			<p class="sfx-note">
				The cue carries nothing, so the same transition plays into the free spins and out of them.
				On the way out the screen is already back on the base game when the cue fires.
			</p>
		</div>
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
				preview={previewPostFx}
				previewRefusal={(index) => refusals[index]}
				missedText="Nothing on the stage to play it on: open the Screens side first."
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
	.sfx-field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.sfx-field > span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.sfx-field select,
	.sfx-field input {
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
	.sfx-field select:focus,
	.sfx-field input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.sfx-pair {
		display: flex;
		gap: 6px;
	}
	.sfx-play {
		align-items: flex-end;
	}
	.sfx-icon {
		flex: 0 0 auto;
		background: transparent;
		border: 1px solid #2a2a33;
		color: #7ee0c0;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 6px;
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
	}
	.sfx-icon:hover {
		border-color: #6b5bff;
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
