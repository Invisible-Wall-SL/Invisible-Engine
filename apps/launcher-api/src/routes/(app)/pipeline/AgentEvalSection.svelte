<script lang="ts">
	import type { AgentEvalCheck } from '$lib/server/pipelineChanges';
	import Pill from './Pill.svelte';
	import {
		evalCell,
		evalCostText,
		evalPill,
		evalRows,
		evalSetText,
		evalSideText,
		money,
		plural,
		safeHref,
	} from './view';

	let { check }: { check: AgentEvalCheck } = $props();

	const ITEMS_SHOWN = 20;

	/** `null` until the reader chooses: then it follows whether anything changed. */
	let changedChoice = $state<boolean | null>(null);
	let showAll = $state(false);

	const pill = $derived(evalPill(check));
	const ready = $derived(check.report.state === 'ready' ? check.report : null);
	const notReady = $derived(check.report.state !== 'ready' ? check.report : null);
	const report = $derived(ready ? ready.report : null);
	const items = $derived(report ? report.items : []);
	const changedCount = $derived(items.filter((i) => i.changed).length);
	const changedOnly = $derived(changedChoice ?? changedCount > 0);
	const listed = $derived(changedOnly ? items.filter((i) => i.changed) : items);
	const visible = $derived(showAll ? listed : listed.slice(0, ITEMS_SHOWN));
	const rows = $derived(report ? evalRows(report) : []);
	// The run's page is the one the launcher verified; the status's own link only beside it.
	const runUrl = $derived(safeHref(check.run?.url));
	const statusUrl = $derived(check.run ? safeHref(check.status?.url) : null);
	const url = $derived(runUrl ?? statusUrl);
</script>

<section class="card" aria-labelledby="agent-eval">
	<div class="card-head">
		<h3 id="agent-eval">Agent evaluation</h3>
		<Pill tone={pill.tone} large>{pill.label}</Pill>
	</div>
	<p class="dim">
		When the agent has a reference set, the edited definition and main's version of it run on the
		same reference mockups, and each is scored against the expected breakdown.
	</p>

	{#if check.blocking}
		<div class="callout red" role="alert">
			{check.blocking}
			{#if url}<a href={url} target="_blank" rel="external noopener">Details ↗</a>{/if}
		</div>
	{/if}

	{#if notReady}
		<p class="detail">
			{notReady.detail}
			{#if runUrl}<a href={runUrl} target="_blank" rel="external noopener">View the run ↗</a>{/if}
			{#if statusUrl && statusUrl !== runUrl}
				<a href={statusUrl} target="_blank" rel="external noopener">agent-eval status ↗</a>
			{/if}
		</p>
	{/if}

	{#if report}
		<p class="dim line">{report.line}</p>

		{#if report.errors.length}
			<ul class="errors" aria-label="Evaluation errors">
				{#each report.errors as e, i (`${i}:${e}`)}
					<li>{e}</li>
				{/each}
			</ul>
		{/if}

		{#if report.result === 'no-eval-set'}
			<p class="dim">
				This agent has no reference set yet, so there was nothing to compare and nothing was spent.
			</p>
		{/if}

		{#if report.result === 'scored'}
			<div class="scroll">
				<table class="summary">
					<thead>
						<tr>
							<th scope="col" class="first"><span class="sr">Measure</span></th>
							<th scope="col" class="num">
								Before (main)
								<span class="side">{evalSideText(report.before)}</span>
							</th>
							<th scope="col" class="num">
								After (this change)
								<span class="side">{evalSideText(report.after)}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r (r.label)}
							<tr class:strong={r.label === 'Score'}>
								<th scope="row" class="first">{r.label}</th>
								<td class="num">{r.before}</td>
								<td class="num">{r.after}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<p class="facts">
			<span>
				Reference set <strong>{evalSetText(report.set)}</strong>
			</span>
			<span>
				Spent <strong class:over={report.capped}>{evalCostText(report)}</strong>
				{#if report.capped}<strong class="over">capped</strong>{/if}
			</span>
			{#if report.capped}
				<span class="dim"
					>The run stopped at the cap; the most it can spend is {money(report.capUsd)}.</span
				>
			{/if}
		</p>

		{#if items.length}
			<div class="items">
				<div class="items-head">
					<span class="label">
						Elements · {changedCount} of {items.length} changed
					</span>
					<label class="toggle">
						<input
							type="checkbox"
							checked={changedOnly}
							onchange={(e) => {
								changedChoice = e.currentTarget.checked;
								showAll = false;
							}}
						/>
						Show changed only
					</label>
				</div>

				{#if !listed.length}
					<p class="dim">Both definitions answered every element the same way.</p>
				{:else}
					<div class="scroll">
						<table class="grid">
							<thead>
								<tr>
									<th scope="col" class="first">Element</th>
									<th scope="col">Expected</th>
									<th scope="col">Before</th>
									<th scope="col">After</th>
								</tr>
							</thead>
							<tbody>
								{#each visible as item (`${item.image}:${item.n}`)}
									{@const before = evalCell(item.before)}
									{@const after = evalCell(item.after)}
									<tr class:changed={item.changed}>
										<td class="first">
											<span class="el">#{item.n} {item.name}</span>
											<span class="sub">{item.image}</span>
										</td>
										<td>
											<span class="el">{item.expected.status}</span>
											<span class="sub">
												{item.expected.regions.length
													? item.expected.regions.join(', ')
													: 'no regions'}
											</span>
										</td>
										<td class={before.tone}>
											<span class="el">{before.text}</span>
											{#if before.detail}<span class="sub">{before.detail}</span>{/if}
										</td>
										<td class={after.tone}>
											<span class="el">{after.text}</span>
											{#if after.detail}<span class="sub">{after.detail}</span>{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if listed.length > ITEMS_SHOWN}
						<div class="table-foot">
							<button type="button" class="btn" onclick={() => (showAll = !showAll)}>
								{showAll ? 'Show fewer' : `Show all ${listed.length}`}
							</button>
							<span class="dim">
								{listed.length}
								{plural(listed.length, 'element')} listed
							</span>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</section>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
	}
	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: #e8e8ee;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #c9c9d1;
	}
	.dim {
		color: #9a9aa6;
	}
	.line {
		font-size: 12px;
	}
	.detail a {
		margin-left: 6px;
	}
	a {
		color: #7ee0c0;
	}
	a:hover {
		color: #a8f0d8;
	}
	a:focus-visible,
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.callout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 10px 14px;
		border: 1px solid;
		border-radius: 10px;
		font-size: 13px;
	}
	.callout.red {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.callout.red a {
		color: #ffc2c2;
	}
	.errors {
		margin: 0;
		padding: 10px 14px 10px 30px;
		background: #2a1416;
		border: 1px solid #6b2f33;
		border-radius: 10px;
		color: #ff9d9d;
		font-size: 12px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		font-size: 12px;
		color: #9a9aa6;
	}
	.facts strong {
		color: #e8e8ee;
	}
	.facts strong.over {
		color: #ff9d9d;
	}
	.label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 4px;
		border-top: 1px solid #1d1d24;
	}
	.items-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding-top: 10px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #c9c9d1;
		cursor: pointer;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	table.summary {
		min-width: 420px;
	}
	table.grid {
		min-width: 620px;
	}
	th {
		padding: 6px 8px;
		border-bottom: 1px solid #23232e;
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	.side {
		display: block;
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		color: #9a9aa6;
	}
	.summary tbody th {
		border-bottom: 1px solid #1d1d24;
		font-size: 13px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: #c9c9d1;
	}
	td {
		padding: 9px 8px;
		border-bottom: 1px solid #1d1d24;
		vertical-align: top;
		color: #c9c9d1;
	}
	th.first,
	td.first {
		padding-left: 0;
	}
	th.num,
	td.num {
		text-align: right;
	}
	tbody tr:last-child td,
	tbody tr:last-child th {
		border-bottom: 0;
	}
	tr.strong th,
	tr.strong td {
		font-weight: 700;
		color: #e8e8ee;
	}
	.grid th.first,
	.grid td.first {
		padding-left: 10px;
	}
	.grid tr.changed td.first {
		box-shadow: inset 3px 0 0 #f5b95c;
	}
	.grid tr.changed {
		background: #1b1810;
	}
	.el {
		display: block;
		overflow-wrap: anywhere;
	}
	.sub {
		display: block;
		font-size: 11px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	td.green .el {
		color: #7ee787;
	}
	td.amber .el {
		color: #f5b95c;
	}
	td.red .el {
		color: #ff9d9d;
	}
	td.muted .el {
		color: #9a9aa6;
	}
	.table-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 0 14px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.btn:hover {
		background: #23232e;
		border-color: #3a3a48;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
