<script lang="ts">
	/**
	 * The body of a RIG source (`docs/design/character-pipeline.md` §12.4, §12.7): the one rig,
	 * a rig per facing, what the page has read of each rig the sheet names (its animations with
	 * their lengths, its skins, what it costs to draw, a link to the Rigger), and the variants,
	 * each a skin worn while a status holds. Every edit is one of
	 * `$lib/characters/characterSheetSources` or `characterSheetEdit`; what is listed is
	 * `characterSheetRigCard.ts`'s. The rig is made in Invisible Rigger, not here.
	 */
	import { resolve } from '$app/paths';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import RigSelect from '$lib/characters/RigSelect.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { animationLabel, rigsShown, sheetSkins } from '$lib/characters/characterSheetRigCard';
	import {
		rigFacingsOf,
		rigSourceOfSheet,
		setFacingRig,
		setSourceRig,
	} from '$lib/characters/characterSheetSources';
	import {
		RIG_COST_LEVEL_LABELS,
		RIG_COST_TIP,
		rigCostLine,
		rigCostVerdict,
	} from '$lib/characters/rigCost';
	import { riggerLinkFor } from '$lib/riggerLinks';
	import type { CharacterSheet } from 'game-config';
	import type { RigRead } from '../rigRead.svelte';
	import type { WholeRead } from '../wholeRead.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		projectKey: string;
		sheet: CharacterSheet | undefined;
		read: WholeRead;
		rigs: RigRead;
		readOnly: boolean;
		edit: SheetEdit;
		/** The source is not a rig yet: the first rig picked makes it one (the card asks first when
		 *  the old source loses something). */
		onFirstRig: (rig: string) => Promise<boolean>;
	}
	let { id, projectKey, sheet, read, rigs, readOnly, edit, onFirstRig }: Props = $props();

	const source = $derived(rigSourceOfSheet(sheet));
	const facings = $derived(rigFacingsOf(sheet));
	const shown = $derived(rigsShown(sheet, rigs.facts, rigs.failed));
	const variants = $derived(sheets.variantsOf(sheet));
	const skins = $derived(sheetSkins(sheet, rigs.facts));
	let refused = $state('');
	let newStatus = $state('');
	let newSkin = $state('');
	const run = (change: Parameters<SheetEdit>[0]): boolean => {
		refused = edit(change) ?? '';
		return !refused;
	};
</script>

<div class="fields rig-body" data-source-rig>
	<label
		>Rig
		<RigSelect
			rigs={read.rigs}
			value={source?.rig ?? ''}
			blank={source?.rig ? 'none (only the rigs per facing)' : undefined}
			label="The rig drawn in every facing"
			disabled={readOnly || !read.read}
			onPick={(rig) => {
				if (source) run((d) => setSourceRig(d, id, rig));
				else if (rig) void onFirstRig(rig);
			}}
		/>
	</label>
</div>
{#if read.rigsError}<p class="err" data-rigs-error>{read.rigsError}</p>{/if}
{#if read.read && !read.rigs.length && !read.rigsError}
	<p class="status" data-no-rigs>
		This project has no rig yet: make one in
		<a class="maker" href={resolve('/rigger')}>Rigger ↗</a>
	</p>
{/if}

{#each shown as rig (rig.name)}
	<div class="rig" data-rig-facts={rig.name} data-rig-state={rig.state}>
		<p class="rig-head">
			<code>{rig.name}</code>
			<a
				class="maker"
				data-rigger-link
				href={resolve(riggerLinkFor(rig.name, projectKey || undefined) as '/')}>Rigger ↗</a
			>
			{#if rig.state === 'reading'}
				<span class="dim">reading…</span>
			{:else}
				{#if rig.state === 'failed'}<span class="err-text">{rig.why}</span>{/if}
				<button
					class="btn"
					type="button"
					data-rig-again
					title="Read the rig again, as it is saved now"
					onclick={() => rigs.again(rig.name)}>Read again</button
				>
			{/if}
		</p>
		{#if rig.state === 'read'}
			{@const verdict = rigCostVerdict(rig.facts.cost)}
			<p class="cost" data-rig-cost={verdict.level}>
				<span
					class="pill"
					class:ok={verdict.level === 'light'}
					class:warn={verdict.level === 'heavy'}
					class:bad={verdict.level === 'tooHeavy'}
					title={verdict.text}>{RIG_COST_LEVEL_LABELS[verdict.level]}</span
				>
				<span data-rig-cost-line>{rigCostLine(rig.facts.cost)}</span>
				<InfoTip>{RIG_COST_TIP}</InfoTip>
				<span class="dim">{verdict.text}</span>
			</p>
			<dl class="facts">
				<dt>Animations</dt>
				<dd data-rig-animations>
					{#each rig.facts.animations as animation (animation.name)}
						<code class="chip">{animationLabel(animation)}</code>
					{:else}none{/each}
				</dd>
				<dt>Skins</dt>
				<dd data-rig-skins>
					{#each rig.facts.skins as skin (skin)}<code class="chip">{skin}</code>{:else}none{/each}
				</dd>
			</dl>
		{/if}
	</div>
{/each}

{#if source}
	<h3>
		A rig per facing
		<InfoTip>
			A facing with a rig of its own (a front and a back rig) draws that rig as made, even one the
			view would mirror. A facing with none draws the one rig.
		</InfoTip>
	</h3>
	<table class="rows" data-rig-facings>
		<tbody>
			{#each facings as row (row.facing)}
				<tr data-rig-facing={row.facing}>
					<th scope="row">{row.facing}</th>
					<td>
						<RigSelect
							rigs={read.rigs}
							value={row.own ?? ''}
							blank={source.rig ? `the one rig (${source.rig})` : 'none'}
							label={`The rig of facing ${row.facing}`}
							disabled={readOnly || !read.read}
							onPick={(rig) => run((d) => setFacingRig(d, id, row.facing, rig))}
						/>
					</td>
					<td class="dim">
						{row.undrawn
							? 'the view has no such facing: never drawn'
							: row.mirrored && !row.own
								? 'mirrored from its twin'
								: ''}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h3>
		Variants
		<InfoTip>
			A skin of the rig worn while a status holds (Salmons' golden salmon while it is
			<code>marked</code>): the first whose status holds and that the rig has.
		</InfoTip>
	</h3>
	<table class="rows" data-variants>
		<thead><tr><th>While</th><th>Skin</th><th></th></tr></thead>
		<tbody>
			{#each variants as [status, skin] (status)}
				<tr data-variant={status}>
					<td>
						<input
							aria-label={`Status of the variant "${status}"`}
							value={status}
							list="sheet-statuses"
							spellcheck="false"
							disabled={readOnly}
							onchange={(e) => {
								const next = e.currentTarget.value;
								if (!run((d) => sheets.renameVariant(d, id, status, next)))
									settle(e.currentTarget, status);
							}}
						/>
					</td>
					<td>
						<select
							aria-label={`Skin of the variant "${status}"`}
							value={skin}
							disabled={readOnly}
							onchange={(e) => {
								const next = e.currentTarget.value;
								if (!run((d) => sheets.setVariantPrefix(d, id, status, next)))
									settle(e.currentTarget, skin);
							}}
						>
							{#if !skins.includes(skin)}<option value={skin}>{skin} (not read in the rig)</option
								>{/if}
							{#each skins as option (option)}<option value={option}>{option}</option>{/each}
						</select>
					</td>
					<td>
						<IconButton
							icon="trash"
							label={`Remove the variant "${status}"`}
							danger
							disabled={readOnly}
							onclick={() => run((d) => sheets.removeVariant(d, id, status))}
						/>
					</td>
				</tr>
			{/each}
			<tr>
				<td>
					<input
						bind:value={newStatus}
						data-new-variant-status
						aria-label="Status of a new variant"
						list="sheet-statuses"
						placeholder="marked"
						spellcheck="false"
						disabled={readOnly}
					/>
				</td>
				<td>
					<select
						bind:value={newSkin}
						data-new-variant-skin
						aria-label="Skin of a new variant"
						disabled={readOnly || !skins.length}
					>
						<option value="">{skins.length ? 'Pick a skin…' : 'The rig has no skin'}</option>
						{#each skins as option (option)}<option value={option}>{option}</option>{/each}
					</select>
				</td>
				<td>
					<button
						class="btn"
						type="button"
						data-add-variant
						disabled={readOnly || !newStatus.trim() || !newSkin}
						onclick={() => {
							if (run((d) => sheets.addVariant(d, id, newStatus, newSkin))) {
								newStatus = '';
								newSkin = '';
							}
						}}>Add variant</button
					>
				</td>
			</tr>
		</tbody>
	</table>
{/if}
{#if refused}<p class="err" data-rig-refused>{refused}</p>{/if}

<style>
	.rig-body {
		margin-top: 12px;
	}
	.rig {
		margin-top: 10px;
		padding: 8px 10px;
		border: 1px solid #23232c;
		border-radius: 8px;
		background: #111117;
		font-size: 12px;
	}
	.rig-head,
	.cost {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0 0 6px;
	}
	.cost {
		color: #cbd5e1;
	}
	.rig .facts {
		margin-top: 4px;
	}
	.chip {
		display: inline-block;
		margin: 0 4px 4px 0;
		padding: 1px 6px;
		border: 1px solid #23232c;
		border-radius: 6px;
	}
	.dim {
		color: #8b8b98;
	}
	.err-text {
		color: #ff9a9a;
	}
	.pill.bad {
		border-color: #6b2a2a;
		color: #ff9a9a;
	}
	th[scope='row'] {
		text-transform: uppercase;
		color: #cbd5e1;
	}
</style>
