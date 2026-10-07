<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import {
		PROJECT_KEY_HTML_PATTERN,
		PROJECT_KEY_PATTERN,
		PROJECT_KEY_WORDS,
		slugifyProjectKey,
	} from '$lib/projectKey';
	import {
		AGENT_BLURBS,
		ApiRefusal,
		NetworkLost,
		api,
		describe,
		isRefusal,
		mockupImageUrl,
		modelLabel,
		newRequestId,
		projectQuery,
		resend,
		statusLabel,
		usd,
		usdRange,
		type ActionAnswer,
		type EstimateAnswer,
		type MockupsAnswer,
		type RunListEntry,
		type RunSummary,
		type TemplatesAnswer,
	} from './director.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STYLE = '__style__';
	const SCREEN_TAGS = [
		'Base game',
		'Hold and Win bonus',
		'Bonus',
		'Free spins',
		'Big win',
		'Paytable',
		'Intro',
	];

	// ── What the screen offers ────────────────────────────────────────────────
	let offer = $state<TemplatesAnswer | null>(null);
	let offerErr = $state('');
	let runs = $state<RunListEntry[]>([]);

	// ── The project, as Game Maker's Create form ──────────────────────────────
	let name = $state('');
	let key = $state('');
	let keyTouched = $state(false);
	let clientKey = $state('');
	let gameType = $state('');
	let templateKey = $state('');

	function onNameInput(value: string) {
		name = value;
		if (!keyTouched) setKey(slugifyProjectKey(value));
	}
	/** The key, client and template name the create request: changing one starts a new one. */
	function setKey(value: string) {
		key = value;
		createPending = null;
	}
	function onClientChange(value: string) {
		clientKey = value;
		createPending = null;
	}
	function onTemplateChange(value: string) {
		templateKey = value;
		createPending = null;
	}

	const templatesOf = (kind: string) => offer?.templates.filter((t) => t.gameType === kind) ?? [];
	const templates = $derived(templatesOf(gameType));
	const template = $derived(templates.find((t) => t.key === templateKey) ?? null);
	const templateRegions = $derived(
		template ? template.regionGroups.reduce((n, g) => n + g.regions, 0) : 0,
	);

	function onGameTypeChange(kind: string) {
		gameType = kind;
		onTemplateChange(templatesOf(kind)[0]?.key ?? '');
	}

	// ── Checkpoints ───────────────────────────────────────────────────────────
	let cpBreakdown = $state(true);
	let cpArtPlan = $state(true);
	let cpRegionBatch = $state(true);
	let notes = $state('');

	const checkpointsBody = $derived({
		breakdown: cpBreakdown,
		artPlan: cpArtPlan,
		regionBatch: cpRegionBatch,
	});

	// ── Mockups, under the key and client of the game about to be created ────
	const scopeKey = $derived(PROJECT_KEY_PATTERN.test(key) ? key : '');
	const scopeClient = $derived(clientKey || null);
	const scopeQuery = $derived(projectQuery(scopeKey, scopeClient));
	let mockups = $state<MockupsAnswer | null>(null);
	let mockupsErr = $state('');
	let keyHint = $state('');
	let uploading = $state(0);
	let busyMockup = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	const images = $derived(mockups?.doc.images ?? []);
	const confirmed = $derived(mockups?.doc.ownershipConfirmed ?? null);
	const analysedMockups = $derived(images.filter((i) => !i.styleOnly).length);
	/** With mockups uploaded, the key and client are theirs: moving them would strand the images. */
	const scopeLocked = $derived(images.length > 0);
	const atLimit = $derived(mockups !== null && images.length >= mockups.limits.maxFiles);

	$effect(() => {
		const k = scopeKey;
		const c = scopeClient;
		if (!k) {
			mockups = null;
			keyHint = '';
			return;
		}
		const t = setTimeout(() => loadMockups(k, c), 300);
		return () => clearTimeout(t);
	});

	async function loadMockups(k: string, c: string | null) {
		mockupsErr = '';
		try {
			const answer = await api<MockupsAnswer>(`/api/director/mockups?${projectQuery(k, c)}`);
			if (k !== scopeKey || c !== scopeClient) return;
			if (!answer.pending) {
				// The key names a project that exists: Game Maker's words, before any call.
				mockups = null;
				keyHint = 'A project with that key exists.';
				return;
			}
			keyHint = '';
			mockups = answer;
		} catch (e) {
			if (k !== scopeKey || c !== scopeClient) return;
			mockups = null;
			keyHint = !isRefusal(e)
				? ''
				: e.status === 403
					? 'That key is not free: a project has it, had it, or someone else is preparing a game under it.'
					: e.status === 409
						? e.message
						: '';
			if (!keyHint) mockupsErr = describe(e);
		}
	}

	/** The scope a write goes to; its answer is kept only while the form still names that scope. */
	class ScopeMoved extends Error {}

	async function postMockups(form: FormData): Promise<void> {
		const k = scopeKey;
		const c = scopeClient;
		const answer = await api<MockupsAnswer>(`/api/director/mockups?${projectQuery(k, c)}`, {
			form,
		});
		if (k !== scopeKey || c !== scopeClient) throw new ScopeMoved();
		mockups = answer;
	}

	async function onFiles(files: FileList | null) {
		if (!files || !scopeKey || !mockups) return;
		const list = [...files];
		mockupsErr = '';
		uploading = list.length;
		for (const file of list) {
			const form = new FormData();
			form.set('action', 'upload');
			form.set('tag', SCREEN_TAGS[0]);
			form.set('file', file);
			try {
				await postMockups(form);
			} catch (e) {
				if (!(e instanceof ScopeMoved)) mockupsErr = `${file.name}: ${describe(e)}`;
				break;
			} finally {
				uploading--;
			}
		}
		uploading = 0;
		if (fileInput) fileInput.value = '';
	}

	async function retag(id: string, value: string) {
		const form = new FormData();
		form.set('action', 'retag');
		form.set('id', id);
		if (value === STYLE) form.set('styleOnly', '1');
		else form.set('tag', value);
		await withMockup(id, form);
	}

	async function remove(id: string) {
		const form = new FormData();
		form.set('action', 'remove');
		form.set('id', id);
		await withMockup(id, form);
	}

	async function withMockup(id: string, form: FormData) {
		busyMockup = id;
		mockupsErr = '';
		try {
			await postMockups(form);
		} catch (e) {
			if (!(e instanceof ScopeMoved)) mockupsErr = describe(e);
		} finally {
			busyMockup = '';
		}
	}

	async function setFidelity(fidelity: 'match' | 'start') {
		const form = new FormData();
		form.set('action', 'fidelity');
		form.set('fidelity', fidelity);
		await withMockup('fidelity', form);
	}

	async function confirmOwnership(box: HTMLInputElement) {
		const form = new FormData();
		form.set('action', 'confirm_ownership');
		await withMockup('ownership', form);
		if (!confirmed) box.checked = false;
	}

	/** The options a card's select offers: the screens, a tag typed elsewhere, and style-only. */
	function tagOptions(tag: string, styleOnly: boolean): string[] {
		return styleOnly || SCREEN_TAGS.includes(tag) ? SCREEN_TAGS : [tag, ...SCREEN_TAGS];
	}

	// ── The estimate against the cap ──────────────────────────────────────────
	let estimate = $state<EstimateAnswer | null>(null);
	let estimateErr = $state('');
	let estimating = $state(false);
	/** Only the newest estimate request may answer: two in flight can land out of order. */
	let estimateSeq = 0;

	$effect(() => {
		const tk = templateKey;
		const m = analysedMockups;
		const c = checkpointsBody;
		if (!tk) {
			estimate = null;
			return;
		}
		const t = setTimeout(async () => {
			const seq = ++estimateSeq;
			estimating = true;
			try {
				const answer = await api<EstimateAnswer>('/api/director/estimate', {
					json: { template: tk, mockups: m, checkpoints: c },
				});
				if (seq !== estimateSeq) return;
				estimate = answer;
				estimateErr = '';
			} catch (e) {
				if (seq === estimateSeq) estimateErr = describe(e);
			} finally {
				if (seq === estimateSeq) estimating = false;
			}
		}, 400);
		return () => clearTimeout(t);
	});

	const totalUsd = $derived(estimate?.estimate.total.usd ?? null);
	/** Money fails closed: no run is created on an estimate that could not be priced. */
	const unpriced = $derived(estimate !== null && totalUsd === null);
	const overCap = $derived(
		estimate !== null && totalUsd !== null && totalUsd.high > estimate.budgetCapUsd,
	);
	const capShare = $derived(
		estimate === null || totalUsd === null
			? 0
			: Math.min(100, (totalUsd.high / estimate.budgetCapUsd) * 100),
	);

	// ── Create, then start ────────────────────────────────────────────────────
	/**
	 * One create request per (key, client, template), kept with the body as FIRST sent while its
	 * answer may still be recorded (a lost connection, `in_progress`, a 5xx): the server derives
	 * the run id from the request id and replays a resend to the run it made, so a retry after a
	 * lost answer never creates twice, and the same id with another body would be refused. A name
	 * or note edited meanwhile does not travel; the run page says so. A refusal that recorded
	 * nothing drops the request, so the corrected form is sent next; a different trio is another
	 * request.
	 */
	let createPending: { requestId: string; body: Record<string, unknown> } | null = null;
	/** The start request id per run, kept for the resend of a lost answer. */
	const startRequestIds: Record<string, string> = {};
	const startRequestIdFor = (runId: string): string => (startRequestIds[runId] ??= newRequestId());

	let creating = $state(false);
	let createStage = $state('');
	let createErr = $state('');

	const createTarget = $derived(`${clientKey || 'unassigned'} / ${scopeKey || key || '…'}`);

	async function createAndStart() {
		createErr = '';
		const k = key.toLowerCase().trim();
		if (!PROJECT_KEY_PATTERN.test(k)) return void (createErr = PROJECT_KEY_WORDS);
		if (!name.trim()) return void (createErr = 'Name is required.');
		if (!templateKey) return void (createErr = 'Pick a template game to re-theme.');
		if (mockups?.startRefusal) return void (createErr = mockups.startRefusal);
		if (images.length === 0 && !notes.trim()) {
			return void (createErr = 'Describe the style in the notes, or upload mockups.');
		}
		if (!estimate || totalUsd === null) {
			return void (createErr = estimate
				? `The run's cost cannot be estimated: ${estimate.estimate.unpriced.join('; ')}.`
				: 'Wait for the estimate: a run starts only on a priced estimate.');
		}
		const body = {
			key: k,
			name: name.trim(),
			clientKey: clientKey || undefined,
			gameType,
			template: templateKey,
			notes: notes.trim(),
			checkpoints: checkpointsBody,
		};
		const sent = (createPending ??= { requestId: newRequestId(), body });
		const asFirstSent = JSON.stringify(sent.body) !== JSON.stringify(body);
		creating = true;
		createStage = 'Creating the project…';
		try {
			const made = await resend<{ run: RunSummary; replayed: boolean }>('/api/director/runs', {
				...sent.body,
				requestId: sent.requestId,
			});
			const run = made.run;
			if (asFirstSent) {
				sessionStorage.setItem(
					`director:note:${run.id}`,
					'The create request was resent as first written: the name, notes and checkpoints are those of the first attempt.',
				);
			}
			createStage = 'Starting the agents…';
			let startRefusal = '';
			try {
				await resend<ActionAnswer>(`/api/director/runs/${encodeURIComponent(run.id)}/actions`, {
					action: 'start',
					requestId: startRequestIdFor(run.id),
				});
			} catch (e) {
				// A replayed create may find the run already started: nothing to report then.
				if (!(isRefusal(e, 'not_allowed') && run.status !== 'draft')) startRefusal = describe(e);
			}
			if (startRefusal) sessionStorage.setItem(`director:start-refusal:${run.id}`, startRefusal);
			await goto(resolve('/(app)/director/[runId]', { runId: run.id }));
		} catch (e) {
			if (e instanceof NetworkLost) {
				createErr = `${e.message} Press the button again: the same request is resent, never a second one.`;
			} else if (isRefusal(e, 'in_progress')) {
				createErr = 'This request is still being created. Try again in a moment.';
			} else {
				if (!(e instanceof ApiRefusal && e.status >= 500)) createPending = null;
				createErr = isRefusal(e, 'project_exists')
					? 'A project with that key was created meanwhile. Pick another key.'
					: describe(e);
			}
		} finally {
			creating = false;
			createStage = '';
		}
	}

	onMount(async () => {
		try {
			const [got, mine] = await Promise.all([
				api<TemplatesAnswer>('/api/director/templates'),
				api<{ runs: RunListEntry[] }>('/api/director/runs'),
			]);
			offer = got;
			runs = mine.runs;
			cpBreakdown = got.checkpoints.breakdown;
			cpArtPlan = got.checkpoints.artPlan;
			cpRegionBatch = got.checkpoints.regionBatch;
			// The first kind that has a template, so the form opens on something that can run.
			const first = got.gameKinds.find((k) => got.templates.some((t) => t.gameType === k.id));
			onGameTypeChange(first?.id ?? got.gameKinds[0]?.id ?? '');
		} catch (e) {
			offerErr = describe(e);
		}
	});

	const fmtDate = (iso: string) => new Date(iso).toLocaleString();
</script>

<svelte:head><title>Invisible Director — Invisible Wall</title></svelte:head>

<div class="page">
	<ToolTopBar current="director" tools={data.tools} />

	<main class="body">
		{#if offerErr}
			<p class="err">{offerErr}</p>
		{/if}

		<div class="columns">
			<div class="form">
				<section class="card" aria-label="Project">
					<h1>Create a game with agents</h1>
					<p class="hint">
						Same project setup as Game Maker. Pick the client and game type, then a template, and
						start from design mockups, a style description or both. The agents build it while you
						review.
					</p>
					<div class="grid four">
						<label>
							Name
							<input
								value={name}
								oninput={(e) => onNameInput(e.currentTarget.value)}
								placeholder="e.g. Sunken Temple"
								required
							/>
						</label>
						<label>
							Key
							<input
								class="mono"
								value={key}
								oninput={(e) => {
									keyTouched = true;
									setKey(e.currentTarget.value.toLowerCase());
								}}
								placeholder="sunken-temple"
								pattern={PROJECT_KEY_HTML_PATTERN}
								spellcheck="false"
								disabled={scopeLocked || uploading > 0}
								required
							/>
							{#if keyHint}<span class="field-err">{keyHint}</span>{/if}
						</label>
						<label>
							Client
							<select
								value={clientKey}
								onchange={(e) => onClientChange(e.currentTarget.value)}
								disabled={scopeLocked || uploading > 0}
							>
								<option value="">Unassigned</option>
								{#each offer?.clients ?? [] as c (c.key)}
									<option value={c.key}>{c.name}</option>
								{/each}
							</select>
						</label>
						<label>
							Game type
							<select value={gameType} onchange={(e) => onGameTypeChange(e.currentTarget.value)}>
								{#each offer?.gameKinds ?? [] as k (k.id)}
									<option value={k.id}>{k.name}</option>
								{/each}
							</select>
						</label>
					</div>
					{#if scopeLocked}
						<p class="muted">
							The mockups below are stored under this key and client. Remove them to change either.
						</p>
					{/if}
				</section>

				<section class="card" aria-label="Template">
					<h2>Template</h2>
					<p class="hint">
						Start from a {offer?.gameKinds.find((k) => k.id === gameType)?.name ?? ''} game that already
						works. The agents re-theme it.
					</p>
					{#if offer && templates.length === 0}
						<p class="muted">
							No Director template for this game type yet. An admin marks a published game as a
							template in Admin › Projects.
						</p>
					{:else}
						<select
							value={templateKey}
							onchange={(e) => onTemplateChange(e.currentTarget.value)}
							aria-label="Template"
						>
							{#each templates as t (t.key)}
								<option value={t.key}>{t.name} · {t.key}</option>
							{/each}
						</select>
					{/if}
					{#if template}
						<div class="profile">
							<span class="row-label">Game</span>
							<div class="chips">
								{#each template.chips.game as chip (chip.id)}
									<span class="chip {chip.tone ?? 'fact'}" title={chip.title}>{chip.text}</span>
								{/each}
							</div>
							<span class="row-label">Using</span>
							<div class="chips">
								{#each template.chips.using as chip (chip.id)}
									<span class="chip feature" title={chip.title}>{chip.text}</span>
								{:else}
									<span class="chip none">no optional mechanic</span>
								{/each}
							</div>
							<span class="row-label">Locked</span>
							<div class="chips">
								{#each template.lockedItems as item (item.id)}
									<span class="chip locked" title={item.detail}>
										<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
											<rect x="3" y="7" width="10" height="7" rx="1.5" />
											<path d="M5 7V5a3 3 0 0 1 6 0v2" />
										</svg>
										{item.label}
									</span>
								{/each}
							</div>
						</div>
					{/if}
				</section>

				<section class="card" aria-label="Starting point">
					<h2>Starting point</h2>
					<p class="hint">
						Upload design mockups for the agents to recreate, describe a style, or both. Tag each
						image with the screen it shows.
					</p>
					<div class="mockups">
						{#each images as img (img.id)}
							<div class="mockup" class:busy={busyMockup === img.id}>
								<img
									class="thumb"
									src={mockupImageUrl(scopeKey, scopeClient, img.id)}
									alt={img.tag === 'style' ? 'Style reference' : img.tag}
									width={img.w}
									height={img.h}
								/>
								<div class="mockup-head">
									<span class="mono small" title="{img.w} × {img.h}">{img.file}</span>
									<button
										type="button"
										class="icon"
										aria-label="Remove {img.file}"
										title="Remove"
										disabled={busyMockup !== ''}
										onclick={() => remove(img.id)}>×</button
									>
								</div>
								<select
									aria-label="Use {img.file} as"
									value={img.styleOnly ? STYLE : img.tag}
									disabled={busyMockup !== ''}
									onchange={(e) => retag(img.id, e.currentTarget.value)}
								>
									{#each tagOptions(img.tag, img.styleOnly) as tag (tag)}
										<option value={tag}>{tag}</option>
									{/each}
									<option value={STYLE}>Style reference only</option>
								</select>
							</div>
						{/each}
						<button
							type="button"
							class="add"
							disabled={!mockups || atLimit || uploading > 0}
							onclick={() => fileInput?.click()}
						>
							{#if uploading > 0}
								Uploading… {uploading} left
							{:else if !scopeKey}
								Give the game a key first
								<span>Mockups are stored under it</span>
							{:else if !mockups}
								{keyHint || 'Checking the key…'}
							{:else if atLimit}
								{mockups.limits.maxFiles} mockups is the most
							{:else}
								Add mockups or references
								<span
									>PNG or JPG, up to {Math.round(mockups.limits.maxBytes / 1048576)} MB each</span
								>
							{/if}
						</button>
						<input
							bind:this={fileInput}
							type="file"
							accept="image/png,image/jpeg"
							multiple
							hidden
							onchange={(e) => onFiles(e.currentTarget.files)}
						/>
					</div>
					{#if mockupsErr}<p class="err">{mockupsErr}</p>{/if}
					{#if images.length > 0 && mockups}
						<div class="fidelity-row">
							<div class="seg" role="radiogroup" aria-label="How close to the mockups">
								<label class:on={mockups.doc.fidelity === 'match'}>
									<input
										type="radio"
										name="fidelity"
										value="match"
										checked={mockups.doc.fidelity === 'match'}
										disabled={busyMockup !== ''}
										onchange={() => setFidelity('match')}
									/>
									Match the mockups closely
								</label>
								<label class:on={mockups.doc.fidelity === 'start'}>
									<input
										type="radio"
										name="fidelity"
										value="start"
										checked={mockups.doc.fidelity === 'start'}
										disabled={busyMockup !== ''}
										onchange={() => setFidelity('start')}
									/>
									Use them as a starting point
								</label>
							</div>
							<label class="check" class:required={!confirmed}>
								<input
									type="checkbox"
									checked={confirmed !== null}
									disabled={confirmed !== null || busyMockup !== ''}
									onchange={(e) => confirmOwnership(e.currentTarget)}
								/>
								These designs belong to us or to the client
								{#if confirmed}
									<span class="muted">· confirmed by {confirmed.by.name}</span>
								{/if}
							</label>
						</div>
					{/if}
					<label class="notes">
						<span>
							Notes and style
							<span class="muted">
								{images.length > 0
									? '· optional when you upload mockups'
									: '· required without mockups'}
							</span>
						</span>
						<textarea
							rows="3"
							bind:value={notes}
							placeholder="e.g. Recreate the mockups. Keep the layout and palette, make the sea serpent friendlier, and coins must read at 64 px."
						></textarea>
					</label>
				</section>

				<section class="card" aria-label="Checkpoints">
					<h2>Checkpoints</h2>
					<p class="hint">Where the agents stop and wait for you. In between they keep working.</p>
					<label class="checkpoint">
						<input type="checkbox" bind:checked={cpBreakdown} />
						<span class="cp-text">
							<strong>Mockup breakdown</strong>
							<span>
								See what the agents found in each mockup and where it goes, before any rendering.
								Without mockups, this is a style board.
							</span>
						</span>
						<span class="chip feature">Recommended</span>
					</label>
					<label class="checkpoint">
						<input type="checkbox" bind:checked={cpArtPlan} />
						<span class="cp-text">
							<strong>Art plan</strong>
							<span>
								See how each region will be made — the Atlas Maker pipelines, sizes and variants —
								and what it will cost, before anything renders.
							</span>
						</span>
						<span class="chip feature">Recommended</span>
					</label>
					<label class="checkpoint">
						<input type="checkbox" bind:checked={cpRegionBatch} />
						<span class="cp-text">
							<strong>After each region batch</strong>
							<span>Review symbols, coins, backgrounds and UI before the next batch.</span>
						</span>
					</label>
					<label class="checkpoint">
						<input type="checkbox" checked disabled />
						<span class="cp-text">
							<strong>Before publishing</strong>
							<span
								>The agents build and test the game. Publishing stays with you in Game Maker.</span
							>
						</span>
						<span class="chip locked">Always</span>
					</label>
				</section>

				<div class="actions">
					<button
						type="button"
						class="primary"
						disabled={creating || !offer || !templateKey || unpriced}
						onclick={createAndStart}
					>
						{createStage || 'Create project & start agents'}
					</button>
					<span class="muted">
						Creates <span class="mono">{createTarget}</span> on main, the same way Game Maker does.
					</span>
				</div>
				{#if createErr}<p class="err" role="alert">{createErr}</p>{/if}

				{#if runs.length > 0}
					<section class="card" aria-label="Your runs">
						<h2>Your runs</h2>
						<table class="runs">
							<thead>
								<tr><th>Game</th><th>Template</th><th>State</th><th>Spent</th><th>Created</th></tr>
							</thead>
							<tbody>
								{#each runs as run (run.id)}
									<tr>
										<td>
											<a href={resolve('/(app)/director/[runId]', { runId: run.id })}>
												{run.name ?? run.projectKey}
											</a>
											<span class="mono small">{run.projectKey}</span>
										</td>
										<td class="mono small">{run.templateProjectKey}</td>
										<td>{statusLabel(run)}</td>
										<td>
											{usd(run.spentUsd)}{#if run.budgetCapUsd !== null}
												<span class="muted">of {usd(run.budgetCapUsd)}</span>{/if}
										</td>
										<td class="muted">{fmtDate(run.createdAt)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
				{/if}
			</div>

			<aside class="card summary" aria-label="Run summary">
				<h2>What this run will do</h2>
				<p class="hint">Filled in from your selections.</p>

				<h3>Agents</h3>
				<ul class="rows">
					{#each offer?.agents ?? [] as a (a.agent)}
						<li>
							<span class="two-line">
								<strong>{AGENT_BLURBS[a.agent]?.name ?? a.agent}</strong>
								<span class="muted">{AGENT_BLURBS[a.agent]?.does ?? ''}</span>
							</span>
							<span class="mono small">{modelLabel(a.model)}</span>
						</li>
					{/each}
				</ul>

				<h3>Regions from the template</h3>
				{#if template}
					<ul class="rows tight">
						{#each template.regionGroups as g (g.atlas)}
							<li><span>{g.atlas}</span><span>{g.regions}</span></li>
						{/each}
						<li class="total"><span>Total</span><span>{templateRegions}</span></li>
					</ul>
					{#if template.regionGroups.length === 0}
						<p class="muted">This template has no Atlas Maker manifest yet.</p>
					{/if}
				{:else}
					<p class="muted">Pick a template.</p>
				{/if}

				<h3>Estimate</h3>
				{#if estimate}
					{@const est = estimate.estimate}
					<ul class="rows tight">
						<li><span>Claude API</span><span>{usdRange(est.claude.usd)}</span></li>
						<li>
							<span>RunPod{est.runpod.gpu ? ` ${est.runpod.gpu}` : ''}</span>
							<span>
								~{Math.round(est.runpod.minutes.low)}–{Math.round(est.runpod.minutes.high)} min ·
								{est.runpod.usd ? usdRange(est.runpod.usd) : 'not priced'}
							</span>
						</li>
						<li>
							<span>Your reviews</span>
							<span>{est.checkpoints} checkpoint{est.checkpoints === 1 ? '' : 's'}</span>
						</li>
						<li class="total">
							<span>Total</span>
							<span>
								{totalUsd
									? `${usdRange(totalUsd)} of a ${usd(estimate.budgetCapUsd)} cap`
									: 'Unknown'}
							</span>
						</li>
					</ul>
					{#if unpriced}
						<p class="err">
							The GPU side cannot be priced, so no run starts on this estimate: {est.unpriced.join(
								'; ',
							)}.
						</p>
					{:else}
						<div
							class="cap"
							class:over={overCap}
							title="The high end of the estimate against the cap"
						>
							<div class="fill" style="width:{capShare}%"></div>
						</div>
					{/if}
					{#if overCap}
						<p class="warn">
							The high end is over the cap. The run pauses at {usd(estimate.budgetCapUsd)} and asks you
							to raise it or stop.
						</p>
					{/if}
					{#if estimate.chains.length}
						<ul class="rows tight" aria-label="Recipes priced">
							{#each estimate.chains as c (c.group)}
								<li>
									<span>{c.regions} × {c.group}</span>
									<span
										class="mono small"
										title={c.source === 'fallback'
											? 'No approved default for this template yet: the fallback chain'
											: `This template's ${c.source}`}>{c.chain}</span
									>
								</li>
							{/each}
						</ul>
					{/if}
					{#if est.placeholder}
						<p class="muted">
							Placeholder figures until the pilot measures real runs: blueprint cards whose GPU
							seconds are a guess are priced up to the profiles' figure. Analysing {analysedMockups}
							mockup{analysedMockups === 1 ? '' : 's'}, {templateRegions} regions, {est.runpod
								.reviewedVariants}
							variants to review.
						</p>
					{/if}
				{:else if estimateErr}
					<p class="err">{estimateErr}</p>
				{:else if estimating || templateKey}
					<p class="muted">Estimating…</p>
				{:else}
					<p class="muted">Pick a template.</p>
				{/if}
			</aside>
		</div>
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
		padding: 28px 24px 56px;
	}
	.columns {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		align-items: flex-start;
	}
	.form {
		flex: 1 1 640px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.summary {
		flex: 1 1 340px;
		max-width: 440px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.card {
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		padding: 20px;
	}
	h1,
	h2 {
		margin: 0 0 4px;
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.02em;
		color: #e8e8ee;
	}
	h3 {
		margin: 14px 0 2px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	.hint,
	.muted {
		color: #9a9aa6;
		font-size: 13px;
		margin: 0 0 12px;
	}
	.muted {
		margin: 0;
	}
	.err {
		color: #ff8c8c;
		font-size: 13px;
		margin: 6px 0 0;
	}
	.warn {
		color: #f5cf7a;
		font-size: 12px;
		margin: 6px 0 0;
	}
	.field-err {
		font-weight: 400;
		color: #ff8c8c;
	}
	.grid {
		display: grid;
		gap: 12px;
	}
	.grid.four {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
	select,
	textarea {
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		padding: 8px 10px;
		font-size: 13px;
		font-weight: 400;
		font-family: inherit;
		min-height: 36px;
	}
	textarea {
		min-height: 84px;
		resize: vertical;
		line-height: 1.5;
	}
	input:focus,
	select:focus,
	textarea:focus {
		outline: none;
		border-color: #3a8f74;
	}
	input:disabled,
	select:disabled {
		opacity: 0.6;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
	}
	.small {
		font-size: 11px;
		color: #8a8a96;
	}
	/* The template's GAME / USING / LOCKED rows, as Game Maker's card draws them. */
	.profile {
		display: grid;
		grid-template-columns: 60px minmax(0, 1fr);
		gap: 8px 10px;
		align-items: start;
		margin-top: 12px;
	}
	.row-label {
		padding-top: 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
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
	.chip.warn {
		background: #2a2113;
		border-color: #6b4f1d;
		color: #f0c674;
	}
	.chip.locked {
		background: #1b1b22;
		border-color: #2c2c38;
		color: #c9c9d1;
	}
	.chip.locked svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}
	.chip.none {
		color: #62626e;
		border-color: #26262f;
	}
	/* Mockup cards. */
	.mockups {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.mockup {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 210px;
		padding: 8px;
		background: #16161c;
		border: 1px solid #222;
		border-radius: 10px;
	}
	.mockup.busy {
		opacity: 0.6;
	}
	.thumb {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 10;
		height: auto;
		object-fit: cover;
		border-radius: 6px;
		background: #0d0d12;
	}
	.mockup-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.mockup select {
		min-height: 30px;
		padding: 4px 8px;
		font-size: 12px;
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
		font-family: inherit;
	}
	button:hover:not(:disabled) {
		border-color: #3a3a48;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	button.icon {
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		color: #9a9aa6;
		font-size: 14px;
		line-height: 1;
	}
	button.add {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 210px;
		min-height: 186px;
		padding: 12px;
		background: transparent;
		border: 1px dashed #3a3a48;
		border-radius: 10px;
		color: #b9b9c4;
		font-size: 12px;
	}
	button.add span {
		font-weight: 400;
		color: #9a9aa6;
	}
	.fidelity-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 14px;
	}
	.seg {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 3px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 10px;
	}
	.seg label {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 8px;
		color: #b9b9c4;
		font-size: 12px;
		cursor: pointer;
	}
	.seg label.on {
		background: #1f6f57;
		color: #eafff6;
	}
	.seg input {
		margin: 0;
		min-height: 0;
		accent-color: #7ee0c0;
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 8px;
		font-weight: 400;
		color: #c9c9d1;
		cursor: pointer;
	}
	.check.required {
		color: #f5cf7a;
	}
	.check input {
		width: 16px;
		height: 16px;
		min-height: 0;
		margin: 0;
		accent-color: #2b8d6f;
	}
	.notes {
		margin-top: 14px;
	}
	.notes .muted {
		display: inline;
		font-weight: 400;
	}
	.checkpoint {
		flex-direction: row;
		align-items: center;
		gap: 12px;
		min-height: 52px;
		padding: 8px 0;
		border-top: 1px solid #1d1d24;
		cursor: pointer;
	}
	.checkpoint input {
		width: 18px;
		height: 18px;
		min-height: 0;
		margin: 0;
		accent-color: #2b8d6f;
		flex-shrink: 0;
	}
	.cp-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-grow: 1;
		font-weight: 400;
	}
	.cp-text strong {
		font-size: 14px;
		font-weight: 600;
		color: #e8e8ee;
	}
	.cp-text span {
		font-size: 12px;
		color: #9a9aa6;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.primary {
		min-height: 40px;
		padding: 0 18px;
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
		font-size: 14px;
	}
	.primary:hover:not(:disabled) {
		background: #26846a;
		border-color: #34a784;
	}
	/* The aside's rows and the runs table. */
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		font-size: 13px;
	}
	.rows li {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid #1d1d24;
	}
	.rows.tight li {
		padding: 6px 0;
	}
	.rows li:last-child {
		border-bottom: 0;
	}
	.rows li.total {
		font-weight: 700;
	}
	.two-line {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.two-line strong {
		font-size: 13px;
		font-weight: 600;
	}
	.two-line .muted {
		font-size: 12px;
	}
	.cap {
		height: 6px;
		margin-top: 8px;
		border-radius: 3px;
		background: #0d0d12;
		border: 1px solid #23232e;
		overflow: hidden;
	}
	.cap .fill {
		height: 100%;
		background: #2b8d6f;
	}
	.cap.over .fill {
		background: #a67c1a;
	}
	.runs {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.runs th {
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
		padding: 6px 8px 6px 0;
		border-bottom: 1px solid #1d1d24;
	}
	.runs td {
		padding: 8px 8px 8px 0;
		border-bottom: 1px solid #1d1d24;
		vertical-align: top;
	}
	.runs td .small {
		display: block;
	}
	.runs a {
		color: #7ee0c0;
		text-decoration: none;
	}
	.runs a:hover {
		color: #a8f0d8;
	}
</style>
