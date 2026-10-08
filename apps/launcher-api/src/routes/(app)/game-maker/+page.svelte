<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		DEFAULT_HOLD_AND_WIN_PRESET,
		HOLD_AND_WIN_PRESET_IDS,
		HOLD_AND_WIN_PRESET_LABELS,
		POTS_OVERLAY_PRESET_IDS,
		POTS_OVERLAY_PRESET_LABELS,
		type CoinOverlayStyle,
		type HoldAndWinPresetId,
		type ImportableFeature,
		type PotsOverlayPresetId,
	} from 'game-config';
	import { invalidateAll } from '$app/navigation';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { slugifyProjectKey } from '$lib/projectKey';
	import {
		LAUNCH_LOCALES,
		LAUNCH_CURRENCIES,
		DEFAULT_LAUNCH_LOCALE,
		DEFAULT_LAUNCH_CURRENCY,
		readStoredLocale,
		readStoredCurrency,
		localeLabel,
		storeLocale,
		storeCurrency,
		withLocale,
		withCurrency,
		asAuthoringLaunch,
	} from '$lib/gameLaunch';
	import type { BonusImportOutcome, BonusImportParts } from '$lib/bonusImport';
	import {
		COIN_OVERLAY_ADD_ON_STYLES,
		COIN_OVERLAY_PRESET_STYLE,
		type AddOnOutcome,
		type AddOnPartStatus,
		type AddOnSeedReport,
	} from '$lib/potsOverlayAddOn';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Project = (typeof data.projects)[number];

	// Locale + currency the Play links open in. Shared with the home page's pickers via
	// storage, read on mount so SSR and first client render agree.
	let launchLocale = $state(DEFAULT_LAUNCH_LOCALE);
	let launchCurrency = $state(DEFAULT_LAUNCH_CURRENCY);
	$effect(() => {
		launchLocale = readStoredLocale();
		launchCurrency = readStoredCurrency();
	});

	// Create form state.
	let key = $state('');
	let name = $state('');
	let clientKey = $state('');
	let gameType = $state(data.createKinds[0]?.id ?? 'lines');
	let holdAndWinPreset = $state<HoldAndWinPresetId>(DEFAULT_HOLD_AND_WIN_PRESET);
	/** A lines game's starting preset, or '' for the lines template. */
	let linesPreset = $state('');
	let creating = $state(false);
	let createMsg = $state('');
	let createErr = $state('');
	let createWithOverlay = $state(false);
	let createOverlayPreset = $state<PotsOverlayPresetId>(POTS_OVERLAY_PRESET_IDS[0]);
	let createAddOn = $state<AddOnOutcome | null>(null);

	// Per-project publish state, keyed by project key.
	let publishing = $state<Record<string, boolean>>({});
	let publishErr = $state<Record<string, string>>({});
	/** A non-blocking note left by the last publish — today, what its sounds are licensed as. */
	let publishNote = $state<Record<string, string>>({});
	/** Project key → the snapshot id a rollback is switching to, while it runs. */
	let rollingBack = $state<Record<string, string>>({});
	let copied = $state<string>('');

	// Publish confirmation: the project pending confirmation (null = no dialog).
	let confirmProject = $state<Project | null>(null);

	// "3 days ago" / "just now" from an epoch-ms timestamp. Null ⇒ never edited.
	function relativeTime(ms: number | null): string {
		if (!ms) return 'never edited';
		const diff = Date.now() - ms;
		if (diff < 60_000) return 'just now';
		const mins = Math.floor(diff / 60_000);
		if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
		const years = Math.floor(months / 12);
		return `${years} year${years === 1 ? '' : 's'} ago`;
	}

	// Auto-derive a key slug from the typed name until the user edits the key.
	let keyTouched = $state(false);
	function onNameInput(value: string) {
		name = value;
		if (!keyTouched) key = slugifyProjectKey(value);
	}

	// ---------------------------------------------------------------------------------------------
	// Browsing the list: filter → sort → (optionally) group by client.
	//
	// The list only grows, so the card itself is no longer the unit you scan — the toolbar is. The
	// search box deliberately matches the PROFILE chips too, so "cluster", "stacked" or "buy
	// feature" find the games that use them without anyone maintaining a second tag list.
	// ---------------------------------------------------------------------------------------------
	const UNASSIGNED = '__unassigned__';

	let search = $state('');
	let filterClient = $state('');
	let filterType = $state('');
	let filterStatus = $state('');
	let sortBy = $state<'edited' | 'name' | 'key' | 'published'>('edited');
	let groupByClient = $state(true);

	const filtersActive = $derived(
		Boolean(search.trim() || filterClient || filterType || filterStatus),
	);

	/** Distinct `{ value, label }` options, label-sorted — the shape both filter selects want. */
	function options(rows: { value: string; label: string }[]): { value: string; label: string }[] {
		const byValue: Record<string, string> = {};
		for (const row of rows) byValue[row.value] = row.label;
		return Object.entries(byValue)
			.map(([value, label]) => ({ value, label }))
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	/** Clients that actually own a project here, plus Unassigned when one is unassigned. */
	const clientOptions = $derived(
		options(
			data.projects.map((p) => ({
				value: p.clientKey ?? UNASSIGNED,
				label: p.clientName ?? 'Unassigned',
			})),
		),
	);

	/** Game kinds present in the list (not the whole creatable union — a filter for nothing is noise). */
	const typeOptions = $derived(
		options(
			data.projects.map((p) => ({
				value: p.gameType,
				label: data.gameKinds.find((k) => k.id === p.gameType)?.name ?? p.gameType,
			})),
		),
	);

	/** Everything about a project a search should reach — identity plus its whole profile. */
	function haystack(p: Project): string {
		return [
			p.name,
			p.key,
			p.clientName ?? 'unassigned',
			...p.profile.facts.map((f) => f.text),
			...p.profile.features.map((f) => f.text),
		]
			.join(' ')
			.toLowerCase();
	}

	function matchesStatus(p: Project): boolean {
		switch (filterStatus) {
			case 'published':
				return p.published;
			case 'unpublished':
				return !p.published;
			case 'stale':
				return p.published && p.engineStale;
			default:
				return true;
		}
	}

	const filtered = $derived.by(() => {
		const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const rows = data.projects.filter((p) => {
			if (filterClient && (p.clientKey ?? UNASSIGNED) !== filterClient) return false;
			if (filterType && p.gameType !== filterType) return false;
			if (!matchesStatus(p)) return false;
			if (terms.length === 0) return true;
			const hay = haystack(p);
			return terms.every((t) => hay.includes(t));
		});

		// Nulls sort last in both timestamp orders — "never edited" is not "edited longest ago".
		const byTime = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);
		return rows.sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return a.name.localeCompare(b.name);
				case 'key':
					return a.key.localeCompare(b.key);
				case 'published':
					return byTime(a.publishedAt, b.publishedAt);
				default:
					return byTime(a.scenesUpdatedAt, b.scenesUpdatedAt);
			}
		});
	});

	/** The filtered list as client sections (one "All projects" section when grouping is off). */
	const groups = $derived.by(() => {
		if (!groupByClient) return [{ id: 'all', label: '', projects: filtered }];
		const byClient: Record<string, { id: string; label: string; projects: Project[] }> = {};
		for (const p of filtered) {
			const id = p.clientKey ?? UNASSIGNED;
			byClient[id] ??= { id, label: p.clientName ?? 'Unassigned', projects: [] };
			byClient[id].projects.push(p);
		}
		return Object.values(byClient).sort((a, b) => a.label.localeCompare(b.label));
	});

	function clearFilters() {
		search = '';
		filterClient = '';
		filterType = '';
		filterStatus = '';
	}

	// ---------------------------------------------------------------------------------------------
	// Duplicate / copy to another client.
	// ---------------------------------------------------------------------------------------------
	let dupSource = $state<Project | null>(null);
	let dupName = $state('');
	let dupKey = $state('');
	let dupKeyTouched = $state(false);
	let dupClient = $state('');
	let dupScope = $state<'setup' | 'full'>('setup');
	let dupBusy = $state(false);
	let dupErr = $state('');
	let dupMsg = $state('');

	// Name and key start empty, as in Create. A prefilled "<name> copy" outlived a typed key: the
	// key never feeds the name, so a copy keyed `borut-pots-sample` was still called
	// "BookOfBorutRemake copy".
	function openDuplicate(p: Project) {
		dupSource = p;
		dupName = '';
		dupKey = '';
		dupKeyTouched = false;
		dupClient = data.clients.some((c) => c.key === p.clientKey) ? (p.clientKey ?? '') : '';
		dupScope = 'setup';
		dupErr = '';
		dupMsg = '';
	}

	function onDupNameInput(value: string) {
		dupName = value;
		if (!dupKeyTouched) dupKey = slugifyProjectKey(value);
	}

	async function runDuplicate() {
		const source = dupSource;
		if (!source) return;
		const scope = dupScope;
		dupBusy = true;
		dupErr = '';
		try {
			const res = await fetch('/api/game-maker/duplicate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					source: source.key,
					key: dupKey,
					name: dupName,
					clientKey: dupClient,
					scope,
				}),
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.error ?? `Duplicate failed (${res.status}).`);
			dupSource = null;
			dupMsg =
				`Copied ${source.name} → ${dupName} (${out.copied} files, ${out.rebased} re-pointed). ` +
				(scope === 'setup'
					? 'No art, sounds or fonts were copied: the copy plays on placeholder art until you add your own.'
					: 'It starts unpublished.');
			await invalidateAll();
		} catch (e) {
			dupErr = e instanceof Error ? e.message : 'Duplicate failed.';
		} finally {
			dupBusy = false;
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Coin overlay add-on (docs/design/pots-overlay.md §4, bonus-games §2.4) — `POST /api/game-maker/add-on`.
	// ---------------------------------------------------------------------------------------------
	/** The overlay presets that add cleanly to the game the Create form would make (`load`). */
	const createPresets = $derived(
		data.createOverlayPresets[
			gameType === 'holdAndWin'
				? `holdAndWin:${holdAndWinPreset}`
				: gameType === 'lines' && linesPreset
					? `lines:${linesPreset}`
					: gameType
		] ?? [],
	);
	/** The picked overlay preset, or the first offered when the picked one does not fit. */
	const createPreset = $derived(
		createPresets.includes(createOverlayPreset) ? createOverlayPreset : createPresets[0],
	);

	const ADD_ON_PARTS: { key: keyof AddOnSeedReport; label: string }[] = [
		{ key: 'symbols', label: 'Symbols' },
		{ key: 'layout', label: 'Screens' },
		{ key: 'winText', label: 'Win Text' },
		{ key: 'flow', label: 'Flow' },
	];
	const ADD_ON_STATUS: Record<AddOnPartStatus, string> = {
		added: 'added',
		present: 'nothing to add',
		conflict: 'changed meanwhile',
		skipped: 'skipped',
		failed: 'failed',
	};

	let addOnProject = $state<Project | null>(null);
	let addOnPreset = $state<PotsOverlayPresetId>(POTS_OVERLAY_PRESET_IDS[0]);
	let addOnStyle = $state<CoinOverlayStyle>(COIN_OVERLAY_PRESET_STYLE[POTS_OVERLAY_PRESET_IDS[0]]);
	let addOnFlow = $state(false);
	let addOnBusy = $state(false);
	let addOnErr = $state('');
	let addOnResult = $state<AddOnOutcome | null>(null);

	/** A part to run again: it lost a race or threw. */
	const needsRerun = (out: AddOnOutcome | null): boolean =>
		Boolean(
			out?.ok &&
			Object.values(out.seeds).some((p) => p?.status === 'conflict' || p?.status === 'failed'),
		);

	function openAddOn(p: Project) {
		addOnProject = p;
		addOnPreset = p.overlayPresets[0] ?? POTS_OVERLAY_PRESET_IDS[0];
		addOnStyle = COIN_OVERLAY_PRESET_STYLE[addOnPreset];
		addOnFlow = false;
		addOnErr = '';
		addOnResult = null;
	}

	/** Pick a coin overlay style, and the first preset of it that fits this game. */
	function pickAddOnStyle(value: string) {
		const option = COIN_OVERLAY_ADD_ON_STYLES.find((o) => o.style === value);
		if (!option) return;
		addOnStyle = option.style;
		addOnPreset =
			addOnProject?.overlayPresets.find((id) => COIN_OVERLAY_PRESET_STYLE[id] === option.style) ??
			addOnPreset;
	}

	/** With a preset, add the overlay; without one, fill in the parts an overlay project lacks. */
	async function runAddOn(preset: PotsOverlayPresetId | undefined) {
		const project = addOnProject;
		if (!project) return;
		addOnBusy = true;
		addOnErr = '';
		try {
			const res = await fetch('/api/game-maker/add-on', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: project.key, preset, flow: addOnFlow }),
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.error ?? `The add-on failed (${res.status}).`);
			addOnResult = out as AddOnOutcome;
			await invalidateAll();
		} catch (e) {
			addOnErr = e instanceof Error ? e.message : 'The add-on failed.';
		} finally {
			addOnBusy = false;
		}
	}

	// Add a bonus mode from another project of the same client (bonus-games Phase 6), and re-sync
	// one (pots overlay Phase 7).
	const IMPORT_PARTS: { key: keyof BonusImportParts; label: string }[] = [
		{ key: 'symbols', label: 'Symbols' },
		{ key: 'spines', label: 'Rigs (shared)' },
		{ key: 'layout', label: 'Screens' },
		{ key: 'flow', label: 'Flow' },
		{ key: 'winText', label: 'Win Text' },
	];

	let importProject = $state<Project | null>(null);
	/** Set for a re-sync: the imported mode to copy again from its source. */
	let importResync = $state<string | null>(null);
	let importSource = $state('');
	let importFeatures = $state<ImportableFeature[]>([]);
	let importMode = $state('');
	/** The picked routes' keys (`ModeRouteOption.key`). */
	let importRoutes = $state<string[]>([]);
	let importBusy = $state(false);
	let importErr = $state('');
	let importResult = $state<BonusImportOutcome | null>(null);

	/** Same-client projects to import from: never the project itself. */
	const importSources = $derived(
		importProject
			? data.projects.filter(
					(p) => p.key !== importProject!.key && p.clientKey === importProject!.clientKey,
				)
			: [],
	);
	const importFeature = $derived(importFeatures.find((f) => f.mode === importMode));
	/** The routes the picked mode can take: a free spins is started only by a pot. */
	const importRouteOptions = $derived(
		(importProject?.modeRoutes ?? []).filter(
			(o) => importFeature?.board === 'respinBoard' || o.route.kind === 'pot',
		),
	);

	function openImport(p: Project, resync: string | null = null) {
		importProject = p;
		importResync = resync;
		importSource = '';
		importFeatures = [];
		importMode = resync ?? '';
		importRoutes = [];
		importErr = '';
		importResult = null;
	}

	async function loadImportFeatures() {
		const project = importProject;
		importFeatures = [];
		importMode = '';
		importErr = '';
		const requested = importSource;
		if (!project || !requested) return;
		try {
			const q = new URLSearchParams({ project: project.key, source: requested });
			const res = await fetch(`/api/game-maker/import?${q}`);
			const out = await res.json().catch(() => ({}));
			// A source picked since this request was sent owns the pickers now.
			if (importSource !== requested) return;
			if (!res.ok) throw new Error(out?.error ?? `Could not read ${requested} (${res.status}).`);
			importFeatures = (out as { features: ImportableFeature[] }).features;
			importMode = importFeatures.find((f) => !f.refused)?.mode ?? '';
		} catch (e) {
			importErr = e instanceof Error ? e.message : 'Could not read that project.';
		}
	}

	async function runImport() {
		const project = importProject;
		if (!project) return;
		if (importResult?.ok) {
			importProject = null;
			return;
		}
		importBusy = true;
		importErr = '';
		try {
			const res = await fetch('/api/game-maker/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					importResync
						? { project: project.key, mode: importResync, resync: true }
						: {
								project: project.key,
								source: importSource,
								mode: importMode,
								asMode: true,
								routes: importRouteOptions
									.filter((o) => importRoutes.includes(o.key))
									.map((o) => o.route),
							},
				),
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.error ?? `The import failed (${res.status}).`);
			importResult = out as BonusImportOutcome;
			await invalidateAll();
		} catch (e) {
			importErr = e instanceof Error ? e.message : 'The import failed.';
		} finally {
			importBusy = false;
		}
	}

	const renames = (map: Record<string, string>): string =>
		Object.entries(map)
			.map(([from, to]) => `${from} → ${to}`)
			.join(', ');

	// ---------------------------------------------------------------------------------------------
	// Bulk re-publish — "the engine shipped, reconcile every game" in one action.
	//
	// A runtime release re-hydrates nothing by itself: every published game still needs its publish
	// flow re-run before it is on the new engine, and doing that one project at a time is the chore
	// this replaces. The run is a BACKGROUND job on the server (one at a time, sequential), so this
	// page only starts it and polls — closing the tab or navigating away does not stop it, and
	// re-opening the page re-attaches to whatever is in flight.
	// ---------------------------------------------------------------------------------------------
	type BulkItem = {
		key: string;
		name: string;
		status: 'pending' | 'running' | 'ok' | 'skipped' | 'error';
		message?: string;
		ms?: number;
	};
	type BulkJob = {
		id: string;
		scope: 'stale' | 'published';
		startedAt: number;
		finishedAt: number | null;
		startedBy: string;
		cancelRequested: boolean;
		running: boolean;
		total: number;
		done: number;
		ok: number;
		failed: number;
		skipped: number;
		current: string | null;
		items: BulkItem[];
	};

	let bulkJob = $state<BulkJob | null>(null);
	let bulkErr = $state('');
	let bulkBusy = $state(false);
	let bulkConfirm = $state<null | 'stale' | 'published'>(null);

	const bulkRunning = $derived(bulkJob?.running ?? false);
	const staleCount = $derived(data.projects.filter((p) => p.published && p.engineStale).length);
	const publishedCount = $derived(data.projects.filter((p) => p.published).length);

	async function refreshBulk() {
		try {
			const res = await fetch('/api/game-maker/publish-all');
			if (!res.ok) return;
			const out = await res.json();
			const wasRunning = bulkJob?.running ?? false;
			bulkJob = (out?.job as BulkJob | null) ?? null;
			// The run stamps every game's `updatedAt`, so the staleness badges are only correct
			// again once the page's own data is refetched.
			if (wasRunning && !bulkJob?.running) await invalidateAll();
		} catch {
			// a transient poll failure is not worth surfacing — the next tick retries
		}
	}

	// Attach to an already-running job on load (someone else's, or your own from another tab).
	onMount(() => {
		if (data.canAdmin) void refreshBulk();
	});

	// Poll only while something is running. `bulkRunning` is a derived BOOLEAN so a poll that
	// changes nothing else doesn't tear down and rebuild the interval.
	$effect(() => {
		if (!bulkRunning) return;
		const timer = setInterval(() => void refreshBulk(), 2000);
		return () => clearInterval(timer);
	});

	async function startBulk(scope: 'stale' | 'published') {
		bulkConfirm = null;
		bulkBusy = true;
		bulkErr = '';
		try {
			const res = await fetch('/api/game-maker/publish-all', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ scope }),
			});
			const out = await res.json().catch(() => ({}));
			if (out?.job) bulkJob = out.job as BulkJob;
			if (!res.ok) bulkErr = out?.error ?? `Bulk republish failed (${res.status}).`;
		} catch (e) {
			bulkErr = e instanceof Error ? e.message : 'Bulk republish failed.';
		} finally {
			bulkBusy = false;
		}
	}

	async function cancelBulk() {
		bulkBusy = true;
		try {
			const res = await fetch('/api/game-maker/publish-all', { method: 'DELETE' });
			const out = await res.json().catch(() => ({}));
			if (out?.job) bulkJob = out.job as BulkJob;
		} catch {
			// ignore — the poll keeps the panel honest
		} finally {
			bulkBusy = false;
		}
	}

	/** How many games the chosen scope would cover, for the confirmation dialog. */
	const bulkScopeCount = (scope: 'stale' | 'published') =>
		scope === 'stale' ? staleCount : publishedCount;

	function bulkStatusLabel(item: BulkItem): string {
		switch (item.status) {
			case 'ok':
				return 'republished';
			case 'error':
				return 'failed';
			case 'skipped':
				return 'skipped';
			case 'running':
				return 'publishing…';
			default:
				return 'queued';
		}
	}

	// Open the confirmation dialog naming the project + its scenes' last-edited time
	// before publishing — the decouple makes the wrong project structurally hard, and
	// this makes the RIGHT one obvious (catches a stale publish).
	function requestPublish(project: Project) {
		publishErr = { ...publishErr, [project.key]: '' };
		confirmProject = project;
	}

	async function confirmPublish() {
		const project = confirmProject;
		confirmProject = null;
		if (project) await publish(project.key);
	}

	/** The refusals an author (or, for the last two, an admin) has already chosen to push past. */
	type PublishOverrides = {
		allowUnapproved?: boolean;
		allowInvalidFlow?: boolean;
		allowPaytableDrift?: boolean;
	};

	async function publish(projectKey: string, overrides: PublishOverrides = {}) {
		const { allowUnapproved, allowInvalidFlow, allowPaytableDrift } = overrides;
		publishing = { ...publishing, [projectKey]: true };
		publishErr = { ...publishErr, [projectKey]: '' };
		publishNote = { ...publishNote, [projectKey]: '' };
		try {
			const res = await fetch('/api/game-maker/publish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: projectKey, ...overrides }),
			});
			const out = await res.json().catch(() => ({}));
			// An UNAPPROVED-SOUNDS refusal is one an author may legitimately push past — it protects a
			// review step, not a real game's files. So it asks, once, naming the sounds. A game with its
			// own desktop build stays final: overriding it would overwrite something that cannot be
			// rebuilt from here.
			if (res.status === 409 && out?.reason === 'unapproved-sounds' && !allowUnapproved) {
				const names: string[] = Array.isArray(out.details) ? out.details : [];
				const ok = await askConfirm({
					title: 'Publish with unapproved sounds?',
					message:
						`${out.error}\n\n` +
						`These play in the game but nobody has signed them off:\n  ${names.join('\n  ')}`,
					confirmLabel: 'Publish anyway',
					danger: true,
				});
				if (!ok) {
					publishErr = { ...publishErr, [projectKey]: out.error };
					return;
				}
				await publish(projectKey, { ...overrides, allowUnapproved: true });
				return;
			}
			// An INVALID-FLOW refusal lists the validator's errors. Only the owner role gets the override
			// (`canOverride`); everyone else is sent back to the flow's Validation panel.
			if (res.status === 409 && out?.reason === 'invalid-flow' && !allowInvalidFlow) {
				const errors: string[] = Array.isArray(out.details) ? out.details : [];
				if (!out.canOverride) {
					publishErr = {
						...publishErr,
						[projectKey]: `${out.error} Fix it in Invisible Flow, or ask an admin to publish anyway.`,
					};
					return;
				}
				const ok = await askConfirm({
					title: 'Publish with flow errors?',
					message:
						`${out.error}\n\n` +
						`Players may see a round that hangs or skips a step:\n  ${errors.join('\n  ')}`,
					confirmLabel: 'Publish anyway',
					danger: true,
				});
				if (!ok) {
					publishErr = { ...publishErr, [projectKey]: out.error };
					return;
				}
				await publish(projectKey, { ...overrides, allowInvalidFlow: true });
				return;
			}
			// A PAYTABLE-DRIFT refusal lists the rows where the authored paytable and the captured partner
			// paytable disagree. Same owner-only override as the flow.
			if (res.status === 409 && out?.reason === 'paytable-drift' && !allowPaytableDrift) {
				const rows: string[] = Array.isArray(out.details) ? out.details : [];
				if (!out.canOverride) {
					publishErr = {
						...publishErr,
						[projectKey]: `${out.error} Ask an admin to publish anyway if it is intended.`,
					};
					return;
				}
				const ok = await askConfirm({
					title: "Publish with a paytable that differs from the partner's?",
					message: `${out.error}\n\nWhere they differ:\n  ${rows.join('\n  ')}`,
					confirmLabel: 'Publish anyway',
					danger: true,
				});
				if (!ok) {
					publishErr = { ...publishErr, [projectKey]: out.error };
					return;
				}
				await publish(projectKey, { ...overrides, allowPaytableDrift: true });
				return;
			}
			if (!res.ok) throw new Error(out?.error ?? `Publish failed (${res.status}).`);
			// Licensing is surfaced ONCE, here — the moment a build goes out is when "who owns this
			// audio" stops being paperwork, and the only moment everyone is looking.
			const sounds = out?.sounds as
				{ bound: number; missingLicence: string[]; nonCommercial: string[] } | undefined;
			if (sounds?.nonCommercial?.length) {
				publishNote = {
					...publishNote,
					[projectKey]:
						`Shipped ${sounds.bound} project sound${sounds.bound === 1 ? '' : 's'}. ` +
						`⚠ non-commercial licence on: ${sounds.nonCommercial.join(', ')}.`,
				};
			} else if (sounds?.missingLicence?.length) {
				publishNote = {
					...publishNote,
					[projectKey]:
						`Shipped ${sounds.bound} project sound${sounds.bound === 1 ? '' : 's'}. ` +
						`No licence recorded for: ${sounds.missingLicence.join(', ')}.`,
				};
			}
			if (out?.flow === 'absent') {
				publishNote = {
					...publishNote,
					[projectKey]:
						`${publishNote[projectKey] ? `${publishNote[projectKey]} ` : ''}` +
						'This game has no saved flow, so it plays without the free-spin intro and outro. ' +
						'Open Invisible Flow and save to give it the starter flow.',
				};
			}
			const rigsMissing = out?.spinesMissing as { scene: string[]; symbols: string[] } | undefined;
			const strandedRigs = [
				...new Set([...(rigsMissing?.scene ?? []), ...(rigsMissing?.symbols ?? [])]),
			];
			if (strandedRigs.length) {
				publishNote = {
					...publishNote,
					[projectKey]:
						`${publishNote[projectKey] ? `${publishNote[projectKey]} ` : ''}` +
						`⚠ ${strandedRigs.length} rig bundle${strandedRigs.length === 1 ? '' : 's'} ` +
						`resolved to nothing and will be missing in-game: ${strandedRigs.join(', ')}. ` +
						'Re-pick the rig in the Scene Editor or Invisible Symbols.',
				};
			}
			const flowScreens: string[] = Array.isArray(out?.flowScreensMissing)
				? out.flowScreensMissing
				: [];
			if (flowScreens.length) {
				const one = flowScreens.length === 1;
				publishNote = {
					...publishNote,
					[projectKey]:
						`${publishNote[projectKey] ? `${publishNote[projectKey]} ` : ''}` +
						`⚠ The flow names ${flowScreens.length} screen${one ? '' : 's'} the Scene Editor ` +
						`no longer has, so nothing draws for ${one ? 'it' : 'them'} and a step waiting on ` +
						`${one ? 'it' : 'one'} never continues: ${flowScreens.join(', ')}. Restore ` +
						`${one ? 'it' : 'them'} in the Scene Editor (History…) or remove ` +
						`${one ? 'it' : 'them'} from the flow; its Validation panel lists each step.`,
				};
			}
			if (out?.holdAndWinConfigMissing) {
				publishNote = {
					...publishNote,
					[projectKey]:
						`${publishNote[projectKey] ? `${publishNote[projectKey]} ` : ''}` +
						'⚠ This Hold and Win game has no Hold and Win block in its Game Config, so it is ' +
						'dealt plain lines. Open Invisible Game Config, save, and re-publish.',
				};
			}
			// Reload so the project row shows the new play URL + "published" state.
			await invalidateAll();
		} catch (e) {
			publishErr = {
				...publishErr,
				[projectKey]: e instanceof Error ? e.message : 'Publish failed.',
			};
		} finally {
			publishing = { ...publishing, [projectKey]: false };
		}
	}

	/** "Play": exactly what a player gets — the published snapshot — in the picked locale/currency. */
	//  `withLocale`/`withCurrency` SET their param rather than appending: the published URL
	//  already carries `lang=en&currency=USD` and the game reads the first occurrence, so an
	//  appended one does nothing.
	const playUrl = (url: string) => withCurrency(withLocale(url, launchLocale), launchCurrency);

	/** "Live": the same game on the CURRENT authoring data instead of the snapshot. The authoring
	 *  flag switches the runtime endpoint to the live assemble (and shows the author the technical
	 *  reason if the boot fails), and the RGS moves to the test server's authoring mock, which deals
	 *  the live config's board. Never applied to the copied URL — that one is for players. */
	const liveUrl = (url: string) => playUrl(asAuthoringLaunch(url));

	type Versions = NonNullable<(typeof data.projects)[number]['versions']>;

	/** "Sep 29, 14:32" — a version needs the time, since several publishes a day are normal. */
	const versionTime = (iso: string) =>
		new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	const liveVersion = (v: Versions) => v.snapshots.find((s) => s.id === v.current) ?? null;

	async function rollback(projectKey: string, snapshot: Versions['snapshots'][number]) {
		const ok = await askConfirm({
			title: 'Make this version live?',
			message:
				`Players will get the version published ${versionTime(snapshot.createdAt)}` +
				`${snapshot.by ? ` by ${snapshot.by}` : ''} from their next load. Nothing is rebuilt, ` +
				'and you can switch back the same way.' +
				(snapshot.engine
					? ` It was published on engine ${snapshot.engine.shortCommit}; the game stays on the ` +
						'engine that is live now (roll the engine back separately with Runtime rollback).'
					: ''),
			confirmLabel: 'Make live',
		});
		if (!ok) return;
		rollingBack = { ...rollingBack, [projectKey]: snapshot.id };
		publishErr = { ...publishErr, [projectKey]: '' };
		try {
			const res = await fetch('/api/game-maker/rollback', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: projectKey, snapshot: snapshot.id }),
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.error ?? `Rollback failed (${res.status}).`);
			publishNote = {
				...publishNote,
				[projectKey]: 'Version switched — players get it on reload.',
			};
			await invalidateAll();
		} catch (e) {
			publishErr = {
				...publishErr,
				[projectKey]: e instanceof Error ? e.message : 'Rollback failed.',
			};
		} finally {
			rollingBack = { ...rollingBack, [projectKey]: '' };
		}
	}

	// "Jul 27" / "Jul 27 2025" from epoch-ms — for the staleness tooltip.
	function shortDate(ms: number | null): string {
		if (!ms) return 'unknown';
		const d = new Date(ms);
		const now = new Date();
		const opts: Intl.DateTimeFormatOptions =
			d.getFullYear() === now.getFullYear()
				? { month: 'short', day: 'numeric' }
				: { month: 'short', day: 'numeric', year: 'numeric' };
		return d.toLocaleDateString(undefined, opts);
	}

	async function copyUrl(url: string, projectKey: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = projectKey;
			setTimeout(() => (copied === projectKey ? (copied = '') : null), 1500);
		} catch {
			// clipboard blocked — ignore; the link is still visible.
		}
	}
</script>

<div class="shell">
	<ToolTopBar current="gameMaker" tools={data.tools} />

	<main>
		<section class="card create">
			<h2>Create a game</h2>
			<p class="hint">
				Pick a client and a game type, give it a name — this creates the project and its cloud
				scaffold. Author it with the editor + asset tools, then publish below.
			</p>
			<form
				method="POST"
				action="?/create"
				use:enhance={() => {
					creating = true;
					createMsg = '';
					createErr = '';
					createAddOn = null;
					return async ({ result, update }) => {
						creating = false;
						if (result.type === 'success' && result.data?.ok) {
							createMsg = String(result.data.ok);
							createAddOn = (result.data.addOn as AddOnOutcome | null | undefined) ?? null;
							key = '';
							name = '';
							keyTouched = false;
							createWithOverlay = false;
							createOverlayPreset = POTS_OVERLAY_PRESET_IDS[0];
							await update({ reset: false });
						} else if (result.type === 'failure') {
							createErr = String(result.data?.error ?? 'Create failed.');
						} else {
							await update();
						}
					};
				}}
			>
				<div class="grid">
					<label>
						Name
						<input
							value={name}
							oninput={(e) => onNameInput(e.currentTarget.value)}
							placeholder="e.g. Book of Borut"
							required
						/>
					</label>
					<label>
						Key
						<input
							bind:value={key}
							oninput={() => (keyTouched = true)}
							placeholder="book-of-borut"
							pattern="[a-z0-9][a-z0-9_\-]{'{'}0,63}"
							spellcheck="false"
							required
						/>
					</label>
					<label>
						Client
						<select bind:value={clientKey}>
							<option value="">Unassigned</option>
							{#each data.clients as c (c.key)}
								<option value={c.key}>{c.name}</option>
							{/each}
						</select>
					</label>
					<label>
						Game type
						<select bind:value={gameType}>
							{#each data.createKinds as k (k.id)}
								<option value={k.id}>{k.name}</option>
							{/each}
						</select>
					</label>
					{#if gameType === 'lines' && data.linesPresets.length}
						<label>
							Preset
							<select bind:value={linesPreset} title="Start from a preset game">
								<option value="">None — the lines template</option>
								{#each data.linesPresets as p (p.id)}
									<option value={p.id}>{p.label}</option>
								{/each}
							</select>
						</label>
					{/if}
					{#if gameType === 'holdAndWin'}
						<label>
							Preset
							<select bind:value={holdAndWinPreset}>
								{#each HOLD_AND_WIN_PRESET_IDS as id (id)}
									<option value={id}>{HOLD_AND_WIN_PRESET_LABELS[id]}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
				<input type="hidden" name="key" value={key} />
				<input type="hidden" name="name" value={name} />
				<input type="hidden" name="clientKey" value={clientKey} />
				<input type="hidden" name="gameType" value={gameType} />
				{#if gameType === 'holdAndWin'}
					<input type="hidden" name="holdAndWinPreset" value={holdAndWinPreset} />
				{/if}
				{#if gameType === 'lines' && linesPreset}
					<input type="hidden" name="linesPreset" value={linesPreset} />
				{/if}
				<div class="add-on-row">
					<label class="check">
						<input type="checkbox" bind:checked={createWithOverlay} />
						Add a coin overlay
					</label>
					{#if createWithOverlay && createPreset}
						<select
							value={createPreset}
							onchange={(e) => (createOverlayPreset = e.currentTarget.value as PotsOverlayPresetId)}
							title="Coin overlay preset"
						>
							{#each createPresets as id (id)}
								<option value={id}>{POTS_OVERLAY_PRESET_LABELS[id]}</option>
							{/each}
						</select>
						<input type="hidden" name="potsOverlayPreset" value={createPreset} />
					{:else if createWithOverlay}
						<span class="muted">No coin overlay preset fits this game type.</span>
					{/if}
				</div>
				<div class="actions">
					<button class="primary" type="submit" disabled={creating}>
						{creating ? 'Creating…' : 'Create project'}
					</button>
					{#if createMsg}<span class="ok">{createMsg}</span>{/if}
					{#if createErr}<span class="err">{createErr}</span>{/if}
				</div>
				{#if createAddOn}{@render addOnReport(createAddOn)}{/if}
			</form>
		</section>

		<section class="card">
			<div class="section-head">
				<h2>Your projects</h2>
				<span class="count">
					{filtered.length === data.projects.length
						? `${data.projects.length}`
						: `${filtered.length} of ${data.projects.length}`}
				</span>
				{#if data.canAdmin && publishedCount > 0}
					<div class="bulk-actions">
						{#if staleCount > 0}
							<button
								class="bulk-cta"
								onclick={() => (bulkConfirm = 'stale')}
								disabled={bulkRunning || bulkBusy}
								title="Re-run the publish flow for every game whose engine is behind the shipped runtime"
							>
								Republish {staleCount} stale game{staleCount === 1 ? '' : 's'}
							</button>
						{/if}
						<button
							class="bulk-alt"
							onclick={() => (bulkConfirm = 'published')}
							disabled={bulkRunning || bulkBusy}
							title="Re-run the publish flow for every published game, stale or not"
						>
							Republish all ({publishedCount})
						</button>
					</div>
				{/if}
			</div>

			{#if bulkErr}<p class="err bulk-err">{bulkErr}</p>{/if}

			{#if bulkJob}
				<div class="bulk" class:done={!bulkJob.running}>
					<div class="bulk-head">
						<strong>
							{#if bulkJob.running}
								Republishing {bulkJob.total} game{bulkJob.total === 1 ? '' : 's'}…
							{:else if bulkJob.cancelRequested}
								Republish stopped
							{:else}
								Republished {bulkJob.ok} of {bulkJob.total}
							{/if}
						</strong>
						<span class="bulk-sub">
							{bulkJob.done}/{bulkJob.total} done · {bulkJob.ok} ok
							{#if bulkJob.skipped}· {bulkJob.skipped} skipped{/if}
							{#if bulkJob.failed}· {bulkJob.failed} failed{/if}
							· started by {bulkJob.startedBy}
						</span>
						{#if bulkJob.running}
							<button class="ghost" onclick={cancelBulk} disabled={bulkJob.cancelRequested}>
								{bulkJob.cancelRequested ? 'Stopping…' : 'Stop after this game'}
							</button>
						{:else}
							<button class="ghost" onclick={() => (bulkJob = null)}>Dismiss</button>
						{/if}
					</div>
					<div class="bulk-bar">
						<span style={`width:${bulkJob.total ? (bulkJob.done / bulkJob.total) * 100 : 0}%`}
						></span>
					</div>
					<ul class="bulk-items">
						{#each bulkJob.items as item (item.key)}
							<li class={`bulk-item ${item.status}`}>
								<span class="bi-name">{item.name}</span>
								<span class="bi-key">{item.key}</span>
								<span class="bi-status">{bulkStatusLabel(item)}</span>
								{#if item.message}<span class="bi-msg" title={item.message}>{item.message}</span
									>{/if}
							</li>
						{/each}
					</ul>
					<p class="hint bulk-hint">
						A publish re-exports the project, so each game takes roughly 20 seconds and they run one
						at a time. The run continues on the server — you can leave this page.
					</p>
				</div>
			{/if}

			{#if data.projects.length === 0}
				<p class="muted">No projects yet — create one above.</p>
			{:else}
				<div class="toolbar">
					<input
						class="search"
						type="search"
						bind:value={search}
						placeholder="Search name, key, client, or feature (e.g. “stacked”, “cluster”)…"
						spellcheck="false"
					/>
					<select bind:value={filterClient} title="Filter by client">
						<option value="">All clients</option>
						{#each clientOptions as c (c.value)}
							<option value={c.value}>{c.label}</option>
						{/each}
					</select>
					<select bind:value={filterType} title="Filter by game type">
						<option value="">All types</option>
						{#each typeOptions as t (t.value)}
							<option value={t.value}>{t.label}</option>
						{/each}
					</select>
					<select bind:value={filterStatus} title="Filter by publish state">
						<option value="">Any status</option>
						<option value="published">Published</option>
						<option value="unpublished">Not published</option>
						<option value="stale">Engine stale</option>
					</select>
					<select bind:value={sortBy} title="Sort order">
						<option value="edited">Recently edited</option>
						<option value="published">Recently published</option>
						<option value="name">Name A–Z</option>
						<option value="key">Key A–Z</option>
					</select>
					<label class="check" title="Group the list into client sections">
						<input type="checkbox" bind:checked={groupByClient} />
						Group by client
					</label>
					{#if filtersActive}
						<button class="ghost" onclick={clearFilters}>Clear</button>
					{/if}
				</div>

				{#if dupMsg}<p class="ok dup-msg">{dupMsg}</p>{/if}

				{#if filtered.length === 0}
					<p class="muted">Nothing matches these filters.</p>
				{:else}
					{#each groups as group (group.id)}
						{#if group.label}
							<h3 class="group">
								{group.label} <span class="gcount">{group.projects.length}</span>
							</h3>
						{/if}
						<ul class="projects">
							{#each group.projects as p (p.key)}
								<li>
									<div class="meta">
										<span class="pname">{p.name}</span>
										<span class="pkey">{p.key}</span>
										{#if !groupByClient && p.clientName}
											<span class="pclient">{p.clientName}</span>
										{/if}
										<span class="pedited">scenes edited {relativeTime(p.scenesUpdatedAt)}</span>
									</div>

									<div class="profile">
										<div class="prow">
											<span class="plabel">Game</span>
											<div class="chips">
												{#each p.profile.facts as fact (fact.id)}
													<span class="chip {fact.tone ?? 'fact'}" title={fact.title}
														>{fact.text}</span
													>
												{/each}
											</div>
										</div>
										<div class="prow">
											<span class="plabel">Using</span>
											<div class="chips">
												{#each p.profile.features as feature (feature.id)}
													<span class="chip feature" title={feature.title}>{feature.text}</span>
												{:else}
													<span class="chip none" title="No optional mechanic is switched on yet.">
														no optional features yet
													</span>
												{/each}
											</div>
										</div>
									</div>

									<div class="pub">
										<button
											class="primary"
											onclick={() => requestPublish(p)}
											disabled={publishing[p.key] || bulkRunning || !!rollingBack[p.key]}
											title={bulkRunning
												? 'A bulk republish is running — publishes run one at a time.'
												: undefined}
										>
											{#if publishing[p.key]}
												Publishing…
											{:else}
												{p.published ? 'Re-publish' : 'Publish'}
											{/if}
										</button>
										{#if p.published && p.url}
											<a
												class="play"
												title="Opens the published version — exactly what players get"
												href={playUrl(p.url)}
												target="_blank"
												rel="noopener noreferrer"
											>
												Play ↗
											</a>
											<!-- An absolute game-server URL, so SvelteKit's resolve() does not apply. -->
											<!-- eslint-disable svelte/no-navigation-without-resolve -->
											<a
												class="play live"
												href={liveUrl(p.url)}
												target="_blank"
												rel="noopener noreferrer"
												title="Play on the current authoring data — unpublished edits included"
											>
												Live ↗
											</a>
											<!-- eslint-enable svelte/no-navigation-without-resolve -->
											<select
												class="play-lang"
												title="Language the Play and Live links open the game in"
												value={launchLocale}
												onchange={(e) => {
													launchLocale = e.currentTarget.value;
													storeLocale(launchLocale);
												}}
											>
												{#each LAUNCH_LOCALES as code (code)}
													<option value={code}>{localeLabel(code)}</option>
												{/each}
											</select>
											<select
												class="play-lang"
												title="Currency the Play and Live links format every amount with"
												value={launchCurrency}
												onchange={(e) => {
													launchCurrency = e.currentTarget.value;
													storeCurrency(launchCurrency);
												}}
											>
												{#each LAUNCH_CURRENCIES as code (code)}
													<option value={code}>{code}</option>
												{/each}
											</select>
											<button class="copy" onclick={() => copyUrl(p.url!, p.key)}>
												{copied === p.key ? 'Copied' : 'Copy URL'}
											</button>
										{/if}
										<button
											class="dup"
											title="Copy this game to a new project — same client, or another one, to reskin it"
											onclick={() => openDuplicate(p)}
										>
											Duplicate…
										</button>
										<button
											class="add-on"
											title={p.hasPotsOverlay
												? 'Seed any part of the coin overlay this project is still missing'
												: 'Lay a coin overlay over this game: coins and tokens drop on the board and start a bonus'}
											onclick={() => openAddOn(p)}
										>
											{p.hasPotsOverlay ? 'Coin overlay parts…' : '＋ Coin overlay…'}
										</button>
										<button
											class="add-on"
											title="Copy a bonus mode of another project of this client into this one, as a new mode"
											onclick={() => openImport(p)}
										>
											Add a bonus mode…
										</button>
										{#each p.imports as imported (imported.mode)}
											<button
												class="add-on"
												title={`Copy ${imported.mode} again from ${imported.project} as it is now (imported ${shortDate(Date.parse(imported.at))})`}
												onclick={() => openImport(p, imported.mode)}
											>
												Re-sync {imported.mode} from {imported.project}…
											</button>
										{/each}
										{#if publishErr[p.key]}<span class="err">{publishErr[p.key]}</span>{/if}
										{#if publishNote[p.key]}<span class="note">{publishNote[p.key]}</span>{/if}
									</div>

									{#if p.published && p.engineStale}
										<div
											class="stale"
											role="status"
											title={`Engine runtime released ${shortDate(p.runtimeReleasedAt)}; this game was last published ${shortDate(p.publishedAt)}.`}
										>
											<span class="stale-dot"></span>
											<div class="stale-body">
												<strong>Engine update available.</strong>
												The shared engine runtime shipped after this game was last published, so the running
												game may still be on the old engine. Republish to re-hydrate it.
											</div>
											<button
												class="stale-cta"
												onclick={() => requestPublish(p)}
												disabled={publishing[p.key] || bulkRunning || !!rollingBack[p.key]}
											>
												{publishing[p.key] ? 'Republishing…' : 'Republish + Reconcile'}
											</button>
											{#if data.canPurgeCache}
												<a class="stale-link" href="/admin">still stale? purge edge cache</a>
											{/if}
										</div>
									{:else if p.published && p.engineComparable}
										<span class="fresh" title={`Last published ${shortDate(p.publishedAt)}.`}>
											engine up to date
										</span>
									{/if}
									{#if p.published && p.versions}
										{@const live = liveVersion(p.versions)}
										<div class="versions">
											<span class="vlive">
												Players get the version published
												<strong>{live ? versionTime(live.createdAt) : 'unknown'}</strong
												>{#if live?.by}&nbsp;by {live.by}{/if}.
												{#if live && p.scenesUpdatedAt && p.scenesUpdatedAt > Date.parse(live.createdAt)}
													<span class="vedited">Scenes edited since — publish to ship them.</span>
												{/if}
											</span>
											{#if p.versions.snapshots.length > 1}
												<details>
													<summary>Published versions ({p.versions.snapshots.length})</summary>
													<ul>
														{#each p.versions.snapshots as v (v.id)}
															<li>
																<span class="vdate">{versionTime(v.createdAt)}</span>
																<span class="vby">{v.by ?? ''}</span>
																{#if v.engine}<span
																		class="vengine"
																		title="Engine release live when this version was published"
																		>engine {v.engine.shortCommit}</span
																	>{/if}
																{#if v.flow === 'overridden'}<span class="vflag">flow errors</span
																	>{/if}
																{#if v.id === p.versions.current}
																	<span class="vcur">live</span>
																{:else if v.flow !== 'overridden' || data.isOwner}
																	<button
																		class="vmake"
																		onclick={() => rollback(p.key, v)}
																		disabled={!!rollingBack[p.key] ||
																			publishing[p.key] ||
																			bulkRunning}
																	>
																		{rollingBack[p.key] === v.id ? 'Switching…' : 'Make live'}
																	</button>
																{/if}
															</li>
														{/each}
													</ul>
												</details>
											{/if}
										</div>
									{:else if p.published}
										<span class="vlegacy">
											Published before versioned snapshots — players get live authoring data.
											Republish to freeze a version.
										</span>
									{/if}
									{#if p.published && p.url}
										<a class="url" href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a
										>
									{/if}
								</li>
							{/each}
						</ul>
					{/each}
				{/if}
			{/if}
		</section>
	</main>

	{#if confirmProject}
		<div class="modal-backdrop" role="presentation" onclick={() => (confirmProject = null)}>
			<div
				class="modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-title"
				onclick={(e) => e.stopPropagation()}
			>
				<h3 id="confirm-title">Publish {confirmProject.name}?</h3>
				<p class="confirm-body">
					You are about to publish <strong>{confirmProject.name}</strong>
					<span class="ckey">({confirmProject.key})</span>.<br />
					Its scenes were last edited
					<strong>{relativeTime(confirmProject.scenesUpdatedAt)}</strong>.
				</p>
				<p class="confirm-note">
					Publishing builds and deploys this project's current saved scenes — make sure this is the
					project you intend to ship.
				</p>
				<div class="confirm-actions">
					<button onclick={() => (confirmProject = null)}>Cancel</button>
					<button class="primary" onclick={confirmPublish}>
						{confirmProject.published ? 'Re-publish' : 'Publish'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if bulkConfirm}
		<div class="modal-backdrop" role="presentation" onclick={() => (bulkConfirm = null)}>
			<div
				class="modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="bulk-title"
				onclick={(e) => e.stopPropagation()}
			>
				<h3 id="bulk-title">
					Republish {bulkScopeCount(bulkConfirm)}
					game{bulkScopeCount(bulkConfirm) === 1 ? '' : 's'}?
				</h3>
				<p class="confirm-body">
					{#if bulkConfirm === 'stale'}
						Every published game whose engine is behind the shipped runtime will be re-published —
						the same <strong>Republish + Reconcile</strong> each stale row offers, run in one pass.
					{:else}
						<strong>Every</strong> published game you have access to will be re-published, whether or
						not its engine is stale.
					{/if}
				</p>
				<p class="confirm-note">
					This covers all your projects, not just the ones matching the current filters. Each game
					is re-exported and re-registered in turn (~20s each), so
					{bulkScopeCount(bulkConfirm)} game{bulkScopeCount(bulkConfirm) === 1 ? '' : 's'} takes about
					{Math.max(1, Math.round((bulkScopeCount(bulkConfirm) * 20) / 60))} minute{Math.max(
						1,
						Math.round((bulkScopeCount(bulkConfirm) * 20) / 60),
					) === 1
						? ''
						: 's'}. Games with their own desktop build are skipped, and each game's current saved
					scenes are what ships.
				</p>
				<div class="confirm-actions">
					<button onclick={() => (bulkConfirm = null)}>Cancel</button>
					<button class="primary" onclick={() => startBulk(bulkConfirm!)} disabled={bulkBusy}>
						{bulkBusy ? 'Starting…' : 'Republish'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#snippet addOnReport(out: AddOnOutcome)}
		{#if out.ok}
			<ul class="add-on-report">
				<li>
					<strong>Game Config</strong>
					{out.configAdded ? 'coin overlay added' : 'already has the overlay'}
				</li>
				{#if Object.keys(out.renamed.pots).length || Object.keys(out.renamed.symbols).length}
					<li>
						<strong>Renamed</strong>
						(the project already used these names)
						{renames({ ...out.renamed.pots, ...out.renamed.symbols })}
					</li>
				{/if}
				{#each ADD_ON_PARTS as { key: partKey, label } (partKey)}
					{@const item = out.seeds[partKey]}
					{#if item}
						<li class={`part-${item.status}`}>
							<strong>{label}</strong>
							{ADD_ON_STATUS[item.status] ?? item.status}{item.added.length
								? `: ${item.added.join(', ')}`
								: ''}
							{#if item.note}<span class="part-note">{item.note}</span>{/if}
						</li>
					{/if}
				{/each}
			</ul>
		{:else}
			<p class="err">{out.error}</p>
		{/if}
	{/snippet}

	{#if addOnProject}
		<div class="modal-backdrop" role="presentation" onclick={() => (addOnProject = null)}>
			<div
				class="modal wide"
				role="dialog"
				aria-modal="true"
				aria-labelledby="add-on-title"
				onclick={(e) => e.stopPropagation()}
			>
				<h3 id="add-on-title">
					{addOnProject.hasPotsOverlay ? 'Coin overlay parts for' : 'Add a coin overlay to'}
					{addOnProject.name}
				</h3>
				<p class="confirm-note">
					{#if addOnProject.hasPotsOverlay}
						This project has the overlay. Seeds any part it is still missing: token and bonus symbol
						art, the overlay screens. Nothing authored is changed.
					{:else}
						Tokens and value coins drop over the board; a full pot, or enough coins, starts a bonus.
						Adds the coin overlay to the Game Config, then placeholder art for its symbols and its
						screens. It only adds: nothing authored is replaced, and a name the game already uses is
						renamed.
					{/if}
				</p>
				<div class="grid">
					{#if !addOnProject.hasPotsOverlay}
						{@const styled = addOnProject.overlayPresets.filter(
							(id) => COIN_OVERLAY_PRESET_STYLE[id] === addOnStyle,
						)}
						<label>
							Style
							<select
								value={addOnStyle}
								onchange={(e) => pickAddOnStyle(e.currentTarget.value)}
								disabled={Boolean(addOnResult?.ok)}
							>
								{#each COIN_OVERLAY_ADD_ON_STYLES as option (option.style)}
									<option value={option.style}>{option.label}</option>
								{/each}
							</select>
						</label>
						{#if styled.length}
							<label>
								Preset
								<select bind:value={addOnPreset} disabled={Boolean(addOnResult?.ok)}>
									{#each styled as id (id)}
										<option value={id}>{POTS_OVERLAY_PRESET_LABELS[id]}</option>
									{/each}
								</select>
							</label>
						{:else}
							<p class="err">
								{COIN_OVERLAY_ADD_ON_STYLES.find((o) => o.style === addOnStyle)?.none ??
									"No preset of this style fits this game's Game Config. Check it in /config first."}
							</p>
						{/if}
					{/if}
					<label class="check">
						<input type="checkbox" bind:checked={addOnFlow} />
						Also add the overlay steps to the Flow
					</label>
				</div>
				<p class="confirm-note">
					Without the Flow steps the overlay plays its built-in beats. Nothing is added while
					someone else has this project's Game Config, Scene Editor, Symbols or Flow open. Reload
					your own open tabs of them afterwards.
				</p>
				{#if addOnErr}<p class="err">{addOnErr}</p>{/if}
				{#if addOnResult}{@render addOnReport(addOnResult)}{/if}
				<div class="confirm-actions">
					<button onclick={() => (addOnProject = null)} disabled={addOnBusy}>
						{addOnResult?.ok ? 'Done' : 'Cancel'}
					</button>
					{#if !addOnResult?.ok}
						<button
							class="primary"
							onclick={() => runAddOn(addOnProject?.hasPotsOverlay ? undefined : addOnPreset)}
							disabled={addOnBusy ||
								(!addOnProject.hasPotsOverlay &&
									COIN_OVERLAY_PRESET_STYLE[addOnPreset] !== addOnStyle)}
						>
							{addOnBusy ? 'Adding…' : addOnProject.hasPotsOverlay ? 'Seed missing parts' : 'Add'}
						</button>
					{:else if needsRerun(addOnResult)}
						<button class="primary" onclick={() => runAddOn(undefined)} disabled={addOnBusy}>
							{addOnBusy ? 'Running…' : 'Run again for the rest'}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if importProject}
		{@const project = importProject}
		<ConfirmDialog
			open
			title={importResync
				? `Re-sync ${importResync} into ${project.name}`
				: `Add a bonus mode to ${project.name}`}
			confirmLabel={importResult?.ok ? 'Done' : importResync ? 'Re-sync' : 'Add'}
			busy={importBusy}
			busyLabel={importResync ? 'Re-syncing…' : 'Adding…'}
			blocked={!importResult?.ok &&
				!importResync &&
				(!importFeature || Boolean(importFeature.refused))}
			hideCancel={Boolean(importResult?.ok)}
			error={importErr}
			onconfirm={runImport}
			oncancel={() => (importProject = null)}
		>
			{#snippet body()}
				{#if importResult}
					{#if importResult.ok}
						<ul class="add-on-report">
							<li>
								<strong>Game Config</strong>
								{importResult.resynced
									? 're-synced from the source'
									: importResult.replaced
										? 'the Hold and Win bonus replaced'
										: `bonus mode added as ${importResult.mode}`}
							</li>
							{#if Object.keys(importResult.renamed.symbols).length}
								<li>
									<strong>Renamed</strong>
									(this project already used these names)
									{renames(importResult.renamed.symbols)}
								</li>
							{/if}
							{#if importResult.leftOut.length}
								<li>
									<strong>Left out</strong>
									(a free spins starts only from a pot) {importResult.leftOut.join(', ')}
								</li>
							{/if}
							{#if importResult.droppedActivates.length}
								<li>
									<strong>Special dropped</strong>
									(the imported feature has none) pots {importResult.droppedActivates.join(', ')}
								</li>
							{/if}
							{#each IMPORT_PARTS as { key: partKey, label } (partKey)}
								{@const item = importResult.parts[partKey]}
								<li class={`part-${item.status}`}>
									<strong>{label}</strong>
									{ADD_ON_STATUS[item.status] ?? item.status}{item.added.length
										? `: ${item.added.join(', ')}`
										: ''}
									{#if item.note}<span class="part-note">{item.note}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{:else if importResync}
					<p class="confirm-note">
						Copies {importResync} again from
						{project.imports.find((i) => i.mode === importResync)?.project} as it is now: its Game Config,
						symbol art, screens, Flow section and Win Text lines. Only those pieces are overwritten; the
						pots that start it and everything else in this project stay as they are.
					</p>
				{:else}
					<p class="confirm-note">
						Copies one bonus mode of another project of this client into this one, as a NEW mode (it
						never replaces one: an id this project uses takes _2): its rules, the symbols it deals
						(a name this project uses is renamed), their art, its screens, its Flow tab and its Win
						Text lines. The other project is only read. Re-sync later to pick up its edits.
					</p>
					<div class="grid">
						<label>
							From
							<select bind:value={importSource} onchange={loadImportFeatures}>
								<option value="" disabled>Pick a project…</option>
								{#each importSources as p (p.key)}
									<option value={p.key}>{p.name} ({p.key})</option>
								{/each}
							</select>
						</label>
						{#if importFeatures.length}
							<label>
								Mode
								<select bind:value={importMode} onchange={() => (importRoutes = [])}>
									{#each importFeatures as f (f.mode)}
										<option value={f.mode} disabled={Boolean(f.refused)}>
											{f.label}{f.refused ? ' (not yet)' : ''}
										</option>
									{/each}
								</select>
							</label>
						{/if}
					</div>
					{#each importFeatures.filter((f) => f.refused) as f (f.mode)}
						<p class="confirm-note">{f.label}: {f.refused}</p>
					{/each}
					{#if importFeature}
						{#if importRouteOptions.length}
							<fieldset class="grid">
								<legend>What starts it</legend>
								{#each importRouteOptions as option (option.key)}
									<label class="check">
										<input type="checkbox" value={option.key} bind:group={importRoutes} />
										{option.label}
										{#if option.now}<span class="part-note">(now {option.now})</span>{/if}
									</label>
								{/each}
							</fieldset>
						{/if}
						<p class="confirm-note">
							{importFeature.board === 'respinBoard'
								? "A pot, a coin overlay trigger or a buy tier can start it. With none picked, route it later in /config → Coin overlay (a project's first Hold and Win needs one now)."
								: 'A free spins is started by a pot: this project needs a coin overlay with pots.'}
						</p>
					{/if}
					<p class="confirm-note">
						Nothing is written while someone else has this project's Game Config, Symbols, Scene
						Editor, Flow or Win Text open. Reload your own open tabs of them afterwards.
					</p>
				{/if}
			{/snippet}
		</ConfirmDialog>
	{/if}

	{#if dupSource}
		<div class="modal-backdrop" role="presentation" onclick={() => (dupSource = null)}>
			<div
				class="modal wide"
				role="dialog"
				aria-modal="true"
				aria-labelledby="dup-title"
				onclick={(e) => e.stopPropagation()}
			>
				<h3 id="dup-title">Duplicate {dupSource.name}</h3>
				<p class="confirm-note">
					Copies the game onto a new project key — same client for a variant, another client to
					reskin it. Asset references inside the copied documents are re-pointed at the new project,
					so the copy never reads the original's files.
				</p>
				<div class="grid">
					<label>
						New name
						<input
							value={dupName}
							oninput={(e) => onDupNameInput(e.currentTarget.value)}
							placeholder="e.g. Book of Borut — Acme"
						/>
					</label>
					<label>
						New key
						<input
							bind:value={dupKey}
							oninput={() => (dupKeyTouched = true)}
							spellcheck="false"
							placeholder="book-of-borut-acme"
						/>
					</label>
					<label>
						Client
						<select bind:value={dupClient}>
							<option value="">Unassigned</option>
							{#each data.clients as c (c.key)}
								<option value={c.key}>{c.name}</option>
							{/each}
						</select>
					</label>
					<label>
						What to copy
						<select bind:value={dupScope}>
							<option value="setup">Game setup only (no art, sounds or fonts)</option>
							<option value="full">Everything, including atlases, rigs, fonts and sounds</option>
						</select>
					</label>
				</div>
				<p class="confirm-note">
					{#if dupScope === 'setup'}
						Copies the scenes, flow, config, symbols and text, and no art, sounds or fonts. The copy
						plays on placeholder art until you add your own, and anything that used the original's
						art draws blank. Pick Everything for a copy that plays as the original does.
					{:else}
						The copy plays as the original does and you replace art in place. It starts unpublished:
						the original's published versions stay with the original. Large projects can take a
						while, and very large ones are refused (move those with the FTP Browser).
					{/if}
				</p>
				{#if dupErr}<p class="err">{dupErr}</p>{/if}
				<div class="confirm-actions">
					<button onclick={() => (dupSource = null)} disabled={dupBusy}>Cancel</button>
					<button class="primary" onclick={runDuplicate} disabled={dupBusy || !dupKey || !dupName}>
						{dupBusy ? 'Copying…' : 'Duplicate'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: #0d0d11;
		color: #e8e8ee;
	}
	main {
		flex: 1;
		padding: 24px;
		max-width: 980px;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.card {
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		padding: 20px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 16px;
		letter-spacing: 0.02em;
	}
	.section-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 12px;
	}
	.section-head h2 {
		margin: 0;
	}
	.count {
		font-size: 12px;
		color: #7a7a86;
	}
	.hint,
	.muted {
		color: #9a9aa6;
		font-size: 13px;
		margin: 0 0 14px;
	}
	.muted {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
		color: #b9b9c4;
	}
	input,
	select {
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		padding: 8px 10px;
		font-size: 13px;
		font-weight: 400;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #3a8f74;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
	}
	button {
		cursor: pointer;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #e8e8ee;
		border-radius: 8px;
		padding: 7px 14px;
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
	.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.primary:hover:not(:disabled) {
		background: #25826698;
		border-color: #34a784;
	}
	.ok {
		color: #7ee0c0;
		font-size: 13px;
	}
	.err {
		color: #ff8c8c;
		font-size: 13px;
	}
	/* --- bulk republish --------------------------------------------------------------------- */
	.bulk-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.bulk-cta {
		padding: 6px 12px;
		font-size: 12px;
		background: #7a5c12;
		border-color: #a67c1a;
		color: #fff5dc;
	}
	.bulk-cta:hover:not(:disabled) {
		background: #916d16;
		border-color: #c8961f;
	}
	.bulk-alt {
		padding: 6px 12px;
		font-size: 12px;
	}
	.bulk-err {
		margin: 0 0 12px;
	}
	.bulk {
		border: 1px solid #33334a;
		background: #16161f;
		border-radius: 8px;
		padding: 10px 12px;
		margin-bottom: 14px;
	}
	.bulk.done {
		border-color: #2b4038;
	}
	.bulk-head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 10px;
	}
	.bulk-head strong {
		font-size: 13px;
	}
	.bulk-sub {
		flex: 1 1 auto;
		font-size: 11px;
		color: #8a8a99;
	}
	.bulk-bar {
		height: 4px;
		border-radius: 999px;
		background: #26263a;
		overflow: hidden;
		margin: 10px 0;
	}
	.bulk-bar span {
		display: block;
		height: 100%;
		background: #5b8def;
		transition: width 0.3s ease;
	}
	.bulk-items {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 240px;
		overflow-y: auto;
		display: grid;
		gap: 2px;
	}
	.bulk-item {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 12px;
		padding: 3px 0;
		color: #7a7a86;
	}
	.bulk-item .bi-name {
		color: #c9c9d4;
	}
	.bulk-item .bi-key {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
		color: #6a6a78;
	}
	.bulk-item .bi-status {
		margin-left: auto;
		font-size: 11px;
	}
	.bulk-item .bi-msg {
		flex: 1 1 100%;
		font-size: 11px;
		color: #a08a6a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bulk-item.running .bi-status {
		color: #7aa2f7;
	}
	.bulk-item.ok .bi-status {
		color: #6fbf8b;
	}
	.bulk-item.skipped .bi-status {
		color: #c9a24a;
	}
	.bulk-item.error .bi-status {
		color: #ff8c8c;
	}
	.bulk-hint {
		margin: 10px 0 0;
		font-size: 11px;
	}
	.note {
		color: #d3b483;
		font-size: 12px;
	}
	/* --- browse toolbar --------------------------------------------------------------------- */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
	}
	.toolbar select {
		padding: 6px 8px;
		font-size: 12px;
	}
	.search {
		flex: 1 1 260px;
		min-width: 200px;
		padding: 6px 10px;
		font-size: 12px;
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #9a9aa6;
		white-space: nowrap;
	}
	.check input {
		accent-color: #2b8d6f;
	}
	.ghost {
		padding: 6px 10px;
		font-size: 12px;
		font-weight: 500;
		color: #9a9aa6;
	}
	.dup-msg {
		margin: 0 0 12px;
	}
	h3.group {
		margin: 18px 0 8px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7ee0c0;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	h3.group:first-of-type {
		margin-top: 0;
	}
	.gcount {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		color: #6c6c78;
	}
	.projects {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.projects > li {
		border: 1px solid #23232e;
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}
	.pname {
		font-weight: 700;
	}
	.pkey {
		font-size: 12px;
		color: #8a8a96;
		font-family: ui-monospace, monospace;
	}
	.pclient {
		font-size: 11px;
		color: #7ee0c0;
		border: 1px solid #2b6f5a;
		border-radius: 999px;
		padding: 1px 8px;
	}
	.pedited {
		font-size: 11px;
		color: #7a7a86;
		margin-left: auto;
	}
	/* --- the profile block (what this game IS + what it uses) -------------------------------- */
	.profile {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.prow {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.plabel {
		flex: none;
		width: 44px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6c6c78;
		padding-top: 2px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.chip {
		font-size: 11px;
		line-height: 1.5;
		border-radius: 6px;
		padding: 2px 8px;
		border: 1px solid transparent;
		cursor: default;
	}
	.chip.fact {
		background: #17212a;
		border-color: #27404f;
		color: #a9cfe4;
	}
	.chip.feature {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}
	/* Drift the author has to act on (e.g. a published protocol behind the game kind) — amber so it
	   reads as "do something" among chips that are otherwise neutral statements of fact. */
	.chip.warn {
		background: #2a2113;
		border-color: #6b4f1d;
		color: #f0c674;
	}
	.chip.none {
		color: #62626e;
		border-color: #26262f;
	}
	.pub {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.dup {
		margin-left: auto;
		font-weight: 500;
		color: #9a9aa6;
	}
	.add-on {
		font-weight: 500;
		color: #9a9aa6;
	}
	.add-on-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 12px;
		font-size: 13px;
	}
	.add-on-report {
		margin: 10px 0 14px;
		padding: 0;
		list-style: none;
		font-size: 13px;
		line-height: 1.6;
		color: #c8c8d2;
	}
	.add-on-report strong {
		display: inline-block;
		min-width: 96px;
		color: #e8e8ee;
	}
	.add-on-report .part-conflict,
	.add-on-report .part-failed {
		color: #ff8c8c;
	}
	.part-note {
		display: block;
		margin-left: 96px;
		font-size: 12px;
		color: #9a9aa6;
	}
	.stale {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		border: 1px solid #6b5320;
		background: #251d0d;
		border-radius: 8px;
		padding: 8px 12px;
	}
	.stale-dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: #e2b23a;
		box-shadow: 0 0 0 3px #e2b23a33;
	}
	.stale-body {
		flex: 1 1 260px;
		font-size: 12px;
		line-height: 1.45;
		color: #e7d3a3;
	}
	.stale-body strong {
		color: #f4dfa8;
	}
	.stale-cta {
		flex: none;
		background: #7a5c12;
		border-color: #a67c1a;
		color: #fff5dc;
	}
	.stale-cta:hover:not(:disabled) {
		background: #916d16;
		border-color: #c8961f;
	}
	.stale-link {
		flex: none;
		font-size: 11px;
		color: #c9a24a;
		text-decoration: none;
	}
	.stale-link:hover {
		text-decoration: underline;
	}
	.fresh {
		font-size: 11px;
		color: #6c8a7e;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 50;
	}
	.modal {
		background: #14141b;
		border: 1px solid #2b8d6f;
		border-radius: 12px;
		padding: 22px 24px;
		max-width: 440px;
		width: 100%;
	}
	.modal.wide {
		max-width: 620px;
	}
	.modal h3 {
		margin: 0 0 12px;
		font-size: 16px;
	}
	.confirm-body {
		margin: 0 0 10px;
		font-size: 14px;
		line-height: 1.5;
		color: #e8e8ee;
	}
	.confirm-body .ckey {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #8a8a96;
	}
	.confirm-note {
		margin: 0 0 18px;
		font-size: 12px;
		color: #9a9aa6;
		line-height: 1.5;
	}
	.modal .grid + .confirm-note {
		margin-top: 14px;
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
	}
	.play {
		color: #7ee0c0;
		text-decoration: none;
		font-size: 13px;
		font-weight: 600;
	}
	.play:hover {
		text-decoration: underline;
	}
	/* Locale for the Play link, right beside it so the choice is visible at launch. */
	.play-lang {
		padding: 2px 4px;
		border: 1px solid #33333c;
		border-radius: 4px;
		background: #16161c;
		color: #e6e6ea;
		font-size: 11px;
	}
	.play.live {
		color: #d6a44a;
	}
	.versions {
		font-size: 11px;
		color: #8a8a96;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.versions strong {
		color: #c8c8d2;
		font-weight: 600;
	}
	.vedited {
		color: #d6a44a;
		margin-left: 6px;
	}
	.versions summary {
		cursor: pointer;
		color: #9a9aa6;
	}
	.versions ul {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.versions li {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.vdate {
		min-width: 96px;
		color: #c8c8d2;
	}
	.vby {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.vflag {
		color: #e07a6a;
	}
	.vengine {
		color: #8a8a96;
		font-family: ui-monospace, monospace;
	}
	.vcur {
		color: #6c8a7e;
		font-weight: 600;
	}
	.vmake {
		font-size: 11px;
		padding: 2px 8px;
	}
	.vlegacy {
		font-size: 11px;
		color: #d6a44a;
	}
	.url {
		font-size: 11px;
		color: #6c6c78;
		word-break: break-all;
		font-family: ui-monospace, monospace;
		text-decoration: none;
	}
	.url:hover {
		color: #9a9aa6;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: 1fr;
		}
		.prow {
			flex-direction: column;
			gap: 4px;
		}
		.plabel {
			width: auto;
		}
	}
</style>
