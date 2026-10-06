<script lang="ts">
	import { resolve } from '$app/paths';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { askConfirm } from '$lib/dialogs.svelte';
	import {
		ApiRefusal,
		NetworkLost,
		RUN_STEPS,
		api,
		cropUrl,
		describe,
		elapsed,
		isBreakdown,
		isRecord,
		isRefusal,
		isStartingPoint,
		mockupImageUrl,
		newRequestId,
		projectQuery,
		resend,
		safeHex,
		statusLabel,
		stepNumber,
		usd,
		type ActionAnswer,
		type Breakdown,
		type BreakdownImage,
		type CodedElement,
		type FontRequestEntry,
		type MockupsAnswer,
		type RunEvent,
		type RunSummary,
		type StartingPoint,
	} from '../director.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const runId = $derived(data.runId);

	// ── The run, live ─────────────────────────────────────────────────────────
	let run = $state<RunSummary | null>(null);
	let loadErr = $state('');
	let mockups = $state<MockupsAnswer | null>(null);
	let fonts = $state<FontRequestEntry[]>([]);
	let fontsErr = $state('');
	/** The last few stream rows, newest first, for the "latest" line under the banner. */
	let recent = $state<RunEvent[]>([]);
	/** `refused_request` errors the worker posted since this page opened: a row it could not apply. */
	let refusals = $state<string[]>([]);
	let streaming = $state(false);
	/** The stream could not be opened at all; the summary and the fonts are polled instead. */
	let polling = $state(false);
	let now = $state(Date.now());

	const startingPoint = $derived(isStartingPoint(run?.startingPoint) ? run.startingPoint : null);
	const mockupCount = $derived(startingPoint?.mockups.filter((m) => !m.styleOnly).length ?? 0);
	const styleCount = $derived(startingPoint?.mockups.filter((m) => m.styleOnly).length ?? 0);
	const stepN = $derived(run ? stepNumber(run.step) : 1);
	const waitingOnBreakdown = $derived(run?.status === 'waiting' && run.waitingOn === 'breakdown');
	const checkpointPayload = $derived(
		isRecord(run?.checkpoint?.payload) ? run.checkpoint.payload : null,
	);
	/** The analyst's breakdown at the open checkpoint; absent for the coordinator's style board. */
	const breakdown = $derived(
		waitingOnBreakdown && isBreakdown(checkpointPayload?.breakdown)
			? checkpointPayload.breakdown
			: null,
	);
	/** A `breakdown` the page cannot read: the checkpoint still opens, with its text and buttons. */
	const breakdownUnreadable = $derived(
		waitingOnBreakdown && checkpointPayload?.breakdown !== undefined && breakdown === null,
	);
	const styleBoard = $derived(
		waitingOnBreakdown && !breakdown && typeof checkpointPayload?.summary === 'string'
			? checkpointPayload.summary
			: '',
	);
	const terminal = $derived(
		run !== null && ['stopped', 'failed', 'handed_off'].includes(run.status),
	);
	const can = (action: RunSummary['allowedActions'][number]) =>
		run?.allowedActions.includes(action) ?? false;

	/** Load the summary; the run as loaded, or null when the call failed. */
	async function refresh(): Promise<RunSummary | null> {
		try {
			const loaded = (
				await api<{ run: RunSummary }>(`/api/director/runs/${encodeURIComponent(runId)}`)
			).run;
			run = loaded;
			loadErr = '';
			return loaded;
		} catch (e) {
			loadErr = describe(e);
			return null;
		}
	}

	async function loadProjectDocs() {
		if (!run?.projectCreated) return;
		const q = projectQuery(run.projectKey, run.clientKey);
		try {
			mockups = await api<MockupsAnswer>(`/api/director/mockups?${q}`);
		} catch {
			mockups = null;
		}
		await loadFonts();
	}

	async function loadFonts() {
		if (!run?.projectCreated) return;
		try {
			fonts = (
				await api<{ requests: FontRequestEntry[] }>(
					`/api/director/fonts?project=${encodeURIComponent(run.projectKey)}`,
				)
			).requests;
			fontsErr = '';
		} catch (e) {
			fontsErr = describe(e);
		}
	}

	// ── The live stream, with polling when it cannot be had ───────────────────
	const KINDS = [
		'run_status',
		'checkpoint_open',
		'checkpoint_resolved',
		'owner_request',
		'owner_message',
		'activity',
		'region_status',
		'job_queued',
		'job_done',
		'spend',
		'error',
	];
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	const scheduleRefresh = () => {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			void refresh();
		}, 250);
	};

	/**
	 * The stream re-sends the run's last rows on open and on every reconnect (`eventStream.ts`
	 * `LOOKBACK`), so a row counts once by id, and only a row newer than the summary this page
	 * opened with is news: an old refusal is history, not the answer to a button pressed here.
	 */
	const SEEN_IDS = 64;
	let seenIds: number[] = [];
	let baselineEventId = 0;
	/** The newest row id seen, where a poll's read of the stream picks up. */
	let highWater = 0;

	function onEvent(raw: MessageEvent<string>) {
		try {
			handleEvent(JSON.parse(raw.data) as RunEvent);
		} catch {
			// Not a row: the stream only sends what `frameEvent` wrote, so this is noise.
		}
	}

	function handleEvent(event: RunEvent) {
		if (typeof event.id !== 'number') return;
		if (event.id > highWater) highWater = event.id;
		if (seenIds.includes(event.id)) return;
		seenIds.push(event.id);
		if (seenIds.length > SEEN_IDS) seenIds.shift();
		if (event.id <= baselineEventId) return;
		recent = [event, ...recent].slice(0, 8);
		if (event.kind === 'error' && event.payload?.type === 'refused_request') {
			refusals = [...refusals, String(event.payload.error ?? 'The request was refused.')];
		}
		if (event.kind === 'checkpoint_resolved' || event.kind === 'run_status') void loadFonts();
		scheduleRefresh();
	}

	const eventsUrl = (id: string, after: number) =>
		`${resolve('/(app)/director/[runId]/events', { runId: id })}?after=${after}`;
	const POLL_READ_MS = 1500;

	/**
	 * A poll's read of the stream, for the rows — a `refused_request` above all — that polling the
	 * summary alone would miss: the same endpoint, fetched with `after=` the newest id seen and
	 * read for {@link POLL_READ_MS}, which is long enough for its catch-up frames and then cut.
	 * Where the stream cannot be had at all this yields nothing, which is no worse than before.
	 */
	async function pollEvents(id: string) {
		const control = new AbortController();
		const deadline = setTimeout(() => control.abort(), POLL_READ_MS);
		try {
			const res = await fetch(eventsUrl(id, highWater), {
				signal: control.signal,
				headers: { accept: 'text/event-stream' },
				credentials: 'same-origin',
			});
			if (!res.ok || !res.body) return;
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let at = buffer.indexOf('\n\n');
				while (at >= 0) {
					handleFrame(buffer.slice(0, at));
					buffer = buffer.slice(at + 2);
					at = buffer.indexOf('\n\n');
				}
			}
		} catch {
			// The read's deadline, or no stream to read: the next poll tries again.
		} finally {
			clearTimeout(deadline);
		}
	}

	function handleFrame(frame: string) {
		const data = frame
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim())
			.join('\n');
		if (!data) return;
		try {
			handleEvent(JSON.parse(data) as RunEvent);
		} catch {
			// Not a row.
		}
	}

	/**
	 * One subscription per run id: opening another run from this page tears the first down and
	 * starts afresh, so no row of one run reaches the other. The stream opens after the summary
	 * (its `lastEventId` is where the stream picks up); a closed stream — a 404, a proxy that will
	 * not stream — is final for `EventSource`, so the page polls the summary and the fonts every
	 * 5 s and tries the stream again on each poll. Nothing is opened once the page is gone.
	 */
	$effect(() => {
		const id = runId;
		let source: EventSource | null = null;
		let poll: ReturnType<typeof setInterval> | null = null;
		let disposed = false;

		run = null;
		loadErr = '';
		mockups = null;
		fonts = [];
		fontsErr = '';
		recent = [];
		refusals = [];
		streaming = false;
		polling = false;
		seenIds = [];
		baselineEventId = 0;
		highWater = 0;
		note = '';
		capRaise = null;
		notice = '';
		actionErr = '';
		recorded = '';
		for (const key of Object.keys(pending)) delete pending[key];
		outstanding = {};
		selectedImage = '';

		// What the New-game screen left for this run: a start it could not record, or a create that
		// was replayed as first sent.
		for (const kind of ['start-refusal', 'note'] as const) {
			const key = `director:${kind}:${id}`;
			const text = sessionStorage.getItem(key);
			if (!text) continue;
			sessionStorage.removeItem(key);
			if (kind === 'start-refusal') actionErr = text;
			else notice = text;
		}

		const openStream = () => {
			if (disposed || (source && source.readyState !== EventSource.CLOSED)) return;
			source = new EventSource(eventsUrl(id, highWater));
			for (const kind of KINDS) source.addEventListener(kind, onEvent as EventListener);
			source.onopen = () => {
				streaming = true;
				if (poll) clearInterval(poll);
				poll = null;
				polling = false;
				// Catch up on anything that landed while the stream was down.
				scheduleRefresh();
			};
			source.onerror = () => {
				streaming = false;
				// EventSource retries a dropped connection itself; a closed one is final.
				if (source?.readyState === EventSource.CLOSED) startPolling();
			};
		};
		const startPolling = () => {
			if (poll || disposed) return;
			polling = true;
			poll = setInterval(() => {
				void refresh();
				void loadFonts();
				void pollEvents(id);
				openStream();
			}, 5_000);
		};
		const tick = setInterval(() => (now = Date.now()), 30_000);

		void (async () => {
			const loaded = await refresh();
			await loadProjectDocs();
			if (disposed) return;
			if (!loaded) return startPolling();
			baselineEventId = loaded.lastEventId;
			highWater = loaded.lastEventId;
			openStream();
		})();

		return () => {
			disposed = true;
			source?.close();
			if (poll) clearInterval(poll);
			if (refreshTimer) clearTimeout(refreshTimer);
			refreshTimer = null;
			clearInterval(tick);
		};
	});

	// ── Owner actions, each with its own request id kept across retries ───────
	/**
	 * One request per intent until it is answered: the id AND the body as first sent, because the
	 * server replays an id to the answer it recorded and refuses the same id with another body.
	 * The note and the cap lock while their request is outstanding, so nothing edited is left
	 * behind. The request is kept only while its answer may still be recorded — a lost
	 * connection, `in_progress`, a 5xx; a refusal that recorded nothing (a 4xx, the reused id
	 * included) drops it, so the next press sends the inputs as they are then.
	 */
	const pending: Record<string, { requestId: string; body: Record<string, unknown> }> = {};
	/** The intents with a request outstanding, for the inputs that lock meanwhile. */
	let outstanding = $state<Record<string, true>>({});
	let acting = $state('');
	let actionErr = $state('');
	let recorded = $state('');
	let notice = $state('');

	async function act(
		intent: string,
		body: Record<string, unknown>,
		done = 'Recorded. The agents pick it up now.',
	) {
		const sent = (pending[intent] ??= { requestId: newRequestId(), body });
		outstanding = { ...outstanding, [intent]: true };
		const asFirstSent = JSON.stringify(sent.body) !== JSON.stringify(body);
		acting = intent;
		actionErr = '';
		recorded = '';
		const settle = () => {
			delete pending[intent];
			const { [intent]: _done, ...rest } = outstanding;
			outstanding = rest;
		};
		try {
			const answer = await resend<ActionAnswer>(
				`/api/director/runs/${encodeURIComponent(runId)}/actions`,
				{ ...sent.body, requestId: sent.requestId },
			);
			run = answer.run;
			refusals = [];
			recorded = asFirstSent ? `${done} The earlier request was resent as first written.` : done;
			settle();
		} catch (e) {
			if (e instanceof NetworkLost) {
				actionErr = `${e.message} Press the button again: the same request is resent, never a second one.`;
			} else if (isRefusal(e, 'in_progress')) {
				actionErr = 'This request is still being written. Try again in a moment.';
			} else {
				if (!(e instanceof ApiRefusal && e.status >= 500)) settle();
				if (isRefusal(e, 'request_id_reused')) scheduleRefresh();
				actionErr = describe(e);
			}
		} finally {
			acting = '';
		}
	}

	let note = $state('');
	/** The cap a resume raises to; null while the number field is empty. */
	let capRaise = $state<number | null>(null);
	const approveIntent = $derived(`approve:${run?.checkpoint?.id ?? 0}`);
	const reviseIntent = $derived(`revise:${run?.checkpoint?.id ?? 0}`);
	const noteLocked = $derived(Boolean(outstanding[approveIntent] || outstanding[reviseIntent]));

	const approve = () =>
		act(
			approveIntent,
			{
				action: 'approve',
				checkpoint: run?.waitingOn,
				...(note.trim() ? { note: note.trim() } : {}),
			},
			'Recorded. Rendering starts as soon as the agents pick it up.',
		);
	const revise = () =>
		act(
			reviseIntent,
			{ action: 'revise', checkpoint: run?.waitingOn, note: note.trim() },
			'Recorded. The Mockup analyst reads your note and looks again.',
		);
	const start = () => act('start', { action: 'start' }, 'Recorded. The agents are starting.');
	const pause = () =>
		act('pause', { action: 'pause' }, 'Recorded. The run pauses after its current call.');
	const resume = () =>
		act(
			'resume',
			{
				action: 'resume',
				...(capRaise !== null && Number.isFinite(capRaise) ? { budgetCapUsd: capRaise } : {}),
			},
			'Recorded. The run resumes.',
		);

	async function stop() {
		const ok = await askConfirm({
			title: 'Stop this run?',
			message:
				'The agents stop after their current call and every queued render is cancelled. The project stays as it is.',
			confirmLabel: 'Stop the run',
			danger: true,
		});
		if (ok) await act('stop', { action: 'stop' }, 'Recorded. The run is stopping.');
	}

	// ── The breakdown ─────────────────────────────────────────────────────────
	let selectedImage = $state('');
	const images = $derived(breakdown?.images ?? []);
	const image = $derived<BreakdownImage | null>(
		images.find((i) => i.id === selectedImage) ??
			images.find((i) => !i.styleOnly) ??
			images[0] ??
			null,
	);
	const allElements = $derived(
		images.flatMap((i) => i.elements.map((e) => ({ image: i, element: e }))),
	);
	const leftOut = $derived(allElements.filter((x) => x.element.status === 'left_out'));
	const needsYou = $derived(allElements.filter((x) => x.element.status === 'needs_you'));
	/** One crop per region: `save_crops` keys them by region, so a repeat is the same object. */
	const crops = $derived(
		(breakdown?.crops?.saved ?? []).filter(
			(c, i, all) => all.findIndex((o) => o.region === c.region) === i,
		),
	);
	const elementTitle = (el: CodedElement) =>
		el.status === 'matched' && el.regions.length
			? `→ ${el.regions.join(', ')}`
			: el.status === 'left_out'
				? `→ Not in the template's math${el.lockedItem ? ` (${el.lockedItem.label})` : ''}`
				: '→ No region for this in the template';
	const statusWord = { matched: 'Matched', needs_you: 'Needs you', left_out: 'Left out' } as const;
	const found = (img: BreakdownImage) =>
		img.styleOnly ? 'Style reference' : `${img.tag} · ${img.elements.length} found`;

	// ── Font requests ─────────────────────────────────────────────────────────
	let markingFont = $state('');
	let fontMarkErr = $state('');
	async function markFontDone(entry: FontRequestEntry) {
		if (!run) return;
		markingFont = entry.folder;
		fontMarkErr = '';
		try {
			await api(`/api/director/fonts?project=${encodeURIComponent(run.projectKey)}`, {
				json: { action: 'done', folder: entry.folder, baseEtag: entry.baseEtag },
			});
			await loadFonts();
		} catch (e) {
			fontMarkErr = `${entry.folder}: ${describe(e)}`;
		} finally {
			markingFont = '';
		}
	}

	const stepSubtitle = (id: RunSummary['step']): string => {
		if (!run) return '';
		const n = stepNumber(id);
		if (n < stepN) return 'Done';
		if (n > stepN) {
			switch (id) {
				case 'style_pack':
					return mockupCount ? 'From your mockups' : 'From your notes';
				case 'regions':
					return breakdown
						? `${breakdown.regionsTotal} regions in the template`
						: 'Variants to review';
				case 'build':
					return 'Scene Editor, Symbols SM, Win Text';
				default:
					return 'You publish it in Game Maker';
			}
		}
		switch (run.status) {
			case 'waiting':
				return 'Waiting for you';
			case 'running':
				return 'In progress';
			case 'paused':
				return 'Paused';
			case 'draft':
				return 'Not started';
			default:
				return statusLabel(run);
		}
	};
</script>

<svelte:head><title>{run?.name ?? 'Run'} — Invisible Director</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="director"
		tools={data.tools}
		clientKey={run?.clientKey ?? undefined}
		projectKey={run?.projectKey}
	/>

	<main class="body">
		{#if loadErr && !run}
			<p class="err">{loadErr}</p>
		{:else if !run}
			<p class="muted">Loading the run…</p>
		{:else}
			<section class="card head" aria-label="Run">
				<div class="head-text">
					<div class="title-row">
						<h1>{run.name ?? run.projectKey}</h1>
						<span class="mono small">{run.projectKey}</span>
						<span class="pill {run.status}">{statusLabel(run)}</span>
					</div>
					<span class="sub">
						{run.clientKey ?? 'unassigned'} · from {run.templateProjectKey} ·
						{mockupCount} mockup{mockupCount === 1 ? '' : 's'}{#if styleCount}, {styleCount} style reference{styleCount ===
							1
								? ''
								: 's'}{/if}
						{#if startingPoint?.ownershipConfirmed}
							· ownership confirmed by {startingPoint.ownershipConfirmed.by.name}
						{/if}
					</span>
				</div>
				<div class="meters">
					<div class="meter">
						<span class="k">Elapsed</span><span>{elapsed(run.createdAt, now)}</span>
					</div>
					<div class="meter">
						<span class="k">Claude API</span><span>{usd(run.spend.claudeUsd)}</span>
					</div>
					<div class="meter">
						<span class="k">RunPod</span>
						<span>
							{#if run.spend.runpodUsd === 0 && (run.step === 'breakdown' || run.status === 'draft')}
								Idle until you confirm
							{:else}
								{usd(run.spend.runpodUsd)}
							{/if}
						</span>
					</div>
					{#if run.spend.capUsd !== null}
						<div class="meter">
							<span class="k">Cap</span>
							<span>{usd(run.spend.totalUsd)} of {usd(run.spend.capUsd)}</span>
						</div>
					{/if}
					{#if can('pause')}
						<button type="button" disabled={acting !== ''} onclick={pause}>Pause</button>
					{/if}
					{#if can('stop')}
						<button type="button" class="danger" disabled={acting !== ''} onclick={stop}
							>Stop</button
						>
					{/if}
				</div>
			</section>

			<ol class="steps" aria-label="Run steps">
				{#each RUN_STEPS as step (step.id)}
					<li
						class:current={step.n === stepN}
						class:done={step.n < stepN}
						aria-current={step.n === stepN ? 'step' : undefined}
					>
						<span class="n">{step.n}</span>
						<span class="step-text">
							<strong>{step.n} · {step.label}</strong>
							<span>{stepSubtitle(step.id)}</span>
						</span>
					</li>
				{/each}
			</ol>

			{#if waitingOnBreakdown}
				<div class="banner waiting" role="status">
					<span>
						<strong>Waiting for you: check what the agents found in your mockups.</strong>
						Nothing renders until you confirm.
					</span>
				</div>
			{:else if run.status === 'draft'}
				<div class="banner" role="status">
					<span>
						<strong>Not started.</strong>
						{#if run.projectCreated}
							Start the agents when the mockups are ready.
						{:else}
							The project was not created, so this draft cannot start. Create the game again from
							the New game screen.
						{/if}
					</span>
					{#if can('start')}
						<button
							type="button"
							class="primary"
							disabled={acting !== '' || !run.projectCreated}
							onclick={start}
						>
							Start agents
						</button>
					{/if}
				</div>
			{:else if run.status === 'running'}
				<div class="banner" role="status">
					<span>
						<strong>Agents are working on step {stepN}, {RUN_STEPS[stepN - 1].label}.</strong>
						{run.step === 'breakdown'
							? 'The Mockup analyst is reading your mockups.'
							: 'The Live run screen is the next card; this page shows the state.'}
					</span>
				</div>
			{:else if run.status === 'waiting'}
				<div class="banner waiting" role="status">
					<span>
						<strong>Waiting for you at the {run.waitingOn?.replace('_', ' ')} checkpoint.</strong>
						{#if breakdownUnreadable}
							The breakdown the analyst stored could not be read by this page; approve it or send it
							back below.
						{:else}
							The review panel for it is the Live run screen, the next card.
						{/if}
						{#if typeof checkpointPayload?.summary === 'string'}{checkpointPayload.summary}{/if}
					</span>
					<span class="row">
						<button
							type="button"
							class="primary"
							disabled={acting !== '' || !can('approve')}
							onclick={approve}>Approve</button
						>
					</span>
				</div>
			{:else if run.status === 'paused'}
				<div class="banner waiting" role="status">
					<span>
						<strong>Paused.</strong>
						{#if typeof checkpointPayload?.message === 'string'}
							{checkpointPayload.message}
						{:else}
							Resume when you are ready.
						{/if}
					</span>
					{#if can('resume')}
						<span class="row">
							{#if run.checkpoint?.checkpoint === 'budget'}
								<input
									class="cap-input"
									type="number"
									min="1"
									step="1"
									placeholder="New cap, $"
									bind:value={capRaise}
									disabled={Boolean(outstanding.resume)}
									aria-label="Raise the cap to"
								/>
							{/if}
							<button type="button" class="primary" disabled={acting !== ''} onclick={resume}
								>Resume</button
							>
						</span>
					{/if}
				</div>
			{:else if terminal}
				<div class="banner" role="status">
					<span>
						<strong>{statusLabel(run)}.</strong>
						{run.status === 'handed_off'
							? 'The draft is yours: publish it in Invisible Game Maker.'
							: 'Nothing more happens on this run.'}
					</span>
				</div>
			{:else}
				<div class="banner" role="status"><span><strong>{statusLabel(run)}.</strong></span></div>
			{/if}

			{#if refusals.length}
				<div class="banner refused" role="alert">
					<span>
						<strong>The worker refused your last request:</strong>
						{refusals[refusals.length - 1]}
					</span>
				</div>
			{/if}
			{#if actionErr}<p class="err" role="alert">{actionErr}</p>{/if}
			{#if recorded}<p class="ok" role="status">{recorded}</p>{/if}
			{#if notice}<p class="ok" role="status">{notice}</p>{/if}
			{#if loadErr}<p class="err">{loadErr}</p>{/if}
			{#if recent.length || polling}
				{@const last = recent[0]}
				<p class="latest">
					<span class="k">Latest</span>
					{#if last}
						<span class="mono small">{last.agent} · {last.kind}</span>
						{#if typeof last.payload?.message === 'string'}{last.payload.message}{/if}
					{/if}
					{#if polling}
						<span class="muted">· the live stream could not be opened; polling every 5 s</span>
					{:else if !streaming}
						<span class="muted">· reconnecting</span>
					{/if}
				</p>
			{/if}

			{#if breakdown && image}
				<div class="columns">
					<div class="main">
						<nav class="tabs" aria-label="Uploaded images">
							{#each images as img (img.id)}
								<button
									type="button"
									class:on={img.id === image.id}
									aria-pressed={img.id === image.id}
									onclick={() => (selectedImage = img.id)}
								>
									<span class="mono">{img.file}</span>
									<span class="small">{found(img)}</span>
								</button>
							{/each}
						</nav>

						<section class="card" aria-label="{image.file} with what was found">
							<div class="picture" style="aspect-ratio: {image.w} / {image.h}">
								<img
									src={mockupImageUrl(run.projectKey, run.clientKey, image.id)}
									alt={image.tag}
									width={image.w}
									height={image.h}
								/>
								{#each image.elements as el (el.n)}
									<div
										class="box {el.status}"
										style="left:{(el.box.x / image.w) * 100}%;top:{(el.box.y / image.h) *
											100}%;width:{(el.box.w / image.w) * 100}%;height:{(el.box.h / image.h) *
											100}%"
										title="{el.n} · {el.name}"
									>
										<span class="num">{el.n}</span>
									</div>
								{/each}
							</div>
							<p class="muted">
								Numbers match the list. Dashed boxes are what the Mockup analyst found; red means it
								clashes with something locked in the template, amber that it is your call.
							</p>
						</section>

						<section class="card" aria-label="Needs your call">
							<h2>Needs your call</h2>
							{#each leftOut as { element, image: img } (`${img.id}:${element.n}`)}
								<div class="call red">
									<p>
										<strong>{element.n} · {element.name}.</strong>
										{element.reason}
										{#if images.length > 1}<span class="small">({img.file})</span>{/if}
									</p>
								</div>
							{/each}
							{#each needsYou as { element, image: img } (`${img.id}:${element.n}`)}
								<div class="call amber">
									<p>
										<strong>{element.n} · {element.name}.</strong>
										{element.reason}
										{#if images.length > 1}<span class="small">({img.file})</span>{/if}
									</p>
								</div>
							{/each}
							{#each breakdown.fontGaps as gap (`${gap.imageId}:${gap.text}`)}
								<div class="call plain">
									<p>
										<strong>Lettering “{gap.text}”.</strong>
										{gap.styleNote}. No matching font in Font Maker yet. The Builder stages a bake
										for you to approve.
									</p>
								</div>
							{/each}
							{#if leftOut.length === 0 && needsYou.length === 0 && breakdown.fontGaps.length === 0}
								<p class="muted">Nothing: every element matched a template region.</p>
							{/if}
							{#if breakdown.uncoveredRegions.length}
								<p class="muted">
									Not in any mockup: {breakdown.uncoveredRegions.join(', ')}. The agents design
									{breakdown.uncoveredRegions.length === 1
										? 'that region'
										: `those ${breakdown.uncoveredRegions.length} regions`} from your notes and this palette.
								</p>
							{/if}
						</section>

						{#if fonts.length || fontsErr}
							<section class="card" aria-label="Font requests">
								<h2>Fonts to bake</h2>
								<p class="hint">
									Director never adds a font to the game. Bake and save each one in Invisible Font
									Maker, then mark the request done.
								</p>
								{#if fontsErr}<p class="err">{fontsErr}</p>{/if}
								<ul class="fonts">
									{#each fonts as f (f.folder)}
										<li>
											<span class="two-line">
												<strong class="mono">{f.folder}</strong>
												<span class="small">
													{f.face} · {f.preset} · {f.bakeSize} px
													{#if f.requestedBy?.agent}· by {f.requestedBy.agent}{/if}
												</span>
											</span>
											{#if f.status === 'done'}
												<span class="chip feature"
													>Done{#if f.done}
														· {f.done.by.name}{/if}</span
												>
											{:else}
												<span class="row">
													<span class="chip {f.inCatalog ? 'feature' : 'warn'}">
														{f.inCatalog ? 'In the project’s fonts' : 'Awaiting you'}
													</span>
													<a
														href="{resolve('/fonts')}?project={encodeURIComponent(run.projectKey)}"
													>
														Open Font Maker
													</a>
													<button
														type="button"
														disabled={markingFont !== ''}
														onclick={() => markFontDone(f)}
													>
														{markingFont === f.folder ? 'Marking…' : 'Mark done'}
													</button>
												</span>
											{/if}
										</li>
									{/each}
								</ul>
								{#if fontMarkErr}<p class="err">{fontMarkErr}</p>{/if}
							</section>
						{/if}

						{#if crops.length}
							<section class="card" aria-label="Crops per region">
								<h2>Crops per region</h2>
								<p class="hint">
									Cut from your mockups for each matched region: the art director judges every
									variant against them.
								</p>
								<div class="crops">
									{#each crops as crop (crop.region)}
										<figure>
											<img
												src={cropUrl(run.id, crop.region, run.checkpoint?.id ?? 0)}
												alt="Crop for {crop.region}"
												loading="lazy"
											/>
											<figcaption class="mono small">{crop.region}</figcaption>
										</figure>
									{/each}
								</div>
								{#if breakdown.crops?.skipped.length}
									<p class="muted">
										Not cropped: {breakdown.crops.skipped
											.map((s) => `${s.region} (${s.reason})`)
											.join(', ')}.
									</p>
								{/if}
							</section>
						{/if}
					</div>

					<aside class="side">
						<section class="card" aria-label="Found in {image.file}">
							<div class="found-head">
								<h2>Found in <span class="mono">{image.file}</span></h2>
								<span class="chip feature">
									{breakdown.regionsMatched} of {breakdown.regionsTotal} regions matched across all mockups
								</span>
							</div>
							{#if image.styleOnly}
								<p class="muted">
									A style reference: it shapes the palette and mood, never a region.
								</p>
							{/if}
							<ol class="found">
								{#each image.elements as el (el.n)}
									<li>
										<span class="num {el.status}">{el.n}</span>
										<span class="two-line">
											<strong>{el.name}</strong>
											<span class="small">{elementTitle(el)}</span>
										</span>
										<span class="chip {el.status}">{statusWord[el.status]}</span>
									</li>
								{/each}
							</ol>
						</section>

						<section class="card" aria-label="Palette from your mockups">
							<h2>Palette from your mockups</h2>
							{#if breakdown.palette.length}
								<div class="palette">
									{#each breakdown.palette as swatch (swatch.hex)}
										<span class="swatch">
											<span class="color" style="background:{safeHex(swatch.hex)}"></span>
											<span class="small light">{swatch.name}</span>
											<span class="mono small">{swatch.hex}</span>
										</span>
									{/each}
								</div>
							{:else}
								<p class="muted">No palette the images support.</p>
							{/if}
							{#if breakdown.paletteDropped.length}
								<p class="muted">
									Dropped, not in the images: {breakdown.paletteDropped
										.map((d) => `${d.name} ${d.hex}`)
										.join(', ')}.
								</p>
							{/if}
						</section>

						<section class="card" aria-label="Confirm">
							<label class="field">
								Tell the coordinator what to change (needed to send it back)
								<textarea
									rows="2"
									bind:value={note}
									disabled={noteLocked}
									placeholder="e.g. The plaques belong to the bonus screen, not the base game"
								></textarea>
							</label>
							<div class="row">
								<button
									type="button"
									class="primary"
									disabled={acting !== '' || !can('approve')}
									onclick={approve}
								>
									Looks right, start rendering
								</button>
								<button
									type="button"
									disabled={acting !== '' || !can('revise') || !note.trim()}
									onclick={revise}
								>
									Send my changes
								</button>
							</div>
						</section>
					</aside>
				</div>
			{:else if styleBoard}
				<div class="columns">
					<section class="card main" aria-label="Style board">
						<h2>Style board</h2>
						<p class="board">{styleBoard}</p>
					</section>
					<aside class="side">
						<section class="card" aria-label="Confirm">
							<label class="field">
								Tell the coordinator what to change (needed to send it back)
								<textarea rows="2" bind:value={note} disabled={noteLocked}></textarea>
							</label>
							<div class="row">
								<button
									type="button"
									class="primary"
									disabled={acting !== '' || !can('approve')}
									onclick={approve}
								>
									Looks right, start rendering
								</button>
								<button
									type="button"
									disabled={acting !== '' || !can('revise') || !note.trim()}
									onclick={revise}
								>
									Send my changes
								</button>
							</div>
						</section>
					</aside>
				</div>
			{:else if mockups && mockups.doc.images.length}
				<section class="card" aria-label="Mockups">
					<h2>Your mockups</h2>
					<div class="thumbs">
						{#each mockups.doc.images as img (img.id)}
							<figure>
								<img
									src={mockupImageUrl(run.projectKey, run.clientKey, img.id)}
									alt={img.tag}
									width={img.w}
									height={img.h}
								/>
								<figcaption class="small">{img.styleOnly ? 'Style reference' : img.tag}</figcaption>
							</figure>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: #0e0e12;
		color: #e8e8ee;
		font-family: system-ui, sans-serif;
		font-size: 14px;
		line-height: 1.45;
	}
	.body {
		padding: 24px 24px 56px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.card {
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		padding: 16px 18px;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: 0.01em;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 14px;
		font-weight: 700;
	}
	.hint,
	.muted {
		color: #9a9aa6;
		font-size: 12px;
		margin: 0 0 10px;
	}
	.muted {
		margin: 0;
	}
	.err {
		color: #ff8c8c;
		font-size: 13px;
		margin: 0;
	}
	.ok {
		color: #7ee0c0;
		font-size: 13px;
		margin: 0;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
	}
	.small {
		font-size: 11px;
		color: #8a8a96;
	}
	.small.light {
		color: #c9c9d1;
	}
	.k {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	.row {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	/* Header. */
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 20px;
	}
	.head-text {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.sub {
		font-size: 12px;
		color: #9a9aa6;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		border-radius: 6px;
		font-size: 11px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		color: #c9c9d1;
	}
	.pill::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.pill.waiting,
	.pill.paused {
		background: #241d12;
		border-color: #5c4613;
		color: #f5cf7a;
	}
	.pill.running {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}
	.pill.failed,
	.pill.stopped,
	.pill.stopping {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.meters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.meter {
		display: flex;
		flex-direction: column;
		padding: 5px 10px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
	}
	/* Steps. */
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 8px;
	}
	.steps li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 10px;
	}
	.steps li.current {
		border: 2px solid #a67c1a;
		padding: 11px 13px;
	}
	.steps .n {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1.5px solid #3a3a48;
		color: #9a9aa6;
		font-size: 11px;
		font-weight: 700;
		flex-shrink: 0;
	}
	.steps li.current .n {
		border-color: #f5b95c;
		color: #f5b95c;
	}
	.steps li.done .n {
		border-color: #2b8d6f;
		color: #7ee0c0;
	}
	.step-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.step-text strong {
		font-size: 13px;
		color: #c9c9d1;
	}
	.steps li.current strong {
		color: #e8e8ee;
	}
	.step-text span {
		font-size: 12px;
		color: #9a9aa6;
	}
	.steps li.current .step-text span {
		color: #f5cf7a;
	}
	/* Banners. */
	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		background: #14141b;
		border: 1px solid #23232e;
		color: #d8d8df;
		font-size: 14px;
	}
	.banner.waiting {
		background: #2a2210;
		border-color: #a67c1a;
		color: #ffe7b0;
	}
	.banner.refused {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ffd6d6;
	}
	.latest {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		margin: 0;
		font-size: 12px;
		color: #9a9aa6;
	}
	.cap-input {
		width: 120px;
	}
	/* Columns. */
	.columns {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}
	.main {
		flex: 1 1 760px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.side {
		flex: 1 1 460px;
		max-width: 640px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.tabs button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-height: 52px;
		padding: 8px 12px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 10px;
		color: #e8e8ee;
		font-size: 12px;
		font-weight: 400;
		text-align: left;
	}
	.tabs button.on {
		background: #17212a;
		border-color: #6ea8ff;
	}
	.tabs button.on .small {
		color: #a9cfe4;
	}
	/* The picture and its boxes. */
	.picture {
		position: relative;
		width: 100%;
		border-radius: 8px;
		overflow: hidden;
		background: #0d0d12;
	}
	.picture img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.box {
		position: absolute;
		border: 2px dashed #f5b95c;
		border-radius: 6px;
		box-sizing: border-box;
		pointer-events: none;
	}
	.box.needs_you {
		border-color: #f5cf7a;
		border-style: dotted;
	}
	.box.left_out {
		border-color: #ff6f61;
	}
	/* Inside the corner: a box that spans the whole image would otherwise lose its badge. */
	.box .num {
		position: absolute;
		top: 2px;
		left: 2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #f5b95c;
		color: #0a1d22;
		font-size: 12px;
		font-weight: 800;
	}
	.box.left_out .num {
		background: #ff9d9d;
	}
	.num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #f5b95c;
		color: #0a1d22;
		font-size: 11px;
		font-weight: 800;
		flex-shrink: 0;
	}
	.num.left_out {
		background: #ff9d9d;
	}
	/* Needs your call. */
	.call {
		padding: 10px 12px;
		border-radius: 8px;
		margin-bottom: 8px;
		border: 1px solid #23232e;
		background: #0d0d12;
	}
	.call p {
		margin: 0;
		font-size: 13px;
		color: #c9c9d1;
	}
	.call.red {
		background: #2a1416;
		border-color: #6b2f33;
	}
	.call.red p {
		color: #ffd6d6;
	}
	.call.red strong {
		color: #ff9d9d;
	}
	.call.amber {
		background: #241d12;
		border-color: #5c4613;
	}
	.call.amber p {
		color: #ffe7b0;
	}
	.call.amber strong {
		color: #f5cf7a;
	}
	/* Found list. */
	.found-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}
	.found-head h2 {
		margin: 0;
		font-size: 16px;
	}
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.found li {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr) auto;
		gap: 10px;
		align-items: start;
		padding: 8px 0;
		border-top: 1px solid #1d1d24;
	}
	.two-line {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.two-line strong {
		font-size: 13px;
		font-weight: 700;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		padding: 1px 7px;
		border-radius: 6px;
		font-size: 11px;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #c9c9d1;
		white-space: nowrap;
	}
	.chip.matched,
	.chip.feature {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}
	.chip.needs_you,
	.chip.warn {
		background: #241d12;
		border-color: #5c4613;
		color: #f5cf7a;
	}
	.chip.left_out {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	/* Palette and crops. */
	.palette {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 8px;
	}
	.swatch {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.color {
		display: block;
		height: 32px;
		border-radius: 6px;
		border: 1px solid #2c2c38;
	}
	.crops {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 8px;
	}
	.crops figure,
	.thumbs figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.crops img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		background: #0d0d12;
		border-radius: 6px;
		border: 1px solid #23232e;
	}
	.thumbs {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.thumbs img {
		width: 210px;
		height: auto;
		border-radius: 6px;
	}
	.fonts {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.fonts li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid #1d1d24;
	}
	.fonts a {
		color: #7ee0c0;
		font-size: 12px;
	}
	.board {
		margin: 0;
		white-space: pre-wrap;
		color: #c9c9d1;
	}
	/* Controls. */
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		color: #b9b9c4;
		margin-bottom: 10px;
	}
	textarea,
	input {
		width: 100%;
		padding: 8px 10px;
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 13px;
		line-height: 1.5;
		resize: vertical;
		box-sizing: border-box;
	}
	textarea:focus,
	input:focus {
		outline: none;
		border-color: #3a8f74;
	}
	button {
		cursor: pointer;
		min-height: 36px;
		padding: 0 14px;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #e8e8ee;
		border-radius: 8px;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
	}
	button:hover:not(:disabled) {
		border-color: #3a3a48;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	button.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	button.primary:hover:not(:disabled) {
		background: #26846a;
	}
	button.danger {
		color: #ff9d9d;
	}
</style>
