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
	import { invalidateAll } from '$app/navigation';
	import { findUnexposedGates } from '$lib/blueprintGates';
	import RunPicker, { type RunPickerItem } from '$lib/RunPicker.svelte';
	import RegionThumb, { clearPageImages } from '../editor/RegionThumb.svelte';
	import {
		clearRegionCache,
		fetchRegions,
		type EditorRegion,
		type RegionSet,
	} from '../editor/editorRegions.client';
	import { clearCropPages, cropRegionToPng } from '../editor/regionCrop';

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
		/** A `text` param whose value is PROSE — a second prompt, a caption — rather than a token
		 * like `#222222`. It gets the full-width box a prompt needs instead of the narrow inline
		 * input every other setting shares. A graph with two prompts (this animation's first and
		 * second half) can only bind ONE to the `positive` role; the other reaches the author as a
		 * setting, and a 90px input is not a place anyone can write a prompt. */
		multiline?: boolean;
		/** Where a `select`'s list is re-read LIVE (`comfy_specs.param_class_field`). */
		options_from?: { class: string; field: string };
		/** A saved or default value the LIVE list lacks — kept in `options` and marked, never
		 * silently replaced. Set by the panel, never published. */
		missingOption?: string;
	}
	interface Blueprint {
		id: string;
		name?: string;
		description?: string;
		params?: BlueprintParam[];
	}
	/** One node input's REAL contract, as `comfy_specs.normalize_input` shapes it. */
	interface NodeSpec {
		kind: 'int' | 'float' | 'bool' | 'text' | 'select';
		default?: unknown;
		min?: number;
		max?: number;
		step?: number;
		options?: string[];
		multiline?: boolean;
	}
	/** `nodespecs` answers by class (the importer's graph) or by param key (a blueprint). `ok`
	 * false is the NORMAL "nothing answered" case, not an error; `note` says why in a sentence. */
	interface NodeSpecs {
		ok: boolean;
		source: string;
		note: string;
		classes?: Record<string, Record<string, NodeSpec>>;
		params?: Record<string, NodeSpec>;
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
		/** Set only on a slot DUPLICATED with changed settings, and only for what actually
		 * differs from the session's recipe. Keys are read by PRESENCE, not truth — a duplicate
		 * made to drop the negative stores `{negative: ''}`, which means "none", not "the
		 * session's". Absent entirely on every slot that ran the session's recipe. */
		settings?: {
			negative?: string;
			source_ref?: string;
			params?: Record<string, string | number | boolean>;
		};
		/** Which slot this one was duplicated from. Provenance for the grid; nothing reads it back. */
		from_index?: number;
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
	/** The blueprint this session RAN on, if the library still has it. `null` is a real state,
	 * not an error: a blueprint can be deleted or renamed after a run, and everything below has
	 * to keep telling the truth about a session whose recipe outlived its network. */
	const recipeBlueprint = $derived(
		session ? (blueprints.find((b) => b.id === session!.blueprint) ?? null) : null,
	);

	/** Each param's LIVE contract for the selected blueprint — what the ComfyUI answering
	 * `nodespecs` declares today, so a model dropped on the pod's volume is in the dropdown with
	 * no re-import. Empty until it lands and whenever nothing answers (a sleeping pod is the
	 * normal case), in which case the baked declarations stand. */
	let liveSpecs = $state<Record<string, NodeSpec>>({});
	$effect(() => {
		const id = blueprintId;
		liveSpecs = {};
		if (!id) return;
		postJson<NodeSpecs>('nodespecs', { blueprint: id })
			.then((r) => {
				if (id === blueprintId && r.ok) liveSpecs = r.params ?? {};
			})
			.catch(() => {});
	});
	/** The declarations the panel draws: baked, with the live contract laid over where one
	 * answered. A saved or default value the live list lacks is kept and marked rather than
	 * silently replaced — a model uninstalled from the pod must not rewrite anyone's setting. */
	const params = $derived.by(() =>
		(blueprint?.params ?? []).map((p): BlueprintParam => {
			const live = liveSpecs[p.key];
			if (!live) return p;
			if (p.type === 'select' && live.kind === 'select' && live.options?.length) {
				const cur = String(overrides[p.key] ?? p.default ?? '');
				const missing = cur && !live.options.includes(cur) ? cur : undefined;
				return {
					...p,
					options: missing ? [...live.options, missing] : live.options,
					missingOption: missing,
				};
			}
			const numeric = p.type === 'int' || p.type === 'float';
			if (numeric && (live.kind === 'int' || live.kind === 'float')) {
				return {
					...p,
					min: live.min ?? p.min,
					max: live.max ?? p.max,
					step: live.step ?? p.step,
				};
			}
			return p;
		}),
	);
	/** A numeric param with BOTH bounds declared — the only kind a slider can honestly draw. */
	const bounded = (p: BlueprintParam) =>
		(p.type === 'int' || p.type === 'float') && Number.isFinite(p.min) && Number.isFinite(p.max);
	/** Clamp a typed number into the param's declared domain. HTML `min`/`max` on a number input
	 * only fail form validation — they never stopped a 50 being typed into a 0..1 field and sent,
	 * which is how ComfyUI came to reject a whole prompt over one `sensitivity`. */
	function clampTo(p: BlueprintParam, raw: string): number {
		const n = Number(raw);
		if (!Number.isFinite(n)) return Number(p.default ?? p.min ?? 0);
		const c = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
		return p.type === 'int' ? Math.round(c) : c;
	}
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

	/** An override bag coerced to the types its blueprint declares, with keys that blueprint no
	 * longer has dropped. Takes the DECLARATIONS rather than reading `params`: the duplicate
	 * panel edits against the SESSION's blueprint, which is not necessarily the one selected in
	 * the rail, and sending a value typed against the wrong schema is a graph rejection on the
	 * GPU rather than an error anything here can show. */
	function coerceBag(
		bag: Record<string, string | number | boolean>,
		decls: BlueprintParam[],
	): Record<string, string | number | boolean> {
		return Object.fromEntries(
			Object.entries(bag).flatMap(([k, v]) => {
				const p = decls.find((x) => x.key === k);
				return p ? [[k, coerce(p, v)]] : [];
			}),
		);
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
				params: coerceBag(overrides, params),
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
			const res = await postJson<{ ok?: boolean; error?: string; warning?: string }>('cancel', {
				session: session.id,
			});
			if (res.error) {
				err = res.error;
				return;
			}
			// A cancel RunPod would not take leaves a job rendering at full cost while
			// every surface here says it stopped. That is the one thing the author must
			// not have to discover from the billing page, so it shows where an error
			// would — the stop itself still stands.
			err = res.warning ?? '';
			// Reflect it immediately rather than waiting for the next poll — which,
			// for a session whose worker already died, would never come.
			session = await getJson<Session>('status', `session=${encodeURIComponent(session.id)}`);
		} catch (e) {
			err = (e as Error).message;
		}
	}

	/** Delete a whole session — every render in its grid, from R2 as well as staging.
	 *
	 * Takes the SESSION, not its id, so the prompt can say what is actually being destroyed.
	 * Dropping ONE variation already confirmed; dropping the whole grid it belongs to did not,
	 * which had it backwards — this is the irreversible one, and the only way a session goes
	 * away at all (nothing prunes `<project>/video/`). Sheets already packed out of it live
	 * under `sheets/`, untouched by the delete, so the prompt says so rather than leaving an
	 * author afraid of losing a clip they already made. */
	async function removeSession(s: Session): Promise<void> {
		const live = (s.variations ?? []).filter((v) => v.status !== 'deleted').length;
		if (
			!confirm(
				`Delete the session “${runTitle(s)}”?\n\n` +
					`Its ${live} ${live === 1 ? 'render' : 'renders'} ${live === 1 ? 'is' : 'are'} ` +
					`removed from cloud storage for good. Sheets already packed from it are kept.`,
			)
		) {
			return;
		}
		try {
			const res = await postJson<{ error?: string }>('delete', { session: s.id });
			// A refused delete is reported, never drawn as a session that went away:
			// `delete_session` VERIFIES against R2 and errors if anything survived, so
			// dropping the row here would hide an orphan nobody can reach.
			if (res.error) {
				err = res.error;
				return;
			}
			recent = recent.filter((r) => r.id !== s.id);
			if (session?.id === s.id) session = recent[0] ?? null;
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

	/** What a variation actually RAN: the session's recipe with that slot's own overrides laid
	 * over it. The twin of `_variation_recipe` in `video_runner.py` and it has to stay one —
	 * this is what the tile reports and what the duplicate panel opens with, and either drifting
	 * from what the runner builds means the grid describes renders it did not produce. */
	function variationRecipe(v: Variation): {
		prompt: string;
		negative: string;
		source_ref: string;
		params: Record<string, string | number | boolean>;
	} {
		const st = v.settings ?? {};
		return {
			prompt: v.prompt || session?.prompt || '',
			negative: st.negative ?? session?.negative ?? '',
			source_ref: st.source_ref ?? session?.source_ref ?? '',
			params: st.params ?? session?.params ?? {},
		};
	}

	function openRegen(v: Variation): void {
		regen = v;
		regenErr = '';
		regenPrompt = variationRecipe(v).prompt;
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

	// --- duplicate a variation with new settings --------------------------------
	// The counterpart to a re-roll, and deliberately its opposite in both axes. A re-roll
	// REPLACES a tile and moves two knobs; this ADDS a tile and moves every knob — prompt,
	// negative, source image and every blueprint setting — while HOLDING the seed. That is the
	// experiment an author actually runs: the same roll of the dice with the background cutout
	// on and with it off, side by side in one grid. Replacing the first render would destroy the
	// comparison being made.
	//
	// The blueprint is NOT one of the knobs: it is the session's identity, and its params are the
	// schema every tile in this grid is described by. Another blueprint is another session, which
	// is what Generate is for.

	/** The variation whose duplicate panel is open. */
	let dupOf = $state<Variation | null>(null);
	let dupPrompt = $state('');
	let dupNegative = $state('');
	let dupSourceRef = $state('');
	let dupSourceLabel = $state('');
	let dupSourcePreview = $state('');
	let dupSeed = $state('');
	let dupOverrides = $state<Record<string, string | number | boolean>>({});
	let dupBusy = $state(false);
	let dupErr = $state('');

	/** The params the DUPLICATE panel edits — the session's blueprint's, not the rail's. Those
	 * are usually the same and occasionally are not, and a panel that showed the rail's would be
	 * offering settings this session's graph has no nodes for. */
	const dupParamGroups = $derived.by(() => {
		const groups: { group: string; items: BlueprintParam[] }[] = [];
		for (const p of recipeBlueprint?.params ?? []) {
			const name = p.group || 'Settings';
			const found = groups.find((g) => g.group === name);
			if (found) found.items.push(p);
			else groups.push({ group: name, items: [p] });
		}
		return groups;
	});

	function openDup(v: Variation): void {
		const r = variationRecipe(v);
		dupOf = v;
		dupErr = '';
		dupPrompt = r.prompt;
		dupNegative = r.negative;
		// No blob to re-preview — the ref is what travels, so the ref is what is shown. Same
		// reason `reuseSettings` shows one: rebuilding an R2 key from a tool-relativized ref is
		// the drift docs/ui-inventory.md §1 warns about.
		if (dupSourcePreview) URL.revokeObjectURL(dupSourcePreview);
		dupSourcePreview = '';
		dupSourceLabel = '';
		dupSourceRef = r.source_ref;
		dupSeed = String(v.seed);
		dupOverrides = { ...r.params };
	}

	async function doDup(): Promise<void> {
		if (!dupOf || !session) return;
		dupBusy = true;
		dupErr = '';
		try {
			const res = await postJson<Session & { error?: string }>('duplicate', {
				session: session.id,
				index: dupOf.index,
				prompt: dupPrompt,
				negative: dupNegative,
				source_ref: dupSourceRef,
				seed: dupSeed.trim(),
				params: coerceBag(dupOverrides, recipeBlueprint?.params ?? []),
			});
			if (res.error) dupErr = res.error;
			else {
				session = res;
				dupOf = null;
				recent = await getJson<Session[]>('sessions');
			}
		} catch (e) {
			dupErr = (e as Error).message;
		}
		dupBusy = false;
	}

	/** What a duplicated tile changed, in the blueprint's own words — so a grid of near-identical
	 * renders can still say which experiment each one is. Null for every slot that ran the
	 * session's recipe, which is most of them. A param the session set and this slot did NOT is a
	 * real difference too: it ran at the blueprint's default. */
	function settingsSummary(v: Variation): { text: string; detail: string } | null {
		const st = v.settings;
		if (!st) return null;
		const names: string[] = [];
		const detail: string[] = [];
		if ('negative' in st) {
			names.push('negative');
			detail.push(`Negative: ${st.negative || '(none)'}`);
		}
		if ('source_ref' in st) {
			names.push('source image');
			detail.push(`Source image: ${st.source_ref || '(none)'}`);
		}
		if (st.params) {
			const base = session?.params ?? {};
			for (const key of new Set([...Object.keys(st.params), ...Object.keys(base)])) {
				const mine = st.params[key];
				if (mine === base[key]) continue;
				const label = recipeBlueprint?.params?.find((x) => x.key === key)?.label ?? key;
				names.push(label);
				detail.push(
					`${label}: ${
						mine === undefined
							? "the blueprint's default"
							: typeof mine === 'boolean'
								? mine
									? 'on'
									: 'off'
								: String(mine)
					}`,
				);
			}
		}
		if (!names.length) return null;
		return { text: names.join(', '), detail: detail.join('\n') };
	}

	async function discardVariation(v: Variation): Promise<void> {
		if (!session) return;
		const label = `#${String(v.index).padStart(3, '0')}`;
		if (!confirm(`Delete variation ${label}? Its render is removed for good.`)) return;
		tileBusy = v.index;
		try {
			const res = await postJson<Session & { error?: string; warning?: string }>('discard', {
				session: session.id,
				index: v.index,
			});
			if (res.error) err = res.error;
			else {
				// The tile IS gone from the grid either way — the author asked for that and it
				// stands. What a warning reports is the byte removal R2 would not confirm, and
				// this dialog promised "removed for good", so it cannot be swallowed: it shows
				// where an error would, exactly as a cancel RunPod would not take does.
				err = res.warning ?? '';
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

	// --- view one render at full resolution -------------------------------------
	// A grid column bottoms out at 220px, so every tile is a heavy downscale of a
	// 512-1024px render: the alpha fringe a background cutout left behind, or a single
	// smeared frame, is simply not visible there. This opens the render in its OWN
	// browser window rather than an in-page overlay, because what an author does with a
	// full-res view is COMPARE — against the grid it came from, or against a second
	// window holding another variation — and a modal covering the grid cannot.

	/** The pop-up's whole document. Self-contained on purpose: the window is a blank one
	 * written into from here, so it inherits this page's origin (and with it the session
	 * cookie `/api/flipbook/video/file` gates on) but none of its CSS or routes. */
	function fullViewHtml(title: string, src: string): string {
		// Split, and never written whole: an unbroken closing script tag anywhere in the
		// string below would end THIS component's own script block, and the backslash escape
		// that hides it from the parser reads as a useless one to eslint.
		const endScript = '</' + 'script>';
		const esc = (t: string) =>
			t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #0b0e13; color: #94a3b8;
  font: 12px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
body { display: flex; flex-direction: column; }
header { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 6px 10px;
  background: #10161e; border-bottom: 1px solid #1f2937; }
header b { color: #e2e8f0; font-weight: 600; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
header .sp { margin-left: auto; }
header .k { font-size: 11px; color: #64748b; white-space: nowrap; }
button { font: inherit; color: #cbd5e1; background: #1f2937; border: 1px solid #2a3646;
  border-radius: 6px; padding: 4px 9px; cursor: pointer; white-space: nowrap; }
button:hover { background: #27364a; }
main { flex: 1 1 auto; overflow: auto; display: flex; align-items: center;
  justify-content: center; padding: 13px;
  /* Same checkerboard as the grid tile, and load-bearing for the same reason: it is how
     alpha reads as alpha and not as a matte-coloured rectangle. */
  background-color: #0b0e13;
  background-image:
    linear-gradient(45deg, #171c25 25%, transparent 25%),
    linear-gradient(-45deg, #171c25 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #171c25 75%),
    linear-gradient(-45deg, transparent 75%, #171c25 75%);
  background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
img { display: block; margin: auto; }
img.fit { max-width: 100%; max-height: 100%; }
</style></head><body>
<header><b>${esc(title)}</b><span class="k" id="dim">loading…</span><span class="sp"></span>
<button id="t">Fit to window</button><span class="k">F toggles · Esc closes</span></header>
<main><img id="i" alt="${esc(title)}" src="${esc(src)}"></main>
<script>
var img = document.getElementById('i');
var dim = document.getElementById('dim');
var tog = document.getElementById('t');
var pane = document.querySelector('main');
// Fit is decided FOR the author until they decide it themselves, and never after.
var fit = false, chosen = false;
function apply() {
  img.className = fit ? 'fit' : '';
  tog.textContent = fit ? '1:1 actual size' : 'Fit to window';
}
function choose(v) { chosen = true; fit = v; apply(); }
// Whether the render fits is a question about the window it actually ended up in, not about
// the screen: resizeTo is a request a window manager is free to ignore, and the author can
// resize afterwards. Measuring the pane answers it in every one of those cases.
function decide() {
  if (chosen) return;
  fit = img.naturalWidth > pane.clientWidth - 26 || img.naturalHeight > pane.clientHeight - 26;
  apply();
}
tog.onclick = function () { choose(!fit); };
document.onkeydown = function (e) {
  if (e.key === 'Escape') window.close();
  else if (e.key === 'f' || e.key === 'F') choose(!fit);
};
window.onresize = decide;
img.onload = function () {
  dim.textContent = img.naturalWidth + ' \u00d7 ' + img.naturalHeight;
  var maxW = screen.availWidth - 80, maxH = screen.availHeight - 120;
  window.resizeTo(
    Math.max(360, Math.round(Math.min(img.naturalWidth + 26, maxW) + (window.outerWidth - window.innerWidth))),
    Math.max(280, Math.round(Math.min(img.naturalHeight + 59, maxH) + (window.outerHeight - window.innerHeight)))
  );
  // Twice: once for the size the window has now, and once after the resize above lands. A
  // background window gets no animation frames, so this is a timer and not rAF.
  decide();
  setTimeout(decide, 0);
};
img.onerror = function () { dim.textContent = 'could not load this render'; };
apply();
if (img.complete && img.naturalWidth) img.onload();
${endScript}</body></html>`;
	}

	/** Open one done variation at 1:1 in its own window. Named per (session, variation),
	 * so clicking the same tile twice refocuses the window already showing that render
	 * instead of stacking a second copy of it. */
	function openFullView(v: Variation): void {
		if (!session || v.status !== 'done' || !v.file) return;
		const src = new URL(
			api('file', `session=${encodeURIComponent(session.id)}&v=${encodeURIComponent(v.file)}`),
			location.href,
		).href;
		const title = `#${String(v.index).padStart(3, '0')} · ${
			session.blueprint_name ?? session.blueprint
		} · seed ${v.seed}`;
		const w = window.open(
			'',
			`ie_flipbook_${session.id}_${v.index}`,
			'width=640,height=700,resizable=yes,scrollbars=yes',
		);
		if (!w) {
			err = 'The full-resolution view opens in a new window — allow pop-ups for this site.';
			return;
		}
		w.document.write(fullViewHtml(title, src));
		w.document.close();
		w.focus();
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

	// --- send a render's frames to the Atlas Maker as reference images ----------
	// The OTHER export of the same frames, and the difference IS the reason to pick
	// it: `toclip` downscales, alpha-trims and packs into a sheet, which is the right
	// shape for a clip and the wrong shape for anything else. This one writes every
	// selected frame at full resolution, untrimmed, as a reference image with its own
	// region in an UNPACKED manifest — so the author regenerates those regions in the
	// Atlas Maker, from the render, and builds a new atlas with the flipbook out of
	// the loop entirely. No zip to download, no ref to hand-pick per region.
	//
	// **It deliberately does not land the author in /atlas.** The video endpoints are
	// stateless by design (design doc, "Deliberately NOT reusing the Atlas Maker's
	// active-manifest state") and the tool's active manifest is PROCESS-GLOBAL — a
	// known multi-user hazard. Switching it from here would yank another user's open
	// atlas out from under them, so the panel points at /atlas and lets the author
	// pick the new one themselves.
	interface RefsResult {
		atlas_name: string;
		/** Where the manifest landed. Declared because it is part of the response and the next
		 * reader should know it exists; not shown, because the author picks the atlas in /atlas
		 * by NAME and an R2 key is not something they can act on. */
		manifest: string;
		regions: number;
		frames: number;
		width: number;
		height: number;
	}
	let refsFor = $state<Variation | null>(null);
	let refsProbe = $state<Probe | null>(null);
	let atlasName = $state('');
	let refsStart = $state(0);
	let refsEnd = $state(0);
	let refsStride = $state(1);
	let refsBusy = $state(false);
	let refsErr = $state('');
	let refsDone = $state<RefsResult | null>(null);

	/** The twin of `willPack` over this panel's own range/stride — same arithmetic, because
	 * the tool slices both exports the same way, but its own state so opening one panel can
	 * never move the other's numbers. */
	const willExport = $derived.by(() => {
		if (!refsProbe) return 0;
		const to = refsEnd > 0 ? Math.min(refsEnd, refsProbe.frames) : refsProbe.frames;
		const from = Math.max(0, Math.min(refsStart, refsProbe.frames - 1));
		return Math.max(0, Math.ceil((to - from) / Math.max(1, refsStride)));
	});

	async function openRefs(v: Variation): Promise<void> {
		refsFor = v;
		refsProbe = null;
		refsErr = '';
		refsDone = null;
		refsBusy = false;
		atlasName = `${(session?.blueprint_name ?? 'video').replace(/[^A-Za-z0-9]+/g, '_')}_${String(v.index).padStart(3, '0')}`;
		refsStart = 0;
		refsStride = 1;
		try {
			const p = await getJson<Probe>(
				'probe',
				`session=${encodeURIComponent(session!.id)}&v=${v.index}`,
			);
			if (p.error) {
				refsErr = p.error;
				return;
			}
			refsProbe = p;
			refsEnd = p.frames;
		} catch (e) {
			refsErr = (e as Error).message;
		}
	}

	async function sendToRefs(): Promise<void> {
		if (!refsFor || !session) return;
		refsBusy = true;
		refsErr = '';
		try {
			const out = await postJson<RefsResult & { error?: string }>('torefs', {
				session: session.id,
				variation: refsFor.index,
				name: atlasName,
				start: refsStart,
				end: refsEnd,
				stride: refsStride,
			});
			if (out.error) {
				refsErr = out.error;
				return;
			}
			// No navigation on purpose — see the note above. The panel turns into a receipt
			// instead, because "which atlas did that just become?" is the only question the
			// author is left holding.
			refsDone = out;
		} catch (e) {
			refsErr = (e as Error).message;
		} finally {
			refsBusy = false;
		}
	}

	// --- download one render ----------------------------------------------------
	// Two artifacts, and the difference decides how each is fetched. The animated
	// WEBP is the stored file verbatim, same-origin, so a plain `<a download>` is
	// the whole implementation. The PNG sequence is BUILT on demand in the tool and
	// can legitimately refuse (too many frames, past the memory budget) — and a
	// browser saves whatever an anchor gets under the name it was asked for, so a
	// bare href would put an error JSON on disk called `….zip`. Hence `fetch`.
	let downloading = $state<Variation | null>(null);
	let dlProbe = $state<Probe | null>(null);
	let dlErr = $state('');
	let dlBusy = $state(false);

	/** A name that identifies the render away from the page that made it — the stored
	 * file is `003.webp`, which says nothing about which session or seed it came from. */
	function dlFileName(v: Variation, suffix: string): string {
		const clean = (raw: string) => raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
		const base = clean(session?.blueprint_name ?? session?.blueprint ?? '') || 'video';
		return `${base}-${String(v.index).padStart(3, '0')}-seed${clean(String(v.seed))}${suffix}`;
	}

	async function openDownload(v: Variation): Promise<void> {
		if (!session) return;
		downloading = v;
		dlProbe = null;
		dlErr = '';
		dlBusy = false;
		try {
			const p = await getJson<Probe>(
				'probe',
				`session=${encodeURIComponent(session.id)}&v=${v.index}`,
			);
			// Matched on INDEX, not identity: a status poll replaces the whole session
			// object, so the tile that is open is an equal variation, not the same one.
			// The shape line is a courtesy either way — a failed or superseded probe just
			// leaves it off, because both downloads are valid without it.
			if (downloading?.index === v.index && !p.error) dlProbe = p;
		} catch {
			dlProbe = null;
		}
	}

	async function downloadZip(): Promise<void> {
		const v = downloading;
		if (!v || !session) return;
		dlBusy = true;
		dlErr = '';
		tileBusy = v.index;
		try {
			const res = await fetch(api('zip', `session=${encodeURIComponent(session.id)}&v=${v.index}`));
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { error?: string };
				dlErr = out.error ?? `The frame sequence could not be built (${res.status}).`;
				return;
			}
			const url = URL.createObjectURL(await res.blob());
			const a = document.createElement('a');
			a.href = url;
			a.download = dlFileName(v, '-frames.zip');
			document.body.appendChild(a);
			a.click();
			a.remove();
			// Revoked on the next tick, not inline: some browsers read the blob AFTER the
			// synchronous click handler returns, and a revoke in between kills the save.
			setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (e) {
			dlErr = (e as Error).message;
		} finally {
			dlBusy = false;
			tileBusy = 0;
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
	// Everything below is a SUGGESTION, never a filter. The first version of this
	// modal offered each role only the nodes a class-name heuristic approved
	// (`/CLIPTextEncode/` for a prompt, an input named `noise_seed` for a seed) and
	// hardcoded the input field per role. That holds exactly until a graph is
	// authored the way most reusable ones are: knobs pulled out into `Primitive*`
	// nodes, so `CLIPTextEncode.text` is a WIRE and the real prompt sits on a
	// `PrimitiveString.value` upstream. The heuristic then approves a node whose
	// field the role cannot write, and the node the author actually meant is
	// unreachable — a required role with no usable option and no way forward.
	// So: rank, don't exclude. Every (node · input) in the graph stays offered.
	//
	// The heuristics MIRROR `bpCandidates` in ui_server.py, which is still on the
	// older exclude-only model. They cannot be shared — that is a Python-rendered
	// page and this is Svelte, opposite sides of the A/B line in
	// docs/ui-inventory.md — so keep the two in step by hand.
	// `expected` means "worth warning about when this graph offers one and the author
	// left it unbound" — NOT a publish gate. Only `output` blocks, because it is where
	// the bytes come from. `positive` and `seed` used to block as well, which made a
	// PROCESSING graph — no sampler, no text encoder — impossible to publish at all:
	// the modal demanded a seed the graph had nothing to bind. The runner injects every
	// role through `_set_node_input`, a no-op for an absent binding, so an unbound role
	// costs nothing; the cost is that the baked value is kept, which is what
	// `unboundExpected` below says out loud. Mirrors BP_ROLES in ui_server.py.
	const PUBLISH_ROLES = [
		{ role: 'positive', expected: true, hint: 'the prompt' },
		{ role: 'negative', expected: false, hint: '' },
		{ role: 'seed', expected: true, hint: 'per-variation seed' },
		{ role: 'style_ref', expected: false, hint: 'the still to animate' },
		{ role: 'shape_ref', expected: false, hint: '' },
		{ role: 'output', expected: true, hint: 'the save node' },
	] as const;
	const STRUCTURAL_ROLE = 'output';
	/** What an unbound role actually costs at render time, per role. */
	const ROLE_COST: Record<string, string> = {
		positive:
			'every variation renders the prompt your export baked in, so the prompt box above is ignored',
		seed: 'every variation comes out identical, because the graph keeps the one seed your export baked in',
	};

	/** Binding-role names the tool reserves. A param key may not collide with one
	 * (`blueprints._validate_params` rejects it), and `width`/`height` are on the
	 * list even though this modal has no such role — so say it here rather than
	 * let the author find out from a publish failure. */
	const RESERVED_KEYS = new Set([
		'positive',
		'negative',
		'seed',
		'width',
		'height',
		'style_ref',
		'shape_ref',
		'output',
	]);

	type Graph = Record<
		string,
		{ class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } }
	>;
	/** One writable node input — what a role binding and a param both point at. */
	type Target = { node: string; field: string };
	type Suggestion = { target: Target; via: string; rank: number };
	interface PubParam {
		key: string;
		label: string;
		type: string;
		node: string;
		field: string;
		def: string;
		options: string;
		/** Where a `select`'s list can be re-read LIVE: the node CLASS + input, which survives a
		 * re-import that renumbers nodes. Set only when the list came off the node's contract. */
		optionsFrom: { class: string; field: string } | null;
		/** The node's declared domain, as strings so a box can be blank (= unbounded). */
		min: string;
		max: string;
		step: string;
		group: string;
		multiline: boolean;
		/** What `applySpecToRow` last auto-filled, so re-pointing a row follows the
		 * new node while anything the author typed is left alone. Never published. */
		autoKey: string;
		autoLabel: string;
		autoDef: string;
		autoOptions: string;
		autoMin: string;
		autoMax: string;
		autoStep: string;
	}
	function blankParamRow(type = 'int'): PubParam {
		return {
			key: '',
			label: '',
			type,
			node: '',
			field: '',
			def: '',
			options: '',
			optionsFrom: null,
			min: '',
			max: '',
			step: '',
			group: '',
			multiline: false,
			autoKey: '',
			autoLabel: '',
			autoDef: '',
			autoOptions: '',
			autoMin: '',
			autoMax: '',
			autoStep: '',
		};
	}
	/** A baked string that reads as PROSE rather than a token — long, or several
	 * words. What separates a second prompt from `#222222` or `euler`, and so what
	 * decides whether the setting gets a prompt-sized box. Only a suggestion: the
	 * publish row shows the resulting checkbox for the author to overrule. */
	const looksLikeProse = (v: unknown) =>
		typeof v === 'string' && (v.length > 40 || /\s\S+\s/.test(v.trim()));
	let pubOpen = $state(false);
	let pubGraph = $state<Graph | null>(null);
	let pubFile = $state('');
	let pubName = $state('');
	let pubDesc = $state('');
	/** role -> `node::field` (just `node` for `output`, which binds a whole node). */
	let pubBindings = $state<Record<string, string>>({});
	let pubParams = $state<PubParam[]>([]);
	let pubBusy = $state(false);
	let pubMsg = $state('');
	/** The graph's node contracts, by class then input — read off ComfyUI once per picked file.
	 * `{}` when nothing answered; `pubSpecsNote` then says so, and each setting falls back to
	 * being typed from the baked value, with no bounds and no list. */
	let pubSpecs = $state<Record<string, Record<string, NodeSpec>>>({});
	let pubSpecsNote = $state('');
	/** Which picked file a contract read belongs to — a stale answer must not land on the next. */
	let pubPick = 0;

	/** The node's ComfyUI title when the author gave it one, else its class. The id
	 * is always kept, so identically-titled nodes stay distinguishable. */
	function nodeLabel(id: string): string {
		const n = pubGraph?.[id];
		const ct = String(n?.class_type ?? '');
		const t = String(n?._meta?.title ?? '').trim();
		return t && t !== ct ? `${t} — ${ct} #${id}` : `${ct} #${id}`;
	}

	/** A ComfyUI API input is either a widget value or a link `[nodeId, slot]`. */
	function linkSource(v: unknown): string | null {
		return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
	}

	/** Walk backwards from a node input to the WIDGET that actually feeds it.
	 *
	 * "Convert widget to input" is how any reusable ComfyUI graph is authored: the
	 * prompt, the seed, the duration stop being widgets on the sampler and become
	 * `Primitive*` nodes wired in, sometimes through a relay or two. Binding the
	 * consuming end would overwrite that wire with a literal and cut every other
	 * consumer off from the value; binding the upstream widget is what the author
	 * means. Returns the input unchanged when it is already a widget, and stops at
	 * anything that is not a plain pass-through (a switch, a math node) rather
	 * than guessing which of its inputs is "the" one. */
	// `seen` is an array, not a Set: `svelte/prefer-svelte-reactivity` flags every
	// mutable built-in Set/Map in a component, and reaching for `SvelteSet` here
	// would claim a reactive structure for what is a cycle guard over a chain two
	// or three nodes long. Same reason for `taken` and `seenKeys` below.
	function resolveKnob(node: string, field: string, seen: string[] = []): Target {
		const here = { node, field };
		const up = linkSource(pubGraph?.[node]?.inputs?.[field]);
		if (!up || seen.includes(up) || !pubGraph?.[up]) return here;
		seen.push(up);
		const inputs = pubGraph[up].inputs ?? {};
		const widgets = Object.keys(inputs).filter((f) => linkSource(inputs[f]) === null);
		const wires = Object.keys(inputs).filter((f) => linkSource(inputs[f]) !== null);
		// A primitive holding exactly one widget IS the knob.
		if (widgets.length === 1 && !wires.length) return { node: up, field: widgets[0] };
		// A pass-through relay (one input, itself a wire) — keep walking.
		if (!widgets.length && wires.length === 1) return resolveKnob(up, wires[0], seen);
		return here;
	}

	/** Targets that plausibly fill a role, best first — a ranking, not a filter.
	 * Rank 0 = a knob the author factored out (reached by following the wire back
	 * from the node that consumes the value), because a graph carrying both a
	 * primitive and the widget it feeds is one whose author already said which is
	 * the control. Rank 1 = a raw widget on the consuming node. Rank 2 = a node
	 * whose title says it is the OTHER polarity (a negative encoder offered for
	 * `positive`) — still listed, just last. */
	function roleSuggestions(role: string): Suggestion[] {
		const g = pubGraph;
		if (!g) return [];
		const out: Suggestion[] = [];
		const add = (target: Target, via: string, rank: number) => {
			if (!g[target.node]) return;
			if (out.some((o) => o.target.node === target.node && o.target.field === target.field)) return;
			out.push({ target, via, rank });
		};
		for (const [id, n] of Object.entries(g)) {
			const ct = String(n?.class_type ?? '');
			const title = String(n?._meta?.title ?? '');
			const inp = (n?.inputs ?? {}) as Record<string, unknown>;
			if (role === 'output') {
				// A save node is whatever the runner can stamp `filename_prefix` onto —
				// testing the class name for /SaveImage/ is what hid SaveAnimatedWEBP.
				if ('filename_prefix' in inp || /Save|VideoCombine/i.test(ct)) {
					add({ node: id, field: '' }, '', 0);
				}
			} else if (role === 'positive' || role === 'negative') {
				if (!/CLIPTextEncode/i.test(ct) || !('text' in inp)) continue;
				const isNeg = /negative/i.test(title);
				const wanted = role === 'negative' ? isNeg : !isNeg;
				const k = resolveKnob(id, 'text');
				const viaWire = k.node !== id;
				add(k, viaWire ? `feeds ${nodeLabel(id)}` : '', wanted ? (viaWire ? 0 : 1) : 2);
			} else if (role === 'seed') {
				for (const f of ['noise_seed', 'seed']) {
					if (!(f in inp)) continue;
					const k = resolveKnob(id, f);
					const viaWire = k.node !== id;
					add(k, viaWire ? `feeds ${nodeLabel(id)}` : '', viaWire ? 0 : 1);
				}
			} else if (role === 'style_ref' || role === 'shape_ref') {
				if (!/LoadImage/i.test(ct)) continue;
				add(
					{ node: id, field: 'image' in inp ? 'image' : (Object.keys(inp)[0] ?? 'image') },
					'',
					0,
				);
			}
		}
		return out.sort((a, b) => a.rank - b.rank);
	}

	/** The suggestion lists, computed once per graph rather than per render — the
	 * modal draws six selects and each one would otherwise re-walk every node. */
	const suggestionsByRole = $derived.by(() => {
		const out: Record<string, Suggestion[]> = {};
		for (const r of PUBLISH_ROLES) out[r.role] = roleSuggestions(r.role);
		return out;
	});

	/** The `node::field` value a role select carries for a target (`output` binds a
	 * whole node, so it carries the bare id). */
	const bindValue = (role: string, t: Target) =>
		role === 'output' ? t.node : `${t.node}::${t.field}`;

	/** EVERY node input in the graph, so no role is ever cornered by a heuristic
	 * that did not anticipate this workflow. Wired inputs are included and marked:
	 * overwriting a link with a literal is legal in ComfyUI and is what the old
	 * node-only picker did, so the escape hatch has to keep offering it. */
	const allInputs = $derived.by(() => {
		const out: { node: string; field: string; label: string }[] = [];
		for (const [id, n] of Object.entries(pubGraph ?? {})) {
			for (const [field, v] of Object.entries(n?.inputs ?? {})) {
				out.push({
					node: id,
					field,
					label: `${nodeLabel(id)} · ${field}${linkSource(v) === null ? '' : ' (wired)'}`,
				});
			}
		}
		return out;
	});

	/** Every node, for the `output` role — which binds a whole node, not an input. */
	const allNodes = $derived.by(() =>
		Object.keys(pubGraph ?? {}).map((id) => ({ id, label: nodeLabel(id) })),
	);

	/** Node inputs a PARAM could drive. Unlike a role binding this skips wired
	 * inputs — a param is a knob in the Settings panel, and an input driven by
	 * another node is not one. Targets already taken by a role stay in the list but
	 * are flagged and disabled, because the tool rejects a param that re-drives a
	 * bound input and a publish failure is the worse way to learn that. */
	const paramTargets = $derived.by(() => {
		const taken: Record<string, string> = {};
		for (const r of PUBLISH_ROLES) {
			if (r.role === 'output') continue;
			const v = pubBindings[r.role];
			if (v) taken[v] = r.role;
		}
		const out: { node: string; field: string; label: string; boundTo: string }[] = [];
		for (const [id, n] of Object.entries(pubGraph ?? {})) {
			for (const [field, v] of Object.entries(n?.inputs ?? {})) {
				if (linkSource(v) !== null) continue;
				const boundTo = taken[`${id}::${field}`] ?? '';
				out.push({
					node: id,
					field,
					label: `${nodeLabel(id)} · ${field}${boundTo ? ` — driven by the ${boundTo} role` : ''}`,
					boundTo,
				});
			}
		}
		return out;
	});

	/** Baked mode switches this graph carries that NOTHING will be able to reach.
	 *
	 * A published blueprint's params are the ONLY inputs the runner writes; every
	 * other input keeps whatever the ComfyUI export saved, forever. That is what a
	 * day of `executionTimeout` failures turned out to be — an imported graph gated
	 * both its Wan passes on one `PrimitiveBoolean` left at `false`, selecting 50
	 * steps with no speed LoRA, and nothing in this tool could change it. The
	 * built-in blueprint has the identical gate and differs only in exposing it.
	 *
	 * Recomputed as the author binds and adds rows, so the warning CLEARS as it is
	 * acted on rather than nagging about a switch they have just exposed.
	 */
	const unexposedGates = $derived(
		findUnexposedGates(
			pubGraph,
			Object.values(pubBindings).filter(Boolean),
			pubParams.filter((p) => p.node && p.field).map((p) => `${p.node}::${p.field}`),
		),
	);

	/** Add a settings row already pointed at a gate, so the warning fixes the thing
	 * it warns about instead of describing it. Everything else — key, type, default
	 * — comes from `setParamTarget` reading the graph, exactly as if the author had
	 * picked that input from the dropdown themselves. */
	function exposeGate(node: string, field: string): void {
		pubParams = [...pubParams, blankParamRow('bool')];
		setParamTarget(pubParams.length - 1, `${node}::${field}`);
	}

	/** A param's type read off the value the graph already bakes in — and off the
	 * node's class first, because the value alone lies about whole numbers: a
	 * `PrimitiveFloat` holding 1 (a duration, an fps) reads as an int, and an int
	 * param would then refuse the 1.5 the knob exists to allow. */
	function inferParamType(v: unknown, classType = ''): string {
		if (/PrimitiveBoolean|Boolean/i.test(classType)) return 'bool';
		if (/PrimitiveFloat|Float/i.test(classType)) return 'float';
		if (/PrimitiveInt|PrimitiveStringMultiline|PrimitiveString/i.test(classType)) {
			return /Int/i.test(classType) ? 'int' : 'text';
		}
		if (typeof v === 'boolean') return 'bool';
		if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
		return 'text';
	}

	/** A first-guess param key from the node's own title, made unique and kept off
	 * the reserved role names. The author renames it; this just means the common
	 * case is confirm-and-go rather than a dozen rows of typing. */
	function suggestParamKey(node: string, field: string, mine: number): string {
		const n = pubGraph?.[node];
		const ct = String(n?.class_type ?? '');
		const title = String(n?._meta?.title ?? '').trim();
		const stem =
			(title && title !== ct ? title : `${ct}_${field}`).replace(/[^A-Za-z0-9]+/g, '') ||
			`param${mine + 1}`;
		const used = new Set(pubParams.filter((_, j) => j !== mine).map((p) => p.key));
		let key = RESERVED_KEYS.has(stem) ? `${stem}_${field}` : stem;
		let i = 2;
		while (used.has(key)) key = `${stem}${i++}`;
		return key;
	}

	/** Point a param row at a (node · input) and read its type + current value off
	 * the graph. A default left blank published as 0 — an ExportFPS of 0, a
	 * GenWidth of 0 — because the runner sends only what the author OVERRODE, so
	 * the baked default is what actually runs. */
	function setParamTarget(i: number, value: string): void {
		const [node = '', field = ''] = value.split('::');
		const p = pubParams[i];
		p.node = node;
		p.field = field;
		applySpecToRow(i);
	}

	/** Read a row's type, domain and list off the graph and the node's contract, filling only
	 * what the author has not touched — a field still holding exactly what we last put there.
	 * `if (!p.key)` alone froze the key on the first target the row was ever given, so
	 * re-pointing a row kept a name describing a different node; overwriting unconditionally
	 * would instead throw away a name they had typed. Split from `setParamTarget` so rows made
	 * before the contracts landed (the modal does not wait on a sleeping pod) get them after.
	 *
	 * The contract wins over the value: a baked `1.0` says "float" and nothing else — not that
	 * the node declares 0..1, not that the input beside it is a COMBO over the twelve installed
	 * BiRefNet models. That gap is how a `sensitivity` of 50 reached the GPU and was rejected
	 * there. A `Primitive*` node's own domain is wide open and stays honestly unbounded. */
	function applySpecToRow(i: number): void {
		const p = pubParams[i];
		const { node, field } = p;
		const baked = pubGraph?.[node]?.inputs?.[field];
		if (baked === undefined || Array.isArray(baked)) return;
		const classType = String(pubGraph?.[node]?.class_type ?? '');
		const spec = pubSpecs[classType]?.[field];
		p.type = spec?.kind ?? inferParamType(baked, classType);
		p.multiline = p.type === 'text' && (spec?.multiline === true || looksLikeProse(baked));
		const auto = (cur: string, was: string, next: string) =>
			cur === '' || cur === was ? next : cur;
		if (p.key === '' || p.key === p.autoKey) {
			p.key = suggestParamKey(node, field, i);
			p.autoKey = p.key;
		}
		if (p.label === '' || p.label === p.autoLabel) {
			p.label = p.key;
			p.autoLabel = p.label;
		}
		if (p.def === '' || p.def === p.autoDef) {
			p.def = String(baked);
			p.autoDef = p.def;
		}
		const options = spec?.kind === 'select' ? (spec.options ?? []).join(', ') : '';
		p.options = auto(p.options, p.autoOptions, options);
		p.autoOptions = options;
		p.optionsFrom = spec?.kind === 'select' ? { class: classType, field } : null;
		const bound = (v: number | undefined) => (v === undefined ? '' : String(v));
		const numeric = spec && (spec.kind === 'int' || spec.kind === 'float');
		const [min, max, step] = numeric
			? [bound(spec.min), bound(spec.max), bound(spec.step)]
			: ['', '', ''];
		p.min = auto(p.min, p.autoMin, min);
		p.autoMin = min;
		p.max = auto(p.max, p.autoMax, max);
		p.autoMax = max;
		p.step = auto(p.step, p.autoStep, step);
		p.autoStep = step;
	}

	/** `min`/`max`/`step` for a numeric row — only the boxes holding a number, so an unbounded
	 * setting publishes without them rather than with `null`s the tool would carry as bounds. */
	function numericBounds(p: PubParam): { min?: number; max?: number; step?: number } {
		if (p.type !== 'int' && p.type !== 'float') return {};
		const out: { min?: number; max?: number; step?: number } = {};
		for (const k of ['min', 'max', 'step'] as const) {
			const v = p[k].trim();
			if (v !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
		}
		return out;
	}

	/** The label follows the key until the author types a label of their own. The
	 * label is what the Generate panel SHOWS, and the row prefilled it with the
	 * suggested key — so renaming the key to `bck model` published a setting still
	 * labelled `BiRefNetRemoveBackgroundRMBG`, and the name typed into the row's
	 * first box never reached the panel. */
	function syncLabelToKey(i: number, key: string): void {
		const p = pubParams[i];
		if (p.label !== '' && p.label !== p.autoLabel) return;
		p.label = key;
		p.autoLabel = key;
	}

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
			// Rows from a previously picked file point at node ids this graph may not
			// even have. Start clean rather than carry a broken target across.
			pubParams = [];
			if (!pubName) pubName = f.name.replace(/\.json$/i, '');
			// Pre-fill a role when its best suggestion is unambiguous — one target
			// alone at the top rank. Two equally good candidates (a graph with a
			// first-half and a second-half prompt) is a choice only the author can
			// make, so it stays empty rather than being guessed at.
			const next: Record<string, string> = {};
			for (const r of PUBLISH_ROLES) {
				const s = roleSuggestions(r.role);
				if (s.length && (s.length === 1 || s[0].rank !== s[1].rank)) {
					next[r.role] = bindValue(r.role, s[0].target);
				}
			}
			pubBindings = next;
			// The node contracts, read once per file. Not awaited before the modal shows the
			// graph — a sleeping pod costs the read its whole timeout — so rows made in the
			// meantime are revisited when it lands.
			const mine = ++pubPick;
			pubSpecs = {};
			pubSpecsNote = '';
			const classes = nodes
				.map((n) => String(n.class_type ?? ''))
				.filter((c, at, all) => c && all.indexOf(c) === at);
			postJson<NodeSpecs>('nodespecs', { classes })
				.then((r) => {
					if (mine !== pubPick) return;
					pubSpecs = r.classes ?? {};
					pubSpecsNote = r.ok
						? ''
						: r.note ||
							'ComfyUI did not answer, so bounds and option lists were not read — these settings will not be range-checked.';
					pubParams.forEach((_, i) => applySpecToRow(i));
				})
				.catch(() => {
					if (mine !== pubPick) return;
					pubSpecsNote =
						'ComfyUI could not be asked for node contracts — these settings will not be range-checked.';
				});
		} catch (err) {
			pubGraph = null;
			pubMsg = `Could not read that file: ${(err as Error).message}`;
		}
	}

	/** An EXPECTED role left unbound on a graph that COULD satisfy it. Never blocks —
	 * the author may want a fixed seed — but leaving one unbound by accident is silent
	 * at render time, so the cost is stated while the graph is still on screen. A role
	 * this graph cannot offer is not mentioned: there is nothing to do about it. */
	const unboundExpected = $derived(
		pubGraph
			? PUBLISH_ROLES.filter(
					(r) =>
						r.expected &&
						r.role !== STRUCTURAL_ROLE &&
						!pubBindings[r.role] &&
						(suggestionsByRole[r.role]?.length ?? 0) > 0,
				).map((r) => r.role)
			: [],
	);

	async function publishBlueprint(overwrite = false): Promise<void> {
		if (!pubGraph) return;
		// `output` alone — see PUBLISH_ROLES. An unbound `positive`/`seed` is a warning
		// (unboundExpected), not a refusal, so a processing graph can be published.
		if (!pubBindings[STRUCTURAL_ROLE]) {
			pubMsg = `Bind ${STRUCTURAL_ROLE} first — it is the node the frames are read from.`;
			return;
		}
		// A half-filled setting used to be dropped without a word, so a knob the
		// author thought they had exposed simply was not on the published blueprint.
		const halfDone = pubParams.find(
			(p) => (p.key || p.node) && !(p.key.trim() && p.node && p.field),
		);
		if (halfDone) {
			pubMsg = halfDone.node
				? `The setting on ${nodeLabel(halfDone.node)} needs a key.`
				: `The setting "${halfDone.key}" needs a node input to drive.`;
			return;
		}
		// The tool's own param rules, checked here so they read as "fix this field"
		// rather than as a failed publish. A key can't be a role name or a duplicate,
		// and a node input can't be driven by a role AND a setting at once.
		const seenKeys: string[] = [];
		for (const p of pubParams) {
			const key = p.key.trim();
			if (!key) continue;
			if (RESERVED_KEYS.has(key)) {
				pubMsg = `"${key}" is a reserved binding-role name — give that setting a different key.`;
				return;
			}
			if (seenKeys.includes(key)) {
				pubMsg = `Two settings share the key "${key}".`;
				return;
			}
			seenKeys.push(key);
			const role = paramTargets.find((t) => t.node === p.node && t.field === p.field)?.boundTo;
			if (role) {
				pubMsg = `"${key}" drives ${nodeLabel(p.node)} · ${p.field}, which the ${role} role already drives. Point one of them somewhere else.`;
				return;
			}
		}
		pubBusy = true;
		pubMsg = '';
		try {
			const bindings: Record<string, { node: string; field?: string }> = {};
			for (const r of PUBLISH_ROLES) {
				const v = pubBindings[r.role];
				if (!v) continue;
				const [node = '', field = ''] = v.split('::');
				bindings[r.role] = r.role === 'output' ? { node } : { node, field };
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
						.filter((p) => p.key.trim() && p.node && p.field)
						.map((p) => ({
							key: p.key.trim(),
							label: p.label.trim() || p.key.trim(),
							type: p.type,
							node: p.node,
							field: p.field,
							default:
								p.type === 'bool'
									? p.def === 'true'
									: p.type === 'int' || p.type === 'float'
										? Number(p.def)
										: p.def,
							// Only sent when they carry something: the tool passes an
							// empty `options`/`group` straight into the manifest, and a
							// `select` with no options is rejected outright.
							...(p.type === 'select'
								? {
										options: p.options
											.split(',')
											.map((o) => o.trim())
											.filter(Boolean),
									}
								: {}),
							...(p.type === 'select' && p.optionsFrom ? { options_from: p.optionsFrom } : {}),
							...numericBounds(p),
							...(p.group.trim() ? { group: p.group.trim() } : {}),
							...(p.type === 'text' && p.multiline ? { multiline: true } : {}),
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

	/** Which field the next pick lands in. The picker is THREE tabs of ref-resolution logic and
	 * a presigned upload; a second copy of it for the duplicate panel would be the duplication
	 * `feedback_avoid_duplication` is about, and the two copies would drift the moment a fourth
	 * source is added. One picker, addressed. */
	let pickTarget = $state<'rail' | 'dup'>('rail');

	function openPicker(target: 'rail' | 'dup' = 'rail'): void {
		pickTarget = target;
		picking = true;
		pickErr = '';
		if (pickTab === 'project' && !pickDirs.length && !pickFiles.length) void browse('');
	}

	function setSource(ref: string, label: string, preview: string): void {
		if (pickTarget === 'dup') {
			if (dupSourcePreview) URL.revokeObjectURL(dupSourcePreview);
			dupSourcePreview = preview;
			dupSourceLabel = label;
			dupSourceRef = ref;
		} else {
			if (sourcePreview) URL.revokeObjectURL(sourcePreview);
			sourcePreview = preview;
			sourceLabel = label;
			sourceRef = ref;
		}
		pickErr = '';
		picking = false;
	}

	onDestroy(() => {
		if (sourcePreview) URL.revokeObjectURL(sourcePreview);
		if (dupSourcePreview) URL.revokeObjectURL(dupSourcePreview);
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

	const REFRESH_TITLE =
		"Re-read this project's sheets from R2 — the region rects and the page image are cached " +
		'for this browser session, so this picker keeps offering the old art (and would crop the ' +
		'old pixels into the generation source) after an atlas is re-packed elsewhere.';

	let refreshing = $state(false);

	/**
	 * The clip editor's ↻ Refresh from R2, over this picker. The three caches it drops are all
	 * MODULE-level and live for the whole SPA session; `clearCropPages` is the one that matters
	 * most here, because `cropRegionToPng` is what becomes the uploaded generation source — a
	 * stale decode there spends GPU time on art the project no longer has.
	 */
	async function refreshArt(): Promise<void> {
		if (refreshing) return;
		refreshing = true;
		try {
			clearRegionCache();
			clearPageImages();
			clearCropPages();
			regionSets = {};
			ensureRegions(sheetKey);
			// `atlases` is a prop off the page's server load, so a sheet packed since this tab opened
			// only reaches the select through a re-run of that load.
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

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
		variations = Math.max(1, s.variations?.length || 1);

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

	// --- telling one session from another ---------------------------------------
	// The rail used to be a `<select>` whose every row read the same thing: the blueprint's name,
	// a count and an age. That names the RECIPE, not the run — twenty rows of "Wan 2.2 I2V —
	// flipbook source · 10 · 3d ago" is a list you cannot read. What tells runs apart is what was
	// ASKED FOR and what CAME OUT, so a row now carries both.

	/** The prompt, trimmed to a line. Derived rather than stored: it costs no schema change, it
	 * names every session already in the project, and it cannot drift from the prompt it
	 * describes. Cut on a word boundary — a title sliced mid-word reads as corruption. */
	function runTitle(s: Session): string {
		const p = (s.prompt ?? '').replace(/\s+/g, ' ').trim();
		if (!p) return s.blueprint_name ?? s.blueprint;
		if (p.length <= 46) return p;
		const cut = p.slice(0, 46);
		const sp = cut.lastIndexOf(' ');
		return `${(sp > 24 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
	}

	/** The first render this session actually produced. Undefined while nothing has landed yet —
	 * the picker draws its checkerboard placeholder rather than a broken image. */
	function runThumb(s: Session): string | undefined {
		const v = s.variations?.find((x) => x.status === 'done' && x.file);
		return v
			? api('file', `session=${encodeURIComponent(s.id)}&v=${encodeURIComponent(v.file)}`)
			: undefined;
	}

	function toItem(s: Session): RunPickerItem {
		const live = (s.variations ?? []).filter((v) => v.status !== 'deleted').length;
		const running = s.status === 'running' || s.status === 'queued';
		const where = s.queue_position ? ` · #${s.queue_position} in line` : '';
		return {
			id: s.id,
			title: runTitle(s),
			meta: `${live} ${live === 1 ? 'variation' : 'variations'} · ${fmtAge(s.created)}${
				running ? ` · ${s.status}${where}` : ''
			}`,
			thumb: runThumb(s),
			state: running ? 'live' : s.status === 'cancelled' ? 'bad' : undefined,
		};
	}

	/** `recent` is only re-read when a session goes terminal, but the SELECTED one is polled every
	 * few seconds — so the live copy wins for its own row. Without this the face would still be
	 * claiming "queued · #2 in line" long after that session started rendering. */
	const sessionItems = $derived(
		recent.map((s) => toItem(session && session.id === s.id ? session : s)),
	);

	async function pickSession(id: string): Promise<void> {
		reuse = null;
		session = id ? await getJson<Session>('status', `session=${encodeURIComponent(id)}`) : null;
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

<!-- ONE definition of "how a blueprint param is edited", rendered by the Generate rail and by
     the duplicate panel. Copying these five branches into the second panel is how the two would
     come to disagree about (say) what a `select` does with a value the blueprint dropped, and
     only one of them would ever be fixed. `bag` is the $state record being edited, so writing
     through it updates whichever panel passed it. -->
{#snippet paramField(p: BlueprintParam, bag: Record<string, string | number | boolean>)}
	<label class="fld {p.type === 'text' && p.multiline ? 'prose' : bounded(p) ? 'range' : 'sm'}">
		<span>{p.label}</span>
		{#if p.type === 'text' && p.multiline}
			<textarea
				rows="3"
				value={String(bag[p.key] ?? p.default ?? '')}
				onchange={(e) => (bag[p.key] = e.currentTarget.value)}
			></textarea>
		{:else if p.type === 'bool'}
			<input
				type="checkbox"
				checked={Boolean(bag[p.key] ?? p.default)}
				onchange={(e) => (bag[p.key] = e.currentTarget.checked)}
			/>
		{:else if p.type === 'select'}
			<select
				value={String(bag[p.key] ?? p.default ?? '')}
				onchange={(e) => (bag[p.key] = e.currentTarget.value)}
			>
				{#each p.options ?? [] as o (o)}
					<option value={o}>{o}{o === p.missingOption ? ' (not installed)' : ''}</option>
				{/each}
			</select>
		{:else if p.type === 'text'}
			<input
				value={String(bag[p.key] ?? p.default ?? '')}
				onchange={(e) => (bag[p.key] = e.currentTarget.value)}
			/>
		{:else if bounded(p)}
			<!-- Two views of one value; the number box clamps on change (see `clampTo`). -->
			<span class="range">
				<input
					type="range"
					min={p.min}
					max={p.max}
					step={p.step ?? (p.type === 'int' ? 1 : 0.01)}
					value={Number(bag[p.key] ?? p.default ?? p.min)}
					oninput={(e) => (bag[p.key] = clampTo(p, e.currentTarget.value))}
				/>
				<input
					type="number"
					min={p.min}
					max={p.max}
					step={p.step ?? (p.type === 'int' ? 1 : 0.01)}
					value={Number(bag[p.key] ?? p.default ?? p.min)}
					onchange={(e) => {
						const v = clampTo(p, e.currentTarget.value);
						e.currentTarget.value = String(v);
						bag[p.key] = v;
					}}
				/>
			</span>
		{:else}
			<input
				type="number"
				min={p.min}
				max={p.max}
				step={p.step ?? (p.type === 'int' ? 1 : 0.1)}
				value={Number(bag[p.key] ?? p.default ?? 0)}
				onchange={(e) => (bag[p.key] = e.currentTarget.value)}
			/>
		{/if}
	</label>
{/snippet}

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
					<button onclick={() => openPicker('rail')}>Pick…</button>
				</div>
				<p class="hint">
					Image-to-video animates this still. Point it at a symbol's source art and the model moves
					that art — a file already in the project, a region cropped straight out of one of its
					atlases, or an image from your computer.
				</p>
			</div>

			<label class="fld">
				<span>Variations</span>
				<input type="number" min="1" bind:value={variations} />
			</label>

			<!-- A group holding a PROSE setting starts open. Every group used to be collapsed,
			     which is right for a dozen numeric knobs you touch occasionally and wrong for a
			     second prompt: a graph can bind only one prompt to the `positive` role, so on a
			     two-prompt network the other one is here — and a prompt you must go looking for
			     behind a disclosure triangle is not one the author will remember to write. -->
			{#each paramGroups as g (g.group)}
				<details class="grp" open={g.items.some((p) => p.type === 'text' && p.multiline)}>
					<summary>{g.group}</summary>
					{#each g.items as p (p.key)}
						{@render paramField(p, overrides)}
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
				<RunPicker
					items={sessionItems}
					selected={session?.id ?? ''}
					onselect={pickSession}
					title="Switch session — named by its prompt, pictured by its first render"
				/>
			{/if}
			{#if session}
				<span class="spacer"></span>
				<!-- A span, not a label: it wraps a BUTTON as well as the number, and a label
				     would hand the button's clicks to the input. -->
				<span class="addn" title="Add more rolls of this same recipe to this session">
					<input type="number" min="1" bind:value={addCount} />
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
					onclick={() => removeSession(session!)}>🗑</button
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
					{@const own = settingsSummary(v)}
					<figure class="tile" class:failed={v.status === 'failed'}>
						<div class="thumb">
							{#if v.status === 'done' && v.file}
								<!-- Animated WEBP: it plays and loops on its own. The tile is a heavy
								     downscale of it, so the thumbnail is also the way IN to the render at
								     its own resolution. -->
								<button
									class="zoom"
									title="Open this render at full resolution in its own window"
									onclick={() => openFullView(v)}
								>
									<img
										src={api(
											'file',
											`session=${encodeURIComponent(session.id)}&v=${encodeURIComponent(v.file)}`,
										)}
										alt={`variation ${v.index}`}
									/>
									<span class="zoomhint">⤢ Full resolution</span>
								</button>
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
						     pushed clean out of the card. The action row also WRAPS: three icon
						     buttons beside the label fit a 220px column with room to spare, but a
						     column narrower than the minimum (the container itself is narrower) has
						     to fold rather than push a button out of the card again. -->
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
							<div class="crow acts">
								<button
									class="make"
									disabled={v.status !== 'done'}
									title="Pack these frames into a sheet and create a clip"
									onclick={() => openMake(v)}
								>
									🎞 Make flipbook
								</button>
								<button
									class="make"
									disabled={v.status !== 'done'}
									title="Send this render's frames to the Atlas Maker as full-resolution reference images"
									onclick={() => openRefs(v)}
								>
									🖼 To Atlas Maker
								</button>
								<button
									class="tico"
									disabled={v.status !== 'done' || tileBusy === v.index}
									title={v.status === 'done'
										? 'Download this render — the animated WEBP, or its frames as a PNG sequence'
										: 'Only a finished render can be downloaded'}
									onclick={() => openDownload(v)}>⤓</button
								>
								<button
									class="tico"
									disabled={v.status === 'running' || tileBusy === v.index}
									title={v.status === 'running'
										? 'Still rendering — cancel the session first'
										: 'Re-roll this one: change the prompt, hold or re-roll the seed'}
									onclick={() => openRegen(v)}>↻</button
								>
								<button
									class="tico"
									disabled={v.status === 'running' || tileBusy === v.index}
									title={v.status === 'running'
										? 'Still rendering — cancel the session first'
										: 'Duplicate with new settings: this render stays, a NEW tile runs the same seed with whatever you change — prompt, source image, background cutout, anything'}
									onclick={() => openDup(v)}>⧉</button
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
						{#if own}
							<p class="tileprompt" title={own.detail}>⧉ {own.text}</p>
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

	{#if dupOf && session}
		<!-- Placed BEFORE the source picker in the DOM: every modal here shares one z-index, so
		     the picker opened FROM this panel has to come later to paint over it. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (dupOf = null)}></div>
		<div class="picker wide">
			<header>
				<strong>Duplicate #{String(dupOf.index).padStart(3, '0')} with new settings</strong>
				<button onclick={() => (dupOf = null)}>✕</button>
			</header>

			{#if dupErr}
				<p class="pill err">{dupErr}</p>
			{/if}

			<p class="hint">
				A <b>new tile</b> in this same grid, running the seed below with whatever you change here. #{String(
					dupOf.index,
				).padStart(3, '0')} is not touched — the two sit side by side, which is the comparison this is
				for: the same roll of the dice with the background cutout on and with it off, or one word of
				the prompt different.
			</p>

			<label class="fld">
				<span>Prompt</span>
				<textarea bind:value={dupPrompt} rows="4"></textarea>
			</label>

			<label class="fld">
				<span>Negative</span>
				<textarea bind:value={dupNegative} rows="2" placeholder="(optional)"></textarea>
			</label>

			<div class="fld">
				<span>Source image</span>
				<div class="srcrow">
					{#if dupSourcePreview}
						<img class="srcthumb" src={dupSourcePreview} alt="" title={dupSourceRef} />
					{/if}
					<input
						value={dupSourceLabel || dupSourceRef}
						readonly
						placeholder="none picked"
						title={dupSourceRef}
					/>
					<button onclick={() => openPicker('dup')}>Pick…</button>
				</div>
			</div>

			<label class="fld">
				<span>Seed</span>
				<div class="srcrow">
					<input bind:value={dupSeed} placeholder="blank = a new one" />
					<button onclick={() => (dupSeed = '')}>🎲 New</button>
				</div>
			</label>
			<p class="hint">
				It opens on <b>this tile's own seed</b>, and that is the point: holding it is what makes the
				two renders comparable, so any difference you see is the setting you changed and not another
				roll of the dice. Clear it only when you want a different roll as well.
			</p>

			{#if recipeBlueprint}
				{#each dupParamGroups as g (g.group)}
					<details class="grp">
						<summary>{g.group}</summary>
						{#each g.items as p (p.key)}
							{@render paramField(p, dupOverrides)}
						{/each}
					</details>
				{/each}
			{:else}
				<p class="diag">
					The blueprint “{session.blueprint_name ?? session.blueprint}” is no longer in the video
					library, so its settings cannot be shown — and the run itself will be refused for the same
					reason. Publish it again, or start a new session.
				</p>
			{/if}

			<p class="hint">
				The blueprint is fixed: it is what every tile in this grid is described by, and its settings
				are the ones above. A different blueprint is a different session — use <b>Generate</b>.
				Costs one more GPU job, and only what you actually change is recorded on the new tile.
			</p>
			<div class="actions">
				<button class="go" disabled={dupBusy || !dupPrompt.trim()} onclick={doDup}>
					{dupBusy ? 'Starting…' : '⧉ Duplicate it'}
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

	{#if refsFor}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (refsFor = null)}></div>
		<div class="picker wide">
			<header>
				<strong>Send #{String(refsFor.index).padStart(3, '0')} to the Atlas Maker</strong>
				<button onclick={() => (refsFor = null)}>✕</button>
			</header>

			{#if refsErr}
				<p class="pill err">{refsErr}</p>
			{/if}

			{#if refsDone}
				<!-- A receipt, not a redirect. Naming the atlas is the whole job here: nothing on the
				     Atlas Maker's own screen will point at what this just wrote. -->
				<p class="hint">
					<b>{refsDone.frames}</b>
					frame{refsDone.frames === 1 ? '' : 's'} exported at
					<b>{refsDone.width}×{refsDone.height}</b>
					into the atlas <b>{refsDone.atlas_name}</b>, as
					<b>{refsDone.regions}</b>
					region{refsDone.regions === 1 ? '' : 's'} — one per frame, each already pointing at its own
					reference image.
				</p>
				<p class="hint">
					Nothing was packed: what exists now is those loose full-resolution PNGs plus an unpacked
					manifest whose regions point at them. Open the Atlas Maker, pick
					<b>{refsDone.atlas_name}</b>
					from its atlas list, regenerate the regions against those references, then Create Atlas. It
					will not already be selected there — which atlas the tool has open is shared by everyone using
					it, so this export deliberately leaves that choice to you.
				</p>

				<div class="actions">
					<!-- The rule wants `resolve()` from `$app/paths`, which arrived in SvelteKit 2.26;
					     this repo pins 2.17.3, whose `$app/paths` exports only `resolveRoute`. `{base}`
					     does not satisfy it either. Disabled inline rather than parked in
					     eslint-suppressions.json — that baseline is for burning DOWN existing debt,
					     not for adding new lines to it (same call as comfyui/+page.svelte). -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="dl" href="/atlas">🖼 Open the Atlas Maker</a>
				</div>
			{:else if !refsProbe}
				<p class="empty">Reading the animation…</p>
			{:else}
				<p class="hint">
					{refsProbe.frames} frames · {refsProbe.width}×{refsProbe.height} · {refsProbe.fps} fps
				</p>

				<label class="fld">
					<span>Atlas name</span>
					<input bind:value={atlasName} disabled={refsBusy} />
				</label>

				<div class="row">
					<label class="fld sm"
						><span>From</span>
						<input
							type="number"
							min="0"
							max={refsProbe.frames - 1}
							bind:value={refsStart}
							disabled={refsBusy}
						/></label
					>
					<label class="fld sm"
						><span>To</span>
						<input
							type="number"
							min="1"
							max={refsProbe.frames}
							bind:value={refsEnd}
							disabled={refsBusy}
						/></label
					>
					<label class="fld sm"
						><span>Every</span>
						<input
							type="number"
							min="1"
							max="8"
							bind:value={refsStride}
							disabled={refsBusy}
						/></label
					>
				</div>

				<p class="hint">
					<b>{willExport}</b>
					frame{willExport === 1 ? '' : 's'} will be exported at
					<b>full resolution ({refsProbe.width}×{refsProbe.height}), untrimmed</b> — no downscale, no
					alpha crop, nothing packed. That is the whole difference from 🎞 Make flipbook, and the reason
					to come here: each frame lands as a reference image already wired to its own region, ready
					to be regenerated in the Atlas Maker.
				</p>

				<div class="actions">
					<button
						class="go"
						disabled={refsBusy || !willExport || !atlasName.trim()}
						onclick={sendToRefs}
					>
						{refsBusy
							? 'Exporting…'
							: `🖼 Export ${willExport} reference image${willExport === 1 ? '' : 's'}`}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if downloading && session}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (downloading = null)}></div>
		<div class="picker">
			<header>
				<strong>Download #{String(downloading.index).padStart(3, '0')}</strong>
				<button onclick={() => (downloading = null)}>✕</button>
			</header>

			{#if dlErr}
				<p class="pill err">{dlErr}</p>
			{/if}
			{#if dlProbe}
				<p class="hint">
					{dlProbe.frames} frames · {dlProbe.width}×{dlProbe.height} · {dlProbe.fps} fps ·
					{dlProbe.has_alpha ? 'transparent background' : 'opaque — no transparency'}
				</p>
			{/if}

			<div class="actions">
				<!-- `rel="external"`: this points at a `+server.ts` endpoint, not an app route, so the
				     SvelteKit router must hand it to the browser as a real navigation for the download
				     to happen. -->
				<a
					class="dl"
					rel="external"
					href={api(
						'file',
						`session=${encodeURIComponent(session.id)}&v=${encodeURIComponent(downloading.file)}`,
					)}
					download={dlFileName(downloading, '.webp')}
				>
					⤓ Animated WEBP
				</a>
				<p class="hint">The render exactly as generated: one looping file, alpha intact.</p>

				<button class="dl" disabled={dlBusy} onclick={downloadZip}>
					{dlBusy ? 'Building the frame sequence…' : '⤓ PNG frame sequence (.zip)'}
				</button>
				<p class="hint">
					Every frame at full resolution and <b>untrimmed</b> — this is the interchange export, not
					the packer, so nothing is cropped or downscaled. An <code>info.json</code> rides along carrying
					the frame rate, which is the one thing a folder of stills cannot. Built on demand, so a long
					render takes a moment.
				</p>
			</div>
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
				role at a node. Only <b>output</b> is required. It publishes as a <b>video</b> blueprint, so
				it appears here and not in the Atlas Maker.
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

				<div class="fld"><span>Bindings (role → node input)</span></div>
				<p class="hint">
					<b>Suggested</b> is a ranking, not a shortlist — every input in the graph is under
					<b>All node inputs</b> below it. Graphs that pull their knobs out into
					<code>Primitive</code> nodes are read through the wire, so a prompt suggestion points at
					the
					<code>PrimitiveString</code> that feeds the encoder rather than at the encoder's own wired
					input.
				</p>
				{#each PUBLISH_ROLES as r (r.role)}
					{@const sugg = suggestionsByRole[r.role] ?? []}
					<label class="brow">
						<span>
							{r.role}{r.expected && (r.role === STRUCTURAL_ROLE || sugg.length) ? ' *' : ''}{r.hint
								? ` — ${r.hint}`
								: ''}
						</span>
						<select
							value={pubBindings[r.role] ?? ''}
							disabled={pubBusy}
							onchange={(e) => (pubBindings = { ...pubBindings, [r.role]: e.currentTarget.value })}
						>
							<option value="">(not used)</option>
							{#if sugg.length}
								<optgroup label="Suggested">
									{#each sugg as s (s.target.node + s.target.field)}
										<option value={bindValue(r.role, s.target)}>
											{nodeLabel(s.target.node)}{s.target.field ? ` · ${s.target.field}` : ''}{s.via
												? ` — ${s.via}`
												: ''}
										</option>
									{/each}
								</optgroup>
							{/if}
							{#if r.role === 'output'}
								<optgroup label="All nodes">
									{#each allNodes as n (n.id)}
										<option value={n.id}>{n.label}</option>
									{/each}
								</optgroup>
							{:else}
								<optgroup label="All node inputs">
									{#each allInputs as t (t.node + t.field)}
										<option value={`${t.node}::${t.field}`}>{t.label}</option>
									{/each}
								</optgroup>
							{/if}
						</select>
					</label>
				{/each}
				{#if unboundExpected.length}
					<div class="diag">
						<b>
							⚠ {unboundExpected.join(' and ')}
							{unboundExpected.length === 1 ? 'is' : 'are'} unbound, but this graph has
							{unboundExpected.length === 1 ? 'one' : 'them'}.
						</b>
						Publishing is allowed — this is a warning, not a refusal.
						{#each unboundExpected as role (role)}
							<div>• {role} — {ROLE_COST[role]}.</div>
						{/each}
					</div>
				{/if}
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
						onclick={() => (pubParams = [...pubParams, blankParamRow()])}>＋ Add</button
					>
				</div>
				{#if unexposedGates.length}
					<div class="diag">
						<b
							>⚠ This graph has {unexposedGates.length === 1
								? 'a switch'
								: `${unexposedGates.length} switches`} nothing will be able to reach.</b
						>
						Only exposed settings are written at render time — everything else keeps the value your ComfyUI
						export saved, on every render, with no way to change it here.
						{#each unexposedGates as gate (gate.node + gate.field)}
							<div class="gate">
								<span
									>{nodeLabel(gate.node)} · {gate.field} — baked
									<b>{String(gate.value)}</b>, switches {gate.switches}
									{gate.switches === 1 ? 'input' : 'inputs'}</span
								>
								<button
									class="sm"
									disabled={pubBusy}
									onclick={() => exposeGate(gate.node, gate.field)}>Expose</button
								>
							</div>
						{/each}
					</div>
				{/if}
				{#if pubSpecsNote}<p class="hint">{pubSpecsNote}</p>{/if}
				{#if pubParams.length}
					<p class="hint">
						Pick the input first — the key, type and default are read off the graph's own baked
						value, and the bounds and option list off the node's own contract. A blank default
						publishes as <b>0</b>, and the default is what runs on every render nobody overrode.
					</p>
				{/if}
				{#each pubParams as prm, i (i)}
					<div class="prow">
						<select
							class="tgt"
							value={prm.node && prm.field ? `${prm.node}::${prm.field}` : ''}
							disabled={pubBusy}
							onchange={(e) => setParamTarget(i, e.currentTarget.value)}
						>
							<option value="">(node · input)</option>
							{#each paramTargets as t (t.node + t.field)}
								<option
									value={`${t.node}::${t.field}`}
									disabled={!!t.boundTo && `${prm.node}::${prm.field}` !== `${t.node}::${t.field}`}
									>{t.label}</option
								>
							{/each}
						</select>
						<select bind:value={prm.type} disabled={pubBusy}>
							<option>int</option><option>float</option><option>text</option>
							<option>bool</option><option>select</option>
						</select>
						<button
							class="danger sm"
							disabled={pubBusy}
							onclick={() => (pubParams = pubParams.filter((_, j) => j !== i))}>✕</button
						>
						<div class="pfields">
							<input
								placeholder="key"
								title="The setting's id — what a render sends"
								bind:value={prm.key}
								oninput={(e) => syncLabelToKey(i, e.currentTarget.value)}
								disabled={pubBusy}
							/>
							<input
								placeholder="label (shown in the panel)"
								title="What the Generate panel calls this setting — follows the key until you type one"
								bind:value={prm.label}
								disabled={pubBusy}
							/>
							<input placeholder="default" bind:value={prm.def} disabled={pubBusy} />
							<input placeholder="group (optional)" bind:value={prm.group} disabled={pubBusy} />
							{#if prm.type === 'int' || prm.type === 'float'}
								<input
									placeholder="min"
									title="Lowest value the node accepts — read off ComfyUI; blank = unbounded"
									bind:value={prm.min}
									disabled={pubBusy}
								/>
								<input
									placeholder="max"
									title="Highest value the node accepts — read off ComfyUI; blank = unbounded"
									bind:value={prm.max}
									disabled={pubBusy}
								/>
								<input
									placeholder="step"
									title="Slider step — read off ComfyUI"
									bind:value={prm.step}
									disabled={pubBusy}
								/>
							{/if}
							{#if prm.type === 'select'}
								<input
									class="wide"
									placeholder="options, comma-separated"
									title={prm.optionsFrom
										? `Read off ${prm.optionsFrom.class} · ${prm.optionsFrom.field}, and re-read live each time the Generate panel opens — this list is the fallback for when ComfyUI is asleep`
										: 'The choices the Generate panel offers'}
									bind:value={prm.options}
									disabled={pubBusy}
								/>
							{/if}
							{#if prm.type === 'text'}
								<label class="chk" title="Give this setting a full-width box, not an inline field">
									<input type="checkbox" bind:checked={prm.multiline} disabled={pubBusy} />
									<span>prompt-sized box</span>
								</label>
							{/if}
						</div>
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
						<button
							class="rrefresh"
							disabled={!!pickBusy || refreshing}
							title={REFRESH_TITLE}
							onclick={refreshArt}
						>
							{refreshing ? '…' : '↻'}
						</button>
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
	/* One role binding. Deliberately NOT `.fld.sm`, whose select is pinned to 90px —
	   node labels carry a title, a class and an id, and 90px truncated every one of
	   them to "Load Imag". */
	.brow {
		display: block;
		margin-bottom: 6px;
	}
	.brow > span {
		display: block;
		font-size: 11px;
		color: #94a3b8;
		margin-bottom: 3px;
	}
	.prow {
		display: grid;
		grid-template-columns: 1fr 84px 28px;
		gap: 4px;
		margin-bottom: 8px;
		padding: 8px;
		border: 1px solid #1f2937;
		border-radius: 6px;
	}
	.prow .pfields {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.prow input {
		min-width: 0;
		flex: 1;
	}
	.prow input.wide {
		flex: 1 0 100%;
	}
	.prow .chk {
		display: flex;
		align-items: center;
		gap: 5px;
		flex: 1 0 100%;
		font-size: 11px;
		color: #94a3b8;
	}
	.prow .chk input {
		width: auto;
		flex: none;
	}
	/* A prose text setting (a second prompt) — label above, box below and full
	   width, like the Prompt field it is a sibling of. `.fld.sm` would pin it to
	   the 90px inline input every numeric knob shares. */
	.fld.prose {
		display: block;
		margin-bottom: 8px;
	}
	.fld.prose > span {
		display: block;
		font-size: 11px;
		color: #94a3b8;
		margin-bottom: 3px;
	}
	.fld.prose textarea {
		width: 100%;
		resize: vertical;
	}
	.prow select {
		min-width: 0;
	}
	/* One flagged gate inside the amber block. The button is the point: a warning
	   that only describes the problem gets read once and skipped thereafter. */
	.gate {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 6px;
	}
	.gate > span {
		min-width: 0;
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
	/* A bounded numeric stacks its label ABOVE a full-width slider + number box. A 0..1 field
	   wants more travel than the 90px slot, and a long label squeezed beside a slider wrapped
	   into a five-line column — seen live on "Steps — quality mode ONLY (…)". */
	.fld.range .range {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.fld.range .range input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
		width: auto;
	}
	.fld.range .range input[type='number'] {
		width: 62px;
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
	/* The two downloads are one pair and have to read as one, but only one of them can
	   be a button: the WEBP is a plain same-origin link, and an <a> inherits none of the
	   `button` styling above. So the look lives here and both wear it. */
	.dl {
		display: block;
		width: 100%;
		box-sizing: border-box;
		text-align: center;
		background: #16202c;
		border: 1px solid #2a3646;
		border-radius: 6px;
		color: #cbd5e1;
		padding: 8px;
		font-size: 12px;
		font-family: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.dl:hover:not(:disabled) {
		background: #27364a;
	}
	.actions .hint {
		margin: -2px 0 4px;
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
	/* The thumbnail is a button, not a picture: it opens the render at full resolution in
	   its own window. It has to shed the shared `button` chrome (that rule paints a slate
	   background and a border) or the checkerboard behind the alpha disappears. */
	.thumb button.zoom {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: none;
		cursor: zoom-in;
	}
	.thumb button.zoom:hover {
		background: none;
	}
	.thumb button.zoom:focus-visible {
		outline: 2px solid #38bdf8;
		outline-offset: -2px;
	}
	.zoomhint {
		position: absolute;
		inset: auto 0 0;
		padding: 3px 6px;
		font-size: 10px;
		letter-spacing: 0.04em;
		color: #cbd5e1;
		background: rgba(9, 13, 20, 0.8);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.thumb button.zoom:hover .zoomhint,
	.thumb button.zoom:focus-visible .zoomhint {
		opacity: 1;
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
	/* The action row is the one that can run out of width — TWO labelled exports plus four icon
	   buttons. It wraps rather than shrinking a label to nothing: at the grid's 220px minimum the
	   two labels sit side by side and the icons fold onto the next line, instead of a button being
	   pushed out of the card (which is what happened when they were one unwrapped row). */
	.crow.acts {
		flex-wrap: wrap;
		row-gap: 4px;
	}
	.make {
		font-size: 10px;
		padding: 2px 6px;
		/* The two labels share the row; the icon buttons keep their natural width beside them. The
		   floor is what makes wrapping possible at all — with `min-width: 0` a label would ellipse
		   away to nothing before the row ever wrapped, and "🎞 M…" is not a button anyone can read. */
		flex: 1 1 auto;
		min-width: 88px;
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
	.rtools .rrefresh {
		flex: none;
		padding: 4px 8px;
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
