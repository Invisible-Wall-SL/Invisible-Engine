<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import {
		normalizeGameConfigDoc,
		symbolFrequencies,
		symbolsInPlay,
		validateGameConfigDoc,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The live config. A DENSE doc — the whole config or nothing — so it is seeded from the resolved
	 * doc (authored if present, else the template default) and PUT back whole. Everything the tool
	 * shows derives from `game-config`, the SAME package the game resolves with, so the grid can't
	 * drift from what ships.
	 */
	const initial = (data.doc ?? data.templateDefault) as GameConfigDoc;
	let doc = $state<GameConfigDoc>(structuredClone(initial));

	/** Where the loaded doc came from — the page says so, so "edit yours" vs "adopt the template" is
	 *  never ambiguous. Flips to 'authored' once a save lands. */
	let source = $state<'authored' | 'template'>(data.source);
	/** The ETag this page loaded — the save precondition, so a second author can't silently erase
	 *  this one's whole config. `null` = no authored doc on load ⇒ first save CREATES. */
	let docEtag = $state<string | null>(data.etag);

	let saving = $state(false);
	let savedAt = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let conflict = $state<string | null>(null);

	/** `$state.snapshot` because a raw `structuredClone` of a `$state` proxy throws DataCloneError. */
	let baseline = $state(JSON.stringify(initial));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);

	const snapshot = $derived($state.snapshot(doc) as GameConfigDoc);

	/** THE GATE, live: what the strips actually deal. Every "is X in play?" the page asks reads this,
	 *  never the dictionary — the one rule the whole tool exists to hold. */
	const inPlay = $derived(new Set(symbolsInPlay(snapshot)));
	const frequencies = $derived(symbolFrequencies(snapshot));
	const issues = $derived(validateGameConfigDoc(snapshot));
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const warnings = $derived(issues.filter((i) => i.severity === 'warning'));

	/** Issues whose path starts with a given prefix — lets each panel show its own problems inline. */
	const issuesFor = (prefix: string): GameConfigIssue[] =>
		issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));

	const symbolNames = $derived(Object.keys(doc.symbols));
	const gameTypes = $derived(Object.keys(doc.paddingReels));
	const maxRows = $derived(Math.max(...doc.numRows, 1));

	// ── Grid ────────────────────────────────────────────────────────────────────
	// Reel count is the spine of the config: paylines and strips are indexed by it. Changing it
	// re-shapes `numRows` (pad with the first reel's height / truncate) so the grid stays fully
	// described, but it deliberately does NOT touch paylines or strips — those become validation
	// errors the author resolves, rather than silent data loss from an auto-trim.
	function setNumReels(n: number) {
		const next = Math.max(1, Math.floor(n) || 1);
		const fill = doc.numRows[0] ?? 3;
		doc.numReels = next;
		doc.numRows = Array.from({ length: next }, (_, i) => doc.numRows[i] ?? fill);
	}
	function setRows(reel: number, rows: number) {
		doc.numRows[reel] = Math.max(1, Math.floor(rows) || 1);
	}
	/** Apply one row count to every reel — the common case (a rectangular board). */
	function setAllRows(rows: number) {
		const r = Math.max(1, Math.floor(rows) || 1);
		doc.numRows = doc.numRows.map(() => r);
	}

	/**
	 * Any strip set or payline whose width no longer matches `numReels` — the exact thing the
	 * validator errors on after a reel-count change. Drives the "Match grid" button so the author has
	 * a one-click fix instead of a dead-end error (the reason `setNumReels` deliberately doesn't touch
	 * strips/paylines is to avoid silent data loss, NOT to leave them unrepairable).
	 */
	const gridMismatch = $derived(
		gameTypes.some((g) => (doc.paddingReels[g]?.length ?? 0) !== doc.numReels) ||
			Object.keys(doc.paylines).some((id) => doc.paylines[id].length !== doc.numReels),
	);

	/**
	 * Pad or truncate every strip set and every payline to the current reel count. Growing a strip set
	 * CLONES the last existing reel (a copy is a sane cosmetic default and keeps the new reels dealing
	 * the same in-play symbols); new payline cells default to the top row (0). Shrinking drops the
	 * extra reels. This is the "recalculate after a board resize" action — it never invents symbols,
	 * only re-shapes what's already authored to the new grid.
	 */
	function matchGridWidth() {
		const n = doc.numReels;
		for (const key of Object.keys(doc.paddingReels)) {
			const strips = doc.paddingReels[key];
			const template = strips[strips.length - 1] ?? [];
			while (strips.length < n) strips.push(template.map((cell) => ({ ...cell })));
			strips.length = n;
		}
		for (const id of Object.keys(doc.paylines)) {
			const line = doc.paylines[id];
			while (line.length < n) line.push(0);
			line.length = n;
		}
	}

	// ── Bet modes ────────────────────────────────────────────────────────────────
	let newBetMode = $state('');
	function addBetMode() {
		const key = newBetMode.trim();
		if (!key || doc.betModes[key]) return;
		doc.betModes[key] = { cost: 1, feature: false, buyBonus: false, rtp: doc.rtp, max_win: 5000 };
		newBetMode = '';
	}
	function removeBetMode(key: string) {
		delete doc.betModes[key];
	}

	// ── Symbols ──────────────────────────────────────────────────────────────────
	let newSymbol = $state('');
	function addSymbol() {
		const name = newSymbol.trim();
		if (!name || doc.symbols[name]) return;
		doc.symbols[name] = {};
		newSymbol = '';
	}
	function removeSymbol(name: string) {
		delete doc.symbols[name];
	}
	function setProperties(name: string, value: string) {
		const props = value
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean);
		if (props.length) doc.symbols[name].special_properties = props;
		else delete doc.symbols[name].special_properties;
	}
	/** The paytable as an editable "count:pay, count:pay" string — the compact shape a math export
	 *  reads in, and far quicker to edit than a row-per-input grid. Parsed back to the canonical
	 *  single-entry rows on the way out. */
	function paytableText(name: string): string {
		return (doc.symbols[name].paytable ?? [])
			.map((row) => {
				const [count, pay] = Object.entries(row)[0];
				return `${count}:${pay}`;
			})
			.join(', ');
	}
	function setPaytable(name: string, value: string) {
		const rows = value
			.split(',')
			.map((pair) => pair.trim())
			.filter(Boolean)
			.flatMap((pair) => {
				const [count, pay] = pair.split(':').map((s) => s.trim());
				const c = Number(count);
				const p = Number(pay);
				return Number.isFinite(c) && c > 0 && Number.isFinite(p) ? [{ [String(c)]: p }] : [];
			});
		if (rows.length) doc.symbols[name].paytable = rows;
		else delete doc.symbols[name].paytable;
	}

	// ── Paylines ─────────────────────────────────────────────────────────────────
	let newPayline = $state('');
	function addPayline() {
		const id = newPayline.trim() || String(Object.keys(doc.paylines).length + 1);
		if (doc.paylines[id]) return;
		doc.paylines[id] = Array.from({ length: doc.numReels }, () => 0);
		newPayline = '';
	}
	function removePayline(id: string) {
		delete doc.paylines[id];
		clearPaylineColor(id);
	}

	// ── Payline colours ────────────────────────────────────────────────────────────
	// OPTIONAL per-line colour (an Invisible-Engine extension of the Stake config). When a line has
	// one, the game draws its win line in that colour AND broadcasts it so assets shown on the win can
	// tint to match — see `paylineColor()` / `stateGame.winLineColor` in the engine. Stored sparsely:
	// a line with no colour has no entry, so an un-coloured config is byte-identical to a Stake export.
	const DEFAULT_PAYLINE_COLOR = '#7ee0c0';
	function hasPaylineColor(id: string): boolean {
		return Boolean(doc.paylineColors?.[id]);
	}
	function paylineColorValue(id: string): string {
		return doc.paylineColors?.[id] ?? DEFAULT_PAYLINE_COLOR;
	}
	function setPaylineColor(id: string, value: string) {
		(doc.paylineColors ??= {})[id] = value;
	}
	function clearPaylineColor(id: string) {
		if (!doc.paylineColors) return;
		delete doc.paylineColors[id];
		if (!Object.keys(doc.paylineColors).length) delete doc.paylineColors;
	}
	/** Click a cell in the visual editor: set this line's row on this reel. The whole point of the
	 *  panel — a payline is row-indices-per-reel, unreadable as raw JSON. */
	function setPaylineCell(id: string, reel: number, row: number) {
		// A line shorter/longer than the grid (e.g. after a reel-count change) is repaired to
		// numReels so the click lands where the author sees it, keeping index and column aligned.
		const line = doc.paylines[id];
		while (line.length < doc.numReels) line.push(0);
		line.length = doc.numReels;
		line[reel] = row;
	}

	// ── Reel strips ──────────────────────────────────────────────────────────────
	// A strip is edited as free text — names separated by any whitespace or commas — because it is
	// the most data-heavy field and paste-in from the math export is the real workflow. Parsed to
	// the canonical `{ name }[]` on input.
	function stripText(gameType: string, reel: number): string {
		return (doc.paddingReels[gameType]?.[reel] ?? []).map((c) => c.name).join(' ');
	}
	function setStrip(gameType: string, reel: number, value: string) {
		const cells = value
			.split(/[\s,]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((name) => ({ name }));
		const strips = (doc.paddingReels[gameType] ??= []);
		while (strips.length <= reel) strips.push([]);
		strips[reel] = cells;
	}
	let newGameType = $state('');
	function addGameType() {
		const key = newGameType.trim();
		if (!key || doc.paddingReels[key]) return;
		doc.paddingReels[key] = Array.from({ length: doc.numReels }, () => []);
		newGameType = '';
	}
	function removeGameType(key: string) {
		delete doc.paddingReels[key];
	}

	// ── Raw JSON escape hatch ─────────────────────────────────────────────────────
	// A Stake config arrives as JSON from the math team; this is how it comes in and how a power
	// user checks the exact shape. "Apply" runs the SAME normalizer the server and game run, so what
	// applies here is what would save — no second interpretation.
	let rawOpen = $state(false);
	let rawText = $state('');
	let rawError = $state<string | null>(null);
	function openRaw() {
		rawText = JSON.stringify($state.snapshot(doc), null, 2);
		rawError = null;
		rawOpen = true;
	}
	function applyRaw() {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawText);
		} catch (e) {
			rawError = `Not valid JSON: ${e instanceof Error ? e.message : e}`;
			return;
		}
		const next = normalizeGameConfigDoc(parsed);
		if (!next) {
			rawError = 'This does not describe a game — it needs a symbol dictionary and reel strips.';
			return;
		}
		doc = structuredClone(next);
		rawError = null;
		rawOpen = false;
	}

	function resetToTemplate() {
		if (!data.templateDefault) return;
		doc = structuredClone(data.templateDefault as GameConfigDoc);
	}

	/**
	 * Persist the config, conditional on the loaded ETag. `force` drops the precondition — the
	 * explicit "overwrite with mine" after a conflict; it NEVER reloads or discards local edits.
	 *
	 * A 400 carries the issue list (the config can't ship — an off-grid payline, a strip dealing a
	 * symbol with no dictionary entry); those are already shown inline, so the save button just
	 * reports the count. A clean save adopts the server's normalized doc so the baseline matches
	 * exactly what persisted.
	 */
	async function save(force = false) {
		saving = true;
		saveError = null;
		try {
			const res = await fetch(`/api/game-config?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: $state.snapshot(doc), baseEtag: docEtag, force }),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				conflict = c.message ?? 'Someone else saved this config while you were editing.';
				return;
			}
			if (res.status === 400) {
				const c = (await res.json()) as { issues?: GameConfigIssue[] };
				const n = c.issues?.length ?? 0;
				saveError = n
					? `Can't save: ${n} blocking ${n === 1 ? 'issue' : 'issues'} — see the highlighted panels.`
					: "This config can't be saved.";
				return;
			}
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
			const saved = (await res.json()) as { doc: GameConfigDoc; etag: string | null };
			doc = structuredClone(saved.doc);
			baseline = JSON.stringify(saved.doc);
			docEtag = saved.etag;
			source = 'authored';
			conflict = null;
			savedAt = new Date().toLocaleTimeString();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Save failed.';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Invisible Game Config — {data.projectKey}</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="gameConfig"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if errors.length}<span class="pill err"
					>{errors.length} error{errors.length === 1 ? '' : 's'}</span
				>{/if}
			{#if saveError}<span class="err">{saveError}</span>{/if}
			{#if dirty}<span class="pill dirty">Unsaved</span>{:else if savedAt}<span class="pill"
					>Saved {savedAt}</span
				>{/if}
			<button class="save" onclick={() => save()} disabled={saving || !dirty || errors.length > 0}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if conflict}
			<div class="conflict">
				<p>{conflict}</p>
				<p class="conflict-sub">
					Your edits are still on this page — nothing has been lost. Reload to take their version
					(your unsaved edits go), or overwrite with yours.
				</p>
				<div class="conflict-actions">
					<button onclick={() => location.reload()}>Reload theirs</button>
					<button class="danger" onclick={() => save(true)}>Overwrite with mine</button>
				</div>
			</div>
		{/if}

		<p class="intro">
			What this game <em>plays</em> — its symbol dictionary and payouts, paylines, grid, bet modes,
			and the reel strips that decide which symbols reach the board. This is the frontend's contract
			with the math, not the math itself: the server stays the authority on outcomes. A config
			arriving from the math team pastes straight in via
			<button class="linkish" onclick={openRaw}>raw JSON</button>.
		</p>

		<div class="banner {source}">
			{#if source === 'template'}
				This project has <strong>not authored a config</strong> — you're looking at the
				<strong>{data.gameType} template default</strong>. Save to make it this project's own.
			{:else}
				Editing this project's <strong>authored config</strong>.
			{/if}
			{#if data.templateDefault}
				<button class="linkish" onclick={resetToTemplate}>Reset to template default</button>
			{/if}
		</div>

		{#if errors.length}
			<div class="warn err-box">
				<strong>{errors.length} blocking {errors.length === 1 ? 'issue' : 'issues'}</strong> — the
				config can't be saved until fixed:
				<ul>
					{#each errors as issue (issue.path + issue.message)}
						<li><code>{issue.path}</code> — {issue.message}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if warnings.length}
			<div class="warn">
				<strong>{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</strong> — the
				config saves, but:
				<ul>
					{#each warnings as issue (issue.path + issue.message)}
						<li><code>{issue.path}</code> — {issue.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Identity ---------------------------------------------------------------->
		<section>
			<h2>Identity</h2>
			<p class="hint">Shown on the info page and used in the RGS handshake.</p>
			<div class="fields">
				<label><span>Provider</span><input bind:value={doc.providerName} /></label>
				<label><span>Game name</span><input bind:value={doc.gameName} /></label>
				<label><span>Game ID</span><input bind:value={doc.gameID} /></label>
				<label
					><span>RTP</span><input
						type="number"
						step="0.001"
						min="0"
						max="1"
						bind:value={doc.rtp}
					/></label
				>
			</div>
		</section>

		<!-- Grid ------------------------------------------------------------------->
		<section>
			<h2>Grid</h2>
			<p class="hint">
				Reels and visible rows. Changing the reel count re-shapes the row list but leaves paylines
				and strips alone — mismatches show up as errors below rather than silently trimming your
				work. Use <strong>Match grid</strong> to resize every strip and payline to the new reel count
				in one step (new reels clone the last reel; new payline cells start on the top row).
			</p>
			<div class="fields">
				<label
					><span>Reels</span><input
						type="number"
						min="1"
						value={doc.numReels}
						oninput={(e) => setNumReels(Number(e.currentTarget.value))}
					/></label
				>
				<label
					><span>Rows (all reels)</span><input
						type="number"
						min="1"
						value={maxRows}
						oninput={(e) => setAllRows(Number(e.currentTarget.value))}
					/></label
				>
			</div>
			<div class="rows-per-reel">
				{#each doc.numRows as rows, reel (reel)}
					<label class="mini"
						><span>R{reel + 1}</span><input
							type="number"
							min="1"
							value={rows}
							oninput={(e) => setRows(reel, Number(e.currentTarget.value))}
						/></label
					>
				{/each}
			</div>
			{#if gridMismatch}
				<div class="grid-fix">
					<span
						>Strips or paylines don't match the {doc.numReels}-reel grid — the config can't ship
						until they line up.</span
					>
					<button onclick={matchGridWidth}>Match grid ({doc.numReels} reels)</button>
				</div>
			{/if}
		</section>

		<!-- Bet modes -------------------------------------------------------------->
		<section>
			<h2>Bet modes</h2>
			<p class="hint">Each entry in the bet selector / buy-bonus menu.</p>
			<div class="grid-wrap">
				<table class="grid">
					<thead>
						<tr>
							<th>Mode</th>
							<th>Cost</th>
							<th>Feature</th>
							<th>Buy bonus</th>
							<th>RTP</th>
							<th>Max win (×)</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each Object.keys(doc.betModes) as key (key)}
							<tr>
								<th class="row-head">{key}</th>
								<td><input type="number" step="0.01" bind:value={doc.betModes[key].cost} /></td>
								<td class="center"
									><input type="checkbox" bind:checked={doc.betModes[key].feature} /></td
								>
								<td class="center"
									><input type="checkbox" bind:checked={doc.betModes[key].buyBonus} /></td
								>
								<td><input type="number" step="0.001" bind:value={doc.betModes[key].rtp} /></td>
								<td><input type="number" step="1" bind:value={doc.betModes[key].max_win} /></td>
								<td class="center"
									><button class="del" title="Remove" onclick={() => removeBetMode(key)}>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="add">
				<input placeholder="new mode key (e.g. base)" bind:value={newBetMode} />
				<button onclick={addBetMode} disabled={!newBetMode.trim()}>Add mode</button>
			</div>
			{#each issuesFor('betModes') as issue (issue.message)}
				<p class="inline-issue {issue.severity}">{issue.message}</p>
			{/each}
		</section>

		<!-- Symbols ---------------------------------------------------------------->
		<section>
			<h2>Symbols</h2>
			<p class="hint">
				The symbol <strong>dictionary</strong> — art, properties, payouts. The
				<span class="badge in">in play</span>
				badge means the symbol appears on a reel strip and so can actually reach the board; a
				<span class="badge out">unused</span> symbol is defined here but dealt by no strip (a payout
				no one can win). Paytable is <code>count:multiplier</code> pairs, e.g.
				<code>5:20, 4:10, 3:5</code>.
			</p>
			<div class="grid-wrap">
				<table class="grid">
					<thead>
						<tr>
							<th>Symbol</th>
							<th></th>
							<th>Special properties</th>
							<th>Paytable (count:×)</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each symbolNames as name (name)}
							<tr>
								<th class="row-head">{name}</th>
								<td class="center">
									{#if inPlay.has(name)}<span class="badge in">in play</span>{:else}<span
											class="badge out">unused</span
										>{/if}
								</td>
								<td
									><input
										value={(doc.symbols[name].special_properties ?? []).join(', ')}
										placeholder="scatter, wild…"
										oninput={(e) => setProperties(name, e.currentTarget.value)}
									/></td
								>
								<td
									><input
										value={paytableText(name)}
										placeholder="5:20, 4:10, 3:5"
										oninput={(e) => setPaytable(name, e.currentTarget.value)}
									/></td
								>
								<td class="center"
									><button class="del" title="Remove" onclick={() => removeSymbol(name)}>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="add">
				<input placeholder="new symbol id (e.g. H1)" bind:value={newSymbol} />
				<button onclick={addSymbol} disabled={!newSymbol.trim()}>Add symbol</button>
			</div>
			{#each issuesFor('symbols') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>

		<!-- Paylines --------------------------------------------------------------->
		<section>
			<h2>Paylines</h2>
			<p class="hint">
				Each line is one cell per reel. Click a cell to move the line through that reel's rows. The
				swatch sets an optional <strong>line colour</strong>: the game draws that line's win in this
				colour and broadcasts it so assets shown on the win can pick it up (leave it unset to use
				the single default from the Symbols tool).
			</p>
			<div class="paylines">
				{#each Object.keys(doc.paylines) as id (id)}
					{@const tint = hasPaylineColor(id) ? paylineColorValue(id) : null}
					<div class="payline">
						<div class="payline-head">
							<span class="payline-id" style={tint ? `color:${tint}` : ''}>Line {id}</span>
							<div class="payline-tools">
								<input
									class="swatch"
									type="color"
									value={paylineColorValue(id)}
									oninput={(e) => setPaylineColor(id, e.currentTarget.value)}
									title="Line colour"
								/>
								{#if tint}
									<button class="del" title="Clear colour" onclick={() => clearPaylineColor(id)}
										>⌫</button
									>
								{/if}
								<button class="del" title="Remove" onclick={() => removePayline(id)}>×</button>
							</div>
						</div>
						<div class="payline-grid" style="grid-template-columns: repeat({doc.numReels}, 1fr);">
							{#each Array(doc.numReels) as _, reel (reel)}
								<div class="reel-col">
									{#each Array(doc.numRows[reel] ?? maxRows) as _, row (row)}
										{@const on = doc.paylines[id][reel] === row}
										<button
											class="cell"
											class:on
											style={on && tint ? `background:${tint};border-color:${tint}` : ''}
											aria-label="Line {id} reel {reel + 1} row {row + 1}"
											onclick={() => setPaylineCell(id, reel, row)}
										></button>
									{/each}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<div class="add">
				<input placeholder="line id (auto if blank)" bind:value={newPayline} />
				<button onclick={addPayline}>Add line</button>
			</div>
			{#each issuesFor('paylines') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>

		<!-- Reel strips ------------------------------------------------------------>
		<section>
			<h2>Reel strips</h2>
			<p class="hint">
				The cosmetic strips the reels cycle through — and the one statement of which symbols reach
				the board. Not the real weighted math strips (the math team owns those); a symbol's count
				here is only how often it flickers past. One reel per box; separate names with spaces,
				commas or newlines.
			</p>
			{#each gameTypes as gameType (gameType)}
				<div class="strips">
					<div class="strips-head">
						<span class="game-type">{gameType}</span>
						<button class="del" title="Remove game type" onclick={() => removeGameType(gameType)}
							>×</button
						>
					</div>
					<div class="strip-cols">
						{#each Array(doc.numReels) as _, reel (reel)}
							<div class="strip-col">
								<div class="strip-label">Reel {reel + 1}</div>
								<textarea
									value={stripText(gameType, reel)}
									oninput={(e) => setStrip(gameType, reel, e.currentTarget.value)}
									spellcheck="false"
								></textarea>
								<div class="freq">
									{#each Object.entries(frequencies[gameType]?.[reel] ?? {}).sort((a, b) => b[1] - a[1]) as [name, count] (name)}
										<span class="chip" class:out={!inPlay.has(name)}>{name}<b>{count}</b></span>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
			<div class="add">
				<input placeholder="new game type (e.g. freegame)" bind:value={newGameType} />
				<button onclick={addGameType} disabled={!newGameType.trim()}>Add game type</button>
			</div>
			{#each issuesFor('paddingReels') as issue (issue.path + issue.message)}
				<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
			{/each}
		</section>
	</div>

	{#if rawOpen}
		<div class="modal-backdrop" onclick={() => (rawOpen = false)} role="presentation">
			<div class="modal" onclick={(e) => e.stopPropagation()} role="presentation">
				<h2>Raw JSON</h2>
				<p class="hint">
					Paste a Stake-shaped config from the math team, or edit the whole doc directly. Apply runs
					the same validation a save does.
				</p>
				<textarea class="raw" bind:value={rawText} spellcheck="false"></textarea>
				{#if rawError}<p class="inline-issue error">{rawError}</p>{/if}
				<div class="modal-actions">
					<button onclick={() => (rawOpen = false)}>Cancel</button>
					<button class="primary" onclick={applyRaw}>Apply</button>
				</div>
			</div>
		</div>
	{/if}
</div>

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
	}
	.intro {
		margin: 0 0 16px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
		max-width: 900px;
	}
	.banner {
		margin: 0 0 20px;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 12px;
		line-height: 1.5;
		border: 1px solid #2a2438;
		background: #14121c;
		color: #b9b3c8;
		display: flex;
		gap: 14px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.banner.template {
		border-color: #4a3f1e;
		background: #1a1710;
		color: #d3b483;
	}
	section {
		margin-bottom: 34px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
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
	.warn.err-box {
		border-color: #6a2727;
		background: #1e1112;
		color: #e0a0a0;
	}
	.warn ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}
	.fields {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8b98;
	}
	label.mini {
		font-size: 10px;
	}
	input,
	textarea {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 7px 9px;
		font-size: 13px;
		font-family: inherit;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	label input {
		width: 180px;
	}
	label.mini input {
		width: 52px;
		text-align: center;
	}
	.rows-per-reel {
		display: flex;
		gap: 8px;
		margin-top: 12px;
		flex-wrap: wrap;
	}
	.grid-fix {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 14px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.5;
		flex-wrap: wrap;
	}
	.grid-fix button {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 6px 14px;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
	}
	.grid-wrap {
		overflow-x: auto;
		border: 1px solid #1c1c24;
		border-radius: 10px;
	}
	.grid {
		border-collapse: collapse;
		width: 100%;
	}
	.grid th {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 9px 10px;
		text-align: left;
		background: #101017;
		border-bottom: 1px solid #1c1c24;
		white-space: nowrap;
	}
	.grid td {
		padding: 5px 8px;
		border-bottom: 1px solid #16161d;
	}
	.grid td.center {
		text-align: center;
	}
	.grid td input:not([type='checkbox']) {
		width: 100%;
		min-width: 90px;
	}
	.row-head {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
		background: #101017;
		border-right: 1px solid #1c1c24;
		text-align: left;
		padding: 5px 10px;
	}
	.badge {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.badge.in {
		background: #123324;
		color: #7ee0c0;
	}
	.badge.out {
		background: #33231a;
		color: #d39b6f;
	}
	.add {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.add input {
		width: 240px;
	}
	.add button,
	.modal-actions button,
	.conflict-actions button {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 7px 14px;
		font-size: 12px;
		cursor: pointer;
	}
	.add button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.del {
		background: none;
		border: none;
		color: #8b6b6b;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
	}
	.del:hover {
		color: #e07070;
	}
	.inline-issue {
		margin: 8px 0 0;
		font-size: 12px;
	}
	.inline-issue.error {
		color: #e09090;
	}
	.inline-issue.warning {
		color: #d3b483;
	}
	.paylines {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.payline {
		border: 1px solid #1c1c24;
		border-radius: 8px;
		padding: 8px;
		background: #0e0e14;
	}
	.payline-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.payline-id {
		font-size: 11px;
		color: #8b8b98;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.payline-tools {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.swatch {
		width: 22px;
		height: 18px;
		padding: 0;
		border: 1px solid #26262f;
		border-radius: 4px;
		background: none;
		cursor: pointer;
	}
	.swatch::-webkit-color-swatch-wrapper {
		padding: 2px;
	}
	.swatch::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}
	.payline-grid {
		display: grid;
		gap: 3px;
	}
	.reel-col {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.cell {
		width: 22px;
		height: 16px;
		border: 1px solid #26262f;
		border-radius: 3px;
		background: #14141b;
		cursor: pointer;
		padding: 0;
	}
	.cell.on {
		background: #7ee0c0;
		border-color: #7ee0c0;
	}
	.strips {
		border: 1px solid #1c1c24;
		border-radius: 10px;
		padding: 12px;
		margin-bottom: 14px;
		background: #0e0e14;
	}
	.strips-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.game-type {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
		font-size: 13px;
	}
	.strip-cols {
		display: flex;
		gap: 10px;
		overflow-x: auto;
	}
	.strip-col {
		flex: 1;
		min-width: 130px;
	}
	.strip-label {
		font-size: 11px;
		color: #8b8b98;
		margin-bottom: 4px;
	}
	.strip-col textarea {
		width: 100%;
		height: 160px;
		resize: vertical;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.5;
	}
	.freq {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		margin-top: 6px;
	}
	.chip {
		font-size: 10px;
		font-family: ui-monospace, monospace;
		background: #16161d;
		color: #9a9aa8;
		padding: 1px 4px;
		border-radius: 3px;
	}
	.chip.out {
		background: #33231a;
		color: #d39b6f;
	}
	.chip b {
		margin-left: 3px;
		color: #7ee0c0;
	}
	.chip.out b {
		color: #d39b6f;
	}
	.linkish {
		background: none;
		border: none;
		color: #7ee0c0;
		cursor: pointer;
		font: inherit;
		padding: 0;
		text-decoration: underline;
	}
	.pill {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		background: #1a1a22;
		color: #8b8b98;
	}
	.pill.dirty {
		background: #33231a;
		color: #e0b070;
	}
	.pill.err {
		background: #2a1414;
		color: #e08080;
	}
	.err {
		color: #e08080;
		font-size: 12px;
	}
	.save {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 6px 16px;
		font-size: 12px;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.conflict {
		border: 1px solid #6a2727;
		background: #1e1112;
		border-radius: 8px;
		padding: 14px;
		margin-bottom: 20px;
	}
	.conflict-sub {
		font-size: 12px;
		color: #b98b8b;
	}
	.conflict-actions {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
	.conflict-actions .danger {
		background: #2a1414;
		border-color: #6a2727;
		color: #e08080;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}
	.modal {
		background: #0e0e14;
		border: 1px solid #26262f;
		border-radius: 12px;
		padding: 20px;
		width: min(760px, 90vw);
		max-height: 86vh;
		display: flex;
		flex-direction: column;
	}
	.raw {
		flex: 1;
		min-height: 340px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.5;
		resize: vertical;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
	.modal-actions .primary {
		background: #1b2a24;
		border-color: #2f4a3f;
	}
</style>
