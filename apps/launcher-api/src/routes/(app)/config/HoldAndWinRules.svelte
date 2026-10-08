<script lang="ts">
	import {
		BOARD_END_TYPES,
		EXPANSION_RULES,
		HOLD_AND_WIN_SPECIALS,
		HOLD_AND_WIN_SYMBOL_ROLES,
		RESPIN_PLAY,
		RESPIN_RESETS,
		SPECIAL_SYMBOL_ROLE,
		STICKINESS,
		UPGRADE_TARGETS,
		coinEntryLabel,
		configuredSpecials,
		normalizeHoldAndWin,
		symbolsWithRole,
		type BoardEnd,
		type CoinValueEntry,
		type ExpansionRule,
		type GameConfigDoc,
		type GameConfigIssue,
		type HoldAndWinGame,
		type HoldAndWinJackpot,
		type HoldAndWinProgressive,
		type HoldAndWinExpansion,
		type HoldAndWinSpecial,
		type HoldAndWinSymbolRole,
		type MysteryReveal,
		type RespinPlay,
		type RespinReset,
		type Stickiness,
		type UpgradeSpecial,
		type UpgradeTarget,
		type WeightedValue,
		type WheelPrize,
	} from 'game-config';
	import { ROLE_LABELS, SPECIAL_LABELS, num } from './bonusLabels';
	import { setRespinPlay } from './pageDoc';

	/**
	 * One respin mode's Hold and Win RULES (`docs/design/hold-and-win.md` §1.3, §5;
	 * `docs/design/bonus-games.md` §2.4): what sticks, the board end and expansion, the coin values,
	 * jackpots, specials and the wheel. What starts the mode and what lands in the base game are the
	 * coin overlay's (`CoinOverlaySection`). Every input writes straight into `rules` — the mode's
	 * `holdAndWin` in the live doc; the page's validator is the only judge of what is wrong (`prefix`
	 * is where its issues for this mode are), so nothing here re-checks a cross-reference — it only
	 * keeps each write in the SHAPE `normalizeHoldAndWinGame` stores (optional keys deleted rather than
	 * emptied), so a saved doc comes back byte-identical.
	 */
	let {
		rules = $bindable(),
		doc,
		prefix,
		issuesFor,
		readOnly,
		onRenameJackpot,
	}: {
		rules: HoldAndWinGame;
		/** The live doc, read for the grid and the symbol dictionary. */
		doc: GameConfigDoc;
		prefix: string;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
		/** A tier was renamed: the references outside these rules (the base-game coins) follow. */
		onRenameJackpot: (from: string, to: string) => void;
	} = $props();

	type NumberInput = Event & { currentTarget: HTMLInputElement };

	const STICKINESS_LABELS: Record<Stickiness, string> = {
		allCoins: 'Every coin sticks',
		collectorsOnly: 'Only collectors stick (coins clear each respin)',
	};
	const PLAY_LABELS: Record<RespinPlay, string> = {
		auto: 'Automatic — the respins follow each other, a tap speeds them up',
		manual: 'Manual — the player presses SPIN for each respin',
	};
	const RESET_LABELS: Record<RespinReset, string> = {
		anyCoin: 'A new coin or jackpot resets the count',
		anySpecial: 'Any new coin, jackpot or special resets the count',
	};
	const BOARD_END_LABELS: Record<BoardEnd['type'], string> = {
		none: 'Nothing — the feature ends on 0 respins',
		fullBoardJackpot: 'A full board awards a jackpot',
		columnLetters: 'Column letters — a full column lights a letter',
	};
	const EXPANSION_RULE_LABELS: Record<ExpansionRule, string> = {
		fullRow: 'Filling the bottom open row opens the next',
		unlockSymbol: 'An unlock symbol landing opens a row',
		coinCount: 'Enough held symbols open a row',
	};
	const SPECIAL_HINTS: Record<HoldAndWinSpecial, string> = {
		collector: 'Gathers the value of the coins on the board into itself.',
		multiplier: 'Multiplies the coins on the board by a factor.',
		payer: 'Adds a value to every coin on the board.',
		mystery: 'Reveals as a coin, a jackpot or another special.',
		addRespins: 'Adds respins to the counter when it lands in a respin.',
		upgrade: 'Raises coins: every coin, the coins around it, or one jackpot coin a tier.',
	};
	const UPGRADE_TARGET_LABELS: Record<UpgradeTarget, string> = {
		all: 'every cash coin, by its step',
		adjacent: 'the cash coins in the 8 cells around it, by its step',
		jackpotTier: 'the lowest jackpot coin, one tier up',
	};
	const COIN_ROLES: HoldAndWinSymbolRole[] = ['coin', 'jackpot'];
	const MYSTERY_SPECIALS = HOLD_AND_WIN_SPECIALS.filter(
		(s): s is Exclude<HoldAndWinSpecial, 'mystery'> => s !== 'mystery',
	);

	const reelIndices = $derived([...Array(doc.numReels).keys()]);
	/** The trigger and the meters are the coin overlay's, which shows their issues. */
	const blockIssues = $derived(
		issuesFor(prefix).filter(
			(i) => !i.path.startsWith(`${prefix}.trigger`) && !i.path.startsWith(`${prefix}.meters`),
		),
	);

	/** Which special cards are folded shut — local UI state only, never saved. */
	let folded = $state<Partial<Record<HoldAndWinSpecial, boolean>>>({});

	// ── shared list helpers ────────────────────────────────────────────────────────────────────
	function toggleIn<T>(list: T[], value: T, on: boolean) {
		const at = list.indexOf(value);
		if (on && at < 0) list.push(value);
		if (!on && at >= 0) list.splice(at, 1);
	}

	/** `reels` is stored only while at least one is ticked — none ticked means every reel, exactly
	 *  how the normalizer reads an absent list. */
	function toggleReel(target: { reels?: number[] }, reel: number, on: boolean) {
		const rest = (target.reels ?? []).filter((r) => r !== reel);
		const next = on ? [...rest, reel].sort((a, b) => a - b) : rest;
		if (next.length) target.reels = next;
		else delete target.reels;
	}

	function move<T>(list: T[], index: number, dir: -1 | 1) {
		const j = index + dir;
		if (j < 0 || j >= list.length) return;
		[list[index], list[j]] = [list[j], list[index]];
	}

	const lastJackpot = (hw: HoldAndWinGame): string =>
		hw.jackpots[hw.jackpots.length - 1]?.name ?? '';

	// ── respins ────────────────────────────────────────────────────────────────────────────────
	function setCap(hw: HoldAndWinGame, e: NumberInput) {
		const n = e.currentTarget.valueAsNumber;
		if (Number.isFinite(n) && n >= 1) hw.respins.cap = Math.floor(n);
		else delete hw.respins.cap;
	}

	// ── board end ──────────────────────────────────────────────────────────────────────────────
	function setBoardEndType(hw: HoldAndWinGame, type: string) {
		if (type === 'fullBoardJackpot') {
			hw.boardEnd = { type, jackpot: lastJackpot(hw), roles: ['coin', 'jackpot'] };
		} else if (type === 'columnLetters') {
			const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, doc.numReels);
			hw.boardEnd = { type, letters, jackpot: lastJackpot(hw), clearOnComplete: true };
		} else hw.boardEnd = { type: 'none' };
	}

	// ── coins ──────────────────────────────────────────────────────────────────────────────────
	function setCoinKind(hw: HoldAndWinGame, i: number, kind: string) {
		const entry = hw.coins[i];
		const reels = entry.reels ? { reels: [...entry.reels] } : {};
		hw.coins[i] =
			kind === 'jackpot'
				? { kind: 'jackpot', jackpot: lastJackpot(hw), weight: entry.weight, ...reels }
				: { kind: 'cash', value: 1, weight: entry.weight, ...reels };
	}
	function setCoinValue(entry: CoinValueEntry, value: number) {
		if (entry.kind === 'cash' && value > 0) entry.value = value;
	}
	function setCoinJackpot(entry: CoinValueEntry, name: string) {
		if (entry.kind === 'jackpot') entry.jackpot = name;
	}
	function addCashCoin(hw: HoldAndWinGame) {
		const values = hw.coins.flatMap((c) => (c.kind === 'cash' ? [c.value] : []));
		hw.coins.push({ kind: 'cash', value: values[values.length - 1] ?? 1, weight: 1 });
	}
	const coinWeightTotal = (hw: HoldAndWinGame) => hw.coins.reduce((sum, c) => sum + c.weight, 0);
	const share = (weight: number, total: number) =>
		total > 0 ? `${((weight / total) * 100).toFixed(1)}%` : '—';

	// ── jackpots ───────────────────────────────────────────────────────────────────────────────
	/** Renaming a tier carries every reference to it along (coins, board end, mystery, wheel) —
	 *  unless another tier still has the old name, which keeps those references its own. */
	function renameJackpot(hw: HoldAndWinGame, i: number, next: string) {
		const old = hw.jackpots[i].name;
		hw.jackpots[i].name = next;
		if (hw.jackpots.some((j, k) => k !== i && j.name === old)) return;
		for (const c of hw.coins) if (c.kind === 'jackpot' && c.jackpot === old) c.jackpot = next;
		if (hw.boardEnd.type !== 'none' && hw.boardEnd.jackpot === old) hw.boardEnd.jackpot = next;
		for (const r of hw.specials.mystery?.reveals ?? []) {
			if (r.type === 'jackpot' && r.jackpot === old) r.jackpot = next;
		}
		for (const p of hw.wheel?.prizes ?? []) {
			if (p.type === 'jackpot' && p.jackpot === old) p.jackpot = next;
		}
		for (const rj of hw.expansion?.rowJackpots ?? []) if (rj.jackpot === old) rj.jackpot = next;
		onRenameJackpot(old, next);
	}
	/** A tier turned progressive starts as a pool at its multiplier that nothing grows yet; a tier
	 *  turned fixed drops its pool, so the saved doc carries no field nothing reads. */
	function setFixed(j: HoldAndWinJackpot, fixed: boolean) {
		j.fixed = fixed;
		if (fixed) delete j.progressive;
		else j.progressive ??= { seed: j.multiplier, contribution: 0 };
	}
	function setPoolCap(pool: HoldAndWinProgressive, e: NumberInput) {
		const n = e.currentTarget.valueAsNumber;
		if (e.currentTarget.value === '') delete pool.cap;
		else if (Number.isFinite(n) && n > 0) pool.cap = n;
	}
	function addJackpot(hw: HoldAndWinGame) {
		const top = hw.jackpots[hw.jackpots.length - 1];
		hw.jackpots.push({
			name: `TIER${hw.jackpots.length + 1}`,
			multiplier: top ? top.multiplier * 2 : 10,
			fixed: true,
		});
	}

	// ── specials ───────────────────────────────────────────────────────────────────────────────
	function enableSpecial(hw: HoldAndWinGame, kind: HoldAndWinSpecial) {
		if (kind === 'collector') {
			hw.specials.collector = {
				level: 1,
				maxLevel: 1,
				sticky: true,
				collects: 'perRespin',
			};
		} else if (kind === 'multiplier') {
			hw.specials.multiplier = {
				values: [
					{ value: 2, weight: 6 },
					{ value: 3, weight: 3 },
					{ value: 5, weight: 1 },
				],
				multipliesJackpots: false,
				leaveBehind: { type: 'none' },
			};
		} else if (kind === 'payer') {
			hw.specials.payer = {
				values: [
					{ value: 1, weight: 1 },
					{ value: 2, weight: 1 },
					{ value: 3, weight: 1 },
				],
			};
		} else if (kind === 'addRespins') {
			hw.specials.addRespins = {
				values: [
					{ value: 1, weight: 3 },
					{ value: 2, weight: 1 },
				],
				raisesCap: false,
				sticky: false,
			};
		} else if (kind === 'upgrade') {
			hw.specials.upgrade = {
				targets: [{ target: 'all', weight: 1 }],
				values: [
					{ value: 0.5, weight: 2 },
					{ value: 1, weight: 1 },
				],
			};
		} else {
			hw.specials.mystery = { reveals: [{ type: 'coin', weight: 1 }], unlocksInactive: false };
		}
		if (!hw.applyOrder.includes(kind)) hw.applyOrder.push(kind);
	}
	function disableSpecial(hw: HoldAndWinGame, kind: HoldAndWinSpecial) {
		delete hw.specials[kind];
		hw.applyOrder = hw.applyOrder.filter((k) => k !== kind);
		hw.activeModifiers.atEntry = hw.activeModifiers.atEntry.filter((k) => k !== kind);
	}
	function setSpecial(hw: HoldAndWinGame, kind: HoldAndWinSpecial, on: boolean) {
		if (on) enableSpecial(hw, kind);
		else disableSpecial(hw, kind);
	}

	function setLeaveBehind(hw: HoldAndWinGame, type: string) {
		const mul = hw.specials.multiplier;
		if (!mul) return;
		mul.leaveBehind =
			type === 'becomesCoin'
				? {
						type: 'becomesCoin',
						values: [
							{ value: 1, weight: 1 },
							{ value: 2, weight: 1 },
						],
					}
				: { type: 'none' };
	}
	function leaveBehindValues(hw: HoldAndWinGame): WeightedValue[] | undefined {
		const lb = hw.specials.multiplier?.leaveBehind;
		return lb?.type === 'becomesCoin' ? lb.values : undefined;
	}

	/** A rule is listed once (the normalizer keeps the first of a repeat), so a new row takes the
	 *  first rule not yet listed. */
	function addUpgradeTarget(upg: Pick<UpgradeSpecial, 'targets'>) {
		const target = UPGRADE_TARGETS.find((t) => !upg.targets.some((o) => o.target === t));
		if (target) upg.targets.push({ target, weight: 1 });
	}
	function setUpgradeTarget(upg: Pick<UpgradeSpecial, 'targets'>, i: number, value: string) {
		const target = UPGRADE_TARGETS.find((t) => t === value);
		if (target && !upg.targets.some((o, j) => j !== i && o.target === target)) {
			upg.targets[i].target = target;
		}
	}

	function setRevealType(hw: HoldAndWinGame, i: number, type: string) {
		const reveals = hw.specials.mystery?.reveals;
		if (!reveals) return;
		const weight = reveals[i].weight;
		const next: MysteryReveal =
			type === 'jackpot'
				? { type: 'jackpot', jackpot: lastJackpot(hw), weight }
				: type === 'special'
					? { type: 'special', special: configuredMysteryTarget(hw), weight }
					: { type: 'coin', weight };
		reveals[i] = next;
	}
	const configuredMysteryTarget = (hw: HoldAndWinGame): Exclude<HoldAndWinSpecial, 'mystery'> =>
		MYSTERY_SPECIALS.find((s) => hw.specials[s]) ?? 'collector';
	function setRevealJackpot(r: MysteryReveal, name: string) {
		if (r.type === 'jackpot') r.jackpot = name;
	}
	function setRevealSpecial(r: MysteryReveal, value: string) {
		const special = MYSTERY_SPECIALS.find((s) => s === value);
		if (r.type === 'special' && special) r.special = special;
	}

	// ── board expansion ────────────────────────────────────────────────────────────────────────
	const gridRows = $derived(doc.numRows[0] ?? 3);
	/** A default threshold per unlockable row: 60% of the cells open before it. */
	const defaultThresholds = (grow: HoldAndWinExpansion): number[] =>
		Array.from({ length: Math.max(0, grow.maxRows - grow.startRows) }, (_, i) =>
			Math.ceil(doc.numReels * (grow.startRows + i) * 0.6),
		);
	function setExpansion(hw: HoldAndWinGame, on: boolean) {
		if (on) {
			hw.expansion = {
				startRows: gridRows,
				maxRows: gridRows + 3,
				rule: 'fullRow',
				resetsRespins: true,
			};
		} else delete hw.expansion;
	}
	/** Only the chosen rule's own field is stored, exactly as the normalizer keeps it. */
	function setExpansionRule(grow: HoldAndWinExpansion, value: string) {
		const rule = EXPANSION_RULES.find((r) => r === value);
		if (!rule) return;
		grow.rule = rule;
		if (rule === 'coinCount') grow.thresholds = defaultThresholds(grow);
		else delete grow.thresholds;
		if (rule !== 'unlockSymbol') delete grow.unlockReels;
	}
	/** Changing either end of the board keeps one threshold per unlockable row. */
	function setRows(grow: HoldAndWinExpansion, end: 'startRows' | 'maxRows', n: number) {
		grow[end] = n;
		if (grow.rule !== 'coinCount') return;
		const fill = defaultThresholds(grow);
		grow.thresholds = fill.map((t, i) => grow.thresholds?.[i] ?? t);
	}
	/** `unlockReels` is stored only while one is ticked, like a special's `reels`. */
	function toggleUnlockReel(grow: HoldAndWinExpansion, reel: number, on: boolean) {
		const target = { reels: grow.unlockReels };
		toggleReel(target, reel, on);
		if (target.reels) grow.unlockReels = target.reels;
		else delete grow.unlockReels;
	}
	function addRowJackpot(hw: HoldAndWinGame, grow: HoldAndWinExpansion) {
		(grow.rowJackpots ??= []).push({ rows: grow.maxRows, jackpot: lastJackpot(hw) });
	}
	function removeRowJackpot(grow: HoldAndWinExpansion, i: number) {
		grow.rowJackpots?.splice(i, 1);
		if (!grow.rowJackpots?.length) delete grow.rowJackpots;
	}

	// ── wheel ──────────────────────────────────────────────────────────────────────────────────
	function setWheel(hw: HoldAndWinGame, on: boolean) {
		if (on) hw.wheel = { prizes: [{ type: 'coinBoost', multiplier: 2, weight: 1 }] };
		else delete hw.wheel;
	}
	function setPrizeType(hw: HoldAndWinGame, i: number, type: string) {
		const prizes = hw.wheel?.prizes;
		if (!prizes) return;
		const weight = prizes[i].weight;
		const next: WheelPrize =
			type === 'extraCollect'
				? { type: 'extraCollect', count: 1, weight }
				: type === 'jackpot'
					? { type: 'jackpot', jackpot: lastJackpot(hw), weight }
					: { type: 'coinBoost', multiplier: 2, weight };
		prizes[i] = next;
	}
	function setPrizeAmount(p: WheelPrize, n: number) {
		if (p.type === 'coinBoost' && n > 0) p.multiplier = n;
		if (p.type === 'extraCollect' && n >= 1) p.count = Math.floor(n);
	}
	function setPrizeJackpot(p: WheelPrize, name: string) {
		if (p.type === 'jackpot') p.jackpot = name;
	}
</script>

{#snippet roleChecks(list: HoldAndWinSymbolRole[])}
	<div class="checks">
		{#each HOLD_AND_WIN_SYMBOL_ROLES as role (role)}
			<label class="check"
				><input
					type="checkbox"
					checked={list.includes(role)}
					onchange={(e) => toggleIn(list, role, e.currentTarget.checked)}
				/><span>{ROLE_LABELS[role]}</span></label
			>
		{/each}
	</div>
{/snippet}

{#snippet reelChecks(target: { reels?: number[] })}
	<div class="checks reels">
		{#each reelIndices as reel (reel)}
			<label class="check"
				><input
					type="checkbox"
					checked={target.reels?.includes(reel) ?? false}
					onchange={(e) => toggleReel(target, reel, e.currentTarget.checked)}
				/><span>{reel + 1}</span></label
			>
		{/each}
		<span class="note">{target.reels?.length ? '' : 'none ticked = every reel'}</span>
	</div>
{/snippet}

{#snippet jackpotPick(hw: HoldAndWinGame, value: string, set: (name: string) => void)}
	<select {value} onchange={(e) => set(e.currentTarget.value)}>
		{#each hw.jackpots as j (j.name)}
			<option value={j.name}>{j.name}</option>
		{/each}
		{#if !hw.jackpots.some((j) => j.name === value)}
			<option {value}>{value || '(none)'} — not a tier</option>
		{/if}
	</select>
{/snippet}

{#snippet valueTable(values: WeightedValue[], unit: string, step: number, integer = false)}
	<table class="tbl">
		<thead><tr><th>Value {unit}</th><th>Weight</th><th></th></tr></thead>
		<tbody>
			{#each values as v, i (i)}
				<tr>
					<td
						><input
							type="number"
							min="0"
							{step}
							value={v.value}
							oninput={num((n) => n > 0 && (v.value = n), integer)}
						/></td
					>
					<td
						><input
							type="number"
							min="0"
							step="any"
							value={v.weight}
							oninput={num((n) => n >= 0 && (v.weight = n))}
						/></td
					>
					<td><button class="del" title="Remove" onclick={() => values.splice(i, 1)}>×</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
	<button
		class="small"
		onclick={() => values.push({ value: values[values.length - 1]?.value ?? 1, weight: 1 })}
		>+ value</button
	>
{/snippet}

{#snippet specialFields(hw: HoldAndWinGame, kind: HoldAndWinSpecial)}
	{#if kind === 'collector' && hw.specials.collector}
		{@const c = hw.specials.collector}
		<div class="row">
			<label
				><span>Level <em>1 single · 2 double · 3 triple</em></span><input
					type="number"
					min="1"
					value={c.level}
					oninput={num((n) => n >= 1 && (c.level = n), true)}
				/></label
			>
			<label
				><span>Max level</span><input
					type="number"
					min="1"
					value={c.maxLevel}
					oninput={num((n) => n >= 1 && (c.maxLevel = n), true)}
				/></label
			>
			<label
				><span>Collects</span><select bind:value={c.collects}>
					<option value="perRespin">every respin it is on the board</option>
					<option value="atEnd">once, when the feature ends</option>
				</select></label
			>
		</div>
		<div class="row">
			<label class="check"
				><input type="checkbox" bind:checked={c.sticky} /><span>Sticky</span></label
			>
		</div>
		<div class="sub"><span class="legend">Reels</span>{@render reelChecks(c)}</div>
	{:else if kind === 'multiplier' && hw.specials.multiplier}
		{@const m = hw.specials.multiplier}
		{@const leftCoin = leaveBehindValues(hw)}
		<div class="sub">
			<span class="legend">Factors <em>x2 / x3 / x5, not × bet</em></span>
			{@render valueTable(m.values, '(×)', 1)}
		</div>
		<div class="row">
			<label class="check"
				><input type="checkbox" bind:checked={m.multipliesJackpots} /><span
					>Multiplies jackpots too</span
				></label
			>
			<label
				><span>Leaves behind</span><select
					value={m.leaveBehind.type}
					onchange={(e) => setLeaveBehind(hw, e.currentTarget.value)}
				>
					<option value="none">nothing</option>
					<option value="becomesCoin">a coin</option>
				</select></label
			>
		</div>
		{#if leftCoin}
			<div class="sub">
				<span class="legend">The coin it leaves <em>× total bet</em></span>
				{@render valueTable(leftCoin, '(× bet)', 0.5)}
			</div>
		{/if}
		<div class="sub"><span class="legend">Reels</span>{@render reelChecks(m)}</div>
	{:else if kind === 'payer' && hw.specials.payer}
		{@const p = hw.specials.payer}
		<div class="sub">
			<span class="legend">Added to every coin <em>× total bet</em></span>
			{@render valueTable(p.values, '(× bet)', 0.5)}
		</div>
		<div class="sub"><span class="legend">Reels</span>{@render reelChecks(p)}</div>
	{:else if kind === 'addRespins' && hw.specials.addRespins}
		{@const a = hw.specials.addRespins}
		<div class="sub">
			<span class="legend">Respins added <em>whole respins, not × bet</em></span>
			{@render valueTable(a.values, '(respins)', 1, true)}
		</div>
		<div class="row">
			<label class="check"
				><input type="checkbox" bind:checked={a.raisesCap} /><span
					>Also raises the count a reset fills back to</span
				></label
			>
			<label class="check"
				><input type="checkbox" bind:checked={a.sticky} /><span
					>Sticky — stays on the board (worth nothing) after it adds</span
				></label
			>
		</div>
		<div class="sub"><span class="legend">Reels</span>{@render reelChecks(a)}</div>
	{:else if kind === 'upgrade' && hw.specials.upgrade}
		{@const u = hw.specials.upgrade}
		{@const targetTotal = u.targets.reduce((sum, t) => sum + t.weight, 0)}
		<div class="sub">
			<span class="legend">What it raises <em>one rule drawn per landing</em></span>
			<table class="tbl">
				<thead><tr><th>Rule</th><th>Weight</th><th></th></tr></thead>
				<tbody>
					{#each u.targets as t, i (i)}
						<tr>
							<td
								><select
									value={t.target}
									onchange={(e) => setUpgradeTarget(u, i, e.currentTarget.value)}
								>
									{#each UPGRADE_TARGETS as target (target)}
										<option
											value={target}
											disabled={u.targets.some((o, j) => j !== i && o.target === target)}
											>{UPGRADE_TARGET_LABELS[target]}</option
										>
									{/each}
								</select></td
							>
							<td class="weight"
								><input
									type="number"
									min="0"
									step="any"
									value={t.weight}
									oninput={num((n) => n >= 0 && (t.weight = n))}
								/><span class="note">{share(t.weight, targetTotal)}</span></td
							>
							<td
								><button class="del" title="Remove" onclick={() => u.targets.splice(i, 1)}>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
			<button
				class="small"
				onclick={() => addUpgradeTarget(u)}
				disabled={u.targets.length >= UPGRADE_TARGETS.length}>+ rule</button
			>
		</div>
		<div class="sub">
			<span class="legend"
				>Step a cash coin rises by <em>× total bet · the jackpot-tier rule ignores it</em></span
			>
			{@render valueTable(u.values, '(× bet)', 0.5)}
		</div>
		<div class="sub"><span class="legend">Reels</span>{@render reelChecks(u)}</div>
	{:else if kind === 'mystery' && hw.specials.mystery}
		{@const y = hw.specials.mystery}
		<div class="sub">
			<span class="legend">Reveals</span>
			<table class="tbl">
				<thead><tr><th>Reveals as</th><th>Which</th><th>Weight</th><th></th></tr></thead>
				<tbody>
					{#each y.reveals as r, i (i)}
						<tr>
							<td
								><select
									value={r.type}
									onchange={(e) => setRevealType(hw, i, e.currentTarget.value)}
								>
									<option value="coin">a coin (from the coin table)</option>
									<option value="jackpot">a jackpot</option>
									<option value="special">a special</option>
								</select></td
							>
							<td>
								{#if r.type === 'jackpot'}
									{@render jackpotPick(hw, r.jackpot, (name) => setRevealJackpot(r, name))}
								{:else if r.type === 'special'}
									<select
										value={r.special}
										onchange={(e) => setRevealSpecial(r, e.currentTarget.value)}
									>
										{#each MYSTERY_SPECIALS as s (s)}
											<option value={s}
												>{SPECIAL_LABELS[s]}{hw.specials[s] ? '' : ' (not configured)'}</option
											>
										{/each}
									</select>
								{:else}
									<span class="note">—</span>
								{/if}
							</td>
							<td
								><input
									type="number"
									min="0"
									step="any"
									value={r.weight}
									oninput={num((n) => n >= 0 && (r.weight = n))}
								/></td
							>
							<td
								><button class="del" title="Remove" onclick={() => y.reveals.splice(i, 1)}>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
			<button class="small" onclick={() => y.reveals.push({ type: 'coin', weight: 1 })}
				>+ reveal</button
			>
		</div>
		<div class="row">
			<label class="check"
				><input type="checkbox" bind:checked={y.unlocksInactive} /><span
					>A revealed special that was not active activates for the rest of the round</span
				></label
			>
		</div>
		<div class="sub"><span class="legend">Reels</span>{@render reelChecks(y)}</div>
	{/if}
{/snippet}

{#snippet editor(hw: HoldAndWinGame)}
	{@const configured = configuredSpecials(hw)}
	{@const coinTotal = coinWeightTotal(hw)}
	<fieldset disabled={readOnly}>
		<!-- Respins ----------------------------------------------------------------------------->
		<div class="panel">
			<h3>Respins</h3>
			<div class="row">
				<label
					><span>What sticks</span><select bind:value={hw.stickiness}>
						{#each STICKINESS as s (s)}
							<option value={s}>{STICKINESS_LABELS[s]}</option>
						{/each}
					</select></label
				>
				<label
					><span>Respins at start</span><input
						type="number"
						min="1"
						value={hw.respins.start}
						oninput={num((n) => n >= 1 && (hw.respins.start = n), true)}
					/></label
				>
				<label
					><span>Reset rule</span><select bind:value={hw.respins.reset}>
						{#each RESPIN_RESETS as r (r)}
							<option value={r}>{RESET_LABELS[r]}</option>
						{/each}
					</select></label
				>
				<label
					><span>Cap <em>blank = none</em></span><input
						type="number"
						min="1"
						placeholder="none"
						value={hw.respins.cap ?? ''}
						oninput={(e) => setCap(hw, e)}
					/></label
				>
				<label
					><span>Play</span><select
						value={hw.play ?? 'auto'}
						onchange={(e) => setRespinPlay(hw, e.currentTarget.value as RespinPlay)}
					>
						{#each RESPIN_PLAY as p (p)}
							<option value={p}>{PLAY_LABELS[p]}</option>
						{/each}
					</select></label
				>
			</div>
		</div>

		<!-- Board end --------------------------------------------------------------------------->
		<div class="panel">
			<h3>Board end</h3>
			<div class="row">
				<label
					><span>When the board fills</span><select
						value={hw.boardEnd.type}
						onchange={(e) => setBoardEndType(hw, e.currentTarget.value)}
					>
						{#each BOARD_END_TYPES as t (t)}
							<option value={t}>{BOARD_END_LABELS[t]}</option>
						{/each}
					</select></label
				>
				{#if hw.boardEnd.type === 'fullBoardJackpot'}
					{@const end = hw.boardEnd}
					<label
						><span>Awards</span>{@render jackpotPick(
							hw,
							end.jackpot,
							(n) => (end.jackpot = n),
						)}</label
					>
				{:else if hw.boardEnd.type === 'columnLetters'}
					{@const end = hw.boardEnd}
					<label><span>Letters <em>one per reel</em></span><input bind:value={end.letters} /></label
					>
					<label
						><span>All lit awards</span>{@render jackpotPick(
							hw,
							end.jackpot,
							(n) => (end.jackpot = n),
						)}</label
					>
					<label class="check"
						><input type="checkbox" bind:checked={end.clearOnComplete} /><span
							>A lit column clears</span
						></label
					>
				{/if}
			</div>
			{#if hw.boardEnd.type === 'fullBoardJackpot'}
				<span class="legend">A cell counts as filled by</span>
				{@render roleChecks(hw.boardEnd.roles)}
			{/if}
		</div>

		<!-- Board expansion ------------------------------------------------------------------->
		<div class="panel">
			<h3>Board expansion <em>the respin board unlocks rows below the base grid</em></h3>
			<label class="check"
				><input
					type="checkbox"
					checked={Boolean(hw.expansion)}
					onchange={(e) => setExpansion(hw, e.currentTarget.checked)}
				/><span>Rows unlock during the feature</span></label
			>
			{#if hw.expansion}
				{@const grow = hw.expansion}
				<div class="sub">
					<div class="row">
						<label
							><span>Starts at <em>the grid's rows</em></span><input
								type="number"
								min="1"
								value={grow.startRows}
								oninput={num((n) => n >= 1 && setRows(grow, 'startRows', n), true)}
							/></label
						>
						<label
							><span>Grows to</span><input
								type="number"
								min="1"
								value={grow.maxRows}
								oninput={num((n) => n >= 1 && setRows(grow, 'maxRows', n), true)}
							/></label
						>
						<label
							><span>A row opens when</span><select
								value={grow.rule}
								onchange={(e) => setExpansionRule(grow, e.currentTarget.value)}
							>
								{#each EXPANSION_RULES as r (r)}
									<option value={r}>{EXPANSION_RULE_LABELS[r]}</option>
								{/each}
							</select></label
						>
						<label class="check"
							><input type="checkbox" bind:checked={grow.resetsRespins} /><span
								>An unlock resets the respins</span
							></label
						>
					</div>
					{#if grow.rule === 'coinCount' && grow.thresholds}
						{@const thresholds = grow.thresholds}
						<span class="legend">Held symbols that open each row</span>
						<div class="row">
							{#each thresholds as t, i (i)}
								<label
									><span>Row {grow.startRows + i + 1}</span><input
										type="number"
										min="1"
										value={t}
										oninput={num((n) => n >= 1 && (thresholds[i] = n), true)}
									/></label
								>
							{/each}
						</div>
					{:else if grow.rule === 'unlockSymbol'}
						<p class="note">
							Lands on symbols tagged <code>unlock</code> during the respins, opens one row, then clears.
						</p>
						<span class="legend">Reels</span>
						<div class="checks reels">
							{#each reelIndices as reel (reel)}
								<label class="check"
									><input
										type="checkbox"
										checked={grow.unlockReels?.includes(reel) ?? false}
										onchange={(e) => toggleUnlockReel(grow, reel, e.currentTarget.checked)}
									/><span>{reel + 1}</span></label
								>
							{/each}
							<span class="note">{grow.unlockReels?.length ? '' : 'none ticked = every reel'}</span>
						</div>
					{/if}
					<span class="legend"
						>Row jackpots <em>reaching that many rows pays the jackpot once</em></span
					>
					{#if grow.rowJackpots?.length}
						{@const rowJackpots = grow.rowJackpots}
						<table class="tbl">
							<thead><tr><th>Rows reached</th><th>Pays</th><th></th></tr></thead>
							<tbody>
								{#each rowJackpots as rj, i (i)}
									<tr>
										<td
											><input
												type="number"
												min="1"
												value={rj.rows}
												oninput={num((n) => n >= 1 && (rj.rows = n), true)}
											/></td
										>
										<td>{@render jackpotPick(hw, rj.jackpot, (n) => (rj.jackpot = n))}</td>
										<td
											><button class="del" title="Remove" onclick={() => removeRowJackpot(grow, i)}
												>×</button
											></td
										>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
					<button class="small" onclick={() => addRowJackpot(hw, grow)}>+ row jackpot</button>
					{#if hw.boardEnd.type === 'fullBoardJackpot'}
						<p class="note">The full-board jackpot needs every cell of all {grow.maxRows} rows.</p>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Coins ------------------------------------------------------------------------------->
		<div class="panel">
			<h3>Coin values <em>what a coin shows when it lands — × total bet, or a jackpot</em></h3>
			<p class="note">
				Lands on symbols tagged
				{#each COIN_ROLES as role (role)}
					{@const tagged = symbolsWithRole(doc, role)}
					<code>{role}</code>:
					{tagged.length ? tagged.join(', ') : 'none yet'}{role === 'coin' ? ' · ' : ''}
				{/each}
			</p>
			<table class="tbl">
				<thead>
					<tr><th>Shows</th><th>Kind</th><th>Value</th><th>Weight</th><th>Reels</th><th></th></tr>
				</thead>
				<tbody>
					{#each hw.coins as entry, i (i)}
						<tr>
							<td
								><span class="chip" class:jp={entry.kind === 'jackpot'}
									>{coinEntryLabel(entry)}</span
								></td
							>
							<td
								><select
									value={entry.kind}
									onchange={(e) => setCoinKind(hw, i, e.currentTarget.value)}
								>
									<option value="cash">cash</option>
									<option value="jackpot">jackpot</option>
								</select></td
							>
							<td>
								{#if entry.kind === 'cash'}
									<input
										type="number"
										min="0"
										step="0.5"
										value={entry.value}
										oninput={num((n) => setCoinValue(entry, n))}
									/>
								{:else}
									{@render jackpotPick(hw, entry.jackpot, (n) => setCoinJackpot(entry, n))}
								{/if}
							</td>
							<td class="weight"
								><input
									type="number"
									min="0"
									step="any"
									value={entry.weight}
									oninput={num((n) => n >= 0 && (entry.weight = n))}
								/><span class="note">{share(entry.weight, coinTotal)}</span></td
							>
							<td>{@render reelChecks(entry)}</td>
							<td
								><button class="del" title="Remove" onclick={() => hw.coins.splice(i, 1)}>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="row">
				<button class="small" onclick={() => addCashCoin(hw)}>+ cash coin</button>
				<button
					class="small"
					onclick={() => hw.coins.push({ kind: 'jackpot', jackpot: lastJackpot(hw), weight: 1 })}
					>+ jackpot coin</button
				>
			</div>
		</div>

		<!-- Jackpots ---------------------------------------------------------------------------->
		<div class="panel">
			<h3>Jackpot tiers <em>× total bet</em></h3>
			<table class="tbl">
				<thead
					><tr
						><th>Name</th><th>× total bet</th><th>Fixed</th><th
							title="Where the pool starts, and goes back to when won">Pool seed</th
						><th title="What every bet adds to the pool, × total bet">+ per bet</th><th
							title="The most the pool grows to; empty = no cap">Cap</th
						><th></th></tr
					></thead
				>
				<tbody>
					{#each hw.jackpots as j, i (i)}
						<tr>
							<td
								><input
									value={j.name}
									oninput={(e) => renameJackpot(hw, i, e.currentTarget.value)}
								/></td
							>
							<td
								><input
									type="number"
									min="0"
									step="any"
									value={j.multiplier}
									title={j.fixed
										? undefined
										: 'Shown only until the server reports the pool; the pool pays'}
									oninput={num((n) => n > 0 && (j.multiplier = n))}
								/></td
							>
							<td class="center"
								><input
									type="checkbox"
									checked={j.fixed}
									onchange={(e) => setFixed(j, e.currentTarget.checked)}
								/></td
							>
							{#if !j.fixed && j.progressive}
								{@const pool = j.progressive}
								<td
									><input
										type="number"
										min="0"
										step="any"
										value={pool.seed}
										oninput={num((n) => n > 0 && (pool.seed = n))}
									/></td
								>
								<td
									><input
										type="number"
										min="0"
										step="any"
										value={pool.contribution}
										oninput={num((n) => n >= 0 && (pool.contribution = n))}
									/></td
								>
								<td
									><input
										type="number"
										min="0"
										step="any"
										placeholder="none"
										value={pool.cap ?? ''}
										oninput={(e) => setPoolCap(pool, e)}
									/></td
								>
							{:else}
								<td colspan="3"><span class="note">fixed prize</span></td>
							{/if}
							<td
								><button class="del" title="Remove" onclick={() => hw.jackpots.splice(i, 1)}
									>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
			<button class="small" onclick={() => addJackpot(hw)}>+ jackpot tier</button>
			<p class="note">
				Untick <b>Fixed</b> for a progressive tier: the server keeps its pool per player, adds the per-bet
				contribution with every bet, pays the pool when it is won and starts it again from the seed. The
				jackpot bar shows the live pool.
			</p>
		</div>

		<!-- Specials ---------------------------------------------------------------------------->
		<div class="panel">
			<h3>Specials <em>each optional; a symbol takes the role from its special properties</em></h3>
			{#each HOLD_AND_WIN_SPECIALS as kind (kind)}
				{@const role = SPECIAL_SYMBOL_ROLE[kind]}
				{@const tagged = symbolsWithRole(doc, role)}
				{@const on = Boolean(hw.specials[kind])}
				<div class="card" class:off={!on}>
					<div class="row">
						<label class="check strong"
							><input
								type="checkbox"
								checked={on}
								onchange={(e) => setSpecial(hw, kind, e.currentTarget.checked)}
							/><span>{SPECIAL_LABELS[kind]}</span></label
						>
						<span class="note">{SPECIAL_HINTS[kind]}</span>
						<span class="note push">
							{#if tagged.length}
								Symbols: <code>{tagged.join(', ')}</code>
							{:else}
								Tag a symbol <code>{role}</code> in Symbols below.
							{/if}
						</span>
						{#if on}
							<button
								class="small"
								type="button"
								onclick={() => (folded[kind] = !folded[kind])}
								aria-expanded={!folded[kind]}>{folded[kind] ? 'Show' : 'Hide'}</button
							>
						{/if}
					</div>
					{#if on && !folded[kind]}
						{@render specialFields(hw, kind)}
					{/if}
				</div>
			{/each}

			<div class="split">
				<div class="sub">
					<span class="legend">Apply order <em>when several land on the same respin</em></span>
					{#if hw.applyOrder.length}
						<ol class="order">
							{#each hw.applyOrder as kind, i (kind)}
								<li>
									<span class:missing={!hw.specials[kind]}>{SPECIAL_LABELS[kind]}</span>
									<button
										class="small"
										title="Move up"
										disabled={i === 0}
										onclick={() => move(hw.applyOrder, i, -1)}>↑</button
									>
									<button
										class="small"
										title="Move down"
										disabled={i === hw.applyOrder.length - 1}
										onclick={() => move(hw.applyOrder, i, 1)}>↓</button
									>
								</li>
							{/each}
						</ol>
					{:else}
						<span class="note">No special configured.</span>
					{/if}
				</div>
				<div class="sub">
					<span class="legend">Active when the feature starts</span>
					{#if configured.length}
						<div class="checks">
							{#each configured as kind (kind)}
								<label class="check"
									><input
										type="checkbox"
										checked={hw.activeModifiers.atEntry.includes(kind)}
										onchange={(e) =>
											toggleIn(hw.activeModifiers.atEntry, kind, e.currentTarget.checked)}
									/><span>{SPECIAL_LABELS[kind]}</span></label
								>
							{/each}
						</div>
					{/if}
					<label class="check"
						><input type="checkbox" bind:checked={hw.activeModifiers.fromTriggeringSpecials} /><span
							>Specials on the triggering board are active too</span
						></label
					>
				</div>
			</div>
		</div>

		<!-- Wheel ------------------------------------------------------------------------------->
		<div class="panel">
			<h3>Wheel <em>spun once when the feature starts</em></h3>
			<label class="check"
				><input
					type="checkbox"
					checked={Boolean(hw.wheel)}
					onchange={(e) => setWheel(hw, e.currentTarget.checked)}
				/><span>Pre-feature wheel</span></label
			>
			{#if hw.wheel}
				{@const prizes = hw.wheel.prizes}
				<table class="tbl">
					<thead><tr><th>Prize</th><th>Amount</th><th>Weight</th><th></th></tr></thead>
					<tbody>
						{#each prizes as p, i (i)}
							<tr>
								<td
									><select
										value={p.type}
										onchange={(e) => setPrizeType(hw, i, e.currentTarget.value)}
									>
										<option value="coinBoost">coin boost ×</option>
										<option value="extraCollect">extra collect +n</option>
										<option value="jackpot">jackpot</option>
									</select></td
								>
								<td>
									{#if p.type === 'jackpot'}
										{@render jackpotPick(hw, p.jackpot, (n) => setPrizeJackpot(p, n))}
									{:else}
										<input
											type="number"
											min="1"
											step={p.type === 'coinBoost' ? 'any' : '1'}
											value={p.type === 'coinBoost' ? p.multiplier : p.count}
											oninput={num((n) => setPrizeAmount(p, n))}
										/>
									{/if}
								</td>
								<td
									><input
										type="number"
										min="0"
										step="any"
										value={p.weight}
										oninput={num((n) => n >= 0 && (p.weight = n))}
									/></td
								>
								<td
									><button class="del" title="Remove" onclick={() => prizes.splice(i, 1)}>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<button
					class="small"
					onclick={() => prizes.push({ type: 'coinBoost', multiplier: 2, weight: 1 })}
					>+ prize</button
				>
			{/if}
		</div>
	</fieldset>
{/snippet}

{#each blockIssues as issue (issue.path + issue.message)}
	<p class="inline-issue {issue.severity}"><code>{issue.path}</code> — {issue.message}</p>
{/each}
{@render editor(rules)}

<style>
	h3 {
		margin: 0 0 10px;
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
	p.note {
		margin: 0 0 8px;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}
	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.panel {
		border: 1px solid #1c1c24;
		border-left: 3px solid #e0b878;
		border-radius: 10px;
		padding: 12px;
		background: #0e0e14;
	}
	.card {
		border: 1px solid #1c1c24;
		border-radius: 8px;
		padding: 10px 12px;
		background: #0b0b11;
		margin-bottom: 8px;
	}
	.card.off {
		opacity: 0.75;
	}
	.sub {
		margin-top: 10px;
	}
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px 24px;
	}
	.legend {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #8b8b98;
		margin: 8px 0 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: flex-end;
		margin-bottom: 6px;
	}
	.row.tight {
		gap: 6px;
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
		gap: 8px;
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
	label.check.strong {
		font-weight: 700;
		color: #e8e8ee;
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
	input[type='number'] {
		width: 90px;
	}
	input.count {
		width: 64px;
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
	.tbl td.center {
		text-align: center;
	}
	.tbl td.weight {
		white-space: nowrap;
	}
	.tbl td.weight .note {
		margin-left: 6px;
	}
	.chip {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #26262f;
		background: #14141b;
		color: #7ee0c0;
		white-space: nowrap;
	}
	.chip.jp {
		color: #e0b878;
		border-color: #4a3a1e;
		background: #1c1710;
	}
	.order {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.order li span {
		display: inline-block;
		min-width: 90px;
	}
	.order .missing {
		color: #e09090;
		text-decoration: line-through;
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
</style>
