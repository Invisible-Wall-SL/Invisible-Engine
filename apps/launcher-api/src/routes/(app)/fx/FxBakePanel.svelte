<script lang="ts">
	/**
	 * Invisible FX — the BAKE bar under the preview (`invisible-fx.md` §"Baked effects"): turn the
	 * baked loop on, set how it is captured, "Bake now", and see whether games will play it baked —
	 * or live, and why (off, never baked, stale against the doc, or the effect cannot bake). Off by
	 * default; an effect never opened here keeps no `bake` block at all.
	 */
	import {
		EFFECT_BAKE_LIMITS,
		defaultEffectBake,
		effectBakeBeatFades,
		effectBakeBlockers,
		effectBakeFrameAt,
		effectBakeFrameCount,
		effectBakeHash,
		effectBakeWarmup,
		emitterSecondsToWallMs,
		normalizeEffectDoc,
		type EffectBake,
		type EffectDoc,
	} from 'engine-fx';
	import type { ResolveArt } from '$lib/fx/effectEmitter.client';
	import type { FxStageCost } from './fxCost.client';
	import { blendMode } from './fxModel.client';
	import {
		captureEffectBake,
		uploadEffectBake,
		type BakeCapture,
		type BakeProgress,
	} from './fxBake.client';

	interface Props {
		doc: EffectDoc;
		/** Write the doc's `bake` block (the page's one way to change the doc). */
		onchange: (bake: EffectBake) => void;
		/** The effect's persisted id, or '' while it was never saved (nothing to bake into). */
		savedId: string;
		projectKey: string;
		resolveArt: ResolveArt;
		cost: FxStageCost | undefined;
	}

	let { doc, onchange, savedId, projectKey, resolveArt, cost }: Props = $props();

	let open = $state(false);
	let progress = $state<BakeProgress | undefined>();
	let error = $state('');
	/** The sheet just captured, for an instant preview before it is reloaded from storage. */
	let fresh = $state.raw<BakeCapture | undefined>();

	const bake = $derived(doc.bake);
	const settings = $derived(bake ?? defaultEffectBake());
	const blockers = $derived(effectBakeBlockers(doc));
	const result = $derived(bake?.result);
	// Hashed only once there is a bake to compare: the normalized doc, as Save stores it.
	const stale = $derived(
		!!result && result.hash !== effectBakeHash(normalizeEffectDoc($state.snapshot(doc), doc.id)),
	);
	const frames = $derived(effectBakeFrameCount(settings));
	const warmupMs = $derived(Math.round(emitterSecondsToWallMs(effectBakeWarmup(doc))));
	// A rig keyframe plays the loop from its beat and fades it out over the longest particle life.
	const beatFadeOut = $derived(effectBakeBeatFades(doc).fadeOut);
	const busy = $derived(!!progress);

	type State = { tone: 'on' | 'warn' | 'off'; label: string; detail: string };
	const status = $derived.by((): State => {
		if (!bake?.enabled)
			return { tone: 'off', label: 'Live', detail: 'Bake is off: games run the emitters.' };
		if (blockers.length)
			return {
				tone: 'warn',
				label: 'Live',
				detail: 'This effect cannot bake, so games run it live.',
			};
		if (!result)
			return {
				tone: 'warn',
				label: 'Not baked',
				detail: 'Bake now — until then games run it live.',
			};
		if (stale)
			return {
				tone: 'warn',
				label: 'Stale',
				detail: 'The effect changed since it was baked. Bake again — until then games run it live.',
			};
		return { tone: 'on', label: 'Baked', detail: 'Games play this effect as its baked loop.' };
	});

	const update = (patch: Partial<EffectBake>): void => {
		onchange({ ...settings, ...patch });
	};
	const numberInput = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);

	const PHASE: Record<BakeProgress['phase'], string> = {
		'warm-up': 'Warming up',
		capture: 'Capturing',
		sheet: 'Building the sheet',
		upload: 'Uploading',
	};

	async function bakeNow(): Promise<void> {
		if (busy || !savedId) return;
		error = '';
		progress = { phase: 'warm-up', done: 0, total: 1 };
		try {
			const snapshot = $state.snapshot(doc) as EffectDoc;
			const capture = await captureEffectBake({
				doc: { ...snapshot, id: savedId, bake: { ...settings } },
				resolveArt,
				onProgress: (p) => (progress = p),
			});
			progress = { phase: 'upload', done: 0, total: 1 };
			const out = await uploadEffectBake({ capture, effectId: savedId, projectKey });
			fresh = capture;
			update({ result: out });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			progress = undefined;
		}
	}

	// --- preview: the baked loop, played on a 2D canvas -------------------------------------------
	let previewCanvas = $state<HTMLCanvasElement | null>(null);
	type Sheet = {
		image: CanvasImageSource;
		rects: { x: number; y: number; w: number; h: number }[];
	};
	let sheet = $state.raw<Sheet | undefined>();

	$effect(() => {
		const r = result;
		const f = fresh;
		sheet = undefined;
		if (!r) return;
		if (f && f.hash === r.hash) {
			const { cellW, cellH, gap, cols } = f.plan;
			sheet = {
				image: f.canvas,
				rects: Array.from({ length: f.frames }, (_, i) => ({
					x: (i % cols) * (cellW + gap),
					y: Math.floor(i / cols) * (cellH + gap),
					w: cellW,
					h: cellH,
				})),
			};
			return;
		}
		let cancelled = false;
		void (async () => {
			const art = await resolveArt(r.assetKey);
			if (!art || cancelled) return;
			const byName = new Map(art.regions.map((reg) => [reg.name, reg]));
			const rects = r.frames.map((n) => byName.get(n)).filter((x) => !!x);
			if (rects.length !== r.frames.length) return;
			const img = new Image();
			img.src = art.pageUrl;
			await img.decode().catch(() => undefined);
			if (!cancelled && img.naturalWidth) sheet = { image: img, rects };
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const cv = previewCanvas;
		const s = sheet;
		const r = result;
		if (!cv || !s || !r || !open) return;
		const ctx = cv.getContext('2d');
		if (!ctx) return;
		let raf = 0;
		let t0: number | undefined;
		const draw = (now: number): void => {
			// Timed from the first frame's own timestamp: one read before it can be later than it.
			t0 ??= now;
			const i = effectBakeFrameAt(0, (now - t0) / 1000, r.fps, s.rects.length);
			const rect = s.rects[i];
			const fit = Math.min(cv.width / rect.w, cv.height / rect.h, 2);
			const w = rect.w * fit;
			const h = rect.h * fit;
			ctx.clearRect(0, 0, cv.width, cv.height);
			ctx.globalCompositeOperation = r.blendMode === 'add' ? 'lighter' : 'source-over';
			ctx.drawImage(
				s.image,
				rect.x,
				rect.y,
				rect.w,
				rect.h,
				(cv.width - w) / 2,
				(cv.height - h) / 2,
				w,
				h,
			);
			raf = requestAnimationFrame(draw);
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	});

	const megabytes = (w: number, h: number): string => ((w * h * 4) / (1024 * 1024)).toFixed(1);
</script>

<div class="bake">
	<button
		class="bakebar"
		title="Bake this effect's loop into a sprite sheet, so games play one animated sprite instead of simulating every particle."
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="lbl">Bake</span>
		<span class="pill {status.tone}">{status.label}</span>
		<span class="hint">{status.detail}</span>
		<span class="chev">{open ? '▾' : '▸'}</span>
	</button>
	{#if open}
		<div class="bakebody">
			<div class="cols">
				<div class="settings">
					<label class="row toggle">
						<input
							type="checkbox"
							checked={bake?.enabled ?? false}
							disabled={busy}
							onchange={(e) => update({ enabled: (e.currentTarget as HTMLInputElement).checked })}
						/>
						Play baked in games
					</label>
					<label class="row">
						<span>Frames / s</span>
						<input
							type="number"
							min={EFFECT_BAKE_LIMITS.fps.min}
							max={EFFECT_BAKE_LIMITS.fps.max}
							step="1"
							value={settings.fps}
							disabled={busy}
							onchange={(e) => update({ fps: numberInput(e) })}
						/>
					</label>
					<label class="row">
						<span>Loop (s)</span>
						<input
							type="number"
							min={EFFECT_BAKE_LIMITS.loopSeconds.min}
							max={EFFECT_BAKE_LIMITS.loopSeconds.max}
							step="0.25"
							value={settings.loopSeconds}
							disabled={busy}
							onchange={(e) => update({ loopSeconds: numberInput(e) })}
						/>
					</label>
					<label class="row">
						<span>Resolution</span>
						<input
							type="range"
							min={EFFECT_BAKE_LIMITS.scale.min}
							max={EFFECT_BAKE_LIMITS.scale.max}
							step="0.05"
							value={settings.scale}
							disabled={busy}
							onchange={(e) => update({ scale: numberInput(e) })}
						/>
						<span class="val">{Math.round(settings.scale * 100)}%</span>
					</label>
					<label class="row">
						<span>Seam</span>
						<select
							value={settings.seam}
							disabled={busy}
							onchange={(e) =>
								update({
									seam:
										(e.currentTarget as HTMLSelectElement).value === 'cut' ? 'cut' : 'crossfade',
								})}
						>
							<option value="crossfade">Crossfade (seamless)</option>
							<option value="cut">Cut</option>
						</select>
					</label>
					<p class="hint">
						{frames} frames, after a {(warmupMs / 1000).toFixed(1)} s warm-up so the loop starts full.
					</p>
					<p class="hint">
						Fired by a rig keyframe, the loop starts on the beat, follows its bone and fades out
						over {beatFadeOut.toFixed(2)} s (the longest particle life) when the beat ends. A flight trail
						plays live.
					</p>
					{#if blockers.length}
						<ul class="blockers">
							{#each blockers as reason (reason)}
								<li>{reason}</li>
							{/each}
						</ul>
					{/if}
					<div class="actions">
						<button
							class="primary"
							disabled={busy || !!blockers.length || !savedId}
							title={savedId ? 'Capture the loop and store its sheet' : 'Save the effect first'}
							onclick={bakeNow}
						>
							{result ? 'Bake again' : 'Bake now'}
						</button>
						{#if !savedId}<span class="hint">Save the effect first.</span>{/if}
						{#if progress}
							<span class="progress">
								{PHASE[progress.phase]}
								<progress max={progress.total} value={progress.done}></progress>
							</span>
						{/if}
					</div>
					{#if error}<p class="error">{error}</p>{/if}
					{#if result && !progress && fresh?.hash === result.hash}
						<p class="hint">Baked. Save the effect to keep this bake.</p>
					{/if}
				</div>
				<div class="preview">
					{#if result}
						<canvas bind:this={previewCanvas} width="180" height="180"></canvas>
						<p class="hint">
							{result.frames.length} frames · {result.sheet.w}×{result.sheet.h} px page{stale
								? ' · stale'
								: ''}
						</p>
					{:else}
						<div class="empty">No bake yet</div>
					{/if}
				</div>
			</div>
			<table class="compare">
				<thead>
					<tr><th></th><th>Live</th><th>Baked</th></tr>
				</thead>
				<tbody>
					<tr>
						<td>Per copy, each frame</td>
						<td>
							{cost ? `${cost.total.peak.live} particles at peak` : 'measuring…'}
						</td>
						<td>1 sprite</td>
					</tr>
					<tr>
						<td>Texture memory</td>
						<td>the layers' atlases</td>
						<td>
							{result
								? `${megabytes(result.sheet.w, result.sheet.h)} MB (RGBA, less as KTX2)`
								: '—'}
						</td>
					</tr>
				</tbody>
			</table>
			{#if result && result.blendMode === 'normal' && doc.layers.some((l) => blendMode(l.config) !== 'normal')}
				<p class="hint">
					Mixed blend modes bake as Normal: additive glow over a dark background may read slightly
					darker than live.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.bake {
		border-top: 1px solid #1f2937;
		background: #0e131a;
		font-size: 12px;
		color: #cbd5e1;
	}
	.bakebar {
		display: flex;
		align-items: baseline;
		gap: 12px;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.lbl {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.pill {
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 11px;
	}
	.pill.off {
		background: #1f2937;
		color: #94a3b8;
	}
	.pill.warn {
		background: #221b0c;
		color: #fcd34d;
	}
	.pill.on {
		background: #0c2a1c;
		color: #86efac;
	}
	.chev {
		margin-left: auto;
		color: #64748b;
	}
	.bakebody {
		padding: 0 12px 10px;
	}
	.cols {
		display: flex;
		gap: 16px;
	}
	.settings {
		flex: 1;
		min-width: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 4px 0;
	}
	.row > span:first-child {
		width: 84px;
		color: #94a3b8;
	}
	.row input[type='number'] {
		width: 72px;
	}
	.row.toggle {
		color: #e2e8f0;
	}
	.val {
		color: #94a3b8;
		width: 40px;
	}
	.hint {
		margin: 4px 0;
		color: #64748b;
		font-size: 11px;
	}
	.blockers {
		margin: 4px 0;
		padding-left: 18px;
		color: #fcd34d;
		font-size: 11px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 6px;
	}
	.primary {
		padding: 4px 12px;
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #94a3b8;
	}
	.error {
		margin: 4px 0;
		color: #fca5a5;
		font-size: 11px;
	}
	.preview {
		width: 180px;
		flex: none;
		text-align: center;
	}
	.preview canvas,
	.empty {
		width: 180px;
		height: 180px;
		border-radius: 4px;
		background: repeating-conic-gradient(#111827 0% 25%, #0b0e13 0% 50%) 50% / 16px 16px;
	}
	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #475569;
	}
	.compare {
		margin-top: 8px;
		border-collapse: collapse;
		width: 100%;
	}
	.compare th {
		text-align: left;
		font-weight: 500;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 2px 6px;
	}
	.compare td {
		padding: 3px 6px;
		border-top: 1px solid #1f2937;
	}
</style>
