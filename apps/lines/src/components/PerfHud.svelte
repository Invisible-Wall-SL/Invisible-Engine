<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		appliedRenderOptions,
		instrumentApp,
		renderSwitches,
		renderTier,
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
	import { stateApp } from '../game/stateApp';
	import { stateGame } from '../game/stateGame.svelte';

	/**
	 * The `?perf=1` frame-time readout: what the frames on THIS device look like while the game
	 * idles and while it spins (`perfStats.ts`), what each frame asks of the GPU and how the
	 * renderer was set up (`pixi-svelte` `glCounters.ts`, `renderOptions.ts`), so a phone's numbers
	 * can be read and pasted back. Mounted only with the flag (`Game.svelte` imports it on demand);
	 * without it nothing here exists, listens, counts or draws. HTML, so it costs the canvas
	 * nothing; one line in a corner until tapped open. `?perfgpu=1` also waits for the GPU after
	 * every frame to time it, which stalls the pipeline: read it on its own, never with fps.
	 */

	const query = new URLSearchParams(location.search);
	const waitForGpu = query.get('perfgpu') === '1';
	const stats = createPerfStats();
	let snapshot = $state<PerfSnapshot>();
	let info = $state<RendererInfo>();
	let textures = $state<TextureFormatSummary[]>([]);
	let open = $state(false);
	let copied = $state<'yes' | 'no'>();
	let copyText = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;
	let probe: RendererProbe | undefined;

	const spinning = () => stateGame.board.some((reel) => reel.reelState.rolling);
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
		if (probe && tick++ % 4 === 0) textures = probe.textures();
	};

	onMount(() => {
		setFrameProbe((time, moving) => stats.frame(time, spinning(), moving));
		document.addEventListener('visibilitychange', onVisibility);
		timer = setInterval(refresh, 500);
		// JSON text: a script reads it over CDP, which cannot serialise Svelte's state proxies.
		// `'reset'` is the Reset button, for a script that measures from a moment of its own.
		window.__IE_PERF__ = (action?: 'reset') => {
			if (action === 'reset') reset();
			return snapshot ? JSON.stringify(report(snapshot)) : undefined;
		};
	});
	onDestroy(() => {
		setFrameProbe(undefined);
		document.removeEventListener('visibilitychange', onVisibility);
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
		return {
			perf: 2,
			ua: navigator.userAgent,
			dpr: window.devicePixelRatio,
			tier: renderTier(),
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
			reelStepErrorPx: s.reel,
			work: s.work,
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
		bufferBytes: 'buffer bytes',
		roundTrips: 'GL round trips',
		programs: 'program switches',
		calls: 'GL calls',
		renderMs: 'render ms (CPU)',
		tickMs: 'tick ms (CPU)',
		gpuWaitMs: 'GPU wait ms',
	};
	const cell = (w: WorkSnapshot, key: (typeof WORK_KEYS)[number]) => {
		const v = w.perFrame[key];
		return v ? `${v.mean} / ${v.max}` : '–';
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
				<div>
					<b>reel step error</b> mean {snapshot.reel.mean} · p95 {snapshot.reel.p95} · max {snapshot
						.reel.max} px ({snapshot.reel.steps} steps)
				</div>
				{#if snapshot.capped30}
					<div class="warn">Frames never come faster than ~30 fps: Low Power Mode?</div>
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
						<tr><th>per frame, mean / max</th><th>idle</th><th>spin</th></tr>
					</thead>
					<tbody>
						{#each WORK_KEYS as key (key)}
							{#if snapshot.work.idle.perFrame[key] || snapshot.work.spinning.perFrame[key]}
								<tr>
									<td>{LABELS[key]}</td>
									<td>{cell(snapshot.work.idle, key)}</td>
									<td>{cell(snapshot.work.spinning, key)}</td>
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
