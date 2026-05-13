<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'COMM/EAGaming Probe',
		parameters: {
			docs: {
				description: {
					component:
						'Live probe for the EAGaming `/game/engine` protocol. Configure a sid + base URL, fire actions, watch the response. CORS will block browser requests to a public host — run the dev server behind a Vite proxy or hit a permissive endpoint.',
				},
			},
		},
	});
</script>

<script lang="ts">
	import {
		buildBetActions,
		buildSingleAction,
		createEAGamingFetcher,
		createEAGamingSessionState,
		translateBetResponse,
		type EAGamingPostResult,
	} from 'rgs-translator-eagaming';

	type LogEntry = {
		label: string;
		result: EAGamingPostResult;
		translated?: unknown;
		ts: number;
	};

	// Default to the Vite dev proxy ('/eag' → https://eagaming.com) configured in
	// apps/hotfruits/.storybook/main.ts. Switch to the absolute URL only if you've
	// arranged CORS another way (or you're hitting a permissive endpoint).
	let baseUrl = $state('/eag');
	let sid = $state('');
	let cookie = $state('');
	let startSeq = $state(0);
	let amount = $state(5);
	let extra = $state(2);
	let customAction = $state('authenticate');
	let log = $state<LogEntry[]>([]);
	let busy = $state(false);

	const session = $derived(createEAGamingSessionState(sid, startSeq));
	const fetcher = $derived(createEAGamingFetcher({ baseUrl, sid }, session));
	const headers = $derived(cookie ? { Cookie: cookie } : undefined);

	const push = (label: string, result: EAGamingPostResult, translated?: unknown) => {
		log = [{ label, result, translated, ts: Date.now() }, ...log];
	};

	const guard = (run: () => Promise<void>) => async () => {
		if (!sid || !baseUrl) {
			alert('sid and baseUrl are required');
			return;
		}
		busy = true;
		try {
			await run();
		} catch (e) {
			push('error', {
				status: 0,
				statusText: String(e),
				url: '',
				requestBody: [],
				requestSeq: -1,
				response: null,
				rawText: '',
			});
		} finally {
			busy = false;
		}
	};

	const fireBetPlay = guard(async () => {
		const body = buildBetActions({ amount, mode: 'BASE', currency: 'USD', contextExtras: [extra] });
		const result = await fetcher.post({ body, headers });
		push(
			'bet+play',
			result,
			result.response ? translateBetResponse(result.response) : undefined,
		);
	});

	const fireEmpty = guard(async () => {
		const result = await fetcher.post({ body: [], headers });
		push('empty []', result);
	});

	const fireSingle = guard(async () => {
		const result = await fetcher.post({
			body: buildSingleAction(customAction.trim()),
			headers,
		});
		push(`single: ${customAction}`, result);
	});

	const reset = () => {
		log = [];
		session.reset(startSeq);
	};
</script>

<div class="probe">
	<header>
		<h2>EAGaming Protocol Probe</h2>
		<p>
			Sends batched-action POSTs to <code>{baseUrl}/game/engine</code>. Use this to
			reverse-engineer response shapes before wiring the translator into a real game.
		</p>
	</header>

	<section class="config">
		<label>
			Base URL
			<input bind:value={baseUrl} placeholder="https://eagaming.com" />
		</label>
		<label>
			SID
			<input bind:value={sid} placeholder="S170da901147" />
		</label>
		<label>
			Cookie header (optional)
			<input bind:value={cookie} placeholder="paste full Cookie header" />
		</label>
		<label>
			Start seq
			<input type="number" bind:value={startSeq} />
		</label>
	</section>

	<section class="actions">
		<fieldset>
			<legend>bet + play (observed shape)</legend>
			<label>amount <input type="number" bind:value={amount} /></label>
			<label>extra <input type="number" bind:value={extra} /></label>
			<button onclick={fireBetPlay} disabled={busy}>fire</button>
		</fieldset>

		<fieldset>
			<legend>empty body</legend>
			<button onclick={fireEmpty} disabled={busy}>fire []</button>
		</fieldset>

		<fieldset>
			<legend>single arbitrary action</legend>
			<label>action <input bind:value={customAction} /></label>
			<button onclick={fireSingle} disabled={busy}>fire</button>
		</fieldset>

		<button class="reset" onclick={reset}>clear log + reset seq</button>
	</section>

	<section class="log">
		<h3>Log ({log.length})</h3>
		{#each log as entry (entry.ts)}
			<article class:ok={entry.result.status >= 200 && entry.result.status < 300}>
				<header>
					<strong>{entry.label}</strong>
					<span>seq={entry.result.requestSeq}</span>
					<span>{entry.result.status} {entry.result.statusText}</span>
					<span>{entry.result.url}</span>
				</header>
				<details>
					<summary>request body</summary>
					<pre>{JSON.stringify(entry.result.requestBody, null, 2)}</pre>
				</details>
				<details open>
					<summary>response</summary>
					<pre>{entry.result.response
							? JSON.stringify(entry.result.response, null, 2)
							: entry.result.rawText || '(empty)'}</pre>
				</details>
				{#if entry.translated}
					<details>
						<summary>translated → Stake shape</summary>
						<pre>{JSON.stringify(entry.translated, null, 2)}</pre>
					</details>
				{/if}
			</article>
		{/each}
	</section>
</div>

<style>
	.probe {
		font-family: ui-sans-serif, system-ui, sans-serif;
		padding: 1rem;
		max-width: 980px;
	}
	header h2 {
		margin: 0 0 0.25rem;
	}
	header p {
		color: #555;
		margin: 0 0 1rem;
	}
	.config {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem 1rem;
		margin-bottom: 1rem;
	}
	.config label {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		color: #333;
	}
	.config input {
		padding: 0.4rem;
		font-family: ui-monospace, monospace;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1.5rem;
		align-items: end;
	}
	fieldset {
		border: 1px solid #ddd;
		padding: 0.5rem 0.75rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	fieldset label {
		display: flex;
		flex-direction: column;
		font-size: 0.75rem;
	}
	fieldset input {
		padding: 0.3rem;
		width: 7rem;
		font-family: ui-monospace, monospace;
	}
	button {
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		background: #2563eb;
		color: white;
		border: none;
		border-radius: 4px;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button.reset {
		background: #6b7280;
	}
	.log h3 {
		margin: 0 0 0.5rem;
	}
	.log article {
		border: 1px solid #e5e7eb;
		border-left: 4px solid #ef4444;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
		background: #fafafa;
	}
	.log article.ok {
		border-left-color: #10b981;
	}
	.log article header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.8rem;
		color: #444;
		margin-bottom: 0.4rem;
	}
	pre {
		background: #111;
		color: #e5e7eb;
		padding: 0.5rem;
		font-size: 0.75rem;
		overflow: auto;
		max-height: 320px;
		margin: 0.25rem 0 0;
	}
	details summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: #2563eb;
	}
</style>

<Story name="probe" />
