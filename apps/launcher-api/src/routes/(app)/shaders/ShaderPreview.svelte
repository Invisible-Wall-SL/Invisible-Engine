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
	import { useShaderThumbs } from './shaderThumbs.svelte';
	import { ParticlePreviewStage, type ParticlePreviewState } from './particlePreview.client';
	import { PARTICLE_PREVIEW_SHAPES, type ParticlePreviewShape } from './particlePreview';
	import type { PreviewElement } from './shaderEditor';

	/**
	 * The live preview pane of Invisible Shader Graph: the edited graph posed on a sample card or an
	 * atlas region through the game's Element FX runtime, with a `t` scrubber, play / loop, the
	 * strength and a backdrop; or, as the Particles element (step 8d.7), drawn as a particle material
	 * on a stock Burst or Fountain through the game's renderer, played / paused / restarted. Nothing
	 * here is saved.
	 */
	interface Props {
		/** The graph being edited, compiled (`compileShaderEffect(doc)`'s `effect`); undefined while
		 *  it does not compile. */
		effect: CustomElementFx | undefined;
		/** The project's atlases, as the page's loader lists them. */
		atlases: { manifestKey: string; label: string; regions: string[] }[];
		/** The element shown when the graph opens or its Made for changes (`defaultPreviewElement`). */
		defaultElement?: PreviewElement;
		/** The open graph's id: opening another shows its default element. */
		graph?: string;
	}

	// Not `effect`: a local of that name turns the `$effect` rune into a store read.
	let { effect: compiled, atlases, defaultElement = 'sample', graph = '' }: Props = $props();

	const INTENSITY = ELEMENT_FX_LIMITS.intensity;

	let host: HTMLDivElement | undefined = $state();
	let stage: ShaderPreviewStage | undefined = $state.raw();
	let particles: ParticlePreviewStage | undefined = $state.raw();
	let failure = $state('');
	let refused = $state(false);

	let t = $state(0);
	let playing = $state(true);
	let loop = $state(true);
	let intensity = $state(1);
	let background = $state<PreviewBackground>('dark');

	let source = $state<PreviewElement>('sample');
	/** The Particles element: its emitter, its art (the soft dot or the picked region), its state. */
	let shape = $state<ParticlePreviewShape>('burst');
	let particleArt = $state<'dot' | 'region'>('dot');
	let particlesPlaying = $state(true);
	let particleState = $state<ParticlePreviewState>('none');
	let atlasKey = $state('');
	let regionName = $state('');
	/** The element's art and the particles' art load apart; what shows is the shown element's. */
	let elementLoading = $state(false);
	let elementNote = $state('');
	let particleLoading = $state(false);
	let particleNote = $state('');

	// Keyed by content: an edit that compiles to the same effect (a node dragged) does not restart it.
	const effectKey = $derived(compiled ? JSON.stringify(compiled) : '');
	const durationMs = $derived(compiled ? previewDurationMs(compiled) : 0);
	const atlas = $derived(atlases.find((a) => a.manifestKey === atlasKey));
	const atlasRegion = $derived(
		atlas?.regions.includes(regionName)
			? { manifestKey: atlas.manifestKey, name: regionName }
			: undefined,
	);
	const pickedRegion = $derived(source === 'region' ? atlasRegion : undefined);
	const particleRegion = $derived(
		source === 'particles' && particleArt === 'region' ? atlasRegion : undefined,
	);
	const onParticles = $derived(source === 'particles');
	const regionShown = $derived(
		source === 'region' || (source === 'particles' && particleArt === 'region'),
	);

	const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

	// The node thumbnails show what this shows: its playhead, strength, element and backdrop.
	const thumbs = useShaderThumbs();
	$effect(() => {
		thumbs?.setView({ t, intensity, durationMs, region: pickedRegion, background });
	});

	// The renderer, once for the pane's life: a WebGL context per edit would run out of contexts.
	$effect(() => {
		const el = host;
		if (!el) return;
		let disposed = false;
		let app: Application | undefined;
		let created: ShaderPreviewStage | undefined;
		let made: ParticlePreviewStage | undefined;
		let observer: ResizeObserver | undefined;
		// Ahead of the runtime's own step, so each frame poses the playhead it just moved to.
		// A material can turn plain while it plays (a program the driver refuses): read it each frame.
		const readParticleState = (): void => {
			const now = made?.state ?? 'none';
			if (now !== particleState) particleState = now;
		};
		const advance = (ticker: Ticker): void => {
			// On particles the playhead stands still: each particle runs its own life.
			if (!playing || !durationMs || onParticles) return;
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
			made = new ParticlePreviewStage(next, created.art);
			next.ticker.add(advance, undefined, UPDATE_PRIORITY.HIGH);
			next.ticker.add(readParticleState);
			const shown = created;
			const drawn = made;
			observer = new ResizeObserver(() => {
				shown.resize(el.clientWidth, el.clientHeight);
				drawn.resize();
			});
			observer.observe(el);
			stage = created;
			particles = made;
		})();

		return () => {
			disposed = true;
			observer?.disconnect();
			app?.ticker.remove(advance);
			app?.ticker.remove(readParticleState);
			// Before the element's stage: the particles may hold a region on its atlas pages.
			made?.destroy();
			particles = undefined;
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
		// The particles draw what the element stage registered (both stages are made together).
		untrack(() => particles?.show(shown.current));
	});

	// A graph opened, or its Made for changed: its default element (Particles for a material).
	$effect(() => {
		const element = defaultElement;
		void graph;
		untrack(() => pickSource(element));
	});

	$effect(() => {
		const shown = stage;
		const on = onParticles;
		if (!shown) return;
		shown.setElementVisible(!on);
		particles?.setVisible(on);
	});

	$effect(() => {
		particles?.setShape(shape);
	});

	$effect(() => {
		const drawn = particles;
		const level = intensity;
		if (!drawn) return;
		untrack(() => drawn.setIntensity(level));
	});

	$effect(() => {
		const drawn = particles;
		if (drawn) drawn.playing = particlesPlaying;
	});

	$effect(() => {
		const drawn = particles;
		const region = particleRegion;
		if (!drawn) return;
		untrack(() => {
			particleNote = '';
			if (!region) {
				particleLoading = false;
				drawn.useDot();
				return;
			}
			particleLoading = true;
			drawn.useRegion(region.manifestKey, region.name).then(
				(current) => {
					if (current) particleLoading = false;
				},
				(err: unknown) => {
					particleLoading = false;
					particleNote = `Couldn't load ${region.name} (${message(err)}): the particles show the soft dot.`;
				},
			);
		});
	});

	$effect(() => {
		const shown = stage;
		const region = pickedRegion;
		if (!shown) return;
		untrack(() => {
			elementNote = '';
			if (!region) {
				elementLoading = false;
				shown.useSampleCard();
				return;
			}
			elementLoading = true;
			shown.useRegion(region.manifestKey, region.name).then(
				(current) => {
					if (current) elementLoading = false;
				},
				(err: unknown) => {
					elementLoading = false;
					elementNote = `Couldn't load ${region.name} (${message(err)}): showing the sample card.`;
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
		source = next === 'region' || next === 'particles' ? next : 'sample';
		if (source === 'region' && !atlas) pickAtlas(atlases[0]?.manifestKey ?? '');
	}

	function pickParticleArt(next: string): void {
		particleArt = next === 'region' ? 'region' : 'dot';
		if (particleArt === 'region' && !atlas) pickAtlas(atlases[0]?.manifestKey ?? '');
	}

	/** Why the particles draw as plain sprites, in words (the game's own fallbacks). */
	const PLAIN_TEXT: Partial<Record<ParticlePreviewState, string>> = {
		'program does not link': "this GPU did not compile the material's program",
		'shell refuses the body': 'the particle shell cannot take this graph',
		'not WebGL': 'the preview is not on WebGL',
		'not registered': 'the effect did not register',
	};
	const loadingArt = $derived(onParticles ? particleLoading : elementLoading);
	const artNote = $derived(onParticles ? particleNote : elementNote);
	const particlePlain = $derived(
		onParticles && compiled && particleState !== 'on' && particleState !== 'none'
			? (PLAIN_TEXT[particleState] ?? particleState)
			: '',
	);

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
		{:else if onParticles && particlePlain}
			<p class="overlay warn">The particles draw plain: {particlePlain}.</p>
		{:else if refused && !onParticles}
			<p class="overlay warn">The runtime didn't take this effect, so it can't preview.</p>
		{/if}
		{#if loadingArt}
			<span class="loading">Loading art…</span>
		{/if}
	</div>

	{#if onParticles}
		<div class="row transport">
			<button
				class="play"
				onclick={() => (particlesPlaying = !particlesPlaying)}
				disabled={!compiled}
				title={particlesPlaying ? 'Pause' : 'Play'}
				aria-label={particlesPlaying ? 'Pause' : 'Play'}
			>
				{particlesPlaying ? '❚❚' : '▶'}
			</button>
			<button
				class="play"
				onclick={() => particles?.restart()}
				disabled={!compiled}
				title="Restart: every particle gone, the emitter from its first frame"
				aria-label="Restart">↻</button
			>
			<span class="hint inline">Each particle plays its own life.</span>
		</div>
	{:else}
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
	{/if}

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
			<option value="particles">Particles</option>
		</select>
	</label>
	{#if onParticles}
		<div class="row">
			<span class="label">Emitter</span>
			<div class="seg" role="group" aria-label="Emitter">
				{#each PARTICLE_PREVIEW_SHAPES as option (option.id)}
					<button
						class:on={shape === option.id}
						aria-pressed={shape === option.id}
						onclick={() => (shape = option.id)}>{option.label}</button
					>
				{/each}
			</div>
		</div>
		<label class="row">
			<span class="label">Art</span>
			<select value={particleArt} onchange={(e) => pickParticleArt(e.currentTarget.value)}>
				<option value="dot">Soft dot</option>
				<option value="region" disabled={!atlases.length}>
					{atlases.length ? 'Atlas region' : 'Atlas region (no atlases)'}
				</option>
			</select>
		</label>
	{/if}
	{#if regionShown}
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
		{#if !onParticles}
			<p class="hint">Symbol art is in the atlases.</p>
		{/if}
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
	.hint.inline {
		margin: 0;
	}
</style>
