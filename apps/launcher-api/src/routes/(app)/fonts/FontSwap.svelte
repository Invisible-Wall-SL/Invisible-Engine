<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { COMPONENTS_VIEW_PARAM, COMPONENTS_VIEW_VALUE } from '$lib/componentLinks';
	import FontPreview from './FontPreview.svelte';
	import {
		fetchSwapFonts,
		swapFont,
		type CatalogFont,
		type FontSwapPart,
		type FontSwapReport,
	} from './fonts.client';

	interface Props {
		sample: string;
		size: number;
		/** The project this page loaded; the swap refuses to run on any other. */
		projectKey: string;
		/** Preselect the font to replace (the View tab's "Swap…" on a card). */
		fromId?: string | null;
		/** Open the Import / Generate tab, to make the replacement font first. */
		onmake: (tab: 'import' | 'generate') => void;
	}

	let { sample, size, projectKey, fromId = null, onmake }: Props = $props();

	let fonts = $state<CatalogFont[]>([]);
	let loading = $state(true);
	let from = $state('');
	let to = $state('');
	let report = $state<FontSwapReport | null>(null);
	let busy = $state<'scan' | 'apply' | null>(null);
	let confirming = $state(false);
	let errorText = $state<string | null>(null);

	const fromFont = $derived(fonts.find((f) => f.id === from));
	const toFont = $derived(fonts.find((f) => f.id === to));
	const total = $derived(
		report?.parts.filter((p) => p.status === 'planned').reduce((n, p) => n + p.refs.length, 0) ?? 0,
	);

	onMount(async () => {
		fonts = await fetchSwapFonts();
		if (fromId && fonts.some((f) => f.id === fromId)) from = fromId;
		loading = false;
	});

	/** A pick invalidates the report it was made for. */
	function pick(): void {
		report = null;
		confirming = false;
		errorText = null;
	}

	async function run(apply: boolean): Promise<void> {
		busy = apply ? 'apply' : 'scan';
		errorText = null;
		try {
			report = await swapFont({ from, to, projectKey, expect: apply ? total : undefined });
			if (apply && !report.blocked) fonts = await fetchSwapFonts();
		} catch (e) {
			errorText = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
			confirming = false;
		}
	}

	const STATUS_LABEL: Record<string, string> = {
		planned: 'will change',
		written: 'swapped',
		skipped: 'skipped',
		error: 'not swapped',
	};

	/** Component docs open the Components side of `/editor` (`$lib/componentLinks`). */
	const partQuery = (part: FontSwapPart) =>
		part.doc === 'components' || part.doc === 'componentDefaults'
			? `?${COMPONENTS_VIEW_PARAM}=${COMPONENTS_VIEW_VALUE}`
			: '';

	const label = (f: CatalogFont) => (f.name === f.id ? f.name : `${f.name} — ${f.id}`);
</script>

<section class="swap">
	<p class="intro muted">
		Point every use of one font at another across this project: Scene Editor text and components,
		project components and their defaults, Flow messages and Symbols. Need a new font to swap in?
		Make it in <button class="link" onclick={() => onmake('import')}>Import</button> or
		<button class="link" onclick={() => onmake('generate')}>Generate</button> first.
	</p>

	{#if loading}
		<p class="muted">Loading fonts…</p>
	{:else if fonts.length < 2}
		<p class="muted">This project needs at least two fonts to swap one for another.</p>
	{:else}
		<div class="grid">
			<div class="panel">
				<h2>Replace</h2>
				<select bind:value={from} onchange={pick}>
					<option value="" disabled>Pick the font in use…</option>
					{#each fonts as f (f.id)}<option value={f.id}>{label(f)}</option>{/each}
				</select>
				{#if fromFont}
					<div class="live">
						{#key fromFont.id}<FontPreview font={fromFont} {sample} {size} />{/key}
					</div>
				{/if}
			</div>
			<div class="panel">
				<h2>With</h2>
				<select bind:value={to} onchange={pick}>
					<option value="" disabled>Pick the replacement…</option>
					{#each fonts as f (f.id)}
						<option value={f.id} disabled={f.id === from}>{label(f)}</option>
					{/each}
				</select>
				{#if toFont}
					<div class="live">
						{#key toFont.id}<FontPreview font={toFont} {sample} {size} />{/key}
					</div>
				{/if}
			</div>
		</div>

		<div class="actions">
			<button
				class="primary"
				type="button"
				disabled={!from || !to || from === to || busy !== null}
				onclick={() => run(false)}
			>
				{busy === 'scan' ? 'Finding…' : 'Find references'}
			</button>
			{#if report && !report.applied && total > 0}
				{#if confirming}
					<span class="confirm-q">
						Swap {total} reference{total === 1 ? '' : 's'} to {report.to.name}?
					</span>
					<button class="danger" type="button" disabled={busy !== null} onclick={() => run(true)}>
						{busy === 'apply' ? 'Swapping…' : 'Yes, swap'}
					</button>
					<button
						class="ghost"
						type="button"
						disabled={busy !== null}
						onclick={() => (confirming = false)}
					>
						Cancel
					</button>
				{:else}
					<button class="ghost" type="button" onclick={() => (confirming = true)}>
						Swap {total} reference{total === 1 ? '' : 's'}
					</button>
				{/if}
			{/if}
		</div>

		{#if errorText}<p class="err">{errorText}</p>{/if}

		{#if report}
			<div class="panel report">
				{#if report.blocked}
					<p class="err">Nothing was swapped: {report.blocked}</p>
				{:else if report.parts.some((p) => p.status === 'written')}
					<p class="ok">
						Swapped {report.from.name} for {report.to.name}. Each tool keeps a backup of the version
						it replaced.
					</p>
				{:else if report.parts.every((p) => p.status === 'none')}
					<p class="muted">Nothing in this project's docs uses {report.from.name}.</p>
				{/if}
				<ul class="parts">
					{#each report.parts.filter((p) => p.status !== 'none') as part (part.doc)}
						<li>
							<div class="part-head">
								<a href="{resolve(part.path)}{partQuery(part)}">{part.label}</a>
								<span class="count">{part.refs.length}</span>
								<span class="status {part.status}">{STATUS_LABEL[part.status]}</span>
							</div>
							{#if part.note}<p class="note">{part.note}</p>{/if}
							{#if part.refs.length}
								<details>
									<summary>Where</summary>
									<ul class="refs">
										{#each part.refs as ref, i (i)}<li>{ref}</li>{/each}
									</ul>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
				{#if report.rigText.length}
					<div class="rigs">
						<p class="warn">
							Rig text is baked into the rig's pixels, so it is not swapped here. Re-bake these in
							the
							<a href={resolve('/rigger')}>Rigger</a> with {report.to.name}:
						</p>
						<ul class="refs">
							{#each report.rigText as rig (rig.bundle)}
								<li><span class="mono">{rig.bundle}</span> · {rig.elements.join(', ')}</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if report.applied}
					<p class="muted small">
						The old font stays in the catalog: delete it from the View tab once nothing needs it.
						Published games pick up the swap on their next publish.
					</p>
				{/if}
			</div>
		{/if}
	{/if}
</section>

<style>
	.swap {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.intro {
		margin: 0;
		max-width: 760px;
	}
	.muted {
		color: #888;
		font-size: 13px;
		line-height: 1.6;
	}
	.small {
		font-size: 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	@media (max-width: 820px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.panel {
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 16px 18px;
		min-width: 0;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 0 0 12px;
	}
	select {
		width: 100%;
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
	}
	select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.live {
		margin-top: 12px;
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 10px 12px;
	}
	.actions {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}
	.primary {
		background: #6b5bff;
		border: none;
		border-radius: 8px;
		padding: 9px 18px;
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.ghost,
	.danger {
		background: transparent;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 9px 16px;
		color: #bbb;
		font-size: 13px;
		cursor: pointer;
	}
	.danger {
		border-color: #5a2f2f;
		background: #2a1a1a;
		color: #e06b6b;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.confirm-q {
		font-size: 13px;
		color: #e0b050;
	}
	.link {
		background: transparent;
		border: none;
		color: #7ee0c0;
		cursor: pointer;
		padding: 0;
		font-size: inherit;
		text-decoration: underline;
	}
	.err {
		color: #e06b6b;
		font-size: 13px;
		margin: 0;
	}
	.ok {
		color: #7ee787;
		font-size: 13px;
		margin: 0 0 12px;
	}
	.warn {
		color: #e0b050;
		font-size: 13px;
		margin: 0 0 6px;
	}
	.report a {
		color: #c8a3ff;
	}
	.parts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.part-head {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
	}
	.count {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #aaa;
	}
	.status {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid #333;
		color: #aaa;
	}
	.status.written {
		border-color: #2f5340;
		color: #7ee787;
	}
	.status.skipped,
	.status.error {
		border-color: #5a2f2f;
		color: #e06b6b;
	}
	.note {
		color: #e0b050;
		font-size: 12px;
		margin: 4px 0 0;
	}
	details summary {
		cursor: pointer;
		color: #888;
		font-size: 12px;
		margin-top: 4px;
	}
	.refs {
		margin: 6px 0 0;
		padding-left: 18px;
		color: #bbb;
		font-size: 12px;
		line-height: 1.7;
	}
	.rigs {
		margin-top: 14px;
		border-top: 1px solid #222;
		padding-top: 12px;
	}
	.mono {
		font-family: ui-monospace, monospace;
	}
</style>
