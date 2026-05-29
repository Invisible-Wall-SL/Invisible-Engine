<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import type {
		LocalizationDoc,
		LocalizationEntry,
		LocalizationTranslation,
	} from '$lib/server/localization';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Working copy of the document, driven by runes. The server load is the
	// initial state; everything edits this and `save` posts it back as JSON.
	let sourceLang = $state(data.doc.sourceLang);
	let targetLangs = $state<string[]>([...data.doc.targetLangs]);
	let context = $state(data.doc.context);
	let entries = $state<LocalizationEntry[]>(structuredClone(data.doc.entries));

	let newLang = $state('');
	let status = $state('');
	let busy = $state(false);
	let dirty = $state(false);

	function markDirty() {
		dirty = true;
		status = '';
	}

	const docPayload = $derived<LocalizationDoc>({
		sourceLang,
		targetLangs,
		context,
		entries,
		updatedAt: data.doc.updatedAt,
	});

	function addEntry() {
		entries.push({ id: crypto.randomUUID(), key: '', source: '', translations: {} });
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
		const res = await fetch(`?/${action}`, { method: 'POST', body: fd });
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

	async function save() {
		busy = true;
		status = 'Saving…';
		try {
			const out = (await postAction('save', { doc: JSON.stringify(docPayload) })) as {
				saved?: boolean;
				error?: string;
			};
			if (out.error) {
				status = out.error;
			} else {
				dirty = false;
				status = 'Saved.';
			}
		} catch {
			status = 'Save failed.';
		} finally {
			busy = false;
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
		busy = true;
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
			dirty = true;
			status = 'Translated. Review the highlighted cells, then Save.';
		} catch {
			status = 'Translation failed.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Invisible Localization — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<a class="brand" href="/"><Emblem height={18} /> INVISIBLE LOCALIZATION</a>
		<div class="meta">
			<span class="project">Project: <strong>{data.projectKey}</strong></span>
			{#if status}<span class="status">{status}</span>{/if}
			<button class="primary" onclick={save} disabled={busy || !dirty}>Save</button>
		</div>
	</header>

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

	<section class="table-wrap">
		<div class="toolbar">
			<h2>Strings</h2>
			<div class="actions">
				<button onclick={addEntry}>+ Add row</button>
				<button class="accent" disabled={busy} onclick={() => translate(untranslatedIds())}>
					Translate all missing
				</button>
			</div>
		</div>

		<table>
			<thead>
				<tr>
					<th class="key-col">Key</th>
					<th>Source ({sourceLang || 'src'})</th>
					{#each targetLangs as lang (lang)}
						<th>{lang}</th>
					{/each}
					<th class="row-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each entries as entry (entry.id)}
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
						{#each targetLangs as lang (lang)}
							<td class:unreviewed={isUnreviewed(entry, lang)}>
								<div class="cell">
									<textarea
										value={cell(entry, lang).text}
										oninput={(e) => editTranslation(entry, lang, e.currentTarget.value)}
										rows="1"
										placeholder="—"
									></textarea>
									{#if cell(entry, lang).text}
										<button
											class="dot"
											class:on={cell(entry, lang).reviewed}
											aria-label={cell(entry, lang).reviewed ? 'Reviewed' : 'Unreviewed'}
											title={cell(entry, lang).reviewed
												? 'Reviewed (click to mark unreviewed)'
												: 'Unreviewed (click to mark reviewed)'}
											onclick={() => toggleReviewed(entry, lang)}
										></button>
									{/if}
								</div>
							</td>
						{/each}
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
							No strings yet. Add a row to start writing the game's text.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>

<style>
	.shell {
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px;
		color: #e8e8ee;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
		text-decoration: none;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 13px;
		color: #888;
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
</style>
