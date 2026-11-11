<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		appliedRenderOptions,
		instrumentApp,
		perfProbe,
		renderQualitySnapshot,
		renderSwitches,
		renderTier,
		type RenderQualitySnapshot,
		type RendererInfo,
		type RendererProbe,
		type TextureFormatSummary,
	} from 'pixi-svelte';
	import { setFrameProbe } from 'pixi-svelte/frameClock';

	import {
		WORK_KEYS,
		createPerfStats,
		type PerfBucketSnapshot,
		type PerfSnapshot,
		type WorkSnapshot,
	} from '../game/perfStats';
	import {
		PERF_PHASES,
		SPIKE_CAUSES,
		stateLabel,
		topCause,
		type SpikeCauseCounts,
	} from '../game/perfSpikes';
	import { stateApp } from '../game/stateApp';
	import { stateGame } from '../game/stateGame.svelte';
	import { stateXstate } from '../game/stateXstate';

	/**
	 * The `?perf=1` frame-time readout: what the frames on THIS device look like while the game
	 * idles and while it spins (`perfStats.ts`), what each frame asks of the GPU, how the renderer
	 * was set up (`pixi-svelte` `glCounters.ts`, `renderOptions.ts`) and the quality level it draws
	 * at now (`renderQuality.ts`), so a phone's numbers can be read and pasted back. Mounted only
	 * with the flag (`Game.svelte` imports it on demand); without it nothing here exists, listens,
	 * counts or draws. HTML, so it costs the canvas nothing; one line in a corner until tapped open.
	 * `?perfgpu=1` also waits for the GPU after every frame to time it, which stalls the pipeline:
	 * read it on its own, never with fps. Each spike (a frame over max(33 ms, 2.5 display frames))
	 * is recorded with what its frames did and a likely cause (`perfSpikes.ts`); `?particles=off`
	 * turns every particle off for an A/B read. Frames are read in three phases: idle, spinning,
	 * and a round's frames with the reels at rest (`round`: wins, features, banners); each reports
	 * what it built and threw away (`pixi-svelte` `churnProbe.ts`).
	 */

	const query = new URLSearchParams(location.search);
	const waitForGpu = query.get('perfgpu') === '1';
	const particlesOff = query.get('particles') === 'off';
	const stats = createPerfStats();
	let snapshot = $state<PerfSnapshot>();
	const top = $derived(snapshot && topCause(snapshot.spikes.causes));
	let quality = $state<RenderQualitySnapshot>();
	let info = $state<RendererInfo>();
	let textures = $state<TextureFormatSummary[]>([]);
	let open = $state(false);
	let copied = $state<'yes' | 'no'>();
	let copyText = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;
	let probe: RendererProbe | undefined;

	const spinning = () => stateGame.board.some((reel) => reel.reelState.rolling);
	let stateSeen: unknown;
	let stateName: string | undefined;
	/** The state machine's value as a line, re-read only when it changes. */
	const gameState = () => {
		const value = stateXstate.value;
		if (value !== stateSeen) {
			stateSeen = value;
			stateName = value === '' ? undefined : stateLabel(value);
		}
		return stateName;
	};
	const longTasks =
		typeof PerformanceObserver !== 'undefined' &&
		!!PerformanceObserver.supportedEntryTypes?.includes('longtask');
	const heapReported =
		typeof (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
			?.usedJSHeapSize === 'number';
	let observer: PerformanceObserver | undefined;
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') stats.pause();
	};

	/** The renderer exists once `<App>` has initialised it, which can be after this mounts. */
	const ensureProbe = () => {
		const app = stateApp.pixiApplication;
		if (probe || !app?.renderer) return;
		probe = instrumentApp(app, { onFrame: (work) => stats.work(work), waitForGpu });
		info = probe.info();
	};
	let tick = 0;
	const refresh = () => {
		ensureProbe();
		snapshot = stats.snapshot();
		quality = renderQualitySnapshot();
		if (probe && tick++ % 4 === 0) textures = probe.textures();
	};

	onMount(() => {
		setFrameProbe((time, moving) => stats.frame(time, spinning(), moving, gameState()));
		document.addEventListener('visibilitychange', onVisibility);
		if (longTasks) {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) stats.longTask(entry.startTime, entry.duration);
			});
			observer.observe({ type: 'longtask' });
		}
		timer = setInterval(refresh, 500);
		// JSON text: a script reads it over CDP, which cannot serialise Svelte's state proxies. It
		// reads every frame up to the call. `'reset'` is the Reset button, for a script that measures
		// from a moment of its own; `'take'` reads, then resets, so a script can read a moment in
		// slices without losing a frame between them.
		window.__IE_PERF__ = (action?: 'reset' | 'take') => {
			if (action === 'reset') reset();
			const text = JSON.stringify(report(stats.snapshot()));
			if (action === 'take') reset();
			return text;
		};
	});
	onDestroy(() => {
		setFrameProbe(undefined);
		document.removeEventListener('visibilitychange', onVisibility);
		observer?.disconnect();
		clearInterval(timer);
		probe?.dispose();
		window.__IE_PERF__ = undefined;
	});

	const reset = () => {
		stats.reset();
		snapshot = stats.snapshot();
		copied = undefined;
		copyText = '';
	};

	const bucket = (b: PerfBucketSnapshot) => ({
		frames: b.frames,
		fps: b.fps,
		p50: b.p50,
		p95: b.p95,
		max: b.max,
		over33: b.hitches[33],
		over50: b.hitches[50],
		over100: b.hitches[100],
	});

	/** The URL switches that shape rendering, as given (absent ones left out). */
	const flags = () =>
		Object.fromEntries(
			[
				'render',
				'quality',
				'particles',
				'backbuffer',
				'aa',
				'opaque',
				'fx',
				'lazyresolve',
				'invalidate',
				'perfgpu',
			]
				.map((name) => [name, query.get(name)])
				.filter(([, value]) => value !== null),
		);

	const report = (s: PerfSnapshot) => {
		const app = stateApp.pixiApplication;
		const canvas = app?.canvas;
		const build = typeof __IE_BUILD__ === 'undefined' ? undefined : __IE_BUILD__;
		const now = renderQualitySnapshot();
		return {
			perf: 5,
			ua: navigator.userAgent,
			dpr: window.devicePixelRatio,
			tier: now?.mode ?? renderTier(),
			quality: now,
			resolution: app?.renderer.resolution,
			canvas: canvas ? `${canvas.width}x${canvas.height}` : undefined,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			flags: flags(),
			switches: renderSwitches(),
			render: appliedRenderOptions(),
			gpu: info,
			textures,
			refreshHz: s.refreshHz,
			capped30: s.capped30,
			seconds: s.seconds,
			idle: bucket(s.idle),
			spinning: bucket(s.spinning),
			round: bucket(s.round),
			reelStepErrorPx: s.reel,
			work: s.work,
			churnApis: { builds: perfProbe.countsBuilds },
			spikeOverMs: s.spikes.overMs,
			spikeApis: { longtask: longTasks, heap: heapReported },
			spikeCauses: s.spikes.causes,
			spikes: s.spikes.records,
			build: build && { version: build.version, sha: build.sha ?? build.engineSha },
		};
	};

	const copy = async () => {
		if (!snapshot) return;
		copyText = JSON.stringify(report(snapshot));
		try {
			await navigator.clipboard.writeText(copyText);
			copied = 'yes';
		} catch {
			// No clipboard (an insecure context, a refused permission): the text is shown to select.
			copied = 'no';
		}
	};

	const qualityLine = (q: RenderQualitySnapshot) => {
		const last = q.history.at(-1);
		const switches = last
			? `switches ${q.history.length}, last L${last.from}→L${last.to} ${last.reason} at ` +
				`${last.at} s (${Math.round(last.slowShare * 100)}% slow, ${last.frameMs} ms)`
			: 'no switches';
		const trial = q.trials.at(-1);
		const verdict = trial
			? `last trial L${trial.level} ${trial.kept ? 'kept' : 'reverted'} ` +
				`(${Math.round(trial.before.slowShare * 100)}% → ${Math.round(trial.after.slowShare * 100)}% ` +
				`slow, ${trial.before.frameMs} → ${trial.after.frameMs} ms)`
			: undefined;
		return [
			q.mode,
			...(q.levels > 1 ? [`L${q.level.index} of L0–L${q.levels - 1}`] : []),
			`res ${q.level.resolution}`,
			q.level.msaa ? 'MSAA' : 'no MSAA',
			...(q.mode === 'adaptive' ? [switches] : []),
			...(verdict ? [verdict] : []),
			...(q.downStopped ? ['no more steps down'] : []),
		].join(' · ');
	};

	const line = (b: PerfBucketSnapshot) =>
		b.frames ? `${b.fps} fps · p50 ${b.p50} · p95 ${b.p95} · max ${b.max} ms` : 'no frames yet';

	const LABELS: Record<(typeof WORK_KEYS)[number], string> = {
		draws: 'draws',
		vertices: 'vertices',
		passes: 'render passes',
		targetSwitches: 'target switches',
		resolves: 'MSAA resolves',
		invalidations: 'invalidations',
		filterPasses: 'filter passes',
		filterGroups: 'filtered nodes',
		copies: 'backdrop copies',
		textureUploads: 'texture uploads',
		uploadBytes: 'texture bytes',
		compiles: 'shader compiles',
		bufferBytes: 'buffer bytes',
		roundTrips: 'GL round trips',
		programs: 'program switches',
		calls: 'GL calls',
		renderMs: 'render ms (CPU)',
		tickMs: 'tick ms (CPU)',
		lateMs: 'ms before the tick',
		afterMs: 'ms after the tick',
		jsMs: 'frame JS ms',
		gpuWaitMs: 'GPU wait ms',
		particleMs: 'particle ms',
		particles: 'live particles',
		emitters: 'active emitters',
		baked: 'baked effects',
		rigMs: 'rig update ms',
		rigSyncMs: 'rig mesh ms',
		rigs: 'rig updates',
		created: 'objects built',
		createdContainers: '…containers',
		createdSprites: '…sprites',
		createdParticles: '…particle sprites',
		createdTexts: '…texts',
		createdGraphics: '…graphics',
		createdMeshes: '…meshes',
		createdOther: '…other views',
		destroyed: 'objects destroyed',
		destroyedContainers: '…containers',
		destroyedSprites: '…sprites',
		destroyedParticles: '…particle sprites',
		destroyedTexts: '…texts',
		destroyedGraphics: '…graphics',
		destroyedMeshes: '…meshes',
		destroyedOther: '…other views',
		rigsBuilt: 'rigs built',
		rigsDestroyed: 'rigs destroyed',
		textRenders: 'text renders',
		textMs: 'text render ms',
		domAdded: 'DOM nodes added',
		domRemoved: 'DOM nodes removed',
	};
	const cell = (w: WorkSnapshot, key: (typeof WORK_KEYS)[number]) => {
		const v = w.perFrame[key];
		return v ? `${v.mean} / ${v.max}` : '–';
	};
	const causeList = (counts: SpikeCauseCounts) =>
		SPIKE_CAUSES.filter((cause) => counts[cause])
			.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
			.map((cause) => `${cause} ${counts[cause]}`)
			.join(', ');
	const total = (counts: SpikeCauseCounts) =>
		Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
	const PHASE_NAMES = { idle: 'idle', spinning: 'spin', round: 'round' } as const;
	const spikesLine = (s: PerfSnapshot) => {
		const parts = PERF_PHASES.flatMap((phase) => {
			const counts = s.spikes.causes[phase];
			return total(counts) ? [`${PHASE_NAMES[phase]} ${total(counts)}: ${causeList(counts)}`] : [];
		});
		return `over ${s.spikes.overMs} ms · ${parts.length ? parts.join(' · ') : 'none'}`;
	};
	const attrs = (i: RendererInfo) => {
		const a = i.attributes;
		return a
			? `ctx aa ${a.antialias ? 'on' : 'off'} · alpha ${a.alpha ? 'on' : 'off'} · back buffer ${
					i.backBuffer ? (i.backBufferMsaa ? 'on (MSAA)' : 'on') : 'off'
				}`
			: 'context attributes unknown';
	};
</script>

{#if snapshot}
	<div class="ie-perf" data-testid="perf-hud">
		<button type="button" class="ie-perf-head" onclick={() => (open = !open)}>
			{snapshot.refreshHz ? `${snapshot.refreshHz} Hz` : '… Hz'} · spin {snapshot.spinning.fps} fps p95
			{snapshot.spinning.p95} · reel {snapshot.reel.p95} px
			{#if snapshot.capped30}<b class="warn"> · 30 fps cap (Low Power Mode?)</b>{/if}
			{#if quality?.level.index}<b class="warn"> · quality L{quality.level.index}</b>{/if}
			{#if top}<b class="warn"> · spikes: {top[0]} ({top[1]})</b>{/if}
			{#if particlesOff}<b class="warn"> · particles off</b>{/if}
			<span class="toggle">{open ? '▾' : '▸'}</span>
		</button>
		{#if open}
			<div class="ie-perf-body">
				<div>display ~{snapshot.refreshHz ?? '?'} Hz · {snapshot.seconds} s</div>
				<div><b>idle</b> {line(snapshot.idle)}</div>
				<div>
					hitches &gt;33/50/100 ms: {snapshot.idle.hitches[33]}/{snapshot.idle
						.hitches[50]}/{snapshot.idle.hitches[100]}
				</div>
				<div><b>spin</b> {line(snapshot.spinning)}</div>
				<div>
					hitches &gt;33/50/100 ms: {snapshot.spinning.hitches[33]}/{snapshot.spinning
						.hitches[50]}/{snapshot.spinning.hitches[100]}
				</div>
				<div><b>round</b> {line(snapshot.round)}</div>
				<div>
					hitches &gt;33/50/100 ms: {snapshot.round.hitches[33]}/{snapshot.round
						.hitches[50]}/{snapshot.round.hitches[100]}
				</div>
				<div>
					<b>reel step error</b> mean {snapshot.reel.mean} · p95 {snapshot.reel.p95} · max {snapshot
						.reel.max} px ({snapshot.reel.steps} steps)
				</div>
				<div><b>spikes</b> {spikesLine(snapshot)}</div>
				{#if snapshot.capped30}
					<div class="warn">Frames never come faster than ~30 fps: Low Power Mode?</div>
				{/if}
				{#if quality}
					<div><b>quality</b> {qualityLine(quality)}</div>
				{/if}
				{#if info}
					<div class="ie-perf-section">
						<b>gpu</b>
						{info.gpu} · WebGL{info.webgl} · res {info.resolution} · {info.compressed.join('/') ||
							'no compressed formats'}
					</div>
					<div>{attrs(info)}</div>
				{/if}
				<table>
					<thead>
						<tr><th>per frame, mean / max</th><th>idle</th><th>spin</th><th>round</th></tr>
					</thead>
					<tbody>
						{#each WORK_KEYS as key (key)}
							{#if PERF_PHASES.some((phase) => snapshot?.work[phase].perFrame[key])}
								<tr>
									<td>{LABELS[key]}</td>
									<td>{cell(snapshot.work.idle, key)}</td>
									<td>{cell(snapshot.work.spinning, key)}</td>
									<td>{cell(snapshot.work.round, key)}</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
				{#if textures.length}
					<div class="ie-perf-section">
						<b>textures</b>
						{textures.map((t) => `${t.format} ×${t.count} ${t.mb} MB`).join(' · ')}
					</div>
				{/if}
				<div class="ie-perf-actions">
					<button type="button" onclick={copy}>Copy</button>
					<button type="button" onclick={reset}>Reset</button>
					{#if copied === 'yes'}<span>copied</span>{/if}
				</div>
				{#if copied === 'no'}
					<textarea readonly rows="4" onfocus={(e) => e.currentTarget.select()}>{copyText}</textarea
					>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.ie-perf {
		position: fixed;
		top: env(safe-area-inset-top, 0px);
		left: env(safe-area-inset-left, 0px);
		z-index: 2147483646;
		max-width: min(92vw, 340px);
		max-height: 90vh;
		overflow-y: auto;
		font:
			11px/1.35 ui-monospace,
			monospace;
		color: #cfe;
		background: rgba(0, 0, 0, 0.75);
		border-bottom-right-radius: 6px;
	}
	.ie-perf button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.ie-perf-head {
		display: block;
		width: 100%;
		padding: 4px 7px;
		text-align: left;
	}
	.toggle {
		float: right;
		margin-left: 6px;
	}
	.ie-perf-body {
		padding: 0 7px 6px;
	}
	.ie-perf-body b {
		color: #fff;
	}
	.ie-perf-section {
		margin-top: 4px;
	}
	table {
		margin-top: 4px;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0 6px 0 0;
		text-align: left;
		font-weight: normal;
		white-space: nowrap;
	}
	th {
		color: #fff;
	}
	.warn {
		color: #ffb347;
	}
	.ie-perf-actions {
		display: flex;
		gap: 6px;
		align-items: center;
		margin-top: 4px;
	}
	.ie-perf-actions button {
		padding: 3px 10px;
		border: 1px solid #6a8;
		border-radius: 4px;
	}
	textarea {
		width: 100%;
		margin-top: 4px;
		font:
			10px/1.3 ui-monospace,
			monospace;
	}
</style>
