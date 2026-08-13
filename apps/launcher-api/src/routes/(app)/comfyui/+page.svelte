<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface StatusResp {
		configured: boolean;
		podStatus: 'running' | 'stopped' | 'starting' | 'unknown';
		comfyReady: boolean;
		idleEnabled: boolean;
		idleMinutes: number;
	}

	let status = $state<StatusResp | null>(null);
	// The user pressed Start and we're waiting for ComfyUI to answer (kept sticky
	// across polls so the "warming up" copy stays put until it's actually ready).
	let starting = $state(false);
	let startError = $state('');
	let busy = $state(false);

	// Phases derived from the polled status. `warming` covers both "resuming the pod"
	// and "pod is up but ComfyUI hasn't answered yet".
	const ready = $derived(status?.podStatus === 'running' && status.comfyReady === true);
	const warming = $derived(
		starting ||
			status?.podStatus === 'starting' ||
			(status?.podStatus === 'running' && status.comfyReady === false),
	);
	const stopped = $derived(
		!!status && !ready && !warming && (status.podStatus === 'stopped' || status.podStatus === 'unknown'),
	);

	// Once ComfyUI answers, drop the sticky "starting" flag.
	$effect(() => {
		if (ready) starting = false;
	});

	async function refresh(): Promise<void> {
		try {
			const res = await fetch('/comfyui/status');
			if (res.ok) status = (await res.json()) as StatusResp;
		} catch {
			// Transient — the next poll retries; keep the last known status on screen.
		}
	}

	async function start(): Promise<void> {
		if (busy) return;
		busy = true;
		startError = '';
		starting = true;
		try {
			const res = await fetch('/comfyui/start', { method: 'POST' });
			const data = (await res.json()) as StatusResp & { error?: string };
			status = data;
			if (data.error) {
				startError = data.error;
				starting = false;
			}
		} catch {
			startError = 'Network error — try again.';
			starting = false;
		} finally {
			busy = false;
		}
	}

	async function stop(): Promise<void> {
		if (busy) return;
		busy = true;
		startError = '';
		try {
			const res = await fetch('/comfyui/stop', { method: 'POST' });
			if (res.ok) status = (await res.json()) as StatusResp;
			starting = false;
		} catch {
			// Leave the last status; the poll will reconcile.
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		if (!data.podControl) return;
		void refresh();
		const poll = setInterval(() => void refresh(), 5000);
		// Heartbeat: keep the pod alive only while the tab is actually visible, so a
		// forgotten hidden tab lets the idle watchdog reclaim the GPU.
		const beat = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void fetch('/comfyui/ping', { method: 'POST' }).catch(() => {});
			}
		}, 60000);
		return () => {
			clearInterval(poll);
			clearInterval(beat);
		};
	});
</script>

<svelte:head><title>ComfyUI — Invisible Wall</title></svelte:head>

<div class="page">
	<ToolTopBar current="comfyui" tools={data.tools} />

	<main class="body">
		{#if !data.comfyUrl}
			<!-- No pod configured at all: keep the set-me landing. -->
			<section class="hero unset">
				<h1>ComfyUI</h1>
				<p class="lede">No R&amp;D pod is configured yet.</p>
				<p class="hint">
					Set <code>COMFY_RND_URL</code> in the launcher environment to the pod's proxy URL
					(<code>https://&lt;podId&gt;-8188.proxy.runpod.net</code>) once it's running.
				</p>
				<a class="ghost" href="/">‹ Launcher</a>
			</section>
		{:else if !data.podControl}
			<!-- URL set but no RunPod control secrets: plain open-link landing. -->
			<section class="hero">
				<h1>ComfyUI — cloud R&amp;D</h1>
				<p class="lede">
					An interactive ComfyUI running on a RunPod GPU. Build and test generation networks here,
					then export them as blueprints the Invisible Atlas Maker can generate with.
				</p>
				<a class="open" href={data.comfyUrl} target="_blank" rel="noopener noreferrer">
					Open ComfyUI ↗
				</a>
				<p class="hint">
					Opens in a new tab. If it doesn't load, the pod is stopped — start it in the RunPod
					console, then try again.
				</p>
				{@render guidance()}
			</section>
		{:else}
			<!-- Full control panel. -->
			<section class="hero">
				<h1>ComfyUI — cloud R&amp;D</h1>
				<p class="lede">
					An interactive ComfyUI on an on-demand RunPod GPU. Start it when you need it, build and
					test generation networks, then export them as blueprints the Invisible Atlas Maker can
					generate with. It auto-stops when idle so the GPU only bills while you're working.
				</p>

				<div class="panel">
					{#if !status}
						<div class="statusline"><span class="spinner"></span> Checking pod status…</div>
					{:else if ready}
						<div class="statusline">
							<span class="dot on"></span> Pod running — ComfyUI is ready.
						</div>
						<div class="actions">
							<a class="open" href={data.comfyUrl} target="_blank" rel="noopener noreferrer">
								Open ComfyUI ↗
							</a>
							<button class="secondary" onclick={stop} disabled={busy}>
								{busy ? 'Stopping…' : 'Stop pod'}
							</button>
						</div>
					{:else if warming}
						<div class="statusline"><span class="spinner"></span> Warming up — this takes ~2 min…</div>
						<p class="hint">
							The GPU is booting and ComfyUI is starting. This tab will switch to
							<strong>Open ComfyUI</strong> as soon as it's ready.
						</p>
					{:else if stopped}
						<div class="statusline"><span class="dot off"></span> Pod is stopped.</div>
						{#if startError}
							<p class="err">{startError}</p>
						{/if}
						<div class="actions">
							<button class="open btn" onclick={start} disabled={busy}>
								{busy ? 'Starting…' : startError ? 'Retry start' : 'Start pod'}
							</button>
						</div>
						<p class="hint">Starting the pod spins up the GPU — expect about 2 minutes before ComfyUI opens.</p>
					{/if}

					{#if status && status.idleEnabled}
						<p class="idle-note">
							Auto-stops after {status.idleMinutes} min idle (no active renders).
						</p>
					{/if}
				</div>

				{@render guidance()}
			</section>
		{/if}
	</main>
</div>

{#snippet guidance()}
	<ol class="flow">
		<li><strong>Build</strong> your network on the canvas — the pod's GPU, not your machine.</li>
		<li>
			<strong>Export</strong> it: Settings → <em>Save (API Format)</em> to get the workflow JSON.
		</li>
		<li>
			<strong>Publish</strong> it as a blueprint in the
			<a href="/atlas">Atlas Maker</a> (＋ New blueprint → upload the JSON → bind the roles).
		</li>
	</ol>
	<p class="note">
		Any custom node or model your network needs must also live on the shared pipeline backend, or the
		blueprint won't run in the Atlas Maker — check with the team before relying on a brand-new node.
	</p>
{/snippet}

<style>
	.page {
		min-height: 100vh;
		background: #0e0e12;
		color: #d8d8df;
		font-family: system-ui, sans-serif;
	}
	.body {
		display: flex;
		justify-content: center;
		padding: 8vh 24px 48px;
	}
	.hero {
		max-width: 620px;
		width: 100%;
	}
	h1 {
		margin: 0 0 12px;
		color: #7ee0c0;
		letter-spacing: 0.08em;
		font-size: 26px;
	}
	.lede {
		font-size: 15px;
		line-height: 1.55;
		color: #c3c3cc;
		margin: 0 0 22px;
	}
	.panel {
		border: 1px solid #23232c;
		border-radius: 12px;
		background: #14141a;
		padding: 20px;
		margin: 0 0 8px;
	}
	.statusline {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 15px;
		color: #e2e2ea;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
	}
	.open {
		display: inline-block;
		background: #7ee0c0;
		color: #08120f;
		font-weight: 600;
		padding: 11px 22px;
		border-radius: 10px;
		text-decoration: none;
		transition: filter 0.15s ease;
	}
	.open:hover {
		filter: brightness(1.08);
	}
	.btn {
		border: none;
		cursor: pointer;
		font-size: 15px;
	}
	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.secondary {
		background: transparent;
		border: 1px solid #3a3a46;
		color: #c3c3cc;
		font-weight: 600;
		padding: 10px 18px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 14px;
		transition:
			border-color 0.15s,
			color 0.15s;
	}
	.secondary:hover:not(:disabled) {
		border-color: #59596a;
		color: #e8e8ee;
	}
	.secondary:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.dot.on {
		background: #7ee0c0;
		box-shadow: 0 0 8px #7ee0c0aa;
	}
	.dot.off {
		background: #6a6a76;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid #3a3a46;
		border-top-color: #7ee0c0;
		border-radius: 50%;
		flex: none;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.idle-note {
		margin: 14px 0 0;
		font-size: 12px;
		color: #8a8a93;
	}
	.err {
		margin: 12px 0 0;
		font-size: 13px;
		color: #e0906a;
		line-height: 1.5;
	}
	.hint {
		font-size: 13px;
		color: #8a8a93;
		margin: 12px 0 0;
	}
	.flow {
		margin: 30px 0 0;
		padding: 20px 20px 20px 40px;
		border: 1px solid #23232c;
		border-radius: 12px;
		background: #14141a;
		line-height: 1.7;
		font-size: 14px;
	}
	.flow li {
		margin-bottom: 6px;
	}
	.flow strong {
		color: #e9e9ef;
	}
	.flow a {
		color: #7ee0c0;
	}
	.note {
		margin: 18px 0 0;
		font-size: 13px;
		color: #b9974e;
		line-height: 1.55;
	}
	code {
		background: #1c1c24;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 12px;
	}
	.ghost {
		display: inline-block;
		margin-top: 18px;
		border: 1px solid #333;
		color: #aaa;
		padding: 7px 14px;
		border-radius: 8px;
		text-decoration: none;
	}
</style>
