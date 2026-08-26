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
		imageName?: string;
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

	interface ImageBuild {
		status: string;
		conclusion?: string;
		sha: string;
		url?: string;
		startedAt?: string;
		image: string;
	}
	interface BuildState {
		configured: boolean;
		latest?: ImageBuild;
		error?: string;
		dispatched?: boolean;
	}
	/** Result of moving a pod onto a build — before/after, so nothing is asserted. */
	interface PodImageState {
		imageName?: string;
		ports?: string[];
		volumeMountPath?: string;
		networkVolumeId?: string;
	}
	interface MoveResult {
		ok: boolean;
		before?: PodImageState;
		after?: PodImageState;
		error?: string;
	}

	interface PodNode {
		name: string;
		url?: string;
		sha?: string;
		vendored?: boolean;
		prod?: boolean;
		noClasses?: boolean;
		note?: string;
	}
	interface NodeList {
		configured: boolean;
		nodes?: PodNode[];
		corePacks?: string[];
		error?: string;
	}
	interface ResolvedNode {
		name: string;
		url: string;
		sha: string;
		subject?: string;
		date?: string;
	}

	let nodeList = $state<NodeList | null>(null);
	// OPEN by default. Collapsed, it was a grey ▸ line below the fold that the person who
	// asked for this feature scrolled straight past — discoverability beats tidiness for the
	// thing the panel exists to do.
	let nodesOpen = $state(true);
	let addUrl = $state('');
	let addNote = $state('');
	let resolved = $state<ResolvedNode | null>(null);
	let nodeBusy = $state(false);
	let nodeError = $state('');

	let build = $state<BuildState | null>(null);
	let buildBusy = $state(false);
	let moving = $state<Record<string, boolean>>({});
	let moved = $state<Record<string, MoveResult>>({});

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

		// Which BUILD this pod is running. Only answerable in the RunPod console until now,
		// and it is the first thing you need after adding a custom node.
		if (s.imageName) {
			const tag = s.imageName.split(':').pop() ?? s.imageName;
			rows.push({ label: 'Image', value: tag === 'latest' ? 'latest (mutable)' : tag });
		}

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
		const LOW = { label: 'GPU stock low', cls: 'caution' };
		const NONE = { label: 'no GPUs free', cls: 'warn' };

		// The `price` source reports stock at the cheapest price point, not availability. Only
		// `None` is unambiguous enough to render from it; the rest is what read "low" across a
		// whole fleet and started this.
		if (a.source !== 'datacenter') return a.stockStatus === 'None' ? NONE : null;

		// Not rentable at all.
		if (a.available === false || a.stockStatus === 'None') return NONE;
		// Rentable, but scarce. Amber, NOT the orange of "no GPUs free": those two are different
		// answers — one says try it, the other says do not bother — and rendering them in the
		// same colour threw that distinction away.
		// This MUST also outrank the boolean rather than be hidden by it.
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

	/** The 12-char tag CI pushes — long enough to be unambiguous, short enough for a card. */
	function shortSha(sha: string): string {
		return sha.slice(0, 12);
	}
	function buildRunning(b: BuildState | null): boolean {
		return b?.latest?.status === 'queued' || b?.latest?.status === 'in_progress';
	}
	/** Is this pod on the newest SUCCESSFUL build? Unknown image => don't claim either way. */
	function podOnLatest(p: Pod): boolean | null {
		const image = p.specs?.imageName;
		const sha = build?.latest?.conclusion === 'success' ? build.latest.sha : undefined;
		if (!image || !sha) return null;
		return image.endsWith(`:${shortSha(sha)}`);
	}

	/**
	 * Does a live pod actually have this node LOADED?
	 *
	 * The join `verify-deps.py` structurally cannot do: that proves the shared dep base still
	 * imports, and says nothing about whether the node you just added registered its classes.
	 * A node pinned behind our core, or one that reaches into core internals, fails exactly
	 * here — it installs clean and then contributes nothing.
	 *
	 * Both halves already existed: `nodes.json` is what SHOULD be on the image, and the
	 * inventory panel already reads which packs the answering pod loaded (via ComfyUI-Manager,
	 * else a streamed `/object_info` scan that stamps each class with its `custom_nodes.<pack>`
	 * module). This is the comparison, done in the browser because both are already here.
	 */
	const loadedPacks = $derived(
		new Map((inventory?.packs ?? []).map((p) => [p.name.toLowerCase(), p])),
	);
	/** The fleet row the inventory was read from, when it is one of ours. */
	const readerPod = $derived(status?.pods.find((p) => p.id === inventory?.reader?.id));
	/**
	 * A pod on an older image legitimately lacks anything added since it was built, so "not
	 * seen" would be noise rather than news. The section says so ONCE instead of every row
	 * carrying a caveat.
	 */
	const readerBehind = $derived(!!readerPod && podOnLatest(readerPod) === false);

	/**
	 * Packs the pod has LOADED that `nodes.json` knows nothing about — the reverse of the check
	 * below, and the other half of the volume test lane.
	 *
	 * One of two things, both worth seeing: a node being tried on the Network Volume (the lane
	 * working as intended), or one ComfyUI-Manager installed into the container, which will
	 * vanish the next time RunPod recreates it. Either way it is NOT in the image, so it does
	 * not exist on a fresh pod or on the serverless worker — and a blueprint built against it
	 * would fail somewhere else, later, for a reason nobody could see from here.
	 */
	const unbakedPacks = $derived(
		(inventory?.packs ?? []).filter(
			(pack) =>
				!(nodeList?.nodes ?? []).some((n) => n.name.toLowerCase() === pack.name.toLowerCase()) &&
				// Packs that ship inside ComfyUI itself are reported like any other, and are
				// plainly not something we bake. Flagging them would be true, useless, and the
				// kind of standing false alarm that teaches people to ignore the real ones.
				!(nodeList?.corePacks ?? []).some((c) => c.toLowerCase() === pack.name.toLowerCase()),
		),
	);

	function nodeLoaded(node: PodNode): { label: string; cls: string; title: string } | null {
		// Nothing answered, so there is nothing to compare against — say nothing.
		if (!inventory?.packs?.length) return null;
		if (node.noClasses) {
			return {
				label: 'frontend only',
				cls: 'muted',
				title:
					'Registers no node classes, so it never appears in /object_info. Not checkable, and not a fault.',
			};
		}
		const pack = loadedPacks.get(node.name.toLowerCase());
		if (pack) {
			return {
				label: `loaded · ${pack.nodes} classes`,
				cls: 'ok',
				title: `${inventory?.reader?.label ?? 'The reading pod'} has this pack loaded, registering ${pack.nodes} node classes.`,
			};
		}
		return {
			label: 'not seen',
			cls: 'caution',
			title: readerBehind
				? `${inventory?.reader?.label ?? 'The reading pod'} is on an older build, so a recently added node is EXPECTED to be missing. Move it to the latest build to make this meaningful.`
				: `${inventory?.reader?.label ?? 'The reading pod'} did not report this pack. If it is on the current build, the node failed to register — check the pod's startup log.`,
		};
	}

	async function loadNodes(): Promise<void> {
		try {
			const res = await fetch('/comfyui/nodes');
			if (res.ok) {
				nodeList = (await res.json()) as NodeList;
				return;
			}
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			nodeList = {
				configured: true,
				error: `GET /comfyui/nodes → ${res.status}${body.message ? `: ${body.message}` : ''}`,
			};
		} catch (err) {
			nodeList = {
				configured: true,
				error: err instanceof Error ? err.message : 'Could not reach /comfyui/nodes.',
			};
		}
	}

	/** Step 1: what WOULD be pinned. Nothing is written, so this is safe to press freely. */
	async function resolveNode(): Promise<void> {
		if (!addUrl.trim() || nodeBusy) return;
		nodeBusy = true;
		nodeError = '';
		resolved = null;
		try {
			const res = await fetch('/comfyui/nodes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: addUrl }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				node?: ResolvedNode;
				error?: string;
				message?: string;
			};
			if (res.ok && data.node) resolved = data.node;
			else nodeError = data.error ?? data.message ?? `Could not resolve (${res.status}).`;
		} catch (err) {
			nodeError = err instanceof Error ? err.message : 'Could not reach the launcher.';
		} finally {
			nodeBusy = false;
		}
	}

	/** Step 2: commit it. One commit on main, which also triggers the image build. */
	async function commitNode(): Promise<void> {
		if (!resolved || nodeBusy) return;
		nodeBusy = true;
		nodeError = '';
		try {
			const res = await fetch('/comfyui/nodes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: addUrl, note: addNote, commit: true }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				list?: PodNode[];
				error?: string;
				message?: string;
			};
			if (res.ok && data.ok) {
				if (data.list && nodeList) nodeList = { ...nodeList, nodes: data.list };
				addUrl = '';
				addNote = '';
				resolved = null;
				void loadBuild();
			} else {
				nodeError = data.error ?? data.message ?? `Could not add it (${res.status}).`;
			}
		} catch (err) {
			nodeError = err instanceof Error ? err.message : 'Could not reach the launcher.';
		} finally {
			nodeBusy = false;
		}
	}

	/**
	 * Promote a node to the serverless worker, or take it off. Confirms hard: this one rebuilds
	 * the PROD generation image, and the standing rule is to promote only after a pod off the
	 * R&D image has rendered clean.
	 */
	async function toggleProd(node: PodNode): Promise<void> {
		if (nodeBusy) return;
		const to = !node.prod;
		const warning = to
			? `Promote ${node.name} to the serverless worker?

That is the Atlas Maker's PROD generation path. It commits to main and rebuilds the prod image. Promote only after a pod off the R&D image has rendered clean with it.`
			: `Take ${node.name} off the serverless worker?

Any blueprint that uses it will stop running in the Atlas Maker.`;
		if (!confirm(warning)) return;
		nodeBusy = true;
		nodeError = '';
		try {
			const res = await fetch('/comfyui/nodes', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: node.name, prod: to }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				list?: PodNode[];
				error?: string;
				message?: string;
			};
			if (res.ok && data.ok) {
				if (data.list && nodeList) nodeList = { ...nodeList, nodes: data.list };
			} else {
				nodeError = data.error ?? data.message ?? `Could not change it (${res.status}).`;
			}
		} catch (err) {
			nodeError = err instanceof Error ? err.message : 'Could not reach the launcher.';
		} finally {
			nodeBusy = false;
		}
	}

	async function dropNode(name: string): Promise<void> {
		if (nodeBusy) return;
		if (
			!confirm(`Remove ${name} from the image?

Commits to main and rebuilds.`)
		)
			return;
		nodeBusy = true;
		nodeError = '';
		try {
			const res = await fetch(`/comfyui/nodes?name=${encodeURIComponent(name)}`, {
				method: 'DELETE',
			});
			const data = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				list?: PodNode[];
				error?: string;
				message?: string;
			};
			if (res.ok && data.ok) {
				if (data.list && nodeList) nodeList = { ...nodeList, nodes: data.list };
				void loadBuild();
			} else {
				nodeError = data.error ?? data.message ?? `Could not remove it (${res.status}).`;
			}
		} catch (err) {
			nodeError = err instanceof Error ? err.message : 'Could not reach the launcher.';
		} finally {
			nodeBusy = false;
		}
	}

	async function loadBuild(): Promise<void> {
		try {
			const res = await fetch('/comfyui/build');
			if (res.ok) {
				build = (await res.json()) as BuildState;
				return;
			}
			// A failed read must leave STATE, never null. `null` used to hide this entire
			// section — the Rebuild button AND the node list — with no trace, which is the
			// silent failure this panel has been bitten by twice.
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			build = {
				configured: true,
				error: `GET /comfyui/build → ${res.status}${body.message ? `: ${body.message}` : ''}`,
			};
		} catch (err) {
			build = {
				configured: true,
				error: err instanceof Error ? err.message : 'Could not reach /comfyui/build.',
			};
		}
	}

	async function rebuild(): Promise<void> {
		if (buildBusy) return;
		buildBusy = true;
		try {
			const res = await fetch('/comfyui/build', { method: 'POST' });
			build = (await res.json()) as BuildState;
		} catch (err) {
			build = {
				configured: true,
				...build,
				error: err instanceof Error ? err.message : 'Could not reach the launcher.',
			};
		} finally {
			buildBusy = false;
		}
	}

	async function moveToLatest(pod: Pod): Promise<void> {
		const sha = build?.latest?.sha;
		if (!sha || moving[pod.id]) return;
		const tag = shortSha(sha);
		if (
			!confirm(
				`Move "${pod.label}" to build ${tag}?

RunPod recreates the container, so anything ` +
					`installed by hand on it is lost. Models on the Network Volume are not affected.`,
			)
		) {
			return;
		}
		moving[pod.id] = true;
		delete moved[pod.id];
		try {
			const res = await fetch('/comfyui/pod-image', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ podId: pod.id, sha: tag }),
			});
			const data = (await res.json().catch(() => ({}))) as MoveResult & {
				fleet?: StatusResp;
				message?: string;
			};
			moved[pod.id] = res.ok
				? data
				: { ok: false, error: data.error ?? data.message ?? `Request failed (${res.status}).` };
			if (data.fleet) applyStatus(data.fleet);
		} catch (err) {
			moved[pod.id] = {
				ok: false,
				error: err instanceof Error ? err.message : 'Could not reach the launcher.',
			};
		} finally {
			moving[pod.id] = false;
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
		// The build state is read once on load and then only while something is actually
		// building. GitHub's authed rate limit is shared with the rest of the launcher, and
		// a number that changes every few minutes does not belong in a 5s poll.
		void loadBuild();
		void loadNodes();
		const buildPoll = setInterval(() => {
			if (buildRunning(build)) void loadBuild();
		}, 15000);
		// Heartbeat: keep the fleet alive only while the tab is actually visible, so a
		// forgotten hidden tab lets the idle watchdog reclaim the GPU.
		const beat = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void fetch('/comfyui/ping', { method: 'POST' }).catch(() => {});
			}
		}, 60000);
		return () => {
			clearInterval(poll);
			clearInterval(buildPoll);
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

								{#if moved[pod.id]}
									{@const m = moved[pod.id]}
									<!-- Shows what the pod IS now, read back after the change, rather than
									     claiming success. The ports and volume lines are the point: they are
									     what a careless PATCH could have disturbed. -->
									<p class="movenote" class:bad={!m.ok}>
										{#if m.ok}
											Image: <code>{m.before?.imageName ?? '?'}</code> →
											<code>{m.after?.imageName ?? '?'}</code>. Volume
											<code>{m.after?.volumeMountPath ?? '—'}</code> and ports
											<code>{m.after?.ports?.join(', ') || '—'}</code> unchanged. Start it to pick the
											new image up.
										{:else}
											Could not change the image — {m.error}
										{/if}
									</p>
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
										{#if data.canAdmin && podOnLatest(pod) === false && build?.latest}
											<button
												class="secondary sm"
												onclick={() => void moveToLatest(pod)}
												disabled={moving[pod.id]}
												title="Point this pod at the newest successful build. RunPod recreates the container; the Network Volume is untouched."
											>
												{moving[pod.id] ? 'Moving…' : `Update to ${shortSha(build.latest.sha)}`}
											</button>
										{/if}
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

					<!-- The pod IMAGE: what CI last built, and a way to ask it to build again.
					     Sits under the fleet because it answers a question you ask AFTER adding
					     a node ("is it built yet, and is this pod on it?"), not before picking
					     a card. See docs/design/comfyui-node-manager.md. -->
					<div class="imagebar">
						<div class="imagebar-head">
							<span class="imagebar-title">Pod image</span>
							{#if !build}
								<span class="imagebar-meta">reading…</span>
							{:else if !build.configured}
								<span class="imagebar-meta">
									Set <code>GITHUB_ACTIONS_TOKEN</code> on the launcher (scope
									<code>actions: write</code>) to build from here.
								</span>
							{:else if build.latest}
								{@const b = build.latest}
								<span class="imagebar-meta">
									<code>{shortSha(b.sha)}</code>
									{#if b.status !== 'completed'}
										· <span class="spinner sm"></span> building
									{:else if b.conclusion === 'success'}
										· built
									{:else}
										· <span class="bad">{b.conclusion ?? 'failed'}</span>
									{/if}
									{#if b.url}
										·
										<!-- An absolute github.com run URL, so SvelteKit's resolve() does not apply.
											     Disabled inline rather than added to eslint-suppressions.json: the
											     baseline is for burning DOWN existing debt, not for parking new lines. -->
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
										<a href={b.url} target="_blank" rel="noopener noreferrer">log ↗</a>
									{/if}
								</span>
							{/if}
							{#if data.canAdmin && build?.configured}
								<button
									class="secondary sm"
									onclick={() => void rebuild()}
									disabled={buildBusy || buildRunning(build)}
									title="Runs the pod-image workflow on main. A cached rebuild is ~2 min; a full one ~30."
								>
									{buildBusy ? 'Asking…' : buildRunning(build) ? 'Building…' : 'Rebuild image'}
								</button>
							{/if}
						</div>
						{#if build?.error}
							<p class="avail-note">{build.error}</p>
						{/if}

						<!-- The node list. Collapsed by default: it is the answer to a question you
							     ask when something is missing, not every time you start a pod. -->
						{#if nodeList?.nodes}
							<button
								class="nodes-toggle"
								onclick={() => (nodesOpen = !nodesOpen)}
								aria-expanded={nodesOpen}
							>
								{nodesOpen ? '▾' : '▸'} Custom nodes ({nodeList.nodes.length})
							</button>
							{#if nodesOpen}
								{#if readerBehind}
									<p class="node-caveat">
										Loaded-state read from <strong>{inventory?.reader?.label}</strong>, which is on
										an older build — anything added since will read “not seen”. Update it to the
										latest build to make the check meaningful.
									</p>
								{/if}
								<ul class="nodes">
									{#each nodeList.nodes as node (node.name)}
										{@const loaded = nodeLoaded(node)}
										<li class="node">
											<div class="node-head">
												<span class="node-name">{node.name}</span>
												{#if node.vendored}
													<span class="node-sha">vendored in the repo</span>
												{:else}
													<code class="node-sha">{node.sha}</code>
												{/if}
												{#if loaded}
													<span class="node-state {loaded.cls}" title={loaded.title}>
														{loaded.label}
													</span>
												{/if}
												{#if node.prod}
													<span
														class="node-state ok"
														title="Also baked into the serverless worker — usable by Atlas Maker blueprints."
													>
														prod
													</span>
												{:else}
													<span
														class="node-state muted"
														title="R&D pod only. A blueprint using this node will NOT run in the Atlas Maker until it is promoted."
													>
														R&D only
													</span>
												{/if}
												{#if data.canAdmin && !node.vendored}
													<button
														class="node-drop"
														onclick={() => void toggleProd(node)}
														disabled={nodeBusy}
														title={node.prod
															? 'Take it off the serverless worker — rebuilds the prod image'
															: 'Also bake it into the serverless worker — rebuilds the PROD image'}
													>
														{node.prod ? 'demote' : 'promote'}
													</button>
													<button
														class="node-drop"
														onclick={() => void dropNode(node.name)}
														disabled={nodeBusy}
														title="Remove from nodes.json — commits to main and rebuilds"
													>
														remove
													</button>
												{/if}
											</div>
											{#if node.note}
												<p class="node-note">{node.note}</p>
											{/if}
										</li>
									{/each}
								</ul>

								{#if unbakedPacks.length}
									<!-- Loaded but not baked. Named rather than summarised, because the fix is
										     per-node: bake the keeper, ignore the experiment. -->
									<p class="node-caveat">
										<strong>Not in the image:</strong>
										{unbakedPacks.map((p) => p.name).join(', ')}. Loaded by
										{inventory?.reader?.label ?? 'the reading pod'} from the Network Volume or installed
										into its container — either way a fresh pod will not have it, and neither will the
										serverless worker. Add it below to bake it in.
									</p>
								{/if}

								{#if data.canAdmin}
									<!-- Two steps, deliberately: RESOLVE shows the exact commit that would be
										     pinned, so nobody writes down a ref they have not looked at. A node on
										     a floating branch is how silent drift comes back. -->
									<div class="node-add">
										<input
											class="node-input"
											type="url"
											placeholder="https://github.com/owner/repo"
											bind:value={addUrl}
											disabled={nodeBusy}
										/>
										<input
											class="node-input"
											type="text"
											placeholder="note (optional) — why it is here, what it breaks on"
											bind:value={addNote}
											disabled={nodeBusy}
										/>
										{#if resolved}
											<p class="node-resolved">
												Pins <code>{resolved.name}</code> at <code>{resolved.sha}</code>
												{#if resolved.subject}— “{resolved.subject}”{/if}
												{#if resolved.date}({resolved.date.slice(0, 10)}){/if}
											</p>
											<button
												class="secondary sm"
												onclick={() => void commitNode()}
												disabled={nodeBusy}
											>
												{nodeBusy ? 'Committing…' : 'Add & commit'}
											</button>
										{:else}
											<button
												class="secondary sm"
												onclick={() => void resolveNode()}
												disabled={nodeBusy || !addUrl.trim()}
											>
												{nodeBusy ? 'Resolving…' : 'Resolve'}
											</button>
										{/if}
									</div>
								{/if}
								{#if nodeError}
									<p class="avail-note">{nodeError}</p>
								{/if}
							{/if}
						{:else if nodeList?.error}
							<p class="avail-note">Custom nodes unavailable — {nodeList.error}</p>
						{:else}
							<p class="node-caveat">Reading the node list…</p>
						{/if}
					</div>

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
	/* Scarce, not absent. Shares the amber of "starting" on purpose — this panel already
	   uses that hue for "proceed, with an eye on it", and one more red-ish token would blur
	   the line with .warn, which means something is actually wrong. The two never appear on
	   the same card anyway: "starting" is a running state, stock only shows on a stopped one. */
	.badge.caution {
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
	/* The pod-image bar: one line of state plus one button, so it reads as a footnote to the
	   fleet rather than competing with the cards for attention. */
	.imagebar {
		margin: 12px 0 0;
	}
	.imagebar-head {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.imagebar-title {
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #7a7a84;
	}
	.imagebar-meta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #8a8a93;
	}
	.imagebar-meta code {
		color: #c3c3cc;
	}
	.bad {
		color: #e0a077;
	}
	.movenote {
		margin: 10px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: #8a8a93;
	}
	.movenote code {
		color: #c3c3cc;
		word-break: break-all;
	}
	.movenote.bad {
		color: #c9a88f;
	}
	.nodes-toggle {
		margin: 10px 0 0;
		padding: 0;
		background: none;
		border: none;
		font-size: 12px;
		color: #8a8a93;
		cursor: pointer;
	}
	.nodes-toggle:hover {
		color: #c3c3cc;
	}
	.nodes {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.node-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}
	.node-name {
		font-size: 13px;
		color: #c3c3cc;
	}
	.node-sha {
		font-size: 11px;
		color: #7a7a84;
	}
	.node-state {
		font-size: 11px;
	}
	.node-state.ok {
		color: #7ee0c0;
	}
	.node-state.caution {
		color: #d8bd77;
	}
	.node-state.muted {
		color: #6a6a76;
	}
	.node-caveat {
		margin: 8px 0 0;
		font-size: 11px;
		line-height: 1.5;
		color: #8a8a93;
	}
	.node-drop {
		padding: 0;
		background: none;
		border: none;
		font-size: 11px;
		color: #8a7a72;
		cursor: pointer;
		text-decoration: underline;
	}
	.node-drop:hover:not(:disabled) {
		color: #e0a077;
	}
	.node-note {
		margin: 2px 0 0;
		font-size: 11px;
		line-height: 1.5;
		color: #7a7a84;
	}
	.node-add {
		display: grid;
		gap: 8px;
		margin: 12px 0 0;
		justify-items: start;
	}
	.node-input {
		width: 100%;
		max-width: 520px;
		padding: 7px 10px;
		font-size: 12px;
		color: #e6e6ee;
		background: #14141a;
		border: 1px solid #2a2a34;
		border-radius: 8px;
	}
	.node-resolved {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #8a8a93;
	}
	.node-resolved code {
		color: #c3c3cc;
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
