<script lang="ts">
	/**
	 * Invisible Flipbook — 🎬 **Video mode** (`docs/design/invisible-flipbook-video.md` step 2).
	 *
	 * Generate N variations of a video from a ComfyUI blueprint, watch them play in a grid, pick
	 * one. Turning the pick into a clip is step 3.
	 *
	 * A separate component, not more of `+page.svelte`: the clip editor is already 1300 lines and
	 * the two modes share no state beyond the project. Everything here talks to
	 * `/api/flipbook/video/*`, which gates on the `flipbook` tool and forwards to the atlas-tool.
	 *
	 * **No `<video>` element anywhere.** The blueprint saves an animated WEBP, which plays, loops
	 * and honours alpha inside a plain `<img>` — so a tile is an image, with no playback state to
	 * manage and no poster frame. The checkerboard behind each tile is load-bearing: it is how the
	 * author sees whether the background cutout actually produced alpha.
	 */
	import { onDestroy } from 'svelte';
	import RegionThumb from '../editor/RegionThumb.svelte';
	import { fetchRegions, type EditorRegion, type RegionSet } from '../editor/editorRegions.client';
	import { cropRegionToPng } from '../editor/regionCrop';

	/** One project atlas, as `+page.server.ts` streams it for the clip editor's region picker. */
	interface SourceAtlas {
		manifestKey: string;
		label: string;
		regions: string[];
	}

	let {
		projectKey,
		canPublish = false,
		atlases = [],
	}: { projectKey: string; canPublish?: boolean; atlases?: SourceAtlas[] } = $props();

	interface BlueprintParam {
		key: string;
		label: string;
		type: 'int' | 'float' | 'text' | 'bool' | 'select';
		default?: unknown;
		min?: number;
		max?: number;
		step?: number;
		options?: string[];
		group?: string;
	}
	interface Blueprint {
		id: string;
		name?: string;
		description?: string;
		params?: BlueprintParam[];
	}
	interface Variation {
		index: number;
		seed: number;
		/** `deleted` is a slot whose render was dropped. It keeps its index — that index IS the
		 * stored filename (`003.webp`) and a clip may have been made from it — so the grid stops
		 * drawing it rather than the array being resequenced under everything else. */
		status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'deleted';
		remote_status?: string;
		/** Set only when THIS slot was re-rolled against a different prompt than the session's.
		 * Empty means it ran the session's prompt. */
		prompt?: string;
		file: string;
		bytes: number;
		error: string;
	}
	/** The whole recipe, not just what the grid needs to draw: the runner records `negative`,
	 * `source_ref` and the param overrides alongside the prompt, and `_public()` returns every
	 * one of them. Declaring them is what lets a finished session be read back and re-run. */
	interface Session {
		id: string;
		blueprint: string;
		blueprint_name?: string;
		prompt: string;
		negative?: string;
		source_ref?: string;
		/** ONLY the params the author overrode — an untouched one was never sent, so it ran at
		 * whatever the blueprint's default was AT THE TIME. That default is not recoverable
		 * (bundled blueprints sync), which is why the recipe panel never claims to show it. */
		params?: Record<string, string | number | boolean>;
		status: 'queued' | 'running' | 'finished' | 'cancelled';
		/** Place in line behind the running session — 0 once it holds the runner (or is done).
		 * Served live and never stored, so it is only ever as fresh as the last poll. */
		queue_position?: number;
		created: number;
		done_count: number;
		variations: Variation[];
	}

	let blueprints = $state<Blueprint[]>([]);
	let blueprintId = $state('');
	let prompt = $state('');
	let negative = $state('');
	let sourceRef = $state('');
	let variations = $state(4);
	/** Param overrides, keyed by param key. Only what the author actually touched — an untouched
	 * param is omitted so the blueprint's own default applies (and keeps applying if it changes). */
	let overrides = $state<Record<string, string | number | boolean>>({});

	let session = $state<Session | null>(null);
	let recent = $state<Session[]>([]);
	let busy = $state(false);
	let err = $state('');
	let loading = $state(true);

	/** Why the blueprint list is empty. Fetched only when it IS empty — an empty
	 * picker used to be indistinguishable between "never seeded", "service has not
	 * restarted since", and "the blueprint was rejected", and none of those say a
	 * word in the UI. See `library_status` in blueprints.py. */
	interface Library {
		in_r2: string[];
		on_disk: string[];
		loaded: { id: string; kind: string; name: string }[];
		skipped: { id: string; why: string }[];
		r2_error: string;
	}
	let library = $state<Library | null>(null);

	const blueprint = $derived(blueprints.find((b) => b.id === blueprintId) ?? null);
	const params = $derived(blueprint?.params ?? []);
	const running = $derived(session?.status === 'running' || session?.status === 'queued');
	/** Is ANY session holding the runner — the selected one or another in the list? Only the
	 * button's wording depends on it (Generate vs Queue), so a stale `recent` costs nothing:
	 * the tool decides what actually happens and answers with the session's real place in line. */
	const anyLive = $derived(
		running || recent.some((s) => s.status === 'running' || s.status === 'queued'),
	);
	/** Params bucketed by their declared `group`, in first-seen order — a plain array rather than a
	 * Map because `svelte/prefer-svelte-reactivity` (rightly) flags a bare Map inside a rune. */
	const paramGroups = $derived.by(() => {
		const groups: { group: string; items: BlueprintParam[] }[] = [];
		for (const p of params) {
			const name = p.group || 'Settings';
			const found = groups.find((g) => g.group === name);
			if (found) found.items.push(p);
			else groups.push({ group: name, items: [p] });
		}
		return groups;
	});

	/** One plain sentence naming the actual cause, derived from the three facts the
	 * tool reports: what R2 holds, what hydrated to disk, and what validated. */
	const verdict = $derived.by(() => {
		if (!library) return '';
		if (library.r2_error) {
			return `The tool cannot reach the asset store, so it is serving whatever was already cached on disk — which is why a freshly seeded blueprint will not appear no matter how many times you restart. Error: ${library.r2_error}`;
		}
		const mine = library.in_r2.filter((id) => !library!.on_disk.includes(id));
		if (mine.length) {
			return `${mine.join(', ')} ${mine.length === 1 ? 'is' : 'are'} in the asset store but ${mine.length === 1 ? 'has' : 'have'} not been pulled to this service yet — restart the Atlas Maker service, which hydrates the library at container start.`;
		}
		if (library.skipped.length) {
			return `Rejected: ${library.skipped.map((s) => `${s.id} (${s.why})`).join('; ')}`;
		}
		const img = library.loaded.filter((b) => b.kind !== 'video');
		if (!library.in_r2.length) {
			return 'The shared blueprint library is empty — nothing has been seeded to the asset store yet.';
		}
		return `The library holds ${library.loaded.length} blueprint${library.loaded.length === 1 ? '' : 's'}, ${img.length} of them image blueprints belonging to the Atlas Maker, and no video ones. Publish a video blueprint, then restart the Atlas Maker service.`;
	});

	const api = (route: string, qs = '') => `/api/flipbook/video/${route}${qs ? `?${qs}` : ''}`;

	async function getJson<T>(route: string, qs = ''): Promise<T> {
		const res = await fetch(api(route, qs));
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
		return (await res.json()) as T;
	}

	async function postJson<T>(route: string, body: unknown): Promise<T> {
		const res = await fetch(api(route), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
		return (await res.json()) as T;
	}

	async function boot(): Promise<void> {
		loading = true;
		err = '';
		try {
			blueprints = await getJson<Blueprint[]>('blueprints');
			if (!blueprintId && blueprints.length) blueprintId = blueprints[0].id;
			// Only when there is nothing to show — this is a diagnosis, not a poll.
			if (!blueprints.length) {
				library = await getJson<Library>('library').catch(() => null);
			}
			recent = await getJson<Session[]>('sessions');
			// Re-attach to a session still running from a previous visit — the runner survives a
			// page reload, so the grid should too rather than looking like nothing happened.
			const live = recent.find((s) => s.status === 'running' || s.status === 'queued');
			session = live ?? recent[0] ?? null;
		} catch (e) {
			err = (e as Error).message;
		}
		loading = false;
	}
	boot();

	function coerce(p: BlueprintParam, raw: string | number | boolean): string | number | boolean {
		if (p.type === 'bool') return Boolean(raw);
		if (p.type === 'int') return Math.round(Number(raw));
		if (p.type === 'float') return Number(raw);
		return String(raw);
	}

	async function generate(): Promise<void> {
		busy = true;
		err = '';
		reuse = null;
		try {
			const payload: Record<string, unknown> = {
				blueprint: blueprintId,
				prompt,
				negative,
				source_ref: sourceRef,
				variations,
				params: Object.fromEntries(
					Object.entries(overrides).flatMap(([k, v]) => {
						const p = params.find((x) => x.key === k);
						return p ? [[k, coerce(p, v)]] : [];
					}),
				),
			};
			const res = await postJson<Session & { error?: string }>('generate', payload);
			// The tool answers user-fixable problems as 200 + {error} so the message can be shown
			// verbatim — a 500 would only say "Internal Error".
			if (res.error) err = res.error;
			else {
				session = res;
				// Refresh the rail so a session that QUEUED shows up in it immediately — the
				// list is otherwise only re-read when a session goes terminal, which for a
				// queued one is a long way off.
				recent = await getJson<Session[]>('sessions');
			}
		} catch (e) {
			err = (e as Error).message;
		}
		busy = false;
	}

	async function cancel(): Promise<void> {
		if (!session) return;
		try {
			// The tool answers a user-fixable refusal as 200 + {error}. Ignoring that
			// is what made this look like a dead button: the request succeeded, the
			// cancel did not, and nothing said so.
			const res = await postJson<{ ok?: boolean; error?: string }>('cancel', {
				session: session.id,
			});
			if (res.error) {
				err = res.error;
				return;
			}
			err = '';
			// Reflect it immediately rather than waiting for the next poll — which,
			// for a session whose worker already died, would never come.
			session = await getJson<Session>('status', `session=${encodeURIComponent(session.id)}`);
		} catch (e) {
			err = (e as Error).message;
		}
	}

	async function removeSession(id: string): Promise<void> {
		try {
			const res = await postJson<{ error?: string }>('delete', { session: id });
			if (res.error) {
				err = res.error;
				return;
			}
			recent = recent.filter((s) => s.id !== id);
			if (session?.id === id) session = recent[0] ?? null;
		} catch (e) {
			err = (e as Error).message;
		}
	}

	// --- polling ---------------------------------------------------------------
	// Only while something is actually in flight. A finished session is terminal, so polling it
	// would be pure noise against a service that cold-starts.
	let timer: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		const id = session?.id;
		const active = running;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (!id || !active) return;
		timer = setInterval(async () => {
			try {
				session = await getJson<Session>('status', `session=${encodeURIComponent(id)}`);
				if (session.status !== 'running' && session.status !== 'queued') {
					recent = await getJson<Session[]>('sessions');
				}
			} catch {
				/* a poll blip is not worth a banner — the next tick retries */
			}
		}, 2500);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	// --- per-variation editing --------------------------------------------------
	// A session's grid is the unit an author actually works in: they compare ten rolls of one
	// idea, throw most away, and chase the two that nearly worked. All three actions below stay
	// INSIDE the session for that reason — a re-roll that opened a new session would scatter one
	// idea across the dropdown and hide the comparison that is the whole point.

	/** The variation whose re-roll panel is open. */
	let regen = $state<Variation | null>(null);
	let regenPrompt = $state('');
	let regenSeed = $state('');
	let regenBusy = $state(false);
	let regenErr = $state('');
	let addCount = $state(4);
	let tileBusy = $state(0);

	/** What a variation actually ran: its own prompt if it was re-rolled against one, else the
	 * session's. Shown on the tile so a grid with mixed prompts never lies about which is which. */
	function effectivePrompt(v: Variation): string {
		return v.prompt || session?.prompt || '';
	}

	function openRegen(v: Variation): void {
		regen = v;
		regenErr = '';
		regenPrompt = effectivePrompt(v);
		regenSeed = String(v.seed);
	}

	async function doRegen(): Promise<void> {
		if (!regen || !session) return;
		regenBusy = true;
		regenErr = '';
		try {
			const res = await postJson<Session & { error?: string }>('regen', {
				session: session.id,
				index: regen.index,
				prompt: regenPrompt,
				seed: regenSeed.trim(),
			});
			if (res.error) regenErr = res.error;
			else {
				session = res;
				regen = null;
				recent = await getJson<Session[]>('sessions');
			}
		} catch (e) {
			regenErr = (e as Error).message;
		}
		regenBusy = false;
	}

	async function discardVariation(v: Variation): Promise<void> {
		if (!session) return;
		const label = `#${String(v.index).padStart(3, '0')}`;
		if (!confirm(`Delete variation ${label}? Its render is removed for good.`)) return;
		tileBusy = v.index;
		try {
			const res = await postJson<Session & { error?: string }>('discard', {
				session: session.id,
				index: v.index,
			});
			if (res.error) err = res.error;
			else {
				err = '';
				session = res;
			}
		} catch (e) {
			err = (e as Error).message;
		}
		tileBusy = 0;
	}

	async function addVariations(): Promise<void> {
		if (!session) return;
		busy = true;
		err = '';
		try {
			const res = await postJson<Session & { error?: string }>('add', {
				session: session.id,
				count: addCount,
			});
			if (res.error) err = res.error;
			else {
				err = '';
				session = res;
				recent = await getJson<Session[]>('sessions');
			}
		} catch (e) {
			err = (e as Error).message;
		}
		busy = false;
	}

	// --- make a clip from a variation ------------------------------------------
	// Two steps, deliberately: the TOOL packs the frames into sheet(s) (Pillow +
	// the MaxRects packer live there), then the LAUNCHER writes the clip doc
	// through the normal `/api/flipbook/save` — clip storage, its ETag
	// compare-and-swap and its edit lease are the launcher's and must stay there.
	interface Probe {
		frames: number;
		width: number;
		height: number;
		fps: number;
		has_alpha: boolean;
		error?: string;
	}
	let making = $state<Variation | null>(null);
	let probe = $state<Probe | null>(null);
	let clipName = $state('');
	let start = $state(0);
	let end = $state(0);
	let stride = $state(1);
	let maxSize = $state(0);
	let packing = $state(false);
	let makeErr = $state('');

	/** What the current range/stride will actually pack — shown BEFORE committing,
	 * because 81 frames is several atlas pages and that should never be a surprise. */
	const willPack = $derived.by(() => {
		if (!probe) return 0;
		const to = end > 0 ? Math.min(end, probe.frames) : probe.frames;
		const from = Math.max(0, Math.min(start, probe.frames - 1));
		return Math.max(0, Math.ceil((to - from) / Math.max(1, stride)));
	});

	async function openMake(v: Variation): Promise<void> {
		making = v;
		probe = null;
		makeErr = '';
		packing = false;
		clipName = `${(session?.blueprint_name ?? 'video').replace(/[^A-Za-z0-9]+/g, '_')}_${String(v.index).padStart(3, '0')}`;
		start = 0;
		stride = 1;
		maxSize = 0;
		try {
			const p = await getJson<Probe>(
				'probe',
				`session=${encodeURIComponent(session!.id)}&v=${v.index}`,
			);
			if (p.error) {
				makeErr = p.error;
				return;
			}
			probe = p;
			end = p.frames;
		} catch (e) {
			makeErr = (e as Error).message;
		}
	}

	async function makeClip(): Promise<void> {
		if (!making || !session) return;
		packing = true;
		makeErr = '';
		try {
			const sheet = await postJson<{
				assetKey: string;
				frames: string[];
				fps: number;
				name: string;
				used_frames: number;
				pages: unknown[];
				error?: string;
			}>('toclip', {
				session: session.id,
				variation: making.index,
				name: clipName,
				start,
				end,
				stride,
				max_size: maxSize,
			});
			if (sheet.error) {
				makeErr = sheet.error;
				return;
			}
			// Mirrors the clip editor's own create path: an unsaved clip sends its NAME as the
			// id (the server slugs it) with `baseEtag: null`, which asserts the id is free.
			const res = await fetch('/api/flipbook/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					clip: {
						id: clipName,
						name: clipName,
						assetKey: sheet.assetKey,
						frames: sheet.frames,
						fps: sheet.fps,
						loop: true,
					},
					projectKey,
					baseEtag: null,
				}),
			});
			const out = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				id?: string;
				message?: string;
			};
			if (res.status === 409) {
				makeErr = out.message ?? 'A clip with that name already exists — rename yours.';
				return;
			}
			if (!res.ok || !out.ok || !out.id) {
				makeErr = out.message ?? `Save failed (${res.status}).`;
				return;
			}
			// Straight into the clip editor with it open — the packed sheet is only half the
			// job, and the author still wants to trim, reorder and set the loop mode.
			window.location.href = `/flipbook?clip=${encodeURIComponent(out.id)}`;
		} catch (e) {
			makeErr = (e as Error).message;
		} finally {
			packing = false;
		}
	}

	// --- publish a video blueprint ---------------------------------------------
	// The Atlas Maker has its own New-blueprint modal, but this one is the VIDEO
	// tool's: it omits the `width`/`height` roles entirely. Binding those on a video
	// blueprint is actively harmful — the generic runner fills them from the
	// atlas-tool's still-image GEN_WIDTH/GEN_HEIGHT, whose default is 1024, and
	// 1024² across an 81-frame batch is a VRAM and wall-clock blowup. A picker that
	// cannot offer the trap is better than one that documents it.
	//
	// The candidate filter below MIRRORS `bpCandidates` in ui_server.py. It cannot
	// be shared — that is a Python-rendered page and this is Svelte, opposite sides
	// of the A/B line in docs/ui-inventory.md — so keep the two in step by hand.
	const PUBLISH_ROLES = [
		{ role: 'positive', field: 'text', required: true, hint: 'the prompt' },
		{ role: 'negative', field: 'text', required: false, hint: '' },
		{ role: 'seed', field: 'seed', required: true, hint: 'per-variation seed' },
		{ role: 'style_ref', field: 'image', required: false, hint: 'the still to animate' },
		{ role: 'shape_ref', field: 'image', required: false, hint: '' },
		{ role: 'output', field: '', required: true, hint: 'the save node' },
	] as const;

	type Graph = Record<
		string,
		{ class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } }
	>;
	let pubOpen = $state(false);
	let pubGraph = $state<Graph | null>(null);
	let pubFile = $state('');
	let pubName = $state('');
	let pubDesc = $state('');
	let pubBindings = $state<Record<string, string>>({});
	let pubParams = $state<
		{ key: string; label: string; type: string; node: string; field: string; def: string }[]
	>([]);
	let pubBusy = $state(false);
	let pubMsg = $state('');

	function candidates(role: string): { id: string; label: string }[] {
		if (!pubGraph) return [];
		const out: { id: string; label: string }[] = [];
		for (const [id, n] of Object.entries(pubGraph)) {
			const ct = String(n?.class_type ?? '');
			const inp = (n?.inputs ?? {}) as Record<string, unknown>;
			let ok = false;
			if (role === 'positive' || role === 'negative') ok = /CLIPTextEncode/i.test(ct);
			else if (role === 'seed') ok = 'seed' in inp || 'noise_seed' in inp;
			else if (role === 'style_ref' || role === 'shape_ref') ok = /LoadImage/i.test(ct);
			// A save node is whatever the runner can stamp `filename_prefix` onto —
			// testing the class name for /SaveImage/ is what hid SaveAnimatedWEBP.
			else if (role === 'output') ok = 'filename_prefix' in inp || /Save|VideoCombine/i.test(ct);
			if (ok) out.push({ id, label: `${n?._meta?.title || ct} #${id}` });
		}
		return out;
	}

	/** Every node input a param could drive, so the author picks rather than types. */
	const paramTargets = $derived.by(() => {
		if (!pubGraph) return [] as { node: string; field: string; label: string }[];
		const out: { node: string; field: string; label: string }[] = [];
		for (const [id, n] of Object.entries(pubGraph)) {
			for (const [field, v] of Object.entries(n?.inputs ?? {})) {
				// A linked input is driven by another node; only widget values are tunable.
				if (Array.isArray(v)) continue;
				out.push({
					node: id,
					field,
					label: `${n?._meta?.title || n?.class_type} #${id} · ${field}`,
				});
			}
		}
		return out;
	});

	async function pickWorkflow(e: Event): Promise<void> {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!f) return;
		pubMsg = '';
		pubFile = f.name;
		try {
			const parsed = JSON.parse(await f.text()) as Graph;
			const nodes = Object.values(parsed ?? {});
			if (!nodes.length || !nodes.every((n) => n && typeof n === 'object' && 'class_type' in n)) {
				pubMsg =
					'That is not an API-format export. In ComfyUI use Settings → "Save (API Format)" — the editor workflow.json carries canvas positions instead of a node dict.';
				pubGraph = null;
				return;
			}
			pubGraph = parsed;
			if (!pubName) pubName = f.name.replace(/\.json$/i, '');
			// Pre-fill anything unambiguous, so the common case is confirm-and-go.
			const next: Record<string, string> = {};
			for (const r of PUBLISH_ROLES) {
				const c = candidates(r.role);
				if (c.length === 1) next[r.role] = c[0].id;
			}
			pubBindings = next;
		} catch (err) {
			pubGraph = null;
			pubMsg = `Could not read that file: ${(err as Error).message}`;
		}
	}

	async function publishBlueprint(overwrite = false): Promise<void> {
		if (!pubGraph) return;
		const missing = PUBLISH_ROLES.filter((r) => r.required && !pubBindings[r.role]);
		if (missing.length) {
			pubMsg = `Bind ${missing.map((m) => m.role).join(', ')} first.`;
			return;
		}
		pubBusy = true;
		pubMsg = '';
		try {
			const bindings: Record<string, { node: string; field?: string }> = {};
			for (const r of PUBLISH_ROLES) {
				const node = pubBindings[r.role];
				if (!node) continue;
				bindings[r.role] = r.role === 'output' ? { node } : { node, field: r.field };
			}
			const res = await fetch(api('publish'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: pubName,
					description: pubDesc,
					base: 'wan22-i2v',
					workflow_text: JSON.stringify(pubGraph),
					bindings,
					params: pubParams
						.filter((p) => p.key && p.node && p.field)
						.map((p) => ({
							key: p.key,
							label: p.label || p.key,
							type: p.type,
							node: p.node,
							field: p.field,
							default:
								p.type === 'bool'
									? p.def === 'true'
									: p.type === 'int' || p.type === 'float'
										? Number(p.def)
										: p.def,
						})),
					overwrite,
				}),
			});
			// The tool answers in PLAIN TEXT, and a user-fixable problem comes back
			// as a readable string with a 200 — so show it verbatim.
			const text = await res.text();
			if (!res.ok) {
				pubMsg = text || `Publish failed (${res.status}).`;
				return;
			}
			if (text.startsWith('⚠') && text.includes('already exists') && !overwrite) {
				if (
					confirm(`${text.replace('⚠ ', '')}

Overwrite it?`)
				) {
					await publishBlueprint(true);
					return;
				}
				pubMsg = text;
				return;
			}
			pubMsg = text;
			if (!text.startsWith('✖')) {
				// Re-list so the new blueprint is selectable without a reload.
				blueprints = await getJson<Blueprint[]>('blueprints');
				const mine = blueprints.find((b) => (b.name ?? '') === pubName);
				if (mine) blueprintId = mine.id;
				pubOpen = false;
			}
		} catch (e) {
			pubMsg = (e as Error).message;
		} finally {
			pubBusy = false;
		}
	}

	// --- source-image picker ---------------------------------------------------
	// THREE sources, one modal. They differ only in where the still comes FROM: each tab ends by
	// setting `sourceRef` to a path the atlas-tool's runner resolves, so nothing downstream — the
	// blueprint, the workflow assembly, the packer — knows which tab was used.
	//   • project — the tool's own `/fsbrowse`, proxied. It is the ONLY thing that knows the
	//     per-root relativization a ref needs (`sheets/…` vs input-rooted `refs/…`), which is why
	//     there is no launcher-side browser here (docs/ui-inventory.md §1).
	//   • region  — cropped out of an atlas page in the browser, then uploaded as its own PNG.
	//     A region is not a file, so it cannot be referenced; it has to become one.
	//   • upload  — a file off the author's disk.
	// The last two both land in `input/refs/flipbook/` via a presigned PUT (see the endpoint for
	// why the bytes do not travel through the launcher).
	type PickTab = 'project' | 'region' | 'upload';
	let picking = $state(false);
	let pickTab = $state<PickTab>('project');
	/** Errors from the PICKER, shown inside the modal — a rail-level `err` would be invisible
	 * behind the backdrop, which is where the first draft put them. */
	let pickErr = $state('');
	/** What is currently being cropped/uploaded, by name — drives the per-item busy state. */
	let pickBusy = $state('');
	/** Object URL previewing a source WE produced, so the rail shows the art and not just a path.
	 * A project pick has no local blob and stays label-only: rebuilding an R2 key from a ref the
	 * tool relativized per root is the exact drift §1 says not to reproduce. */
	let sourcePreview = $state('');
	/** Human label for the pick (region / file name). Falls back to the ref itself. */
	let sourceLabel = $state('');

	/** Cap a local pick client-side. A still this big is already past anything a video blueprint
	 * will keep — the generation size is a param, and the model downscales to it regardless. */
	const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
	const SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

	let pickPath = $state('');
	let pickDirs = $state<{ name: string; path: string }[]>([]);
	let pickFiles = $state<{ name: string; path: string }[]>([]);
	let pickUp = $state<string | null>(null);

	async function browse(path: string): Promise<void> {
		try {
			const r = await getJson<{
				ok: boolean;
				rel: string;
				up: string | null;
				dirs: { name: string; path: string }[];
				files: { name: string; path: string }[];
				error?: string;
			}>('refs', `path=${encodeURIComponent(path)}`);
			if (!r.ok) {
				pickErr = r.error ?? 'Could not browse the project files.';
				return;
			}
			pickPath = r.rel;
			pickDirs = r.dirs;
			pickFiles = r.files;
			pickUp = r.up;
		} catch (e) {
			pickErr = (e as Error).message;
		}
	}

	function openPicker(): void {
		picking = true;
		pickErr = '';
		if (pickTab === 'project' && !pickDirs.length && !pickFiles.length) void browse('');
	}

	function setSource(ref: string, label: string, preview: string): void {
		if (sourcePreview) URL.revokeObjectURL(sourcePreview);
		sourcePreview = preview;
		sourceLabel = label;
		sourceRef = ref;
		pickErr = '';
		picking = false;
	}

	onDestroy(() => {
		if (sourcePreview) URL.revokeObjectURL(sourcePreview);
	});

	const slug = (s: string): string =>
		s
			.toLowerCase()
			.replace(/\.[a-z0-9]+$/, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60);

	/**
	 * Store one image as a project source ref: sign, PUT straight to R2, adopt the ref.
	 *
	 * The name is CONTENT-ADDRESSED. Re-picking the same region (the normal way to iterate on a
	 * prompt) then reuses the same object instead of piling near-duplicates into the project's
	 * refs, and two authors who pick the same art converge on one key rather than clobbering each
	 * other with different bytes under the same name.
	 */
	async function putSource(blob: Blob, stem: string): Promise<void> {
		const type = SOURCE_TYPES.includes(blob.type) ? blob.type : 'image/png';
		const ext = type === 'image/jpeg' ? '.jpg' : type === 'image/webp' ? '.webp' : '.png';
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const digest = await crypto.subtle.digest('SHA-256', bytes);
		const hash = Array.from(new Uint8Array(digest).slice(0, 6))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		const name = `${slug(stem) || 'source'}-${hash}${ext}`;

		const res = await fetch('/api/flipbook/source-url', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, contentType: type }),
		});
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
		const signed = (await res.json()) as { url: string; ref: string };

		// Content-Type is baked into the signature — R2 rejects the PUT without the same header.
		const put = await fetch(signed.url, {
			method: 'PUT',
			headers: { 'Content-Type': type },
			body: bytes,
		});
		if (!put.ok) throw new Error(`Could not upload the image (${put.status}).`);

		setSource(signed.ref, stem, URL.createObjectURL(blob));
	}

	// --- source tab: a region of one of the project's atlases --------------------
	let sheetKey = $state(atlases[0]?.manifestKey ?? '');
	let regionSets = $state<Record<string, RegionSet>>({});
	let regionFilter = $state('');

	function ensureRegions(key: string): void {
		if (!key || regionSets[key]) return;
		void fetchRegions(key).then((set) => {
			if (set) regionSets = { ...regionSets, [key]: set };
		});
	}

	// Fetched only once the tab is actually open: the rail loads on every visit to the mode, and
	// a project's atlas pages are megabytes nobody asked for until they open this picker.
	$effect(() => {
		if (picking && pickTab === 'region') ensureRegions(sheetKey);
	});

	const regionSet = $derived(regionSets[sheetKey] ?? null);
	const visibleRegions = $derived(
		(regionSet?.regions ?? []).filter((r) =>
			regionFilter ? r.name.toLowerCase().includes(regionFilter.toLowerCase()) : true,
		),
	);

	async function pickRegion(region: EditorRegion): Promise<void> {
		const set = regionSet;
		if (!set || pickBusy) return;
		pickBusy = region.name;
		pickErr = '';
		try {
			await putSource(await cropRegionToPng(set, region), region.name);
		} catch (e) {
			pickErr = (e as Error).message;
		}
		pickBusy = '';
	}

	// --- source tab: a file from the author's computer ---------------------------
	let dragOver = $state(false);

	async function pickLocal(file: File | null | undefined): Promise<void> {
		if (!file || pickBusy) return;
		if (!SOURCE_TYPES.includes(file.type)) {
			pickErr = `${file.name} is not a PNG, JPEG or WEBP.`;
			return;
		}
		if (file.size > MAX_SOURCE_BYTES) {
			pickErr = `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`;
			return;
		}
		pickBusy = file.name;
		pickErr = '';
		try {
			await putSource(file, file.name);
		} catch (e) {
			pickErr = (e as Error).message;
		}
		pickBusy = '';
	}

	// --- read a session's recipe back, and re-run it ---------------------------
	// A finished session is not just a grid of results — it is the exact recipe that
	// produced them. Both halves of that matter: SEEING what was asked for (a prompt
	// scrolled out of the rail the moment the next session was selected), and asking
	// for it AGAIN, either verbatim for another roll of the dice or with one word
	// changed. Every field below already travels in the session payload; nothing new
	// is stored and no new endpoint is called.

	/** The blueprint this session RAN on, if the library still has it. `null` is a real state,
	 * not an error: a blueprint can be deleted or renamed after a run, and everything below has
	 * to keep telling the truth about a session whose recipe outlived its network. */
	const recipeBlueprint = $derived(
		session ? (blueprints.find((b) => b.id === session!.blueprint) ?? null) : null,
	);

	/** The recorded overrides, resolved against that blueprint so each one shows its human label.
	 * A key the blueprint no longer declares keeps its raw name and is flagged — the run really
	 * did use it. Flagged only when the blueprint IS present: when the whole blueprint is gone,
	 * "not in the blueprint any more" would be said once per param about a thing that is not
	 * there to have dropped them, so the Blueprint row says it once instead. */
	const recipeParams = $derived.by(() => {
		const used = session?.params;
		if (!used) return [] as { key: string; label: string; value: string; gone: boolean }[];
		const bp = recipeBlueprint;
		return Object.entries(used).map(([key, value]) => {
			const p = bp?.params?.find((x) => x.key === key);
			return {
				key,
				label: p?.label ?? key,
				value: typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value),
				gone: Boolean(bp) && !p,
			};
		});
	});

	/** Outcome of the last "Use these settings", shown next to the button. `warn` marks the
	 * cases where something could NOT be restored — silently dropping a param would send the
	 * author back to Generate believing they were re-running the same recipe. */
	let reuse = $state<{ text: string; warn: boolean } | null>(null);
	/** Focused after a restore: it lands the caret exactly where "change the prompt and
	 * regenerate" starts, and scrolls the rail back to the top on the way. */
	let promptBox: HTMLTextAreaElement | null = $state(null);

	function reuseSettings(): void {
		if (!session) return;
		const s = session;
		const bp = recipeBlueprint;

		prompt = s.prompt ?? '';
		negative = s.negative ?? '';
		variations = Math.min(12, Math.max(1, s.variations?.length || 1));

		// No blob to re-preview: the thumbnail came from bytes this tab cropped or uploaded, and
		// rebuilding an R2 key from a ref the tool relativized per root is the drift §1 warns
		// about. The raw ref is shown instead — it IS what gets sent.
		if (sourcePreview) URL.revokeObjectURL(sourcePreview);
		sourcePreview = '';
		sourceLabel = '';
		sourceRef = s.source_ref ?? '';

		const notes: string[] = [];
		let warn = false;
		if (bp) {
			blueprintId = bp.id;
			// Only keys this blueprint still declares. `generate()` filters unknown keys out at
			// send time anyway, so keeping them would leave the rail holding ghosts that quietly
			// never travel.
			const keep: Record<string, string | number | boolean> = {};
			const dropped: string[] = [];
			for (const [k, v] of Object.entries(s.params ?? {})) {
				if (bp.params?.some((p) => p.key === k)) keep[k] = v;
				else dropped.push(k);
			}
			overrides = keep;
			if (dropped.length) {
				warn = true;
				notes.push(
					`${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} no longer part of this blueprint, so ${dropped.length === 1 ? 'it was' : 'they were'} not restored`,
				);
			}
		} else {
			// Leave the picker where it is and restore no params: they are keyed to a blueprint
			// that is gone, and applying them to whichever one happens to be selected would send
			// a different recipe under the same name.
			warn = true;
			notes.push(
				`the blueprint “${s.blueprint_name ?? s.blueprint}” is no longer in the video library, so the settings could not be restored — only the prompt and source image were`,
			);
		}

		err = '';
		reuse = {
			text: notes.length ? `Loaded, but ${notes.join('; ')}.` : 'Loaded into Generate.',
			warn,
		};
		promptBox?.focus();
	}

	function fmtAge(t: number): string {
		if (!t) return '';
		const mins = Math.round((Date.now() / 1000 - t) / 60);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const h = Math.round(mins / 60);
		return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
	}
</script>

<div class="vbody">
	<aside class="rail">
		<div class="railhead">
			<h3>Generate</h3>
			{#if canPublish}
				<button
					class="sm"
					title="Publish a ComfyUI video network to the shared library"
					onclick={() => (pubOpen = true)}
				>
					＋ Blueprint
				</button>
			{/if}
		</div>

		{#if loading}
			<p class="empty">Loading blueprints…</p>
		{:else if !blueprints.length}
			<p class="empty">
				No <b>video</b> blueprints in the shared library. This list shows only blueprints published as
				video networks — the Atlas Maker's image blueprints belong to a different tool and are deliberately
				not offered here.
			</p>
			{#if verdict}
				<p class="diag">{verdict}</p>
			{/if}
			{#if library}
				<details class="grp">
					<summary>What the tool actually sees</summary>
					<p class="hint">
						<b>In the asset store:</b>
						{library.in_r2.join(', ') || 'nothing'}<br />
						<b>Pulled to this service:</b>
						{library.on_disk.join(', ') || 'nothing'}<br />
						<b>Loaded:</b>
						{library.loaded.map((b) => `${b.id} (${b.kind})`).join(', ') || 'nothing'}
					</p>
				</details>
			{/if}
		{:else}
			<label class="fld">
				<span>Blueprint</span>
				<select bind:value={blueprintId}>
					{#each blueprints as b (b.id)}
						<option value={b.id}>{b.name ?? b.id}</option>
					{/each}
				</select>
			</label>
			{#if blueprint?.description}
				<p class="hint">{blueprint.description}</p>
			{/if}

			<label class="fld">
				<span>Prompt</span>
				<textarea
					bind:this={promptBox}
					bind:value={prompt}
					rows="4"
					placeholder="What should happen in the animation?"
				></textarea>
			</label>

			<label class="fld">
				<span>Negative</span>
				<textarea bind:value={negative} rows="2" placeholder="(optional)"></textarea>
			</label>

			<div class="fld">
				<span>Source image</span>
				<div class="srcrow">
					{#if sourcePreview}
						<img class="srcthumb" src={sourcePreview} alt="" title={sourceRef} />
					{/if}
					<input
						value={sourceLabel || sourceRef}
						readonly
						placeholder="none picked"
						title={sourceRef}
					/>
					<button onclick={openPicker}>Pick…</button>
				</div>
				<p class="hint">
					Image-to-video animates this still. Point it at a symbol's source art and the model moves
					that art — a file already in the project, a region cropped straight out of one of its
					atlases, or an image from your computer.
				</p>
			</div>

			<label class="fld">
				<span>Variations</span>
				<input type="number" min="1" max="12" bind:value={variations} />
			</label>

			{#each paramGroups as g (g.group)}
				<details class="grp">
					<summary>{g.group}</summary>
					{#each g.items as p (p.key)}
						<label class="fld sm">
							<span>{p.label}</span>
							{#if p.type === 'bool'}
								<input
									type="checkbox"
									checked={Boolean(overrides[p.key] ?? p.default)}
									onchange={(e) => (overrides[p.key] = e.currentTarget.checked)}
								/>
							{:else if p.type === 'select'}
								<select
									value={String(overrides[p.key] ?? p.default ?? '')}
									onchange={(e) => (overrides[p.key] = e.currentTarget.value)}
								>
									{#each p.options ?? [] as o (o)}
										<option value={o}>{o}</option>
									{/each}
								</select>
							{:else if p.type === 'text'}
								<input
									value={String(overrides[p.key] ?? p.default ?? '')}
									onchange={(e) => (overrides[p.key] = e.currentTarget.value)}
								/>
							{:else}
								<input
									type="number"
									min={p.min}
									max={p.max}
									step={p.step ?? (p.type === 'int' ? 1 : 0.1)}
									value={Number(overrides[p.key] ?? p.default ?? 0)}
									onchange={(e) => (overrides[p.key] = e.currentTarget.value)}
								/>
							{/if}
						</label>
					{/each}
				</details>
			{/each}

			<!-- Generate is ALWAYS offered. It used to be replaced by Cancel while a session ran,
			     so the only route to a second prompt was killing the first — and a killed session
			     is a paid render thrown away. A second run now lines up behind the first. -->
			<div class="actions">
				<button class="go" onclick={generate} disabled={busy || !blueprintId}>
					{busy ? 'Starting…' : anyLive ? `＋ Queue ${variations}` : `▶ Generate ${variations}`}
				</button>
				{#if running}
					<button class="danger" onclick={cancel}>■ Cancel</button>
				{/if}
			</div>
			{#if anyLive && !busy}
				<p class="hint">
					{running && session?.queue_position
						? 'This session is waiting its turn — nothing has been spent on it yet, so cancelling it is free.'
						: 'A session is running. Queue takes your next idea in line and starts it as soon as the GPU is free — the run in progress is not disturbed.'}
				</p>
			{/if}
			{#if err}<p class="pill err">{err}</p>{/if}
		{/if}
	</aside>

	<section class="main">
		<div class="sessbar">
			{#if recent.length}
				<select
					value={session?.id ?? ''}
					onchange={async (e) => {
						const id = e.currentTarget.value;
						reuse = null;
						session = id
							? await getJson<Session>('status', `session=${encodeURIComponent(id)}`)
							: null;
					}}
				>
					{#each recent as s (s.id)}
						<option value={s.id}>
							{s.blueprint_name ?? s.blueprint} · {s.variations?.length ?? 0} · {fmtAge(s.created)}
							{s.status === 'running' || s.status === 'queued' ? ` · ${s.status}` : ''}
						</option>
					{/each}
				</select>
			{/if}
			{#if session}
				<span class="pill">
					{session.status}{session.queue_position ? ` · #${session.queue_position} in line` : ''}
				</span>
				<span class="spacer"></span>
				<!-- A span, not a label: it wraps a BUTTON as well as the number, and a label
				     would hand the button's clicks to the input. -->
				<span class="addn" title="Add more rolls of this same recipe to this session">
					<input type="number" min="1" max="12" bind:value={addCount} />
					<button class="sm" disabled={busy} onclick={addVariations}>＋ Add</button>
				</span>
				<button
					class="sm reuse"
					title="Load this session's prompt, source image and settings into Generate. Seeds are NOT reused, so running it again gives new variations of the same idea."
					onclick={reuseSettings}>↻ Use these settings</button
				>
				<button
					class="danger sm"
					disabled={running}
					title={running ? 'Cancel the session before deleting it' : 'Delete this session'}
					onclick={() => removeSession(session!.id)}>🗑</button
				>
			{/if}
		</div>

		{#if reuse}
			<p class={reuse.warn ? 'diag' : 'hint'}>{reuse.text}</p>
		{/if}

		{#if session}
			<!-- The recipe that produced this grid. Collapsed by default — the results are what
			     the page is for — but the prompt reads in the summary either way, which is the
			     line that used to scroll away the moment another session was selected. -->
			<details class="recipe">
				<summary><span class="who">{session.prompt || '(no prompt)'}</span></summary>
				<dl>
					<dt>Blueprint</dt>
					<dd>
						{session.blueprint_name ?? session.blueprint}
						{#if !recipeBlueprint}<span class="tag warn">no longer in the video library</span>{/if}
					</dd>
					<dt>Prompt</dt>
					<dd class="txt">{session.prompt || '—'}</dd>
					{#if session.negative}
						<dt>Negative</dt>
						<dd class="txt">{session.negative}</dd>
					{/if}
					<dt>Source image</dt>
					<dd class="txt">{session.source_ref || 'none — text-to-video'}</dd>
					<dt>Variations</dt>
					<dd>{session.variations?.length ?? 0}</dd>
					{#if recipeParams.length}
						<dt>Changed settings</dt>
						<dd>
							<ul class="prm">
								{#each recipeParams as p (p.key)}
									<li class:gone={p.gone}>
										{p.label}<code>{p.value}</code>{#if p.gone}<span class="tag"
												>not in the blueprint any more</span
											>{/if}
									</li>
								{/each}
							</ul>
						</dd>
					{/if}
				</dl>
				<p class="hint">
					Only settings that were <b>changed</b> are recorded — everything else ran at the blueprint's
					own default, and since a blueprint can be updated after a run, that default is not something
					this panel can honestly show you after the fact. Seeds are per variation: hover a tile's seed
					to copy the one that reproduces it exactly.
				</p>
			</details>
		{/if}

		{#if !session}
			<p class="empty big">No video sessions yet. Generate one to fill this grid.</p>
		{:else}
			<div class="grid">
				{#each session.variations.filter((v) => v.status !== 'deleted') as v (v.index)}
					<figure class="tile" class:failed={v.status === 'failed'}>
						<div class="thumb">
							{#if v.status === 'done' && v.file}
								<!-- Animated WEBP: it plays and loops on its own. -->
								<img
									src={api(
										'file',
										`session=${encodeURIComponent(session.id)}&v=${encodeURIComponent(v.file)}`,
									)}
									alt={`variation ${v.index}`}
								/>
							{:else if v.status === 'failed'}
								<span class="state bad" title={v.error}>failed</span>
							{:else if v.status === 'cancelled'}
								<span class="state">cancelled</span>
							{:else if v.status === 'running'}
								<span class="state live">{v.remote_status || 'running'}…</span>
							{:else}
								<span class="state">queued</span>
							{/if}
						</div>
						<!-- TWO rows, not one. A 16-digit seed plus four controls needs ~300px and a
						     grid column bottoms out at 220 — as one flex row the last buttons were
						     pushed clean out of the card. -->
						<figcaption>
							<div class="crow">
								<span class="ix">#{String(v.index).padStart(3, '0')}</span>
								<button
									class="seed"
									title="Copy this seed — it reproduces this exact render"
									onclick={() => navigator.clipboard?.writeText(String(v.seed))}
								>
									{v.seed}
								</button>
							</div>
							<div class="crow">
								<button
									class="make"
									disabled={v.status !== 'done'}
									title="Pack these frames into a sheet and create a clip"
									onclick={() => openMake(v)}
								>
									🎞 Make flipbook
								</button>
								<button
									class="tico"
									disabled={v.status === 'running' || tileBusy === v.index}
									title={v.status === 'running'
										? 'Still rendering — cancel the session first'
										: 'Re-roll this one: change the prompt, hold or re-roll the seed'}
									onclick={() => openRegen(v)}>↻</button
								>
								<button
									class="tico danger"
									disabled={v.status === 'running' || tileBusy === v.index}
									title={v.status === 'running'
										? 'Still rendering — cancel the session first'
										: 'Delete this variation'}
									onclick={() => discardVariation(v)}>🗑</button
								>
							</div>
						</figcaption>
						{#if v.prompt}
							<p class="tileprompt" title={v.prompt}>↻ {v.prompt}</p>
						{/if}
						{#if v.status === 'failed' && v.error}
							<p class="tileerr">{v.error}</p>
						{/if}
					</figure>
				{/each}
			</div>
		{/if}
	</section>

	{#if regen && session}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (regen = null)}></div>
		<div class="picker">
			<header>
				<strong>Re-roll #{String(regen.index).padStart(3, '0')}</strong>
				<button onclick={() => (regen = null)}>✕</button>
			</header>

			{#if regenErr}
				<p class="pill err">{regenErr}</p>
			{/if}

			<label class="fld">
				<span>Prompt</span>
				<textarea bind:value={regenPrompt} rows="4"></textarea>
			</label>
			<label class="fld">
				<span>Seed</span>
				<div class="srcrow">
					<input bind:value={regenSeed} placeholder="blank = a new one" />
					<button onclick={() => (regenSeed = '')}>🎲 New</button>
				</div>
			</label>
			<p class="hint">
				The two knobs are independent, and that is the point. <b>Hold the seed</b> and change the
				prompt to see what one word does to a fixed roll of the dice. <b>Hold the prompt</b>
				and take a new seed for another roll of the same idea. A changed prompt is recorded on this tile
				alone — the session keeps the prompt that describes the rest of the grid.
			</p>
			<p class="hint">
				This replaces #{String(regen.index).padStart(3, '0')} in place, and costs one more GPU job. The
				render that is there now is deleted.
			</p>
			<div class="actions">
				<button class="go" disabled={regenBusy || !regenPrompt.trim()} onclick={doRegen}>
					{regenBusy ? 'Starting…' : '↻ Re-roll it'}
				</button>
			</div>
		</div>
	{/if}

	{#if making}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (making = null)}></div>
		<div class="picker wide">
			<header>
				<strong>Make a flipbook from #{String(making.index).padStart(3, '0')}</strong>
				<button onclick={() => (making = null)}>✕</button>
			</header>

			{#if makeErr}
				<p class="pill err">{makeErr}</p>
			{/if}

			{#if !probe}
				<p class="empty">Reading the animation…</p>
			{:else}
				<p class="hint">
					{probe.frames} frames · {probe.width}×{probe.height} · {probe.fps} fps
				</p>
				{#if !probe.has_alpha}
					<p class="pill err">
						These frames have no transparency — the background cutout was off, or it produced none.
						Packing them gives opaque rectangles, not symbol art.
					</p>
				{/if}

				<label class="fld">
					<span>Clip name</span>
					<input bind:value={clipName} disabled={packing} />
				</label>

				<div class="row">
					<label class="fld sm"
						><span>From</span>
						<input
							type="number"
							min="0"
							max={probe.frames - 1}
							bind:value={start}
							disabled={packing}
						/></label
					>
					<label class="fld sm"
						><span>To</span>
						<input
							type="number"
							min="1"
							max={probe.frames}
							bind:value={end}
							disabled={packing}
						/></label
					>
					<label class="fld sm"
						><span>Every</span>
						<input type="number" min="1" max="8" bind:value={stride} disabled={packing} /></label
					>
					<label class="fld sm"
						><span>Max px</span>
						<input
							type="number"
							min="0"
							max="1024"
							step="16"
							bind:value={maxSize}
							disabled={packing}
						/></label
					>
				</div>

				<p class="hint">
					<b>{willPack}</b> frame{willPack === 1 ? '' : 's'} will be packed at
					{(probe.fps / Math.max(1, stride)).toFixed(1)} fps. Frames are alpha-trimmed, so the cost is
					ink, not canvas — but every frame is atlas space, and a clip spanning several pages is normal.
				</p>

				<div class="actions">
					<button class="go" disabled={packing || !willPack || !clipName.trim()} onclick={makeClip}>
						{packing ? 'Packing…' : `🎞 Pack ${willPack} frames & create clip`}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if pubOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (pubOpen = false)}></div>
		<div class="picker wide">
			<header>
				<strong>Publish a video blueprint</strong>
				<button onclick={() => (pubOpen = false)}>✕</button>
			</header>
			<p class="hint">
				Pick a ComfyUI <b>API-format</b> export (Settings → “Save (API Format)”), then point each
				role at a node. It publishes as a <b>video</b> blueprint, so it appears here and not in the Atlas
				Maker.
			</p>

			<label class="fld">
				<span>Workflow file</span>
				<input type="file" accept=".json" onchange={pickWorkflow} disabled={pubBusy} />
			</label>
			{#if pubFile}<p class="hint">{pubFile}</p>{/if}

			{#if pubGraph}
				<label class="fld"><span>Name</span><input bind:value={pubName} disabled={pubBusy} /></label
				>
				<label class="fld"
					><span>Description</span><textarea bind:value={pubDesc} rows="2" disabled={pubBusy}
					></textarea></label
				>

				<div class="fld"><span>Bindings (role → node)</span></div>
				{#each PUBLISH_ROLES as r (r.role)}
					<label class="fld sm">
						<span>{r.role}{r.required ? ' *' : ''}{r.hint ? ` — ${r.hint}` : ''}</span>
						<select
							value={pubBindings[r.role] ?? ''}
							disabled={pubBusy}
							onchange={(e) => (pubBindings = { ...pubBindings, [r.role]: e.currentTarget.value })}
						>
							<option value="">(not used)</option>
							{#each candidates(r.role) as c (c.id)}
								<option value={c.id}>{c.label}</option>
							{/each}
						</select>
					</label>
				{/each}
				<p class="hint">
					There is deliberately no <b>width</b>/<b>height</b> role here. On a video blueprint the runner
					would fill them from the Atlas Maker's still-image defaults (1024), and 1024² across an 80-frame
					batch is a VRAM and wall-clock blowup. Expose generation size as a setting below instead.
				</p>

				<div class="fld">
					<span>Exposed settings (optional)</span>
					<button
						class="sm"
						disabled={pubBusy}
						onclick={() =>
							(pubParams = [
								...pubParams,
								{ key: '', label: '', type: 'int', node: '', field: '', def: '' },
							])}>＋ Add</button
					>
				</div>
				{#each pubParams as prm, i (i)}
					<div class="prow">
						<input placeholder="key" bind:value={prm.key} disabled={pubBusy} />
						<select bind:value={prm.type} disabled={pubBusy}>
							<option>int</option><option>float</option><option>text</option>
							<option>bool</option><option>select</option>
						</select>
						<select
							value={prm.node && prm.field ? `${prm.node}::${prm.field}` : ''}
							disabled={pubBusy}
							onchange={(e) => {
								const [n, f] = e.currentTarget.value.split('::');
								prm.node = n ?? '';
								prm.field = f ?? '';
							}}
						>
							<option value="">(node · input)</option>
							{#each paramTargets as t (t.node + t.field)}
								<option value={`${t.node}::${t.field}`}>{t.label}</option>
							{/each}
						</select>
						<input placeholder="default" bind:value={prm.def} disabled={pubBusy} />
						<button
							class="danger sm"
							disabled={pubBusy}
							onclick={() => (pubParams = pubParams.filter((_, j) => j !== i))}>✕</button
						>
					</div>
				{/each}

				<div class="actions">
					<button
						class="go"
						disabled={pubBusy || !pubName.trim()}
						onclick={() => publishBlueprint()}
					>
						{pubBusy ? 'Publishing…' : '⬆ Publish blueprint'}
					</button>
				</div>
			{/if}
			{#if pubMsg}<p class="pill err">{pubMsg}</p>{/if}
		</div>
	{/if}

	{#if picking}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (picking = false)}></div>
		<div class="picker wide">
			<header>
				<strong>Pick a source image</strong>
				<button onclick={() => (picking = false)}>✕</button>
			</header>

			<div class="tabs">
				<button
					class:on={pickTab === 'project'}
					onclick={() => {
						pickTab = 'project';
						pickErr = '';
						if (!pickDirs.length && !pickFiles.length) void browse('');
					}}>📁 Project files</button
				>
				<button
					class:on={pickTab === 'region'}
					onclick={() => {
						pickTab = 'region';
						pickErr = '';
					}}>🧩 Atlas region</button
				>
				<button
					class:on={pickTab === 'upload'}
					onclick={() => {
						pickTab = 'upload';
						pickErr = '';
					}}>⬆ From my computer</button
				>
			</div>

			{#if pickErr}<p class="pill err">{pickErr}</p>{/if}

			{#if pickTab === 'project'}
				<p class="crumb">{pickPath || '(root)'}</p>
				<ul>
					{#if pickUp !== null}
						<li><button onclick={() => browse(pickUp ?? '')}>⬆ up</button></li>
					{/if}
					{#each pickDirs as d (d.path)}
						<li><button onclick={() => browse(d.path)}>📁 {d.name}</button></li>
					{/each}
					{#each pickFiles as f (f.path)}
						<li>
							<button class="file" onclick={() => setSource(f.path, f.name, '')}>🖼 {f.name}</button
							>
						</li>
					{/each}
				</ul>
				{#if !pickDirs.length && !pickFiles.length}
					<p class="empty">Nothing here.</p>
				{/if}
			{:else if pickTab === 'region'}
				{#if atlases.length === 0}
					<p class="empty">
						This project has no atlases yet. Pack one in the Sheet Maker or the Atlas Maker and its
						regions appear here.
					</p>
				{:else}
					<div class="rtools">
						<select bind:value={sheetKey} disabled={!!pickBusy}>
							{#each atlases as a (a.manifestKey)}
								<option value={a.manifestKey}>{a.label}</option>
							{/each}
						</select>
						<input placeholder="Filter regions…" bind:value={regionFilter} />
					</div>
					<p class="crumb">
						The region is cropped at its own size, keeping its untrimmed frame and its alpha — the
						still the model animates is exactly the art the game draws.
					</p>
					<div class="rgrid">
						{#each visibleRegions as region (region.name)}
							<button
								class="cell"
								class:busy={pickBusy === region.name}
								title={region.name}
								disabled={!!pickBusy}
								onclick={() => pickRegion(region)}
							>
								{#if regionSet}<RegionThumb set={regionSet} {region} size={56} />{/if}
								<span class="cn">{pickBusy === region.name ? 'Uploading…' : region.name}</span>
							</button>
						{:else}
							<p class="empty">{regionSet ? 'No regions match.' : 'Loading regions…'}</p>
						{/each}
					</div>
				{/if}
			{:else}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="drop"
					class:over={dragOver}
					ondragover={(e) => {
						e.preventDefault();
						dragOver = true;
					}}
					ondragleave={() => (dragOver = false)}
					ondrop={(e) => {
						e.preventDefault();
						dragOver = false;
						void pickLocal(e.dataTransfer?.files?.[0]);
					}}
				>
					<p>{pickBusy ? `Uploading ${pickBusy}…` : 'Drop an image here'}</p>
					<label class="choose">
						Choose a file…
						<input
							type="file"
							accept="image/png,image/jpeg,image/webp"
							disabled={!!pickBusy}
							onchange={(e) => {
								void pickLocal(e.currentTarget.files?.[0]);
								e.currentTarget.value = '';
							}}
						/>
					</label>
				</div>
				<p class="crumb">
					PNG, JPEG or WEBP, up to {MAX_SOURCE_BYTES / 1024 / 1024} MB. The file is copied into this
					project's asset store, so the same still can be reused for another run without picking it off
					your disk again.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.vbody {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.empty {
		color: #64748b;
		font-size: 12px;
		padding: 6px 2px;
	}
	.empty.big {
		padding: 40px;
		text-align: center;
	}
	.pill {
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		font-size: 11px;
	}
	.pill.err {
		color: #fca5a5;
		display: block;
		margin-top: 8px;
		padding: 6px 8px;
		line-height: 1.4;
	}
	.railhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	button.sm {
		font-size: 11px;
		padding: 3px 7px;
	}
	.prow {
		display: flex;
		gap: 4px;
		margin-bottom: 5px;
	}
	.prow input {
		min-width: 0;
		flex: 1;
	}
	.prow select {
		min-width: 0;
		flex: 1.4;
	}
	.diag {
		color: #fbbf24;
		font-size: 11px;
		line-height: 1.5;
		margin: 0 0 10px;
		padding: 8px;
		border: 1px solid #78350f;
		border-radius: 6px;
		background: #1c1408;
	}
	.hint {
		color: #64748b;
		font-size: 11px;
		margin: 2px 0 10px;
		line-height: 1.45;
	}

	.rail {
		width: 280px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #1f2937;
		padding: 12px;
		overflow-y: auto;
	}
	.fld {
		display: block;
		margin-bottom: 10px;
	}
	.fld > span {
		display: block;
		font-size: 11px;
		color: #94a3b8;
		margin-bottom: 3px;
	}
	.fld.sm {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}
	.fld.sm > span {
		margin: 0;
		flex: 1;
		line-height: 1.3;
	}
	.fld.sm input[type='number'],
	.fld.sm select,
	.fld.sm input:not([type='checkbox']) {
		width: 90px;
		flex: none;
	}
	input,
	select,
	textarea {
		width: 100%;
		box-sizing: border-box;
		background: #10161e;
		border: 1px solid #1f2937;
		border-radius: 6px;
		color: #cbd5e1;
		padding: 5px 7px;
		font-size: 12px;
		font-family: inherit;
	}
	textarea {
		resize: vertical;
	}
	input[type='checkbox'] {
		width: auto;
	}
	.srcrow {
		display: flex;
		gap: 6px;
	}
	.srcrow input {
		flex: 1;
		min-width: 0;
	}
	.grp {
		border-top: 1px solid #1f2937;
		padding-top: 8px;
		margin-bottom: 8px;
	}
	.grp summary {
		font-size: 11px;
		color: #94a3b8;
		cursor: pointer;
		margin-bottom: 6px;
	}
	button {
		background: #1f2937;
		border: 1px solid #2a3646;
		border-radius: 6px;
		color: #cbd5e1;
		padding: 5px 9px;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #27364a;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.actions {
		margin-top: 6px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.actions .danger {
		width: 100%;
		padding: 6px;
	}
	.go {
		width: 100%;
		background: #14532d;
		border-color: #166534;
		color: #86efac;
		padding: 8px;
	}
	.danger {
		color: #fca5a5;
	}
	.danger.sm {
		padding: 3px 7px;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 12px;
		overflow-y: auto;
	}
	.sessbar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.sessbar select {
		width: auto;
		max-width: 320px;
	}
	.sessbar .spacer {
		flex: 1;
	}
	.reuse {
		color: #93c5fd;
		border-color: #1e3a5f;
	}
	.who {
		color: #64748b;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.recipe {
		border: 1px solid #1f2937;
		border-radius: 8px;
		background: #10161e;
		padding: 6px 10px;
		margin-bottom: 12px;
	}
	.recipe summary {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		color: #94a3b8;
		font-size: 11px;
	}
	/* `display: flex` drops the native disclosure marker (it only renders for `list-item`), so
	   the row would read as a plain line of grey text with nothing to say it opens. */
	.recipe summary::marker,
	.recipe summary::-webkit-details-marker {
		display: none;
		content: '';
	}
	.recipe summary::before {
		content: '▸';
		flex: none;
		color: #64748b;
		transition: transform 0.12s ease;
	}
	.recipe[open] summary::before {
		transform: rotate(90deg);
	}
	.recipe dl {
		display: grid;
		grid-template-columns: 120px 1fr;
		gap: 4px 12px;
		margin: 10px 0 0;
		font-size: 12px;
	}
	.recipe dt {
		color: #64748b;
		font-size: 11px;
		padding-top: 1px;
	}
	.recipe dd {
		margin: 0;
		color: #cbd5e1;
		min-width: 0;
	}
	/* Free text can be a paragraph or a path with no spaces in it — both have to wrap
	   rather than push the grid wider than the column. */
	.recipe dd.txt {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.45;
	}
	.recipe .prm {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
	}
	.recipe .prm li {
		color: #94a3b8;
		font-size: 11px;
	}
	.recipe .prm li.gone {
		color: #fbbf24;
	}
	.recipe .prm code {
		color: #cbd5e1;
		background: #1f2937;
		border-radius: 4px;
		padding: 1px 5px;
		margin-left: 5px;
		font-size: 11px;
	}
	.recipe .tag {
		margin-left: 6px;
		font-style: italic;
		font-size: 11px;
	}
	.recipe .tag.warn {
		color: #fbbf24;
	}
	.recipe .hint {
		margin: 10px 0 2px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.tile {
		margin: 0;
		border: 1px solid #1f2937;
		border-radius: 8px;
		overflow: hidden;
		background: #10161e;
	}
	.tile.failed {
		border-color: #7f1d1d;
	}
	.thumb {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		/* The checkerboard is load-bearing: it is how the author sees whether the blueprint's
		   background cutout actually produced alpha, rather than a matte-coloured rectangle. */
		background-color: #0b0e13;
		background-image:
			linear-gradient(45deg, #171c25 25%, transparent 25%),
			linear-gradient(-45deg, #171c25 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #171c25 75%),
			linear-gradient(-45deg, transparent 75%, #171c25 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
	}
	.thumb img {
		max-width: 100%;
		max-height: 100%;
		display: block;
	}
	.state {
		font-size: 11px;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.state.live {
		color: #7ee0c0;
	}
	.state.bad {
		color: #fca5a5;
	}
	figcaption {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 8px;
		border-top: 1px solid #1f2937;
	}
	.crow {
		display: flex;
		align-items: center;
		gap: 6px;
		/* Without this a flex child refuses to shrink below its content, and the long
		   seed pushes the row wider than the card instead of ellipsing. */
		min-width: 0;
	}
	.ix {
		font-size: 11px;
		color: #64748b;
		flex: 0 0 auto;
	}
	.seed {
		font-size: 10px;
		padding: 2px 6px;
		font-family: ui-monospace, monospace;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.make {
		font-size: 10px;
		padding: 2px 6px;
		/* Takes the row; the two icon buttons keep their natural width beside it. */
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tico {
		font-size: 11px;
		padding: 2px 5px;
		line-height: 1;
		flex: 0 0 auto;
	}
	.tico.danger {
		color: #fca5a5;
	}
	.tileprompt {
		margin: 0;
		padding: 4px 8px;
		font-size: 10px;
		color: #94a3b8;
		border-top: 1px solid #1f2937;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.addn {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.addn input {
		width: 46px;
		font-size: 11px;
		padding: 2px 4px;
	}
	.tileerr {
		margin: 0;
		padding: 6px 8px;
		font-size: 10px;
		color: #fca5a5;
		border-top: 1px solid #1f2937;
		line-height: 1.4;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 40;
	}
	.picker {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(460px, 92vw);
		max-height: 66vh;
		overflow-y: auto;
		background: #0f141b;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 12px;
		z-index: 41;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
	}
	.picker header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.crumb {
		color: #64748b;
		font-size: 11px;
		margin: 0 0 8px;
	}
	.picker ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.picker li button {
		width: 100%;
		text-align: left;
		background: #10161e;
	}
	.picker.wide {
		width: min(560px, 94vw);
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.row .fld.sm {
		flex: 1;
		display: block;
	}
	.row .fld.sm > span {
		margin-bottom: 3px;
	}
	.row .fld.sm input[type='number'] {
		width: 100%;
	}
	.picker li button.file {
		color: #a5d8ff;
	}

	.srcthumb {
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 4px;
		object-fit: contain;
		background:
			repeating-conic-gradient(#20262f 0% 25%, #171c24 0% 50%) 50% / 10px 10px,
			#171c24;
		border: 1px solid #1f2937;
	}

	.tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 10px;
	}
	.tabs button {
		flex: 1;
		font-size: 11px;
		padding: 5px 4px;
		background: #10161e;
		color: #94a3b8;
	}
	.tabs button.on {
		background: #1d283a;
		color: #e2e8f0;
		border-color: #334155;
	}

	.rtools {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}
	.rtools select {
		flex: 2;
		min-width: 0;
	}
	.rtools input {
		flex: 1;
		min-width: 0;
	}
	.rgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 6px;
	}
	.rgrid .cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 5px 3px;
		background: #10161e;
	}
	.rgrid .cell.busy {
		border-color: #3b82f6;
	}
	.rgrid .cn {
		font-size: 9px;
		color: #94a3b8;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.drop {
		display: grid;
		place-items: center;
		gap: 8px;
		padding: 26px 12px;
		border: 1px dashed #334155;
		border-radius: 8px;
		background: #0d1219;
		text-align: center;
	}
	.drop.over {
		border-color: #3b82f6;
		background: #101a28;
	}
	.drop p {
		margin: 0;
		color: #94a3b8;
		font-size: 12px;
	}
	.choose {
		font-size: 11px;
		padding: 5px 10px;
		border-radius: 6px;
		border: 1px solid #1f2937;
		background: #10161e;
		color: #cbd5e1;
		cursor: pointer;
	}
	.choose input {
		display: none;
	}
</style>
