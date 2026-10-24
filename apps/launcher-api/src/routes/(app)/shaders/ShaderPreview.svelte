<script lang="ts">
	import { ELEMENT_FX_LIMITS, type CustomElementFx } from 'constants-shared/elementFx';
	import { Application, UPDATE_PRIORITY, type Ticker } from 'pixi.js';
	import { untrack } from 'svelte';
	import {
		PREVIEW_BACKGROUNDS,
		ShaderPreviewStage,
		advancePlayhead,
		previewDurationMs,
		type PreviewBackground,
	} from './shaderPreview.client';

	/**
	 * The live preview pane of Invisible Shader Graph: the edited graph posed on a sample card or an
	 * atlas region through the game's Element FX runtime, with a `t` scrubber, play / loop, the
	 * strength and a backdrop. Nothing here is saved.
	 */
	interface Props {
		/** The graph being edited, compiled (`compileShaderEffect(doc)`'s `effect`); undefined while
		 *  it does not compile. */
		effect: CustomElementFx | undefined;
		/** The project's atlases, as the page's loader lists them. */
		atlases: { manifestKey: string; label: string; regions: string[] }[];
	}

	// Not `effect`: a local of that name turns the `$effect` rune into a store read.
	let { effect: compiled, atlases }: Props = $props();

	const INTENSITY = ELEMENT_FX_LIMITS.intensity;

	let host: HTMLDivElement | undefined = $state();
	let stage: ShaderPreviewStage | undefined = $state.raw();
	let failure = $state('');
	let refused = $state(false);

	let t = $state(0);
	let playing = $state(true);
	let loop = $state(true);
	let intensity = $state(1);
	let background = $state<PreviewBackground>('dark');

	let source = $state<'sample' | 'region'>('sample');
	let atlasKey = $state('');
	let regionName = $state('');
	let loadingArt = $state(false);
	let artNote = $state('');

	// Keyed by content: an edit that compiles to the same effect (a node dragged) does not restart it.
	const effectKey = $derived(compiled ? JSON.stringify(compiled) : '');
	const durationMs = $derived(compiled ? previewDurationMs(compiled) : 0);
	const atlas = $derived(atlases.find((a) => a.manifestKey === atlasKey));
	const pickedRegion = $derived(
		source === 'region' && atlas?.regions.includes(regionName)
			? { manifestKey: atlas.manifestKey, name: regionName }
			: undefined,
	);

	const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

	// The renderer, once for the pane's life: a WebGL context per edit would run out of contexts.
	$effect(() => {
		const el = host;
		if (!el) return;
		let disposed = false;
		let app: Application | undefined;
		let created: ShaderPreviewStage | undefined;
		let observer: ResizeObserver | undefined;
		// Ahead of the runtime's own step, so each frame poses the playhead it just moved to.
		const advance = (ticker: Ticker): void => {
			if (!playing || !durationMs) return;
			const next = advancePlayhead(t, ticker.deltaMS, durationMs, loop);
			t = next.t;
			if (next.ended) playing = false;
		};

		void (async () => {
			const next = new Application();
			try {
				await next.init({
					preference: 'webgl',
					backgroundAlpha: 0,
					antialias: true,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
					width: Math.max(1, el.clientWidth),
					height: Math.max(1, el.clientHeight),
				});
			} catch {
				try {
					next.destroy({ removeView: true });
				} catch {
					// Half-built: there may be nothing to tear down.
				}
				if (!disposed) failure = 'The preview needs WebGL, which this browser did not provide.';
				return;
			}
			if (disposed) {
				next.destroy({ removeView: true });
				return;
			}
			app = next;
			el.appendChild(next.canvas);
			created = new ShaderPreviewStage(next, () => ({ progress: t, intensity }));
			next.ticker.add(advance, undefined, UPDATE_PRIORITY.HIGH);
			const shown = created;
			observer = new ResizeObserver(() => shown.resize(el.clientWidth, el.clientHeight));
			observer.observe(el);
			stage = created;
		})();

		return () => {
			disposed = true;
			observer?.disconnect();
			app?.ticker.remove(advance);
			created?.destroy();
			app?.destroy({ removeView: true }, { children: true });
			stage = undefined;
		};
	});

	// Posing reads the playhead: untracked, or every frame would start the effect again. Params play
	// their defaults.
	$effect(() => {
		const shown = stage;
		const fxKey = effectKey;
		if (!shown) return;
		const fx = fxKey ? (JSON.parse(fxKey) as CustomElementFx) : undefined;
		refused = untrack(() => !shown.show(fx));
	});

	$effect(() => {
		const shown = stage;
		const region = pickedRegion;
		if (!shown) return;
		untrack(() => {
			artNote = '';
			if (!region) {
				loadingArt = false;
				shown.useSampleCard();
				return;
			}
			loadingArt = true;
			shown.useRegion(region.manifestKey, region.name).then(
				(current) => {
					if (current) loadingArt = false;
				},
				(err: unknown) => {
					loadingArt = false;
					artNote = `Couldn't load ${region.name} (${message(err)}): showing the sample card.`;
				},
			);
		});
	});

	function togglePlay(): void {
		if (playing) {
			playing = false;
			return;
		}
		if (t >= 1) t = 0;
		playing = true;
	}

	function pickSource(next: string): void {
		source = next === 'region' ? 'region' : 'sample';
		if (source === 'region' && !atlas) pickAtlas(atlases[0]?.manifestKey ?? '');
	}

	function pickAtlas(key: string): void {
		atlasKey = key;
		regionName = atlases.find((a) => a.manifestKey === key)?.regions[0] ?? '';
	}
</script>

<div class="preview">
	<div class="stage {background}" bind:this={host}>
		{#if failure}
			<p class="overlay warn">{failure}</p>
		{:else if !compiled}
			<p class="overlay">Doesn't compile — fix the errors to preview.</p>
		{:else if refused}
			<p class="overlay warn">The runtime didn't take this effect, so it can't preview.</p>
		{/if}
		{#if loadingArt}
			<span class="loading">Loading art…</span>
		{/if}
	</div>

	<div class="row transport">
		<button
			class="play"
			onclick={togglePlay}
			disabled={!compiled}
			title={playing ? 'Pause' : 'Play'}
			aria-label={playing ? 'Pause' : 'Play'}
		>
			{playing ? '❚❚' : '▶'}
		</button>
		<input
			type="range"
			min="0"
			max="1"
			step="0.001"
			bind:value={t}
			oninput={() => (playing = false)}
			disabled={!compiled}
			aria-label="Progress t"
		/>
		<label class="toggle" title="Start again at the end">
			<input type="checkbox" bind:checked={loop} />
			Loop
		</label>
	</div>
	<p class="readout">
		t <b>{t.toFixed(3)}</b>
		{#if durationMs}
			· <b>{Math.round(t * durationMs)}</b> / {durationMs} ms
		{/if}
	</p>

	<div class="row">
		<span class="label">Intensity</span>
		<input
			type="range"
			min={INTENSITY.min}
			max={INTENSITY.max}
			step="0.05"
			bind:value={intensity}
			aria-label="Intensity"
		/>
		<span class="num">{intensity.toFixed(2)}</span>
		<button
			class="reset"
			onclick={() => (intensity = 1)}
			disabled={intensity === 1}
			title="Back to 1"
			aria-label="Intensity back to 1">↺</button
		>
	</div>

	<label class="row">
		<span class="label">Element</span>
		<select value={source} onchange={(e) => pickSource(e.currentTarget.value)}>
			<option value="sample">Sample card</option>
			<option value="region" disabled={!atlases.length}>
				{atlases.length ? 'Atlas region' : 'Atlas region (no atlases)'}
			</option>
		</select>
	</label>
	{#if source === 'region'}
		<label class="row">
			<span class="label">Atlas</span>
			<select value={atlasKey} onchange={(e) => pickAtlas(e.currentTarget.value)}>
				{#each atlases as a (a.manifestKey)}
					<option value={a.manifestKey}>{a.label}</option>
				{/each}
			</select>
		</label>
		<label class="row">
			<span class="label">Region</span>
			<select bind:value={regionName}>
				{#each atlas?.regions ?? [] as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		</label>
		<p class="hint">Symbol art is in the atlases.</p>
	{/if}
	{#if artNote}
		<p class="hint warn">{artNote}</p>
	{/if}

	<div class="row">
		<span class="label">Backdrop</span>
		<div class="seg" role="group" aria-label="Backdrop">
			{#each PREVIEW_BACKGROUNDS as option (option.id)}
				<button
					class:on={background === option.id}
					aria-pressed={background === option.id}
					onclick={() => (background = option.id)}>{option.label}</button
				>
			{/each}
		</div>
	</div>
</div>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
		color: #e8e8ee;
	}
	.stage {
		position: relative;
		box-sizing: border-box;
		width: 100%;
		max-width: 360px;
		aspect-ratio: 1 / 1;
		margin: 0 auto 8px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		overflow: hidden;
	}
	.stage.dark {
		background: #0b0b10;
	}
	.stage.light {
		background: #e8e8ee;
	}
	.stage.checker {
		background: repeating-conic-gradient(#3a3a44 0% 25%, #22222a 0% 50%) 50% / 16px 16px;
	}
	.stage :global(canvas) {
		position: absolute;
		inset: 0;
		display: block;
	}
	.overlay {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 8px;
		z-index: 1;
		margin: 0;
		padding: 6px 8px;
		border-radius: 6px;
		background: rgba(11, 11, 16, 0.85);
		border: 1px solid #2a2a33;
		color: #ccc;
		font-size: 11px;
		text-align: center;
		pointer-events: none;
	}
	.overlay.warn {
		color: #d98a3a;
	}
	.loading {
		position: absolute;
		top: 6px;
		right: 8px;
		z-index: 1;
		font-size: 10px;
		color: #888;
		pointer-events: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}
	.label {
		flex: 0 0 64px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.row input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
		accent-color: #6b5bff;
	}
	.row select {
		flex: 1 1 auto;
		min-width: 0;
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 4px 6px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
	}
	.row select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.play {
		flex: 0 0 auto;
		width: 26px;
		height: 22px;
		padding: 0;
		background: transparent;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		color: #7ee0c0;
		font-size: 10px;
		line-height: 1;
		cursor: pointer;
	}
	.play:hover:not(:disabled) {
		border-color: #6b5bff;
	}
	.play:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.toggle {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: #888;
		cursor: pointer;
	}
	.toggle input {
		accent-color: #6b5bff;
	}
	.readout {
		margin: -2px 0 8px;
		font-size: 11px;
		color: #777;
		font-variant-numeric: tabular-nums;
	}
	.readout b {
		color: #c8a3ff;
		font-weight: 600;
	}
	.num {
		flex: 0 0 34px;
		text-align: right;
		font-size: 11px;
		color: #c8a3ff;
		font-variant-numeric: tabular-nums;
	}
	.reset {
		flex: 0 0 auto;
		background: transparent;
		border: none;
		color: #c8a3ff;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 2px 4px;
	}
	.reset:hover:not(:disabled) {
		color: #fff;
	}
	.reset:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.seg {
		flex: 1 1 auto;
		display: flex;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		overflow: hidden;
	}
	.seg button {
		flex: 1 1 0;
		padding: 4px 0;
		background: transparent;
		border: none;
		color: #888;
		font-size: 11px;
		font-family: inherit;
		cursor: pointer;
	}
	.seg button + button {
		border-left: 1px solid #2a2a33;
	}
	.seg button.on {
		background: #1c1a33;
		color: #e8e8ee;
	}
	.hint {
		font-size: 10px;
		color: #777;
		line-height: 1.3;
		margin: -2px 0 6px;
	}
	.hint.warn {
		color: #d98a3a;
	}
</style>
