<script lang="ts">
	import { goto, invalidate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		PERF_INLINE_MAX_BYTES,
		PERF_RETENTION_DAYS,
		PROFILER_READINGS,
		type PerfPhaseSummary,
		type PerfReportListItem,
	} from '$lib/profiler';
	import {
		buildDiff,
		deltaMb,
		mb,
		previousBuild,
		PROFILER_BUILDS,
		readingOnBuild,
		type PerfBuildListItem,
	} from '$lib/profilerBuilds';
	import { BUDGET_DEVICE_CLASSES, evaluateBuild, VERDICT_TEXT } from '$lib/profilerBudgets';
	import ProfilerLabRuns from '$lib/ProfilerLabRuns.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import BudgetsTab from './BudgetsTab.svelte';
	import CompareTab from './CompareTab.svelte';
	import DevicesTab from './DevicesTab.svelte';
	import FindingsTab from './FindingsTab.svelte';
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
					? ` (${data.findings?.length ?? '?'})`
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
		qr: string;
	}
	interface CaptureSessionView {
		/** The project it was opened for: another project in the picker is another session. */
		projectKey: string;
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
			const opened = (await res.json()) as Omit<CaptureSessionView, 'projectKey'>;
			session = { ...opened, projectKey: data.projectKey };
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
	const switches = (flags: Record<string, string>) =>
		Object.entries(flags)
			.map(([k, v]) => `${k}=${v}`)
			.join(' ');
	const daysLeft = (iso: string | null) =>
		iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null;

	// ── Builds ──
	let selectedBuildId = $state<string | null>(null);

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
															onclick={() => copyLink(link.url)}
														>
															{copiedUrl === link.url ? 'Copied' : 'Copy link'}
														</button>
													</span>
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
					{#snippet info()}
						<p>
							Every reading of this project, newest first: frames per second, the 95th-percentile
							frame time and frames over 33 ms, for the game idling, the reels spinning and a
							round's presentation. A reading is deleted {PERF_RETENTION_DAYS} days after capture unless
							Keep is ticked.
						</p>
					{/snippet}
					{#if keepError}<p class="error">{keepError}</p>{/if}
					{#if !data.readings.length}
						<p class="muted">No readings yet.</p>
					{:else}
						<div class="table-wrap">
							<table>
								<thead>
									<tr>
										<th rowspan="2">Captured</th>
										<th rowspan="2">Device</th>
										<th rowspan="2">GPU</th>
										<th rowspan="2">Build</th>
										<th colspan="3">Idle</th>
										<th colspan="3">Spinning</th>
										<th colspan="3">Round</th>
										<th rowspan="2">Draws</th>
										<th rowspan="2">Tex MB</th>
										<th rowspan="2">Keep</th>
										<th rowspan="2"></th>
									</tr>
									<tr>
										<th>fps</th><th>p95</th><th>&gt;33</th>
										<th>fps</th><th>p95</th><th>&gt;33</th>
										<th>fps</th><th>p95</th><th>&gt;33</th>
									</tr>
								</thead>
								<tbody>
									{#each data.readings as r (r.id)}
										<tr>
											<td class="nowrap" title={r.capturedAt}>
												{when(r.capturedAt)}
												<span
													class="tag"
													title={r.source === 'lab'
														? 'A headless lab run: its fps is not comparable, compare its counts in Lab runs'
														: undefined}>{r.source === 'capture' ? 'sent' : r.source}</span
												>
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
											<td class="num">{fps(r.idle)}</td>
											<td class="num">{p95(r.idle)}</td>
											<td class="num">{hitches(r.idle)}</td>
											<td class="num">{fps(r.spinning)}</td>
											<td class="num">{p95(r.spinning)}</td>
											<td class="num">{hitches(r.spinning)}</td>
											<td class="num">{fps(r.round)}</td>
											<td class="num">{p95(r.round)}</td>
											<td class="num">{hitches(r.round)}</td>
											<td class="num">{r.drawsMean ?? '–'}</td>
											<td class="num">{r.textureMb ?? '–'}</td>
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
											<td>
												<a
													href={resolve('/api/profiler/reports/[id]', { id: r.id })}
													title="The full report JSON">JSON</a
												>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</SectionCard>
			</div>
		{:else if tab === 'devices'}
			<div id="panel-devices" role="tabpanel" aria-labelledby="tab-devices">
				<DevicesTab readings={data.readings} builds={data.builds} budgets={data.budgets} />
			</div>
		{:else if tab === 'findings'}
			<div id="panel-findings" role="tabpanel" aria-labelledby="tab-findings">
				<FindingsTab findings={data.findings} onOpenBuild={openBuild} onCompare={compare} />
			</div>
		{:else if tab === 'compare'}
			<div id="panel-compare" role="tabpanel" aria-labelledby="tab-compare">
				<CompareTab readings={data.readings} a={compareA} b={compareB} onPick={compare} />
			</div>
		{:else if tab === 'budgets'}
			<div id="panel-budgets" role="tabpanel" aria-labelledby="tab-budgets">
				<BudgetsTab projectKey={data.projectKey} budgets={data.budgets} />
			</div>
		{:else}
			<div id="panel-builds" role="tabpanel" aria-labelledby="tab-builds">
				<SectionCard scope="profiler" id="builds" title="Builds ({data.builds.length})">
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
							(hover for the detail; set the lines on the Budgets tab).
						</p>
					{/snippet}
					{#if buildKeepError}<p class="error">{buildKeepError}</p>{/if}
					{#if !data.builds.length}
						<p class="muted">
							No builds yet — the desktop launcher sends one after each ☁ Publish or 📦 Deliver.
						</p>
					{:else}
						<div class="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Built</th>
										<th>Build</th>
										<th>By category</th>
										<th class="num">Shipped MB</th>
										<th class="num">Δ MB</th>
										<th class="num">GPU MB</th>
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
										<tr class:selected={selectedBuild?.id === b.id}>
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
											<th class="num">Idle fps</th>
											<th class="num">Spin fps</th>
											<th class="num">Spin p95</th>
											<th class="num">Round fps</th>
											<th class="num">Tex MB</th>
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
												<td class="num">{fps(r.idle)}</td>
												<td class="num">{fps(r.spinning)}</td>
												<td class="num">{p95(r.spinning)}</td>
												<td class="num">{fps(r.round)}</td>
												<td class="num">{r.textureMb ?? '–'}</td>
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
	figcaption .actions {
		display: flex;
		gap: 10px;
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
	.keep {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}
</style>
