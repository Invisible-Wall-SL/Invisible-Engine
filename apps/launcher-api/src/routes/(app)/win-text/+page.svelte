<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { guardUnsavedWork } from '$lib/unsavedGuard';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import {
		WIN_TEXT_FEATURE_FIELDS,
		WIN_TEXT_FEATURE_LABELS,
		WIN_TEXT_JACKPOT_FIELDS,
		WIN_TEXT_JACKPOT_LABELS,
		WIN_TEXT_RESPIN_FIELDS,
		WIN_TEXT_RESPIN_LABELS,
		WIN_TEXT_WHEEL_FIELDS,
		WIN_TEXT_WHEEL_LABELS,
		collectorLevelCaption,
		potCaption,
		formatWinText,
		jackpotCaption,
		resolveSymbolName,
		resolveToastTemplate,
		resolveWinText,
		resolveWinLineMessage,
		specialDisplayName,
		symbolDrawsWinLine,
		winTextCellKey,
	} from 'engine-layout';
	import type {
		WinTextDoc,
		WinTextFeatureField,
		WinTextJackpotField,
		WinTextFeatureMap,
		WinTextRespinField,
		WinTextWheelField,
	} from 'engine-layout';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The live doc. Seeded from the server's sparse doc and PUT back verbatim — the resolution
	 * chain + defaults come from `engine-layout/winText.ts`, the SAME module the game resolves
	 * with, so what this grid shows is what the game will draw.
	 */
	let doc = $state<WinTextDoc>(structuredClone(data.doc));
	let savedAt = $state<string | null>(null);

	/** Compared against the doc to drive the dirty pill. `$state.snapshot` because a raw
	 *  `structuredClone` of a `$state` proxy throws `DataCloneError`. */
	let baseline = $state(JSON.stringify(data.doc));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);

	const resolved = $derived(resolveWinText($state.snapshot(doc)));

	/**
	 * The match counts the grid offers. Every current game template is a 5-reel board, so a line
	 * pays on 2–5 of a kind. The DOC accepts any count key, so a future wider board only needs
	 * this list widened — nothing downstream is bounded by it.
	 */
	const COUNTS = [2, 3, 4, 5];

	/**
	 * The win-level aliases offered: the project's big-win tiers from its Game Config (a caption is
	 * only ever drawn for a big tier), labelled with the tier's name. A config that authors no tiers
	 * runs on the coded `winLevelMap`, whose big tiers are these five. An alias the doc already
	 * holds is always listed, so a tier renamed in the config never strands what was written for it.
	 */
	const CODED_BIG_ALIASES = ['big', 'superwin', 'mega', 'epic', 'max'];
	const winLevelRows = $derived.by(() => {
		const rows = data.bigTiers.length
			? data.bigTiers.map((tier) => ({ alias: tier.alias, name: tier.name }))
			: CODED_BIG_ALIASES.map((alias) => ({ alias, name: alias }));
		for (const alias of Object.keys(doc.winLevels ?? {})) {
			if (!rows.some((row) => row.alias === alias)) rows.push({ alias, name: alias });
		}
		return rows;
	});

	const TOKEN_HELP = '{amount} {count} {symbolName} {line}';

	/**
	 * A concrete rendering of a template, using the FIRST named symbol (or the first symbol at
	 * all) at 3 of a kind — the same `formatWinText` the game calls, so the preview can't drift
	 * from what ships. Localization is a no-op here (the launcher registers no catalog), which is
	 * exactly right: this previews the SOURCE language the templates are written in.
	 */
	const previewSymbol = $derived(
		data.symbols.find((s) => data.symbolNames[s]?.singular) ?? data.symbols[0] ?? 'H1',
	);
	const PREVIEW_COUNT = 3;
	const previewVars = $derived({
		amount: '$4.00',
		count: PREVIEW_COUNT,
		symbol: previewSymbol,
		symbolName: resolveSymbolName(data.symbolNames, previewSymbol, PREVIEW_COUNT),
		line: 1,
	});
	const preview = (template: string): string => formatWinText(template, previewVars);

	/** How many of the project's symbols have a name — the whole `{symbolName}` feature is dark
	 *  until at least one does, so the page says so rather than silently previewing ids. */
	const namedCount = $derived(data.symbols.filter((s) => data.symbolNames[s]?.singular).length);

	/** The exact branch + text the info bar will show for a normal symbol win, resolved by the
	 *  game's own `resolveToastTemplate`. */
	const toastPreview = $derived(preview(resolveToastTemplate(resolved, previewVars) ?? ''));

	/** The same win, but EXPANDED — the branch a Book-of column morph takes. Previewed beside the
	 *  ordinary one because the whole point of the field is that the two must read differently. */
	const expandedToastPreview = $derived(
		preview(resolveToastTemplate(resolved, { ...previewVars, expanded: true }) ?? ''),
	);

	/**
	 * The symbols that can actually carry a win-line message. A scatter pays "anywhere" rather
	 * than along a payline, so the engine draws no line for it and never asks for its text — a row
	 * here would be a control that silently does nothing. The rule comes from `engine-layout`
	 * (the same predicate the engine gates on), never a literal `'S'` copied into this page.
	 */
	const lineSymbols = $derived(data.symbols.filter(symbolDrawsWinLine));
	const excludedSymbols = $derived(data.symbols.filter((s) => !symbolDrawsWinLine(s)));

	/** Write a sparse nested value, deleting the key when the input is blank so a cleared
	 *  override falls back through the chain instead of persisting an empty string. */
	function setLineMessage(bucket: 'byCount' | 'bySymbol' | 'byCell', key: string, value: string) {
		const lm = (doc.lineMessage ??= {});
		const map = (lm[bucket] ??= {});
		if (value.trim()) map[key] = value;
		else delete map[key];
	}

	function setDefault(value: string) {
		const lm = (doc.lineMessage ??= {});
		if (value.trim()) lm.default = value;
		else delete lm.default;
	}

	function setWinLevel(alias: string, value: string) {
		const levels = (doc.winLevels ??= {});
		if (value.trim()) levels[alias] = value;
		else delete levels[alias];
	}

	function setToast(branch: 'full' | 'expanded' | 'amountOnly' | 'countOnly', value: string) {
		const toast = (doc.toast ??= {});
		if (value.trim()) toast[branch] = value;
		else delete toast[branch];
	}

	function setSymbolAsImage(on: boolean) {
		const toast = (doc.toast ??= {});
		if (on) toast.symbolAsImage = true;
		else delete toast.symbolAsImage;
	}

	function setFreeSpins(branch: 'retrigger', value: string) {
		const freeSpins = (doc.freeSpins ??= {});
		if (value.trim()) freeSpins[branch] = value;
		else delete freeSpins[branch];
	}

	function setJackpot(field: WinTextJackpotField, value: string) {
		const jackpots = (doc.jackpots ??= {});
		if (value.trim()) jackpots[field] = value;
		else delete jackpots[field];
	}

	function setJackpotCaption(tier: string, value: string) {
		const captions = ((doc.jackpots ??= {}).captions ??= {});
		if (value.trim()) captions[tier] = value;
		else delete captions[tier];
	}

	function setRespins(field: WinTextRespinField, value: string) {
		const respins = (doc.respins ??= {});
		if (value.trim()) respins[field] = value;
		else delete respins[field];
	}

	function setFeature(field: WinTextFeatureField, value: string) {
		const feature = (doc.feature ??= {});
		if (value.trim()) feature[field] = value;
		else delete feature[field];
	}

	function setFeatureName(map: WinTextFeatureMap, key: string, value: string) {
		const names = ((doc.feature ??= {})[map] ??= {});
		if (value.trim()) names[key] = value;
		else delete names[key];
	}

	function setWheel(field: WinTextWheelField, value: string) {
		const wheel = (doc.wheel ??= {});
		if (value.trim()) wheel[field] = value;
		else delete wheel[field];
	}

	/** The name rows under the feature lines: one per special kind, per named collector level, and
	 *  per pot the config declares (its id is the key). */
	const nameRows = $derived([
		...Object.keys(resolved.feature.specialNames).map((key) => ({
			map: 'specialNames' as const,
			key,
			label: key,
			placeholder: specialDisplayName(resolved, key),
		})),
		...Object.keys(resolved.feature.collectorLevelNames).map((key) => ({
			map: 'collectorLevelNames' as const,
			key,
			label: `collector level ${key}`,
			placeholder: collectorLevelCaption(resolved, Number(key)),
		})),
		...data.meterIds.map((key) => ({
			map: 'potNames' as const,
			key,
			label: `pot ${key}`,
			placeholder: potCaption(resolved, key),
		})),
	]);

	/**
	 * The Hold and Win preview values: the config's first jackpot tier, three respins, and the
	 * payer as the special a pot activates — rendered through the same resolver helpers the game
	 * calls, so a caption or special name authored here shows up in every line that uses it.
	 */
	const holdAndWinVars = $derived({
		amount: '$4.00',
		count: 3,
		jackpot: jackpotCaption(resolved, data.jackpotTiers[0] ?? 'MINI'),
		meter: specialDisplayName(resolved, 'payer'),
		modifiers: ['payer', 'multiplier'].map((kind) => specialDisplayName(resolved, kind)).join(', '),
		level: collectorLevelCaption(resolved, 2),
	});
	const holdAndWinPreview = (template: string): string => formatWinText(template, holdAndWinVars);
	/** A pot's `{level}` is its fill, not a collector name, so its row previews with pot values. */
	const potPreview = $derived(
		formatWinText(resolved.feature.potLabel, {
			pot: potCaption(resolved, data.meterIds[0] ?? 'red'),
			level: 5,
			max: 12,
		}),
	);

	function setAmountFormat(value: string) {
		if (value.trim()) doc.amountFormat = value;
		else delete doc.amountFormat;
	}

	/** What a `(symbol, count)` win will actually say, and which level of the chain said it —
	 *  the same call the game makes, so the badge can't drift from behaviour. */
	function effective(symbol: string, count: number) {
		return resolveWinLineMessage(resolved, symbol, count);
	}

	/**
	 * Persist the doc, conditional on the ETag we loaded.
	 *
	 * `force` drops the precondition — the explicit "overwrite with mine" after a conflict. On a
	 * conflict this NEVER reloads or discards the local doc: the author's unsaved work is the one
	 * thing that isn't recoverable, so it stays put and they choose.
	 */
	/**
	 * Save-state machine (multi-user-concurrency Phase 2a). Manual save; the transport owns
	 * the request + the caller-side create encoding (JSON `null` baseEtag). A 409 maps to
	 * `conflict` (the in-body banner, non-destructive — local edits are KEPT); `force` drops
	 * the precondition. The transport adopts the SERVER's normalized doc (it prunes blanks) so
	 * the baseline is exactly what persisted, or the page would read dirty after a clean save.
	 */
	/**
	 * Soft edit lease (multi-user-concurrency Phase 2c) over this project's win-text doc
	 * (`docKey:'winText'`). When another author holds it, `lease.readOnly` gates the doc
	 * `saveState` (its `blockWhen`) so a not-held tab can't save, the Save button hides behind
	 * `<PresenceBanner>`, and Take over is always reachable. The `If-Match` CAS stays the floor.
	 */
	const lease = new LeaseState({
		toolId: 'winText',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'winText',
		enabled: data.projectKey.length > 0,
	});

	const saveState = new SaveState({
		initialEtag: data.etag,
		conflictMessage: 'Someone else saved this win text while you were editing.',
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const res = await fetch(`/api/win-text?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: $state.snapshot(doc), baseEtag, force }),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				return { ok: false, reason: 'conflict', message: c.message };
			}
			if (!res.ok) {
				return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
			}
			const saved = (await res.json()) as { doc: WinTextDoc; etag: string | null };
			doc = structuredClone(saved.doc);
			baseline = JSON.stringify(saved.doc);
			savedAt = new Date().toLocaleTimeString();
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
					title: 'This win text has unsaved changes',
					message: 'Leaving this page discards them.',
					confirmLabel: 'Leave anyway',
					danger: true,
				}
			: null,
	);
</script>

<svelte:head><title>Invisible Win Text — {data.projectKey}</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="winText"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if lease.readOnly}
				<!-- Another author (or your own other tab) holds the edit lease → read-only here.
				     The doc saveState refuses to save (its blockWhen); Take over is always offered. -->
				<PresenceBanner {lease} />
			{:else}
				{#if saveState.status === 'error'}<span class="err">{saveState.message}</span>{/if}
				{#if dirty}<span class="pill dirty">Unsaved</span>{:else if savedAt}<span class="pill"
						>Saved {savedAt}</span
					>{/if}
			{/if}
			<button
				class="save"
				onclick={() => save()}
				disabled={lease.readOnly || saveState.busy || !dirty}
			>
				{saveState.busy ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if saveState.status === 'conflict'}
			<div class="conflict">
				<p>{saveState.message}</p>
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
			What the game <em>says</em> about a win. Every field is a <strong>template</strong> — write
			<code>{TOKEN_HELP}</code>
			and the game fills them in. <code>{'{symbolName}'}</code> becomes the symbol's own name
			(plural when the count isn't 1), which you write in
			<a href="/symbols">Invisible Symbols</a> — rename a symbol there and every message here
			follows, with no edit. Templates are translated in
			<a href="/localization">Invisible Localization</a>; the currency in
			<code>{'{amount}'}</code> follows the player's own locale automatically.
		</p>
		{#if namedCount === 0}
			<p class="warn">
				<strong>None of this game's symbols has a name yet.</strong> Until you name them in
				<a href="/symbols">Invisible Symbols</a>, <code>{'{symbolName}'}</code> falls back to the
				raw id and the game will say “You win $4.00 with 4 {previewSymbol}”.
			</p>
		{/if}

		<section>
			<h2>Win-line message</h2>
			<p class="hint">
				The message drawn with the win line. A win uses the <strong>most specific</strong> cell that
				is filled in: an exact symbol × count beats <em>Any count</em>, which beats
				<em>Any symbol</em>, which beats the default in the corner. Leave a cell blank to inherit —
				the grey text shows what it will inherit.
				{#if excludedSymbols.length}
					<br />
					<strong>{excludedSymbols.join(', ')}</strong>
					{excludedSymbols.length === 1 ? 'is not listed' : 'are not listed'}: a scatter pays
					anywhere rather than along a line, so the game draws no win line for it and this message
					would never appear. Use the
					<em>Info-bar message</em> below for those wins.
				{/if}
			</p>

			<div class="grid-wrap">
				<table class="grid">
					<thead>
						<tr>
							<th class="corner-head">Symbol</th>
							{#each COUNTS as count (count)}
								<th>{count} matching</th>
							{/each}
							<th class="any">Any count</th>
						</tr>
					</thead>
					<tbody>
						<tr class="any-row">
							<th class="row-head any">Any symbol</th>
							{#each COUNTS as count (count)}
								<td>
									<input
										value={doc.lineMessage?.byCount?.[String(count)] ?? ''}
										placeholder={resolved.lineMessage.default || '—'}
										oninput={(e) => setLineMessage('byCount', String(count), e.currentTarget.value)}
									/>
								</td>
							{/each}
							<td class="corner">
								<input
									class="default-input"
									value={doc.lineMessage?.default ?? ''}
									placeholder="Default — e.g. {'{count}'} {'{symbolName}'}"
									oninput={(e) => setDefault(e.currentTarget.value)}
								/>
							</td>
						</tr>

						{#each lineSymbols as symbol (symbol)}
							{@const name = data.symbolNames[symbol]?.singular}
							<tr>
								<th class="row-head">
									{symbol}
									<!-- The name is READ-ONLY here: `/symbols` owns it (one fact, one home). Shown
									     so the author can tell at a glance which rows will speak a word and which
									     will fall back to the id. -->
									{#if name}<span class="row-name">{name}</span>{/if}
								</th>
								{#each COUNTS as count (count)}
									{@const eff = effective(symbol, count)}
									<td>
										<input
											value={doc.lineMessage?.byCell?.[winTextCellKey(symbol, count)] ?? ''}
											placeholder={eff.template || '—'}
											title={eff.source === 'cell'
												? 'Set here'
												: `Inherited from ${eff.source === 'default' ? 'the default' : eff.source}`}
											oninput={(e) =>
												setLineMessage(
													'byCell',
													winTextCellKey(symbol, count),
													e.currentTarget.value,
												)}
										/>
									</td>
								{/each}
								<td class="any-col">
									<input
										value={doc.lineMessage?.bySymbol?.[symbol] ?? ''}
										placeholder={resolved.lineMessage.default || '—'}
										oninput={(e) => setLineMessage('bySymbol', symbol, e.currentTarget.value)}
									/>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section>
			<h2>Win amount</h2>
			<p class="hint">
				How the pay amount is stamped on the win line. <code>{'{amount}'}</code> is already formatted
				in the player's currency.
			</p>
			<label class="single">
				<span>Amount format</span>
				<input
					value={doc.amountFormat ?? ''}
					placeholder={'{amount}'}
					oninput={(e) => setAmountFormat(e.currentTarget.value)}
				/>
			</label>
		</section>

		<section>
			<h2>Info-bar message</h2>
			<p class="hint">
				The transient message shown when a win pays. It <strong>names the symbol</strong> that paid
				— write <code>{'{symbolName}'}</code> and the game fills in the name from
				<a href="/symbols">Invisible Symbols</a>, so a win reads
				<em>“You win $4.00 with 4 Bananas”</em>. Three separate lines because the game shows
				whichever fits what it knows: a message fired without a symbol (any flow can fire one) falls
				back to the amount-only line rather than printing a blank name.
			</p>
			{#if data.capabilities.bookReveal}
				<p class="hint">
					A <strong>Book-of expanding symbol</strong> gets its own line. When the special symbol
					fills whole reels, <code>{'{count}'}</code> is the number of <strong>reels</strong> it covers
					— not the number of icons on screen — so the ordinary sentence miscounts what the player is
					looking at (four boots named over a board showing twelve). Leave it blank to fall back to the
					amount + symbol line.
				</p>
			{/if}
			<p class="hint">
				Live preview for <code>{previewSymbol}</code> × {PREVIEW_COUNT}:
				<strong class="preview">{toastPreview || '—'}</strong>
			</p>
			{#if data.capabilities.bookReveal}
				<p class="hint">
					…and the same win <strong>expanded</strong>:
					<strong class="preview">{expandedToastPreview || '—'}</strong>
				</p>
			{/if}
			<label class="single">
				<span>Amount + symbol</span>
				<input
					value={doc.toast?.full ?? ''}
					placeholder={resolved.toast.full}
					oninput={(e) => setToast('full', e.currentTarget.value)}
				/>
			</label>
			{#if data.capabilities.bookReveal}
				<label class="single">
					<span>Expanded symbol win</span>
					<input
						value={doc.toast?.expanded ?? ''}
						placeholder={resolved.toast.expanded}
						oninput={(e) => setToast('expanded', e.currentTarget.value)}
					/>
				</label>
			{/if}
			<label class="single">
				<span>Amount only</span>
				<input
					value={doc.toast?.amountOnly ?? ''}
					placeholder={resolved.toast.amountOnly}
					oninput={(e) => setToast('amountOnly', e.currentTarget.value)}
				/>
			</label>
			<label class="single">
				<span>Symbol only</span>
				<input
					value={doc.toast?.countOnly ?? ''}
					placeholder={resolved.toast.countOnly}
					oninput={(e) => setToast('countOnly', e.currentTarget.value)}
				/>
			</label>
			<label class="toggle">
				<input
					type="checkbox"
					checked={doc.toast?.symbolAsImage ?? false}
					onchange={(e) => setSymbolAsImage(e.currentTarget.checked)}
				/>
				<span
					>Show the symbol as an <strong>image</strong> instead of its name — the
					<code>{'{symbolName}'}</code> in the toast is drawn as the symbol itself, sized to the text.
					An animated symbol — flipbook or spine — is held on its first frame: the token stands in for
					a NAME, and something moving inside a sentence pulls the eye off the words. Falls back to the
					name if a symbol has no art.</span
				>
			</label>
		</section>

		{#if data.capabilities.freeSpins}
			<section>
				<h2>Free spins</h2>
				<p class="hint">
					The celebration line shown when a player wins <strong>extra free spins mid-feature</strong
					>
					(a retrigger). Write <code>{'{count}'}</code> where the number of extra spins goes, so it
					reads <em>“You won +10 Extra Free Spins”</em>. Authored as one sentence so it
					<a href="/localization">translates</a> correctly. Bind a text node's source to
					<code>freeSpinsAddedText</code> to show it (or <code>freeSpinsAdded</code> for a bare number).
				</p>
				<label class="single">
					<span>Retrigger (+N extra)</span>
					<input
						value={doc.freeSpins?.retrigger ?? ''}
						placeholder={resolved.freeSpins.retrigger}
						oninput={(e) => setFreeSpins('retrigger', e.currentTarget.value)}
					/>
				</label>
			</section>
		{/if}

		{#if data.capabilities.holdAndWin}
			<p class="hint">
				A few lines have no place on screen yet: <em>Respins awarded</em>, <em>Respins reset</em>,
				<em>Last respin</em>, <em>Feature total</em>, <em>Pot full</em> and the intro / outro are saved
				and translated, and show once a scene or beat uses them. Every other line here is what the game
				draws.
			</p>
			<section>
				<h2>Jackpots</h2>
				<p class="hint">
					What the player reads for each jackpot tier, and the banners a jackpot win shows. The
					tiers are this game's own, from <a href={resolve('/config')}>Invisible Game Config</a>;
					leave a tier blank and it is called by its config name. Write <code>{'{jackpot}'}</code>
					where the tier's caption goes (the tier it rose to, on an upgrade) and
					<code>{'{amount}'}</code> for what it paid — for a progressive tier, the live pool the
					server paid out, not its seed.
				</p>
				{#each data.jackpotTiers as tier (tier)}
					<label class="single">
						<span>{tier}</span>
						<input
							value={doc.jackpots?.captions?.[tier] ?? ''}
							placeholder={tier}
							oninput={(e) => setJackpotCaption(tier, e.currentTarget.value)}
						/>
					</label>
				{:else}
					<p class="warn">
						This game's config names no jackpot tiers yet — add them in
						<a href={resolve('/config')}>Invisible Game Config</a> to caption them here.
					</p>
				{/each}
				{#each WIN_TEXT_JACKPOT_FIELDS as field (field)}
					<label class="single">
						<span>{WIN_TEXT_JACKPOT_LABELS[field]}</span>
						<input
							value={doc.jackpots?.[field] ?? ''}
							placeholder={resolved.jackpots[field]}
							oninput={(e) => setJackpot(field, e.currentTarget.value)}
						/>
						<em class="row-preview">{holdAndWinPreview(resolved.jackpots[field]) || '—'}</em>
					</label>
				{/each}
			</section>

			<section>
				<h2>Respins</h2>
				<p class="hint">
					The respin counter and its moments. <code>{'{count}'}</code> is a number of respins — the respins
					left on the counter, the respins awarded when the feature starts, the respins an add-respins
					special adds.
				</p>
				{#each WIN_TEXT_RESPIN_FIELDS as field (field)}
					<label class="single">
						<span>{WIN_TEXT_RESPIN_LABELS[field]}</span>
						<input
							value={doc.respins?.[field] ?? ''}
							placeholder={resolved.respins[field]}
							oninput={(e) => setRespins(field, e.currentTarget.value)}
						/>
						<em class="row-preview">{holdAndWinPreview(resolved.respins[field]) || '—'}</em>
					</label>
				{/each}
			</section>

			<section>
				<h2>Hold and Win feature</h2>
				<p class="hint">
					The feature's own lines. <code>{'{amount}'}</code> is the feature's total,
					<code>{'{meter}'}</code> the special a full pot activates and
					<code>{'{modifiers}'}</code> the specials a feature runs with — each written with the names
					below. The intro and outro draw nothing until you write them.
				</p>
				{#each WIN_TEXT_FEATURE_FIELDS as field (field)}
					<label class="single">
						<span>{WIN_TEXT_FEATURE_LABELS[field]}</span>
						<input
							value={doc.feature?.[field] ?? ''}
							placeholder={resolved.feature[field] || 'not drawn'}
							oninput={(e) => setFeature(field, e.currentTarget.value)}
						/>
						<em class="row-preview"
							>{(field === 'potLabel' ? potPreview : holdAndWinPreview(resolved.feature[field])) ||
								'—'}</em
						>
					</label>
				{/each}
				<p class="hint">
					Names: the specials (as <code>{'{meter}'}</code> and <code>{'{modifiers}'}</code> write
					them), the collector levels the wheel raises (<code>{'{level}'}</code>; an unnamed level
					reads ×4) and this game's pots (<code>{'{pot}'}</code>):
				</p>
				{#each nameRows as row (`${row.map}:${row.key}`)}
					<label class="single">
						<span>{row.label}</span>
						<input
							value={doc.feature?.[row.map]?.[row.key] ?? ''}
							placeholder={row.placeholder}
							oninput={(e) => setFeatureName(row.map, row.key, e.currentTarget.value)}
						/>
					</label>
				{/each}
			</section>

			{#if data.hasWheel}
				<section>
					<h2>Wheel</h2>
					<p class="hint">
						The pre-feature wheel: its segment labels and the banner its prize shows.
						<code>{'{count}'}</code> is the boost multiplier or the number of extra collects,
						<code>{'{level}'}</code> the collector's new level. A jackpot segment reads its tier's caption
						from above.
					</p>
					{#each WIN_TEXT_WHEEL_FIELDS as field (field)}
						<label class="single">
							<span>{WIN_TEXT_WHEEL_LABELS[field]}</span>
							<input
								value={doc.wheel?.[field] ?? ''}
								placeholder={resolved.wheel[field]}
								oninput={(e) => setWheel(field, e.currentTarget.value)}
							/>
							<em class="row-preview">{holdAndWinPreview(resolved.wheel[field]) || '—'}</em>
						</label>
					{/each}
				</section>
			{/if}
		{/if}

		<section>
			<h2>Win-level captions</h2>
			<p class="warn">
				<strong>Usually leave these blank.</strong> In most games the tier words are painted into
				the big-win artwork, and the game draws only the amount — so filling one in adds a
				<em>second</em> caption on top of art that already says it. Fill these in only for a game whose
				big-win art carries no words (which is also what lets the tier be translated without re-cutting
				the art per language).
			</p>
			{#each winLevelRows as row (row.alias)}
				<label class="single">
					<span title={row.alias}>{row.name}</span>
					<input
						value={doc.winLevels?.[row.alias] ?? ''}
						placeholder="not drawn"
						oninput={(e) => setWinLevel(row.alias, e.currentTarget.value)}
					/>
				</label>
			{/each}
		</section>
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
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
	}
	.intro {
		margin: 0 0 24px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
	}
	.intro a {
		color: #7ee0c0;
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
	.hint,
	.warn {
		margin: 0 0 12px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.warn {
		padding: 10px 12px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}
	.grid-wrap {
		overflow-x: auto;
		border: 1px solid #1c1c24;
		border-radius: 10px;
	}
	.grid {
		border-collapse: collapse;
		width: 100%;
		min-width: 900px;
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
	.grid th.any,
	.grid td.any-col,
	.grid td.corner {
		background: #121019;
	}
	.row-head {
		font-family: ui-monospace, monospace;
		color: #c8a3ff;
		background: #101017;
		border-right: 1px solid #1c1c24;
	}
	.row-name {
		display: block;
		margin-top: 2px;
		font-family: inherit;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: #7ee0c0;
	}
	.preview {
		color: #7ee0c0;
	}
	.warn a {
		color: #e3c48f;
	}
	.any-row td {
		background: #121019;
	}
	.grid td {
		padding: 4px;
		border-bottom: 1px solid #16161d;
	}
	.grid input {
		width: 100%;
		min-width: 150px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #24242e;
		background: #0e0e13;
		color: #e8e8ee;
		font-size: 12px;
	}
	.grid input::placeholder {
		color: #4d4d5a;
		font-style: italic;
	}
	.grid input:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.default-input {
		border-color: #3a3358 !important;
	}
	.single {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
		max-width: 720px;
	}
	.single span {
		flex: none;
		width: 130px;
		font-size: 12px;
		color: #8b8b98;
		font-family: ui-monospace, monospace;
	}
	.single input {
		flex: 1;
		padding: 7px 9px;
		border-radius: 6px;
		border: 1px solid #24242e;
		background: #0e0e13;
		color: #e8e8ee;
		font-size: 12px;
	}
	.single input::placeholder {
		color: #4d4d5a;
		font-style: italic;
	}
	.single input:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.row-preview {
		flex: none;
		width: 220px;
		font-size: 12px;
		color: #7ee0c0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.toggle {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin: 12px 0 4px;
		max-width: 720px;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.5;
		cursor: pointer;
	}
	.toggle input {
		flex: none;
		margin-top: 2px;
	}
	.toggle strong {
		color: #c7c7d2;
	}
	.save {
		padding: 6px 14px;
		border-radius: 8px;
		border: 1px solid #2b6f5a;
		background: #14241d;
		color: #7ee0c0;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.pill {
		padding: 3px 9px;
		border-radius: 999px;
		background: #16161d;
		font-size: 11px;
		color: #8b8b98;
	}
	.pill.dirty {
		background: #2a2113;
		color: #d3b483;
	}
	.err {
		color: #ff9b9b;
		font-size: 11px;
		max-width: 320px;
	}
	.conflict {
		margin-bottom: 20px;
		padding: 14px 16px;
		border: 1px solid #6b3030;
		border-radius: 10px;
		background: #221214;
	}
	.conflict p {
		margin: 0 0 6px;
		font-size: 13px;
		color: #ffbdbd;
	}
	.conflict-sub {
		font-size: 12px !important;
		color: #b98d8d !important;
	}
	.conflict-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.conflict-actions button {
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid #3a3a48;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.conflict-actions .danger {
		border-color: #6b3030;
		background: #2c1618;
		color: #ffbdbd;
	}
</style>
