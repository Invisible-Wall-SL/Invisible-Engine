<script lang="ts">
	import { resolve } from '$app/paths';
	import { asAuthoringLaunch } from '$lib/gameLaunch';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { askConfirm } from '$lib/dialogs.svelte';
	import {
		ApiRefusal,
		NetworkLost,
		RUN_STEPS,
		agentName,
		api,
		clock,
		cropUrl,
		describe,
		elapsed,
		imageUrl,
		isBreakdown,
		isRecord,
		isRefusal,
		isStartingPoint,
		mockupImageUrl,
		newRequestId,
		projectQuery,
		resend,
		safeGameUrl,
		safeHex,
		safeHref,
		statusLabel,
		stepNumber,
		usd,
		variantUrl,
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
	import {
		STATUS_WORDS,
		areaLabel,
		foldEvents,
		insertEvent,
		isNews,
		isRefusedRequest,
		trimEvents,
		regionTitle,
		stepViews,
		type FeedEntry,
		type RegionView,
		type VariantRef,
	} from '../liveRun';
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

	/**
	 * Every row of the run the stream has delivered, ascending by id — the whole history on open
	 * (the stream is asked from 0), then the live tail. Kept outside Svelte's proxies: thousands of
	 * nested payloads are folded, not edited, so `eventsVersion` is bumped once per burst instead.
	 */
	let events: RunEvent[] = [];
	let eventsVersion = $state(0);
	const MAX_EVENTS = 6000;
	let foldTimer: ReturnType<typeof setTimeout> | null = null;
	const bumpFold = () => {
		if (foldTimer) return;
		foldTimer = setTimeout(() => {
			foldTimer = null;
			eventsVersion++;
		}, 60);
	};
	/** Hoisted so a summary refresh does not re-fold the rows; only the prefix itself would. */
	const r2Prefix = $derived(run?.r2Prefix ?? '');
	const folded = $derived.by(() => {
		void eventsVersion;
		return foldEvents(events, r2Prefix);
	});

	const startingPoint = $derived(isStartingPoint(run?.startingPoint) ? run.startingPoint : null);
	const mockupCount = $derived(startingPoint?.mockups.filter((m) => !m.styleOnly).length ?? 0);
	const styleCount = $derived(startingPoint?.mockups.filter((m) => m.styleOnly).length ?? 0);
	const stepN = $derived(run ? stepNumber(run.step) : 1);
	const steps = $derived(run ? stepViews(run, folded, mockupCount) : []);
	const waitingOnBreakdown = $derived(run?.status === 'waiting' && run.waitingOn === 'breakdown');
	const waitingOnBatch = $derived(run?.status === 'waiting' && run.waitingOn === 'region_batch');
	const waitingOnPublish = $derived(
		run?.status === 'waiting' && run.waitingOn === 'before_publish',
	);
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
	/** What the open checkpoint says, whatever its kind: the words the agents wrote for the owner. */
	const checkpointText = $derived(
		typeof checkpointPayload?.summary === 'string'
			? checkpointPayload.summary
			: typeof checkpointPayload?.message === 'string'
				? checkpointPayload.message
				: '',
	);
	/** A link the checkpoint names (same-origin or GitHub only), when it does. */
	const checkpointLink = $derived(safeHref(checkpointPayload?.url));
	/** A checkpoint this page has no panel for: its text and the two buttons. */
	const waitingOther = $derived(
		run?.status === 'waiting' &&
			((!waitingOnBreakdown && !waitingOnBatch && !waitingOnPublish) ||
				breakdownUnreadable ||
				(waitingOnBreakdown && !breakdown && !styleBoard)),
	);
	const budgetPause = $derived(run?.status === 'paused' && run.checkpoint?.checkpoint === 'budget');
	/** Why the run paused for a person: the worker's own words, from the last error row. */
	const pauseReason = $derived.by(() => {
		if (run?.status !== 'paused') return '';
		if (budgetPause)
			return typeof checkpointPayload?.message === 'string' ? checkpointPayload.message : '';
		for (let i = folded.feed.length - 1; i >= 0; i--) {
			const entry = folded.feed[i];
			if (entry.tone === 'status') break;
			if (entry.tone === 'error' && entry.kind === 'error') return entry.text;
		}
		return '';
	});
	const terminal = $derived(
		run !== null && ['stopped', 'failed', 'handed_off'].includes(run.status),
	);
	const can = (action: RunSummary['allowedActions'][number]) =>
		run?.allowedActions.includes(action) ?? false;
	const capShare = $derived(
		run && run.spend.capUsd ? Math.min(1, run.spend.totalUsd / run.spend.capUsd) : 0,
	);
	/** The GPU the preset prices renders at, as `pricing.json` names it; shown on the RunPod meter. */
	const gpuName = $derived(
		isRecord(run?.preset) &&
			typeof run.preset.gpu === 'string' &&
			/^[A-Za-z0-9 _.-]{1,24}$/.test(run.preset.gpu)
			? run.preset.gpu
			: '',
	);
	const playDraft = $derived.by(() => {
		const url = safeGameUrl(run?.game?.url);
		return url ? asAuthoringLaunch(url) : null;
	});

	/**
	 * Load the summary; the run as loaded, or null when the call failed. Every loader takes the
	 * run id it was asked for and writes nothing once the page has moved to another run: SvelteKit
	 * keeps this component across `/director/A` → `/director/B`, so A's late answer must not land
	 * on B. The first summary also fixes the baseline every later row is judged "news" against.
	 */
	async function refresh(id = runId): Promise<RunSummary | null> {
		try {
			const loaded = (
				await api<{ run: RunSummary }>(`/api/director/runs/${encodeURIComponent(id)}`)
			).run;
			if (id !== runId) return null;
			run = loaded;
			loadErr = '';
			baselineEventId ??= loaded.lastEventId;
			return loaded;
		} catch (e) {
			if (id === runId) loadErr = describe(e);
			return null;
		}
	}

	async function loadProjectDocs(id = runId) {
		if (!run?.projectCreated) return;
		const q = projectQuery(run.projectKey, run.clientKey);
		let doc: MockupsAnswer | null;
		try {
			doc = await api<MockupsAnswer>(`/api/director/mockups?${q}`);
		} catch {
			doc = null;
		}
		if (id !== runId) return;
		mockups = doc;
		await loadFonts(id);
	}

	async function loadFonts(id = runId) {
		if (!run?.projectCreated) return;
		try {
			const { requests } = await api<{ requests: FontRequestEntry[] }>(
				`/api/director/fonts?project=${encodeURIComponent(run.projectKey)}`,
			);
			if (id !== runId) return;
			fonts = requests;
			fontsErr = '';
		} catch (e) {
			if (id === runId) fontsErr = describe(e);
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
	 * `LOOKBACK`), so a row counts once by id (`insertEvent`), and only a row newer than the
	 * summary this page opened with is news: an old refusal is history, not the answer to a button
	 * pressed here.
	 */
	let baselineEventId: number | null = null;
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
		if (!insertEvent(events, event)) return;
		trimEvents(events, MAX_EVENTS);
		bumpFold();
		if (!isNews(baselineEventId, event.id)) return;
		recent = [event, ...recent].slice(0, 8);
		if (isRefusedRequest(event)) {
			const why = event.payload.error;
			refusals = [...refusals, typeof why === 'string' ? why : 'The request was refused.'];
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
	async function pollEvents(id: string, signal: AbortSignal) {
		const control = new AbortController();
		const deadline = setTimeout(() => control.abort(), POLL_READ_MS);
		signal.addEventListener('abort', () => control.abort(), { once: true });
		try {
			if (id !== runId || signal.aborted) return;
			const res = await fetch(eventsUrl(id, events.length ? highWater : 0), {
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
				if (id !== runId) return;
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
	 * starts afresh, so no row of one run reaches the other. The stream opens after the summary and
	 * is asked from 0, so the whole history folds into the rail, the galleries and the feed; the
	 * browser's own reconnect resumes from `Last-Event-ID`. A closed stream — a 404, a proxy that
	 * will not stream — is final for `EventSource`, so the page polls the summary, the fonts and a
	 * short read of the stream every 5 s and tries the stream again on each poll. Nothing is opened
	 * once the page is gone.
	 */
	$effect(() => {
		const id = runId;
		let source: EventSource | null = null;
		let poll: ReturnType<typeof setInterval> | null = null;
		let disposed = false;
		/** Aborts a poll's read of the stream still open when the page leaves this run. */
		const polls = new AbortController();

		run = null;
		loadErr = '';
		mockups = null;
		fonts = [];
		fontsErr = '';
		recent = [];
		refusals = [];
		streaming = false;
		polling = false;
		events = [];
		bumpFold();
		baselineEventId = null;
		highWater = 0;
		note = '';
		message = '';
		capRaise = null;
		notice = '';
		actionErr = '';
		recorded = '';
		for (const key of Object.keys(pending)) delete pending[key];
		outstanding = {};
		selectedImage = '';
		selectedGroup = '';
		selectedRegion = '';
		filter = 'all';
		feedShown = FEED_PAGE;

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
			source = new EventSource(eventsUrl(id, events.length ? highWater : 0));
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
				void refresh(id);
				void loadFonts(id);
				void pollEvents(id, polls.signal);
				openStream();
			}, 5_000);
		};
		const tick = setInterval(() => (now = Date.now()), 30_000);

		void (async () => {
			const loaded = await refresh(id);
			await loadProjectDocs(id);
			if (disposed) return;
			if (!loaded) return startPolling();
			openStream();
		})();

		return () => {
			disposed = true;
			polls.abort();
			source?.close();
			if (poll) clearInterval(poll);
			if (refreshTimer) clearTimeout(refreshTimer);
			refreshTimer = null;
			if (foldTimer) clearTimeout(foldTimer);
			foldTimer = null;
			clearInterval(tick);
		};
	});

	// ── Owner actions, each with its own request id kept across retries ───────
	/**
	 * One request per intent until it is answered: the id AND the body as first sent, because the
	 * server replays an id to the answer it recorded and refuses the same id with another body.
	 * The note, the message and the cap lock while their request is outstanding, so nothing
	 * edited is left behind. The request is kept only while its answer may still be recorded — a
	 * lost connection, `in_progress`, a 5xx; a refusal that recorded nothing (a 4xx, the reused id
	 * included) drops it, so the next press sends the inputs as they are then.
	 */
	const pending: Record<string, { requestId: string; body: Record<string, unknown> }> = {};
	/** The intents with a request outstanding, for the inputs that lock meanwhile. */
	let outstanding = $state<Record<string, true>>({});
	let acting = $state('');
	let actionErr = $state('');
	let recorded = $state('');
	let notice = $state('');

	/** Send the intent; true when the server recorded it. */
	async function act(
		intent: string,
		body: Record<string, unknown>,
		done = 'Recorded. The agents pick it up now.',
	): Promise<boolean> {
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
			return true;
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
			return false;
		} finally {
			acting = '';
		}
	}

	let note = $state('');
	let message = $state('');
	/** The cap a resume raises to; null while the number field is empty. */
	let capRaise = $state<number | null>(null);
	const approveIntent = $derived(`approve:${run?.checkpoint?.id ?? 0}`);
	const reviseIntent = $derived(`revise:${run?.checkpoint?.id ?? 0}`);
	const noteLocked = $derived(Boolean(outstanding[approveIntent] || outstanding[reviseIntent]));

	const approveDone = $derived(
		waitingOnBatch
			? 'Recorded. Approved art goes into the project’s Atlas Maker sheet; the agents move on.'
			: waitingOnPublish
				? 'Recorded. The draft is yours: publish it in Invisible Game Maker.'
				: 'Recorded. Rendering starts as soon as the agents pick it up.',
	);
	const reviseDone = $derived(
		waitingOnBatch
			? 'Recorded. The agents redo this batch with your note.'
			: waitingOnPublish
				? 'Recorded. The Builder goes back to the build with your note.'
				: 'Recorded. The Mockup analyst reads your note and looks again.',
	);
	const approve = () =>
		act(
			approveIntent,
			{
				action: 'approve',
				checkpoint: run?.waitingOn,
				...(note.trim() ? { note: note.trim() } : {}),
			},
			approveDone,
		).then((ok) => {
			if (ok) note = '';
		});
	const revise = () =>
		act(
			reviseIntent,
			{ action: 'revise', checkpoint: run?.waitingOn, note: note.trim() },
			reviseDone,
		).then((ok) => {
			if (ok) note = '';
		});
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
			capRaise !== null
				? 'Recorded. The cap is raised and the run resumes.'
				: 'Recorded. The run resumes.',
		).then((ok) => {
			if (ok) capRaise = null;
		});
	const sendMessage = () =>
		act(
			'message',
			{ action: 'message', text: message.trim() },
			'Sent. The coordinator answers in the activity feed.',
		).then((ok) => {
			if (ok) message = '';
		});

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

	// ── Regions, galleries and the review panel ───────────────────────────────
	type Filter = 'all' | 'to_review' | 'approved' | 'drafting' | 'rejected' | 'failed';
	let selectedGroup = $state('');
	let selectedRegion = $state('');
	let filter = $state<Filter>('all');
	let reviewEl = $state<HTMLElement | null>(null);

	const groups = $derived(folded.groups);
	/** Every region waiting for the owner, in the plan's order. */
	/** Every region waiting for the owner, in the plan's order; a scratch region is not one. */
	const toReview = $derived(
		groups.flatMap((g) => g.regions.filter((r) => r.status === 'to_review' && r.planned)),
	);
	const group = $derived(
		groups.find((g) => g.name === selectedGroup) ??
			groups.find((g) => g.counts.toReview > 0) ??
			groups[0] ??
			null,
	);
	const matchesFilter = (r: RegionView, f: Filter) =>
		f === 'all' ||
		(f === 'drafting' ? r.status === 'drafting' || r.status === 'queued' : r.status === f);
	const shownRegions = $derived(group ? group.regions.filter((r) => matchesFilter(r, filter)) : []);
	/** The region in the detail panel: the one picked, else the first waiting for the owner. */
	const region = $derived(
		folded.regions.get(selectedRegion) ?? (waitingOnBatch ? (toReview[0] ?? null) : null),
	);
	const reviewIndex = $derived(region ? toReview.findIndex((r) => r.name === region.name) : -1);
	const pickOf = (r: RegionView): VariantRef | null =>
		(r.pick?.variant ? r.variants.find((v) => v.id === r.pick?.variant) : undefined) ?? null;
	const letter = (index: number) => String.fromCharCode(65 + Math.min(index, 25));

	/** What a tile shows: the art director's pick, else the first variant, else the mockup crop. */
	function tileSrc(r: RegionView): string | null {
		const shown = pickOf(r) ?? r.variants[0];
		if (shown) return variantUrl(runId, shown, 'thumb', r.renderVersion);
		if (r.cropKey) return imageUrl(runId, r.cropKey, r.version);
		return null;
	}
	function showRegion(r: RegionView) {
		selectedRegion = r.name;
		selectedGroup = r.group;
	}
	function reviewNow() {
		const first = toReview[0];
		if (first) showRegion(first);
		reviewEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	function stepReview(delta: number) {
		if (!toReview.length) return;
		const next = toReview[(reviewIndex + delta + toReview.length) % toReview.length];
		showRegion(next);
	}
	const groupCount = (g: (typeof groups)[number]) =>
		g.counts.total === g.counts.approved
			? `${g.counts.approved} of ${g.counts.total} · done`
			: g.counts.toReview
				? `${g.counts.approved} of ${g.counts.total} · ${g.counts.toReview} to review`
				: g.counts.rejected
					? `${g.counts.approved} of ${g.counts.total} · ${g.counts.rejected} to redo`
					: g.counts.drafting
						? `${g.counts.approved} of ${g.counts.total} · drafting`
						: g.counts.failed
							? `${g.counts.approved} of ${g.counts.total} · ${g.counts.failed} failed`
							: `${g.counts.approved} of ${g.counts.total} · queued`;

	/** The images the events named, newest first, by the subtree they landed in. */
	const imageAreas = $derived.by(() => {
		const areas: { area: string; images: typeof folded.images }[] = [];
		for (const img of folded.images) {
			// A region's crop is shown on its tile and in its review; the gallery holds the rest.
			if (img.area === 'director') continue;
			const found = areas.find((a) => a.area === img.area);
			if (found) found.images.push(img);
			else areas.push({ area: img.area, images: [img] });
		}
		return areas.map((a) => ({ area: a.area, images: a.images.slice(0, 60) }));
	});

	// ── The lightbox ──────────────────────────────────────────────────────────
	let lightbox = $state<HTMLDialogElement | null>(null);
	let lightboxSrc = $state('');
	let lightboxCaption = $state('');
	function openImage(src: string, caption: string) {
		lightboxSrc = src;
		lightboxCaption = caption;
		lightbox?.showModal();
	}

	// ── The activity feed ─────────────────────────────────────────────────────
	const FEED_PAGE = 150;
	let feedShown = $state(FEED_PAGE);
	let hideCosts = $state(false);
	const feedAll = $derived(hideCosts ? folded.feed.filter((f) => f.tone !== 'spend') : folded.feed);
	/** Newest first, capped: a long run is paged in, never rendered whole. */
	const feed = $derived(feedAll.slice(-feedShown).reverse());
	const feedHidden = $derived(Math.max(0, feedAll.length - feed.length));
	const stepLabel = (id: FeedEntry['step']) => RUN_STEPS.find((s) => s.id === id)?.label ?? id;
	const lastActivity = $derived(
		[...folded.feed].reverse().find((f) => f.tone === 'plain' || f.tone === 'job') ?? null,
	);

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
</script>

<svelte:head><title>{run?.name ?? 'Run'} — Invisible Director</title></svelte:head>

{#snippet fontsCard()}
	{#if fonts.length || fontsErr}
		<section class="card" aria-label="Font requests">
			<h2>Fonts to bake</h2>
			<p class="hint">
				Director never adds a font to the game. Bake and save each one in Invisible Font Maker, then
				mark the request done.
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
								<a href="{resolve('/fonts')}?project={encodeURIComponent(run?.projectKey ?? '')}">
									Open Font Maker
								</a>
								<button type="button" disabled={markingFont !== ''} onclick={() => markFontDone(f)}>
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
{/snippet}

{#snippet confirmButtons(approveLabel: string, reviseLabel: string)}
	<div class="row">
		<button
			type="button"
			class="primary"
			disabled={acting !== '' || !can('approve')}
			onclick={approve}
		>
			{approveLabel}
		</button>
		<button
			type="button"
			disabled={acting !== '' || !can('revise') || !note.trim()}
			onclick={revise}
		>
			{reviseLabel}
		</button>
	</div>
{/snippet}

{#snippet regionDetail(r: RegionView, reviewing: boolean)}
	{@const pick = pickOf(r)}
	<section class="card review" aria-label="Region {r.name}" bind:this={reviewEl}>
		<div class="review-head">
			<div>
				{#if reviewing && reviewIndex >= 0}
					<span class="k amber">To review · {reviewIndex + 1} of {toReview.length}</span>
				{:else}
					<span class="k">{STATUS_WORDS[r.status]}{r.atlas ? ` · ${r.atlas}` : ''}</span>
				{/if}
				<h2 class="review-title">{regionTitle(r.name)}</h2>
			</div>
			{#if reviewing && toReview.length > 1}
				<span class="row">
					<button
						type="button"
						class="icon"
						aria-label="Previous region"
						onclick={() => stepReview(-1)}>‹</button
					>
					<button type="button" class="icon" aria-label="Next region" onclick={() => stepReview(1)}
						>›</button
					>
				</span>
			{/if}
		</div>
		<div class="variants">
			{#if r.cropKey}
				{@const src = imageUrl(runId, r.cropKey, r.version)}
				<figure class="variant mockup">
					<button
						type="button"
						class="frame"
						onclick={() => openImage(src, `Your mockup · ${regionTitle(r.name)}`)}
					>
						<img {src} alt="Your mockup, cropped to {regionTitle(r.name)}" loading="lazy" />
					</button>
					<figcaption><strong>Your mockup</strong></figcaption>
				</figure>
			{/if}
			{#each r.variants as v, i (v.id)}
				{@const src = variantUrl(runId, v, 'thumb', r.renderVersion)}
				<figure class="variant" class:picked={pick?.id === v.id}>
					<button
						type="button"
						class="frame"
						onclick={() =>
							openImage(
								variantUrl(runId, v, 'full', r.renderVersion),
								`Variant ${letter(i)} · ${regionTitle(r.name)}`,
							)}
					>
						<img {src} alt="Variant {letter(i)} of {regionTitle(r.name)}" loading="lazy" />
					</button>
					<figcaption>
						<strong>Variant {letter(i)}</strong>
						{#if pick?.id === v.id}<span class="chip feature">Art director's pick</span>{/if}
					</figcaption>
				</figure>
			{:else}
				{#if !r.cropKey}
					<p class="muted">
						{r.status === 'failed'
							? (r.error ?? 'The render failed.')
							: terminal
								? 'The run ended before this rendered.'
								: r.status === 'drafting'
									? 'Rendering on RunPod now.'
									: 'Nothing rendered yet.'}
					</p>
				{/if}
			{/each}
		</div>
		{#if r.error && r.variants.length}
			<p class="err">{r.error}</p>
		{/if}
		{#if r.pick}
			<p class="verdict">
				<strong>Art director:</strong>
				{r.pick.verdict}{r.pick.note ? ` — ${r.pick.note}` : ''}
			</p>
		{/if}
		{#if r.qa}
			<p class="verdict">
				<strong>QA:</strong>
				{r.qa.verdict}{r.qa.note ? ` — ${r.qa.note}` : ''}
			</p>
		{/if}
		{#if reviewing}
			<label class="field">
				Your note (optional for approving, needed to redo)
				<textarea
					rows="2"
					bind:value={note}
					disabled={noteLocked}
					placeholder="e.g. Make the eyes glow brighter and use less pink in the coral."
				></textarea>
			</label>
			<div class="row between">
				{@render confirmButtons(
					`Approve ${toReview.length === 1 ? 'this region' : `these ${toReview.length} regions`}`,
					'Redo with my note',
				)}
				<span class="small">Approved art goes into this project's Atlas Maker sheet.</span>
			</div>
		{/if}
	</section>
{/snippet}

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
						{#if run.projectCreated}
							· <a href="{resolve('/game-maker')}?project={encodeURIComponent(run.projectKey)}"
								>Open in Game Maker ↗</a
							>
						{/if}
						{#if playDraft}
							· <a href={playDraft} target="_blank" rel="external noopener noreferrer"
								>Play draft ↗</a
							>
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
						<span class="k">RunPod{gpuName ? ` ${gpuName}` : ''}</span>
						<span>
							{#if run.spend.runpodUsd === 0 && folded.gpuQueued === 0 && (run.step === 'breakdown' || run.status === 'draft')}
								Idle until you confirm
							{:else}
								{usd(run.spend.runpodUsd)}{#if folded.gpuQueued}
									· {folded.gpuQueued} job{folded.gpuQueued === 1 ? '' : 's'} queued{/if}
							{/if}
						</span>
					</div>
					{#if run.spend.capUsd !== null}
						<div class="meter" class:over={capShare >= 1}>
							<span class="k">Cap</span>
							<span>{usd(run.spend.totalUsd)} of {usd(run.spend.capUsd)}</span>
							<span class="bar" aria-hidden="true"
								><span style="width:{capShare * 100}%"></span></span
							>
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
				{#each steps as step (step.id)}
					<li
						class={step.state}
						class:current={step.n === stepN && !terminal}
						aria-current={step.n === stepN ? 'step' : undefined}
					>
						<span class="n">{step.state === 'done' ? '✓' : step.n}</span>
						<span class="step-text">
							<strong>{step.n} · {step.label}</strong>
							<span>{step.detail}</span>
							{#if step.progress !== null && step.n === stepN}
								<span class="bar" aria-hidden="true"
									><span style="width:{step.progress * 100}%"></span></span
								>
							{/if}
						</span>
					</li>
				{/each}
			</ol>

			{#if waitingOnBreakdown && !waitingOther}
				<div class="banner waiting" role="status">
					<span>
						<strong>Waiting for you: check what the agents found in your mockups.</strong>
						Nothing renders until you confirm.
					</span>
				</div>
			{:else if waitingOnBatch}
				<div class="banner waiting" role="status">
					<span>
						<strong>
							Waiting for you: {toReview.length
								? `${toReview.length} region${toReview.length === 1 ? ' is' : 's are'} ready to review.`
								: 'a region batch is ready to review.'}
						</strong>
						The agents keep working on the rest.
					</span>
					<button type="button" class="amber" onclick={reviewNow}>
						Review {toReview.length || ''} now
					</button>
				</div>
			{:else if waitingOnPublish}
				<div class="banner waiting" role="status">
					<span>
						<strong>Waiting for you: the draft is built.</strong>
						Play it, then approve to hand it off — you publish it in Game Maker.
					</span>
					<button
						type="button"
						class="amber"
						onclick={() => reviewEl?.scrollIntoView({ behavior: 'smooth' })}
					>
						Review the build
					</button>
				</div>
			{:else if run.status === 'waiting'}
				<div class="banner waiting" role="status">
					<span>
						<strong>Waiting for you at the {run.waitingOn?.replace('_', ' ')} checkpoint.</strong>
						{#if breakdownUnreadable}
							The breakdown the analyst stored could not be read by this page; approve it or send it
							back below.
						{/if}
					</span>
					<button
						type="button"
						class="amber"
						onclick={() => reviewEl?.scrollIntoView({ behavior: 'smooth' })}
					>
						Review now
					</button>
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
						{#if run.step === 'breakdown'}
							The Mockup analyst is reading your mockups.
						{:else if folded.gpuQueued}
							{folded.gpuQueued} render{folded.gpuQueued === 1 ? '' : 's'} queued on RunPod.
						{:else if lastActivity}
							{agentName(lastActivity.agent)} {lastActivity.text}
						{/if}
					</span>
				</div>
			{:else if budgetPause}
				<div class="banner waiting" role="status">
					<span>
						<strong
							>Paused at the budget cap: {usd(run.spend.totalUsd)} of {usd(run.spend.capUsd ?? 0)} spent.</strong
						>
						{pauseReason || 'Raise the cap and resume, or stop the run.'}
					</span>
					{#if can('resume')}
						<span class="row">
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
							<button
								type="button"
								class="amber"
								disabled={acting !== '' || capRaise === null}
								onclick={resume}>Raise cap and resume</button
							>
						</span>
					{/if}
				</div>
			{:else if run.status === 'paused'}
				<div class="banner waiting" role="status">
					<span>
						<strong>Paused{pauseReason ? ' for you' : ''}.</strong>
						{pauseReason || 'Resume when you are ready.'}
					</span>
					{#if can('resume')}
						<button type="button" class="primary" disabled={acting !== ''} onclick={resume}
							>Resume</button
						>
					{/if}
				</div>
			{:else if run.status === 'stopping'}
				<div class="banner" role="status">
					<span>
						<strong>Stopping.</strong>
						The agents finish their current call and every queued render is cancelled.
					</span>
				</div>
			{:else if run.status === 'failed'}
				<div class="banner refused" role="status">
					<span>
						<strong>Failed.</strong>
						{[...folded.feed].reverse().find((f) => f.tone === 'error')?.text ??
							'The run cannot go on; nothing more happens on it.'}
					</span>
				</div>
			{:else if run.status === 'stopped'}
				<div class="banner" role="status">
					<span
						><strong>Stopped.</strong> Nothing more happens on this run; the project stays as it is.</span
					>
				</div>
			{:else if run.status === 'handed_off'}
				<div class="banner done" role="status">
					<span>
						<strong>Done: the draft is yours.</strong>
						Publish it in Invisible Game Maker when you are happy with it.
					</span>
					<span class="row">
						{#if playDraft}
							<a class="button" href={playDraft} target="_blank" rel="external noopener noreferrer"
								>Play draft ↗</a
							>
						{/if}
						<a
							class="button primary"
							href="{resolve('/game-maker')}?project={encodeURIComponent(run.projectKey)}"
							>Open in Game Maker ↗</a
						>
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
			{#if polling || (recent.length && (!streaming || waitingOnBreakdown || styleBoard))}
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

						{@render fontsCard()}

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
			{:else}
				<div class="live">
					<div class="live-main">
						{#if groups.length}
							<nav class="group-tabs" aria-label="Region groups">
								{#each groups as g (g.name)}
									<button
										type="button"
										class:on={group?.name === g.name}
										class:attention={g.counts.toReview > 0}
										aria-pressed={group?.name === g.name}
										onclick={() => {
											selectedGroup = g.name;
											filter = 'all';
										}}
									>
										<strong>{g.name}</strong>
										<span class="small">{groupCount(g)}</span>
									</button>
								{/each}
							</nav>
						{/if}

						{#if group}
							<section class="card" aria-label="{group.name} regions">
								<div class="group-head">
									<h2 class="group-title">
										{group.name}
										{#if group.atlas}<span class="chip">Atlas Maker · {group.atlas}</span>{/if}
									</h2>
									<div class="filters" role="group" aria-label="Filter regions">
										<button
											type="button"
											class:on={filter === 'all'}
											onclick={() => (filter = 'all')}
										>
											All · {group.counts.total}
										</button>
										{#if group.counts.toReview}
											<button
												type="button"
												class:on={filter === 'to_review'}
												onclick={() => (filter = 'to_review')}
											>
												To review · {group.counts.toReview}
											</button>
										{/if}
										<button
											type="button"
											class:on={filter === 'approved'}
											onclick={() => (filter = 'approved')}
										>
											Approved · {group.counts.approved}
										</button>
										<button
											type="button"
											class:on={filter === 'drafting'}
											onclick={() => (filter = 'drafting')}
										>
											Drafting · {group.counts.drafting + group.counts.queued}
										</button>
										{#if group.counts.rejected}
											<button
												type="button"
												class:on={filter === 'rejected'}
												onclick={() => (filter = 'rejected')}
											>
												Redo · {group.counts.rejected}
											</button>
										{/if}
										{#if group.counts.failed}
											<button
												type="button"
												class:on={filter === 'failed'}
												onclick={() => (filter = 'failed')}
											>
												Failed · {group.counts.failed}
											</button>
										{/if}
									</div>
								</div>
								<div class="tiles">
									{#each shownRegions as r (r.name)}
										{@const src = tileSrc(r)}
										<button
											type="button"
											class="tile {r.status}"
											class:on={region?.name === r.name}
											aria-pressed={region?.name === r.name}
											onclick={() => showRegion(r)}
											title={r.error ?? r.pick?.note ?? ''}
										>
											<span class="thumb">
												{#if src}
													<img {src} alt="" loading="lazy" />
												{:else}
													<span class="glyph">{regionTitle(r.name).split(' ')[0].slice(0, 4)}</span>
												{/if}
											</span>
											<strong>{regionTitle(r.name)}</strong>
											<span class="chip {r.status}">{STATUS_WORDS[r.status]}</span>
											{#if r.status === 'drafting'}
												<span class="bar thin" aria-hidden="true"><span class="pulse"></span></span>
											{/if}
										</button>
									{:else}
										<p class="muted">No region matches this filter.</p>
									{/each}
								</div>
							</section>
						{/if}

						{#if waitingOnBatch}
							{#if region}
								{@render regionDetail(region, true)}
							{:else}
								<section class="card review" aria-label="Region batch" bind:this={reviewEl}>
									<span class="k amber">To review</span>
									<h2 class="review-title">A region batch</h2>
									{#if checkpointText}<p class="board">{checkpointText}</p>{/if}
									<p class="muted">
										The batch's renders have not reached this page; approve it or send it back on
										the coordinator's word above.
									</p>
									<label class="field">
										Your note (optional for approving, needed to redo)
										<textarea rows="2" bind:value={note} disabled={noteLocked}></textarea>
									</label>
									{@render confirmButtons('Approve the batch', 'Redo with my note')}
								</section>
							{/if}
						{:else if waitingOnPublish}
							<section class="card review" aria-label="Build preview" bind:this={reviewEl}>
								<span class="k amber">Before hand-off</span>
								<h2 class="review-title">The draft is built</h2>
								{#if checkpointText}<p class="board">{checkpointText}</p>{/if}
								<div class="row">
									{#if playDraft}
										<a
											class="button"
											href={playDraft}
											target="_blank"
											rel="external noopener noreferrer">Play draft ↗</a
										>
									{:else}
										<span class="muted"
											>No game URL is recorded for this project yet, so there is nothing to play.</span
										>
									{/if}
									<a
										class="button"
										href="{resolve('/game-maker')}?project={encodeURIComponent(run.projectKey)}"
										>Open in Game Maker ↗</a
									>
									{#if checkpointLink}
										<a
											class="button"
											href={checkpointLink}
											target="_blank"
											rel="external noopener noreferrer">The agents' link ↗</a
										>
									{/if}
								</div>
								<label class="field">
									Your note (optional for approving, needed to send it back)
									<textarea
										rows="2"
										bind:value={note}
										disabled={noteLocked}
										placeholder="e.g. The win banner overlaps the reels on portrait"
									></textarea>
								</label>
								{@render confirmButtons('Approve and hand off', 'Send back with my note')}
								<p class="small">
									Approving ends the run. Director never publishes: you do, in Game Maker.
								</p>
							</section>
						{:else if waitingOther}
							<section class="card review" aria-label="Checkpoint" bind:this={reviewEl}>
								<span class="k amber">Waiting for you</span>
								<h2 class="review-title">
									{(run.checkpoint?.checkpoint ?? run.waitingOn ?? 'checkpoint').replace(/_/g, ' ')}
								</h2>
								{#if checkpointText}<p class="board">{checkpointText}</p>{/if}
								{#if breakdownUnreadable}
									<p class="muted">
										The breakdown the analyst stored could not be read by this page.
									</p>
								{/if}
								{#if checkpointLink}
									<p>
										<a href={checkpointLink} target="_blank" rel="external noopener noreferrer"
											>The agents' link ↗</a
										>
									</p>
								{/if}
								<label class="field">
									Your note (optional for approving, needed to send it back)
									<textarea rows="2" bind:value={note} disabled={noteLocked}></textarea>
								</label>
								{@render confirmButtons('Approve', 'Send back with my note')}
							</section>
						{:else if region}
							{@render regionDetail(region, false)}
						{/if}

						{@render fontsCard()}

						{#each imageAreas as area (area.area)}
							<section class="card" aria-label="{areaLabel(area.area)} as they land">
								<h2>{areaLabel(area.area)}</h2>
								<div class="landed">
									{#each area.images as img (img.key)}
										{@const src = imageUrl(runId, img.key, img.eventId)}
										<figure>
											<button type="button" class="frame" onclick={() => openImage(src, img.label)}>
												<img {src} alt={img.label} loading="lazy" />
											</button>
											<figcaption class="mono small" title={img.key}>{img.label}</figcaption>
										</figure>
									{/each}
								</div>
							</section>
						{/each}

						{#if !groups.length && !imageAreas.length && mockups && mockups.doc.images.length}
							<section class="card" aria-label="Mockups">
								<h2>Your mockups</h2>
								<p class="hint">The galleries fill in as the agents' renders land.</p>
								<div class="thumbs">
									{#each mockups.doc.images as img (img.id)}
										{@const src = mockupImageUrl(run.projectKey, run.clientKey, img.id)}
										<figure>
											<button type="button" class="frame" onclick={() => openImage(src, img.tag)}>
												<img {src} alt={img.tag} width={img.w} height={img.h} />
											</button>
											<figcaption class="small">
												{img.styleOnly ? 'Style reference' : img.tag}
											</figcaption>
										</figure>
									{/each}
								</div>
							</section>
						{/if}
					</div>

					<aside class="live-side">
						<section class="card activity" aria-label="Activity">
							<div class="activity-head">
								<h2>Activity</h2>
								<span class="row">
									<label class="toggle">
										<input type="checkbox" bind:checked={hideCosts} /> hide costs
									</label>
									<span class="pill {streaming ? 'running' : polling ? 'paused' : ''}">
										{streaming ? 'Live' : polling ? 'Polling' : 'Reconnecting'}
									</span>
								</span>
							</div>
							{#if feed.length === 0}
								<p class="muted">Nothing yet. The first rows land when the agents start.</p>
							{/if}
							<ol class="feed">
								{#each feed as entry, i (entry.id)}
									{#if i === 0 || feed[i - 1].step !== entry.step}
										<li class="feed-step"><span class="k">{stepLabel(entry.step)}</span></li>
									{/if}
									<li class="entry {entry.tone}">
										<span class="mono time">{clock(entry.at)}</span>
										<span class="entry-text">
											<span>
												<strong>{agentName(entry.agent)}</strong>
												{entry.text}
											</span>
											{#if entry.tool || entry.cost}
												<span class="row">
													{#if entry.tool}<span class="chip">{entry.tool}</span>{/if}
													{#if entry.cost}<span class="chip spend">{entry.cost}</span>{/if}
												</span>
											{/if}
										</span>
									</li>
								{/each}
							</ol>
							{#if feedHidden}
								<button type="button" class="more" onclick={() => (feedShown += FEED_PAGE)}>
									Show older · {feedHidden} more
								</button>
							{/if}
						</section>

						<section class="card" aria-label="Message the coordinator">
							<h2>Message the coordinator</h2>
							<textarea
								rows="3"
								bind:value={message}
								disabled={Boolean(outstanding.message) || !can('message')}
								placeholder={can('message')
									? 'e.g. Make the wilds gold, not silver'
									: 'The run is not live, so nobody reads a message now.'}
								aria-label="Message to the coordinator"
							></textarea>
							<div class="row between">
								<span class="small">It updates the plan and tells you what changed.</span>
								<button
									type="button"
									class="primary"
									disabled={acting !== '' || !can('message') || !message.trim()}
									onclick={sendMessage}
								>
									Send
								</button>
							</div>
						</section>
					</aside>
				</div>
			{/if}
		{/if}
	</main>
</div>

<dialog
	class="lightbox"
	bind:this={lightbox}
	aria-label={lightboxCaption}
	onclick={() => lightbox?.close()}
>
	{#if lightboxSrc}
		<figure>
			<img src={lightboxSrc} alt={lightboxCaption} />
			<figcaption>{lightboxCaption} · click or press Escape to close</figcaption>
		</figure>
	{/if}
</dialog>

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
	/* The run's links and the cap bar. */
	.sub a {
		color: #7ee0c0;
		text-decoration: none;
	}
	.sub a:hover {
		color: #a8f0d8;
		text-decoration: underline;
	}
	.bar {
		display: block;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: #23232e;
		overflow: hidden;
		margin-top: 6px;
	}
	.bar > span {
		display: block;
		height: 100%;
		background: #2b8d6f;
		transition: width 0.3s ease;
	}
	.bar.thin {
		height: 3px;
		margin-top: 8px;
	}
	.bar .pulse {
		width: 40%;
		background: #6ea8ff;
		animation: pulse 1.6s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		from {
			transform: translateX(-20%);
		}
		to {
			transform: translateX(170%);
		}
	}
	.meter .bar {
		min-width: 120px;
	}
	.meter.over .bar > span {
		background: #d9534f;
	}
	/* Step states. */
	.steps li.running {
		border-color: #2b8d6f;
	}
	.steps li.running .n {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.steps li.running .step-text span {
		color: #9fd9c2;
	}
	.steps li.waiting,
	.steps li.paused {
		border-color: #a67c1a;
	}
	.steps li.failed,
	.steps li.stopped {
		border-color: #6b2f33;
	}
	.steps li.failed .n,
	.steps li.stopped .n {
		border-color: #ff9d9d;
		color: #ff9d9d;
	}
	.steps li.failed .step-text span,
	.steps li.stopped .step-text span {
		color: #ff9d9d;
	}
	.steps li.skipped {
		opacity: 0.6;
	}
	.steps .bar > span {
		background: #7ee0c0;
	}
	.banner.done {
		background: #10241e;
		border-color: #2b8d6f;
		color: #d8f5ea;
	}
	button.amber,
	a.button.amber {
		background: #6e5311;
		border-color: #a67c1a;
		color: #fff2cc;
	}
	button.amber:hover:not(:disabled) {
		background: #8c6a16;
	}
	a.button {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		padding: 0 14px;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #e8e8ee;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
	}
	a.button:hover {
		border-color: #3a3a48;
	}
	a.button.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	/* The live layout: galleries and review on the left, activity and the message box right. */
	.live {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}
	.live-main {
		flex: 1 1 760px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.live-side {
		flex: 1 1 380px;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		position: sticky;
		top: 12px;
	}
	.group-tabs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 8px;
	}
	.group-tabs button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-height: 56px;
		padding: 10px 12px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-weight: 400;
		text-align: left;
	}
	.group-tabs button.attention .small {
		color: #f5cf7a;
	}
	.group-tabs button.on {
		background: #17212a;
		border-color: #6ea8ff;
	}
	.group-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}
	.group-title {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-size: 16px;
	}
	.filters {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.filters button {
		min-height: 28px;
		padding: 0 10px;
		font-size: 11px;
		font-weight: 600;
		border-radius: 999px;
		background: transparent;
	}
	.filters button.on {
		background: #1b1b22;
		border-color: #3a3a48;
		color: #e8e8ee;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		gap: 8px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		min-height: 0;
		padding: 8px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 10px;
		color: #e8e8ee;
		font-weight: 400;
		text-align: left;
	}
	.tile:hover:not(:disabled) {
		border-color: #3a3a48;
	}
	.tile.on {
		border-color: #f5b95c;
		box-shadow: 0 0 0 1px #f5b95c inset;
	}
	.tile.to_review {
		border-color: #5c4613;
	}
	.tile strong {
		font-size: 12px;
		line-height: 1.3;
	}
	.thumb {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 8px;
		overflow: hidden;
		background-color: #15151c;
		background-image:
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%),
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			8px 8px;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.glyph {
		font-size: 22px;
		font-weight: 800;
		color: #3a3a48;
		letter-spacing: 0.04em;
	}
	.chip.to_review {
		background: #241d12;
		border-color: #5c4613;
		color: #f5cf7a;
	}
	.chip.approved {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}
	.chip.drafting,
	.chip.queued {
		background: #15202b;
		border-color: #2b4a66;
		color: #a9cfe4;
	}
	.chip.rejected,
	.chip.failed {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.chip.spend {
		color: #9a9aa6;
	}
	/* The review panel. */
	.review-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}
	.review-title {
		margin: 2px 0 0;
		font-size: 18px;
	}
	.k.amber {
		color: #f5cf7a;
	}
	button.icon {
		min-width: 36px;
		padding: 0;
		font-size: 18px;
		line-height: 1;
	}
	.variants {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 10px;
		margin-bottom: 12px;
	}
	.variant {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px;
		border: 1px solid #23232e;
		border-radius: 10px;
		background: #0d0d12;
	}
	.variant.mockup {
		border-style: dashed;
		border-color: #5c4613;
	}
	.variant.picked {
		border-color: #2b8d6f;
		box-shadow: 0 0 0 1px #2b8d6f inset;
	}
	.variant figcaption {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #c9c9d1;
		padding: 0 2px 2px;
	}
	.frame {
		display: block;
		width: 100%;
		padding: 0;
		min-height: 0;
		border: 0;
		border-radius: 8px;
		overflow: hidden;
		cursor: zoom-in;
		background-color: #15151c;
		background-image:
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%),
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			8px 8px;
	}
	.frame img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
	}
	.verdict {
		margin: 0 0 10px;
		padding: 10px 12px;
		border: 1px solid #23232e;
		border-radius: 8px;
		background: #0d0d12;
		font-size: 13px;
		color: #c9c9d1;
	}
	.row.between {
		display: flex;
		justify-content: space-between;
		width: 100%;
	}
	.landed {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 8px;
	}
	.landed figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.landed figcaption {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The feed. */
	.activity-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}
	.activity-head h2 {
		margin: 0;
		font-size: 16px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: #9a9aa6;
	}
	.toggle input {
		width: auto;
		margin: 0;
	}
	.feed {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		max-height: 70vh;
		overflow-y: auto;
	}
	.feed-step {
		padding: 10px 0 4px;
		border-top: 1px solid #1d1d24;
	}
	.feed-step:first-child {
		padding-top: 0;
		border-top: 0;
	}
	.entry {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		gap: 8px;
		padding: 7px 0;
		border-top: 1px solid #16161c;
		font-size: 13px;
		color: #d8d8df;
	}
	.entry-text {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.entry strong {
		color: #e8e8ee;
	}
	.time {
		font-size: 11px;
		color: #6f6f7c;
		padding-top: 2px;
	}
	.entry.owner {
		background: #121218;
		border-radius: 6px;
		padding: 7px 6px;
	}
	.entry.error {
		color: #ffd6d6;
	}
	.entry.error strong {
		color: #ff9d9d;
	}
	.entry.checkpoint strong {
		color: #f5cf7a;
	}
	.entry.spend,
	.entry.status {
		color: #80808c;
		font-size: 12px;
	}
	.more {
		width: 100%;
		margin-top: 8px;
		min-height: 32px;
		font-size: 12px;
	}
	/* The lightbox. */
	.lightbox {
		max-width: min(96vw, 1400px);
		max-height: 96vh;
		padding: 0;
		border: 1px solid #2c2c38;
		border-radius: 12px;
		background: #0b0b0f;
		color: #e8e8ee;
		cursor: zoom-out;
	}
	.lightbox::backdrop {
		background: rgba(0, 0, 0, 0.75);
	}
	.lightbox figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.lightbox img {
		display: block;
		max-width: 92vw;
		max-height: 84vh;
		object-fit: contain;
		background-color: #15151c;
		background-image:
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%),
			linear-gradient(45deg, #1c1c25 25%, transparent 25%, transparent 75%, #1c1c25 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			8px 8px;
		border-radius: 8px;
	}
	.lightbox figcaption {
		font-size: 12px;
		color: #9a9aa6;
		text-align: center;
	}
</style>
