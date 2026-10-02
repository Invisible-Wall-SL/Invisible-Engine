<script lang="ts">
	import {
		HOLD_AND_WIN_MODE,
		HOLD_AND_WIN_PRESET_IDS,
		HOLD_AND_WIN_PRESET_LABELS,
		HOLD_AND_WIN_SPECIALS,
		BASE_GAME_MODE,
		POTS_OVERLAY_PRESET_IDS,
		POTS_OVERLAY_PRESET_LABELS,
		addHoldAndWinBonus,
		addPotsOverlay,
		holdAndWinIsOverlayBonus,
		isCoinDrop,
		overlayDropModes,
		removePotsOverlay,
		resolveGameModes,
		symbolsInPlay,
		type AddOnResult,
		type GameConfigDoc,
		type GameConfigIssue,
		type HoldAndWinPresetId,
		type OverlayDrops,
		type OverlayPot,
		type PotsOverlay,
		type PotsOverlayPresetId,
	} from 'game-config';
	import { askConfirm } from '$lib/dialogs.svelte';

	/**
	 * The kind-independent ADD-ONS of `/config` (`docs/design/pots-overlay.md` §4): the pots overlay
	 * and a Hold and Win bonus, on any kind. Adding and removing go through the `game-config` merge
	 * helpers, so neither ever resets the doc; the Hold and Win block itself is edited in its own
	 * section once it exists. Like that section, every input writes straight into the block and the
	 * page's validator is the only judge of what is wrong — its issues are shown on the row or field
	 * they name.
	 */
	let {
		doc = $bindable(),
		issuesFor,
		readOnly,
	}: {
		doc: GameConfigDoc;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
	} = $props();

	type NumberInput = Event & { currentTarget: HTMLInputElement };

	const num =
		(apply: (n: number) => void, integer = false) =>
		(e: NumberInput) => {
			const n = e.currentTarget.valueAsNumber;
			if (Number.isFinite(n)) apply(integer ? Math.floor(n) : n);
		};

	const SPECIAL_LABELS: Record<(typeof HOLD_AND_WIN_SPECIALS)[number], string> = {
		collector: 'Collector',
		multiplier: 'Multiplier',
		payer: 'Payer',
		mystery: 'Mystery',
		addRespins: 'Add respins',
		upgrade: 'Upgrade',
	};

	const snapshot = (): GameConfigDoc => $state.snapshot(doc) as GameConfigDoc;

	const modes = $derived(resolveGameModes(doc));
	const bonusModes = $derived(modes.filter((m) => m.id !== BASE_GAME_MODE));
	const reelModes = $derived(modes.filter((m) => m.board === 'reels'));
	const reelIndices = $derived([...Array(doc.numReels).keys()]);
	const inPlay = $derived(new Set(symbolsInPlay(doc)));
	/** Token candidates: off-strip `meterSpecial` symbols first — a token is never dealt by a strip. */
	const tokenChoices = $derived(
		Object.keys(doc.symbols).sort((a, b) => tokenRank(a) - tokenRank(b) || a.localeCompare(b)),
	);
	function tokenRank(name: string): number {
		const tagged = doc.symbols[name]?.special_properties?.includes('meterSpecial');
		return (inPlay.has(name) ? 2 : 0) + (tagged ? 0 : 1);
	}

	const issuesAt = (path: string) => issuesFor(path).filter((i) => i.path === path);
	const errorAt = (path: string) => issuesFor(path).some((i) => i.severity === 'error');

	// ── add / remove ───────────────────────────────────────────────────────────────────────────
	let overlayPreset = $state<PotsOverlayPresetId>(POTS_OVERLAY_PRESET_IDS[0]);
	let bonusPreset = $state<HoldAndWinPresetId>(HOLD_AND_WIN_PRESET_IDS[0]);
	/** What the last add did beyond the obvious — a rename or a refusal. Local, never saved. */
	let notice = $state<{ kind: 'info' | 'error'; text: string } | null>(null);

	function apply(result: AddOnResult, what: string) {
		if (!result.ok) {
			notice = { kind: 'error', text: result.reason };
			return;
		}
		doc = result.doc;
		const renames = [
			...Object.entries(result.renamed.symbols).map(([from, to]) => `symbol ${from} → ${to}`),
			...Object.entries(result.renamed.pots).map(([from, to]) => `pot ${from} → ${to}`),
		];
		notice = renames.length
			? {
					kind: 'info',
					text: `Added ${what}. These names were already taken, so they were renamed: ${renames.join(', ')}.`,
				}
			: null;
	}

	function addOverlay() {
		apply(addPotsOverlay(snapshot(), overlayPreset), POTS_OVERLAY_PRESET_LABELS[overlayPreset]);
	}

	function addBonus() {
		apply(addHoldAndWinBonus(snapshot(), bonusPreset), 'the Hold and Win bonus');
	}

	async function removeOverlay() {
		const withBonus = holdAndWinIsOverlayBonus(snapshot());
		const ok = await askConfirm({
			title: 'Remove the pots overlay?',
			message: withBonus
				? 'This removes the pots, the drop table and their token symbols — and the Hold and Win bonus the pots start, with its respin strips and symbols. The rest of the config is kept. Nothing is saved until you press Save.'
				: 'This removes the pots, the drop table and their token symbols. The rest of the config is kept. Nothing is saved until you press Save.',
			confirmLabel: 'Remove',
			danger: true,
		});
		if (!ok) return;
		doc = removePotsOverlay(snapshot());
		drafts = [];
		notice = null;
	}

	// ── pots ───────────────────────────────────────────────────────────────────────────────────
	/**
	 * Pot rows still being typed. The normalizer drops a pot without its token or bonus, so a new row
	 * lives here until it has both and only then joins the block — a save never eats a half-typed pot.
	 */
	type DraftPot = { id: string; token: string; mode: string };
	let drafts = $state<DraftPot[]>([]);

	function freePotId(overlay: PotsOverlay): string {
		const taken = new Set([
			...overlay.pots.map((p) => p.id),
			...(doc.holdAndWin?.meters ?? []).map((m) => m.id),
			...drafts.map((d) => d.id),
		]);
		let n = overlay.pots.length + drafts.length + 1;
		while (taken.has(`pot${n}`)) n += 1;
		return `pot${n}`;
	}

	const draftComplete = (d: DraftPot) => Boolean(d.id.trim() && d.token && d.mode);

	function commitDraft(overlay: PotsOverlay, i: number) {
		const d = drafts[i];
		if (!draftComplete(d)) return;
		overlay.pots.push({
			id: d.id.trim(),
			token: d.token,
			maxLevel: 12,
			sizeStages: [],
			bonus: { mode: d.mode },
		});
		drafts.splice(i, 1);
	}

	/** Renaming a pot carries the drop table's references along. */
	function renamePot(overlay: PotsOverlay, pot: OverlayPot, next: string) {
		const old = pot.id;
		pot.id = next;
		if (overlay.pots.some((p) => p !== pot && p.id === old)) return;
		for (const entry of overlay.drops.table) {
			if (!isCoinDrop(entry) && entry.pot === old) entry.pot = next;
		}
	}

	function removePot(overlay: PotsOverlay, i: number) {
		const [gone] = overlay.pots.splice(i, 1);
		if (overlay.pots.some((p) => p.id === gone.id)) return;
		overlay.drops.table = overlay.drops.table.filter((e) => isCoinDrop(e) || e.pot !== gone.id);
	}

	/** A fresh token symbol for a pot: in the dictionary, tagged `meterSpecial`, on no strip. */
	function newToken(id: string): string {
		const base = `POT_${(id.trim() || 'NEW').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
		let name = base;
		for (let n = 2; doc.symbols[name]; n += 1) name = `${base}_${n}`;
		doc.symbols[name] = { special_properties: ['meterSpecial'] };
		return name;
	}

	function setSizeStages(stages: number[], raw: string) {
		const next = [
			...new Set(
				raw
					.split(',')
					.map((s) => Number(s.trim()))
					.filter((n) => Number.isInteger(n) && n >= 1),
			),
		].sort((a, b) => a - b);
		stages.splice(0, stages.length, ...next);
	}

	/** A bonus keeps only the fields its mode reads: `activates` for Hold and Win, `spins` for a
	 *  reels mode. */
	function setBonusMode(pot: OverlayPot, mode: string) {
		pot.bonus.mode = mode;
		if (mode !== HOLD_AND_WIN_MODE) delete pot.bonus.activates;
		if (!isReelsMode(mode)) delete pot.bonus.spins;
	}

	function setActivates(pot: OverlayPot, value: string) {
		const special = HOLD_AND_WIN_SPECIALS.find((s) => s === value);
		if (special) pot.bonus.activates = special;
		else delete pot.bonus.activates;
	}

	function setSpins(pot: OverlayPot, e: NumberInput) {
		const n = e.currentTarget.valueAsNumber;
		if (Number.isFinite(n) && n >= 1) pot.bonus.spins = Math.floor(n);
		else delete pot.bonus.spins;
	}

	const isReelsMode = (mode: string) => modes.some((m) => m.id === mode && m.board === 'reels');

	// ── drops ──────────────────────────────────────────────────────────────────────────────────
	const COIN = '__coin__';
	const share = (weight: number, total: number) =>
		total > 0 ? `${((weight / total) * 100).toFixed(1)}%` : '—';

	function setDropKind(drops: OverlayDrops, i: number, value: string) {
		const { weight } = drops.table[i];
		drops.table[i] = value === COIN ? { coin: true, weight } : { pot: value, weight };
	}

	function addDrop(overlay: PotsOverlay) {
		const filled = new Set(overlay.drops.table.flatMap((e) => (isCoinDrop(e) ? [] : [e.pot])));
		const pot = overlay.pots.find((p) => !filled.has(p.id)) ?? overlay.pots[0];
		overlay.drops.table.push(pot ? { pot: pot.id, weight: 1 } : { coin: true, weight: 1 });
	}

	/** `reels` is stored only while one is ticked — none ticked means every reel, exactly how the
	 *  normalizer reads an absent list. */
	function toggleReel(drops: OverlayDrops, reel: number, on: boolean) {
		const rest = (drops.reels ?? []).filter((r) => r !== reel);
		const next = on ? [...rest, reel].sort((a, b) => a - b) : rest;
		if (next.length) drops.reels = next;
		else delete drops.reels;
	}

	/** `modes` is stored only while it departs from the base game alone, as the normalizer stores it. */
	function toggleMode(drops: OverlayDrops, mode: string, on: boolean) {
		const rest = overlayDropModes(drops).filter((m) => m !== mode);
		const next = on ? [...rest, mode] : rest;
		if (next.length === 1 && next[0] === BASE_GAME_MODE) delete drops.modes;
		else drops.modes = reelModes.map((m) => m.id).filter((id) => next.includes(id));
	}
</script>

{#snippet issueLines(list: GameConfigIssue[])}
	{#each list as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}">{issue.message}</p>
	{/each}
{/snippet}

{#snippet overlayEditor(overlay: PotsOverlay)}
	{@const drops = overlay.drops}
	{@const dropTotal = drops.table.reduce((sum, e) => sum + e.weight, 0)}
	<div class="panel">
		<div class="row tight">
			<h3>
				Pots overlay <em
					>tokens drop over the symbols and fly to pots; a full pot starts its bonus</em
				>
			</h3>
			<button class="small danger push" onclick={removeOverlay} disabled={readOnly}
				>Remove overlay</button
			>
		</div>
		{@render issueLines(issuesAt('potsOverlay'))}

		<span class="legend">Pots <em>the server keeps each player's level</em></span>
		<table class="tbl">
			<thead>
				<tr
					><th>Id</th><th>Token</th><th>Max level</th><th>Size stages</th><th>Starts</th><th
						>With</th
					><th></th></tr
				>
			</thead>
			<tbody>
				{#each overlay.pots as pot, i (i)}
					{@const at = `potsOverlay.pots.${i}`}
					<tr>
						<td
							><input
								class="id"
								class:bad={errorAt(`${at}.id`)}
								value={pot.id}
								oninput={(e) => renamePot(overlay, pot, e.currentTarget.value)}
							/></td
						>
						<td class="nowrap"
							><select class:bad={errorAt(`${at}.token`)} bind:value={pot.token}>
								{#each tokenChoices as name (name)}
									<option value={name}
										>{name}{inPlay.has(name)
											? ' (on a strip)'
											: doc.symbols[name].special_properties?.includes('meterSpecial')
												? ''
												: ' (not meterSpecial)'}</option
									>
								{/each}
								{#if !doc.symbols[pot.token]}
									<option value={pot.token}>{pot.token} — not in the dictionary</option>
								{/if}
							</select>
							<button
								class="small"
								title="A new token symbol for this pot, tagged meterSpecial"
								onclick={() => (pot.token = newToken(pot.id))}>＋ new</button
							></td
						>
						<td
							><input
								type="number"
								min="1"
								class:bad={errorAt(`${at}.maxLevel`)}
								value={pot.maxLevel}
								oninput={num((n) => n >= 1 && (pot.maxLevel = n), true)}
							/></td
						>
						<td
							><input
								class="stages"
								class:bad={errorAt(`${at}.sizeStages`)}
								value={pot.sizeStages.join(', ')}
								placeholder="5, 9"
								onchange={(e) => setSizeStages(pot.sizeStages, e.currentTarget.value)}
							/></td
						>
						<td
							><select
								class:bad={errorAt(`${at}.bonus.mode`)}
								value={pot.bonus.mode}
								onchange={(e) => setBonusMode(pot, e.currentTarget.value)}
							>
								{#each bonusModes as m (m.id)}
									<option value={m.id}>{m.label ?? m.id}</option>
								{/each}
								{#if !bonusModes.some((m) => m.id === pot.bonus.mode)}
									<option value={pot.bonus.mode}>{pot.bonus.mode} — not a mode here</option>
								{/if}
							</select></td
						>
						<td>
							{#if pot.bonus.mode === HOLD_AND_WIN_MODE}
								<select
									class:bad={errorAt(`${at}.bonus.activates`)}
									value={pot.bonus.activates ?? ''}
									onchange={(e) => setActivates(pot, e.currentTarget.value)}
								>
									<option value="">no special</option>
									{#each HOLD_AND_WIN_SPECIALS as s (s)}
										<option value={s}
											>{SPECIAL_LABELS[s]} active{doc.holdAndWin?.specials[s]
												? ''
												: ' (not configured)'}</option
										>
									{/each}
								</select>
							{:else if isReelsMode(pot.bonus.mode)}
								<label class="inline"
									><input
										type="number"
										min="1"
										class="count"
										class:bad={errorAt(`${at}.bonus.spins`)}
										value={pot.bonus.spins ?? ''}
										placeholder="—"
										oninput={(e) => setSpins(pot, e)}
									/><span>spins <em>(mock)</em></span></label
								>
							{/if}
						</td>
						<td
							><button class="del" title="Remove" onclick={() => removePot(overlay, i)}>×</button
							></td
						>
					</tr>
					{#if issuesFor(at).length}
						<tr class="issues"><td colspan="7">{@render issueLines(issuesFor(at))}</td></tr>
					{/if}
				{/each}
				{#each drafts as d, i (i)}
					<tr class="draft">
						<td><input class="id" bind:value={d.id} /></td>
						<td class="nowrap"
							><select bind:value={d.token}>
								<option value="">pick a token…</option>
								{#each tokenChoices as name (name)}
									<option value={name}>{name}{inPlay.has(name) ? ' (on a strip)' : ''}</option>
								{/each}
							</select>
							<button class="small" onclick={() => (d.token = newToken(d.id))}>＋ new</button></td
						>
						<td colspan="2" class="note">new pot — pick its token and bonus, then add it</td>
						<td
							><select bind:value={d.mode}>
								<option value="">pick a bonus…</option>
								{#each bonusModes as m (m.id)}
									<option value={m.id}>{m.label ?? m.id}</option>
								{/each}
							</select></td
						>
						<td
							><button
								class="small"
								disabled={!draftComplete(d)}
								onclick={() => commitDraft(overlay, i)}>Add pot</button
							></td
						>
						<td
							><button class="del" title="Discard" onclick={() => drafts.splice(i, 1)}>×</button
							></td
						>
					</tr>
				{/each}
			</tbody>
		</table>
		<button
			class="small"
			onclick={() => drafts.push({ id: freePotId(overlay), token: '', mode: '' })}>+ pot</button
		>
		{@render issueLines(issuesAt('potsOverlay.pots'))}

		<span class="legend">Drops <em>mock math — the RGS decides what really drops</em></span>
		<div class="row">
			<label
				><span>Chance per spin <em>0–1</em></span><input
					type="number"
					min="0"
					max="1"
					step="0.01"
					class:bad={errorAt('potsOverlay.drops.chance')}
					value={drops.chance}
					oninput={num((n) => (drops.chance = n))}
				/></label
			>
			<label
				><span>Most per spin</span><input
					type="number"
					min="1"
					class:bad={errorAt('potsOverlay.drops.maxPerSpin')}
					value={drops.maxPerSpin}
					oninput={num((n) => (drops.maxPerSpin = n), true)}
				/></label
			>
		</div>
		{@render issueLines([
			...issuesAt('potsOverlay.drops.chance'),
			...issuesAt('potsOverlay.drops.maxPerSpin'),
		])}
		<table class="tbl">
			<thead><tr><th>Drops</th><th>Weight</th><th></th></tr></thead>
			<tbody>
				{#each drops.table as entry, i (i)}
					{@const at = `potsOverlay.drops.table.${i}`}
					<tr>
						<td
							><select
								class:bad={errorAt(at)}
								value={isCoinDrop(entry) ? COIN : entry.pot}
								onchange={(e) => setDropKind(drops, i, e.currentTarget.value)}
							>
								{#each overlay.pots as pot, k (k)}
									<option value={pot.id}>a {pot.id} token</option>
								{/each}
								{#if !isCoinDrop(entry) && !overlay.pots.some((p) => p.id === entry.pot)}
									<option value={entry.pot}>{entry.pot} — not a pot</option>
								{/if}
								<option value={COIN}>a value coin (Hold and Win)</option>
							</select></td
						>
						<td class="weight"
							><input
								type="number"
								min="0"
								step="any"
								value={entry.weight}
								oninput={num((n) => (entry.weight = n))}
							/><span class="note">{share(entry.weight, dropTotal)}</span></td
						>
						<td
							><button class="del" title="Remove" onclick={() => drops.table.splice(i, 1)}>×</button
							></td
						>
					</tr>
					{#if issuesFor(at).length}
						<tr class="issues"><td colspan="3">{@render issueLines(issuesFor(at))}</td></tr>
					{/if}
				{/each}
			</tbody>
		</table>
		<button class="small" onclick={() => addDrop(overlay)}>+ drop</button>
		{@render issueLines(issuesAt('potsOverlay.drops.table'))}

		<div class="sub">
			<span class="legend">Reels a token can land on</span>
			<div class="checks">
				{#each reelIndices as reel (reel)}
					<label class="check"
						><input
							type="checkbox"
							checked={drops.reels?.includes(reel) ?? false}
							onchange={(e) => toggleReel(drops, reel, e.currentTarget.checked)}
						/><span>{reel + 1}</span></label
					>
				{/each}
				<span class="note">{drops.reels?.length ? '' : 'none ticked = every reel'}</span>
			</div>
			{@render issueLines(issuesAt('potsOverlay.drops.reels'))}
		</div>
		<div class="sub">
			<span class="legend"
				>Modes that drop <em>only modes on the reels have a cell to drop on</em></span
			>
			<div class="checks">
				{#each reelModes as m (m.id)}
					<label class="check"
						><input
							type="checkbox"
							checked={overlayDropModes(drops).includes(m.id)}
							onchange={(e) => toggleMode(drops, m.id, e.currentTarget.checked)}
						/><span>{m.label ?? m.id}</span></label
					>
				{/each}
			</div>
			{@render issueLines(issuesAt('potsOverlay.drops.modes'))}
		</div>
	</div>
{/snippet}

<section class="addons">
	<h2>Add-ons</h2>
	<p class="hint">
		Mechanics layered on this game, whatever its kind. Adding one merges its blocks and symbols into
		the config and never replaces what is already here; a name the config already uses is renamed.
		Token symbols live in the dictionary only — a strip never deals them.
	</p>
	{#if notice}
		<p class="inline-issue {notice.kind === 'error' ? 'error' : 'info'}">{notice.text}</p>
	{/if}

	{#if doc.potsOverlay}
		{@render overlayEditor(doc.potsOverlay)}
	{:else}
		<div class="row tight">
			<select bind:value={overlayPreset} disabled={readOnly}>
				{#each POTS_OVERLAY_PRESET_IDS as id (id)}
					<option value={id}>{POTS_OVERLAY_PRESET_LABELS[id]}</option>
				{/each}
			</select>
			<button class="small" onclick={addOverlay} disabled={readOnly}>＋ Pots overlay</button>
		</div>
	{/if}

	{#if !doc.holdAndWin}
		<div class="row tight">
			<select bind:value={bonusPreset} disabled={readOnly}>
				{#each HOLD_AND_WIN_PRESET_IDS as id (id)}
					<option value={id}>{HOLD_AND_WIN_PRESET_LABELS[id]}</option>
				{/each}
			</select>
			<button class="small" onclick={addBonus} disabled={readOnly}>＋ Hold and Win bonus</button>
			<span class="note"
				>its respin rules, coins and jackpots — edited in the Hold and Win section</span
			>
		</div>
	{/if}
</section>

<style>
	.addons {
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
	h3 {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #e0b878;
	}
	h3 em,
	.legend em,
	label span em {
		font-style: normal;
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: #6f6f7d;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.note {
		font-size: 11px;
		color: #6f6f7d;
	}
	.panel {
		border: 1px solid #1c1c24;
		border-left: 3px solid #e0b878;
		border-radius: 10px;
		padding: 12px;
		background: #0e0e14;
		margin-bottom: 12px;
	}
	.sub {
		margin-top: 10px;
	}
	.legend {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #8b8b98;
		margin: 12px 0 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: flex-end;
		margin-bottom: 6px;
	}
	.row.tight {
		gap: 8px;
		align-items: center;
	}
	.push {
		margin-left: auto;
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		align-items: center;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8b98;
	}
	label.inline {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		text-transform: none;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: #b9b9c4;
	}
	input,
	select {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 6px 8px;
		font-size: 13px;
		font-family: inherit;
		box-sizing: border-box;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.bad {
		border-color: #a05050;
	}
	input[type='number'] {
		width: 90px;
	}
	input.count {
		width: 64px;
	}
	input.id {
		width: 110px;
	}
	input.stages {
		width: 90px;
	}
	input[type='checkbox'] {
		width: auto;
		margin: 0;
	}
	.tbl {
		border-collapse: collapse;
		margin-bottom: 6px;
	}
	.tbl th {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 4px 8px;
		text-align: left;
		border-bottom: 1px solid #1c1c24;
		white-space: nowrap;
	}
	.tbl td {
		padding: 4px 8px;
		border-bottom: 1px solid #16161d;
		vertical-align: middle;
	}
	.tbl td.weight,
	.tbl td.nowrap {
		white-space: nowrap;
	}
	.tbl td.weight .note {
		margin-left: 6px;
	}
	.tbl tr.draft td {
		background: #12121a;
	}
	.tbl tr.issues td {
		padding-top: 0;
	}
	button.small {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
	button.small.danger {
		background: #2a1b1b;
		border-color: #4a2f2f;
		color: #e09090;
	}
	button.small:disabled {
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
		margin: 0 0 8px;
		font-size: 12px;
	}
	.inline-issue.error {
		color: #e09090;
	}
	.inline-issue.warning {
		color: #d3b483;
	}
	.inline-issue.info {
		color: #7ee0c0;
	}
</style>
