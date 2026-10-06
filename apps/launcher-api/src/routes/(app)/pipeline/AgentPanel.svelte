<script lang="ts">
	import { untrack } from 'svelte';
	import { WHY_MAX, agentPath, validateAgentEdit, whyProblem } from '$lib/agentEdit';
	import { askConfirm } from '$lib/dialogs.svelte';
	import type { AgentChangeResult, AgentDetail } from '$lib/server/pipelineAgents';
	import { EVAL_CAP_USD } from '../../../../../../services/director-worker/src/eval/report';
	import Pill from './Pill.svelte';
	import {
		agentChangeTitle,
		apiErrorText,
		charsWord,
		effortLabel,
		effortWord,
		errorListOf,
		firstLine,
		plural,
		safeHref,
		shortSha,
		statusPill,
		timeAgo,
		toolsWord,
	} from './view';

	let {
		detail,
		canMerge,
		now,
		onreload,
		onopenchange,
		dirty = $bindable(false),
	}: {
		detail: AgentDetail;
		canMerge: boolean;
		now: number;
		/** Re-reads the agent and the list; resolves what it read, or `null` when it could not. */
		onreload: () => Promise<AgentDetail | null>;
		/** Shows a pull request in the Changes tab. */
		onopenchange: (number: number) => void;
		/** Whether the editor holds text that is not yet open as a change. */
		dirty?: boolean;
	} = $props();

	type Outcome =
		| { kind: 'ok'; result: AgentChangeResult }
		| { kind: 'invalid'; message: string; errors: string[] }
		| { kind: 'conflict'; message: string }
		| { kind: 'kept' }
		| { kind: 'error'; message: string };

	/**
	 * The text the editor started from. A refresh moves `detail` on, but an edit is proposed against
	 * what it was made from, so the base only moves when the reader reloads.
	 */
	let base = $state(untrack(() => ({ text: detail.text, blobSha: detail.blobSha })));
	let text = $state(untrack(() => detail.text));
	let why = $state('');
	let busy = $state(false);
	let reloading = $state(false);
	let outcome = $state<Outcome | null>(null);
	/** The text last opened as a change: submitting it again would open a second one. */
	let submittedText = $state<string | null>(null);
	/** The request id of an attempt that got no definite answer, with what it sent. */
	let attempt: { id: string; key: string } | null = null;

	const verdict = $derived(validateAgentEdit(detail.name, text, detail.rules));
	const unchanged = $derived(text === base.text);
	const stale = $derived(detail.blobSha !== base.blobSha);
	const whyError = $derived(whyProblem(why));
	const alreadyOpen = $derived(submittedText !== null && text === submittedText);
	const canSubmit = $derived(
		canMerge && verdict.ok && !unchanged && !whyError && !busy && !stale && !alreadyOpen,
	);
	const hint = $derived(
		stale
			? 'Reload first: main has a newer version of this definition.'
			: alreadyOpen
				? 'This text is already open as a change.'
				: unchanged
					? 'Change the definition to submit it.'
					: !verdict.ok
						? 'Fix the validation errors first.'
						: null,
	);
	const lastUrl = $derived(safeHref(detail.lastChange?.url));

	$effect(() => {
		dirty = !unchanged && !alreadyOpen;
	});

	const isChangeResult = (v: unknown): v is AgentChangeResult =>
		typeof v === 'object' && v !== null && typeof (v as { number?: unknown }).number === 'number';

	interface Sent {
		outcome: Outcome;
		/** The server answered for good: a retry is a new request. */
		spent: boolean;
	}

	async function send(payload: {
		requestId: string;
		baseSha: string;
		text: string;
		why: string;
	}): Promise<Sent> {
		let res: Response;
		try {
			res = await fetch(`/api/pipeline/agents/${encodeURIComponent(detail.name)}/changes`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
		} catch {
			return {
				outcome: {
					kind: 'error',
					message:
						'The launcher could not be reached. Submit again: the same request is sent, so a change that was opened is not opened twice.',
				},
				spent: false,
			};
		}
		const body: unknown = await res.json().catch(() => null);
		if (res.ok) {
			if (isChangeResult(body)) return { outcome: { kind: 'ok', result: body }, spent: true };
			return {
				outcome: { kind: 'error', message: 'The launcher answered without a change number.' },
				spent: false,
			};
		}
		const message = apiErrorText(res.status, body);
		if (res.status === 400) {
			return { outcome: { kind: 'invalid', message, errors: errorListOf(body) }, spent: true };
		}
		if (res.status === 409) return { outcome: { kind: 'conflict', message }, spent: true };
		return { outcome: { kind: 'error', message }, spent: res.status >= 400 && res.status < 500 };
	}

	async function submit(): Promise<void> {
		if (!canSubmit) return;
		busy = true;
		try {
			const reason = why.trim();
			const ok = await askConfirm({
				title: `Open a pipeline change for ${detail.name}?`,
				message: [
					`A branch agents/${detail.name}-… gets one commit that changes ${agentPath(detail.name)}, and a pull request titled “${agentChangeTitle(detail.name, reason)}” is opened.`,
					`Its evaluation runs the edited and the current definition on the reference set and spends up to $${EVAL_CAP_USD}.`,
					'It merges only after every check passes and someone allowed to merge approves it.',
				].join('\n\n'),
				confirmLabel: 'Open the change',
			});
			if (!ok) return;
			const sent = text;
			const key = JSON.stringify([base.blobSha, sent, reason]);
			const id = attempt?.key === key ? attempt.id : crypto.randomUUID();
			attempt = { id, key };
			outcome = null;
			const answer = await send({ requestId: id, baseSha: base.blobSha, text: sent, why: reason });
			outcome = answer.outcome;
			if (answer.spent) attempt = null;
			if (answer.outcome.kind === 'ok') {
				submittedText = sent;
				void onreload();
			}
		} finally {
			busy = false;
		}
	}

	async function reload(): Promise<void> {
		if (busy || reloading) return;
		reloading = true;
		try {
			const next = await onreload();
			if (!next) {
				outcome = { kind: 'error', message: 'The definition could not be read again. Try again.' };
				return;
			}
			if (next.blobSha === base.blobSha) {
				outcome = { kind: 'kept' };
				return;
			}
			if (
				!unchanged &&
				!alreadyOpen &&
				!(await askConfirm({
					title: `Replace your edits to ${detail.name}?`,
					message: 'Main has a newer version of this definition. Your text is not saved anywhere.',
					confirmLabel: 'Replace',
					danger: true,
				}))
			) {
				return;
			}
			base = { text: next.text, blobSha: next.blobSha };
			text = next.text;
			submittedText = null;
			attempt = null;
			outcome = null;
		} finally {
			reloading = false;
		}
	}
</script>

<div class="panel">
	{#if !detail.valid}
		<div class="callout red" role="alert">
			<strong>The definition on main does not load.</strong>
			{#each detail.errors as e, i (`${i}:${e}`)}
				<span class="err-line">{e}</span>
			{/each}
		</div>
	{/if}

	<section class="card" aria-label="Agent summary">
		<div class="head">
			<div class="titles">
				<span class="path">{agentPath(detail.name)}</span>
				<h2>{detail.name}</h2>
			</div>
			{#if detail.valid}
				<span class="badges">
					{#if detail.model}<Pill tone="muted" large>{detail.model}</Pill>{/if}
					<Pill tone="muted" large>{effortLabel(detail.effort)}</Pill>
					<Pill tone="muted" large>{toolsWord(detail.tools.length)}</Pill>
				</span>
			{/if}
		</div>
		{#if detail.role}<p>{detail.role}</p>{/if}
		<p class="byline">
			{#if detail.lastChange}
				Last change
				{#if lastUrl}
					<a class="mono" href={lastUrl} target="_blank" rel="external noopener"
						>{shortSha(detail.lastChange.sha)} ↗</a
					>
				{:else}
					<span class="mono">{shortSha(detail.lastChange.sha)}</span>
				{/if}
				“{firstLine(detail.lastChange.message)}” · {detail.lastChange.author || 'unknown'} · {timeAgo(
					detail.lastChange.date,
					now,
				)}
			{:else}
				No change recorded.
			{/if}
		</p>

		<div class="open-changes">
			<span class="label">Open changes · {detail.openChanges.length}</span>
			{#each detail.openChanges as c (c.number)}
				{@const pill = statusPill(c.status)}
				{@const changeUrl = safeHref(c.url)}
				<div class="open-change">
					<div class="oc-main">
						<span class="path">{c.branch}</span>
						<span class="oc-title">{c.title}</span>
						<span class="byline">
							{#if changeUrl}
								<a href={changeUrl} target="_blank" rel="external noopener">#{c.number} ↗</a>
							{:else}
								#{c.number}
							{/if}
						</span>
					</div>
					<div class="oc-side">
						<Pill tone={pill.tone} dot={pill.dot}>{pill.label}</Pill>
						{#if c.draft}<Pill tone="amber" tag>draft</Pill>{/if}
						<button type="button" class="btn" onclick={() => onopenchange(c.number)}>
							Open change
						</button>
					</div>
				</div>
			{:else}
				<p class="dim">No open change edits this definition.</p>
			{/each}
		</div>
	</section>

	<section class="card" aria-labelledby="agent-edit">
		<div class="card-head">
			<h3 id="agent-edit">Definition</h3>
			<span class="path">{agentPath(detail.name)}</span>
		</div>

		{#if !canMerge}
			<p class="dim">Editing needs the Merge pipeline changes capability.</p>
		{/if}

		{#if stale}
			<div class="callout amber" role="status">
				<span>
					Main has a newer version of this definition{#if detail.lastChange}
						({shortSha(detail.lastChange.sha)}, {timeAgo(detail.lastChange.date, now)}){/if}. Reload
					to edit the current version.
				</span>
				<button type="button" class="btn" disabled={reloading} onclick={reload}>
					{reloading ? 'Reloading…' : 'Reload'}
				</button>
			</div>
		{/if}

		<div class="editor">
			<div class="edit-col">
				<span class="label">Definition text</span>
				<textarea
					aria-label={`${detail.name} definition`}
					rows="28"
					spellcheck="false"
					autocomplete="off"
					readonly={!canMerge}
					bind:value={text}
				></textarea>
			</div>

			<aside class="validation" aria-label="Validation">
				<div class="v-head">
					<h4>Validation</h4>
					{#if verdict.ok}
						<Pill tone="green">Valid</Pill>
					{:else}
						<Pill tone="red">{verdict.errors.length} {plural(verdict.errors.length, 'error')}</Pill>
					{/if}
				</div>
				{#if unchanged}<p class="dim">Unchanged from main</p>{/if}
				{#if verdict.ok}
					{@const a = verdict.agent}
					<dl>
						<dt>Name</dt>
						<dd class="mono">{a.name}</dd>
						<dt>Model</dt>
						<dd class="mono">{a.model}</dd>
						<dt>Effort</dt>
						<dd>{effortWord(a.effort)}</dd>
						<dt>Tools</dt>
						<dd class="pills">
							{#each a.tools as tool (tool)}<Pill tone="muted">{tool}</Pill>{/each}
						</dd>
						<dt>Role</dt>
						<dd>{a.role}</dd>
						<dt>Inputs</dt>
						<dd>{a.inputs}</dd>
						<dt>Outputs</dt>
						<dd>{a.outputs}</dd>
						<dt>Prompt</dt>
						<dd>{charsWord(a.systemPrompt.length)}</dd>
					</dl>
				{:else}
					<ul class="errors">
						{#each verdict.errors as e, i (`${i}:${e}`)}
							<li>{e}</li>
						{/each}
					</ul>
				{/if}
			</aside>
		</div>

		{#if canMerge}
			<div class="submit">
				<label class="field">
					<span class="label">Why</span>
					<input
						type="text"
						bind:value={why}
						maxlength={WHY_MAX}
						placeholder="One line: why the definition changes"
						autocomplete="off"
					/>
				</label>
				<span class="why-hint" class:warn={why.length > 0 && whyError !== null}>
					{whyError ?? 'This becomes the pull request title.'}
					<span class="count">{why.length}/{WHY_MAX}</span>
				</span>
				<div class="actions">
					<button type="button" class="btn primary" disabled={!canSubmit} onclick={submit}>
						{busy ? 'Working…' : 'Submit as a pipeline change'}
					</button>
					{#if hint}<span class="dim">{hint}</span>{/if}
				</div>
				<p class="dim note">
					The change gets its own branch and an evaluation of the edited and the current definition
					on a fixed reference set; the evaluation spends up to ${EVAL_CAP_USD}. A failed or capped
					evaluation blocks the merge.
				</p>
			</div>
		{/if}

		{#if outcome?.kind === 'ok'}
			{@const result = outcome.result}
			{@const resultUrl = safeHref(result.url)}
			<div class="callout green" role="status">
				<span>
					{#if resultUrl}
						<a href={resultUrl} target="_blank" rel="external noopener">#{result.number} ↗</a>
					{:else}
						#{result.number}
					{/if}
					{result.created ? 'opened' : 'already open'} on
					<span class="mono">{result.branch}</span>.
				</span>
				<button type="button" class="btn" onclick={() => onopenchange(result.number)}>
					Open change
				</button>
			</div>
		{:else if outcome?.kind === 'invalid'}
			<div class="callout red" role="alert">
				<strong>
					{outcome.errors.length ? 'The launcher refused this definition:' : outcome.message}
				</strong>
				{#each outcome.errors as e, i (`${i}:${e}`)}
					<span class="err-line">{e}</span>
				{/each}
			</div>
		{:else if outcome?.kind === 'conflict'}
			<div class="callout amber" role="alert">
				<span>{outcome.message}</span>
				{#if !stale}
					<button type="button" class="btn" disabled={reloading} onclick={reload}>
						{reloading ? 'Reloading…' : 'Reload'}
					</button>
				{/if}
			</div>
		{:else if outcome?.kind === 'kept'}
			<div class="callout amber" role="status">
				Main still has the version you started from. Your edits are kept: submit again.
			</div>
		{:else if outcome?.kind === 'error'}
			<div class="callout red" role="alert">{outcome.message}</div>
		{/if}
	</section>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
	}
	.head,
	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.card-head {
		align-items: center;
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.path,
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
	}
	.path {
		font-size: 12px;
		color: #8a8a96;
		overflow-wrap: anywhere;
	}
	h2 {
		margin: 0;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 18px;
		font-weight: 700;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: #e8e8ee;
	}
	h4 {
		margin: 0;
		font-size: 13px;
		font-weight: 700;
		color: #e8e8ee;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #c9c9d1;
	}
	.badges {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.byline {
		color: #9a9aa6;
		font-size: 12px;
	}
	.dim {
		color: #9a9aa6;
	}
	.note {
		font-size: 12px;
	}
	a {
		color: #7ee0c0;
	}
	a:hover {
		color: #a8f0d8;
	}
	a:focus-visible,
	button:focus-visible,
	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
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
	.callout.amber {
		background: #2d2516;
		border-color: #5a4620;
		color: #f5b95c;
	}
	.callout.green {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}
	.callout.green a {
		color: #c8f0e0;
	}
	.err-line {
		flex-basis: 100%;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.open-changes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 4px;
		border-top: 1px solid #1d1d24;
	}
	.open-changes .label {
		padding-top: 10px;
	}
	.open-change {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		padding: 12px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 10px;
	}
	.oc-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.oc-title {
		font-size: 13px;
		font-weight: 700;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	.oc-side {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.editor {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		align-items: flex-start;
	}
	.edit-col {
		flex: 2 1 460px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		padding: 12px;
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #d8d8df;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		line-height: 1.55;
		resize: vertical;
		tab-size: 2;
	}
	textarea:read-only {
		color: #b9b9c4;
	}
	.validation {
		flex: 1 1 260px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 10px;
	}
	.v-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 8px 12px;
		margin: 0;
		font-size: 12px;
	}
	dt {
		color: #80808c;
	}
	dd {
		margin: 0;
		color: #c9c9d1;
		overflow-wrap: anywhere;
	}
	dd.mono {
		font-size: 12px;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.errors {
		margin: 0;
		padding-left: 18px;
		color: #ff9d9d;
		font-size: 12px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.submit {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 4px;
		border-top: 1px solid #1d1d24;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 10px;
	}
	input {
		box-sizing: border-box;
		width: 100%;
		min-height: 34px;
		padding: 0 12px;
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 13px;
	}
	.why-hint {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
		color: #9a9aa6;
	}
	.why-hint.warn {
		color: #f5b95c;
	}
	.count {
		flex: none;
		color: #80808c;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
	.actions .dim {
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
		text-decoration: none;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		background: #23232e;
		border-color: #3a3a48;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.btn.primary:hover:not(:disabled) {
		background: #26846a;
	}
</style>
