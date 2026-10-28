<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		CARD_MAX_EFFECTS,
		CARD_RANGES,
		readLibrary,
		type CardDef,
		type CardEffect,
		type Keyword,
	} from 'engine-mechanics';
	import {
		DEFAULT_CARD_FRAME_ID,
		resolveCard,
		resolveFamily,
		validateGameConfigDoc,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import type { ComponentDef } from 'engine-layout';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import { guardUnsavedWork } from '$lib/unsavedGuard';
	import { askConfirm } from '$lib/dialogs.svelte';
	import * as edit from '$lib/cards/cardEdit';
	import { adoptSaved, bodyFor, openDoc } from '../config/pageDoc';
	import RegionPicker from '../editor/RegionPicker.svelte';
	import CardFrameView from './CardFrameView.svelte';
	import DeckPanel from './DeckPanel.svelte';
	import TestMatch from './TestMatch.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The whole game config, as `/config` holds it (the cards live in it, §7), PUT back whole
	 *  through the same endpoint under the same lease. */
	const initial = openDoc((data.doc ?? data.templateDefault ?? {}) as GameConfigDoc);
	let doc = $state<GameConfigDoc>(JSON.parse(JSON.stringify(initial)) as GameConfigDoc);
	let baseline = $state(JSON.stringify(initial));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);
	const snapshot = $derived($state.snapshot(doc) as GameConfigDoc);
	let savedAt = $state<string | null>(null);

	const isCard = $derived(resolveFamily(snapshot) === 'card');
	const issues = $derived(validateGameConfigDoc(snapshot));
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const otherErrors = $derived(errors.filter((i) => !i.path.startsWith('card.')));
	const game = $derived(resolveCard(snapshot));
	const library = $derived(game.library);
	/** What reading the stored library dropped (a newer launcher's verbs, §3.6), shown before a save
	 *  writes the library back without them. */
	let dropped = $state(readLibrary(data.doc?.card?.library ?? []).dropped);

	const components = new Map((data.frames as ComponentDef[]).map((d) => [d.id, d]));
	const frames = $derived(edit.frameChoices(data.frames as ComponentDef[], snapshot));
	const otherFrames = $derived(frames.filter((f) => f.id !== DEFAULT_CARD_FRAME_ID));
	const frameOf = (card: CardDef): ComponentDef | undefined =>
		components.get(card.frame?.trim() || DEFAULT_CARD_FRAME_ID);

	type Tab = 'cards' | 'decks' | 'match';
	let tab = $state<Tab>('cards');
	let selectedId = $state<string | null>(initial.card?.library?.[0]?.id ?? null);
	const index = $derived(library.findIndex((c) => c.id === selectedId));
	const card = $derived(index >= 0 ? library[index] : undefined);
	const mine = $derived(index >= 0 ? edit.cardIssues(issues, index) : []);
	const frame = $derived(card ? frameOf(card) : undefined);
	const gaps = $derived(frame ? edit.frameInterfaceGaps(frame) : []);
	const rulesText = $derived(card ? edit.rulesTextOf(card, library) : []);
	let look = $state<edit.PreviewLook>('inHand');

	let filterType = $state<'all' | 'unit' | 'spell'>('all');
	let filterCost = $state<string>('all');
	let filterKeyword = $state<'all' | Keyword>('all');
	let search = $state('');
	const shown = $derived(
		library.filter(
			(c) =>
				(filterType === 'all' || c.type === filterType) &&
				(filterCost === 'all' ||
					(filterCost === '7' ? c.cost >= 7 : c.cost === Number(filterCost))) &&
				(filterKeyword === 'all' || c.keywords?.includes(filterKeyword)) &&
				(!search.trim() ||
					`${c.id} ${c.name} ${c.flavor ?? ''}`
						.toLowerCase()
						.includes(search.trim().toLowerCase())),
		),
	);

	let renameText = $state('');
	let renameError = $state('');
	let removeError = $state('');

	const lease = new LeaseState({
		toolId: 'gameConfig',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'gameConfig',
		enabled: data.projectKey.length > 0,
	});
	const readOnly = $derived(lease.readOnly || !isCard);

	const saveState = new SaveState({
		initialEtag: data.etag,
		conflictMessage: 'Someone else saved this game config while you were editing.',
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const res = await fetch(`/api/game-config?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					doc: bodyFor($state.snapshot(doc) as GameConfigDoc),
					baseEtag,
					force,
				}),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				return { ok: false, reason: 'conflict', message: c.message };
			}
			if (res.status === 400) {
				const c = (await res.json()) as { issues?: GameConfigIssue[] };
				const n = c.issues?.length ?? 0;
				return {
					ok: false,
					reason: 'error',
					message: n
						? `Can't save: ${n} blocking ${n === 1 ? 'issue' : 'issues'}.`
						: "This config can't be saved.",
				};
			}
			if (!res.ok) {
				return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
			}
			const saved = (await res.json()) as { doc: GameConfigDoc; etag: string | null };
			doc = adoptSaved(saved.doc);
			baseline = JSON.stringify($state.snapshot(doc));
			savedAt = new Date().toLocaleTimeString();
			dropped = [];
			return { ok: true, etag: saved.etag };
		},
	});
	const save = (force = false) => void saveState.save({ force });

	onMount(() => {
		void lease.start();
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			lease.release();
		};
	});

	guardUnsavedWork(() =>
		dirty
			? {
					title: 'The cards have unsaved changes',
					message: 'Leaving this page discards them.',
					confirmLabel: 'Leave anyway',
					danger: true,
				}
			: null,
	);

	const cardId = $derived(card?.id);
	$effect(() => {
		renameText = cardId ?? '';
		renameError = '';
		removeError = '';
	});

	/** Run one edit against the live doc. */
	function change(run: (d: GameConfigDoc) => void): void {
		if (readOnly) return;
		run(doc);
	}
	const cid = () => card?.id ?? '';

	function addCard(type: CardDef['type']): void {
		change((d) => (selectedId = edit.addCard(d, type)));
	}
	function duplicate(): void {
		change((d) => {
			const id = edit.duplicateCard(d, cid());
			if (id) selectedId = id;
		});
	}
	async function remove(): Promise<void> {
		if (!card) return;
		const ok = await askConfirm({
			title: `Delete "${card.id}"?`,
			message: 'It leaves every deck that holds it. Nothing is saved until you press Save.',
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!ok) return;
		let refused: string | null = null;
		change((d) => (refused = edit.removeCard(d, cid())));
		if (refused) removeError = refused;
		else selectedId = library[0]?.id ?? null;
	}
	function rename(): void {
		const from = cid();
		let refused: string | null = null;
		change((d) => (refused = edit.renameCard(d, from, renameText)));
		if (refused) renameError = refused;
		else selectedId = renameText.trim();
	}

	function changeType(el: HTMLSelectElement, type: CardDef['type']): void {
		let refused: string | null = null;
		change((d) => (refused = edit.setCardType(d, cid(), type)));
		if (refused) {
			removeError = refused;
			el.value = card?.type ?? type;
		}
	}

	/** Put an input back on the stored value after a clamped or refused edit. */
	function settle(el: HTMLInputElement, stored: unknown): void {
		const text = stored === undefined ? '' : String(stored);
		if (el.value !== text) el.value = text;
	}
	const live = () => doc.card?.library?.find((c) => c.id === cid());

	/** The frame's image params: where a card's art goes. */
	const artParams = $derived(
		(frame?.params ?? []).filter((p) => p.kind === 'image').map((p) => p.key),
	);
	const hasErrors = (i: number) => edit.cardIssues(issues, i).some((x) => x.severity === 'error');

	const TRIGGER_LABEL: Record<string, string> = {
		onPlay: 'When played',
		onDeath: 'When it dies',
		turnStart: 'At its turn start',
		onAttack: 'When it attacks',
		onDamaged: 'When damaged',
	};
	const TARGET_LABEL: Record<string, string> = {
		self: 'itself',
		chosen: 'a chosen target',
		allEnemies: 'all enemies',
		randomEnemy: 'a random enemy',
	};
	const LOOK_LABEL: Record<edit.PreviewLook, string> = {
		inHand: 'In hand',
		playable: 'Playable',
		onBoard: 'On board',
		ready: 'Ready',
		targetable: 'Targetable',
		faceDown: 'Face down',
		damaged: 'Damaged',
		buffed: 'Buffed',
	};
	/** The effect's target, read the same for every verb (one without a target has none). */
	const targetOf = (
		effect: CardEffect,
	): Partial<{ kind: string; side: string; include: string }> | undefined =>
		'target' in effect ? effect.target : undefined;
	const numberKeys = (c: CardDef): readonly edit.CardNumber[] =>
		c.type === 'unit' ? ['cost', 'attack', 'health'] : ['cost'];
	const issueText = (list: GameConfigIssue[]) => list.map((i) => i.message).join(' ');
</script>

<svelte:head><title>Invisible Card Library — {data.projectKey}</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="cards"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if lease.readOnly}
				<PresenceBanner {lease} />
			{:else}
				{#if errors.length}<span class="pill err"
						>{errors.length} error{errors.length === 1 ? '' : 's'}</span
					>{/if}
				{#if saveState.status === 'error'}<span class="err">{saveState.message}</span>{/if}
				{#if dirty}<span class="pill dirty">Unsaved</span>{:else if savedAt}<span class="pill"
						>Saved {savedAt}</span
					>{/if}
			{/if}
			<button
				class="save"
				onclick={() => save()}
				disabled={readOnly || saveState.busy || !dirty || errors.length > 0}
			>
				{saveState.busy ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if saveState.status === 'conflict'}
			<div class="conflict">
				<p>{saveState.message}</p>
				<p class="sub">
					Your edits are still on this page. Reload to take their version (your unsaved edits go),
					or overwrite with yours.
				</p>
				<button onclick={() => location.reload()}>Reload theirs</button>
				<button class="danger" onclick={() => save(true)}>Overwrite with mine</button>
			</div>
		{/if}
		<p class="intro">
			The cards and decks of <b>{data.projectName ?? data.projectKey}</b>. They are saved in the
			game config, so <a href={resolve('/config')}>Invisible Game Config</a> and this tool share one
			edit lease and one History. Rules text is written from each card's effects; each sentence,
			name and flavour line is a string in
			<a href={resolve('/localization')}>Invisible Localization</a>'s Cards section.
		</p>
		{#if !isCard}
			<p class="warn">
				This project's config is not a card config, so it has no cards. Set its family in Invisible
				Game Config first.
			</p>
		{/if}
		{#if dropped.length}
			<p class="warn">
				The stored library holds what this launcher does not know, which it drops: {dropped.join(
					'; ',
				)}. Saving writes the library without it.
			</p>
		{/if}
		{#if otherErrors.length}
			<p class="warn">
				The config has {otherErrors.length} other error{otherErrors.length === 1 ? '' : 's'} outside the
				cards, which block Save: fix {otherErrors.length === 1 ? 'it' : 'them'} in Invisible Game Config.
				({issueText(otherErrors)})
			</p>
		{/if}

		<div class="tabs" role="tablist">
			<button
				role="tab"
				aria-selected={tab === 'cards'}
				class:on={tab === 'cards'}
				onclick={() => (tab = 'cards')}>Cards ({library.length})</button
			>
			<button
				role="tab"
				aria-selected={tab === 'decks'}
				class:on={tab === 'decks'}
				onclick={() => (tab = 'decks')}>Decks ({game.decks.length})</button
			>
			<button
				role="tab"
				aria-selected={tab === 'match'}
				class:on={tab === 'match'}
				onclick={() => (tab = 'match')}>Test match</button
			>
		</div>

		{#if tab === 'cards'}
			<div class="split">
				<aside class="list">
					<div class="filters">
						<input placeholder="Search" bind:value={search} spellcheck="false" />
						<select bind:value={filterType}>
							<option value="all">Every type</option>
							<option value="unit">Units</option>
							<option value="spell">Spells</option>
						</select>
						<select bind:value={filterCost}>
							<option value="all">Any cost</option>
							{#each [0, 1, 2, 3, 4, 5, 6] as c (c)}<option value={String(c)}>Cost {c}</option
								>{/each}
							<option value="7">Cost 7+</option>
						</select>
						<select bind:value={filterKeyword}>
							<option value="all">Any keyword</option>
							{#each edit.keywordChoices() as k (k)}<option value={k}>{k}</option>{/each}
						</select>
					</div>
					<div class="cards">
						{#each shown as c (c.id)}
							{@const i = library.indexOf(c)}
							<button
								type="button"
								class="tile"
								class:on={c.id === selectedId}
								title={c.id}
								onclick={() => (selectedId = c.id)}
							>
								<CardFrameView
									frame={frameOf(c)}
									values={edit.frameValues(c, library)}
									{components}
									size={120}
								/>
								<span class="tile-id">{c.id}{c.token ? ' · token' : ''}</span>
								{#if hasErrors(i)}<span class="dot" title="Has errors">●</span>{/if}
							</button>
						{:else}
							<p class="hint">
								{library.length ? 'No card matches the filters.' : 'No cards yet.'}
							</p>
						{/each}
					</div>
					<div class="add">
						<button type="button" onclick={() => addCard('unit')} disabled={readOnly}
							>＋ Unit</button
						>
						<button type="button" onclick={() => addCard('spell')} disabled={readOnly}
							>＋ Spell</button
						>
					</div>
				</aside>

				<main class="detail">
					{#if !card}
						<p class="hint">Pick a card on the left, or add one.</p>
					{:else}
						{@const c = card}
						{#if mine.length}
							<ul class="issues">
								{#each mine as issue (issue.path + issue.message)}
									<li class={issue.severity}>{issue.message}</li>
								{/each}
							</ul>
						{/if}
						<div class="cols">
							<div class="form">
								<section>
									<h2>Card</h2>
									<div class="grid">
										<label
											>Id
											<span class="inline">
												<input bind:value={renameText} disabled={readOnly} spellcheck="false" />
												<button
													type="button"
													onclick={rename}
													disabled={readOnly || renameText.trim() === c.id}>Rename</button
												>
											</span>
											{#if renameError}<span class="err">{renameError}</span>{/if}
										</label>
										<label
											>Name
											<input
												value={c.name}
												disabled={readOnly}
												oninput={(e) =>
													change((d) => edit.setCardText(d, cid(), 'name', e.currentTarget.value))}
											/>
										</label>
										<label
											>Type
											<select
												value={c.type}
												disabled={readOnly}
												onchange={(e) =>
													changeType(e.currentTarget, e.currentTarget.value as CardDef['type'])}
											>
												<option value="unit">Unit</option>
												<option value="spell">Spell</option>
											</select>
										</label>
										{#each numberKeys(c) as key (key)}
											<label
												>{key[0].toUpperCase() + key.slice(1)} ({CARD_RANGES[key][0]}–{CARD_RANGES[
													key
												][1]})
												<input
													type="number"
													min={CARD_RANGES[key][0]}
													max={CARD_RANGES[key][1]}
													value={c[key]}
													disabled={readOnly}
													onchange={(e) => {
														change((d) => edit.setCardNumber(d, cid(), key, e.currentTarget.value));
														settle(e.currentTarget, live()?.[key]);
													}}
												/>
											</label>
										{/each}
									</div>
									{#if c.type === 'unit'}
										<div class="toggles">
											{#each edit.keywordChoices() as k (k)}
												<label class="check"
													><input
														type="checkbox"
														checked={!!c.keywords?.includes(k)}
														disabled={readOnly}
														onchange={() => change((d) => edit.toggleKeyword(d, cid(), k))}
													/>{k}</label
												>
											{/each}
											<label class="check" title="Only summoned, never in a deck"
												><input
													type="checkbox"
													checked={!!c.token}
													disabled={readOnly}
													onchange={(e) =>
														change((d) => edit.setToken(d, cid(), e.currentTarget.checked))}
												/>token</label
											>
										</div>
									{/if}
									<label class="wide"
										>Flavour <em class="dim">(display text, not rules)</em>
										<input
											value={c.flavor ?? ''}
											disabled={readOnly}
											onchange={(e) =>
												change((d) => edit.setCardText(d, cid(), 'flavor', e.currentTarget.value))}
										/>
									</label>
									<div class="actions">
										<button type="button" onclick={duplicate} disabled={readOnly}>Duplicate</button>
										<button type="button" class="danger" onclick={remove} disabled={readOnly}
											>Delete</button
										>
										{#if removeError}<span class="err">{removeError}</span>{/if}
									</div>
								</section>

								<section>
									<h2>Effects</h2>
									<p class="hint">
										Up to three. Each is a trigger, a verb and a target; a list offers only what the
										rules allow after the choices to its left.
									</p>
									{#each c.effects ?? [] as effect, e (e)}
										{@const target = targetOf(effect)}
										{@const kinds = edit.targetChoices(c, effect.trigger, effect.verb)}
										<div class="effect">
											<select
												value={effect.trigger}
												disabled={readOnly}
												onchange={(ev) =>
													change((d) =>
														edit.setEffectField(d, cid(), e, 'trigger', ev.currentTarget.value),
													)}
											>
												{#each edit.triggerChoices(c) as t (t)}<option value={t}
														>{TRIGGER_LABEL[t]}</option
													>{/each}
											</select>
											<select
												value={effect.verb}
												disabled={readOnly}
												onchange={(ev) =>
													change((d) =>
														edit.setEffectField(d, cid(), e, 'verb', ev.currentTarget.value),
													)}
											>
												{#each edit.verbChoices(library) as v (v)}<option value={v}>{v}</option
													>{/each}
											</select>
											{#if effect.verb === 'damage' || effect.verb === 'heal' || effect.verb === 'draw'}
												{@const r = CARD_RANGES[effect.verb]}
												<label class="num"
													>amount<input
														type="number"
														min={r[0]}
														max={r[1]}
														value={effect.amount}
														disabled={readOnly}
														onchange={(ev) =>
															change((d) =>
																edit.setEffectField(d, cid(), e, 'amount', ev.currentTarget.value),
															)}
													/></label
												>
											{:else if effect.verb === 'summon'}
												<select
													value={effect.card}
													disabled={readOnly}
													onchange={(ev) =>
														change((d) =>
															edit.setEffectField(d, cid(), e, 'card', ev.currentTarget.value),
														)}
												>
													{#each edit.summonChoices(library) as u (u.id)}<option value={u.id}
															>{u.name} ({u.id})</option
														>{/each}
												</select>
												<label class="num"
													>×<input
														type="number"
														min={CARD_RANGES.count[0]}
														max={CARD_RANGES.count[1]}
														value={effect.count ?? 1}
														disabled={readOnly}
														onchange={(ev) =>
															change((d) =>
																edit.setEffectField(d, cid(), e, 'count', ev.currentTarget.value),
															)}
													/></label
												>
											{:else if effect.verb === 'buff'}
												{#each ['attack', 'health'] as const as key (key)}
													<label class="num"
														>{key === 'attack' ? 'atk' : 'hp'}<input
															type="number"
															min={CARD_RANGES.buff[0]}
															max={CARD_RANGES.buff[1]}
															value={effect[key]}
															disabled={readOnly}
															onchange={(ev) =>
																change((d) =>
																	edit.setEffectField(d, cid(), e, key, ev.currentTarget.value),
																)}
														/></label
													>
												{/each}
												<select
													value={effect.until}
													disabled={readOnly}
													onchange={(ev) =>
														change((d) =>
															edit.setEffectField(d, cid(), e, 'until', ev.currentTarget.value),
														)}
												>
													<option value="permanent">permanently</option>
													<option value="endOfTurn">until end of turn</option>
												</select>
											{:else if effect.verb === 'giveKeyword'}
												<select
													value={effect.keyword}
													disabled={readOnly}
													onchange={(ev) =>
														change((d) =>
															edit.setEffectField(d, cid(), e, 'keyword', ev.currentTarget.value),
														)}
												>
													{#each edit.keywordChoices() as k (k)}<option value={k}>{k}</option
														>{/each}
												</select>
											{/if}
											{#if kinds.length && target}
												<span class="to">→</span>
												<select
													value={target.kind}
													disabled={readOnly}
													onchange={(ev) =>
														change((d) =>
															edit.setEffectField(
																d,
																cid(),
																e,
																'target.kind',
																ev.currentTarget.value,
															),
														)}
												>
													{#each kinds as k (k)}<option value={k}>{TARGET_LABEL[k]}</option>{/each}
												</select>
												{#if target.kind === 'chosen'}
													<select
														value={target.side}
														disabled={readOnly}
														onchange={(ev) =>
															change((d) =>
																edit.setEffectField(
																	d,
																	cid(),
																	e,
																	'target.side',
																	ev.currentTarget.value,
																),
															)}
													>
														{#each edit.sideChoices() as s (s)}<option value={s}>{s}</option>{/each}
													</select>
												{/if}
												{#if target.kind !== 'self'}
													<select
														value={target.include}
														disabled={readOnly}
														onchange={(ev) =>
															change((d) =>
																edit.setEffectField(
																	d,
																	cid(),
																	e,
																	'target.include',
																	ev.currentTarget.value,
																),
															)}
													>
														{#each edit.includeChoices(effect.verb) as inc (inc)}<option value={inc}
																>{inc === 'characters' ? 'units or hero' : 'units'}</option
															>{/each}
													</select>
												{/if}
											{/if}
											<button
												type="button"
												class="x"
												title="Remove this effect"
												disabled={readOnly}
												onclick={() => change((d) => edit.removeEffect(d, cid(), e))}>×</button
											>
										</div>
									{/each}
									<button
										type="button"
										onclick={() => change((d) => edit.addEffect(d, cid()))}
										disabled={readOnly || (c.effects?.length ?? 0) >= CARD_MAX_EFFECTS}
										>＋ Effect</button
									>
								</section>

								<section>
									<h2>Frame and art</h2>
									<div class="grid">
										<label
											>Frame
											<select
												value={c.frame ?? ''}
												disabled={readOnly}
												onchange={(e) =>
													change((d) => edit.setFrame(d, cid(), e.currentTarget.value))}
											>
												<option value="">The game's default ({DEFAULT_CARD_FRAME_ID})</option>
												{#each otherFrames as f (f.id)}<option value={f.id}>{f.name || f.id}</option
													>{/each}
												{#if c.frame && !components.has(c.frame)}<option value={c.frame}
														>{c.frame} (not found)</option
													>{/if}
											</select>
										</label>
										{#each artParams as key (key)}
											<label
												>Art ({key})
												<RegionPicker
													sheets={data.pickSheets}
													value={typeof c.params?.[key] === 'string'
														? (c.params[key] as string)
														: ''}
													scoped
													onSelect={(region) =>
														change((d) => edit.setFrameParam(d, cid(), key, region))}
												/>
											</label>
										{:else}
											<p class="hint">
												This frame has no image param, so a card in it has no art of its own.
											</p>
										{/each}
									</div>
									{#if !frame}
										<p class="warn">
											The frame "{c.frame ?? DEFAULT_CARD_FRAME_ID}" is not a component in this
											project.
										</p>
									{:else if gaps.length}
										<p class="warn">
											The frame does not take every card input (§6), so the game cannot show all of
											a card on it: {gaps.join(', ')}.
										</p>
									{/if}
								</section>
							</div>

							<aside class="preview">
								<h2>Preview</h2>
								<CardFrameView
									{frame}
									values={edit.frameValues(c, library, look)}
									{components}
									size={210}
								/>
								<div class="looks">
									{#each edit.PREVIEW_LOOKS as l (l)}
										<button type="button" class:on={look === l} onclick={() => (look = l)}
											>{LOOK_LABEL[l]}</button
										>
									{/each}
								</div>
								<h3>Rules text</h3>
								{#if rulesText.length}
									<ul class="sentences">
										{#each rulesText as sentence, s (s)}<li>{sentence}</li>{/each}
									</ul>
								{:else if c.effects?.length}
									<p class="hint">Written once the card's errors are fixed.</p>
								{:else}
									<p class="hint">No effects, no rules text.</p>
								{/if}
							</aside>
						</div>
					{/if}
				</main>
			</div>
		{:else if tab === 'decks'}
			<DeckPanel {doc} {snapshot} {issues} {readOnly} {change} {frameOf} {components} />
		{:else}
			<TestMatch
				config={snapshot}
				canPlay={isCard && errors.filter((i) => i.path.startsWith('card.')).length === 0}
			/>
		{/if}
	</div>
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
		max-width: 1500px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.intro {
		margin: 0 0 16px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
		max-width: 900px;
	}
	.intro a {
		color: #7ee0c0;
	}
	.body :global(.warn) {
		margin: 0 0 16px;
		padding: 10px 14px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.conflict {
		margin: 0 0 16px;
		padding: 12px 14px;
		border: 1px solid #6a2727;
		border-radius: 8px;
		background: #1e1010;
		font-size: 13px;
	}
	.conflict .sub {
		color: #b9b9c4;
		font-size: 12px;
	}
	.tabs {
		display: flex;
		gap: 6px;
		margin-bottom: 16px;
		border-bottom: 1px solid #23232c;
		padding-bottom: 8px;
	}
	.tabs button.on {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.split {
		display: grid;
		grid-template-columns: minmax(280px, 420px) 1fr;
		gap: 24px;
		align-items: start;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		position: sticky;
		top: 0;
	}
	.filters {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.cards {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		max-height: 70vh;
		overflow: auto;
	}
	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 6px;
		background: #14141a;
	}
	.tile.on {
		border-color: #7ee0c0;
	}
	.tile-id {
		font-size: 10px;
		color: #8b8b98;
	}
	.dot {
		position: absolute;
		top: 4px;
		right: 6px;
		color: #ff7a7a;
	}
	.add,
	.actions,
	.toggles,
	.looks {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}
	.cols {
		display: grid;
		grid-template-columns: 1fr 240px;
		gap: 24px;
		align-items: start;
	}
	.preview {
		position: sticky;
		top: 0;
	}
	.looks button.on {
		border-color: #7ee0c0;
	}
	.sentences {
		margin: 0;
		padding-left: 18px;
		font-size: 12px;
		line-height: 1.6;
	}
	.effect {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: 8px 0;
		border-bottom: 1px solid #1d1d25;
	}
	.effect .to {
		color: #8b8b98;
	}
	.effect .x {
		margin-left: auto;
	}
	label.num {
		flex-direction: row;
		align-items: center;
		gap: 4px;
	}
	label.num input {
		width: 56px;
	}
	label.wide {
		margin-top: 10px;
	}
	section {
		margin-bottom: 28px;
	}
	.body :global(h2) {
		margin: 0 0 6px;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.body :global(h3) {
		margin: 12px 0 8px;
		font-size: 13px;
	}
	.body :global(.hint) {
		margin: 0 0 10px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
	}
	.body :global(.dim) {
		color: #8b8b98;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 10px 14px;
	}
	.body :global(label) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.body :global(label.check) {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.inline {
		display: flex;
		gap: 6px;
	}
	.inline input {
		flex: 1;
		min-width: 0;
	}
	.body :global(input),
	.body :global(select),
	.body :global(button) {
		font: inherit;
		font-size: 12px;
		background: #14141a;
		color: #e8e8ee;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		padding: 5px 8px;
	}
	.body :global(button) {
		cursor: pointer;
	}
	.body :global(button:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	.body :global(button.danger) {
		border-color: #6a2727;
		color: #ff9a9a;
	}
	.save {
		background: #1f6f54;
		border-color: #2a8a69;
	}
	.pill {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #2a2a35;
		color: #b9b9c4;
	}
	.pill.dirty {
		border-color: #5a4520;
		color: #d3b483;
	}
	.pill.err,
	.err,
	.body :global(.err) {
		color: #ff9a9a;
		font-size: 12px;
	}
	.body :global(.issues) {
		margin: 0 0 16px;
		padding: 8px 12px 8px 28px;
		border: 1px solid #3a2a2a;
		border-radius: 8px;
		background: #171113;
		font-size: 12px;
		line-height: 1.6;
	}
	.body :global(.issues .error) {
		color: #ff9a9a;
	}
	.body :global(.issues .warning) {
		color: #d3b483;
	}
</style>
