<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type PodStatus = 'running' | 'stopped' | 'starting' | 'unknown';
	interface PodSpecs {
		gpu?: string;
		gpuCount?: number;
		vramGb?: number;
		cpu?: string;
		vcpuCount?: number;
		memoryGb?: number;
		costPerHr?: number;
	}
	type StockStatus = 'High' | 'Medium' | 'Low' | 'None';
	type AvailabilitySource = 'datacenter' | 'price';
	interface PodAvailability {
		source: AvailabilitySource;
		available?: boolean;
		stockStatus?: StockStatus;
		dataCenterId?: string;
	}
	interface Pod {
		id: string;
		label: string;
		url: string;
		status: PodStatus;
		ready: boolean;
		directUrl?: string;
		specs?: PodSpecs;
		availability?: PodAvailability;
	}
	interface StatusResp {
		configured: boolean;
		idleEnabled: boolean;
		idleMinutes: number;
		leaseMinutes: number;
		availabilityNote?: string;
		pods: Pod[];
	}

	interface ModelFolder {
		folder: string;
		files: string[];
		truncated: boolean;
	}
	interface NodePack {
		name: string;
		nodes: number;
		version?: string;
		onVolume?: boolean;
	}
	interface Inventory {
		reader: { id: string; label: string } | null;
		models: ModelFolder[];
		packs: NodePack[];
		modelsVia?: string;
		packsVia?: string;
		note?: string;
		fetchedAt: number;
	}

	let status = $state<StatusResp | null>(null);
	// Per-pod transient UI state, keyed by pod id.
	let busy = $state<Record<string, boolean>>({});
	let starting = $state<Record<string, boolean>>({});
	let errors = $state<Record<string, string>>({});

	let inventory = $state<Inventory | null>(null);
	let invBusy = $state(false);
	let invError = $state('');
	let invOpen = $state(false);

	const pods = $derived(status?.pods ?? []);
	const modelCount = $derived(
		(inventory?.models ?? []).reduce((sum, folder) => sum + folder.files.length, 0),
	);

	/**
	 * The three figures that decide WHICH card to start: price, VRAM, processor. Each is
	 * rendered only when RunPod actually reported it — a spec line is there to be trusted,
	 * so a guess or an em-dash placeholder would be worse than the missing row.
	 */
	function specRows(p: Pod): { label: string; value: string }[] {
		const s = p.specs;
		if (!s) return [];
		const rows: { label: string; value: string }[] = [];

		if (s.costPerHr != null) {
			rows.push({
				label: 'Cost/hr',
				value: `$${s.costPerHr.toFixed(s.costPerHr < 1 ? 3 : 2)}`,
			});
		}

		if (s.vramGb != null || s.gpu) {
			const per = s.vramGb != null ? `${s.vramGb} GB` : '';
			const vram = s.vramGb != null && (s.gpuCount ?? 1) > 1 ? `${s.gpuCount} × ${per}` : per;
			rows.push({ label: 'VRAM', value: [vram, s.gpu].filter(Boolean).join(' · ') });
		}

		const cpu = [
			s.cpu,
			s.vcpuCount != null ? `${s.vcpuCount} vCPU` : '',
			s.memoryGb != null ? `${s.memoryGb} GB RAM` : '',
		].filter(Boolean);
		if (cpu.length) rows.push({ label: 'Processor', value: cpu.join(' · ') });

		return rows;
	}

	/**
	 * GPU availability, shown only on a card that ISN'T holding a GPU — a running pod already
	 * has its card, so the question is only ever "would Start work right now?".
	 *
	 * SAY NOTHING RATHER THAN SAY SOMETHING VAGUE. The first version of this badge rendered
	 * the coarse `stockStatus` word for every card and read "GPU stock low" on all six, in a
	 * region where most were not rentable at all — worse than no badge, because it looked
	 * like an answer. So a badge now needs RunPod's explicit `available` boolean; the coarse
	 * word only speaks up for `None`, which is the one value of it that is unambiguous.
	 *
	 * Orange reads as a fault. "Available" stays neutral rather than green: green means
	 * running on this panel, and a second green badge would say a stopped pod is up.
	 */
	function stockBadge(p: Pod): { label: string; cls: string } | null {
		const a = p.availability;
		if (!a) return null;
		const FREE = { label: 'GPU available', cls: '' };
		const LOW = { label: 'GPU stock low', cls: 'warn' };
		const NONE = { label: 'no GPUs free', cls: 'warn' };

		// The `price` source reports stock at the cheapest price point, not availability. Only
		// `None` is unambiguous enough to render from it; the rest is what read "low" across a
		// whole fleet and started this.
		if (a.source !== 'datacenter') return a.stockStatus === 'None' ? NONE : null;

		// Not rentable at all.
		if (a.available === false || a.stockStatus === 'None') return NONE;
		// Rentable, but scarce — and this MUST outrank the boolean rather than be hidden by it.
		// `available: true` only means "more than zero"; RunPod's own console flags these cards
		// red as Low, and an earlier order here checked the boolean first and rendered a calm
		// "GPU available" on a fleet the console was warning about.
		if (a.stockStatus === 'Low') return LOW;
		if (a.available === true || a.stockStatus) return FREE;
		return null;
	}
	/** The tooltip carries what the badge can't: the SCOPE, the nuance, and the caveat. */
	function stockTitle(p: Pod): string {
		const a = p.availability;
		if (!a) return '';
		const where = a.dataCenterId ? `in ${a.dataCenterId}` : 'across all data centres';
		const stock = a.stockStatus ? ` RunPod rates stock there ${a.stockStatus.toLowerCase()}.` : '';
		const scope = a.dataCenterId
			? ''
			: " This pod can only resume where its disk already is, so a fleet-wide reading can look healthier than this pod's own region — set RUNPOD_DATA_CENTER_ID to pin it.";
		return `RunPod reports ${p.specs?.gpu ?? 'this GPU'} as ${a.available === false ? 'not rentable' : 'rentable'} ${where}.${stock} Stock moves, so a Start can still lose the race.${scope}`;
	}

	function isReady(p: Pod): boolean {
		return p.status === 'running' && p.ready;
	}
	function isWarming(p: Pod): boolean {
		return !!starting[p.id] || p.status === 'starting' || (p.status === 'running' && !p.ready);
	}
	function isStopped(p: Pod): boolean {
		return !isReady(p) && !isWarming(p) && (p.status === 'stopped' || p.status === 'unknown');
	}

	// TCP 8188 is REQUIRED pod config, not a nicety. RunPod's proxy 403s any browser
	// request stamped `Sec-Fetch-Site: cross-site`, which is EVERY click from this page,
	// and the browser derives that header from the initiator — no rel/target/redirect
	// changes it. Only the direct ip:port skips the proxy, so a pod without it simply
	// cannot be opened from here. That's a MISCONFIGURED POD, and the card says so
	// instead of quietly degrading into a copy-the-url chore.
	// See docs/INFRA.md §"Access to …proxy.runpod.net was denied".
	function needsTcpPort(p: Pod): boolean {
		return isReady(p) && !p.directUrl;
	}

	// Once a pod's ComfyUI answers, drop its sticky "starting" flag.
	$effect(() => {
		for (const p of pods) {
			if (p.status === 'running' && p.ready && starting[p.id]) delete starting[p.id];
		}
	});

	function applyStatus(resp: StatusResp): void {
		const wasReady = pods.some(isReady);
		status = resp;
		// A pod coming up is the one moment the inventory can change from "nothing
		// answered" to a real listing, so re-read it then — but only then. This is not
		// part of the 5s poll: a pack listing can cost an /object_info scan.
		if (!wasReady && resp.pods.some(isReady) && !inventory?.reader) void loadInventory();
	}

	/**
	 * Read what's installed. Deliberately NOT polled — the server caches for 60s and the
	 * Refresh button forces a fresh read, which is what you want right after installing
	 * something on a pod.
	 */
	async function loadInventory(refresh = false): Promise<void> {
		if (invBusy) return;
		invBusy = true;
		invError = '';
		try {
			const res = await fetch(`/comfyui/inventory${refresh ? '?refresh=1' : ''}`);
			if (res.ok) {
				inventory = (await res.json()) as Inventory;
			} else {
				invError = 'Could not read the pods.';
			}
		} catch {
			invError = 'Network error — try again.';
		} finally {
			invBusy = false;
		}
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

	/**
	 * Opening ComfyUI hands the artist to another tab, which silences the visibility-gated
	 * heartbeat below — so take a session lease first, or the idle watchdog can reclaim the
	 * pod out from under a network that's still being built. Fire-and-forget: a failed
	 * lease must never block the artist from opening ComfyUI.
	 */
	function openComfy(): void {
		void fetch('/comfyui/ping', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ lease: true }),
		})
			.then(() => refresh())
			.catch(() => {});
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
		// One read on load: an always-on volume pod answers even with the whole GPU fleet
		// stopped, so this is usually a real listing rather than an empty panel.
		void loadInventory();
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
						<p class="hint">
							Add pods in <a href="/admin">Admin → Settings → ComfyUI R&amp;D pod</a>.
						</p>
					</div>
				{:else}
					<ul class="fleet">
						{#each pods as pod (pod.id)}
							<li class="pod">
								<div class="pod-head">
									<span class="pod-label">{pod.label}</span>
									<span class="pod-badges">
										{#if isReady(pod)}
											<span class="badge on"><span class="dot on"></span> running</span>
										{:else if isWarming(pod)}
											<span class="badge warm"><span class="spinner sm"></span> starting</span>
										{:else}
											<!-- Availability sits BEFORE the status badge: on a stopped card it is
											     the thing that decides whether clicking Start is worth it. -->
											{@const stock = stockBadge(pod)}
											{#if stock}
												<span class="badge {stock.cls}" title={stockTitle(pod)}>
													{stock.label}
												</span>
											{/if}
											<span class="badge off"><span class="dot off"></span> stopped</span>
										{/if}
									</span>
								</div>

								{#if specRows(pod).length}
									<dl class="specs">
										{#each specRows(pod) as row (row.label)}
											<div class="spec">
												<dt>{row.label}</dt>
												<dd>{row.value}</dd>
											</div>
										{/each}
									</dl>
								{/if}

								<div class="pod-actions">
									{#if isReady(pod)}
										{#if pod.directUrl}
											<a
												class="open sm"
												href={pod.directUrl}
												target="_blank"
												rel="noopener noreferrer"
												onclick={openComfy}
											>
												Open ComfyUI ↗
											</a>
										{:else}
											<span class="badge warn" title="This pod has no TCP port — see below">
												⚠ not reachable
											</span>
										{/if}
										<button
											class="secondary sm"
											onclick={() => stop(pod.id)}
											disabled={busy[pod.id]}
										>
											{busy[pod.id] ? 'Stopping…' : 'Stop'}
										</button>
									{:else if isWarming(pod)}
										<span class="warmnote">
											{pod.status === 'running' && !pod.ready
												? 'Pod is up — waiting for ComfyUI…'
												: 'Warming up ~2 min…'}
										</span>
										<button
											class="secondary sm"
											onclick={() => stop(pod.id)}
											disabled={busy[pod.id]}
										>
											{busy[pod.id] ? 'Stopping…' : 'Stop'}
										</button>
									{:else if isStopped(pod)}
										<button
											class="open sm btn"
											onclick={() => start(pod.id)}
											disabled={busy[pod.id]}
										>
											{busy[pod.id] ? 'Starting…' : errors[pod.id] ? 'Retry' : 'Start'}
										</button>
									{/if}
								</div>

								{#if needsTcpPort(pod)}
									<p class="misconfig">
										<strong>This pod is missing its TCP port.</strong> In RunPod →
										<em>Edit Pod</em>, expose <strong>8188 as TCP</strong> (keep the HTTP one too),
										then Stop and Start it here — the button comes back straight away, and it also
										stops the proxy dropping ComfyUI's progress socket on long renders. One-time per
										pod.
										<br />
										Until then this pod can only be opened by pasting <code>{pod.url}</code> into the
										address bar: RunPod rejects links clicked from another site.
									</p>
								{/if}

								{#if pod.status === 'running' && !pod.ready}
									<p class="hint">
										The pod is running but ComfyUI hasn't answered. If it never connects, the pod's <strong
											>Container Start Command</strong
										>
										may not launch ComfyUI on boot (set it to
										<code>bash /workspace/start-comfyui.sh</code>).
									</p>
								{/if}
								{#if errors[pod.id]}
									<p class="err">{errors[pod.id]}</p>
								{/if}
							</li>
						{/each}
					</ul>

					<!-- Only rendered when the badges are missing BECAUSE RunPod refused. Silence
					     was how this feature failed twice: the blank row looked identical to a
					     healthy one, and the only explanation lived in a log the person looking
					     at the panel can't reach. -->
					{#if status.availabilityNote}
						<p class="avail-note">
							GPU availability unavailable — RunPod said: “{status.availabilityNote}”. Cards still
							start normally; only the availability badge is missing.
						</p>
					{/if}

					{#if status.idleEnabled}
						<p class="idle-note">
							{#if status.leaseMinutes > 0}
								Held for another {status.leaseMinutes} min while you work — then auto-stops after
								{status.idleMinutes} min idle. Re-open ComfyUI to extend.
							{:else}
								Pods auto-stop after {status.idleMinutes} min idle. Opening ComfyUI holds one for an
								hour so a pod is never reclaimed mid-session.
							{/if}
						</p>
					{/if}

					<!-- What's installed. Collapsed by default: it answers a question you ask
					     occasionally ("is that LoRA up there?"), and the fleet controls are what
					     the page is for. -->
					<div class="inv">
						<button class="inv-head" onclick={() => (invOpen = !invOpen)} aria-expanded={invOpen}>
							<span class="inv-title">
								What's installed
								{#if inventory?.reader}
									<span class="sub">
										{modelCount} models · {inventory.packs.length} node packs
									</span>
								{/if}
							</span>
							<span class="chev" class:open={invOpen}>›</span>
						</button>

						{#if invOpen}
							<div class="inv-body">
								{#if invBusy && !inventory}
									<div class="statusline"><span class="spinner"></span> Reading the pods…</div>
								{:else}
									{#if inventory?.reader}
										<p class="hint">
											Read live from <strong>{inventory.reader.label}</strong
											>{#if inventory.modelsVia}
												via <code>{inventory.modelsVia}</code>{/if}.
										</p>
									{/if}
									{#if invError}<p class="err">{invError}</p>{/if}
									{#if inventory?.note}<p class="hint">{inventory.note}</p>{/if}

									{#if inventory && inventory.models.length > 0}
										<h3>
											Models <span class="sub"
												>Network Volume — shared by every pod, survives a stop</span
											>
										</h3>
										<ul class="folders">
											{#each inventory.models as folder (folder.folder)}
												<li>
													<details>
														<summary>
															<span class="fname">{folder.folder}</span>
															<span class="count">
																{folder.files.length}{folder.truncated ? '+' : ''}
															</span>
														</summary>
														<ul class="files">
															{#each folder.files as file (file)}
																<li>{file}</li>
															{/each}
														</ul>
													</details>
												</li>
											{/each}
										</ul>
									{/if}

									{#if inventory && inventory.packs.length > 0}
										<h3>
											Custom node packs
											<span class="sub">
												loaded by {inventory.reader?.label ?? 'the pod'}{#if inventory.packsVia}
													· <code>{inventory.packsVia}</code>{/if}
											</span>
										</h3>
										<ul class="packs">
											{#each inventory.packs as pack (pack.name)}
												<li>
													<span class="fname">{pack.name}</span>
													{#if pack.version}<span class="ver">{pack.version}</span>{/if}
													{#if pack.nodes > 0}<span class="count">{pack.nodes} nodes</span>{/if}
													{#if pack.onVolume === false}
														<span class="badge warn" title="Not on the volume — lost on recreate">
															container
														</span>
													{/if}
												</li>
											{/each}
										</ul>
										<p class="note">
											Node packs live in the pod's <strong>container image</strong>, not on the
											volume. Anything installed later with ComfyUI-Manager is written to the
											container and <strong>disappears when the pod is recreated on resume</strong>
											— to keep a pack, add it to
											<code>services/atlas-comfy-pod/Dockerfile</code> and rebuild the image.
										</p>
									{/if}
								{/if}

								<div class="inv-actions">
									<button
										class="secondary sm"
										onclick={() => loadInventory(true)}
										disabled={invBusy}
									>
										{invBusy ? 'Reading…' : 'Refresh'}
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<ol class="flow">
					<li>
						<strong>Build</strong> your network on the canvas — the pod's GPU, not your machine.
					</li>
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
	/* Status, and on a stopped card the GPU-stock reading, group together on the right.
	   Wraps rather than squeezing the label on a narrow card. */
	.pod-badges {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		flex-wrap: wrap;
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
	/* A pod that is up but has no TCP port: reachable by the server, not openable from
	   here. Deliberately reads as a fault, not as an alternative way of working. */
	.badge.warn {
		border-color: #7a4a2a;
		color: #e0a077;
	}
	.misconfig {
		font-size: 13px;
		line-height: 1.5;
		color: #c9a88f;
		background: #241a14;
		border: 1px solid #7a4a2a;
		border-radius: 8px;
		padding: 10px 12px;
		margin: 12px 0 0;
	}
	.misconfig code {
		color: #e0c0a8;
		word-break: break-all;
	}
	/* Specs sit between the pod's name and its buttons: they're what you read to decide
	   which card to start, so they belong above the action, not below it. */
	.specs {
		margin: 12px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 8px 16px;
	}
	.spec {
		min-width: 0;
	}
	.specs dt {
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #7a7a84;
	}
	.specs dd {
		margin: 2px 0 0;
		font-size: 13px;
		color: #c3c3cc;
		font-variant-numeric: tabular-nums;
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
	/* Quieter than a fault, louder than nothing: one missing feature, not a broken fleet. */
	.avail-note {
		margin: 10px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: #c9a88f;
		background: #241a14;
		border: 1px solid #7a4a2a;
		border-radius: 8px;
		padding: 8px 10px;
	}
	.inv {
		margin: 14px 0 0;
		border: 1px solid #23232c;
		border-radius: 12px;
		background: #14141a;
		overflow: hidden;
	}
	.inv-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		background: transparent;
		border: none;
		cursor: pointer;
		color: #e6e6ee;
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		text-align: left;
		padding: 14px 18px;
	}
	.inv-head:hover {
		color: #7ee0c0;
	}
	.chev {
		color: #8a8a93;
		transition: transform 0.15s ease;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.inv-body {
		padding: 0 18px 16px;
		border-top: 1px solid #23232c;
	}
	.inv-body h3 {
		margin: 16px 0 8px;
		font-size: 13px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #a9a9b4;
	}
	.sub {
		font-weight: 400;
		font-size: 12px;
		letter-spacing: 0;
		text-transform: none;
		color: #8a8a93;
	}
	.folders,
	.packs {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 13px;
	}
	.folders > li,
	.packs > li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 0;
		border-bottom: 1px solid #1d1d25;
	}
	.folders > li {
		display: block;
	}
	.folders summary {
		display: flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		list-style: none;
	}
	.folders summary::-webkit-details-marker {
		display: none;
	}
	.folders summary::before {
		content: '›';
		color: #6a6a76;
	}
	.folders details[open] summary::before {
		color: #7ee0c0;
	}
	.fname {
		color: #e2e2ea;
		word-break: break-all;
	}
	.count,
	.ver {
		font-size: 12px;
		color: #8a8a93;
		flex: none;
	}
	.count {
		margin-left: auto;
	}
	.files {
		list-style: none;
		margin: 6px 0 8px 16px;
		padding: 0 0 0 10px;
		border-left: 1px solid #2a2a34;
		font-size: 12px;
		color: #a9a9b4;
		line-height: 1.7;
		word-break: break-all;
	}
	.inv-actions {
		margin-top: 16px;
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
