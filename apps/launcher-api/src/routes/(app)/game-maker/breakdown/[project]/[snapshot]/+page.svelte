<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const b = $derived(data.breakdown);

	const CATEGORY_COLORS: Record<string, string> = {
		art: '#6c8cff',
		symbols: '#c77dff',
		pages: '#4cc9a7',
		fonts: '#f4a259',
		sounds: '#f25f5c',
		boot: '#ffd166',
		data: '#8d99ae',
		other: '#5c5c6a',
	};
	const colorOf = (id: string) => CATEGORY_COLORS[id] ?? '#5c5c6a';
	const labelOf = (id: string) => b.categories.find((c) => c.id === id)?.label ?? id;

	function fmt(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MB`;
	}
	const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
	const pct = (n: number) => (b.totals.bytes ? `${((n / b.totals.bytes) * 100).toFixed(1)}%` : '—');
	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	// ── Filters ────────────────────────────────────────────────────────────────────
	let category = $state<string>('all');

	let assetQuery = $state('');
	let assetType = $state('all');
	let assetSort = $state<'bytes' | 'uses' | 'name'>('bytes');
	const assetTypes = $derived([...new Set(b.assets.map((a) => a.type))].sort());
	const assets = $derived.by(() => {
		const q = assetQuery.trim().toLowerCase();
		return b.assets
			.filter((a) => category === 'all' || a.category === category)
			.filter((a) => assetType === 'all' || a.type === assetType)
			.filter(
				(a) =>
					!q ||
					a.name.toLowerCase().includes(q) ||
					a.key.toLowerCase().includes(q) ||
					a.usedIn.some((u) => u.where.toLowerCase().includes(q)),
			)
			.sort((x, y) =>
				assetSort === 'name'
					? x.name.localeCompare(y.name)
					: assetSort === 'uses'
						? y.uses - x.uses || y.bytes - x.bytes
						: y.bytes - x.bytes,
			);
	});

	const FILE_PAGE = 200;
	let fileQuery = $state('');
	let fileKind = $state('all');
	let fileSort = $state<'bytes' | 'refs' | 'rel'>('bytes');
	let onlyUnreferenced = $state(false);
	let fileLimit = $state(FILE_PAGE);
	const fileKinds = $derived([...new Set(b.files.map((f) => f.kind))].sort());
	const files = $derived.by(() => {
		const q = fileQuery.trim().toLowerCase();
		return b.files
			.filter((f) => category === 'all' || f.category === category)
			.filter((f) => fileKind === 'all' || f.kind === fileKind)
			.filter((f) => !onlyUnreferenced || f.refs === 0)
			.filter((f) => !q || f.rel.toLowerCase().includes(q))
			.sort((x, y) =>
				fileSort === 'rel'
					? x.rel.localeCompare(y.rel)
					: fileSort === 'refs'
						? y.refs - x.refs || y.bytes - x.bytes
						: y.bytes - x.bytes,
			);
	});
	const filesBytes = $derived(files.reduce((s, f) => s + f.bytes, 0));

	// ── Downloads ──────────────────────────────────────────────────────────────────
	function download(name: string, type: string, body: string) {
		const url = URL.createObjectURL(new Blob([body], { type }));
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}
	const csvCell = (v: string | number) => {
		const s = String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const baseName = $derived(`${data.project}-${b.snapshot.id}`);
	function downloadFilesCsv() {
		const head = [
			'path',
			'category',
			'kind',
			'bytes',
			'refs',
			'referrers',
			'width',
			'height',
			'duplicate_of',
		];
		const lines = b.files.map((f) =>
			[
				f.rel,
				labelOf(f.category),
				f.kind,
				f.bytes,
				f.refs,
				f.referrers.join(' | '),
				f.dims?.w ?? '',
				f.dims?.h ?? '',
				f.duplicateOf ?? '',
			]
				.map(csvCell)
				.join(','),
		);
		download(`${baseName}-files.csv`, 'text/csv', [head.join(','), ...lines].join('\n'));
	}
	function downloadAssetsCsv() {
		const head = [
			'name',
			'type',
			'category',
			'key',
			'files',
			'bytes',
			'shared_bytes',
			'uses',
			'used_in',
		];
		const lines = b.assets.map((a) =>
			[
				a.name,
				a.type,
				labelOf(a.category),
				a.key,
				a.files.length,
				a.bytes,
				a.sharedBytes,
				a.uses,
				a.usedIn.map((u) => `${u.where} ×${u.count}`).join(' | '),
			]
				.map(csvCell)
				.join(','),
		);
		download(`${baseName}-assets.csv`, 'text/csv', [head.join(','), ...lines].join('\n'));
	}
	const downloadJson = () =>
		download(`${baseName}-breakdown.json`, 'application/json', JSON.stringify(b, null, '\t'));

	const issueCounts = $derived({
		error: b.issues.filter((i) => i.level === 'error').length,
		warn: b.issues.filter((i) => i.level === 'warn').length,
	});
	const ISSUE_PREVIEW = 8;
</script>

<svelte:head><title>Build breakdown · {data.projectName}</title></svelte:head>

<div class="shell">
	<ToolTopBar
		current="gameMaker"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.project}
	/>
	<main>
		<section class="card head">
			<a class="back" href={resolve('/game-maker')}>← Game Maker</a>
			<div class="title-row">
				<h1>Build breakdown — {data.projectName}</h1>
				{#if data.live}<span class="badge live">live</span>{:else}<span class="badge">not live</span
					>{/if}
			</div>
			<p class="meta">
				Published <strong>{when(b.snapshot.createdAt)}</strong>{#if b.snapshot.by}&nbsp;by {b
						.snapshot.by}{/if}
				· runtime <code>{b.snapshot.runtime}</code>
				{#if b.snapshot.engine}· engine {b.snapshot.engine.version} ({b.snapshot.engine
						.shortCommit}){/if}
				· flow {b.snapshot.flow}
				· version <code>{b.snapshot.id}</code>
			</p>
			<div class="toolbar">
				{#if data.versions.length > 1}
					<label class="inline">
						Version
						<select
							value={b.snapshot.id}
							onchange={(e) =>
								goto(
									resolve('/(app)/game-maker/breakdown/[project]/[snapshot]', {
										project: data.project,
										snapshot: e.currentTarget.value,
									}),
								)}
						>
							{#each data.versions as v (v.id)}
								<option value={v.id}>{when(v.createdAt)}</option>
							{/each}
						</select>
					</label>
				{/if}
				<span class="spacer"></span>
				<button onclick={downloadAssetsCsv}>Assets CSV</button>
				<button onclick={downloadFilesCsv}>Files CSV</button>
				<button onclick={downloadJson}>JSON</button>
			</div>
		</section>

		<section class="tiles">
			<div class="tile">
				<span class="k">Shipped</span><span class="v">{fmt(b.totals.bytes)}</span>
				<span class="s">{b.totals.files} files</span>
			</div>
			<div class="tile">
				<span class="k">runtime.json</span><span class="v">{fmt(b.totals.bundleBytes)}</span>
				<span class="s">loaded before any asset</span>
			</div>
			<div class="tile">
				<span class="k">Assets</span><span class="v">{b.assets.length}</span>
				<span class="s">sheets, rigs, fonts, sounds…</span>
			</div>
			<div class="tile">
				<span class="k">GPU memory (est.)</span><span class="v">{fmt(b.totals.gpuBytes)}</span>
				<span class="s">uncompressed pages, high quality</span>
			</div>
			<div class="tile" class:warn={b.totals.unreferencedFiles > 0}>
				<span class="k">Never loaded</span><span class="v">{fmt(b.totals.unreferencedBytes)}</span>
				<span class="s">{b.totals.unreferencedFiles} files</span>
			</div>
			<div class="tile">
				<span class="k">vs previous</span>
				<span class="v">{b.diff ? signed(b.diff.bytesDelta) : '—'}</span>
				<span class="s"
					>{b.diff
						? `+${b.diff.added.length} −${b.diff.removed.length} ~${b.diff.changed.length} files`
						: 'first retained version'}</span
				>
			</div>
		</section>

		<section class="card">
			<div class="section-head">
				<h2>By category</h2>
				<span class="count">click to filter</span>
			</div>
			<div class="bar" role="img" aria-label="Shipped bytes by category">
				{#each b.categories as c (c.id)}
					<span
						style:width={`${b.totals.bytes ? (c.bytes / b.totals.bytes) * 100 : 0}%`}
						style:background={colorOf(c.id)}
						title={`${c.label}: ${fmt(c.bytes)} (${pct(c.bytes)})`}
					></span>
				{/each}
			</div>
			<table class="cats">
				<thead
					><tr
						><th>Category</th><th class="n">Files</th><th class="n">Size</th><th class="n">Share</th
						></tr
					></thead
				>
				<tbody>
					<tr class:sel={category === 'all'} onclick={() => (category = 'all')}>
						<td><span class="dot all"></span>All</td><td class="n">{b.totals.files}</td>
						<td class="n">{fmt(b.totals.bytes)}</td><td class="n">100%</td>
					</tr>
					{#each b.categories as c (c.id)}
						<tr class:sel={category === c.id} onclick={() => (category = c.id)}>
							<td><span class="dot" style:background={colorOf(c.id)}></span>{c.label}</td>
							<td class="n">{c.files}</td><td class="n">{fmt(c.bytes)}</td><td class="n"
								>{pct(c.bytes)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="card">
			<div class="section-head">
				<h2>Checks</h2>
				<span class="count">
					{#if !b.issues.length}nothing to report{:else}{issueCounts.error} errors · {issueCounts.warn}
						warnings{/if}
				</span>
			</div>
			{#if !b.issues.length}
				<p class="muted">
					✓ Every referenced file shipped, nothing dead, no duplicates, no oversized pages.
				</p>
			{/if}
			{#each b.issues as issue (issue.title)}
				<details class="issue {issue.level}" open={issue.level === 'error'}>
					<summary>
						<span class="lvl"
							>{issue.level === 'error' ? '✕' : issue.level === 'warn' ? '⚠' : 'ℹ'}</span
						>
						{issue.title} <span class="count">({issue.items.length})</span>
					</summary>
					<p class="muted">{issue.detail}</p>
					<ul>
						{#each issue.items.slice(0, ISSUE_PREVIEW) as item (item)}<li>
								<code>{item}</code>
							</li>{/each}
					</ul>
					{#if issue.items.length > ISSUE_PREVIEW}
						<details class="more">
							<summary>{issue.items.length - ISSUE_PREVIEW} more</summary>
							<ul>
								{#each issue.items.slice(ISSUE_PREVIEW) as item (item)}<li>
										<code>{item}</code>
									</li>{/each}
							</ul>
						</details>
					{/if}
				</details>
			{/each}
		</section>

		<section class="card">
			<div class="section-head">
				<h2>Assets</h2>
				<span class="count"
					>{assets.length} of {b.assets.length}{category !== 'all'
						? ` · ${labelOf(category)}`
						: ''}</span
				>
			</div>
			<p class="hint">
				Each package the game loads, with every file it pulls in (atlas pages included). <em
					>Uses</em
				> is how many times the game data — scenes, components, symbols, flow, effects — names it.
			</p>
			<div class="filters">
				<input placeholder="Search name, key or where used…" bind:value={assetQuery} />
				<select bind:value={assetType}>
					<option value="all">All types</option>
					{#each assetTypes as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<select bind:value={assetSort}>
					<option value="bytes">Largest first</option>
					<option value="uses">Most used first</option>
					<option value="name">Name</option>
				</select>
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr
							><th>Name</th><th>Type</th><th>Category</th><th class="n">Files</th><th class="n"
								>Size</th
							><th class="n">Uses</th><th>Used in</th></tr
						>
					</thead>
					<tbody>
						{#each assets as a (a.id)}
							<tr class:unused={a.uses === 0}>
								<td title={a.key}>
									<details class="files">
										<summary>{a.name}</summary>
										<ul>
											{#each a.files as f (f)}<li><code>{f}</code></li>{/each}
										</ul>
									</details>
								</td>
								<td>{a.type}</td>
								<td
									><span class="dot" style:background={colorOf(a.category)}></span>{labelOf(
										a.category,
									)}</td
								>
								<td class="n">{a.files.length}</td>
								<td
									class="n"
									title={a.sharedBytes ? `${fmt(a.sharedBytes)} shared with other assets` : ''}
								>
									{fmt(a.bytes)}{#if a.sharedBytes}<span class="shared">*</span>{/if}
								</td>
								<td class="n">{a.uses}</td>
								<td class="where" title={a.usedIn.map((u) => `${u.where} ×${u.count}`).join('\n')}>
									{a.usedIn
										.slice(0, 3)
										.map((u) => `${u.where} ×${u.count}`)
										.join(', ')}{a.usedIn.length > 3 ? ` +${a.usedIn.length - 3}` : ''}
								</td>
							</tr>
						{:else}
							<tr><td colspan="7" class="muted">No assets match.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="foot">* part of the size is atlas pages shared with other assets.</p>
		</section>

		<section class="card">
			<div class="section-head">
				<h2>Files</h2>
				<span class="count">{files.length} of {b.files.length} · {fmt(filesBytes)}</span>
			</div>
			<div class="filters">
				<input placeholder="Search path…" bind:value={fileQuery} />
				<select bind:value={fileKind}>
					<option value="all">All kinds</option>
					{#each fileKinds as k (k)}<option value={k}>{k}</option>{/each}
				</select>
				<select bind:value={fileSort}>
					<option value="bytes">Largest first</option>
					<option value="refs">Most referenced first</option>
					<option value="rel">Path</option>
				</select>
				<label class="inline check"
					><input type="checkbox" bind:checked={onlyUnreferenced} /> Unreferenced only</label
				>
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr
							><th>Path</th><th>Kind</th><th class="n">Size</th><th class="n">Refs</th><th
								>Referenced by</th
							><th class="n">Pixels</th></tr
						>
					</thead>
					<tbody>
						{#each files.slice(0, fileLimit) as f (f.rel)}
							<tr class:unused={f.refs === 0}>
								<td class="path"
									><span
										class="dot"
										style:background={colorOf(f.category)}
										title={labelOf(f.category)}
									></span><code>{f.rel}</code>
									{#if f.duplicateOf}<span class="dup" title={`Same bytes as ${f.duplicateOf}`}
											>dup</span
										>{/if}
								</td>
								<td>{f.kind}</td>
								<td class="n">{fmt(f.bytes)}</td>
								<td class="n">{f.refs}</td>
								<td class="where" title={f.referrers.join('\n')}
									>{f.referrers.slice(0, 2).join(', ')}{f.referrers.length > 2
										? ` +${f.referrers.length - 2}`
										: ''}</td
								>
								<td class="n">{f.dims ? `${f.dims.w}×${f.dims.h}` : ''}</td>
							</tr>
						{:else}
							<tr><td colspan="6" class="muted">No files match.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if files.length > fileLimit}
				<button class="more-btn" onclick={() => (fileLimit = files.length)}
					>Show all {files.length}</button
				>
			{/if}
		</section>

		{#if b.diff}
			<section class="card">
				<div class="section-head">
					<h2>Changes since the previous version</h2>
					<span class="count">{when(b.diff.previousCreatedAt)} · {signed(b.diff.bytesDelta)}</span>
				</div>
				{#if !b.diff.added.length && !b.diff.removed.length && !b.diff.changed.length}
					<p class="muted">No file changed — same assets as the previous version.</p>
				{/if}
				<div class="diff">
					{#each [{ label: 'Added', cls: 'add', rows: b.diff.added.map( (d) => ({ rel: d.rel, size: fmt(d.bytes) }) ) }, { label: 'Removed', cls: 'rem', rows: b.diff.removed.map( (d) => ({ rel: d.rel, size: fmt(d.bytes) }) ) }, { label: 'Changed', cls: 'chg', rows: b.diff.changed.map( (d) => ({ rel: d.rel, size: `${fmt(d.before)} → ${fmt(d.after)}` }) ) }] as group (group.label)}
						{#if group.rows.length}
							<details class="group {group.cls}">
								<summary>{group.label} ({group.rows.length})</summary>
								<ul>
									{#each group.rows as r (r.rel)}<li>
											<code>{r.rel}</code> <span class="muted">{r.size}</span>
										</li>{/each}
								</ul>
							</details>
						{/if}
					{/each}
				</div>
			</section>
		{/if}

		<section class="card">
			<div class="section-head"><h2>Game content</h2></div>
			<dl class="content">
				{#each b.content as c (c.label)}<dt>{c.label}</dt>
					<dd>{c.value}</dd>{/each}
			</dl>
			<p class="foot">
				Computed {when(b.computedAt)} from the frozen snapshot — it does not change.
			</p>
		</section>
	</main>
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
		max-width: 1180px;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
		box-sizing: border-box;
	}
	.card {
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		padding: 20px;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
	}
	h2 {
		margin: 0;
		font-size: 16px;
		letter-spacing: 0.02em;
	}
	.back {
		color: #9a9aa6;
		font-size: 12px;
		text-decoration: none;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 6px 0;
		flex-wrap: wrap;
	}
	.badge {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #23232e;
		color: #9a9aa6;
	}
	.badge.live {
		background: #12351f;
		color: #6be19a;
	}
	.meta {
		color: #9a9aa6;
		font-size: 13px;
		margin: 0 0 12px;
	}
	code {
		font-size: 12px;
		color: #c9c9d6;
		word-break: break-all;
	}
	.toolbar,
	.filters {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.filters {
		margin-bottom: 10px;
	}
	.filters input:not([type='checkbox']) {
		flex: 1;
		min-width: 180px;
	}
	.spacer {
		flex: 1;
	}
	input,
	select,
	button {
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		padding: 7px 10px;
		font-size: 13px;
	}
	button {
		cursor: pointer;
		background: #1c1c26;
	}
	button:hover {
		border-color: #4a4a5c;
	}
	.inline {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.check input {
		padding: 0;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
	}
	.tile {
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tile.warn {
		border-color: #6b5320;
	}
	.tile .k {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #7a7a86;
	}
	.tile .v {
		font-size: 22px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.tile .s {
		font-size: 12px;
		color: #9a9aa6;
	}
	.section-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.count {
		font-size: 12px;
		color: #7a7a86;
		font-weight: 400;
	}
	.hint,
	.muted {
		color: #9a9aa6;
		font-size: 13px;
		margin: 0 0 12px;
	}
	.foot {
		color: #7a7a86;
		font-size: 12px;
		margin: 10px 0 0;
	}
	.bar {
		display: flex;
		height: 14px;
		border-radius: 7px;
		overflow: hidden;
		background: #23232e;
		margin-bottom: 14px;
		gap: 2px;
	}
	.bar span {
		min-width: 2px;
	}
	.dot {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin-right: 8px;
		vertical-align: middle;
		flex: none;
	}
	.dot.all {
		background: linear-gradient(135deg, #6c8cff, #4cc9a7, #f4a259);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7a7a86;
		font-weight: 600;
		padding: 6px 8px;
		border-bottom: 1px solid #23232e;
		white-space: nowrap;
	}
	td {
		padding: 6px 8px;
		border-bottom: 1px solid #1b1b24;
		vertical-align: top;
	}
	.n {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cats tbody tr {
		cursor: pointer;
	}
	.cats tbody tr:hover,
	.cats tr.sel {
		background: #1b1b26;
	}
	tr.unused td {
		color: #9a9aa6;
	}
	.where {
		color: #9a9aa6;
		font-size: 12px;
		max-width: 320px;
	}
	.path {
		display: flex;
		align-items: baseline;
		gap: 2px;
	}
	.dup,
	.shared {
		font-size: 10px;
		color: #f4a259;
		margin-left: 6px;
	}
	details.files summary {
		cursor: pointer;
	}
	details.files ul,
	.issue ul,
	.group ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	.issue {
		border: 1px solid #23232e;
		border-left-width: 3px;
		border-radius: 8px;
		padding: 10px 12px;
		margin-bottom: 8px;
	}
	.issue summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 14px;
	}
	.issue .muted {
		margin: 6px 0 0;
	}
	.issue.error {
		border-left-color: #f25f5c;
	}
	.issue.error .lvl {
		color: #f25f5c;
	}
	.issue.warn {
		border-left-color: #f4a259;
	}
	.issue.warn .lvl {
		color: #f4a259;
	}
	.issue.info {
		border-left-color: #6c8cff;
	}
	.issue.info .lvl {
		color: #6c8cff;
	}
	.more summary,
	.group summary {
		cursor: pointer;
		font-size: 13px;
		color: #b9b9c4;
		margin-top: 6px;
	}
	.group.add summary {
		color: #6be19a;
	}
	.group.rem summary {
		color: #f25f5c;
	}
	.group.chg summary {
		color: #f4a259;
	}
	.more-btn {
		margin-top: 10px;
	}
	.content {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 18px;
		margin: 0;
		font-size: 13px;
	}
	.content dt {
		color: #9a9aa6;
	}
	.content dd {
		margin: 0;
	}
	@media (max-width: 640px) {
		main {
			padding: 16px;
		}
	}
</style>
