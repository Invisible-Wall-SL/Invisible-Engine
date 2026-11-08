<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { renderTier } from 'pixi-svelte';
	import { setFrameProbe } from 'pixi-svelte/frameClock';

	import { createPerfStats, type PerfBucketSnapshot, type PerfSnapshot } from '../game/perfStats';
	import { stateApp } from '../game/stateApp';
	import { stateGame } from '../game/stateGame.svelte';

	/**
	 * The `?perf=1` frame-time readout: what the frames on THIS device look like while the game
	 * idles and while it spins (`perfStats.ts`), so a phone's numbers can be read and pasted back.
	 * Mounted only with the flag (`Game.svelte` imports it on demand); without it nothing here
	 * exists, listens or draws. HTML, so it costs the canvas nothing; one line in a corner until
	 * tapped open.
	 */

	const stats = createPerfStats();
	let snapshot = $state<PerfSnapshot>();
	let open = $state(false);
	let copied = $state<'yes' | 'no'>();
	let copyText = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;

	const spinning = () => stateGame.board.some((reel) => reel.reelState.rolling);
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') stats.pause();
	};

	onMount(() => {
		setFrameProbe((time, moving) => stats.frame(time, spinning(), moving));
		document.addEventListener('visibilitychange', onVisibility);
		timer = setInterval(() => (snapshot = stats.snapshot()), 500);
	});
	onDestroy(() => {
		setFrameProbe(undefined);
		document.removeEventListener('visibilitychange', onVisibility);
		clearInterval(timer);
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

	const summary = (s: PerfSnapshot): string => {
		const app = stateApp.pixiApplication;
		const canvas = app?.canvas;
		const build = typeof __IE_BUILD__ === 'undefined' ? undefined : __IE_BUILD__;
		return JSON.stringify({
			perf: 1,
			ua: navigator.userAgent,
			dpr: window.devicePixelRatio,
			tier: renderTier(),
			resolution: app?.renderer.resolution,
			canvas: canvas ? `${canvas.width}x${canvas.height}` : undefined,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			refreshHz: s.refreshHz,
			capped30: s.capped30,
			seconds: s.seconds,
			idle: bucket(s.idle),
			spinning: bucket(s.spinning),
			reelStepErrorPx: s.reel,
			build: build && { version: build.version, sha: build.sha ?? build.engineSha },
		});
	};

	const copy = async () => {
		if (!snapshot) return;
		copyText = summary(snapshot);
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
