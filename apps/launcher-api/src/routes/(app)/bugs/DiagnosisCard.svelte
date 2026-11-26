<script lang="ts">
	import {
		MAX_BUILD_NOTE,
		type FixFacts,
		type FixOptionId,
		type FixRunView,
	} from '$lib/bugFixRuns';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import { NetworkLost, describe, newRequestId, resend } from '../director/director.client';
	import Pill from '../pipeline/Pill.svelte';
	import { timeAgo } from '../pipeline/view';
	import { buildButton, choiceText, noteCounter } from './fixView';

	/**
	 * The diagnosis a fix run offered (ADR-0014 §1): what was reported, what causes it, and the
	 * options to choose from. Nothing is pre-selected; Build starts only on a person's click. Every
	 * word here came from a run: rendered as text. The server checks every rule again.
	 */
	let {
		number,
		diagnosis,
		build,
		facts,
		now,
		onchanged,
	}: {
		number: number;
		/** The bug's current diagnosis: its newest diagnose run, ended `diagnosed`. */
		diagnosis: FixRunView;
		/** The newest build run made from it, once a person has chosen. */
		build: FixRunView | null;
		facts: FixFacts;
		now: number;
		/** A build started or was refused as stale: read the bug again. */
		onchanged: () => void;
	} = $props();

	const found = $derived(diagnosis.diagnosis);
	let picked = $state<FixOptionId | null>(null);
	let note = $state('');
	let posting = $state(false);
	let failure = $state<string | null>(null);
	let requestId: string | null = null;

	const button = $derived(found ? buildButton(facts, found.options, picked) : null);
	const chosen = $derived(build?.chosenOption ?? null);

	async function startBuild(): Promise<void> {
		if (posting || !picked || button?.kind !== 'ready') return;
		posting = true;
		failure = null;
		requestId ??= newRequestId();
		try {
			await resend(`/api/bugs/${number}/fix-runs/${diagnosis.id}/build`, {
				optionId: picked,
				note: note.trim() || undefined,
				requestId,
			});
			requestId = null;
			onchanged();
		} catch (e) {
			if (!(e instanceof NetworkLost)) requestId = null;
			failure = describe(e);
			if (!(e instanceof NetworkLost)) onchanged();
		} finally {
			posting = false;
		}
	}
</script>

{#if found}
	<SectionCard scope="bugs" id="diagnosis" title="Diagnosis">
		{#snippet info()}
			What the diagnosis run found and the ways to settle the bug. It changed nothing. A build
			starts only when you choose an option, and the next diagnosis replaces this one.
		{/snippet}
		<div class="diag">
			<div class="kind">
				<Pill tone={found.kind === 'defect' ? 'blue' : 'amber'} tag>
					{found.kind === 'defect' ? 'Defect' : 'Decision'}
				</Pill>
				<InfoTip>
					A defect is code doing something wrong, with one right fix. A decision has several
					reasonable answers, and choosing between them is a product call.
				</InfoTip>
			</div>
			<section>
				<h4>What was reported</h4>
				<p>{found.reported}</p>
			</section>
			<section>
				<h4>What is causing it</h4>
				<p>{found.cause}</p>
			</section>
			<details class="evidence">
				<summary>Evidence</summary>
				<p>{found.evidence}</p>
			</details>

			{#if chosen}
				<div class="chosen" role="status">
					<strong>{choiceText(chosen)}</strong>
					<span class="dim">
						by {chosen.decidedBy} · {timeAgo(chosen.decidedAt, now)}. The next diagnosis replaces
						this one.
					</span>
					{#if chosen.note}<p class="note">Note: {chosen.note}</p>{/if}
				</div>
			{/if}

			<fieldset class="options" disabled={posting || !facts.canBuild}>
				<legend>Options</legend>
				{#each found.options as option (option.id)}
					{@const recommended = found.recommendation.option === option.id}
					<label class="option" class:on={picked === option.id}>
						<input
							type="radio"
							name="option-{diagnosis.id}"
							value={option.id}
							checked={picked === option.id}
							onchange={() => (picked = option.id)}
						/>
						<span class="body">
							<span class="title">
								<strong>{option.id} — {option.name}</strong>
								{#if recommended}<Pill tone="green" tag>Recommended</Pill>{/if}
							</span>
							<dl>
								<dt>What changes</dt>
								<dd>{option.change}</dd>
								<dt>Cost</dt>
								<dd>{option.cost}</dd>
								<dt>Risk</dt>
								<dd>{option.risk}</dd>
								<dt>What the player notices</dt>
								<dd>{option.player}</dd>
							</dl>
							{#if recommended}<span class="why">Why: {found.recommendation.why}</span>{/if}
						</span>
					</label>
				{/each}
			</fieldset>

			{#if button}
				<label class="field">
					<span>Note for the build (optional)</span>
					<textarea
						bind:value={note}
						maxlength={MAX_BUILD_NOTE}
						rows="3"
						disabled={posting || !facts.canBuild}
					></textarea>
					<span class="dim count">{noteCounter(note)}</span>
				</label>
				<div class="actions">
					<button
						type="button"
						class="btn primary"
						disabled={button.kind !== 'ready' || posting}
						onclick={startBuild}
					>
						{posting ? 'Starting the build…' : button.label}
					</button>
					{#if button.kind === 'blocked'}<span class="dim">{button.why}</span>{/if}
				</div>
				{#if failure}<div class="error" role="alert">{failure}</div>{/if}
			{/if}
		</div>
	</SectionCard>
{/if}

<style>
	.diag {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}
	.kind {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	h4 {
		margin: 0 0 4px;
		font-size: 12px;
		letter-spacing: 0.04em;
		color: #b9b9c4;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #e8e8ee;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.evidence summary {
		cursor: pointer;
		font-size: 12px;
		font-weight: 700;
		color: #b9b9c4;
	}
	.evidence p {
		margin-top: 6px;
		color: #b9b9c4;
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: none;
		min-width: 0;
	}
	legend {
		padding: 0 0 6px;
		font-size: 12px;
		font-weight: 700;
		color: #b9b9c4;
	}
	.option {
		display: flex;
		gap: 10px;
		padding: 12px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 10px;
		cursor: pointer;
	}
	.option.on {
		border-color: #2b8d6f;
		background: #112219;
	}
	.option input {
		margin-top: 3px;
	}
	.option:has(input:focus-visible) {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		font-size: 13px;
		color: #e8e8ee;
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		overflow-wrap: anywhere;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 12px;
		margin: 0;
	}
	dt {
		font-size: 12px;
		color: #9a9aa6;
	}
	dd {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.why {
		font-size: 12px;
		color: #a6f0cf;
		overflow-wrap: anywhere;
	}
	.chosen {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		background: #112219;
		border: 1px solid #2b8d6f;
		border-radius: 10px;
		color: #a6f0cf;
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.chosen .note {
		color: #e8e8ee;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	textarea {
		padding: 8px 10px;
		background: #0f0f14;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 13px;
		resize: vertical;
	}
	.count {
		align-self: flex-end;
	}
	.dim {
		font-size: 12px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		padding: 0 12px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.btn.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.btn:hover:not(:disabled) {
		background: #26846a;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.btn:focus-visible,
	textarea:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.error {
		padding: 10px 12px;
		background: #2a1416;
		border: 1px solid #6b2f33;
		border-radius: 10px;
		color: #ff9d9d;
		font-size: 13px;
	}
</style>
