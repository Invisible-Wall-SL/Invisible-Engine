<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		appliedRenderOptions,
		compressedTextures,
		deviceClass,
		deviceScreenPixelRatio,
		deviceSignals,
		instrumentApp,
		ktx2Fallbacks,
		perfProbe,
		renderQualitySnapshot,
		renderSwitches,
		renderTier,
		type FrameWork,
		type RenderQualitySnapshot,
		type RendererInfo,
		type RendererProbe,
		type TextureFormatSummary,
	} from 'pixi-svelte';
	import { setFrameProbe } from 'pixi-svelte/frameClock';
	import { normalizeGameConfigDoc, resolveFamily } from 'game-config';

	import { artTierInForce, bakedGameConfig } from '../editor-scenes';

	import {
		ARCADE_WORK_KEYS,
		arcadePerf,
		takeArcadeFrame,
		type ArcadePhase,
	} from '../game/arcadePerf';
	import { createNetworkMonitor, networkLines } from '../game/perfNetwork';
	import {
		WORK_KEYS,
		createPerfStats,
		THROTTLED_MS,
		type BusySnapshot,
		type PerfBucketSnapshot,
		type PerfSnapshot,
		type SceneLayerSummary,
		type WorkKey,
		type WorkSnapshot,
	} from '../game/perfStats';
	import {
		PHASE_SETS,
		SPIKE_CAUSES,
		stateLabel,
		topCause,
		type PerfPhase,
		type SpikeCauseCounts,
	} from '../game/perfSpikes';
	import { stateApp } from '../game/stateApp';
	import { stateGame } from '../game/stateGame.svelte';
	import { stateXstate } from '../game/stateXstate';
	import type { PerfSender } from '../game/perfSend';

	/**
	 * The `?perf=1` frame-time readout: what the frames on THIS device look like while the game
	 * idles and while it spins (`perfStats.ts`), what each frame asks of the GPU, how the renderer
	 * was set up (`pixi-svelte` `glCounters.ts`, `renderOptions.ts`), the quality level it draws
	 * at now (`renderQuality.ts`) and whether it took the device for a phone and why
	 * (`deviceClass.ts`), so a phone's numbers can be read and pasted back. Mounted only
	 * with the flag (`Game.svelte` imports it on demand); without it nothing here exists, listens,
	 * counts or draws. HTML, so it costs the canvas nothing; one line in a corner until tapped open.
	 * `?perfgpu=1` also waits for the GPU after every frame to time it, which stalls the pipeline:
	 * read it on its own, never with fps. Each spike (a frame over max(33 ms, 2.5 display frames))
	 * is recorded with what its frames did and a likely cause (`perfSpikes.ts`); `?particles=off`
	 * turns every particle off for an A/B read. Frames are read in three phases: idle, spinning,
	 * and a round's frames with the reels at rest (`round`: wins, features, banners); each reports
	 * what it built and threw away (`pixi-svelte` `churnProbe.ts`). With `&perfsession=<token>` (a
	 * capture session from the Invisible Profiler) a Send button posts the reading to the launcher,
	 * and it is also sent on its own before a Reset discards it and when the page is hidden
	 * (`perfSend.ts`, loaded only then). An ARCADE game's frames are read in its own phases instead,
	 * `menu` and `play`, with what its sim and its room did (`arcadePerf.ts`); the report says the
	 * game's family (`kind`), so the Profiler knows which phases it holds. The report's `network`
	 * block (`perfNetwork.ts`) is what the page downloaded since it loaded — each file's path and
	 * sizes, by class and by load stage, the first frame, the RGS's requests and, online, the room's
	 * messages; Reset does not clear it.
	 */

	const query = new URLSearchParams(location.search);
	const waitForGpu = query.get('perfgpu') === '1';
	const particlesOff = query.get('particles') === 'off';
	const kind = resolveFamily(normalizeGameConfigDoc(bakedGameConfig()) ?? null);
	const arcade = kind === 'arcade';
	const phases: readonly PerfPhase[] = PHASE_SETS[arcade ? 'arcade' : 'slot'];
	const stats = createPerfStats(undefined, arcade ? 'arcade' : 'slot');
	/** The phase the last arcade tick was in, and the room's phase: the next frame counts there. */
	let arcadePhase: ArcadePhase = 'lobby';
	let arcadeState: string | undefined;
	let snapshot = $state<PerfSnapshot>();
	const top = $derived(snapshot && topCause(snapshot.spikes.causes));
	let quality = $state<RenderQualitySnapshot>();
	let info = $state<RendererInfo>();
	let textures = $state<TextureFormatSummary[]>([]);
	let open = $state(false);
	let copied = $state<'yes' | 'no'>();
	let copyText = $state('');
	let sender: PerfSender | undefined;
	let canSend = $state(false);
	let sent = $state<{ ok: boolean; text: string }>();
	/** Frames in the last reading sent, so leaving twice with nothing new sends once. */
	let sentFrames = 0;
	/**
	 * Resets since the page loaded. A reading is the whole window since the last Reset, so every send
	 * of one window carries the same `sendKey` (`<load>.<resets>`): the Profiler keeps the fullest and
	 * not one reading for every tap, hide and resend.
	 */
	let resets = 0;
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
	const network = createNetworkMonitor(location.origin, performance.timeOrigin);
	let resources: PerformanceObserver | undefined;
	let net = $state<string[]>([]);
	/** The game's first frame and the end of its boot load, noted on the frame each is first seen. */
	let framed = false;
	let booted = false;
	const noteLoad = () => {
		const now = performance.now();
		if (!framed) {
			framed = true;
			network.firstFrame(now, 'tick');
		}
		if (stateApp.loaded) {
			booted = true;
			network.booted(now);
		}
	};
	/**
	 * Every file the page has fetched and will fetch. A Pixi tick already run means the first frame
	 * came before this mounted, so First Contentful Paint stands in for it.
	 */
	const watchNetwork = () => {
		if (
			typeof PerformanceObserver === 'undefined' ||
			!PerformanceObserver.supportedEntryTypes?.includes('resource')
		) {
			return;
		}
		if ((stateApp.pixiApplication?.ticker?.lastTime ?? -1) >= 0) {
			framed = true;
			const paint = performance.getEntriesByName('first-contentful-paint')[0];
			if (paint) network.firstFrame(paint.startTime, 'paint');
		}
		if (stateApp.loaded) noteLoad();
		network.navigation(
			performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined,
		);
		// The browser keeps 250 entries before anyone observes; past that the earliest are gone.
		if (performance.getEntriesByType('resource').length >= 250) network.bufferFull();
		resources = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) network.add(entry as PerformanceResourceTiming);
		});
		resources.observe({ type: 'resource', buffered: true });
	};
	/** None where the browser has no Resource Timing: an empty block would read as 0 MB downloaded. */
	const networkBlock = (short = false) =>
		resources ? network.block({ short, socket: arcadePerf.socket }) : undefined;
	/**
	 * Where the visible part of the page sits in the layout viewport. A fixed element is pinned to
	 * the layout viewport, so a page iOS Safari has panned or zoomed hides it: the readout follows the
	 * visual viewport instead, so Send can always be reached.
	 */
	let viewportOffset = $state({ x: 0, y: 0 });
	const followViewport = () => {
		const v = window.visualViewport;
		if (v) viewportOffset = { x: v.offsetLeft, y: v.offsetTop };
	};
	const onVisibility = () => {
		if (document.visibilityState !== 'hidden') {
			stats.resume();
			return;
		}
		void send('leaving');
		stats.pause();
	};
	/**
	 * A side rAF loop that only hands its timestamp to the stats: the fastest rate it ever ran at is
	 * the display's (the game's own frames may be slower than the display).
	 */
	let displayRaf = 0;
	const displayLoop = (time: number) => {
		stats.displayFrame(time);
		displayRaf = requestAnimationFrame(displayLoop);
	};

	/** The renderer exists once `<App>` has initialised it, which can be after this mounts. */
	const ensureProbe = () => {
		const app = stateApp.pixiApplication;
		if (probe || !app?.renderer) return;
		probe = instrumentApp(app, {
			onFrame: arcade ? arcadeWork : (work) => stats.work(work),
			waitForGpu,
			onGpuTime: (ms) => stats.gpuTime(ms),
			scene: arcade,
		});
		info = probe.info();
	};
	/** An arcade frame's work: the renderer's counts and what its sim and room did. */
	const arcadeWork = (work: FrameWork) => {
		const frame = takeArcadeFrame();
		arcadePhase = frame.phase;
		arcadeState = frame.state;
		stats.work({ ...work, ...frame.work });
		stats.lates(frame.lates);
		if (work.scene) stats.scene(work.scene);
	};
	let tick = 0;
	const refresh = () => {
		ensureProbe();
		snapshot = stats.snapshot();
		quality = renderQualitySnapshot();
		if (probe && tick++ % 4 === 0) textures = probe.textures();
		const block = open ? networkBlock(true) : undefined;
		if (block) net = networkLines(block);
	};

	onMount(() => {
		if (query.get('perfsession')) {
			void import('../game/perfSend').then(({ createPerfSender }) => {
				sender = createPerfSender(query);
				canSend = !!sender;
			});
		}
		arcadePerf.on = arcade;
		watchNetwork();
		setFrameProbe((time, moving) => {
			if (!booted) noteLoad();
			if (arcade) stats.arcadeFrame(time, arcadePhase, arcadeState);
			else stats.frame(time, spinning(), moving, gameState());
		});
		document.addEventListener('visibilitychange', onVisibility);
		if (document.visibilityState === 'hidden') stats.pause();
		displayRaf = requestAnimationFrame(displayLoop);
		followViewport();
		window.visualViewport?.addEventListener('resize', followViewport);
		window.visualViewport?.addEventListener('scroll', followViewport);
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
			// A script measures in slices it reads itself: its resets send nothing.
			if (action === 'reset') reset(false);
			const text = JSON.stringify(report(stats.snapshot()));
			if (action === 'take') reset(false);
			return text;
		};
	});
	onDestroy(() => {
		setFrameProbe(undefined);
		arcadePerf.on = false;
		document.removeEventListener('visibilitychange', onVisibility);
		cancelAnimationFrame(displayRaf);
		window.visualViewport?.removeEventListener('resize', followViewport);
		window.visualViewport?.removeEventListener('scroll', followViewport);
		observer?.disconnect();
		resources?.disconnect();
		clearInterval(timer);
		probe?.dispose();
		window.__IE_PERF__ = undefined;
	});

	const reset = (autoSend = true) => {
		if (autoSend) void send('reset');
		stats.reset();
		resets++;
		snapshot = stats.snapshot();
		sentFrames = 0;
		copied = undefined;
		copyText = '';
	};

	const framesOf = (s: PerfSnapshot) =>
		s.set === 'arcade'
			? s.loading.frames + s.lobby.frames + s.play.frames + s.spectate.frames
			: s.idle.frames + s.spinning.frames + s.round.frames;

	/**
	 * Posts the reading as it stands. A Reset or the page being hidden sends on its own, and only a
	 * reading with frames it has not sent yet, so a tester who only plays still leaves one each time.
	 * Leaving sends it without the per-texture list, the spike records and the network block's file
	 * list (its heaviest files stay), so it fits a `keepalive` request that outlives the page; the
	 * summary the Profiler lists reads none of them. The same short
	 * form is the fallback when a reading too large to post cannot be uploaded either.
	 */
	const send = async (why: 'tap' | 'reset' | 'leaving' = 'tap') => {
		if (!sender) return;
		const auto = why !== 'tap';
		const s = stats.snapshot();
		const frames = framesOf(s);
		if (auto && (!frames || frames === sentFrames)) return;
		const full = report(s);
		const short = JSON.stringify({
			...full,
			textureList: undefined,
			spikes: undefined,
			network: networkBlock(true),
			trimmed: true,
		});
		const text = why === 'leaving' ? short : JSON.stringify(full);
		sentFrames = frames;
		const outcome = await sender.send(text, { leaving: why === 'leaving', fallback: short });
		sent = outcome.ok
			? {
					ok: true,
					text: `sent${auto ? ' (auto)' : ''}${outcome.trimmed ? ' — trimmed, the full one was too large' : ''}`,
				}
			: { ok: false, text: `not sent: ${outcome.error}` };
		if (!outcome.ok) sentFrames = 0;
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

	/** Phone or desktop, the signal that decided it and what it chose (`deviceClass.ts`). */
	const device = () => {
		const signals = deviceSignals();
		return {
			...deviceClass(),
			touchPoints: signals.maxTouchPoints,
			coarsePointer: signals.coarsePointer,
			viewportScale: signals.viewportScale,
			screen: `${screen.width}x${screen.height}`,
			screenPixelRatio: deviceScreenPixelRatio(),
			compressed: compressedTextures(),
			art: artTierInForce(),
		};
	};
	const round4 = (n: number) => Number(n.toFixed(4));
	const deviceLine = (d: ReturnType<typeof device>) =>
		[
			`${d.class} (${d.reason})`,
			`${d.touchPoints} touch · ${d.coarsePointer ? 'coarse' : 'fine'} pointer`,
			`zoom ${round4(d.viewportScale)} · ${round4(d.screenPixelRatio)} px per css px`,
			d.compressed ? 'KTX2 art' : 'uncompressed art',
			`art ${d.art ?? '–'}`,
		].join(' · ');

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
		const phased =
			s.set === 'arcade'
				? {
						loading: bucket(s.loading),
						lobby: bucket(s.lobby),
						play: bucket(s.play),
						spectate: bucket(s.spectate),
						arcade: { ...arcadePerf.info, lateMs: s.lateMs },
					}
				: {
						idle: bucket(s.idle),
						spinning: bucket(s.spinning),
						round: bucket(s.round),
						reelStepErrorPx: s.reel,
					};
		return {
			perf: 10,
			sendKey: `${Math.round(performance.timeOrigin)}.${resets}`,
			kind,
			ua: navigator.userAgent,
			dpr: window.devicePixelRatio,
			device: device(),
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
			textureList: probe?.textureList(),
			ktx2Fallbacks: ktx2Fallbacks(),
			achievedHz: s.achievedHz,
			displayHz: s.displayHz,
			budgetMs: s.budgetMs,
			capped30: s.capped30,
			seconds: s.seconds,
			hiddenMs: s.hiddenMs,
			hiddenFrames: s.hiddenFrames,
			throttledFrames: s.throttledFrames,
			visibilityState: document.visibilityState,
			...phased,
			work: s.work,
			busy: s.busy,
			gpuTimer: probe?.gpuTimer() ?? 'n/a',
			...(s.gpuMs ? { gpuMs: s.gpuMs } : {}),
			...(s.set === 'arcade' && s.scene ? { scene: s.scene } : {}),
			churnApis: { builds: perfProbe.countsBuilds },
			spikeOverMs: s.spikes.overMs,
			spikeApis: { longtask: longTasks, heap: heapReported },
			spikeCauses: s.spikes.causes,
			spikes: s.spikes.records,
			network: networkBlock(),
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
		const outcome = trial?.kept ? 'kept' : trial?.steppedOn ? 'stepped on' : 'reverted';
		const verdict = trial
			? `last trial L${trial.level} ${outcome} ` +
				`(${Math.round(trial.before.slowShare * 100)}% → ${Math.round(trial.after.slowShare * 100)}% ` +
				`slow, ${trial.before.frameMs} → ${trial.after.frameMs} ms)`
			: undefined;
		const up = q.stepUp;
		const stepUp = !up
			? undefined
			: up.never
				? `L${up.level} never again (${up.failures} failed)`
				: `L${up.level} again after ${up.good}/${up.goodWindows} good windows ` +
					`(${up.failures} failed)`;
		const left = q.budget;
		const refill = left?.refillIn === undefined ? '' : ` (+1 in ${left.refillIn} windows)`;
		const budget = left ? `budget ${left.left}/${left.burst}${refill}` : undefined;
		return [
			q.mode,
			...(q.levels > 1 ? [`L${q.level.index} of L0–L${q.levels - 1}`] : []),
			`res ${q.level.resolution}`,
			q.level.msaa ? 'MSAA' : 'no MSAA',
			q.level.postFx === false ? 'post FX off' : 'post FX on',
			`particle cap ${q.level.particleCap ?? 1}`,
			...(q.secondChance ? [`second chance ${q.secondChance}`] : []),
			...(q.effectsNext ? ['effects next'] : []),
			...(budget ? [budget] : []),
			...(q.mode === 'adaptive' ? [switches] : []),
			...(verdict ? [verdict] : []),
			...(q.downStopped ? ['no more steps down'] : []),
			...(stepUp ? [stepUp] : []),
		].join(' · ');
	};

	const line = (b: PerfBucketSnapshot) =>
		b.frames ? `${b.fps} fps · p50 ${b.p50} · p95 ${b.p95} · max ${b.max} ms` : 'no frames yet';
	/** A phase's busy time against the frame budget: what the game costs, whatever the display does. */
	const busyLine = (s: PerfSnapshot, phase: PerfPhase) => {
		const busy = (s.busy as Partial<Record<PerfPhase, BusySnapshot>>)[phase];
		return busy?.frames
			? `busy p50 ${busy.p50} · p95 ${busy.p95} / ${s.budgetMs} ms`
			: 'no busy time yet';
	};
	/** The reading is not comparable: the page was hidden or throttled for much of it. */
	const throttled = (s: PerfSnapshot) => {
		const frames = framesOf(s);
		const slow = phases.some((p) => (bucketOf(s, p)?.p50 ?? 0) > THROTTLED_MS);
		return (
			slow || s.hiddenMs > 0.05 * Math.max(1, s.seconds) * 1000 || s.throttledFrames > 0.5 * frames
		);
	};

	const ROWS: readonly WorkKey[] = [...WORK_KEYS, ...ARCADE_WORK_KEYS];
	const LABELS: Record<WorkKey, string> = {
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
		simSteps: 'sim steps',
		simCatchUp: 'catch-up frames (share)',
		simDroppedMs: 'sim time dropped ms',
		simMs: 'sim ms',
		netMs: 'room messages ms',
		bodies: 'bodies',
		pairs: 'collision pairs tested',
		spawns: 'bodies spawned',
		despawns: 'bodies despawned',
		looks: 'looks animated',
		patches: 'room states',
		patchBytes: 'room state bytes',
		cameraPx: 'camera moved px',
	};
	const cell = (w: WorkSnapshot | undefined, key: WorkKey) => {
		const v = w?.perFrame[key];
		return v ? `${v.mean} / ${v.p95} / ${v.max}` : '–';
	};
	const workOf = (s: PerfSnapshot, phase: PerfPhase): WorkSnapshot | undefined =>
		(s.work as Partial<Record<PerfPhase, WorkSnapshot>>)[phase];
	const bucketOf = (s: PerfSnapshot, phase: PerfPhase): PerfBucketSnapshot | undefined =>
		(s as Partial<Record<PerfPhase, PerfBucketSnapshot>>)[phase];
	const causeList = (counts: SpikeCauseCounts) =>
		SPIKE_CAUSES.filter((cause) => counts[cause])
			.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
			.map((cause) => `${cause} ${counts[cause]}`)
			.join(', ');
	const total = (counts: SpikeCauseCounts) =>
		Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
	const PHASE_NAMES: Record<PerfPhase, string> = {
		idle: 'idle',
		spinning: 'spin',
		round: 'round',
		loading: 'loading',
		lobby: 'lobby',
		play: 'play',
		spectate: 'spectate',
	};
	const spikesLine = (s: PerfSnapshot) => {
		const parts = phases.flatMap((phase) => {
			const counts = s.spikes.causes[phase] ?? {};
			return total(counts) ? [`${PHASE_NAMES[phase]} ${total(counts)}: ${causeList(counts)}`] : [];
		});
		return `over ${s.spikes.overMs} ms · ${parts.length ? parts.join(' · ') : 'none'}`;
	};
	/** What an arcade game's sim runs at and, online, how late its room states came while it played. */
	const arcadeLine = (s: PerfSnapshot) => {
		if (s.set !== 'arcade') return '';
		const info = arcadePerf.info;
		const late = s.lateMs.play;
		return [
			info ? `sim ${info.fixedHz} Hz` : 'sim not started',
			...(info?.online ? [`online · patches ${info.patchHz ?? '?'} Hz`] : []),
			...(late.count ? [`states late p50 ${late.p50} · p95 ${late.p95} · max ${late.max} ms`] : []),
		].join(' · ');
	};
	/** The header's phase: spinning for a slot, play for an arcade game. */
	const headPhase = (s: PerfSnapshot) =>
		s.set === 'arcade'
			? `play busy p95 ${s.busy.play.p95} / ${s.budgetMs} ms · ${s.play.fps} fps`
			: `spin busy p95 ${s.busy.spinning.p95} / ${s.budgetMs} ms · ${s.spinning.fps} fps · reel ${s.reel.p95} px`;
	/** The scene sample as lines: the totals, then the heaviest layers. */
	const sceneLines = (s: PerfSnapshot) => {
		const scene = s.set === 'arcade' ? s.scene : undefined;
		if (!scene) return [];
		const cost = (l: SceneLayerSummary) =>
			l.draws === undefined
				? ''
				: ` · ${l.draws} draws · ${l.passes} passes · ${l.filterPasses} filter passes`;
		return [
			`${scene.mean.nodes} nodes · ${scene.mean.renderables} renderables · ${scene.mean.visible} drawn · ${scene.mean.culled} culled · walk ${scene.mean.walkMs} ms (${scene.samples} samples)`,
			...[...scene.layers]
				.sort((a, b) => b.renderables - a.renderables)
				.slice(0, 6)
				.map(
					(l) =>
						`${l.label}${l.renderGroup ? ' (group)' : ''}: ${l.nodes} nodes · ${l.renderables} renderables · ${l.visible} drawn${cost(l)}`,
				),
			`stage's own: ${scene.rest.draws} draws · ${scene.rest.passes} passes · ${scene.rest.filterPasses} filter passes`,
		];
	};
	/** The GPU time of a tick, where the browser's timer query gave it. */
	const gpuLine = (s: PerfSnapshot) => {
		const g = s.gpuMs as
			Partial<Record<PerfPhase, { count: number; p50: number; p95: number }>> | undefined;
		if (!g)
			return `GPU time n/a (${probe?.gpuTimer() === 'on' ? 'no samples yet' : 'no timer query'})`;
		return phases
			.filter((p) => g[p]?.count)
			.map((p) => `${PHASE_NAMES[p]} p50 ${g[p]?.p50} · p95 ${g[p]?.p95} ms`)
			.join(' · ');
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
	<div
		class="ie-perf"
		data-testid="perf-hud"
		style:transform={viewportOffset.x || viewportOffset.y
			? `translate(${viewportOffset.x}px, ${viewportOffset.y}px)`
			: undefined}
	>
		<button type="button" class="ie-perf-head" onclick={() => (open = !open)}>
			{(snapshot.displayHz ?? snapshot.achievedHz)
				? `${snapshot.displayHz ?? snapshot.achievedHz} Hz`
				: '… Hz'} · {headPhase(snapshot)}
			{#if throttled(snapshot)}<b class="warn"> · throttled — not comparable</b>{/if}
			{#if snapshot.capped30}<b class="warn"> · 30 fps cap (Low Power Mode?)</b>{/if}
			{#if quality?.level.index}<b class="warn"> · quality L{quality.level.index}</b>{/if}
			{#if top}<b class="warn"> · spikes: {top[0]} ({top[1]})</b>{/if}
			{#if particlesOff}<b class="warn"> · particles off</b>{/if}
			<span class="toggle">{open ? '▾' : '▸'}</span>
		</button>
		{#if open}
			<div class="ie-perf-body">
				<div>
					display ~{snapshot.displayHz ?? '?'} Hz · achieved ~{snapshot.achievedHz ?? '?'} Hz · {snapshot.seconds}
					s · budget {snapshot.budgetMs} ms
				</div>
				{#if snapshot.hiddenMs || snapshot.throttledFrames}
					<div class:warn={throttled(snapshot)}>
						hidden {Math.round(snapshot.hiddenMs / 100) / 10} s ({snapshot.hiddenFrames} frames) · {snapshot.throttledFrames}
						frames over {THROTTLED_MS} ms{throttled(snapshot) ? ' — throttled, not comparable' : ''}
					</div>
				{/if}
				{#each phases as phase (phase)}
					{@const b = bucketOf(snapshot, phase)}
					{#if b}
						<div><b>{PHASE_NAMES[phase]}</b> {line(b)}</div>
						<div>{busyLine(snapshot, phase)}</div>
						<div>hitches &gt;33/50/100 ms: {b.hitches[33]}/{b.hitches[50]}/{b.hitches[100]}</div>
					{/if}
				{/each}
				{#if snapshot.set === 'slot'}
					<div>
						<b>reel step error</b> mean {snapshot.reel.mean} · p95 {snapshot.reel.p95} · max {snapshot
							.reel.max} px ({snapshot.reel.steps} steps)
					</div>
				{:else}
					<div><b>arcade</b> {arcadeLine(snapshot)}</div>
				{/if}
				<div><b>spikes</b> {spikesLine(snapshot)}</div>
				{#each sceneLines(snapshot) as text, i (i)}
					<div>
						{#if i === 0}<b>scene</b>{/if}
						{text}
					</div>
				{/each}
				<div><b>gpu time</b> {gpuLine(snapshot)}</div>
				{#each net as text, i (i)}
					<div>
						{#if i === 0}<b>net</b>{/if}
						{text}
					</div>
				{/each}
				{#if snapshot.capped30}
					<div class="warn">Frames never come faster than ~30 fps: Low Power Mode?</div>
				{/if}
				{#if quality}
					<div><b>quality</b> {qualityLine(quality)}</div>
				{/if}
				<div class="ie-perf-section"><b>device</b> {deviceLine(device())}</div>
				{#if info}
					<div>
						<b>gpu</b>
						{info.gpu} · WebGL{info.webgl} · res {info.resolution} · {info.compressed.join('/') ||
							'no compressed formats'}
					</div>
					<div>{attrs(info)}</div>
				{/if}
				<table>
					<thead>
						<tr>
							<th>per frame, mean / p95 / max</th>
							{#each phases as phase (phase)}<th>{PHASE_NAMES[phase]}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each ROWS as key (key)}
							{#if phases.some((phase) => snapshot && workOf(snapshot, phase)?.perFrame[key])}
								<tr>
									<td>{LABELS[key]}</td>
									{#each phases as phase (phase)}<td>{cell(workOf(snapshot, phase), key)}</td
										>{/each}
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
					{#if canSend}<button type="button" onclick={() => send()}>Send</button>{/if}
					<button type="button" onclick={() => reset()}>Reset</button>
					{#if copied === 'yes'}<span>copied</span>{/if}
				</div>
				{#if sent}<div class:warn={!sent.ok}>{sent.text}</div>{/if}
				{#if !canSend}
					<div>
						no Send: this link has no capture session (perfsession) — open a Profiler capture link
					</div>
				{/if}
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
