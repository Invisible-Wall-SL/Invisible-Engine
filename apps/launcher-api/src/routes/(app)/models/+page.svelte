<script lang="ts">
	/**
	 * Invisible Model Viewer (`/models`): the project's 3D models on the left, the open one on the
	 * right — what each tier ships, its validator report and its own settings.
	 *
	 * One model is edited at a time and each is its own `model.json`, so the edit lease follows the
	 * open model (`LeaseState.switchDoc`) and every write is a compare-and-swap on the ETag this
	 * page loaded: the settings save, and a master upload over an existing model.
	 */
	import { onMount, untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import {
		MODEL_CLASSES,
		isModelClass,
		type ModelClass,
		type ModelLodScreenSize,
		type ModelTierId,
	} from 'constants-shared/modelTiers';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import {
		canonicalOverrides,
		effectiveProfile,
		fitScreenSize,
		type TierOverrides,
	} from '$lib/models/modelProfile';
	import { buildModelReport, reportCounts } from '$lib/models/modelReport';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import SaveStatusBadge from '$lib/SaveStatusBadge.svelte';
	import type { ModelDoc, ModelValidatorIssue } from '$lib/server/modelStorage';
	import type { ModelDetail, ModelListEntry } from '$lib/server/modelViewer';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { guardUnsavedWork } from '$lib/unsavedGuard';
	import {
		fetchDetail,
		fetchModels,
		formatBytes,
		postDerive,
		postSave,
		type DeriveState,
	} from './models.client';
	import ReportCards from './ReportCards.svelte';
	import SettingsCards from './SettingsCards.svelte';
	import TiersCard from './TiersCard.svelte';
	import UploadDialog from './UploadDialog.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const projectKey = untrack(() => data.projectKey);
	const context = $derived(data.context);

	let models = $state.raw<ModelListEntry[]>(untrack(() => data.models));
	let openId = $state<string | null>(null);
	let detail = $state.raw<ModelDetail | null>(null);
	let loading = $state(false);
	let loadError = $state('');
	/** Bumped when another model opens: an answer about the one before leaves the page alone. */
	let shown = 0;

	// The settings on the page, and the stored ones they are compared with.
	let cls = $state<ModelClass>('prop');
	let overrides = $state.raw<TierOverrides | undefined>(undefined);
	let screenSize = $state.raw<ModelLodScreenSize | undefined>(undefined);
	let storedSettings = $state('');
	let saveIssues = $state.raw<ModelValidatorIssue[]>([]);

	const screenOf = (size: ModelLodScreenSize | undefined): ModelLodScreenSize | undefined =>
		size && {
			levels: [...size.levels],
			...(size.ultra === undefined ? {} : { ultra: size.ultra }),
			cullBelow: size.cullBelow,
		};
	const settingsKey = (
		c: ModelClass,
		o: TierOverrides | undefined,
		s: ModelLodScreenSize | undefined,
	) => JSON.stringify([c, o ?? null, s ?? null]);
	const dirty = $derived(
		!!detail?.doc && settingsKey(cls, overrides, screenSize) !== storedSettings,
	);

	let tier = $state<ModelTierId>('full');
	/** The models with a derive in flight: one may still be running when another is opened. */
	let derivingIds = $state.raw<ReadonlySet<string>>(new Set());
	let deriveError = $state('');
	let uploadOpen = $state(false);
	let uploadReplaces = $state(false);

	// ── Lease + save ──
	const lease = new LeaseState({
		toolId: 'models',
		clientKey: untrack(() => data.clientKey),
		projectKey,
		docKey: '',
		enabled: untrack(() => !!data.context),
	});
	let leasedId: string | null = null;
	let destroyed = false;
	function leaseModel(id: string | null): void {
		if (id === leasedId || destroyed) return;
		leasedId = id;
		void lease.switchDoc(id);
	}

	const saveState = new SaveState({
		blockWhen: () => lease.readOnly,
		conflictMessage: 'This model changed since you opened it.',
		save: async ({ baseEtag }) => {
			const current = detail;
			const opened = shown;
			if (!current?.doc) return { ok: true, etag: baseEtag };
			if (!baseEtag)
				return {
					ok: false,
					reason: 'error',
					message: 'This model has no stored version to save over. Reload the page.',
				};
			const sent = settingsKey(cls, overrides, screenSize);
			saveIssues = [];
			const answer = await postSave(projectKey, {
				id: current.id,
				baseEtag,
				class: cls,
				overrides: overrides ?? null,
				lodScreenSize: screenSize ?? null,
			});
			if (!answer.ok) {
				if (opened === shown) saveIssues = answer.issues;
				return {
					ok: false,
					reason: answer.conflict ? 'conflict' : 'error',
					message: answer.message,
				};
			}
			if (opened !== shown || !detail) return { ok: true, etag: answer.etag };
			// Onto the detail as it is NOW (a derive may have answered meanwhile), and the page's
			// settings are put back to the stored ones only if nothing was changed while it saved:
			// a change made then stays, still unsaved, and the save that follows writes it.
			adoptStored(
				{ ...detail, doc: answer.doc, etag: answer.etag, deriveInputs: answer.deriveInputs },
				settingsKey(cls, overrides, screenSize) === sent,
			);
			return { ok: true, etag: answer.etag };
		},
	});
	$effect(() => saveState.setDirty(dirty));

	/** List a model, or replace its row. */
	function listModel(id: string, doc: ModelDoc | null, etag: string | null): void {
		models = models.some((m) => m.id === id)
			? models.map((m) => (m.id === id ? { id, doc, etag } : m))
			: [...models, { id, doc, etag }].sort((a, b) => a.id.localeCompare(b.id));
	}

	/**
	 * `next` is what the store holds now. With `resetDraft` the page's settings become its own;
	 * without, they stay as they are and show as unsaved against it.
	 */
	function adoptStored(next: ModelDetail, resetDraft: boolean): void {
		detail = next;
		if (next.doc) {
			const stored = {
				cls: next.doc.class,
				overrides: canonicalOverrides(next.doc.overrides),
				screenSize: screenOf(next.doc.lodScreenSize),
			};
			if (resetDraft) {
				cls = stored.cls;
				overrides = stored.overrides;
				screenSize = stored.screenSize;
			}
			storedSettings = settingsKey(stored.cls, stored.overrides, stored.screenSize);
		}
		listModel(next.id, next.doc, next.etag);
	}

	let refreshError = $state('');

	/**
	 * Read the open model again without blanking the page: what someone else saved since it was
	 * opened. `keepDraft` leaves this page's settings on top of it, unsaved, so a save can still
	 * write them — on their master, their facts and their report, by compare-and-swap as ever.
	 */
	async function refresh(keepDraft: boolean): Promise<void> {
		const id = openId;
		if (!id) return;
		const opened = shown;
		refreshError = '';
		try {
			const next = await fetchDetail(projectKey, id);
			if (opened !== shown) return;
			saveState.adoptEtag(next.etag);
			saveIssues = [];
			adoptStored(next, !keepDraft);
		} catch (e) {
			if (opened === shown)
				refreshError = e instanceof Error ? e.message : 'It could not be read again.';
		}
	}

	// Editing again after someone else held this model: show what they left. With unsaved settings
	// on the page nothing is reloaded; the save then answers "this model changed" if they saved.
	let wasReadOnly = false;
	$effect(() => {
		const now = lease.readOnly;
		const regained = wasReadOnly && !now;
		wasReadOnly = now;
		if (regained)
			untrack(() => {
				if (!dirty && !loading) void refresh(false);
			});
	});

	/** The URL names the open model: `?model=`. */
	function syncUrl(id: string | null): void {
		const keep = [...page.url.searchParams].filter(([k]) => k !== 'model');
		if (id) keep.push(['model', id]);
		const query = new URLSearchParams(keep).toString();
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`/models${query ? `?${query}` : ''}`, {});
	}

	async function load(id: string): Promise<void> {
		const opened = ++shown;
		openId = id;
		detail = null;
		loadError = '';
		refreshError = '';
		deriveError = '';
		saveIssues = [];
		loading = true;
		leaseModel(id);
		try {
			const next = await fetchDetail(projectKey, id);
			if (opened !== shown) return;
			saveState.adoptEtag(next.etag);
			adoptStored(next, true);
		} catch (e) {
			if (opened === shown) loadError = e instanceof Error ? e.message : 'It could not be read.';
		} finally {
			if (opened === shown) loading = false;
		}
	}

	async function open(id: string): Promise<void> {
		if (id === openId && detail) return;
		if (
			dirty &&
			!(await askConfirm({
				title: `Leave ${openId} without saving?`,
				message: 'Its changed settings are not saved yet.',
				confirmLabel: 'Leave without saving',
				danger: true,
			}))
		)
			return;
		syncUrl(id);
		await load(id);
	}

	/** A model's own screen sizes follow its class: one per level the new class has. */
	function changeClass(next: string): void {
		if (!isModelClass(next)) return;
		cls = next;
		const sizes = context?.inherited[next].lodScreenSize;
		if (screenSize && sizes) screenSize = fitScreenSize(screenSize, next, sizes);
	}

	async function derive(): Promise<void> {
		const current = detail;
		if (!current || derivingIds.has(current.id)) return;
		derivingIds = new Set([...derivingIds, current.id]);
		deriveError = '';
		try {
			const out = await postDerive(projectKey, current.id);
			// Still (or again) on that model: show its derive. It counts as current only for the
			// model.json it read: a save that landed while it ran set its own key, and this
			// derive predates it.
			if (detail?.id === current.id)
				detail = {
					...detail,
					derived: out.derived,
					...(out.docEtag === detail.etag ? { deriveInputs: out.deriveInputs } : {}),
				};
		} catch (e) {
			if (detail?.id === current.id)
				deriveError = e instanceof Error ? e.message : 'The derive failed.';
		} finally {
			derivingIds = new Set([...derivingIds].filter((id) => id !== current.id));
		}
	}

	/**
	 * A master was registered: list it and show it. A new master of the open model shows at once
	 * (Replace is not offered over unsaved settings); another model opens as any does, asking
	 * before unsaved settings are left.
	 */
	async function uploaded(id: string, doc: ModelDoc, etag: string | null): Promise<void> {
		uploadOpen = false;
		listModel(id, doc, etag);
		if (id === openId) await load(id);
		else await open(id);
		void fetchModels(projectKey)
			.then((fresh) => (models = fresh))
			.catch(() => undefined);
	}

	const doc = $derived(detail?.doc ?? null);
	const inherited = $derived(context?.inherited[cls] ?? null);
	const profile = $derived(inherited ? effectiveProfile(inherited.tiers, overrides) : null);
	const report = $derived(
		doc && profile && context
			? buildModelReport({
					cls,
					facts: doc.facts ?? null,
					issues: cls === doc.class ? doc.validator.issues : [],
					profile,
					publishedTiers: context.publishedTiers,
				})
			: [],
	);
	const counts = $derived(reportCounts(report));
	const deriveState = $derived<DeriveState>(
		!detail?.derived
			? 'none'
			: dirty
				? 'unsaved'
				: detail.derived.inputs === detail.deriveInputs
					? 'current'
					: 'stale',
	);
	const reached = $derived(new Set(context?.reached ?? []));
	const readOnly = $derived(lease.readOnly);
	/** Each listed model's warnings, by the same report the open one shows. */
	const listWarnings = $derived(
		new Map(
			models.map((m): [string, number] => {
				if (!m.doc || !context) return [m.id, 0];
				const stored = buildModelReport({
					cls: m.doc.class,
					facts: m.doc.facts ?? null,
					issues: m.doc.validator.issues,
					profile: effectiveProfile(context.inherited[m.doc.class].tiers, m.doc.overrides),
					publishedTiers: context.publishedTiers,
				});
				return [m.id, reportCounts(stored).warnings];
			}),
		),
	);

	onMount(() => {
		const asked = page.url.searchParams.get('model');
		const first = models.find((m) => m.id === asked) ?? models[0];
		if (first) void load(first.id);
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			destroyed = true;
			lease.release();
		};
	});

	guardUnsavedWork(() =>
		dirty
			? {
					title: 'This model has unsaved settings',
					message: 'Leaving this page discards them.',
					confirmLabel: 'Leave anyway',
					danger: true,
				}
			: null,
	);
</script>

<svelte:head><title>Invisible Model Viewer</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="models"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if doc}
				{#if readOnly}
					<PresenceBanner {lease} />
				{:else}
					<SaveStatusBadge
						state={saveState}
						okAccent
						conflictLabel="⚠ This model changed"
						onSave={() => void saveState.save()}
						onRetry={() => void saveState.save()}
					/>
				{/if}
			{/if}
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if context && !context.world3d}
			<p class="warn">
				This game's config has no 3D world yet, so nothing draws these models. They can still be
				uploaded and tuned.
			</p>
		{/if}

		<div class="split">
			<aside class="list">
				<div class="list-head">
					<h2>
						Models
						<InfoTip>
							Each model is one master GLB with its full LOD chain; every quality tier is derived
							from it. Only a model the game names (a modelId in a scene or in the Game Config)
							ships.
						</InfoTip>
					</h2>
					<button
						type="button"
						class="primary"
						disabled={!context}
						onclick={() => {
							uploadReplaces = false;
							uploadOpen = true;
						}}
					>
						Upload
					</button>
				</div>
				{#each models as model (model.id)}
					<button
						type="button"
						class="row"
						class:on={model.id === openId}
						onclick={() => void open(model.id)}
					>
						<span class="id">{model.id}</span>
						<span class="meta">
							{#if model.doc}
								{model.doc.class} · {formatBytes(model.doc.source.bytes)}
							{:else}
								unreadable model.json
							{/if}
						</span>
						<span class="marks">
							{#if listWarnings.get(model.id)}
								<span class="mark warn-mark" title="Warnings in its validator report"
									>{listWarnings.get(model.id)}</span
								>
							{/if}
							{#if reached.has(model.id)}
								<span class="mark used" title="A scene or the Game Config names it: it ships"
									>in game</span
								>
							{/if}
						</span>
					</button>
				{:else}
					<p class="empty">No models yet. Upload a master GLB to start.</p>
				{/each}
			</aside>

			<main>
				{#if loadError}
					<p class="warn err">{openId}: {loadError}</p>
				{:else if loading}
					<p class="dim">Opening {openId}…</p>
				{:else if detail && !doc}
					<p class="warn err">
						{detail.id}: its model.json cannot be read.
						<button
							type="button"
							disabled={readOnly}
							onclick={() => {
								uploadReplaces = true;
								uploadOpen = true;
							}}
						>
							Upload its master again
						</button>
					</p>
				{:else if detail && doc && inherited && context}
					<header class="head">
						<div class="title">
							<h1>{detail.id}</h1>
							{#if reached.has(detail.id)}
								<span class="pill used">In the game</span>
							{:else}
								<span
									class="pill"
									title="No scene and no Game Config entry names this model, so a publish leaves it out."
									>Not placed in the game</span
								>
							{/if}
							{#if counts.errors}
								<span class="pill bad">{counts.errors} error{counts.errors === 1 ? '' : 's'}</span>
							{/if}
							{#if counts.warnings}
								<span class="pill caution"
									>{counts.warnings} warning{counts.warnings === 1 ? '' : 's'}</span
								>
							{/if}
						</div>
						<div class="facts">
							<label>
								<span>
									Class
									<InfoTip>
										Decides the triangle budgets, the largest map and which LOD levels each tier
										ships. Changing it checks the master again when you save.
									</InfoTip>
								</span>
								<select
									value={cls}
									disabled={readOnly}
									onchange={(e) => changeClass(e.currentTarget.value)}
								>
									{#each MODEL_CLASSES as option (option)}
										<option value={option}>{option}</option>
									{/each}
								</select>
							</label>
							<div class="fact">
								<span>Master</span>
								<strong title={doc.source.sha256}>{formatBytes(doc.source.bytes)}</strong>
							</div>
							<div class="fact">
								<span>Updated</span>
								<strong>{doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : '—'}</strong>
							</div>
							<span class="grow"></span>
							<button
								type="button"
								disabled={readOnly || dirty}
								title={dirty
									? 'Save the settings first: a new master keeps the saved ones.'
									: 'Upload a new master GLB for this model. Its settings are kept.'}
								onclick={() => {
									uploadReplaces = true;
									uploadOpen = true;
								}}
							>
								Replace master
							</button>
						</div>
						{#if saveState.status === 'conflict'}
							<div class="warn conflict" role="alert">
								<span>
									Someone saved this model after you opened it, so your settings were not saved.
								</span>
								<button type="button" onclick={() => void refresh(false)}>Load theirs</button>
								<button
									type="button"
									title="Take their version (its master and report) and keep the settings on this page, unsaved, so you can save them over it."
									onclick={() => void refresh(true)}
								>
									Keep my settings
								</button>
							</div>
						{/if}
						{#if refreshError}<p class="warn err">{refreshError}</p>{/if}
						{#if saveState.status === 'error' && saveState.message}
							<p class="warn err">{saveState.message}</p>
						{/if}
						{#if saveIssues.length}
							<ul class="issues">
								{#each saveIssues as issue, i (i)}
									<li class={issue.level}><code>{issue.code}</code> {issue.message}</li>
								{/each}
							</ul>
						{/if}
					</header>

					<TiersCard
						index={detail.derived}
						status={deriveState}
						publishedTiers={context.publishedTiers}
						screenSize={screenSize ?? inherited.lodScreenSize}
						{tier}
						deriving={derivingIds.has(detail.id)}
						error={deriveError}
						canDerive={!readOnly && !dirty}
						onderive={() => void derive()}
						ontier={(next) => (tier = next)}
					/>
					<ReportCards sections={report} {cls} />
					<SettingsCards
						{cls}
						{inherited}
						{overrides}
						{screenSize}
						{readOnly}
						onoverrides={(next) => (overrides = next)}
						onscreen={(next) => (screenSize = next)}
					/>
				{:else if context}
					<p class="dim">Choose a model, or upload one.</p>
				{/if}
			</main>
		</div>
	</div>
</div>

<UploadDialog
	open={uploadOpen}
	project={projectKey}
	replace={uploadReplaces && detail
		? { id: detail.id, cls: doc?.class ?? null, etag: detail.etag }
		: null}
	taken={models.map((m) => m.id)}
	maxBytes={data.maxModelBytes}
	onclose={() => (uploadOpen = false)}
	ondone={(id, uploadedDoc, etag) => void uploaded(id, uploadedDoc, etag)}
/>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0b0f;
		color: #e8e8ee;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding: 24px;
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.split {
		display: grid;
		grid-template-columns: 250px minmax(0, 1fr);
		gap: 24px;
		align-items: start;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		position: sticky;
		top: 0;
	}
	.list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	button,
	select {
		font: inherit;
		font-size: 12px;
		padding: 5px 10px;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		background: #14141a;
		color: #e8e8ee;
	}
	button {
		cursor: pointer;
	}
	button:disabled,
	select:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		background: #1f6f54;
		border-color: #2a8a69;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px 8px;
		text-align: left;
		padding: 8px 10px;
		border-color: #23232c;
	}
	.row.on {
		border-color: #7ee0c0;
	}
	.row .id {
		font-weight: 600;
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.row .meta {
		grid-column: 1;
		font-size: 11px;
		color: #8b8b98;
	}
	.row .marks {
		grid-column: 2;
		grid-row: 1 / span 2;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.mark {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid #2a2a35;
		color: #8b8b98;
	}
	.mark.used,
	.pill.used {
		border-color: #2a6a55;
		color: #7ee0c0;
	}
	.warn-mark,
	.pill.caution {
		border-color: #5a4520;
		color: #d3b483;
	}
	.pill.bad {
		border-color: #6a2727;
		color: #ff9a9a;
	}
	.empty,
	.dim {
		margin: 8px 0;
		font-size: 12px;
		color: #8b8b98;
	}
	.warn {
		margin: 0 0 16px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.warn.err {
		border-color: #6a2727;
		background: #1e1010;
		color: #ff9a9a;
	}
	.warn.conflict {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}
	.warn.conflict span {
		flex: 1;
		min-width: 240px;
	}
	.warn button {
		margin-left: 8px;
	}
	.warn.conflict button {
		margin-left: 0;
	}
	.head {
		margin-bottom: 16px;
	}
	.title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 12px;
	}
	.pill {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #2a2a35;
		color: #8b8b98;
	}
	.facts {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 20px;
		margin-bottom: 12px;
	}
	.facts label,
	.fact {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #8b8b98;
	}
	.fact strong {
		padding: 5px 0;
		font-weight: 400;
		color: #e8e8ee;
	}
	.grow {
		flex: 1;
	}
	.issues {
		margin: 0 0 12px;
		padding: 8px 12px 8px 26px;
		border: 1px solid #3a2a2a;
		border-radius: 8px;
		background: #171113;
		font-size: 12px;
		line-height: 1.6;
	}
	.issues .error {
		color: #ff9a9a;
	}
	.issues .warning {
		color: #d3b483;
	}
	.issues code {
		font-size: 11px;
		opacity: 0.8;
	}
</style>
