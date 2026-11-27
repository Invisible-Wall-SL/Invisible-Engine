<script lang="ts">
	import { goto, invalidate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		PERF_INLINE_MAX_BYTES,
		PERF_REPORT_VERSIONS,
		PERF_RETENTION_DAYS,
		PERF_RETENTION_MS,
		PHASE_LABELS,
		phaseSetOf,
		phasesOf,
		PROFILER_READINGS,
		readingThrottled,
		type PerfPhase,
		type PerfPhaseSummary,
		type PerfReportListItem,
		type PhaseSet,
	} from '$lib/profiler';
	import {
		buildDiff,
		buildTransferMb,
		deltaMb,
		mb,
		previousBuild,
		PROFILER_BUILDS,
		readingOnBuild,
		type PerfBuildListItem,
	} from '$lib/profilerBuilds';
	import { BUDGET_DEVICE_CLASSES, evaluateBuild, VERDICT_TEXT } from '$lib/profilerBudgets';
	import {
		fileLabel,
		NET_CLASS_LABELS,
		NET_CLASSES,
		NET_STAGE_LABELS,
		NET_STAGES,
		readNetwork,
		toMb,
		type NetCache,
		type NetFileFact,
		type NetworkFacts,
	} from '$lib/profilerNetwork';
	import ProfilerLabRuns from '$lib/ProfilerLabRuns.svelte';
	import { ManagedList } from '$lib/profilerManage.svelte';
	import {
		browserStackLiveUrl,
		CLOUD_PHONE_GROUPS,
		CLOUD_PHONES,
		cloudPhoneLabel,
		cloudPhoneOfLabel,
		CUSTOM_DEVICE_MAX,
		customCloudPhone,
		osName,
		type CloudOs,
	} from '$lib/profilerCloudPhones';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import BudgetsTab from './BudgetsTab.svelte';
	import CompareTab from './CompareTab.svelte';
	import DevicesTab from './DevicesTab.svelte';
	import FindingsTab from './FindingsTab.svelte';
	import ManageActions from './ManageActions.svelte';
	import ManageStatus from './ManageStatus.svelte';
	import VerdictBadge from './VerdictBadge.svelte';

	let { data }: { data: PageData } = $props();

	// ── Tabs ──
	const TABS = [
		{ id: 'readings', label: 'Readings' },
		{ id: 'devices', label: 'Devices' },
		{ id: 'builds', label: 'Builds' },
		{ id: 'findings', label: 'Findings' },
		{ id: 'compare', label: 'Compare' },
		{ id: 'budgets', label: 'Budgets' },
	] as const;
	const tabCount = (id: TabId): string =>
		id === 'readings'
			? ` (${data.readings.length})`
			: id === 'builds'
				? ` (${data.builds.length})`
				: id === 'findings'
					? ` (${data.findings ? data.findings.filter((f) => !data.filed?.[f.id]?.hidden).length : '?'})`
					: '';
	type TabId = (typeof TABS)[number]['id'];
	let tab = $state<TabId>(untrack(() => data.tab));

	// ── Compare (any two readings; `?a=&b=`) ──
	let compareA = $state<string | null>(untrack(() => page.url.searchParams.get('a')));
	let compareB = $state<string | null>(untrack(() => page.url.searchParams.get('b')));

	function compare(a: string | null, b: string | null): void {
		compareA = a;
		compareB = b;
		showTab('compare');
	}

	function showTab(id: TabId): void {
		tab = id;
		const url = new URL(page.url);
		if (id === 'readings') url.searchParams.delete('tab');
		else url.searchParams.set('tab', id);
		for (const [key, value] of [
			['a', id === 'compare' ? compareA : null],
			['b', id === 'compare' ? compareB : null],
			['build', id === 'builds' ? selectedBuildId : null],
		] as const) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		// The same route with a query: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, {});
	}

	function onTabKeydown(e: KeyboardEvent): void {
		const i = TABS.findIndex((t) => t.id === tab);
		let next: number;
		if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = TABS.length - 1;
		else return;
		e.preventDefault();
		showTab(TABS[next].id);
		document.getElementById(`tab-${TABS[next].id}`)?.focus();
	}

	interface CaptureLinkView {
		id: string;
		label: string;
		url: string;
		/** The same link as a launcher redirect with no `?` or `&`: what is copied and sent to Live. */
		go: string;
		qr: string;
	}
	interface CaptureSessionView {
		/** The project it was opened for: another project in the picker is another session. */
		projectKey: string;
		/** The device label it was opened with: every link's token carries it. */
		label: string;
		sid: string;
		expiresAt: string;
		games: { key: string; name: string; links: CaptureLinkView[] }[];
	}

	const projects = $derived(data.projects ?? []);

	/** Another project's readings: the page loads it as that project (and makes it the active one). */
	function openProject(key: string): void {
		if (!key || key === data.projectKey) return;
		const tabQuery = tab === 'readings' ? '' : `&tab=${tab}`;
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(`${page.url.pathname}?project=${encodeURIComponent(key)}${tabQuery}`);
	}

	async function failure(res: Response): Promise<string> {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		return body?.message ?? `${res.status} ${res.statusText}`;
	}

	// ── New capture ──
	let deviceLabel = $state('');
	let session = $state<CaptureSessionView | null>(null);
	let opening = $state(false);
	let captureError = $state('');
	let copiedUrl = $state('');

	async function openSession(): Promise<void> {
		opening = true;
		captureError = '';
		try {
			const res = await fetch('/api/profiler/sessions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: data.projectKey, label: deviceLabel }),
			});
			if (!res.ok) throw new Error(await failure(res));
			const opened = (await res.json()) as Omit<CaptureSessionView, 'projectKey' | 'label'>;
			session = { ...opened, projectKey: data.projectKey, label: deviceLabel.trim() };
		} catch (e) {
			captureError = e instanceof Error ? e.message : String(e);
		} finally {
			opening = false;
		}
	}

	async function copyLink(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			copiedUrl = url;
		} catch {
			copiedUrl = '';
		}
	}

	const openSessionHere = $derived(
		session && session.projectKey === data.projectKey ? session : null,
	);

	/** The cloud phone picked for the next session: it names the device label. */
	let cloudPhoneId = $state('');
	let customDevice = $state('');
	let customOs = $state<CloudOs>('android');
	let customOsVersion = $state('');
	const customPhone = $derived(customCloudPhone(customDevice, customOs, customOsVersion));
	function pickCloudPhone(id: string): void {
		cloudPhoneId = id;
		const phone = id === 'custom' ? customPhone : CLOUD_PHONES.find((p) => p.id === id);
		if (phone) deviceLabel = cloudPhoneLabel(phone);
		else if (cloudPhoneOfLabel(deviceLabel)) deviceLabel = '';
	}
	/** A typed phone names the label as it is typed. */
	function typeCustomPhone(): void {
		if (cloudPhoneId === 'custom') pickCloudPhone('custom');
	}
	/** The phone the open session's links were signed for: its BrowserStack Live buttons open it. */
	const sessionPhone = $derived(cloudPhoneOfLabel(openSessionHere?.label));

	// While a capture is open, readings arrive from the phone: show them without a reload.
	$effect(() => {
		if (!openSessionHere) return;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void invalidate(PROFILER_READINGS);
		}, 10_000);
		return () => clearInterval(timer);
	});

	// ── Paste ──
	let pasteText = $state('');
	let pasteLabel = $state('');
	let pasteGame = $state('');
	/** The games a pasted reading may name: the published ones and those builds were recorded for. */
	const pasteGames = $derived([
		...new Set([...data.games.map((g) => g.key), ...data.builds.map((b) => b.gameKey)]),
	]);
	let pasting = $state(false);
	let pasteNote = $state('');
	let pasteError = $state('');

	async function sendPaste(): Promise<void> {
		pasting = true;
		pasteNote = '';
		pasteError = '';
		const label = pasteLabel.trim();
		const query =
			`project=${encodeURIComponent(data.projectKey)}` +
			(label ? `&label=${encodeURIComponent(label)}` : '') +
			(pasteGame ? `&game=${encodeURIComponent(pasteGame)}` : '');
		const post = (body: string) =>
			fetch(`/api/profiler/reports?${query}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
			});
		try {
			const text = pasteText.trim();
			let res: Response;
			if (new Blob([text]).size <= PERF_INLINE_MAX_BYTES) {
				res = await post(text);
			} else {
				const presign = await fetch(`/api/profiler/uploads?${query}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{}',
				});
				if (!presign.ok) throw new Error(await failure(presign));
				const up = (await presign.json()) as { id: string; url: string; contentType: string };
				const put = await fetch(up.url, {
					method: 'PUT',
					headers: { 'content-type': up.contentType },
					body: text,
				});
				if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
				res = await post(JSON.stringify({ upload: up.id }));
			}
			if (!res.ok) throw new Error(await failure(res));
			pasteText = '';
			pasteNote = 'Kept.';
			await invalidate(PROFILER_READINGS);
		} catch (e) {
			pasteError = e instanceof Error ? e.message : String(e);
		} finally {
			pasting = false;
		}
	}

	// ── Archive and delete (readings and builds) ──
	const readingList = new ManagedList(
		'reading',
		() => data.projectKey,
		() =>
			data.readings.map((r) => ({
				id: r.id,
				archived: !!r.archivedAt,
				lapsed: !r.keep && Date.now() - Date.parse(r.capturedAt) > PERF_RETENTION_MS,
			})),
		() => invalidate(PROFILER_READINGS),
	);
	const buildList = new ManagedList(
		'build',
		() => data.projectKey,
		() =>
			data.builds.map((b) => ({
				id: b.id,
				archived: !!b.archivedAt,
				// The newest live build of its game and kind is never purged, so it is not lapsed.
				lapsed:
					!b.keep &&
					Date.now() - Date.parse(b.registeredAt) > PERF_RETENTION_MS &&
					data.builds.some(
						(o) =>
							!o.archivedAt &&
							o.id !== b.id &&
							o.gameKey === b.gameKey &&
							o.kind === b.kind &&
							(o.registeredAt > b.registeredAt ||
								(o.registeredAt === b.registeredAt && o.id > b.id)),
					),
			})),
		() => invalidate(PROFILER_BUILDS),
	);

	function showArchived(next: boolean): void {
		const url = new URL(page.url);
		if (next) url.searchParams.set('archived', '1');
		else url.searchParams.delete('archived');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the same page, one query changed
		void goto(url, { keepFocus: true, noScroll: true, replaceState: true });
	}

	/** "Before perf N": the newest probe version, whose readings are the ones to judge fresh. */
	const newestPerf = Math.max(...PERF_REPORT_VERSIONS);
	/** The first reading of that probe on the page: builds from before it are the old ones. */
	const sincePerf = $derived.by(() => {
		const first = data.readings
			.filter((r) => r.perfVersion >= newestPerf)
			.map((r) => r.capturedAt)
			.sort()[0];
		return first ? { label: `Before the first perf ${newestPerf} reading`, iso: first } : null;
	});

	// ── Readings ──
	let keepError = $state('');
	let keeping = $state<string | null>(null);

	async function toggleKeep(r: PerfReportListItem): Promise<void> {
		keeping = r.id;
		keepError = '';
		try {
			const res = await fetch(`/api/profiler/reports/${encodeURIComponent(r.id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ keep: !r.keep }),
			});
			if (!res.ok) throw new Error(await failure(res));
			await invalidate(PROFILER_READINGS);
		} catch (e) {
			keepError = e instanceof Error ? e.message : String(e);
		} finally {
			keeping = null;
		}
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	const fps = (p: PerfPhaseSummary | null) => (p ? `${p.fps}` : '–');
	const p95 = (p: PerfPhaseSummary | null) => (p ? `${p.p95} ms` : '–');
	const hitches = (p: PerfPhaseSummary | null) => (p ? `${p.hitches}` : '–');
	/** A reading's busy time in a phase (`perf: 10`): its p95 against the frame period it ran on. */
	const busyCell = (r: PerfReportListItem, phase: PerfPhase) => {
		const b = r.counts?.timing?.busy[phase];
		return b ? `${b.p95}` : '–';
	};
	const busyTitle = (r: PerfReportListItem, phase: PerfPhase) => {
		const t = r.counts?.timing;
		const b = t?.busy[phase];
		return b
			? `Busy time per frame, p50 ${b.p50} · p95 ${b.p95} · max ${b.max} ms, against a ${t?.budgetMs ?? '?'} ms frame` +
					(t?.displayHz
						? ` (display ${t.displayHz} Hz, frames ran at ${t.achievedHz ?? '?'} Hz)`
						: '')
			: 'This reading has no busy time (a probe older than perf: 10)';
	};
	/** The busy column is shown once any listed reading has busy time. */
	const hasBusy = $derived(data.readings.some((r) => r.counts?.timing));
	const phaseCols = $derived(hasBusy ? 4 : 3);
	const switches = (flags: Record<string, string>) =>
		Object.entries(flags)
			.map(([k, v]) => `${k}=${v}`)
			.join(' ');
	/** The Readings table's phase groups: every phase the listed readings' sets have. */
	const readingPhases = $derived(phasesOf(data.readings));
	const THROTTLED_TITLE =
		'Throttled — not comparable: the page was in the background or throttled for much of this ' +
		'reading, so its frames are the browser’s. It is kept, left out of every verdict and finding.';
	const CAP_TITLE =
		'The browser held this reading to 30 fps (iOS Low Power Mode or a battery saver) while its ' +
		'frames had room for 60: its fps and p95 are not judged against the budgets.';
	const daysLeft = (iso: string | null) =>
		iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null;

	// ── Builds ──
	// `?build=` is how a bug's evidence link opens a build's detail card.
	let selectedBuildId = $state<string | null>(untrack(() => page.url.searchParams.get('build')));

	/** A finding's build evidence: its detail card on the Builds tab. */
	function openBuild(id: string): void {
		selectedBuildId = id;
		showTab('builds');
	}
	let buildKeepError = $state('');
	let buildKeeping = $state<string | null>(null);

	const selectedBuild = $derived(
		data.builds.find((b) => b.id === selectedBuildId) ?? data.builds[0] ?? null,
	);
	const selectedPrevious = $derived(
		selectedBuild ? previousBuild(selectedBuild, data.builds) : null,
	);
	const selectedDiff = $derived(
		selectedBuild && selectedPrevious ? buildDiff(selectedBuild, selectedPrevious) : null,
	);
	const selectedReadings = $derived(
		selectedBuild ? data.readings.filter((r) => readingOnBuild(r, selectedBuild)) : [],
	);
	/** The build detail's reading columns per phase set: each phase's fps, the busy phase's p95. */
	const BUILD_READING_COLUMNS: Record<
		PhaseSet,
		{ phase: PerfPhase; metric: 'fps' | 'p95' | 'busy'; label: string }[]
	> = {
		slot: [
			{ phase: 'idle', metric: 'fps', label: 'Idle fps' },
			{ phase: 'spinning', metric: 'fps', label: 'Spin fps' },
			{ phase: 'spinning', metric: 'p95', label: 'Spin p95' },
			{ phase: 'round', metric: 'fps', label: 'Round fps' },
		],
		arcade: [
			{ phase: 'lobby', metric: 'fps', label: 'Lobby / menu fps' },
			{ phase: 'play', metric: 'fps', label: 'Play fps' },
			{ phase: 'play', metric: 'p95', label: 'Play p95' },
			{ phase: 'play', metric: 'busy', label: 'Play busy' },
		],
	};
	const buildReadingColumns = $derived(
		(['slot', 'arcade'] as const)
			.filter((set) => selectedReadings.some((r) => r.phaseSet === set))
			.flatMap((set) => BUILD_READING_COLUMNS[set]),
	);
	const verdicts = $derived(
		new Map(data.builds.map((b) => [b.id, evaluateBuild(b, data.readings, data.budgets)])),
	);
	const sizeTitle = (b: PerfBuildListItem, metric: 'shippedMb' | 'gpuMb') =>
		(verdicts.get(b.id)?.size ?? [])
			.filter((m) => m.metric === metric && m.verdict !== 'none')
			.map(
				(m) => `${m.deviceClass === 'all' ? 'budget' : m.deviceClass}: ${VERDICT_TEXT[m.verdict]}`,
			)
			.join(' · ') || 'no budget';
	const readingsOn = (b: PerfBuildListItem) =>
		data.readings.filter((r) => readingOnBuild(r, b)).length;
	const transferOn = (b: PerfBuildListItem) => buildTransferMb(b, data.readings);
	const transferDelta = (b: PerfBuildListItem): string => {
		const now = transferOn(b);
		const prev = previousBuild(b, data.builds);
		const before = prev ? transferOn(prev) : null;
		if (now === null) return 'No as-shipped reading on this build says what it downloaded';
		return before === null
			? `${now} MB: the median over the as-shipped readings on this build`
			: `${now} MB against ${before} MB on v${prev?.build} (${deltaMb((now - before) * 1048576)} MB)`;
	};

	// ── A reading's files (`perf: 9` network block, read from its JSON) ──
	let filesOf = $state<PerfReportListItem | null>(null);
	let netFiles = $state<(NetworkFacts & { files?: NetFileFact[] }) | null>(null);
	let filesError = $state('');
	async function showFiles(r: PerfReportListItem): Promise<void> {
		if (filesOf?.id === r.id) {
			filesOf = null;
			return;
		}
		filesOf = r;
		netFiles = null;
		filesError = '';
		try {
			const res = await fetch(resolve('/api/profiler/reports/[id]', { id: r.id }));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const n = readNetwork(await res.json(), 150);
			if (filesOf?.id !== r.id) return;
			if (n) netFiles = n;
			else filesError = 'This reading has no network block.';
		} catch (e) {
			if (filesOf?.id === r.id) {
				filesError = `Could not read this reading (${e instanceof Error ? e.message : String(e)}).`;
			}
		}
	}
	const CACHE_TEXT: Record<NetCache, string> = {
		hit: 'cache',
		revalidated: '304',
		network: 'network',
		unknown: 'size hidden',
	};
	const mb2 = (bytes: number | null) => (bytes === null ? '?' : toMb(bytes).toFixed(2));
	const seconds = (ms: number | null) => (ms === null ? '?' : `${(ms / 1000).toFixed(1)} s`);
	const transferTitle = (r: PerfReportListItem) => {
		const n = r.network;
		if (!n) return '';
		return [
			`${n.files} files, ${n.cachedMb} MB of them from the cache this load`,
			...(n.unknownFiles ? [`${n.unknownFiles} hid their size (cross-origin): not counted`] : []),
			...(n.largest ? [`largest ${n.largest.path} ${n.largest.mb} MB`] : []),
			`${n.beforeFirstFrameMb} MB before the first frame`,
			'click for the files',
		].join(' · ');
	};
	const shippedDelta = (b: PerfBuildListItem) => {
		const prev = previousBuild(b, data.builds);
		return prev ? deltaMb(b.shippedBytes - prev.shippedBytes) : '–';
	};

	/** One colour per category id, so a category reads the same in every row's bar. */
	const CATEGORY_COLORS: Record<string, string> = {
		code: '#4c6ef5',
		art: '#20c997',
		symbols: '#fab005',
		pages: '#e64980',
		coded: '#be4bdb',
		fonts: '#15aabf',
		sounds: '#fd7e14',
		boot: '#82c91e',
		data: '#868e96',
		other: '#495057',
	};
	const categoryColor = (id: string) => CATEGORY_COLORS[id] ?? '#495057';

	async function toggleBuildKeep(b: PerfBuildListItem): Promise<void> {
		buildKeeping = b.id;
		buildKeepError = '';
		try {
			const res = await fetch(`/api/profiler/builds/${encodeURIComponent(b.id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ keep: !b.keep }),
			});
			if (!res.ok) throw new Error(await failure(res));
			await invalidate(PROFILER_BUILDS);
		} catch (e) {
			buildKeepError = e instanceof Error ? e.message : String(e);
		} finally {
			buildKeeping = null;
		}
	}

	const buildKeepTitle = (b: PerfBuildListItem) =>
		b.keep
			? 'Kept — never purged'
			: b.expiresAt
				? `Deleted in ${daysLeft(b.expiresAt)} day(s) unless kept`
				: 'The newest build of its game and kind — never purged while it is';
	const buildKeepText = (b: PerfBuildListItem) =>
		b.keep ? 'kept' : b.expiresAt ? `${daysLeft(b.expiresAt)} d` : 'newest';
</script>

<svelte:head><title>Invisible Profiler — Invisible Wall</title></svelte:head>

<div class="shell">
	<ToolTopBar
		current="profiler"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	/>

	<main class="body">
		<div class="heading">
			<h1>Invisible Profiler</h1>
			<label class="project-pick">
				<span>Project</span>
				<select
					value={data.projectKey}
					onchange={(e) => openProject(e.currentTarget.value)}
					aria-label="Which project's readings"
				>
					{#each projects as p (p.key)}
						<option value={p.key}>{p.clientName ? `${p.clientName} / ${p.name}` : p.name}</option>
					{/each}
				</select>
			</label>
		</div>

		<div
			class="tabs"
			role="tablist"
			aria-label="Invisible Profiler"
			tabindex="-1"
			onkeydown={onTabKeydown}
		>
			{#each TABS as t (t.id)}
				<button
					id={`tab-${t.id}`}
					class="tab"
					class:active={tab === t.id}
					role="tab"
					type="button"
					aria-selected={tab === t.id}
					aria-controls={`panel-${t.id}`}
					tabindex={tab === t.id ? 0 : -1}
					onclick={() => showTab(t.id)}
				>
					{t.label}{tabCount(t.id)}
				</button>
			{/each}
		</div>

		{#if tab === 'readings'}
			<div id="panel-readings" role="tabpanel" aria-labelledby="tab-readings">
				<SectionCard scope="profiler" id="capture" title="New capture">
					{#snippet info()}
						<p>
							Opens the project's published game with the <code>?perf=1</code> probe and a capture session
							for 24 hours. Scan the QR code on a phone (or open the link): every time the tester taps
							Send or Reset, or leaves the page, the reading is sent here. The variants each turn one
							cost off, so a reading beside the plain one shows what that feature costs on the device.
						</p>
					{/snippet}
					{#if !data.games.length}
						<p class="warn">
							This project has no published game yet — publish it from Game Maker first.
						</p>
					{:else}
						<div class="row">
							<label class="field">
								<span>Device label</span>
								<input
									type="text"
									maxlength="80"
									placeholder="e.g. Galaxy A14"
									bind:value={deviceLabel}
								/>
							</label>
							<label class="field">
								<span>Cloud phone</span>
								<select
									value={cloudPhoneId}
									onchange={(e) => pickCloudPhone(e.currentTarget.value)}
									aria-label="BrowserStack Live phone for the next session"
								>
									<option value="">None — my own phone</option>
									{#each CLOUD_PHONE_GROUPS as group (group.brand)}
										<optgroup label={group.brand}>
											{#each group.phones as p (p.id)}
												<option value={p.id}>{p.model} · {osName(p.os)} {p.osVersion}</option>
											{/each}
										</optgroup>
									{/each}
									<option value="custom">Other phone…</option>
								</select>
								<InfoTip>
									A BrowserStack Live phone. Open a session with one picked and each link gets a
									<strong>BrowserStack Live</strong> button that starts that phone on it — sign in
									to BrowserStack in this browser first. The device label names the phone, so its
									readings say which one. On the cloud phone tap <strong>Send</strong>: Copy only
									reaches the cloud phone's own clipboard.
								</InfoTip>
							</label>
							{#if cloudPhoneId === 'custom'}
								<label class="field">
									<span>Live device name</span>
									<input
										type="text"
										maxlength={CUSTOM_DEVICE_MAX}
										placeholder="e.g. Samsung Galaxy A14"
										bind:value={customDevice}
										oninput={typeCustomPhone}
									/>
								</label>
								<label class="field">
									<span>OS</span>
									<select bind:value={customOs} onchange={typeCustomPhone}>
										<option value="android">Android</option>
										<option value="ios">iOS</option>
									</select>
								</label>
								<label class="field">
									<span>OS version</span>
									<input
										type="text"
										maxlength="12"
										placeholder={customOs === 'ios' ? 'e.g. 18' : 'e.g. 15.0'}
										bind:value={customOsVersion}
										oninput={typeCustomPhone}
									/>
									<InfoTip>
										Type the device name and OS version exactly as BrowserStack Live's device list
										shows them — Live only starts a phone whose name matches.
									</InfoTip>
								</label>
							{/if}
							<button type="button" class="primary" disabled={opening} onclick={openSession}>
								{opening ? 'Opening…' : openSessionHere ? 'New session' : 'Open capture'}
							</button>
						</div>
						{#if captureError}<p class="error">{captureError}</p>{/if}
						{#if openSessionHere}
							<p class="muted">
								Session open until {when(openSessionHere.expiresAt)}. New readings appear below as
								they arrive.
							</p>
							{#each openSessionHere.games as game (game.key)}
								<div class="game">
									<h3>{game.name}</h3>
									<div class="links">
										{#each game.links as link (link.id)}
											<figure class="link" class:main={link.id === 'plain'}>
												<!-- Server-rendered by `qrcode` from our own capture URL. -->
												<!-- eslint-disable-next-line svelte/no-at-html-tags -->
												<div class="qr">{@html link.qr}</div>
												<figcaption>
													<strong>{link.label}</strong>
													<span class="actions">
														<!-- The game, on its own origin: not a route of this app. -->
														<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
														<a href={link.url} target="_blank" rel="noopener">Open</a>
														<button
															type="button"
															class="linkish"
															onclick={() => copyLink(link.go)}
															title={link.go}
														>
															{copiedUrl === link.go ? 'Copied' : 'Copy link'}
														</button>
														{#if sessionPhone}
															<!-- BrowserStack's dashboard, in the tester's own signed-in tab. -->
															<!-- eslint-disable svelte/no-navigation-without-resolve -->
															<a
																href={browserStackLiveUrl(sessionPhone, link.go)}
																target="_blank"
																rel="noopener"
																title={`Start ${sessionPhone.device} on BrowserStack Live with this link`}
																>BrowserStack Live</a
															>
															<!-- eslint-enable svelte/no-navigation-without-resolve -->
														{/if}
													</span>
													<code class="go">{link.go}</code>
												</figcaption>
											</figure>
										{/each}
									</div>
								</div>
							{/each}
						{/if}
					{/if}
				</SectionCard>

				<SectionCard scope="profiler" id="paste" title="Paste a reading">
					{#snippet info()}
						<p>
							For a build that cannot send — a delivery on a partner's page: open it with
							<code>?perf=1</code>, tap Copy, and paste the text here. It is kept like a sent
							reading. Pick its Game so it joins that game's builds on the Builds tab.
						</p>
					{/snippet}
					<textarea rows="4" placeholder={'{"perf":7, …}'} bind:value={pasteText}></textarea>
					<div class="row">
						<label class="field">
							<span>Device label</span>
							<input type="text" maxlength="80" bind:value={pasteLabel} />
						</label>
						<label class="field">
							<span>Game</span>
							<select bind:value={pasteGame} aria-label="Which game the reading was taken on">
								<option value="">Not sure</option>
								{#each pasteGames as key (key)}
									<option value={key}>{key}</option>
								{/each}
							</select>
						</label>
						<button
							type="button"
							class="primary"
							disabled={pasting || !pasteText.trim()}
							onclick={sendPaste}
						>
							{pasting ? 'Sending…' : 'Keep reading'}
						</button>
						{#if pasteNote}<span class="ok">{pasteNote}</span>{/if}
					</div>
					{#if pasteError}<p class="error">{pasteError}</p>{/if}
				</SectionCard>

				<ProfilerLabRuns readings={data.readings} />

				<SectionCard scope="profiler" id="readings" title="Readings ({data.readings.length})">
					{#snippet actions()}
						<ManageActions
							list={readingList}
							archivedCount={data.archived.readings}
							showArchived={data.showArchived}
							onShowArchived={(next) => showArchived(next)}
							perf={newestPerf}
						/>
					{/snippet}
					{#snippet info()}
						<p>
							Every reading of this project, newest first: frames per second, the 95th-percentile
							frame time and frames over 33 ms, for the game idling, the reels spinning and a
							round's presentation — or, for an arcade game, its loading, lobby, play and
							spectating, with the busy time of each (the main thread's work in a frame, against the
							display's frame period). A reading marked <em>30 cap</em> ran at a browser's 30 fps
							cap and is not judged; one marked <em>throttled</em> was in the background and is not
							comparable. A reading is deleted
							{PERF_RETENTION_DAYS} days after capture unless Keep is ticked. Tick rows to archive them
							(kept, but out of every list, verdict and finding until Show archived) or delete them (a
							kept reading, or one an open bug cites, is not deleted; it says why); "Archive all before…"
							takes everything older than a day, or taken before perf {newestPerf}. The probe sends
							one reading per measuring window: a later send replaces the earlier ones.
						</p>
					{/snippet}
					{#if keepError}<p class="error">{keepError}</p>{/if}
					<ManageStatus list={readingList} />
					{#if !data.readings.length}
						<p class="muted">No readings yet.</p>
					{:else}
						<div class="table-wrap">
							<table>
								<thead>
									<tr>
										<th rowspan="2">
											<input
												type="checkbox"
												aria-label="Tick every reading"
												checked={readingList.allTicked}
												onchange={() => readingList.toggleAll()}
											/>
										</th>
										<th rowspan="2">Captured</th>
										<th rowspan="2">Device</th>
										<th rowspan="2">GPU</th>
										<th rowspan="2">Build</th>
										{#each readingPhases as phase (phase)}
											<th colspan={phaseCols}>{PHASE_LABELS[phase]}</th>
										{/each}
										<th rowspan="2">Draws</th>
										<th rowspan="2">Tex MB</th>
										<th
											rowspan="2"
											title="What the page downloaded, MB — each file's body as served, cache hits counted at their size — and when its first frame came. Click for the files."
											>Transfer MB</th
										>
										<th rowspan="2">Keep</th>
										<th rowspan="2"></th>
									</tr>
									<tr>
										{#each readingPhases as phase (phase)}
											<th>fps</th><th>p95</th><th>&gt;33</th>
											{#if hasBusy}<th title="p95 of the main thread's work in a frame, ms">busy</th
												>{/if}
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each data.readings as r (r.id)}
										<tr class:archived={!!r.archivedAt}>
											<td>
												<input
													type="checkbox"
													aria-label="Tick this reading"
													checked={readingList.isTicked(r.id)}
													onchange={() => readingList.toggle(r.id)}
												/>
											</td>
											<td class="nowrap" title={r.capturedAt}>
												{when(r.capturedAt)}
												{#if r.archivedAt}<span
														class="tag"
														title={`Archived ${when(r.archivedAt)}: left out of every verdict and finding`}
														>archived</span
													>{/if}
												<span
													class="tag"
													title={r.source === 'lab'
														? 'A headless lab run: its fps is not comparable, compare its counts in Lab runs'
														: undefined}>{r.source === 'capture' ? 'sent' : r.source}</span
												>
												{#if r.capped30}<span class="tag warn" title={CAP_TITLE}>30 cap</span>{/if}
												{#if readingThrottled(r)}<span
														class="tag warn"
														title={`${THROTTLED_TITLE} ${readingThrottled(r)}`}>throttled</span
													>{/if}
											</td>
											<td>
												<strong>{r.deviceClass ?? '?'}</strong>
												{#if r.label}· {r.label}{/if}
												<div class="sub">
													{#if r.gameKey}{`${r.gameKey} · `}{/if}{r.uaFamily ?? ''}{r.dpr
														? ` · ${r.dpr}x`
														: ''}{r.canvas ? ` · ${r.canvas}` : ''}
												</div>
												{#if Object.keys(r.flags).length}
													<div class="sub switch">{switches(r.flags)}</div>
												{/if}
											</td>
											<td class="gpu" title={r.gpu ?? ''}>{r.gpu ?? '–'}</td>
											<td class="nowrap">{r.buildVersion ?? '–'}</td>
											{#each readingPhases as phase (phase)}
												<td class="num">{fps(r[phase])}</td>
												<td class="num">{p95(r[phase])}</td>
												<td class="num">{hitches(r[phase])}</td>
												{#if hasBusy}<td class="num" title={busyTitle(r, phase)}
														>{busyCell(r, phase)}</td
													>{/if}
											{/each}
											<td class="num">{r.drawsMean ?? '–'}</td>
											<td class="num">{r.textureMb ?? '–'}</td>
											<td class="num nowrap">
												{#if r.network}
													<button
														type="button"
														class="linkish"
														title={transferTitle(r)}
														aria-expanded={filesOf?.id === r.id}
														onclick={() => showFiles(r)}
														>{r.network.transferMb.toFixed(1)}{r.network.unknownFiles
															? '+'
															: ''}</button
													>
													<div class="sub">1st frame {seconds(r.network.firstFrameMs)}</div>
												{:else}–{/if}
											</td>
											<td class="nowrap">
												<label
													class="keep"
													title={r.keep
														? 'Kept — never purged'
														: `Deleted in ${daysLeft(r.expiresAt)} day(s) unless kept`}
												>
													<input
														type="checkbox"
														checked={r.keep}
														disabled={keeping === r.id}
														onchange={() => toggleKeep(r)}
													/>
													{r.keep ? 'kept' : `${daysLeft(r.expiresAt)} d`}
												</label>
											</td>
											<td class="nowrap">
												<a
													href={resolve('/api/profiler/reports/[id]', { id: r.id })}
													title="The full report JSON">JSON</a
												>
												<IconButton
													icon={r.archivedAt ? 'unarchive' : 'archive'}
													label={r.archivedAt ? 'Unarchive' : 'Archive'}
													disabled={readingList.busy}
													onclick={() =>
														r.archivedAt
															? readingList.unarchive([r.id])
															: readingList.archive([r.id])}
												/>
												<IconButton
													icon="trash"
													danger
													label="Delete"
													disabled={readingList.busy}
													onclick={() => readingList.remove([r.id])}
												/>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</SectionCard>

				{#if filesOf}
					<SectionCard
						scope="profiler"
						id="reading-files"
						title={`Files — ${filesOf.deviceClass ?? '?'} · ${filesOf.gpu ?? 'unknown GPU'} · ${when(filesOf.capturedAt)}`}
					>
						{#snippet info()}
							<p>
								What this reading's page downloaded since it loaded, heaviest first. Transfer is
								each file's body as served — what a first visit downloads — whether this load took
								it from the cache or not. <em>size hidden</em> is a file from another host that sends
								no Timing-Allow-Origin: its size is not counted. Stages: before the game's first frame,
								its boot load, and after boot. File names are paths only: queries and tokens are never
								sent.
							</p>
						{/snippet}
						{#if filesError}
							<p class="error">{filesError}</p>
						{:else if !netFiles}
							<p class="muted">Reading…</p>
						{:else}
							<div class="facts">
								<span
									>Transfer <strong>{toMb(netFiles.totals.bytes)} MB</strong> in {netFiles.totals
										.files} files</span
								>
								<span>From the cache <strong>{toMb(netFiles.totals.cachedBytes)} MB</strong></span>
								{#if netFiles.totals.unknown}
									<span>Size hidden <strong>{netFiles.totals.unknown}</strong></span>
								{/if}
								<span
									>First frame <strong>{seconds(netFiles.firstFrameMs)}</strong
									>{netFiles.firstFrameSource === 'paint' ? ' (first paint)' : ''}</span
								>
								{#each NET_STAGES as s (s)}
									<span
										>{NET_STAGE_LABELS[s]}
										<strong>{toMb(netFiles.byStage[s].bytes)} MB</strong></span
									>
								{/each}
								{#if netFiles.rgs.requests}
									<span
										>RGS <strong>{netFiles.rgs.requests}</strong> requests, p95
										<strong>{netFiles.rgs.ms.p95} ms</strong></span
									>
								{/if}
								{#if netFiles.socket}
									<span
										>Room in <strong
											>{(netFiles.socket.inBytesPerSecond / 1024).toFixed(1)} KB/s</strong
										>, out
										<strong>{(netFiles.socket.outBytesPerSecond / 1024).toFixed(1)} KB/s</strong>,
										largest
										<strong>{(netFiles.socket.inLargest / 1024).toFixed(1)} KB</strong></span
									>
								{/if}
							</div>
							<div class="facts">
								{#each NET_CLASSES.filter((c) => netFiles?.byClass[c]?.files) as c (c)}
									{@const t = netFiles.byClass[c]}
									<span
										>{NET_CLASS_LABELS[c]} <strong>{toMb(t?.bytes ?? 0)} MB</strong> · {t?.files}</span
									>
								{/each}
							</div>
							{#if netFiles.trimmed}
								<p class="muted">
									Sent trimmed (as the page hid): only its heaviest files are listed.
								</p>
							{/if}
							<div class="table-wrap">
								<table class="narrow">
									<thead>
										<tr>
											<th>File</th>
											<th>Class</th>
											<th>Stage</th>
											<th class="num">MB</th>
											<th class="num" title="Decoded body, MB">Decoded</th>
											<th>From</th>
											<th class="num">ms</th>
										</tr>
									</thead>
									<tbody>
										{#each netFiles.files ?? netFiles.heaviest as f, i (i)}
											<tr>
												<td class="path" title={fileLabel(f)}>{fileLabel(f)}</td>
												<td class="nowrap">{NET_CLASS_LABELS[f.class]}</td>
												<td class="nowrap">{NET_STAGE_LABELS[f.stage]}</td>
												<td class="num">{mb2(f.bytes)}</td>
												<td class="num">{mb2(f.decoded)}</td>
												<td class="nowrap">{CACHE_TEXT[f.cache]}</td>
												<td class="num">{f.ms}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</SectionCard>
				{/if}
			</div>
		{:else if tab === 'devices'}
			<div id="panel-devices" role="tabpanel" aria-labelledby="tab-devices">
				<DevicesTab readings={data.readings} builds={data.builds} budgets={data.budgets} />
			</div>
		{:else if tab === 'findings'}
			<div id="panel-findings" role="tabpanel" aria-labelledby="tab-findings">
				<FindingsTab
					findings={data.findings}
					filed={data.filed}
					fileAs={data.fileAs}
					projectKey={data.projectKey}
					showArchived={data.showArchived}
					bugTools={new Set(data.tools.map((t) => t.id))}
					onOpenBuild={openBuild}
					onCompare={compare}
				/>
			</div>
		{:else if tab === 'compare'}
			<div id="panel-compare" role="tabpanel" aria-labelledby="tab-compare">
				<CompareTab readings={data.readings} a={compareA} b={compareB} onPick={compare} />
			</div>
		{:else if tab === 'budgets'}
			<div id="panel-budgets" role="tabpanel" aria-labelledby="tab-budgets">
				<BudgetsTab
					projectKey={data.projectKey}
					budgets={data.budgets}
					phaseSet={phaseSetOf(data.gameKind)}
				/>
			</div>
		{:else}
			<div id="panel-builds" role="tabpanel" aria-labelledby="tab-builds">
				<SectionCard scope="profiler" id="builds" title="Builds ({data.builds.length})">
					{#snippet actions()}
						<ManageActions
							list={buildList}
							archivedCount={data.archived.builds}
							showArchived={data.showArchived}
							onShowArchived={(next) => showArchived(next)}
							since={sincePerf}
						/>
					{/snippet}
					{#snippet info()}
						<p>
							Every desktop ☁ Publish and 📦 Deliver of this project, newest first: what it shipped
							by category, the estimated GPU memory of its images, the issues its build breakdown
							found, and the change in shipped size from the build before it of the same game and
							kind. The desktop launcher sends each one after the build. Click a build number for
							its detail and the readings taken on it. A build record is deleted {PERF_RETENTION_DAYS}
							days after it was made unless Keep is ticked — except the newest of each game and kind,
							which always stays. Shipped MB and GPU MB are coloured by this project's budgets, and Devices
							says pass, warn or fail per device class from the as-shipped readings taken on the build
							(hover for the detail; set the lines on the Budgets tab). Tick rows to archive (out of every
							list and verdict until Show archived) or delete them — a build a bug cites is not deleted
							while the bug is open.
						</p>
					{/snippet}
					{#if buildKeepError}<p class="error">{buildKeepError}</p>{/if}
					<ManageStatus list={buildList} />
					{#if !data.builds.length}
						<p class="muted">
							No builds yet — the desktop launcher sends one after each ☁ Publish or 📦 Deliver.
						</p>
					{:else}
						<div class="table-wrap">
							<table>
								<thead>
									<tr>
										<th>
											<input
												type="checkbox"
												aria-label="Tick every build"
												checked={buildList.allTicked}
												onchange={() => buildList.toggleAll()}
											/>
										</th>
										<th>Built</th>
										<th>Build</th>
										<th>By category</th>
										<th class="num">Shipped MB</th>
										<th class="num">Δ MB</th>
										<th class="num">GPU MB</th>
										<th
											class="num"
											title="What the as-shipped readings on the build downloaded (median); hover a cell for the build before"
											>Transfer MB</th
										>
										<th
											title="Against this project's budgets: each device class from its as-shipped readings on the build"
										>
											Devices
										</th>
										<th class="num">Issues</th>
										<th class="num">Readings</th>
										<th>Keep</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{#each data.builds as b (b.id)}
										<tr class:selected={selectedBuild?.id === b.id} class:archived={!!b.archivedAt}>
											<td>
												<input
													type="checkbox"
													aria-label="Tick this build"
													checked={buildList.isTicked(b.id)}
													onchange={() => buildList.toggle(b.id)}
												/>
											</td>
											<td class="nowrap" title={b.builtAt ?? b.registeredAt}>
												{when(b.builtAt ?? b.registeredAt)}
											</td>
											<td class="nowrap">
												<button
													type="button"
													class="linkish"
													title="Show this build's detail and readings"
													onclick={() => (selectedBuildId = b.id)}
													><strong>v{b.build}</strong></button
												>
												<span class="tag">{b.kind}{b.profile ? ` · ${b.profile}` : ''}</span>
												{#if b.optimize}<span class="tag" title="Built with 🗜 Optimize">opt</span
													>{/if}
												{#if b.debug}<span class="tag warn" title="Debug tooling included"
														>debug</span
													>{/if}
												<div class="sub">{b.gameKey}</div>
											</td>
											<td>
												<div class="bar" aria-hidden="true">
													{#each b.categories as c (c.id)}
														<span
															title={`${c.label}: ${mb(c.bytes)} MB`}
															style:width={`${b.shippedBytes ? (c.bytes / b.shippedBytes) * 100 : 0}%`}
															style:background={categoryColor(c.id)}
														></span>
													{/each}
												</div>
											</td>
											<td
												class="num v-{verdicts.get(b.id)?.shipped}"
												title={sizeTitle(b, 'shippedMb')}
											>
												{mb(b.shippedBytes)}
											</td>
											<td class="num">{shippedDelta(b)}</td>
											<td class="num v-{verdicts.get(b.id)?.gpu}" title={sizeTitle(b, 'gpuMb')}>
												{mb(b.gpuBytes)}
											</td>
											<td class="num" title={transferDelta(b)}>{transferOn(b) ?? '–'}</td>
											<td class="nowrap">
												{#each BUDGET_DEVICE_CLASSES as c (c)}
													{@const d = verdicts.get(b.id)?.devices[c]}
													{#if d}
														<VerdictBadge
															verdict={d.verdict}
															label={c}
															title={`${c}: ${VERDICT_TEXT[d.verdict]} — ${d.readings} as-shipped reading(s)`}
														/>
													{/if}
												{/each}
												{#if !BUDGET_DEVICE_CLASSES.some((c) => verdicts.get(b.id)?.devices[c])}
													<span class="muted" title="No as-shipped reading on this build yet"
														>—</span
													>
												{/if}
											</td>
											<td class="num">
												{#if b.issues.error}<span class="error">{b.issues.error} err</span>{/if}
												{#if b.issues.warn}<span class="warn">{b.issues.warn} warn</span>{/if}
												{#if !b.issues.error && !b.issues.warn}<span class="ok">none</span>{/if}
											</td>
											<td class="num">{readingsOn(b)}</td>
											<td class="nowrap">
												<label class="keep" title={buildKeepTitle(b)}>
													<input
														type="checkbox"
														checked={b.keep}
														disabled={buildKeeping === b.id}
														onchange={() => toggleBuildKeep(b)}
													/>
													{buildKeepText(b)}
												</label>
											</td>
											<td class="nowrap">
												<a
													href={resolve('/api/profiler/builds/[id]/breakdown', { id: b.id })}
													target="_blank"
													rel="noopener"
													title="The build breakdown page">Breakdown</a
												>
												·
												<a
													href={resolve('/api/profiler/builds/[id]', { id: b.id })}
													title="The breakdown JSON">JSON</a
												>
												<IconButton
													icon={b.archivedAt ? 'unarchive' : 'archive'}
													label={b.archivedAt ? 'Unarchive' : 'Archive'}
													disabled={buildList.busy}
													onclick={() =>
														b.archivedAt ? buildList.unarchive([b.id]) : buildList.archive([b.id])}
												/>
												<IconButton
													icon="trash"
													danger
													label="Delete"
													disabled={buildList.busy}
													onclick={() => buildList.remove([b.id])}
												/>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</SectionCard>

				{#if selectedBuild}
					<SectionCard
						scope="profiler"
						id="build-detail"
						title={`v${selectedBuild.build} — ${selectedBuild.gameKey} (${selectedBuild.kind})`}
					>
						{#snippet info()}
							<p>
								The selected build against the build before it of the same game and kind: shipped
								size, GPU memory and issues, and each category's size and change. Below, the
								readings taken on this build: same game (a capture link names it; a pasted reading
								names it in Game), same build number and, when the reading has one, same engine
								commit.
							</p>
						{/snippet}
						<div class="facts">
							<span
								>Shipped <strong>{mb(selectedBuild.shippedBytes)} MB</strong> in {selectedBuild.files}
								files</span
							>
							<span>Code <strong>{mb(selectedBuild.codeBytes)} MB</strong></span>
							<span>GPU (est.) <strong>{mb(selectedBuild.gpuBytes)} MB</strong></span>
							<span>Left out <strong>{mb(selectedBuild.removedBytes)} MB</strong></span>
							<span>Never loaded <strong>{mb(selectedBuild.unreferencedBytes)} MB</strong></span>
							<span title={transferDelta(selectedBuild)}
								>Downloaded (readings) <strong>{transferOn(selectedBuild) ?? '–'} MB</strong></span
							>
							{#if selectedBuild.engineSha}
								<span>Engine <code>{selectedBuild.engineSha.slice(0, 10)}</code></span>
							{/if}
						</div>
						{#if selectedDiff}
							<p class="muted">
								Against v{selectedDiff.against}: shipped {deltaMb(selectedDiff.shipped)} MB, GPU
								{deltaMb(selectedDiff.gpu)} MB, {selectedDiff.files >= 0
									? '+'
									: ''}{selectedDiff.files}
								files, errors {selectedDiff.issues.error >= 0 ? '+' : ''}{selectedDiff.issues
									.error}, warnings {selectedDiff.issues.warn >= 0 ? '+' : ''}{selectedDiff.issues
									.warn}.
							</p>
						{:else}
							<p class="muted">
								No earlier {selectedBuild.kind} of {selectedBuild.gameKey} to compare with.
							</p>
						{/if}
						<div class="table-wrap">
							<table class="narrow">
								<thead>
									<tr>
										<th>Category</th>
										<th class="num">Files</th>
										<th class="num">MB</th>
										{#if selectedPrevious}<th class="num">v{selectedPrevious.build} MB</th><th
												class="num">Δ MB</th
											>{/if}
									</tr>
								</thead>
								<tbody>
									{#each selectedBuild.categories as c (c.id)}
										{@const before =
											selectedPrevious?.categories.find((p) => p.id === c.id)?.bytes ?? 0}
										<tr>
											<td
												><span class="dot" style:background={categoryColor(c.id)}
												></span>{c.label}</td
											>
											<td class="num">{c.files}</td>
											<td class="num">{mb(c.bytes)}</td>
											{#if selectedPrevious}
												<td class="num">{mb(before)}</td>
												<td class="num">{deltaMb(c.bytes - before)}</td>
											{/if}
										</tr>
									{/each}
									{#each selectedDiff?.categories.filter((d) => !d.bytes) ?? [] as gone (gone.id)}
										<tr class="dim">
											<td
												><span class="dot" style:background={categoryColor(gone.id)}
												></span>{gone.label}</td
											>
											<td class="num">0</td>
											<td class="num">0.0</td>
											<td class="num">{mb(gone.before)}</td>
											<td class="num">{deltaMb(gone.delta)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<h3>Readings on this build ({selectedReadings.length})</h3>
						{#if !selectedReadings.length}
							<p class="muted">
								None yet — open a capture on the Readings tab and play this build, or Paste a
								delivery's reading.
							</p>
						{:else}
							<div class="table-wrap">
								<table>
									<thead>
										<tr>
											<th>Captured</th>
											<th>Device</th>
											<th>GPU</th>
											{#each buildReadingColumns as c (c.label)}
												<th class="num">{c.label}</th>
											{/each}
											<th class="num">Tex MB</th>
											<th class="num">Transfer MB</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{#each selectedReadings as r (r.id)}
											<tr>
												<td class="nowrap">{when(r.capturedAt)}</td>
												<td>
													<strong>{r.deviceClass ?? '?'}</strong>{#if r.label}&nbsp;· {r.label}{/if}
													{#if Object.keys(r.flags).length}
														<div class="sub switch">{switches(r.flags)}</div>
													{/if}
												</td>
												<td class="gpu" title={r.gpu ?? ''}>{r.gpu ?? '–'}</td>
												{#each buildReadingColumns as c (c.label)}
													<td class="num">
														{c.metric === 'fps'
															? fps(c.phase === 'lobby' ? (r.lobby ?? r.menu) : r[c.phase])
															: c.metric === 'busy'
																? busyCell(r, c.phase)
																: p95(r[c.phase])}
													</td>
												{/each}
												<td class="num">{r.textureMb ?? '–'}</td>
												<td class="num" title={transferTitle(r)}
													>{r.network?.transferMb.toFixed(1) ?? '–'}</td
												>
												<td>
													<a href={resolve('/api/profiler/reports/[id]', { id: r.id })}>JSON</a>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</SectionCard>
				{/if}
			</div>
		{/if}
	</main>
</div>

<style>
	.shell {
		width: 100%;
		box-sizing: border-box;
		color: #e8e8ee;
	}
	.body {
		padding: 20px clamp(16px, 3vw, 40px) 40px;
		max-width: 1400px;
	}
	.heading {
		display: flex;
		align-items: center;
		gap: 20px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	h1 {
		margin: 0;
		font-size: 22px;
	}
	h3 {
		margin: 12px 0 8px;
		font-size: 14px;
	}
	.project-pick,
	.field {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #a9a9b8;
	}
	select,
	input[type='text'],
	textarea {
		background: #16161e;
		color: #e8e8ee;
		border: 1px solid #2c2c38;
		border-radius: 6px;
		padding: 6px 8px;
		font: inherit;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		font:
			12px/1.4 ui-monospace,
			monospace;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 8px;
	}
	button.primary {
		background: #3b5bdb;
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 7px 14px;
		cursor: pointer;
		font: inherit;
	}
	button.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.linkish {
		background: none;
		border: none;
		color: #8ab4ff;
		cursor: pointer;
		font: inherit;
		padding: 0;
	}
	a {
		color: #8ab4ff;
	}
	.links {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	.link {
		margin: 0;
		width: 140px;
	}
	.link.main {
		width: 220px;
	}
	.qr {
		background: #fff;
		border-radius: 6px;
		padding: 4px;
		line-height: 0;
	}
	.qr :global(svg) {
		width: 100%;
		height: auto;
	}
	figcaption {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 6px;
		font-size: 13px;
	}
	figcaption .go {
		font-size: 10px;
		color: #8a8a99;
		overflow-wrap: anywhere;
		user-select: all;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	figcaption .actions {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
		white-space: nowrap;
	}
	.muted,
	.sub {
		color: #8a8a99;
	}
	.sub {
		font-size: 11px;
	}
	.switch {
		color: #ffb347;
	}
	.warn {
		color: #ffb347;
	}
	.error {
		color: #ff7b7b;
	}
	.ok {
		color: #7ee787;
	}
	.v-pass {
		color: #7ee787;
	}
	.v-warn {
		color: #ffb347;
		background: rgba(255, 179, 71, 0.08);
	}
	.v-fail {
		color: #ff7b7b;
		background: rgba(255, 123, 123, 0.1);
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 12px;
		width: 100%;
	}
	th,
	td {
		padding: 5px 8px;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		vertical-align: top;
	}
	th {
		color: #a9a9b8;
		font-weight: 600;
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.nowrap {
		white-space: nowrap;
	}
	.gpu {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		margin-left: 4px;
		font-size: 10px;
		color: #8a8a99;
		border: 1px solid #2c2c38;
		border-radius: 4px;
		padding: 0 4px;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 16px;
		padding: 4px;
		background: #121218;
		border: 1px solid #222;
		border-radius: 12px;
		width: fit-content;
		max-width: 100%;
	}
	.tab {
		background: transparent;
		border: none;
		color: #999;
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		letter-spacing: 0.03em;
	}
	.tab:hover {
		color: #ddd;
		background: #181820;
	}
	.tab.active {
		color: #fff;
		background: #23232e;
	}
	tr.archived td {
		opacity: 0.55;
	}
	tr.selected td {
		background: #181826;
	}
	tr.dim td {
		color: #6a6a78;
	}
	.bar {
		display: flex;
		width: 180px;
		height: 10px;
		border-radius: 3px;
		overflow: hidden;
		background: #1d1d26;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		margin-right: 6px;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		font-size: 13px;
		margin-bottom: 6px;
	}
	table.narrow {
		width: auto;
		min-width: 420px;
	}
	.tag.warn {
		color: #ffb347;
		border-color: #5a4320;
	}
	td.path {
		max-width: 520px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	.keep {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}
</style>
