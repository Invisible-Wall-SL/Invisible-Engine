<script lang="ts">
	import {
		SPINS_WIN_MODEL_TYPES,
		formatPayRow,
		gameTypeForMode,
		resolveWinModel,
		setSpinsGrid,
		spinsWinModelFor,
		stripWidthFor,
		stripsToWidth,
		symbolsInPlayForGameType,
		type GameConfigDoc,
		type GameConfigIssue,
		type GameModeDecl,
		type PaytableRow,
		type SpinsGame,
		type WinModelType,
	} from 'game-config';
	import { num } from './bonusLabels';

	/**
	 * One SPINS mode's game in `/config` → Bonus modes (`GameModeDecl.spins`, bonus-games Phase 8b):
	 * how many spins, which game (win model), its grid, its paylines, its own pays and its strips. It
	 * edits `mode.spins` in place and stays SPARSE: a field left on "the base game's" is absent, so
	 * the mode falls back to the host (`spinsGameView`), as Phase 8a defined it.
	 */
	let {
		doc = $bindable(),
		mode,
		issuesFor,
		readOnly,
	}: {
		doc: GameConfigDoc;
		mode: GameModeDecl & { spins: SpinsGame };
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
	} = $props();

	const game = $derived(mode.spins);
	const gameType = $derived(gameTypeForMode(mode));
	const hostModel = $derived(resolveWinModel(doc));
	const model = $derived(game.winModel ?? hostModel);
	const width = $derived(game.numReels ?? doc.numReels);
	const heights = $derived(game.numRows ?? doc.numRows);
	const strips = $derived(doc.paddingReels[gameType] ?? []);
	const wanted = $derived(stripWidthFor(doc, gameType));
	const paylines = $derived(game.paylines ?? doc.paylines);
	const dealt = $derived(symbolsInPlayForGameType(doc, gameType));
	const issues = $derived([
		...issuesFor(`modes.${mode.id}`),
		...issuesFor(`paddingReels.${gameType}`),
	]);

	function setGameType(value: string) {
		const type = SPINS_WIN_MODEL_TYPES.find((t) => t === value);
		if (type) game.winModel = spinsWinModelFor(type as WinModelType);
		else delete game.winModel;
		if ((game.winModel ?? hostModel).type !== 'lines') delete game.paylines;
	}

	function setThreshold(key: 'minKind' | 'minCluster' | 'minCount', n: number) {
		if (!game.winModel) return;
		(game.winModel as Record<string, unknown>)[key] = Math.max(1, Math.floor(n));
	}

	function setOption(key: 'direction' | 'adjacency', value: string) {
		if (!game.winModel) return;
		(game.winModel as Record<string, unknown>)[key] = value;
	}

	function setOwnGrid(on: boolean) {
		setSpinsGrid(doc, game, gameType, on ? doc.numReels : undefined, on ? doc.numRows : undefined);
	}

	function setReels(n: number) {
		setSpinsGrid(doc, game, gameType, n);
	}

	function setRows(reel: number, n: number) {
		const rows = [...heights];
		rows[reel] = Math.max(1, Math.floor(n));
		setSpinsGrid(doc, game, gameType, width, rows);
	}

	function setOwnPaylines(on: boolean) {
		if (!on) {
			delete game.paylines;
			return;
		}
		game.paylines = structuredClone($state.snapshot(doc.paylines));
		setSpinsGrid(doc, game, gameType, game.numReels, game.numRows);
	}

	function setPayline(id: string, text: string) {
		const rows = text
			.split(',')
			.map((s) => Number(s.trim()) - 1)
			.filter((r) => Number.isInteger(r) && r >= 0);
		if (game.paylines && rows.length) game.paylines[id] = rows;
	}

	function addPayline() {
		const lines = (game.paylines ??= {});
		let n = Object.keys(lines).length + 1;
		while (lines[String(n)]) n += 1;
		lines[String(n)] = Array.from({ length: width }, () => 0);
	}

	function removePayline(id: string) {
		if (!game.paylines) return;
		delete game.paylines[id];
		if (!Object.keys(game.paylines).length) delete game.paylines;
	}

	function payText(name: string): string {
		return (game.paytable?.[name] ?? [])
			.flatMap((row) => Object.entries(row).map(([count, pay]) => `${count}:${pay}`))
			.join(', ');
	}

	function setPays(name: string, text: string) {
		const rows: PaytableRow[] = text
			.split(',')
			.map((pair) => pair.split(':').map((s) => Number(s.trim())))
			.filter(([count, pay]) => Number.isFinite(count) && count > 0 && Number.isFinite(pay))
			.map(([count, pay]) => ({ [String(count)]: pay }));
		const table = (game.paytable ??= {});
		if (rows.length) table[name] = rows;
		else delete table[name];
		if (!Object.keys(table).length) delete game.paytable;
	}

	function fitStrips() {
		const source = strips.length ? strips : (doc.paddingReels.basegame ?? []);
		doc.paddingReels[gameType] = stripsToWidth($state.snapshot(source), wanted);
	}
</script>

<div class="spins">
	{#each issues as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
	{/each}
	<fieldset class="row" disabled={readOnly}>
		<label
			><span>Spins</span><input
				type="number"
				min="1"
				value={game.spins}
				oninput={num((n) => (game.spins = Math.max(1, n)), true)}
			/></label
		>
		<label
			><span>Game</span><select
				value={game.winModel?.type ?? ''}
				onchange={(e) => setGameType(e.currentTarget.value)}
			>
				<option value="">the base game's ({hostModel.type})</option>
				{#each SPINS_WIN_MODEL_TYPES as type (type)}
					<option value={type}>{type}</option>
				{/each}
			</select></label
		>
		{#if game.winModel?.type === 'ways'}
			<label
				><span>Fewest reels</span><input
					type="number"
					min="1"
					value={game.winModel.minKind}
					oninput={num((n) => setThreshold('minKind', n), true)}
				/></label
			>
			<label
				><span>Direction</span><select
					value={game.winModel.direction}
					onchange={(e) => setOption('direction', e.currentTarget.value)}
				>
					<option value="ltr">left to right</option>
					<option value="both">both ways</option>
				</select></label
			>
		{:else if game.winModel?.type === 'cluster'}
			<label
				><span>Fewest cells</span><input
					type="number"
					min="1"
					value={game.winModel.minCluster}
					oninput={num((n) => setThreshold('minCluster', n), true)}
				/></label
			>
			<label
				><span>Touching</span><select
					value={game.winModel.adjacency}
					onchange={(e) => setOption('adjacency', e.currentTarget.value)}
				>
					<option value="orthogonal">side by side</option>
					<option value="diagonal">also diagonally</option>
				</select></label
			>
		{:else if game.winModel?.type === 'scatter'}
			<label
				><span>Fewest anywhere</span><input
					type="number"
					min="1"
					value={game.winModel.minCount}
					oninput={num((n) => setThreshold('minCount', n), true)}
				/></label
			>
		{/if}
	</fieldset>

	<fieldset class="row" disabled={readOnly}>
		<label class="check"
			><input
				type="checkbox"
				checked={game.numReels !== undefined}
				onchange={(e) => setOwnGrid(e.currentTarget.checked)}
			/><span>A grid of its own</span></label
		>
		{#if game.numReels !== undefined}
			<label
				><span>Reels</span><input
					type="number"
					min="1"
					max="12"
					value={width}
					oninput={num(setReels, true)}
				/></label
			>
			{#each heights as rows, reel (reel)}
				<label
					><span>Reel {reel + 1}</span><input
						type="number"
						min="1"
						class="small"
						value={rows}
						oninput={num((n) => setRows(reel, n), true)}
					/></label
				>
			{/each}
		{:else}
			<span class="note">plays on the base grid ({doc.numReels} × {doc.numRows.join('/')})</span>
		{/if}
	</fieldset>

	{#if model.type === 'lines'}
		<fieldset class="row" disabled={readOnly}>
			<label class="check"
				><input
					type="checkbox"
					checked={game.paylines !== undefined}
					onchange={(e) => setOwnPaylines(e.currentTarget.checked)}
				/><span>Paylines of its own</span></label
			>
			{#if game.paylines}
				{#each Object.entries(game.paylines) as [id, rows] (id)}
					<label
						><span>Line {id} (rows, 1 = top)</span><input
							class="line"
							value={rows.map((r) => r + 1).join(', ')}
							onchange={(e) => setPayline(id, e.currentTarget.value)}
						/></label
					>
					<button class="small danger" onclick={() => removePayline(id)}>×</button>
				{/each}
				<button class="small" onclick={addPayline}>＋ Line</button>
			{:else}
				<span class="note">the base game's {Object.keys(paylines).length} lines</span>
			{/if}
		</fieldset>
	{/if}

	<table class="tbl">
		<thead><tr><th>Symbol on its strips</th><th>Base pays</th><th>Its own pays</th></tr></thead>
		<tbody>
			{#each dealt as name (name)}
				<tr>
					<td><code>{name}</code></td>
					<td class="note">{formatPayRow(doc.symbols[name]?.paytable ?? []) || '—'}</td>
					<td
						><input
							class="pays"
							disabled={readOnly}
							placeholder="the base pays"
							value={payText(name)}
							onchange={(e) => setPays(name, e.currentTarget.value)}
						/></td
					>
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="row">
		<span class="note"
			>strips <code>{gameType}</code>: {strips.length
				? `${strips.length} reels`
				: 'none yet'}{strips.length && strips.length !== wanted
				? ` — its grid is ${wanted} wide`
				: ''}</span
		>
		{#if strips.length !== wanted}
			<button class="small" disabled={readOnly} onclick={fitStrips}
				>{strips.length ? `Fit strips to ${wanted} reels` : 'Copy the base strips'}</button
			>
		{/if}
	</div>
</div>

<style>
	.spins {
		margin-top: 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: flex-end;
		margin: 8px 0;
		border: none;
		padding: 0;
		min-width: 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: #8b8b98;
	}
	label.check {
		flex-direction: row;
		align-items: center;
	}
	input[type='number'] {
		width: 70px;
	}
	input.small {
		width: 50px;
	}
	input.line {
		width: 130px;
	}
	input.pays {
		width: 180px;
	}
	.note {
		font-size: 11px;
		color: #6f6f7d;
	}
	.tbl {
		border-collapse: collapse;
		margin: 6px 0;
		font-size: 12px;
	}
	.tbl th,
	.tbl td {
		padding: 3px 10px 3px 0;
		text-align: left;
	}
	.tbl th {
		color: #8b8b98;
		font-weight: 600;
	}
	.inline-issue {
		margin: 4px 0;
		font-size: 12px;
	}
	.inline-issue.error {
		color: #ff8a8a;
	}
	.inline-issue.warning {
		color: #e0b878;
	}
	button.danger {
		color: #ff8a8a;
	}
</style>
