<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type PodStatus = 'running' | 'stopped' | 'starting' | 'unknown';
	interface Pod {
		id: string;
		label: string;
		url: string;
		status: PodStatus;
		ready: boolean;
	}
	interface StatusResp {
		configured: boolean;
		idleEnabled: boolean;
		idleMinutes: number;
		pods: Pod[];
	}

	let status = $state<StatusResp | null>(null);
	// Per-pod transient UI state, keyed by pod id.
	let busy = $state<Record<string, boolean>>({});
	let starting = $state<Record<string, boolean>>({});
	let errors = $state<Record<string, string>>({});

	const pods = $derived(status?.pods ?? []);

	function isReady(p: Pod): boolean {
		return p.status === 'running' && p.ready;
	}
	function isWarming(p: Pod): boolean {
		return (
			!!starting[p.id] ||
			p.status === 'starting' ||
			(p.status === 'running' && !p.ready)
		);
	}
	function isStopped(p: Pod): boolean {
		return !isReady(p) && !isWarming(p) && (p.status === 'stopped' || p.status === 'unknown');
	}

	// Once a pod's ComfyUI answers, drop its sticky "starting" flag.
	$effect(() => {
		for (const p of pods) {
			if (p.status === 'running' && p.ready && starting[p.id]) delete starting[p.id];
		}
	});

	function applyStatus(resp: StatusResp): void {
		status = resp;
	}

	async function refresh(): Promise<void> {
		try {
			const res = await fetch('/comfyui/status');
			if (res.ok) applyStatus((await res.json()) as StatusResp);
		} catch {
			// Transient — the next poll retries; keep the last known fleet on screen.
		}
	}

	async function start(podId: string): Promise<void> {
		if (busy[podId]) return;
		busy[podId] = true;
		delete errors[podId];
		starting[podId] = true;
		try {
			const res = await fetch('/comfyui/start', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ podId }),
			});
			if (res.ok) {
				const resp = (await res.json()) as StatusResp & { error?: string };
				applyStatus(resp);
				if (resp.error) {
					errors[podId] = resp.error;
					delete starting[podId];
				}
			} else {
				errors[podId] = 'Start failed — try again.';
				delete starting[podId];
			}
		} catch {
			errors[podId] = 'Network error — try again.';
			delete starting[podId];
		} finally {
			delete busy[podId];
		}
	}

	async function stop(podId: string): Promise<void> {
		if (busy[podId]) return;
		busy[podId] = true;
		delete errors[podId];
		try {
			const res = await fetch('/comfyui/stop', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ podId }),
			});
			if (res.ok) applyStatus((await res.json()) as StatusResp);
			delete starting[podId];
		} catch {
			// Leave the last status; the poll will reconcile.
		} finally {
			delete busy[podId];
		}
	}

	onMount(() => {
		if (!data.podControl) return;
		void refresh();
		const poll = setInterval(() => void refresh(), 5000);
		// Heartbeat: keep the fleet alive only while the tab is actually visible, so a
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
		{#if !data.podControl}
			<!-- No fleet / no RunPod key: set-me landing. -->
			<section class="hero unset">
				<h1>ComfyUI</h1>
				<p class="lede">No R&amp;D pods are configured yet.</p>
				<p class="hint">
					Set <code>RUNPOD_API_KEY</code> in the launcher environment, then add one or more pods
					(the different GPU cards) in <a href="/admin">Admin → Settings → ComfyUI R&amp;D pod</a>.
					A single legacy <code>RUNPOD_POD_ID</code> still works too.
				</p>
				<a class="ghost" href="/">‹ Launcher</a>
			</section>
		{:else}
			<!-- Fleet control panel. -->
			<section class="hero">
				<h1>ComfyUI — cloud R&amp;D</h1>
				<p class="lede">
					Interactive ComfyUI on on-demand RunPod GPUs. Pick a card and start it — if it's out of
					free GPUs, try the next one. Build and test generation networks, then export them as
					blueprints the Invisible Atlas Maker can generate with. Idle pods auto-stop so the GPU
					only bills while you're working.
				</p>

				{#if !status}
					<div class="panel">
						<div class="statusline"><span class="spinner"></span> Loading pods…</div>
					</div>
				{:else if pods.length === 0}
					<div class="panel">
						<div class="statusline"><span class="dot off"></span> No pods in the fleet.</div>
						<p class="hint">Add pods in <a href="/admin">Admin → Settings → ComfyUI R&amp;D pod</a>.</p>
					</div>
				{:else}
					<ul class="fleet">
						{#each pods as pod (pod.id)}
							<li class="pod">
								<!-- Leave room for a future per-pod "GPU available" dot before the label. -->
								<div class="pod-head">
									<span class="pod-label">{pod.label}</span>
									{#if isReady(pod)}
										<span class="badge on"><span class="dot on"></span> running</span>
									{:else if isWarming(pod)}
										<span class="badge warm"><span class="spinner sm"></span> starting</span>
									{:else}
										<span class="badge off"><span class="dot off"></span> stopped</span>
									{/if}
								</div>

								<div class="pod-actions">
									{#if isReady(pod)}
										<a class="open sm" href={pod.url} target="_blank" rel="noopener noreferrer">
											Open ComfyUI ↗
										</a>
										<button class="secondary sm" onclick={() => stop(pod.id)} disabled={busy[pod.id]}>
											{busy[pod.id] ? 'Stopping…' : 'Stop'}
										</button>
									{:else if isWarming(pod)}
										<span class="warmnote">
											{pod.status === 'running' && !pod.ready
												? 'Pod is up — waiting for ComfyUI…'
												: 'Warming up ~2 min…'}
										</span>
										<button class="secondary sm" onclick={() => stop(pod.id)} disabled={busy[pod.id]}>
											{busy[pod.id] ? 'Stopping…' : 'Stop'}
										</button>
									{:else if isStopped(pod)}
										<button class="open sm btn" onclick={() => start(pod.id)} disabled={busy[pod.id]}>
											{busy[pod.id] ? 'Starting…' : errors[pod.id] ? 'Retry' : 'Start'}
										</button>
									{/if}
								</div>

								{#if pod.status === 'running' && !pod.ready}
									<p class="hint">
										The pod is running but ComfyUI hasn't answered. If it never connects, the
										pod's <strong>Container Start Command</strong> may not launch ComfyUI on boot
										(set it to <code>bash /workspace/start-comfyui.sh</code>).
									</p>
								{/if}
								{#if errors[pod.id]}
									<p class="err">{errors[pod.id]}</p>
								{/if}
							</li>
						{/each}
					</ul>

					{#if status.idleEnabled}
						<p class="idle-note">
							Pods auto-stop after {status.idleMinutes} min idle (no active renders).
						</p>
					{/if}
				{/if}

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
					Any custom node or model your network needs must also live on the shared pipeline backend,
					or the blueprint won't run in the Atlas Maker — check with the team before relying on a
					brand-new node.
				</p>
			</section>
		{/if}
	</main>
</div>

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
	.fleet {
		list-style: none;
		margin: 0 0 8px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pod {
		border: 1px solid #23232c;
		border-radius: 12px;
		background: #14141a;
		padding: 16px 18px;
	}
	.pod-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.pod-label {
		font-size: 15px;
		font-weight: 600;
		color: #e6e6ee;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid #2a2a34;
		color: #c3c3cc;
	}
	.badge.on {
		border-color: #2b6f5a;
		color: #7ee0c0;
	}
	.badge.warm {
		border-color: #6a5a2a;
		color: #d8bd77;
	}
	.pod-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 14px;
		flex-wrap: wrap;
	}
	.warmnote {
		font-size: 13px;
		color: #8a8a93;
	}
	.statusline {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 15px;
		color: #e2e2ea;
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
	.open.sm {
		padding: 8px 16px;
		font-size: 14px;
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
	.secondary.sm {
		padding: 8px 14px;
		font-size: 13px;
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
	.spinner.sm {
		width: 11px;
		height: 11px;
		border-width: 2px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.idle-note {
		margin: 6px 0 0;
		font-size: 12px;
		color: #8a8a93;
	}
	.err {
		margin: 10px 0 0;
		font-size: 13px;
		color: #e0906a;
		line-height: 1.5;
	}
	.hint {
		font-size: 13px;
		color: #8a8a93;
		margin: 12px 0 0;
	}
	.hint a,
	.idle-note a {
		color: #7ee0c0;
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
