<script lang="ts">
	import {
		COIN_OVERLAY_STYLES,
		HOLD_AND_WIN_SPECIALS,
		HOLD_AND_WIN_SYMBOL_ROLES,
		BASE_GAME_MODE,
		MAX_OVERLAY_POTS,
		OVERLAY_POT_IDS,
		POTS_OVERLAY_PRESET_IDS,
		POTS_OVERLAY_PRESET_LABELS,
		addPotsOverlay,
		coinEntryLabel,
		holdAndWinIsOverlayBonus,
		isCoinDrop,
		overlayDropModes,
		overlayDropsTokens,
		potsOverlayPreset,
		primaryRespinMode,
		removePotsOverlay,
		resolveGameModes,
		setOverlayPotCount,
		symbolsInPlay,
		symbolsWithRole,
		zeroPotsRefusal,
		type AddOnResult,
		type CoinOverlay,
		type CoinOverlayStyle,
		type CoinOverlayTrigger,
		type CoinValueEntry,
		type GameConfigDoc,
		type GameConfigIssue,
		type HoldAndWinSpecial,
		type HoldAndWinSymbolRole,
		type OverlayDrops,
		type OverlayPot,
		type PotsOverlayPresetId,
	} from 'game-config';
	import { SvelteSet } from 'svelte/reactivity';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { ROLE_LABELS, SPECIAL_LABELS, num } from './bonusLabels';

	/**
	 * The COIN OVERLAY of `/config` (`docs/design/bonus-games.md` §1, §2.4, Phase 5a): the option a
	 * base game switches on. It decides what lands in the base game — dropped tokens and pots, the
	 * base-game coin values, what each special does there — and what TRIGGERS a bonus; every trigger,
	 * pot and meter names the mode it starts ("starts →"). It never plays a bonus: the respin games are
	 * Bonus modes'. Adding a preset or removing the pots goes through the `game-config` merge helpers,
	 * so neither ever resets the doc; every other input writes straight into `doc.coinOverlay`, and the
	 * page's validator is the only judge of what is wrong — its issues are shown on the row or field
	 * they name. The pots and drops are validated on the compat mirror, under `potsOverlay`.
	 */
	let {
		doc = $bindable(),
		view,
		issuesFor,
		readOnly,
	}: {
		doc: GameConfigDoc;
		/** The live doc with its compat mirror — what the validators and the game read. */
		view: GameConfigDoc;
		issuesFor: (prefix: string) => GameConfigIssue[];
		readOnly: boolean;
	} = $props();

	type NumberInput = Event & { currentTarget: HTMLInputElement };
	/** An overlay that drops something — its pots (maybe none) and its drop table. */
	type Dropping = CoinOverlay & { drops: OverlayDrops };

	const STYLE_LABELS: Record<CoinOverlayStyle, string> = {
		classic: 'Classic — coins land on the reels; enough start the bonus',
		pots: '3 Pots — tokens fill pots; a full pot starts its bonus',
		collector: 'Collector — a collector beside coins starts the bonus',
	};

	const snapshot = (): GameConfigDoc => $state.snapshot(doc) as GameConfigDoc;

	const modes = $derived(resolveGameModes(doc));
	/** The modes a trigger or a meter can start: the respin modes (scatters start free spins). */
	const respinModes = $derived(modes.filter((m) => m.board === 'respinBoard'));
	const defaultMode = $derived(primaryRespinMode(doc.modes)?.id ?? respinModes[0]?.id ?? '');
	/** The spins games (`GameModeDecl.spins`, bonus-games Phase 8): a buy, Lucky Spin or a random
	 *  metre may start one too; the coin count, a pattern and a meter count coins, so they may not. */
	const spinsModes = $derived(modes.filter((m) => m.board === 'reels' && m.spins));
	/** What a buy, Lucky Spin or random metre starts when switched on. */
	const defaultRoute = $derived(defaultMode || (spinsModes[0]?.id ?? ''));
	const rulesOf = (id: string) => modes.find((m) => m.id === id)?.holdAndWin;
	/** The specials some respin mode configures — the only ones a base-game flag can be about. */
	const configuredKinds = $derived(
		HOLD_AND_WIN_SPECIALS.filter((k) => respinModes.some((m) => m.holdAndWin?.specials[k])),
	);
	const buyModes = $derived(Object.keys(doc.betModes).filter((k) => doc.betModes[k].buyBonus));
	const symbolNames = $derived(Object.keys(doc.symbols));
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
	const errorAt = (path: string) => issuesAt(path).some((i) => i.severity === 'error');

	// ── add / remove ───────────────────────────────────────────────────────────────────────────
	let overlayPreset = $state<PotsOverlayPresetId>(POTS_OVERLAY_PRESET_IDS[0]);
	const presetPotCount = (id: PotsOverlayPresetId) => potsOverlayPreset(id).potsOverlay.pots.length;
	/** How many pots the overlay is added with — the preset's own until picked. */
	let overlayPots = $state(presetPotCount(POTS_OVERLAY_PRESET_IDS[0]));
	const POT_COUNTS = [...Array(MAX_OVERLAY_POTS + 1).keys()];

	function pickPreset(id: PotsOverlayPresetId) {
		overlayPreset = id;
		overlayPots = presetPotCount(id);
	}
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
		const said = [
			...(renames.length
				? [
						`Added ${what}. These names were already taken, so they were renamed: ${renames.join(', ')}.`,
					]
				: []),
			...(result.notes ?? []),
		];
		notice = said.length ? { kind: 'info', text: said.join(' ') } : null;
	}

	function addOverlay() {
		apply(
			addPotsOverlay(snapshot(), overlayPreset, overlayPots),
			POTS_OVERLAY_PRESET_LABELS[overlayPreset],
		);
	}

	/**
	 * Set the pot count. A refusal leaves everything as it was, the picker included; otherwise the rows
	 * still being typed go first, so the count is what the block holds.
	 */
	function setPotCount(select: HTMLSelectElement, count: number) {
		const trial = setOverlayPotCount(snapshot(), count);
		if (!trial.ok) {
			select.value = String(doc.coinOverlay?.pots?.length ?? 0);
			apply(trial, `${count} pots`);
			return;
		}
		for (let i = drafts.length - 1; i >= 0; i -= 1) discardDraft(i);
		apply(setOverlayPotCount(snapshot(), count), `${count} pots`);
	}

	async function removeOverlay() {
		const withBonus = holdAndWinIsOverlayBonus(view);
		const ok = await askConfirm({
			title: 'Remove the pots and drops?',
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

	function freePotId(overlay: Dropping): string {
		const taken = new Set([
			...(overlay.pots ?? []).map((p) => p.id),
			...(overlay.meters ?? []).map((m) => m.id),
			...drafts.map((d) => d.id),
		]);
		const named = OVERLAY_POT_IDS.find((id) => !taken.has(id));
		if (named) return named;
		let n = (overlay.pots?.length ?? 0) + drafts.length + 1;
		while (taken.has(`pot${n}`)) n += 1;
		return `pot${n}`;
	}

	const draftComplete = (d: DraftPot) => Boolean(d.id.trim() && d.token && d.mode);

	function commitDraft(overlay: Dropping, i: number) {
		const d = drafts[i];
		if (!draftComplete(d)) return;
		overlay.pots ??= [];
		overlay.pots.push({
			id: d.id.trim(),
			token: d.token,
			maxLevel: 12,
			sizeStages: [],
			bonus: { mode: d.mode },
		});
		drafts.splice(i, 1);
	}

	/** Renaming a pot carries the drop table's references along. On `change`, never per keystroke:
	 *  a half-typed id passing through another pot's id would hand that pot this one's drops. */
	function renamePot(overlay: Dropping, pot: OverlayPot, next: string) {
		const old = pot.id;
		pot.id = next;
		if (overlay.pots?.some((p) => p !== pot && p.id === old)) return;
		for (const entry of overlay.drops.table) {
			if (!isCoinDrop(entry) && entry.pot === old) entry.pot = next;
		}
	}

	/**
	 * An overlay needs a pot or a value coin (`validatePotsOverlay`), so the last of the one cannot go
	 * while the other is absent — removing the overlay is its own button. Going down to no pots is
	 * `zeroPotsRefusal`'s call, for the pot count and the last pot's × alike.
	 */
	const hasCoinDrop = (overlay: Dropping) => overlay.drops.table.some(isCoinDrop);
	const zeroPotsBlocker = $derived(
		overlayDropsTokens(doc.coinOverlay) ? zeroPotsRefusal(view) : undefined,
	);
	const potRemovable = (overlay: Dropping) => (overlay.pots?.length ?? 0) > 1 || !zeroPotsBlocker;
	const dropRemovable = (overlay: Dropping, i: number) =>
		(overlay.pots?.length ?? 0) > 0 || overlay.drops.table.some((e, k) => k !== i && isCoinDrop(e));
	const KEEP_ONE =
		'An overlay needs at least one pot or one value-coin drop. Add the other first, or remove the overlay.';

	/** The last pot goes through `setOverlayPotCount`, which adds the coin row and raises the drops
	 *  per spin the way the pot count does, and says so. */
	function removePot(overlay: Dropping, i: number) {
		const pots = overlay.pots ?? [];
		if (pots.length === 1) {
			apply(setOverlayPotCount(snapshot(), 0), 'no pots');
			return;
		}
		const [gone] = pots.splice(i, 1);
		if (pots.some((p) => p.id === gone.id)) return;
		overlay.drops.table = overlay.drops.table.filter((e) => isCoinDrop(e) || e.pot !== gone.id);
	}

	/** Token symbols "＋ new" made in this visit, so a discarded draft takes its token with it. */
	const madeTokens = new SvelteSet<string>();

	const tokenInUse = (name: string) =>
		(doc.coinOverlay?.pots ?? []).some((p) => p.token === name) ||
		drafts.some((d) => d.token === name);

	/** A token symbol for a pot: in the dictionary, tagged `meterSpecial`, on no strip. A token this
	 *  visit made that nothing uses is reused, so repeated clicks leave no orphans. */
	function newToken(id: string): string {
		const base = `POT_${(id.trim() || 'NEW').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
		const free = (name: string) =>
			!doc.symbols[name] || (madeTokens.has(name) && !tokenInUse(name));
		let name = base;
		for (let n = 2; !free(name); n += 1) name = `${base}_${n}`;
		doc.symbols[name] = { special_properties: ['meterSpecial'] };
		madeTokens.add(name);
		return name;
	}

	/** Drop a token "＋ new" made once nothing uses it any more. */
	function dropOrphanToken(name: string) {
		if (madeTokens.has(name) && !tokenInUse(name)) {
			delete doc.symbols[name];
			madeTokens.delete(name);
		}
	}

	/** Give a pot or a draft a new token; the one it replaces goes if this visit made it and nothing
	 *  else uses it. */
	function assignNewToken(target: { token: string }, id: string) {
		const old = target.token;
		target.token = '';
		target.token = newToken(id);
		if (old !== target.token) dropOrphanToken(old);
	}

	function discardDraft(i: number) {
		const [gone] = drafts.splice(i, 1);
		dropOrphanToken(gone.token);
	}

	$effect(() => {
		if (!overlayDropsTokens(doc.coinOverlay) && drafts.length) drafts = [];
	});

	function setSizeStages(stages: number[], raw: string) {
		const next = [
			...new Set(
				raw
					.split(',')
					.map((s) => Number(s.trim()))
					.filter((n) => Number.isInteger(n) && n >= 1),
			),
		].sort((a, b) => a - b);
		if (!next.length && raw.trim()) return;
		stages.splice(0, stages.length, ...next);
	}

	/** A bonus keeps only the fields its mode reads: `activates` for a respin mode, `spins` for a
	 *  reels mode. */
	function setBonusMode(pot: OverlayPot, mode: string) {
		pot.bonus.mode = mode;
		if (!isRespinMode(mode)) delete pot.bonus.activates;
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
	const isRespinMode = (mode: string) => respinModes.some((m) => m.id === mode);

	// ── drops ──────────────────────────────────────────────────────────────────────────────────
	const COIN = '__coin__';
	const share = (weight: number, total: number) =>
		total > 0 ? `${((weight / total) * 100).toFixed(1)}%` : '—';

	function setDropKind(drops: OverlayDrops, i: number, value: string) {
		const { weight } = drops.table[i];
		drops.table[i] = value === COIN ? { coin: true, weight } : { pot: value, weight };
	}

	function addDrop(overlay: Dropping) {
		const filled = new Set(overlay.drops.table.flatMap((e) => (isCoinDrop(e) ? [] : [e.pot])));
		const pot = overlay.pots?.find((p) => !filled.has(p.id)) ?? overlay.pots?.[0];
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

	/** After the stop is the default, which a doc never stores. */
	function setTiming(overlay: Dropping, value: string) {
		if (value === 'perReel') overlay.timing = 'perReel';
		else delete overlay.timing;
	}
	// ── the overlay itself ─────────────────────────────────────────────────────────────────────
	/** An overlay with no drops: coins land on the reels and its triggers start the bonus. It is kept
	 *  once it holds something — normalization drops an overlay that holds nothing. */
	function startOverlay() {
		doc.coinOverlay = { style: 'classic' };
	}
	function setStyle(overlay: CoinOverlay, value: string) {
		const style = COIN_OVERLAY_STYLES.find((s) => s === value);
		if (style) overlay.style = style;
	}

	// ── base game ──────────────────────────────────────────────────────────────────────────────
	/** Every jackpot tier a respin mode has, once each: what a base-game jackpot coin can name. */
	const tierNames = $derived([
		...new Set(respinModes.flatMap((m) => m.holdAndWin?.jackpots.map((j) => j.name) ?? [])),
	]);
	/** The base game's own coin values, starting from the primary respin mode's table. */
	function ownBaseCoins(overlay: CoinOverlay) {
		const table = rulesOf(defaultMode)?.coins ?? [];
		overlay.coins = table.length
			? $state.snapshot(table).map(({ reels: _reels, ...entry }) => entry)
			: [{ kind: 'cash', value: 1, weight: 1 }];
	}
	function setBaseCoinKind(overlay: CoinOverlay, i: number, kind: string) {
		const entry = overlay.coins![i];
		overlay.coins![i] =
			kind === 'jackpot'
				? { kind: 'jackpot', jackpot: tierNames[0] ?? '', weight: entry.weight }
				: { kind: 'cash', value: 1, weight: entry.weight };
	}
	const baseCoinShare = (entry: CoinValueEntry, coins: CoinValueEntry[]) => {
		const total = coins.reduce((sum, c) => sum + c.weight, 0);
		return total > 0 ? `${((entry.weight / total) * 100).toFixed(1)}%` : '—';
	};

	/** Sparse, as the normalizer stores it: a flag is present only while it is on. */
	function setFlag(
		overlay: CoinOverlay,
		kind: HoldAndWinSpecial,
		flag: 'landsInBaseGame' | 'instantCollectInBaseGame',
		on: boolean,
	) {
		const flags = { ...overlay.baseGame?.[kind] };
		if (on) flags[flag] = true;
		else delete flags[flag];
		const baseGame = { ...overlay.baseGame, [kind]: flags };
		if (!Object.keys(flags).length) delete baseGame[kind];
		if (Object.keys(baseGame).length) overlay.baseGame = baseGame;
		else delete overlay.baseGame;
	}
	const INSTANT: HoldAndWinSpecial[] = ['collector', 'multiplier'];

	// ── triggers ───────────────────────────────────────────────────────────────────────────────
	/** The overlay's trigger, created on first use. Read back after the assignment: the value of an
	 *  assignment to state is the raw object, and a write through it is lost. */
	function triggerOf(overlay: CoinOverlay): CoinOverlayTrigger {
		overlay.trigger ??= {};
		return overlay.trigger;
	}
	function tidyTrigger(overlay: CoinOverlay) {
		if (overlay.trigger && !Object.keys(overlay.trigger).length) delete overlay.trigger;
	}
	function setCount(overlay: CoinOverlay, on: boolean) {
		if (on) triggerOf(overlay).count = { min: 6, roles: ['coin', 'jackpot'], mode: defaultMode };
		else delete overlay.trigger?.count;
		tidyTrigger(overlay);
	}
	function addRequirement(overlay: CoinOverlay) {
		const t = triggerOf(overlay);
		t.pattern ??= { mode: defaultMode, requirements: [] };
		t.pattern.requirements.push({
			reel: 0,
			roles: ['coin'],
			min: 1,
		});
	}
	function removeRequirement(overlay: CoinOverlay, i: number) {
		const pattern = overlay.trigger?.pattern;
		pattern?.requirements.splice(i, 1);
		if (pattern && !pattern.requirements.length) delete overlay.trigger!.pattern;
		tidyTrigger(overlay);
	}
	function addBuyTier(overlay: CoinOverlay) {
		const t = triggerOf(overlay);
		const used = new Set(t.buy?.map((tier) => tier.betMode));
		const betMode = buyModes.find((m) => !used.has(m)) ?? buyModes[0];
		t.buy ??= [];
		t.buy.push({ betMode, mode: defaultRoute, guaranteed: [], boostedSpecials: false });
	}
	function removeBuyTier(overlay: CoinOverlay, i: number) {
		overlay.trigger?.buy?.splice(i, 1);
		if (overlay.trigger && !overlay.trigger.buy?.length) delete overlay.trigger.buy;
		tidyTrigger(overlay);
	}
	function setRandomMetre(overlay: CoinOverlay, on: boolean) {
		if (on) triggerOf(overlay).randomMetre = { name: 'Metre', mode: defaultRoute };
		else delete overlay.trigger?.randomMetre;
		tidyTrigger(overlay);
	}
	function setLuckySpin(overlay: CoinOverlay, on: boolean) {
		if (on) triggerOf(overlay).luckySpin = { mode: defaultRoute };
		else delete overlay.trigger?.luckySpin;
		tidyTrigger(overlay);
	}
	function toggleRole(list: HoldAndWinSymbolRole[], role: HoldAndWinSymbolRole, on: boolean) {
		const at = list.indexOf(role);
		if (on && at < 0) list.push(role);
		if (!on && at >= 0) list.splice(at, 1);
	}

	// ── meters ─────────────────────────────────────────────────────────────────────────────────
	function addMeter(overlay: CoinOverlay) {
		overlay.meters ??= [];
		const meters = overlay.meters;
		meters.push({
			id: `meter${meters.length + 1}`,
			symbol: symbolsWithRole(doc, 'meterSpecial')[0] ?? symbolNames[0] ?? '',
			maxLevel: 12,
			sizeStages: [],
			activates: configuredKinds[0] ?? 'collector',
			mode: defaultMode,
		});
	}
	function removeMeter(overlay: CoinOverlay, i: number) {
		overlay.meters?.splice(i, 1);
		if (!overlay.meters?.length) delete overlay.meters;
	}
	function setMeterActivates(meter: { activates: HoldAndWinSpecial }, value: string) {
		const special = HOLD_AND_WIN_SPECIALS.find((s) => s === value);
		if (special) meter.activates = special;
	}

	/** Issues about what starts a bonus: the overlay's routes, and each respin mode's trigger and
	 *  meters as the legacy validator reads them. */
	const triggerIssues = $derived([
		...issuesFor('coinOverlay'),
		...issuesFor('holdAndWin.trigger'),
		...issuesFor('holdAndWin.meters'),
		...respinModes.flatMap((m) => [
			...issuesFor(`modes.${m.id}.holdAndWin.trigger`),
			...issuesFor(`modes.${m.id}.holdAndWin.meters`),
		]),
	]);
</script>

{#snippet issueLines(list: GameConfigIssue[])}
	{#each list as issue (issue.path + issue.message)}
		<p class="inline-issue {issue.severity}">{issue.message}</p>
	{/each}
{/snippet}

{#snippet overlayEditor(overlay: Dropping)}
	{@const drops = overlay.drops}
	{@const pots = overlay.pots ?? []}
	{@const dropTotal = drops.table.reduce((sum, e) => sum + e.weight, 0)}
	<fieldset class="panel" disabled={readOnly}>
		<div class="row tight">
			<h3>
				Pots and drops <em
					>{pots.length
						? 'tokens drop over the symbols and fly to pots; a full pot starts its bonus'
						: 'value coins drop over the symbols; enough on one spin start Hold and Win'}</em
				>
			</h3>
			<button class="small danger push" onclick={removeOverlay} disabled={readOnly}
				>Remove pots and drops</button
			>
		</div>

		<div class="row tight count-row">
			<span class="legend">Pots <em>the server keeps each player's level</em></span>
			<label class="inline"
				><span>How many</span><select
					value={pots.length}
					title={zeroPotsBlocker ?? ''}
					onchange={(e) => setPotCount(e.currentTarget, Number(e.currentTarget.value))}
				>
					{#each POT_COUNTS as n (n)}
						<option value={n} disabled={n === 0 && !!zeroPotsBlocker && pots.length > 0}
							>{n}{n === 0 && zeroPotsBlocker ? ' — not here (hover for why)' : ''}</option
						>
					{/each}
					{#if pots.length > MAX_OVERLAY_POTS}
						<option value={pots.length}>{pots.length} — too many</option>
					{/if}
				</select></label
			>
			<span class="note"
				>{pots.length
					? `${zeroPotsBlocker ? 1 : 0}–${MAX_OVERLAY_POTS}; a new pot copies the last one's size and bonus`
					: 'no pots: the overlay drops only value coins'}</span
			>
		</div>
		<table class="tbl">
			<thead>
				<tr
					><th>Id</th><th>Token</th><th>Max level</th><th>Size stages</th><th>Starts</th><th
						>With</th
					><th></th></tr
				>
			</thead>
			<tbody>
				{#each pots as pot, i (i)}
					{@const at = `potsOverlay.pots.${i}`}
					<tr>
						<td
							><input
								class="id"
								class:bad={errorAt(`${at}.id`)}
								value={pot.id}
								onchange={(e) => renamePot(overlay, pot, e.currentTarget.value.trim())}
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
								onclick={() => assignNewToken(pot, pot.id)}>＋ new</button
							></td
						>
						<td
							><input
								type="number"
								min="1"
								class:bad={errorAt(`${at}.maxLevel`)}
								value={pot.maxLevel}
								oninput={num((n) => {
									if (n >= 1) pot.maxLevel = n;
								}, true)}
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
							{#if isRespinMode(pot.bonus.mode)}
								<select
									class:bad={errorAt(`${at}.bonus.activates`)}
									value={pot.bonus.activates ?? ''}
									onchange={(e) => setActivates(pot, e.currentTarget.value)}
								>
									<option value="">no special</option>
									{#each HOLD_AND_WIN_SPECIALS as s (s)}
										<option value={s}
											>{SPECIAL_LABELS[s]} active{rulesOf(pot.bonus.mode)?.specials[s]
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
							><button
								class="del"
								title={potRemovable(overlay) ? 'Remove' : zeroPotsBlocker}
								disabled={!potRemovable(overlay)}
								onclick={() => removePot(overlay, i)}>×</button
							></td
						>
					</tr>
					{#if issuesFor(at).length}
						<tr class="issues"><td colspan="7">{@render issueLines(issuesFor(at))}</td></tr>
					{/if}
				{:else}
					{#if !drafts.length}
						<tr
							><td colspan="7" class="note"
								>No pots: value coins only. Add a pot to give tokens somewhere to fly.</td
							></tr
						>
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
							<button class="small" onclick={() => assignNewToken(d, d.id)}>＋ new</button></td
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
						<td><button class="del" title="Discard" onclick={() => discardDraft(i)}>×</button></td>
					</tr>
				{/each}
			</tbody>
		</table>
		<button
			class="small"
			disabled={pots.length + drafts.length >= MAX_OVERLAY_POTS}
			title={pots.length + drafts.length >= MAX_OVERLAY_POTS
				? `An overlay holds at most ${MAX_OVERLAY_POTS} pots`
				: undefined}
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
								class:bad={errorAt(at) || errorAt(`${at}.pot`)}
								value={isCoinDrop(entry) ? COIN : entry.pot}
								onchange={(e) => setDropKind(drops, i, e.currentTarget.value)}
							>
								{#each pots as pot, k (k)}
									<option value={pot.id}>a {pot.id} token</option>
								{/each}
								{#if !isCoinDrop(entry) && !pots.some((p) => p.id === entry.pot)}
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
								class:bad={errorAt(`${at}.weight`)}
								oninput={num((n) => (entry.weight = n))}
							/><span class="note">{share(entry.weight, dropTotal)}</span></td
						>
						<td
							><button
								class="del"
								title={dropRemovable(overlay, i) ? 'Remove' : KEEP_ONE}
								disabled={!dropRemovable(overlay, i)}
								onclick={() => drops.table.splice(i, 1)}>×</button
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
		{#if hasCoinDrop(overlay) && overlay.trigger?.count && holdAndWinIsOverlayBonus(view)}
			<span class="note"
				>{overlay.trigger.count.min}+ value coins on one spin start {overlay.trigger.count.mode} with
				them held; fewer are shown and cleared (the coin count, in Triggers below)</span
			>
		{/if}
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

		<span class="legend"
			>Presentation <em>how the game shows a drop; the server never sees it</em></span
		>
		<div class="row">
			<label
				><span>Tokens appear</span><select
					value={overlay.timing ?? 'afterStop'}
					onchange={(e) => setTiming(overlay, e.currentTarget.value)}
				>
					<option value="afterStop">after the last reel stops</option>
					<option value="perReel">as each reel stops</option>
				</select></label
			>
		</div>
	</fieldset>
{/snippet}

{#snippet modePick(value: string, set: (mode: string) => void, spins = false)}
	{@const choices = spins ? [...respinModes, ...spinsModes] : respinModes}
	<label class="inline"
		><span>starts →</span><select {value} onchange={(e) => set(e.currentTarget.value)}>
			{#each choices as m (m.id)}
				<option value={m.id}>{m.label ?? m.id}{m.spins ? ` (${m.spins.spins} spins)` : ''}</option>
			{/each}
			{#if !choices.some((m) => m.id === value)}
				<option {value}
					>{value || '(none)'} — not a {spins ? 'respin or spins' : 'respin'} mode</option
				>
			{/if}
		</select></label
	>
{/snippet}

{#snippet roleChecks(list: HoldAndWinSymbolRole[])}
	<div class="checks">
		{#each HOLD_AND_WIN_SYMBOL_ROLES as role (role)}
			<label class="check"
				><input
					type="checkbox"
					checked={list.includes(role)}
					onchange={(e) => toggleRole(list, role, e.currentTarget.checked)}
				/><span>{ROLE_LABELS[role]}</span></label
			>
		{/each}
	</div>
{/snippet}

{#snippet baseGameEditor(overlay: CoinOverlay)}
	<fieldset class="panel" disabled={readOnly}>
		<h3>Base game <em>what lands in the base game</em></h3>
		{#if configuredKinds.length}
			<span class="legend"
				>Specials in the base game <em>for the specials a respin mode configures</em></span
			>
			{#each configuredKinds as kind (kind)}
				<div class="row tight">
					<span class="kind">{SPECIAL_LABELS[kind]}</span>
					<label class="check"
						><input
							type="checkbox"
							checked={overlay.baseGame?.[kind]?.landsInBaseGame === true}
							onchange={(e) => setFlag(overlay, kind, 'landsInBaseGame', e.currentTarget.checked)}
						/><span>Lands in the base game</span></label
					>
					{#if INSTANT.includes(kind)}
						<label class="check"
							><input
								type="checkbox"
								checked={overlay.baseGame?.[kind]?.instantCollectInBaseGame === true}
								onchange={(e) =>
									setFlag(overlay, kind, 'instantCollectInBaseGame', e.currentTarget.checked)}
							/><span>{SPECIAL_LABELS[kind]} + coin in the base game pays at once</span></label
						>
					{/if}
				</div>
			{/each}
		{/if}
		<span class="legend"
			>Coin values in the base game <em>on the base reels, and the value coins that drop</em></span
		>
		{#if !overlay.coins}
			<div class="row tight">
				<span class="note">the coin table of the respin mode the coins start</span>
				<button class="small" onclick={() => ownBaseCoins(overlay)}>Set the base game's own</button>
			</div>
		{:else}
			<table class="tbl">
				<thead>
					<tr><th>Shows</th><th>Kind</th><th>Value</th><th>Weight</th><th></th></tr>
				</thead>
				<tbody>
					{#each overlay.coins as entry, i (i)}
						<tr>
							<td><span class="chip">{coinEntryLabel(entry)}</span></td>
							<td
								><select
									value={entry.kind}
									onchange={(e) => setBaseCoinKind(overlay, i, e.currentTarget.value)}
								>
									<option value="cash">cash</option>
									<option value="jackpot" disabled={!tierNames.length}>jackpot</option>
								</select></td
							>
							<td>
								{#if entry.kind === 'cash'}
									<input
										type="number"
										min="0"
										step="0.5"
										value={entry.value}
										oninput={num((n) => n > 0 && (entry.value = n))}
									/>
								{:else}
									<select
										value={entry.jackpot}
										onchange={(e) => (entry.jackpot = e.currentTarget.value)}
									>
										{#each tierNames as name (name)}
											<option value={name}>{name}</option>
										{/each}
										{#if !tierNames.includes(entry.jackpot)}
											<option value={entry.jackpot}>{entry.jackpot || '(none)'} — not a tier</option
											>
										{/if}
									</select>
								{/if}
							</td>
							<td class="weight"
								><input
									type="number"
									min="0"
									step="any"
									value={entry.weight}
									oninput={num((n) => n >= 0 && (entry.weight = n))}
								/><span class="note">{baseCoinShare(entry, overlay.coins)}</span></td
							>
							<td
								><button
									class="del"
									title="Remove"
									disabled={overlay.coins.length === 1}
									onclick={() => overlay.coins!.splice(i, 1)}>×</button
								></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="row">
				<button
					class="small"
					onclick={() => overlay.coins!.push({ kind: 'cash', value: 1, weight: 1 })}
					>+ cash coin</button
				>
				<button
					class="small"
					disabled={!tierNames.length}
					onclick={() =>
						overlay.coins!.push({ kind: 'jackpot', jackpot: tierNames[0] ?? '', weight: 1 })}
					>+ jackpot coin</button
				>
				<button class="small" onclick={() => delete overlay.coins}
					>Use the respin mode's table</button
				>
			</div>
		{/if}
		{@render issueLines([...issuesAt('coinOverlay.coins'), ...issuesFor('coinOverlay.baseGame')])}
	</fieldset>
{/snippet}

{#snippet triggersEditor(overlay: CoinOverlay)}
	{@const t = overlay.trigger}
	<fieldset class="panel" disabled={readOnly || (!respinModes.length && !spinsModes.length)}>
		<h3>
			Triggers <em
				>what starts a {spinsModes.length ? 'bonus' : 'respin'} mode — any one of these; each names the
				mode</em
			>
		</h3>
		{#if !respinModes.length && !spinsModes.length}
			<p class="note">Add a respin or spins mode in <strong>Bonus modes</strong> first.</p>
		{:else if !respinModes.length}
			<p class="note">
				A spins mode is started by a buy, Lucky Spin or the random metre; the coin count and a
				pattern start a respin mode.
			</p>
		{/if}
		<div class="row tight">
			<label class="check"
				><input
					type="checkbox"
					checked={Boolean(t?.count)}
					onchange={(e) => setCount(overlay, e.currentTarget.checked)}
				/><span>Coin count — N or more symbols anywhere on the board</span></label
			>
			{#if t?.count}
				{@const count = t.count}
				{@render modePick(count.mode, (m) => (count.mode = m))}
			{/if}
		</div>
		{#if t?.count}
			{@const count = t.count}
			<div class="sub">
				<label class="inline"
					><span>At least</span><input
						type="number"
						min="1"
						value={count.min}
						oninput={num((n) => n >= 1 && (count.min = n), true)}
					/></label
				>
				<span class="legend">Of these roles</span>
				{@render roleChecks(count.roles)}
			</div>
		{/if}

		<div class="sub">
			<div class="row tight">
				<span class="legend">Pattern <em>every requirement on the same spin</em></span>
				{#if t?.pattern}
					{@const pattern = t.pattern}
					{@render modePick(pattern.mode, (m) => (pattern.mode = m))}
				{/if}
			</div>
			{#if t?.pattern?.requirements.length}
				{@const reqs = t.pattern.requirements}
				<table class="tbl">
					<thead><tr><th>Reel</th><th>At least</th><th>Of roles</th><th></th></tr></thead>
					<tbody>
						{#each reqs as req, i (i)}
							<tr>
								<td
									><select
										value={req.reel}
										onchange={(e) => (req.reel = Number(e.currentTarget.value))}
									>
										{#each reelIndices as reel (reel)}
											<option value={reel}>Reel {reel + 1}</option>
										{/each}
										{#if req.reel >= doc.numReels}
											<option value={req.reel}>Reel {req.reel + 1} (off the grid)</option>
										{/if}
									</select></td
								>
								<td
									><input
										type="number"
										min="1"
										value={req.min}
										oninput={num((n) => n >= 1 && (req.min = n), true)}
									/></td
								>
								<td>{@render roleChecks(req.roles)}</td>
								<td
									><button class="del" title="Remove" onclick={() => removeRequirement(overlay, i)}
										>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<button class="small" onclick={() => addRequirement(overlay)}>+ requirement</button>
		</div>

		<div class="sub">
			<span class="legend"
				>Buy tiers <em>the price is the bet mode's cost — set it in Bet modes above</em></span
			>
			{#each t?.buy ?? [] as tier, i (i)}
				{@const bet = doc.betModes[tier.betMode]}
				<div class="card">
					<div class="row tight">
						<label class="inline"
							><span>Bet mode</span><select bind:value={tier.betMode}>
								{#each buyModes as key (key)}
									<option value={key}>{key}</option>
								{/each}
								{#if !buyModes.includes(tier.betMode)}
									<option value={tier.betMode}>{tier.betMode} (not a buy-bonus mode)</option>
								{/if}
							</select></label
						>
						<span class="chip">{bet ? `${bet.cost}× bet` : 'no such mode'}</span>
						{@render modePick(tier.mode, (m) => (tier.mode = m), true)}
						<label class="check"
							><input type="checkbox" bind:checked={tier.boostedSpecials} /><span
								>Specials land more often in this feature</span
							></label
						>
						<button class="del push" title="Remove tier" onclick={() => removeBuyTier(overlay, i)}
							>×</button
						>
					</div>
					<span class="legend">Guaranteed on entry</span>
					{#each tier.guaranteed as g, gi (gi)}
						<div class="row tight">
							<input
								class="count"
								type="number"
								min="1"
								value={g.count}
								oninput={num((n) => n >= 1 && (g.count = n), true)}
							/>
							<span class="note">×</span>
							<select bind:value={g.role}>
								{#each HOLD_AND_WIN_SYMBOL_ROLES as role (role)}
									<option value={role}>{ROLE_LABELS[role]}</option>
								{/each}
							</select>
							<button class="del" title="Remove" onclick={() => tier.guaranteed.splice(gi, 1)}
								>×</button
							>
						</div>
					{/each}
					<button
						class="small"
						onclick={() => tier.guaranteed.push({ role: 'coinMultiplier', count: 1 })}
						>+ guaranteed</button
					>
				</div>
			{/each}
			<button class="small" onclick={() => addBuyTier(overlay)} disabled={!buyModes.length}
				>+ buy tier</button
			>
			{#if !buyModes.length}
				<span class="note">Tick <strong>Buy bonus</strong> on a bet mode above first.</span>
			{/if}
		</div>

		<div class="row tight">
			<label class="check"
				><input
					type="checkbox"
					checked={Boolean(t?.randomMetre)}
					onchange={(e) => setRandomMetre(overlay, e.currentTarget.checked)}
				/><span>Random metre — the server triggers it, dressed as a metre</span></label
			>
			{#if t?.randomMetre}
				{@const metre = t.randomMetre}
				<label class="inline"><span>Name</span><input bind:value={metre.name} /></label>
				{@render modePick(metre.mode, (m) => (metre.mode = m), true)}
			{/if}
		</div>
		<div class="row tight">
			<label class="check"
				><input
					type="checkbox"
					checked={Boolean(t?.luckySpin)}
					onchange={(e) => setLuckySpin(overlay, e.currentTarget.checked)}
				/><span>Lucky Spin — a server-announced spin that guarantees the trigger</span></label
			>
			{#if t?.luckySpin}
				{@const lucky = t.luckySpin}
				{@render modePick(lucky.mode, (m) => (lucky.mode = m), true)}
			{/if}
		</div>

		<div class="sub">
			<span class="legend"
				>Meters <em>filled by a landing symbol; the server keeps each player's level</em></span
			>
			{#if overlay.meters?.length}
				{@const meters = overlay.meters}
				<table class="tbl">
					<thead>
						<tr
							><th>Id</th><th>Filled by</th><th>Max level</th><th>Size stages</th><th>Activates</th
							><th>Starts</th><th></th></tr
						>
					</thead>
					<tbody>
						{#each meters as m, i (i)}
							<tr>
								<td><input class="id" bind:value={m.id} /></td>
								<td
									><select bind:value={m.symbol}>
										{#each symbolNames as name (name)}
											<option value={name}
												>{name}{doc.symbols[name].special_properties?.includes('meterSpecial')
													? ''
													: ' (not meterSpecial)'}</option
											>
										{/each}
										{#if !doc.symbols[m.symbol]}
											<option value={m.symbol}
												>{m.symbol || '(none)'} — not in the dictionary</option
											>
										{/if}
									</select></td
								>
								<td
									><input
										type="number"
										min="1"
										value={m.maxLevel}
										oninput={num((n) => n >= 1 && (m.maxLevel = n), true)}
									/></td
								>
								<td
									><input
										class="stages"
										value={m.sizeStages.join(', ')}
										placeholder="5, 9"
										onchange={(e) => setSizeStages(m.sizeStages, e.currentTarget.value)}
									/></td
								>
								<td
									><select
										value={m.activates}
										onchange={(e) => setMeterActivates(m, e.currentTarget.value)}
									>
										{#each HOLD_AND_WIN_SPECIALS as s (s)}
											<option value={s}
												>{SPECIAL_LABELS[s]}{rulesOf(m.mode)?.specials[s]
													? ''
													: ' (not configured)'}</option
											>
										{/each}
									</select></td
								>
								<td>{@render modePick(m.mode, (mode) => (m.mode = mode))}</td>
								<td
									><button class="del" title="Remove" onclick={() => removeMeter(overlay, i)}
										>×</button
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<button class="small" onclick={() => addMeter(overlay)}>+ meter</button>
		</div>
		{@render issueLines(triggerIssues)}
	</fieldset>
{/snippet}

<section class="addons">
	<h2>Coin overlay</h2>
	<p class="hint">
		An option the base game switches on: what lands in the base game — coins on the reels, tokens
		dropped over them, pots that fill — and what <strong>starts</strong> a bonus. Every trigger, pot
		and meter names the mode it starts; the respin games themselves are in
		<strong>Bonus modes</strong>. Adding a preset merges its blocks and symbols into the config and
		never replaces what is already here; a name the config already uses is renamed. Token symbols
		live in the dictionary only — a strip never deals them.
	</p>
	<p class="hint">
		After saving an overlay change, reload any open game tab: a tab keeps the overlay it booted
		with. Token art is seeded only by Game Maker's <strong>＋ Coin overlay…</strong> (or
		<strong>Coin overlay parts…</strong>); otherwise bind it in /symbols.
	</p>
	{#if notice}
		<p class="inline-issue {notice.kind === 'error' ? 'error' : 'info'}">{notice.text}</p>
	{/if}

	{#if doc.coinOverlay}
		{@const overlay = doc.coinOverlay}
		<div class="row tight">
			<label class="inline"
				><span>Style</span><select
					value={overlay.style}
					onchange={(e) => setStyle(overlay, e.currentTarget.value)}
					disabled={readOnly}
				>
					{#each COIN_OVERLAY_STYLES as style (style)}
						<option value={style}>{STYLE_LABELS[style]}</option>
					{/each}
				</select></label
			>
		</div>
		{#if overlayDropsTokens(overlay)}
			{@render overlayEditor(overlay)}
		{/if}
	{/if}
	{#if !overlayDropsTokens(doc.coinOverlay)}
		<div class="row tight">
			<select
				value={overlayPreset}
				onchange={(e) => pickPreset(e.currentTarget.value as PotsOverlayPresetId)}
				disabled={readOnly}
			>
				{#each POTS_OVERLAY_PRESET_IDS as id (id)}
					<option value={id}>{POTS_OVERLAY_PRESET_LABELS[id]}</option>
				{/each}
			</select>
			<label class="inline"
				><span>pots</span><select bind:value={overlayPots} disabled={readOnly}>
					{#each POT_COUNTS as n (n)}
						<option value={n}>{n}</option>
					{/each}
				</select></label
			>
			<button class="small" onclick={addOverlay} disabled={readOnly}
				>＋ {doc.coinOverlay ? 'Pots and drops' : 'Coin overlay'}</button
			>
			{#if !doc.coinOverlay}
				<button class="small" onclick={startOverlay} disabled={readOnly}
					>＋ Coin overlay without drops</button
				>
				<span class="note">coins land on the reels; set its triggers below</span>
			{/if}
		</div>
	{/if}
	{#if doc.coinOverlay}
		{#if respinModes.length || issuesFor('coinOverlay.coins').length}
			{@render baseGameEditor(doc.coinOverlay)}
		{/if}
		{@render triggersEditor(doc.coinOverlay)}
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
		min-width: 0;
		margin: 0 0 12px;
		border: 1px solid #1c1c24;
		border-left: 3px solid #e0b878;
		border-radius: 10px;
		padding: 12px;
		background: #0e0e14;
	}
	.sub {
		margin-top: 10px;
	}
	.count-row {
		margin: 12px 0 6px;
	}
	.count-row .legend {
		margin: 0;
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
	.del:hover:not(:disabled) {
		color: #e07070;
	}
	.del:disabled {
		opacity: 0.3;
		cursor: default;
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
	.card {
		border: 1px solid #1c1c24;
		border-radius: 8px;
		padding: 10px 12px;
		background: #0b0b11;
		margin-bottom: 8px;
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
	.kind {
		min-width: 90px;
		font-size: 12px;
		color: #b8b8c4;
	}
</style>
