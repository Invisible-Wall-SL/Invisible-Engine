<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import type {
		LocalizationDoc,
		LocalizationEntry,
		LocalizationTranslation,
	} from '$lib/server/localization';
	import type { DisplaySection } from '$lib/server/localizationHarvest';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Working copy of the document, driven by runes. The server load is the
	// initial state; everything edits this and `save` posts it back as JSON.
	let sourceLang = $state(data.doc.sourceLang);
	let targetLangs = $state<string[]>([...data.doc.targetLangs]);
	let context = $state(data.doc.context);
	let entries = $state<LocalizationEntry[]>(structuredClone(data.doc.entries));

	// Auto-collected text (Scene Editor screens + the Win Text templates), grouped into sections
	// with read-only sources — the tool that authored each string owns it.
	const sections = $derived<DisplaySection[]>(data.sections ?? []);
	const byKey = $derived(new Map(entries.map((e) => [e.key, e])));
	const harvestedKeys = $derived(new Set(sections.flatMap((s) => s.keys)));
	// Hand-authored rows live in their own section. Tests `=== 'manual'` rather than `!== 'editor'`
	// so a non-editor auto origin (e.g. `winText`) isn't mistaken for a hand-authored row and
	// rendered with an editable source.
	const manualEntries = $derived(entries.filter((e) => e.origin === 'manual'));
	// Auto-collected rows whose source no longer exists in its owning tool, but that carry saved
	// translations worth keeping (and letting the user delete).
	const orphanEntries = $derived(
		entries.filter((e) => e.origin !== 'manual' && !harvestedKeys.has(e.key)),
	);

	function sectionEntries(section: DisplaySection): LocalizationEntry[] {
		return section.keys.map((k) => byKey.get(k)).filter((e): e is LocalizationEntry => !!e);
	}

	let newLang = $state('');
	let status = $state('');
	/** Translate-flow spinner. `busy` (below) is the union with the save machine's busy so
	 * every shared `disabled={busy}` site keeps its old "either operation in flight" meaning. */
	let translating = $state(false);

	const docPayload = $derived<LocalizationDoc>({
		sourceLang,
		targetLangs,
		context,
		entries,
		updatedAt: data.doc.updatedAt,
	});

	/**
	 * Save-state machine (multi-user-concurrency Phase 2a). Manual save via the form action;
	 * the transport owns the FormData encoding, including the caller-side create path (the
	 * EMPTY STRING encodes "no doc existed" — FormData has no null). A conflict is surfaced by
	 * the wrapper's `confirm()`; `force` (`force=1`) drops the precondition.
	 */
	const saveState = new SaveState({
		initialEtag: data.docEtag,
		conflictMessage: 'Someone else saved these strings while you were editing.',
		save: async ({ baseEtag, force }) => {
			status = 'Saving…';
			try {
				const fields: Record<string, string> = { doc: JSON.stringify(docPayload) };
				if (force) fields.force = '1';
				else fields.baseEtag = baseEtag ?? '';
				const out = (await postAction('save', fields)) as {
					saved?: boolean;
					etag?: string | null;
					error?: string;
					conflict?: boolean;
				};
				if (out.conflict) return { ok: false, reason: 'conflict', message: out.error };
				if (out.error) return { ok: false, reason: 'error', message: out.error };
				status = 'Saved.';
				return { ok: true, etag: out.etag ?? null };
			} catch {
				return { ok: false, reason: 'error', message: 'Save failed.' };
			}
		},
	});
	/** Union of the two in-flight flags — preserves every shared `disabled={busy}`. */
	const busy = $derived(translating || saveState.busy);

	function markDirty() {
		saveState.markDirty();
		status = '';
	}

	function newId(): string {
		// Prefer crypto.randomUUID, but fall back so a missing/blocked Web Crypto
		// (non-secure context, older browser) can't break "Add row".
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	}

	function addEntry() {
		entries.push({ id: newId(), key: '', source: '', translations: {}, origin: 'manual' });
		markDirty();
	}

	function deleteEntry(id: string) {
		entries = entries.filter((e) => e.id !== id);
		markDirty();
	}

	function addLang() {
		// Accept a single code or a comma/space-separated list (e.g. "es, fr, it").
		const tokens = newLang
			.split(/[\s,]+/)
			.map((t) => t.trim().toLowerCase())
			.filter(Boolean);
		let added = false;
		for (const lang of tokens) {
			if (!targetLangs.includes(lang)) {
				targetLangs.push(lang);
				added = true;
			}
		}
		newLang = '';
		if (added) markDirty();
	}

	function removeLang(lang: string) {
		targetLangs = targetLangs.filter((l) => l !== lang);
		for (const e of entries) delete e.translations[lang];
		markDirty();
	}

	function cell(entry: LocalizationEntry, lang: string): LocalizationTranslation {
		return (entry.translations[lang] ??= { text: '', reviewed: false });
	}

	// Editing a translation cell implies a human touched it -> reviewed.
	function editTranslation(entry: LocalizationEntry, lang: string, text: string) {
		entry.translations[lang] = { text, reviewed: true };
		markDirty();
	}

	function toggleReviewed(entry: LocalizationEntry, lang: string) {
		const c = cell(entry, lang);
		c.reviewed = !c.reviewed;
		markDirty();
	}

	function isUnreviewed(entry: LocalizationEntry, lang: string): boolean {
		const c = entry.translations[lang];
		return !!c && !!c.text && !c.reviewed;
	}

	function untranslatedIds(): string[] {
		return entries
			.filter(
				(e) =>
					e.source.trim() &&
					targetLangs.some((l) => !(e.translations[l] && e.translations[l].text)),
			)
			.map((e) => e.id);
	}

	async function postAction(action: string, body: Record<string, string>): Promise<unknown> {
		const fd = new FormData();
		for (const [k, v] of Object.entries(body)) fd.set(k, v);
		// Preserve the page's explicit `?project=` (project-explicit scoping) so the
		// save targets the SAME project the page loaded; a bare `?/save` would drop
		// the query and fall back to the session scope. No `?project=` ⇒ `?/save`,
		// byte-identical to before.
		const existing = location.search.replace(/^\?/, '');
		const target = existing ? `?/${action}&${existing}` : `?/${action}`;
		const res = await fetch(target, { method: 'POST', body: fd });
		const json = (await res.json()) as { type: string; data?: string };
		// SvelteKit serializes action results as a flattened, indexed array under
		// `data`; the first element is the top-level object with index refs.
		if (!json.data) return {};
		const parsed = JSON.parse(json.data) as unknown[];
		const root = parsed[0] as Record<string, number>;
		const out: Record<string, unknown> = {};
		for (const [key, idx] of Object.entries(root)) out[key] = parsed[idx];
		return out;
	}

	/** `force` = the author confirming "overwrite theirs" after a conflict. On a conflict the
	 *  local edits stay on screen (helper keeps `dirty`) — declining loses nothing. */
	async function save(force = false) {
		await saveState.save({ force });
		if (saveState.status === 'error') {
			status = saveState.message;
		} else if (saveState.status === 'conflict') {
			const msg = saveState.message;
			status = msg;
			if (!force && confirm(`${msg}\n\nOverwrite their version with yours?`)) await save(true);
		}
	}

	async function translate(ids: string[]) {
		if (targetLangs.length === 0) {
			status = 'Add at least one target language first.';
			return;
		}
		if (ids.length === 0) {
			status =
				entries.length === 0
					? 'No strings yet — add a row and write the source text first.'
					: 'Nothing to translate — every string already has all languages.';
			return;
		}
		translating = true;
		status = 'Translating…';
		try {
			const out = (await postAction('translate', {
				doc: JSON.stringify(docPayload),
				ids: JSON.stringify(ids),
			})) as { translations?: Record<string, Record<string, string>>; error?: string };
			if (out.error) {
				status = out.error;
				return;
			}
			const translations = out.translations ?? {};
			for (const entry of entries) {
				const row = translations[entry.id];
				if (!row) continue;
				for (const [lang, text] of Object.entries(row)) {
					entry.translations[lang] = { text, reviewed: false };
				}
			}
			saveState.setDirty(true);
			status = 'Translated. Review the highlighted cells, then Save.';
		} catch {
			status = 'Translation failed.';
		} finally {
			translating = false;
		}
	}
</script>

<svelte:head><title>Invisible Localization — Invisible Wall</title></svelte:head>

<div class="shell">
	<ToolTopBar current="localization" tools={data.tools} projectKey={data.projectKey}>
		{#snippet meta()}
			<span class="project">Project: <strong>{data.projectKey}</strong></span>
			{#if status}<span class="status">{status}</span>{/if}
			<!-- NOTE: `onclick={save}` passes the click EVENT as `force` (truthy), so a manual Save
			     has always been a FORCE overwrite here — preserved verbatim by this refactor. This is a
			     pre-existing latent bug (localization's conflict `confirm()` is therefore effectively
			     dead on the button path); flagged for the owner, not silently "fixed". -->
			<button class="primary" onclick={save} disabled={busy || !saveState.dirty}>Save</button>
		{/snippet}
	</ToolTopBar>

	<section class="settings">
		<h2>Global settings</h2>
		<div class="row">
			<label>
				Source language
				<input
					value={sourceLang}
					oninput={(e) => {
						sourceLang = e.currentTarget.value;
						markDirty();
					}}
					placeholder="en"
					spellcheck="false"
				/>
			</label>
			<div class="langs">
				<span class="lbl">Target languages</span>
				<div class="chips">
					{#each targetLangs as lang (lang)}
						<span class="chip">
							{lang}
							<button class="x" title="Remove" onclick={() => removeLang(lang)}>×</button>
						</span>
					{:else}
						<span class="muted">None yet — add one.</span>
					{/each}
				</div>
				<div class="addlang">
					<input
						bind:value={newLang}
						placeholder="e.g. es, fr, de, ja"
						spellcheck="false"
						onkeydown={(e) => e.key === 'Enter' && addLang()}
					/>
					<button onclick={addLang}>Add</button>
				</div>
			</div>
		</div>
		<label class="ctx">
			Context / glossary (tone, domain, term preferences — guides every translation)
			<textarea
				value={context}
				oninput={(e) => {
					context = e.currentTarget.value;
					markDirty();
				}}
				rows="3"
				placeholder="e.g. Casino slot game. Keep it punchy. 'Spin' stays 'Spin'."
			></textarea>
		</label>
	</section>

	{#snippet langHeaders()}
		{#each targetLangs as lang (lang)}
			<th>{lang}</th>
		{/each}
	{/snippet}

	{#snippet langCells(entry: LocalizationEntry)}
		{#each targetLangs as lang (lang)}
			<td class:unreviewed={isUnreviewed(entry, lang)}>
				<div class="cell">
					<textarea
						value={entry.translations[lang]?.text ?? ''}
						oninput={(e) => editTranslation(entry, lang, e.currentTarget.value)}
						rows="1"
						placeholder="—"
					></textarea>
					{#if entry.translations[lang]?.text}
						<button
							class="dot"
							class:on={entry.translations[lang]?.reviewed}
							aria-label={entry.translations[lang]?.reviewed ? 'Reviewed' : 'Unreviewed'}
							title={entry.translations[lang]?.reviewed
								? 'Reviewed (click to mark unreviewed)'
								: 'Unreviewed (click to mark reviewed)'}
							onclick={() => toggleReviewed(entry, lang)}
						></button>
					{/if}
				</div>
			</td>
		{/each}
	{/snippet}

	<!-- Auto-collected rows: the source text is read-only (the Scene Editor owns it);
	     only the translations are editable. `deletable` is for orphaned rows. -->
	{#snippet autoTable(rows: LocalizationEntry[], deletable: boolean)}
		<table>
			<thead>
				<tr>
					<th>Source ({sourceLang || 'src'})</th>
					{@render langHeaders()}
					<th class="row-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as entry (entry.id)}
					<tr>
						<td class="src-col"><div class="src-ro" title={entry.source}>{entry.source}</div></td>
						{@render langCells(entry)}
						<td class="row-actions">
							<button
								class="ghost-sm"
								disabled={busy}
								title="Translate this row"
								onclick={() => translate([entry.id])}
							>
								T
							</button>
							{#if deletable}
								<button
									class="ghost-sm danger"
									title="Delete row"
									onclick={() => deleteEntry(entry.id)}
								>
									×
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/snippet}

	<section class="table-wrap">
		<div class="toolbar">
			<h2>Strings</h2>
			<div class="actions">
				<button class="accent" disabled={busy} onclick={() => translate(untranslatedIds())}>
					Translate all missing
				</button>
			</div>
		</div>

		<p class="hint">
			Text components placed in the <strong>Scene Editor</strong> are collected automatically below,
			grouped by screen. Their source text stays in sync with the editor (edit it there); here you
			fill in or translate each language. Use <strong>Manual strings</strong> for text that isn't an
			editor component.
		</p>

		{#each sections as section (section.sceneId)}
			<div class="block">
				<div class="block-head">
					<h3>{section.sceneName}</h3>
					<span class="count">{section.keys.length} text{section.keys.length === 1 ? '' : 's'}</span
					>
				</div>
				{@render autoTable(sectionEntries(section), false)}
			</div>
		{/each}

		{#if orphanEntries.length}
			<div class="block">
				<div class="block-head">
					<h3>No longer in use</h3>
					<span class="count muted"
						>{orphanEntries.length} removed from the Scene Editor or Win Text — delete if unused</span
					>
				</div>
				{@render autoTable(orphanEntries, true)}
			</div>
		{/if}

		<div class="block">
			<div class="block-head">
				<h3>Manual strings</h3>
				<div class="actions"><button onclick={addEntry}>+ Add row</button></div>
			</div>
			<table>
				<thead>
					<tr>
						<th class="key-col">Key</th>
						<th>Source ({sourceLang || 'src'})</th>
						{@render langHeaders()}
						<th class="row-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each manualEntries as entry (entry.id)}
						<tr>
							<td class="key-col">
								<input
									value={entry.key}
									oninput={(e) => {
										entry.key = e.currentTarget.value;
										markDirty();
									}}
									placeholder="ui.spin"
									spellcheck="false"
								/>
							</td>
							<td>
								<textarea
									value={entry.source}
									oninput={(e) => {
										entry.source = e.currentTarget.value;
										markDirty();
									}}
									rows="1"
									placeholder="Source text"
								></textarea>
							</td>
							{@render langCells(entry)}
							<td class="row-actions">
								<button
									class="ghost-sm"
									disabled={busy}
									title="Translate this row"
									onclick={() => translate([entry.id])}
								>
									T
								</button>
								<button
									class="ghost-sm danger"
									title="Delete row"
									onclick={() => deleteEntry(entry.id)}
								>
									×
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td class="empty" colspan={3 + targetLangs.length}>
								No manual strings. Scene Editor text appears above automatically; add a row here for
								anything else.
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>

<style>
	.shell {
		width: 100%;
		box-sizing: border-box;
		padding: 24px clamp(20px, 3vw, 40px);
		color: #e8e8ee;
	}
	.project strong {
		color: #c8a3ff;
	}
	.status {
		color: #7ee0c0;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 0 0 12px;
	}
	.muted {
		color: #777;
		font-size: 13px;
	}
	.settings {
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 18px;
		margin-bottom: 20px;
	}
	.settings .row {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: #999;
	}
	.langs {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.lbl {
		font-size: 12px;
		color: #999;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: #2a2430;
		color: #c8a3ff;
		padding: 3px 4px 3px 10px;
		border-radius: 999px;
		font-size: 13px;
	}
	.chip .x {
		background: transparent;
		border: none;
		color: #c8a3ff;
		cursor: pointer;
		font-size: 15px;
		line-height: 1;
		padding: 0 4px;
	}
	.addlang {
		display: flex;
		gap: 8px;
	}
	.ctx {
		width: 100%;
	}
	input,
	textarea {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-family: inherit;
		resize: vertical;
	}
	textarea {
		min-height: 34px;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: #6b5bff;
	}
	button {
		border: 1px solid #333;
		background: transparent;
		color: #ccc;
		padding: 8px 14px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
	}
	button:hover:not(:disabled) {
		border-color: #6b5bff;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		background: #6b5bff;
		border-color: #6b5bff;
		color: #fff;
	}
	button.accent {
		background: #1f2d23;
		border-color: #2f5340;
		color: #7ee787;
	}
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.toolbar h2 {
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th,
	td {
		border: 1px solid #222;
		padding: 4px;
		vertical-align: top;
		text-align: left;
	}
	th {
		background: #16161c;
		color: #999;
		font-weight: 600;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 8px;
	}
	td input,
	td textarea {
		width: 100%;
		box-sizing: border-box;
	}
	.key-col {
		width: 160px;
	}
	.key-col input {
		font-family: ui-monospace, monospace;
	}
	td.unreviewed {
		background: #2a2410;
	}
	.cell {
		display: flex;
		gap: 4px;
		align-items: flex-start;
	}
	.cell textarea {
		flex: 1;
	}
	.dot {
		flex: none;
		width: 12px;
		height: 12px;
		padding: 0;
		margin-top: 10px;
		border-radius: 50%;
		border: 1px solid #6a6a2a;
		background: #d6b94a;
	}
	.dot.on {
		border-color: #2f5340;
		background: #7ee787;
	}
	.row-actions {
		width: 70px;
		white-space: nowrap;
		text-align: center;
	}
	.ghost-sm {
		padding: 4px 8px;
		font-size: 12px;
	}
	.ghost-sm.danger {
		color: #ff7a7a;
	}
	td.empty {
		text-align: center;
		color: #777;
		padding: 24px;
	}
	.hint {
		color: #999;
		font-size: 13px;
		line-height: 1.5;
		margin: 0 0 20px;
		max-width: 78ch;
	}
	.hint strong {
		color: #c8a3ff;
		font-weight: 600;
	}
	.block {
		margin-bottom: 24px;
	}
	.block-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}
	.block-head h3 {
		font-size: 13px;
		margin: 0;
		color: #e8e8ee;
		font-weight: 600;
	}
	.count {
		font-size: 12px;
		color: #777;
	}
	.count.muted {
		color: #c98a4a;
	}
	.src-col {
		width: 32%;
	}
	.src-ro {
		padding: 8px 10px;
		color: #cfcfd6;
		font-size: 13px;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
