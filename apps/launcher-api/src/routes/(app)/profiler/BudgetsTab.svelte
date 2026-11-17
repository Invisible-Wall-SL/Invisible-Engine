<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		BUDGET_METRIC_DEFS,
		BUDGET_SCOPES,
		budgetKeyId,
		budgetRefusal,
		lineText,
		PROFILER_BUDGETS,
		type BudgetScope,
		type EffectiveBudget,
	} from '$lib/profilerBudgets';
	import IconButton from '$lib/ui/IconButton.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';

	interface Props {
		projectKey: string;
		budgets: EffectiveBudget[];
	}
	const { projectKey, budgets }: Props = $props();

	const SCOPE_TITLE: Record<BudgetScope, string> = {
		phone: 'Phone',
		tablet: 'Tablet',
		desktop: 'Desktop',
		all: 'Every device',
	};
	const PHASE_LABEL: Record<string, string> = {
		idle: 'idle',
		spinning: 'spinning',
		round: 'round',
		'': '',
	};

	const WHICH = ['warn', 'fail'] as const;

	/** What the editor has typed but not saved, per line; cleared when the line saves. */
	let drafts = $state<Record<string, { warn: string; fail: string }>>({});
	let busy = $state<string | null>(null);
	let notes = $state<Record<string, { error: boolean; text: string }>>({});

	const shown = (b: EffectiveBudget, which: 'warn' | 'fail') =>
		drafts[budgetKeyId(b)]?.[which] ?? (b[which] === null ? '' : String(b[which]));

	function edit(b: EffectiveBudget, which: 'warn' | 'fail', value: string): void {
		const id = budgetKeyId(b);
		drafts[id] = { warn: shown(b, 'warn'), fail: shown(b, 'fail'), [which]: value };
	}

	const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

	async function send(b: EffectiveBudget, body: Record<string, unknown>): Promise<void> {
		const id = budgetKeyId(b);
		busy = id;
		delete notes[id];
		try {
			const res = await fetch(resolve('/api/profiler/budgets'), {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					project: projectKey,
					deviceClass: b.deviceClass,
					metric: b.metric,
					phase: b.phase,
					expected: b.override?.rev ?? null,
					...body,
				}),
			});
			const out = (await res.json().catch(() => ({}))) as { message?: string };
			if (res.ok) {
				delete drafts[id];
			} else if (res.status === 409) {
				delete drafts[id];
				notes[id] = { error: true, text: out.message ?? 'Changed by someone else first.' };
			} else {
				notes[id] = { error: true, text: out.message ?? `Not saved (${res.status}).` };
			}
			await invalidate(PROFILER_BUDGETS);
		} catch {
			notes[id] = { error: true, text: 'Not saved — the launcher did not answer.' };
		} finally {
			busy = null;
		}
	}

	async function save(b: EffectiveBudget): Promise<void> {
		const id = budgetKeyId(b);
		const d = drafts[id];
		// Enter saves, then the field blurs: one PUT, or the second would meet its own new rev.
		if (!d || busy === id) return;
		const t = { warn: num(d.warn), fail: num(d.fail) };
		if (t.warn === b.warn && t.fail === b.fail) {
			delete drafts[id];
			return;
		}
		const refusal = budgetRefusal(b.metric, t);
		if (refusal) {
			notes[id] = { error: true, text: refusal };
			return;
		}
		await send(b, t);
	}

	function onKey(e: KeyboardEvent, b: EffectiveBudget): void {
		if (e.key === 'Enter') void save(b);
		if (e.key === 'Escape') {
			delete drafts[budgetKeyId(b)];
			delete notes[budgetKeyId(b)];
		}
	}

	const studioText = (b: EffectiveBudget) =>
		b.studio
			? [
					b.studio.warn !== null ? `warn ${lineText(b.metric, b.studio.warn)}` : null,
					b.studio.fail !== null ? `fail ${lineText(b.metric, b.studio.fail)}` : null,
				]
					.filter(Boolean)
					.join(' · ')
			: 'none';
</script>

{#each BUDGET_SCOPES as scope (scope)}
	{@const lines = budgets.filter((b) => b.deviceClass === scope)}
	<SectionCard scope="profiler" id="budgets-{scope}" title="{SCOPE_TITLE[scope]} budgets">
		{#snippet info()}
			<p>
				The lines this project's {scope === 'all' ? 'builds' : `${scope} readings`} are judged against.
				A value past its warn line is a warn, past its fail line a fail; a blank line is not checked.
				Type a value and press Enter (or leave the field) to set this project's own line; the reset button
				brings back the studio default. Everyone can edit these; if someone else saved the same line first,
				yours is not saved and theirs is shown.
				{#if scope === 'tablet'}The probe reports phones and desktops only for now, so no reading is
					judged as a tablet yet.{/if}
			</p>
		{/snippet}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Metric</th>
						<th class="num">Warn</th>
						<th class="num">Fail</th>
						<th>Studio default</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each lines as b (budgetKeyId(b))}
						{@const id = budgetKeyId(b)}
						{@const def = BUDGET_METRIC_DEFS[b.metric]}
						<tr class:overridden={!!b.override} class:dirty={!!drafts[id]}>
							<td>
								{def.label}{#if b.phase}<span class="sub phase">{PHASE_LABEL[b.phase]}</span>{/if}
								<div class="sub">
									{def.better === 'higher' ? 'below' : 'above'} the line is bad · from {def.from}
								</div>
							</td>
							{#each WHICH as which (which)}
								<td class="num">
									<label class="cell">
										<span class="op">{def.better === 'higher' ? '<' : '>'}</span>
										<input
											type="number"
											inputmode="decimal"
											step="any"
											min={def.min}
											max={def.max}
											aria-label="{SCOPE_TITLE[scope]} {def.label} {b.phase} {which} line"
											placeholder="—"
											value={shown(b, which)}
											disabled={busy === id}
											oninput={(e) => edit(b, which, e.currentTarget.value)}
											onkeydown={(e) => onKey(e, b)}
											onblur={() => save(b)}
										/>
										<span class="unit">{def.unit}</span>
									</label>
								</td>
							{/each}
							<td class="studio">
								{studioText(b)}
								{#if b.override}<span class="tag">project</span>{/if}
								{#if notes[id]}<div class="note" class:error={notes[id].error}>
										{notes[id].text}
									</div>{/if}
							</td>
							<td>
								{#if b.override}
									<IconButton
										icon="reset"
										label="Reset to the studio default"
										disabled={busy === id}
										onclick={() => send(b, { reset: true })}
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</SectionCard>
{/each}

<style>
	.sub {
		color: #8a8a99;
		font-size: 11px;
	}
	.phase {
		margin-left: 6px;
	}
	.table-wrap {
		overflow-x: auto;
	}
	th:first-child {
		width: 40%;
	}
	table {
		border-collapse: collapse;
		font-size: 12px;
		width: 100%;
	}
	th,
	td {
		padding: 5px 8px;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		vertical-align: top;
	}
	th {
		color: #a9a9b8;
		font-weight: 600;
		white-space: nowrap;
	}
	.num {
		text-align: right;
		white-space: nowrap;
	}
	.cell {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.op,
	.unit {
		color: #8a8a99;
		font-size: 11px;
	}
	.unit {
		min-width: 30px;
		text-align: left;
	}
	input {
		width: 72px;
		background: #16161e;
		color: #e8e8ee;
		border: 1px solid #2c2c38;
		border-radius: 6px;
		padding: 4px 6px;
		font: inherit;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tr.overridden input {
		border-color: #3b5bdb;
	}
	tr.dirty input {
		border-color: #ffb347;
	}
	.studio {
		color: #a9a9b8;
	}
	.tag {
		margin-left: 4px;
		font-size: 10px;
		color: #8ab4ff;
		border: 1px solid #3b5bdb;
		border-radius: 4px;
		padding: 0 4px;
	}
	.note {
		font-size: 11px;
		margin-top: 2px;
	}
	.note.error {
		color: #ff7b7b;
	}
</style>
