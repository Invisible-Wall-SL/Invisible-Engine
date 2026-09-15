<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import SaveStatusBadge from '$lib/SaveStatusBadge.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import {
		MAX_SOUND_BYTES,
		SOUND_FILE_EXTENSIONS,
		SOUND_ORIGINS,
		isValidSoundName,
		type SoundBindings,
		type SoundEntry,
		type SoundOrigin,
		type SoundsDoc,
	} from 'engine-layout';
	import { checkSoundLibrary, type SoundBinding } from '$lib/soundUsage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The live doc — the library AND the choices, edited and saved together.
	 *
	 * `bindings` is SEEDED from the server, which reads it from this doc when it has one and from the
	 * old `/config` + `/symbols` homes when it does not. So a project that has never opened this tool
	 * still opens on what its game actually plays, and the first real edit migrates it here.
	 */
	let doc = $state<SoundsDoc>({
		...structuredClone(data.doc),
		bindings: structuredClone(data.bindings),
	});

	/** Compared against the doc to drive the dirty pill. Taken from the SEEDED doc, not the stored
	 *  one — otherwise a project mid-migration would open already "unsaved" without anyone typing. */
	let baseline = $state(JSON.stringify($state.snapshot(doc)));
	const dirty = $derived(JSON.stringify($state.snapshot(doc)) !== baseline);

	const entries = $derived(doc.entries ?? []);

	const UNSORTED = 'Unsorted';

	/** Entries grouped for browsing, section order following first appearance so the list does not
	 *  reshuffle as sections are typed. */
	const sections = $derived.by(() => {
		// A null-prototype record rather than a `Map`: section names are author-typed, so a plain object
		// would answer `groups['constructor']` with something inherited — and a `Map` here trips
		// `svelte/prefer-svelte-reactivity`, which cannot tell a throwaway inside a `$derived` from
		// reactive state. The names array preserves first-appearance order.
		const groups: Record<string, SoundEntry[]> = Object.create(null);
		const order: string[] = [];
		for (const entry of entries) {
			const key = entry.section?.trim() || UNSORTED;
			if (!groups[key]) {
				groups[key] = [];
				order.push(key);
			}
			groups[key].push(entry);
		}
		return order.map((key): [string, SoundEntry[]] => [key, groups[key]]);
	});

	const approvedCount = $derived(entries.filter((e) => e.status === 'approved').length);

	/**
	 * Names that would COLLIDE on save. The server collapses duplicates last-wins, so two entries
	 * sharing a name means the earlier one silently vanishes — the page has to say so before the
	 * author loses the row rather than after.
	 */
	const duplicateNames = $derived(
		entries
			.map((e) => e.name)
			// every occurrence AFTER the first …
			.filter((name, i, all) => all.indexOf(name) !== i)
			// … then one row per repeated name, so "a, a, a" reports `a` once.
			.filter((name, i, repeats) => repeats.indexOf(name) === i),
	);

	/** Entries the save would DROP — an invalid name is not a warning, it is a deletion. */
	const invalidNames = $derived(entries.filter((e) => !isValidSoundName(e.name)).length);

	// ── what plays when ─────────────────────────────────────────────────────────────────────────
	/**
	 * The choices, for READING. Deliberately not `doc.bindings ??= {}`: a `$derived` that writes to
	 * the state it reads re-runs itself, and the block is legitimately absent after a save (the
	 * server drops an empty one) — so reads take a frozen empty and writes go through {@link editable},
	 * which is the only place the block is created.
	 */
	const NO_CHOICES: SoundBindings = Object.freeze({});
	const choices = $derived(doc.bindings ?? NO_CHOICES);

	/** The choices, for WRITING — creates the block on first edit. */
	const editable = (): SoundBindings => (doc.bindings ??= {});

	/** Every cue a picker may offer: this project's sounds first, then the engine's own. */
	const pickable = $derived([
		...entries.map((e) => e.name),
		...data.builtinNames.filter((n) => !entries.some((e) => e.name === n)),
	]);

	/** What a slot plays right now — authored, or the catalogue's own defaults. Shown rather than an
	 *  empty control, because "unset" here means "the engine's default", never "silence". */
	const slotNames = (slot: (typeof data.slots)[number]): string[] => {
		const authored = choices.slots?.[slot.id]?.names;
		return authored?.length ? [...authored] : [...slot.defaults];
	};
	const slotEnabled = (id: string) => choices.slots?.[id]?.enabled !== false;

	/** Store only a DEPARTURE from the catalogue — the same rule the engine resolves by, so a project
	 *  matching the defaults keeps tracking them when they improve instead of freezing today's copy. */
	function setSlotNames(slot: (typeof data.slots)[number], names: string[]) {
		const slots = (editable().slots ??= {});
		const entry = (slots[slot.id] ??= {});
		const isDefault =
			names.length === slot.defaults.length && names.every((n, i) => n === slot.defaults[i]);
		if (isDefault) delete entry.names;
		else entry.names = names;
		if (!Object.keys(entry).length) delete slots[slot.id];
	}

	function setSlotEnabled(id: string, on: boolean) {
		const slots = (editable().slots ??= {});
		const entry = (slots[id] ??= {});
		if (on) delete entry.enabled;
		else entry.enabled = false;
		if (!Object.keys(entry).length) delete slots[id];
	}

	function setSymbolCue(symbol: string, state: string, name: string) {
		const symbols = (editable().symbols ??= {});
		const states = (symbols[symbol] ??= {});
		if (name) states[state] = name;
		else delete states[state];
		if (!Object.keys(states).length) delete symbols[symbol];
	}

	function setAnticipation(field: 'activation' | 'loop', name: string) {
		const ant = (editable().anticipation ??= {});
		if (name) ant[field] = name;
		else delete ant[field];
	}

	function setTierCue(alias: string, field: 'sfx' | 'bgm', name: string) {
		const tiers = (editable().winTiers ??= {});
		const tier = (tiers[alias] ??= {});
		if (name) tier[field] = name;
		else delete tier[field];
	}

	/** The per-symbol section lists symbols that HAVE a cue, plus any you add — a grid of every
	 *  symbol × every state would be mostly empty and unreadable. */
	let extraSymbols = $state<string[]>([]);
	const symbolRows = $derived([
		...new Set([...Object.keys(choices.symbols ?? {}), ...extraSymbols]),
	]);
	let addSymbol = $state('');

	function dropSymbol(symbol: string) {
		if (doc.bindings?.symbols) delete doc.bindings.symbols[symbol];
		extraSymbols = extraSymbols.filter((s) => s !== symbol);
	}

	/** Immutable list edits — `with`/`toSpliced` are ES2023 and this app does not target it. */
	const replaceAt = (list: string[], i: number, value: string) =>
		list.map((n, k) => (k === i ? value : n));
	const removeAt = (list: string[], i: number) => list.filter((_, k) => k !== i);

	/** The library entry a name refers to, or `undefined` for an engine built-in (nothing to audition
	 *  — the shipped audiosprite is one file the browser cannot seek by region here). */
	const entryByName = (name: string) => entries.find((e) => e.name === name);

	// ── usage index ─────────────────────────────────────────────────────────────────────────────
	// Derived from the CHOICES above rather than from the server's read of the docs, so every count,
	// chip and warning on this page answers for what is on screen now — the moment authoring moved
	// here, a server-side index would have been one save behind every edit. Flow is the exception:
	// its cues live in the graph, so they arrive from the server and are listed, not edited.

	// These two tables are declared BEFORE the `$derived` that reads them, and must stay there. On
	// the client a `$derived` is lazy — first read during render, long after the whole script has
	// run — but the SERVER compiles `$derived.by(fn)` to a plain `fn()` AT ITS DECLARATION, so
	// `bindings` runs while a `const` below it is still in its temporal dead zone. Declared after,
	// `SOURCE_HREF` threw `Cannot access before initialization` on every server render of this page:
	// a hard load of /sound was a 500 for weeks while reaching it from another tool page worked,
	// because only the hard load renders on the server.
	const SOURCE_LABEL: Record<SoundBinding['source'], string> = {
		slot: 'Moment',
		winTier: 'Win tier',
		symbol: 'Symbol',
		anticipation: 'Anticipation',
		flow: 'Flow',
	};
	const SOURCE_HREF: Record<SoundBinding['source'], string> = {
		slot: '',
		winTier: '',
		symbol: '',
		anticipation: '',
		flow: '/flow-v2',
	};

	const bindings = $derived.by(() => {
		const index: Record<string, SoundBinding[]> = {};
		const add = (name: string | undefined, source: SoundBinding['source'], where: string) => {
			if (!name) return;
			(index[name] ??= []).push({ name, source, where, href: SOURCE_HREF[source] });
		};
		for (const slot of data.slots) {
			if (!slotEnabled(slot.id)) continue;
			slotNames(slot).forEach((name, i) =>
				add(name, 'slot', slot.kind === 'ladder' ? `${slot.label} · rung ${i + 1}` : slot.label),
			);
		}
		for (const [symbol, states] of Object.entries(choices.symbols ?? {}))
			for (const [state, name] of Object.entries(states))
				add(name, 'symbol', `${symbol} · ${state}`);
		add(choices.anticipation?.activation, 'anticipation', 'Anticipation sting');
		add(choices.anticipation?.loop, 'anticipation', 'Anticipation loop');
		for (const [alias, tier] of Object.entries(choices.winTiers ?? {})) {
			add(tier.sfx, 'winTier', `${alias} · sting`);
			add(tier.bgm, 'winTier', `${alias} · music`);
		}
		for (const cue of data.flowCues) add(cue.name, 'flow', cue.where);
		return index;
	});
	const boundNames = $derived(Object.keys(bindings));
	const checks = $derived(
		checkSoundLibrary(
			$state.snapshot(doc),
			(name) => boundNames.includes(name),
			boundNames,
			data.builtinNames,
		),
	);
	const overriding = $derived(new Set(checks.overridesBuiltin));

	/** What plays a given sound — an empty list means nothing does. */
	const usesOf = (name: string): SoundBinding[] => bindings[name] ?? [];

	let showNotRebindable = $state(false);

	// ── audition ────────────────────────────────────────────────────────────────────────────────
	// One shared element rather than one per row: a library of fifty rows would otherwise open fifty
	// connections, and only one sound is ever being listened to.
	let player: HTMLAudioElement | undefined;
	let playingId = $state<string | null>(null);

	const fileUrl = (file: string) =>
		`/api/sounds/file?project=${encodeURIComponent(data.projectKey)}&file=${encodeURIComponent(file)}`;

	function toggle(entry: SoundEntry) {
		if (!player) return;
		if (playingId === entry.id) {
			player.pause();
			playingId = null;
			return;
		}
		player.src = fileUrl(entry.file);
		// The authored level, so what you hear is what the game will play — auditioning at full
		// volume a sound you deliberately mixed down to 0.2 tells you nothing useful.
		player.volume = entry.volume ?? 1;
		playingId = entry.id;
		void player.play().catch(() => {
			playingId = null;
		});
	}

	// ── upload ──────────────────────────────────────────────────────────────────────────────────
	/** The file being uploaded right now, and how many are still queued behind it. NAMED, because
	 *  "Uploading 1…" over a five-second wait reads like a spinner that might mean nothing, and an
	 *  author who cannot tell which file is in flight has no reason to believe waiting will help. */
	let uploadingName = $state('');
	let uploadQueued = $state(0);
	const uploading = $derived(uploadingName !== '');
	/** One line per FAILED file, and they accumulate: a single field would leave a five-file drop
	 *  reporting only whichever failed last, which is how "it just did nothing" happens. */
	let uploadErrors = $state<string[]>([]);
	/** What the last drop actually ADDED. The rows appear further down the page — below the moments,
	 *  the per-symbol cues and the flow list — so on a laptop the drop zone can report success
	 *  entirely off-screen. This says it where the author is looking. */
	let uploadAdded = $state<string[]>([]);
	let dragging = $state(false);
	/** Aborts whatever is in flight when the page goes away. The author has already been asked (see
	 *  `leaveCost`) and chose to leave, so the remaining work is doomed either way — this just stops
	 *  a doomed PUT from finishing into an orphan nobody will ever see. */
	let uploadAbort: AbortController | null = null;

	const ACCEPT = SOUND_FILE_EXTENSIONS.map((e) => `.${e}`).join(',');

	/** What an endpoint actually said. `error()` answers `{"message":"…"}`, and printing the raw body
	 *  showed the author a line of JSON instead of a sentence. */
	async function errorText(res: Response): Promise<string> {
		const body = await res.text();
		try {
			const parsed = JSON.parse(body) as { message?: unknown };
			if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
		} catch {
			// Not JSON — a proxy or the platform answered, so the body is the best thing we have.
		}
		return body || `HTTP ${res.status}`;
	}

	/**
	 * A playable NAME derived from the upload's own filename, sanitized to what a binding may hold
	 * and de-duplicated against the library.
	 *
	 * Deduplicating here is not politeness: the server collapses duplicates last-wins, so an upload
	 * that reused an existing name would REPLACE that entry on the next save and take its sound out
	 * of the game with no visible step.
	 */
	function nameFor(fileName: string): string {
		// `lastIndexOf` returns -1 for a name with no dot, and `slice(0, -1)` would quietly eat the
		// last character. Only reachable if the extension check ever loosens, which is exactly when
		// nobody would be looking here.
		const dot = fileName.lastIndexOf('.');
		const base = dot > 0 ? fileName.slice(0, dot) : fileName;
		let candidate =
			base
				.trim()
				.replace(/[^A-Za-z0-9_-]+/g, '_')
				.replace(/^_+|_+$/g, '')
				.slice(0, 60) || 'sound';
		const taken = new Set(entries.map((e) => e.name));
		if (!taken.has(candidate)) return candidate;
		for (let i = 2; ; i += 1) {
			const next = `${candidate}_${i}`;
			if (!taken.has(next)) return next;
		}
	}

	/**
	 * The file's real length, measured by decoding it here.
	 *
	 * The server does not do this: it would have to decode five container formats, while the browser
	 * has already decoded the file to play it and its answer is the one that matters — the same
	 * decoder plays the sound in the game. The value becomes the sprite region's length, so a wrong
	 * one clips the sound or makes howler's `end` fire late.
	 */
	async function measureDurationMs(file: File): Promise<number> {
		const ctx = new AudioContext();
		try {
			const buf = await ctx.decodeAudioData(await file.arrayBuffer());
			return Math.max(1, Math.round(buf.duration * 1000));
		} finally {
			void ctx.close();
		}
	}

	/**
	 * Upload one file and add its entry.
	 *
	 * The bytes go STRAIGHT TO R2 through a presigned URL minted by `/api/sounds/file`, the same way
	 * the font, spine and flipbook imports upload. Posting the file to the launcher instead — which
	 * this did — cannot work: adapter-node truncates a request body at 512 KB, so every sound bigger
	 * than a short blip failed, and because the body was cut mid-stream the server answered with a
	 * 400 about multipart parsing that said nothing about size.
	 */
	async function uploadOne(file: File, signal: AbortSignal): Promise<string> {
		if (file.size > MAX_SOUND_BYTES) {
			throw new Error(
				`${Math.round(file.size / 1024 / 1024)} MB — the limit is ${MAX_SOUND_BYTES / 1024 / 1024} MB.`,
			);
		}
		// Decoding comes FIRST and is not instant — a few megabytes is a second or two before a single
		// byte is sent. It is the window this whole guard exists for: leave during it and there is no
		// file, no entry and nothing in R2 to recover, which is exactly what happened on 2026-09-15.
		const durationMs = await measureDurationMs(file);

		const res = await fetch(`/api/sounds/file?project=${encodeURIComponent(data.projectKey)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: file.name, bytes: file.size }),
			signal,
		});
		if (!res.ok) throw new Error(await errorText(res));
		const stored = (await res.json()) as {
			id: string;
			file: string;
			url: string;
			contentType: string;
		};

		// The content-type is signed INTO the URL, so it has to be sent back exactly — R2 answers 403
		// for any other value, including the browser's own guess for the same file.
		const put = await fetch(stored.url, {
			method: 'PUT',
			headers: { 'content-type': stored.contentType },
			body: file,
			signal,
		});
		if (!put.ok) throw new Error(`the upload was refused (${put.status}).`);

		const name = nameFor(file.name);
		doc.entries = [
			...entries,
			{
				id: stored.id,
				name,
				kind: 'sfx',
				file: stored.file,
				durationMs,
				status: 'draft',
				origin: 'library',
			},
		];
		return name;
	}

	/**
	 * The bytes land immediately; the ENTRY only exists once you save. That gap is deliberate — an
	 * upload that also wrote the doc would have to write it unconditionally and could erase a
	 * co-author's library — but it means a file uploaded and never saved is an orphan, so the page
	 * says as much rather than letting it look filed away.
	 */
	async function addFiles(files: FileList | readonly File[] | null) {
		if (!files?.length) return;
		// ONE RUN AT A TIME, and that is load-bearing rather than tidiness: a second run in parallel
		// would race this one's `finally`, and whichever finished first would clear `uploadingName` —
		// emptying `leaveCost` and DISARMING the leave guard while the other run's bytes were still in
		// flight. It would also wipe the other run's reports on the way in. The controls are disabled
		// while busy; this is the guard for a drop that slips through the gap.
		if (uploading) return;
		uploadErrors = [];
		uploadAdded = [];
		uploadAbort = new AbortController();
		const list = Array.from(files);
		const signal = uploadAbort.signal;
		// Sequential, so the progress line can name the file actually in flight and count the ones
		// behind it — which a single spinner cannot.
		for (const [i, file] of list.entries()) {
			if (signal.aborted) break;
			uploadingName = file.name;
			uploadQueued = list.length - i - 1;
			try {
				uploadAdded = [...uploadAdded, await uploadOne(file, signal)];
			} catch (e) {
				// An abort is the page being torn down, not a failure to report to a reader who is
				// already gone — and writing to `$state` from a destroyed component is pointless.
				if (signal.aborted) break;
				uploadErrors = [
					...uploadErrors,
					`${file.name} — ${e instanceof Error ? e.message : String(e)}`,
				];
			} finally {
				uploadingName = '';
				uploadQueued = 0;
			}
		}
		uploadAbort = null;
	}

	function remove(entry: SoundEntry) {
		if (playingId === entry.id) {
			player?.pause();
			playingId = null;
		}
		doc.entries = entries.filter((e) => e.id !== entry.id);
	}

	function setVolume(entry: SoundEntry, raw: string) {
		const n = Number(raw);
		// Out of range is DROPPED, not clamped — the same rule the doc's normalize applies, so the
		// page can't show a level the save would refuse to keep.
		if (Number.isFinite(n) && n >= 0 && n <= 1) entry.volume = n;
		else delete entry.volume;
	}

	function setApproved(entry: SoundEntry, approved: boolean) {
		entry.status = approved ? 'approved' : 'draft';
		if (approved) entry.reviewedAt = new Date().toISOString();
		else {
			// Demoting must actually revoke: a reviewer left on a draft would make the sign-off
			// permanent, which is the one thing an approval must not be.
			delete entry.reviewedBy;
			delete entry.reviewedAt;
		}
	}

	const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

	// ── save ────────────────────────────────────────────────────────────────────────────────────
	const lease = new LeaseState({
		toolId: 'sound',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'sound',
		enabled: data.projectKey.length > 0,
	});

	const saveState = new SaveState({
		initialEtag: data.etag,
		conflictMessage: 'Someone else saved this sound library while you were editing.',
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const res = await fetch(`/api/sounds?project=${encodeURIComponent(data.projectKey)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: $state.snapshot(doc), baseEtag, force }),
			});
			if (res.status === 409) {
				const c = (await res.json()) as { message?: string };
				return { ok: false, reason: 'conflict', message: c.message };
			}
			if (!res.ok) {
				return { ok: false, reason: 'error', message: (await res.text()) || `HTTP ${res.status}` };
			}
			// Adopt the SERVER's doc, not the payload: the normalize DROPS entries it cannot ship, so a
			// page that kept its own copy would list sounds the project does not have.
			const saved = (await res.json()) as { doc: SoundsDoc; etag: string | null };
			doc = structuredClone(saved.doc);
			baseline = JSON.stringify(saved.doc);
			// The drop zone's "Save to keep them" line has just come true, so it stops being advice
			// and starts being a lie. Clearing it here is the only signal that the save covered the
			// upload as well as the choices.
			uploadAdded = [];
			return { ok: true, etag: saved.etag };
		},
	});
	const save = (force = false) => void saveState.save({ force });

	// The dirty flag is DERIVED here (a doc snapshot compared to the last-saved baseline) but the
	// shared pill reads `state.dirty`, so the two have to be kept in step or the badge never leaves
	// "Saved" no matter what you type. Manual-save tool, so this only feeds the pill — there is no
	// debounce to arm.
	$effect(() => {
		saveState.setDirty(dirty);
	});

	/**
	 * What leaving this page right now would throw away, in the author's words — or `''` when
	 * leaving is free.
	 *
	 * Two different losses, and the in-flight one is the worse of the two because it is not even
	 * recoverable by pressing Save: an upload decodes the file, mints a URL and PUTs the bytes, and
	 * a page that goes away mid-sequence leaves NOTHING behind — no entry, and (if it had not
	 * reached the PUT) no object in R2 either.
	 */
	const leaveCost = $derived(
		uploading
			? `${uploadQueued + 1} sound${uploadQueued ? 's are' : ' is'} still uploading. Leaving now loses ${uploadQueued ? 'them' : 'it'} — there is nothing to resume.`
			: dirty
				? 'This library has unsaved changes. Leaving now discards them.'
				: '',
	);

	onMount(() => {
		void lease.start();
		const onUnload = () => lease.release();
		/**
		 * The exits, and why there are two handlers.
		 *
		 * `beforeunload` covers a REAL unload — refresh, closing the tab, the top bar's project
		 * switch — which is the only one the five sibling tools (fx, flipbook, editor, components,
		 * admin) guard. It is not the exit that cost an author two uploads on 2026-09-15: they
		 * clicked **Flow** in the tool bar, and every tool-bar link is an `<a href>` that SvelteKit
		 * intercepts as a client-side navigation, where `beforeunload` never fires at all. Verified
		 * on production: a PUT started here still completes after that navigation (the fetch is not
		 * aborted) but the component is gone, so the entry it would have appended is lost — and a
		 * file still decoding never becomes a PUT in the first place.
		 *
		 * `beforeNavigate` is therefore the one that matters here, and it is the first in the launcher.
		 * It must be `beforeNavigate`, not `onNavigate`: the latter runs AFTER the navigation is
		 * committed and its argument carries no `cancel`, so a guard written on it asks the question
		 * and then leaves anyway — which is worse than not asking. Caught only by clicking it on
		 * production; `vite build` does not typecheck, so nothing else would have.
		 */
		const onBeforeUnload = (e: BeforeUnloadEvent): void => {
			if (!leaveCost) return;
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('pagehide', onUnload);
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			window.removeEventListener('beforeunload', onBeforeUnload);
			uploadAbort?.abort();
			lease.release();
			player?.pause();
		};
	});

	// Registered at component init (`beforeNavigate` is a lifecycle hook, like `onMount`), and torn
	// down with the page. `willUnload` navigations are left to `beforeunload` above: cancelling one
	// of those only re-triggers the browser's own dialog, so confirming twice is the alternative.
	beforeNavigate((navigation) => {
		if (!leaveCost || navigation.willUnload) return;
		if (!window.confirm(`${leaveCost}\n\nLeave anyway?`)) navigation.cancel();
	});
</script>

<svelte:head><title>Invisible Sound — {data.projectKey}</title></svelte:head>

<!--
	One picker, rendered wherever a cue is chosen. A name the library no longer carries stays in the
	list as a flagged option rather than silently resetting to the first entry — a rename upstream
	should be visible here, not quietly re-bound to something else.
-->
{#snippet pick(value: string, onpick: (name: string) => void, allowEmpty: boolean)}
	<select
		class="pick"
		class:missing={Boolean(value) && !pickable.includes(value)}
		{value}
		disabled={lease.readOnly}
		onchange={(e) => onpick(e.currentTarget.value)}
	>
		{#if allowEmpty}<option value="">— none —</option>{/if}
		{#each pickable as name (name)}<option value={name}>{name}</option>{/each}
		{#if value && !pickable.includes(value)}
			<option value={String(value)}>⚠ {value} — no such sound</option>
		{/if}
	</select>
{/snippet}

{#snippet audition(name: string)}
	{@const entry = entryByName(name)}
	{#if entry}
		<button
			class="play small"
			class:on={playingId === entry.id}
			onclick={() => toggle(entry)}
			title="Listen"
		>
			{playingId === entry.id ? '■' : '▶'}
		</button>
	{:else}
		<span
			class="play small ghost"
			title="An engine sound — it lives inside the shipped audiosprite, so there is no single file to play here"
			>·</span
		>
	{/if}
{/snippet}

<audio bind:this={player} onended={() => (playingId = null)} hidden></audio>

<div class="page">
	<ToolTopBar
		current="sound"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if lease.readOnly}
				<PresenceBanner {lease} />
			{:else}
				<SaveStatusBadge
					state={saveState}
					dirtyLabel="Unsaved"
					onRetry={() => save()}
					onReloadTheirs={() => location.reload()}
				/>
			{/if}
			<button
				class="save"
				onclick={() => save()}
				disabled={lease.readOnly || saveState.busy || !dirty}
			>
				{saveState.busy ? 'Saving…' : 'Save'}
			</button>
		{/snippet}
	</ToolTopBar>

	<div class="body">
		{#if saveState.status === 'conflict'}
			<div class="conflict">
				<p>{saveState.message}</p>
				<p class="conflict-sub">
					Your edits are still on this page — nothing has been lost. Reload to take their version
					(your unsaved edits go), or overwrite with yours.
				</p>
				<div class="conflict-actions">
					<button onclick={() => location.reload()}>Reload theirs</button>
					<button class="danger" onclick={() => save(true)}>Overwrite with mine</button>
				</div>
			</div>
		{/if}

		<p class="intro">
			Every sound this game makes, and every sound it owns. The sections below are the game's
			<strong>moments</strong> — pick what each one plays, mute it, or hear it. Underneath is the
			<strong>library</strong>: upload new audio, say where it came from, and approve what is
			cleared to ship. Cues placed on the <a href="/flow-v2">flow graph</a> are the one thing still authored
			elsewhere, and they are listed here so nothing is hidden.
		</p>

		{#if data.unmigrated}
			<p class="warn migrate">
				<strong>This project's choices still live in the old tools.</strong> They have been read out
				of <a href="/config">Invisible Game Config</a> and <a href="/symbols">Invisible Symbols</a>
				so this page opens on what the game actually plays today. Your next
				<strong>save</strong> moves them here for good, and those tools stop deciding.
			</p>
		{/if}

		<section class="authoring">
			<h2>Game moments</h2>
			<p class="hint">
				Every beat the engine sounds. A moment you leave alone plays the engine's own cue — a real
				sound, not silence — so this list is complete from day one and you change only what should
				differ.
			</p>

			{#each data.slots as slot (slot.id)}
				{@const names = slotNames(slot)}
				{@const on = slotEnabled(slot.id)}
				{@const changed = Boolean(choices.slots?.[slot.id]?.names)}
				<div class="moment" class:muted={!on}>
					<div class="moment-head">
						<span class="moment-label">{slot.label}</span>
						{#if slot.kind === 'ladder'}<span class="tag">ladder of {names.length}</span>{/if}
						{#if changed}<span class="tag changed">changed</span>{/if}
						<span class="spacer"></span>
						{#if changed}
							<button
								class="linky"
								disabled={lease.readOnly}
								onclick={() => setSlotNames(slot, [...slot.defaults])}
							>
								reset to default
							</button>
						{/if}
						<label class="toggle" title="Silence this moment entirely">
							<input
								type="checkbox"
								checked={on}
								disabled={lease.readOnly}
								onchange={(e) => setSlotEnabled(slot.id, e.currentTarget.checked)}
							/>
							{on ? 'plays' : 'silent'}
						</label>
					</div>
					<p class="moment-desc">{slot.description}</p>
					{#if slot.ladderIndex}
						<p class="moment-desc idx">Which rung plays is decided by {slot.ladderIndex}</p>
					{/if}
					<div class="cues">
						{#each names as name, i (i)}
							<div class="cue">
								{#if slot.kind === 'ladder'}<span class="rung">{i + 1}</span>{/if}
								{@render pick(
									name,
									(v) => setSlotNames(slot, v ? replaceAt(names, i, v) : removeAt(names, i)),
									names.length > 1,
								)}
								{@render audition(name)}
							</div>
						{/each}
						{#if slot.kind === 'ladder'}
							<button
								class="linky add"
								disabled={lease.readOnly || !pickable.length}
								onclick={() =>
									setSlotNames(slot, [...names, names[names.length - 1] ?? pickable[0]])}
							>
								+ rung
							</button>
						{/if}
					</div>
				</div>
			{/each}
			<p class="hint">
				A ladder's last rung <strong>holds</strong>: a sixth reel or a ninth cascade step keeps
				playing it rather than falling silent. Clearing a moment's only cue is not offered — use
				<strong>silent</strong>, so "the author meant nothing here" stays distinguishable from "the
				author emptied it by accident".
			</p>
		</section>

		<section class="authoring">
			<h2>Per-symbol cues</h2>
			<p class="hint">
				A noise ONE symbol makes at a moment, instead of the game-wide cue above. Optional, and
				normally empty — add a row only for a symbol that should sound like itself. Only the states
				the engine actually asks about are offered.
			</p>
			{#if symbolRows.length}
				<div class="grid" style="--cols:{data.symbolStates.length}">
					<div class="grow head">
						<span>Symbol</span>
						{#each data.symbolStates as st (st.state)}<span>{st.label}</span>{/each}
						<span></span>
					</div>
					{#each symbolRows as symbol (symbol)}
						<div class="grow">
							<code>{symbol}</code>
							{#each data.symbolStates as st (st.state)}
								{@const bound = choices.symbols?.[symbol]?.[st.state] ?? ''}
								<span class="cell">
									{@render pick(bound, (v) => setSymbolCue(symbol, st.state, v), true)}
									{@render audition(bound)}
								</span>
							{/each}
							<button class="del" onclick={() => dropSymbol(symbol)} title="Remove this row"
								>×</button
							>
						</div>
					{/each}
				</div>
			{/if}
			{#if data.symbolIds.length}
				<select
					class="addrow"
					value={addSymbol}
					disabled={lease.readOnly}
					onchange={(e) => {
						const picked = e.currentTarget.value;
						if (picked) extraSymbols = [...extraSymbols, picked];
						e.currentTarget.value = '';
					}}
				>
					<option value="">Add a symbol…</option>
					{#each data.symbolIds.filter((id) => !symbolRows.includes(id)) as id (id)}
						<option value={id}>{id}</option>
					{/each}
				</select>
			{:else}
				<p class="hint">
					This project's <a href="/config">config</a> deals no symbols yet, so there is nothing to give
					a voice to.
				</p>
			{/if}
		</section>

		<section class="authoring">
			<h2>Reel anticipation</h2>
			<p class="hint">
				The tease while a big win is still reachable on the reels yet to stop: a
				<strong>sting</strong> when it starts, a <strong>loop</strong> that holds under it. Whether
				the mode runs at all is decided in <a href="/flow-v2">Invisible Flow</a>; what it sounds
				like is decided here.
			</p>
			<div class="pairs">
				<div class="pair">
					<span>Activation sting</span>
					{@render pick(
						choices.anticipation?.activation ?? '',
						(v) => setAnticipation('activation', v),
						true,
					)}
					{@render audition(choices.anticipation?.activation ?? '')}
				</div>
				<div class="pair">
					<span>Sustained loop</span>
					{@render pick(choices.anticipation?.loop ?? '', (v) => setAnticipation('loop', v), true)}
					{@render audition(choices.anticipation?.loop ?? '')}
				</div>
			</div>
		</section>

		{#if data.winTiers.length}
			<section class="authoring">
				<h2>Win tiers</h2>
				<p class="hint">
					What a celebration sounds like at each tier — the one-shot <strong>sting</strong> that
					opens it and the <strong>music</strong> that runs under the count-up. Which tiers exist,
					and at what multiple, is <a href="/config">config</a>; what they sound like is here.
				</p>
				<div class="grid tiers">
					<div class="grow head">
						<span>Tier</span><span>Sting</span><span>Music bed</span>
					</div>
					{#each data.winTiers as tier (tier.alias)}
						{@const bound = choices.winTiers?.[tier.alias] ?? {}}
						<div class="grow">
							<code>{tier.name}</code>
							<span class="cell">
								{@render pick(bound.sfx ?? '', (v) => setTierCue(tier.alias, 'sfx', v), true)}
								{@render audition(bound.sfx ?? '')}
							</span>
							<span class="cell">
								{@render pick(bound.bgm ?? '', (v) => setTierCue(tier.alias, 'bgm', v), true)}
								{@render audition(bound.bgm ?? '')}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="authoring">
			<h2>Flow cues <span class="tag">read-only</span></h2>
			<p class="hint">
				A cue placed on the graph. It has wires, a condition and a position in a sequence, so it
				stays where it can see them — change one in <a href="/flow-v2">Invisible Flow</a>. Listed
				here so this page can still show <em>every</em> sound the game makes.
			</p>
			{#if data.flowCues.length}
				<div class="flowlist">
					{#each data.flowCues as cue, i (i)}
						<div class="flowrow">
							<code>{cue.name}</code>
							<span>{cue.where}</span>
							{@render audition(cue.name)}
						</div>
					{/each}
				</div>
			{:else}
				<p class="hint">No node in this project's flow plays a sound.</p>
			{/if}
		</section>

		<section>
			<h2>Add sounds</h2>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="drop"
				class:over={dragging}
				ondragover={(e) => {
					e.preventDefault();
					dragging = !lease.readOnly && !uploading;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragging = false;
					// Read-only means another author holds the lease, so Save is refused: accepting a drop
					// would upload bytes this page could never file — a guaranteed orphan, after a minute
					// of waiting to be told no. `uploading` is the re-entrancy half, see `addFiles`.
					if (!lease.readOnly && !uploading) void addFiles(e.dataTransfer?.files ?? null);
				}}
			>
				<p>Drop audio here, or</p>
				<label class="pick">
					<input
						type="file"
						accept={ACCEPT}
						multiple
						disabled={lease.readOnly || uploading}
						onchange={(e) => {
							// Clear the input SYNCHRONOUSLY, before awaiting: chained on the upload promise it
							// stays set for the whole run, and re-picking the same file in that window fires no
							// `change` event at all — the retry after a failure looks like a dead control.
							// COPY first: `input.files` is live, and clearing `value` empties the very list
							// that was just handed over.
							const input = e.currentTarget;
							const picked = Array.from(input.files ?? []);
							input.value = '';
							void addFiles(picked);
						}}
					/>
					choose files
				</label>
				<p class="hint">
					{SOUND_FILE_EXTENSIONS.join(', ')} — up to {MAX_SOUND_BYTES / 1024 / 1024} MB each
				</p>
				{#if uploading}
					<p class="hint busy">
						Uploading <strong>{uploadingName}</strong>…{uploadQueued
							? ` (${uploadQueued} more to go)`
							: ''}
						<br />Stay on this page — leaving now loses it.
					</p>
				{/if}
				{#each uploadErrors as line (line)}<p class="err">{line}</p>{/each}
				{#if uploadAdded.length && !uploading}
					<p class="ok">
						Added <strong>{uploadAdded.join(', ')}</strong> to the list below.
						<strong>Save</strong> to keep {uploadAdded.length === 1 ? 'it' : 'them'} — until then
						{uploadAdded.length === 1 ? 'it is' : 'they are'} only on this page.
					</p>
				{/if}
			</div>
			<p class="hint">
				A file is stored the moment it uploads, but it only becomes part of the library when you
				<strong>save</strong>. Leave without saving and the bytes stay behind unreferenced — and
				nothing else can see the sound: every picker in the launcher, the flow graph's cues
				included, offers a library sound only once it is saved.
			</p>
		</section>

		{#if entries.length === 0}
			<p class="empty">
				This project has no sounds of its own yet — the game plays only the sounds built into the
				engine.
			</p>
		{:else}
			<p class="counts">
				{entries.length} sound{entries.length === 1 ? '' : 's'} · {approvedCount} approved ·
				{entries.length - approvedCount} draft
			</p>

			{#if invalidNames > 0}
				<p class="warn">
					<strong
						>{invalidNames} sound{invalidNames === 1 ? ' has' : 's have'} an unusable name.</strong
					>
					A name may only contain letters, numbers, <code>_</code> and <code>-</code>. Saving now
					would
					<strong>drop</strong> those rows.
				</p>
			{/if}
			{#if duplicateNames.length > 0}
				<p class="warn">
					<strong>Two sounds share a name ({duplicateNames.join(', ')}).</strong> Only the last one survives
					a save — rename one, or the other disappears.
				</p>
			{/if}

			{#each sections as [section, list] (section)}
				<section>
					<h2>{section}</h2>
					<div class="rows">
						{#each list as entry (entry.id)}
							<div class="row" class:bad={!isValidSoundName(entry.name)}>
								<button
									class="play"
									class:on={playingId === entry.id}
									onclick={() => toggle(entry)}
									title="Listen"
								>
									{playingId === entry.id ? '■' : '▶'}
								</button>

								<div class="main">
									<div class="line">
										<input
											class="name"
											value={entry.name}
											oninput={(e) => (entry.name = e.currentTarget.value)}
											placeholder="name"
											title="The name a binding stores"
										/>
										<select bind:value={entry.kind} title="Which player this is meant for">
											<option value="sfx">SFX</option>
											<option value="music">Music</option>
										</select>
										<input
											class="section"
											value={entry.section ?? ''}
											oninput={(e) => {
												const v = e.currentTarget.value.trim();
												if (v) entry.section = v;
												else delete entry.section;
											}}
											placeholder={UNSORTED}
											title="Grouping — for browsing only"
										/>
										<span class="dur">{fmt(entry.durationMs)}</span>
										<label class="vol" title="Base volume (0–1)">
											vol
											<input
												type="number"
												min="0"
												max="1"
												step="0.05"
												value={entry.volume ?? ''}
												oninput={(e) => setVolume(entry, e.currentTarget.value)}
												placeholder="1"
											/>
										</label>
										<label class="loop" title="Loop this sound while it plays">
											<input
												type="checkbox"
												checked={entry.loop ?? false}
												onchange={(e) => {
													if (e.currentTarget.checked) entry.loop = true;
													else delete entry.loop;
												}}
											/>
											loop
										</label>
										{#if usesOf(entry.name).length}
											<span
												class="use bound"
												title={usesOf(entry.name)
													.map((b) => `${SOURCE_LABEL[b.source]}: ${b.where}`)
													.join('\n')}
											>
												played by {usesOf(entry.name).length}
											</span>
										{:else if overriding.has(entry.name)}
											<span
												class="use override"
												title="The engine ships a sound of this name. Yours replaces it — nothing to bind."
											>
												replaces a built-in
											</span>
										{:else}
											<span
												class="use unbound"
												title="Nothing in this project plays this sound yet.">unused</span
											>
										{/if}
										<label class="approve" class:on={entry.status === 'approved'}>
											<input
												type="checkbox"
												checked={entry.status === 'approved'}
												onchange={(e) => setApproved(entry, e.currentTarget.checked)}
											/>
											{entry.status === 'approved' ? 'Approved' : 'Draft'}
										</label>
										<button
											class="del"
											onclick={() => remove(entry)}
											title="Remove from the library">×</button
										>
									</div>

									<details>
										<summary>Where it came from</summary>
										<div class="meta">
											<label>
												Origin
												<select
													value={entry.origin}
													onchange={(e) => (entry.origin = e.currentTarget.value as SoundOrigin)}
												>
													{#each SOUND_ORIGINS as origin (origin)}
														<option value={origin}>{origin}</option>
													{/each}
												</select>
											</label>
											{#if entry.origin === 'ai'}
												<label>
													Model
													<input
														value={entry.model ?? ''}
														oninput={(e) => {
															const v = e.currentTarget.value.trim();
															if (v) entry.model = v;
															else delete entry.model;
														}}
														placeholder="which model generated it"
													/>
												</label>
											{:else}
												<label>
													Author
													<input
														value={entry.author ?? ''}
														oninput={(e) => {
															const v = e.currentTarget.value.trim();
															if (v) entry.author = v;
															else delete entry.author;
														}}
														placeholder="musician or studio"
													/>
												</label>
											{/if}
											<label>
												Licence
												<input
													value={entry.license ?? ''}
													oninput={(e) => {
														const v = e.currentTarget.value.trim();
														if (v) entry.license = v;
														else delete entry.license;
													}}
													placeholder="e.g. CC-BY-4.0, commissioned, royalty-free"
												/>
											</label>
											<label>
												Licence URL
												<input
													value={entry.licenseUrl ?? ''}
													oninput={(e) => {
														const v = e.currentTarget.value.trim();
														if (v) entry.licenseUrl = v;
														else delete entry.licenseUrl;
													}}
													placeholder="where the terms live"
												/>
											</label>
											<label class="wide">
												Notes
												<input
													value={entry.notes ?? ''}
													oninput={(e) => {
														const v = e.currentTarget.value.trim();
														if (v) entry.notes = v;
														else delete entry.notes;
													}}
													placeholder="anything the next person needs to know"
												/>
											</label>
											<p class="file">{entry.file}</p>
										</div>
									</details>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}

			<p class="hint">
				A <strong>draft</strong> still plays everywhere — in the game, in a test build, here. It only
				blocks a publish, so an unapproved sound is never silently missing; you are told before you ship
				it.
			</p>
		{/if}

		<section>
			<h2>What's actually played</h2>
			<p class="hint">
				Everything the sections above bind, plus the flow's own cues, checked against the library. A
				problem here is one you cannot hear: a sound the game asks for and does not have plays
				nothing and reports nothing.
			</p>

			{#if checks.missing.length}
				<p class="warn">
					<strong>Something asks for a sound that doesn't exist:</strong>
					{checks.missing.join(', ')}. Nothing plays at those moments — and the game reports no
					error, it just goes quiet. Either upload a sound with that name, or pick another one
					above.
				</p>
			{/if}
			{#if checks.unapprovedBound.length}
				<p class="warn">
					<strong
						>{checks.unapprovedBound.length} sound{checks.unapprovedBound.length === 1
							? ' is'
							: 's are'} played but not approved:</strong
					>
					{checks.unapprovedBound.join(', ')}. They work — this is the list to review before you
					ship.
				</p>
			{/if}
			{#if checks.unbound.length}
				<p class="hint">
					<strong
						>Nothing plays {checks.unbound.length} of your sound{checks.unbound.length === 1
							? ''
							: 's'}:</strong
					>
					{checks.unbound.join(', ')}. Either give {checks.unbound.length === 1 ? 'it' : 'them'} a moment
					above, or rename to match a built-in sound to replace it.
				</p>
			{/if}
			{#if entries.length > 0 && !checks.missing.length && !checks.unbound.length}
				<p class="hint good">Every sound in this library is played by something.</p>
			{/if}

			<p class="counts">
				{boundNames.length} sound name{boundNames.length === 1 ? '' : 's'} bound across {data
					.builtinNames.length} built-in + {entries.length} project sound{entries.length === 1
					? ''
					: 's'}.
			</p>

			<button class="linky" onclick={() => (showNotRebindable = !showNotRebindable)}>
				{showNotRebindable ? '▾' : '▸'}
				{checks.notRebindable.length} built-in sound{checks.notRebindable.length === 1 ? '' : 's'} you
				can't re-bind from a tool
			</button>
			{#if showNotRebindable}
				<p class="hint">
					These ship with the engine and are played from its own code — no moment, symbol, tier or
					flow cue names them, so there is nothing to point somewhere else. To change one, upload
					your own sound <strong>under the same name</strong> and it replaces it.
				</p>
				<p class="names">{checks.notRebindable.join(' · ')}</p>
			{/if}
		</section>
	</div>
</div>

<style>
	/* ── the authoring sections ── */
	.moment {
		border: 1px solid #23232e;
		border-radius: 8px;
		padding: 10px 12px;
		margin-bottom: 8px;
		background: #101018;
	}
	.moment.muted {
		opacity: 0.55;
	}
	.moment-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.moment-label {
		font-size: 13px;
		font-weight: 600;
	}
	.spacer {
		flex: 1;
	}
	.tag {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: 999px;
		background: #1c1c27;
		color: #8b8b98;
	}
	.tag.changed {
		background: #14372f;
		color: #7ee0c0;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: #8b8b98;
		white-space: nowrap;
	}
	.moment-desc {
		margin: 6px 0 0;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.55;
		max-width: 860px;
	}
	.moment-desc.idx {
		color: #6f6f7d;
	}
	.cues {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}
	.cue {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.rung {
		font-size: 10px;
		color: #6f6f7d;
		width: 14px;
		text-align: right;
	}
	:global(select.pick) {
		background: #16161f;
		border: 1px solid #2a2a37;
		border-radius: 6px;
		color: #e8e8ee;
		font-size: 12px;
		padding: 4px 6px;
		max-width: 220px;
	}
	:global(select.pick.missing) {
		border-color: #b4553f;
		color: #f0a58f;
	}
	:global(.play.small) {
		width: 22px;
		height: 22px;
		font-size: 10px;
		line-height: 1;
		padding: 0;
	}
	:global(.play.small.ghost) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		background: none;
		color: #3a3a48;
		cursor: default;
	}
	.grid {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 10px;
	}
	.grow {
		display: grid;
		grid-template-columns: 90px repeat(var(--cols, 2), minmax(140px, 240px)) auto;
		align-items: center;
		gap: 10px;
	}
	.grid.tiers .grow {
		grid-template-columns: 140px minmax(140px, 240px) minmax(140px, 240px);
	}
	.grow.head {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6f6f7d;
	}
	.grow code {
		font-size: 12px;
		color: #cfcfda;
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.addrow {
		margin-top: 10px;
		background: #16161f;
		border: 1px solid #2a2a37;
		border-radius: 6px;
		color: #e8e8ee;
		font-size: 12px;
		padding: 5px 7px;
	}
	.pairs {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		margin-top: 10px;
	}
	.pair {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.flowlist {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 10px;
	}
	.flowrow {
		display: grid;
		grid-template-columns: 220px 1fr auto;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: #8b8b98;
	}
	.flowrow code {
		color: #cfcfda;
	}
	.warn.migrate {
		margin-bottom: 22px;
	}

	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0b0f;
		color: #e8e8ee;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding: 24px;
		max-width: 1400px;
		width: 100%;
		margin: 0 auto;
	}
	.intro {
		margin: 0 0 24px;
		font-size: 13px;
		color: #b9b9c4;
		line-height: 1.6;
	}
	.intro a {
		color: #7ee0c0;
	}
	section {
		margin-bottom: 30px;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.hint {
		margin: 8px 0 0;
		font-size: 12px;
		color: #8b8b98;
		line-height: 1.6;
		max-width: 900px;
	}
	.hint.busy {
		color: #7ee0c0;
	}
	.counts {
		margin: 0 0 18px;
		font-size: 12px;
		color: #8b8b98;
	}
	.empty {
		font-size: 13px;
		color: #8b8b98;
		padding: 28px 0;
	}
	.warn {
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid #5a4520;
		border-radius: 8px;
		background: #1e1810;
		color: #d3b483;
		font-size: 12px;
		line-height: 1.6;
	}
	.err {
		color: #ff9d9d;
		font-size: 12px;
		margin: 6px 0 0;
	}
	/* The one line that says an upload WORKED. Bordered rather than another grey hint: the rows it
	   refers to are far enough down the page to be off-screen, so this is the whole confirmation. */
	.ok {
		margin: 10px 0 0;
		padding: 8px 10px;
		border: 1px solid #2c5a45;
		border-radius: 8px;
		background: #12201a;
		color: #7ee0c0;
		font-size: 12px;
		line-height: 1.6;
	}
	code {
		font-family: ui-monospace, monospace;
		background: #16161d;
		padding: 1px 5px;
		border-radius: 4px;
		color: #c8a3ff;
	}

	.drop {
		border: 1px dashed #2a2a36;
		border-radius: 10px;
		padding: 22px;
		text-align: center;
		background: #101016;
	}
	.drop.over {
		border-color: #7ee0c0;
		background: #10201b;
	}
	.drop p {
		margin: 0;
		font-size: 13px;
		color: #b9b9c4;
	}
	.pick {
		display: inline-block;
		margin-top: 8px;
		padding: 7px 14px;
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		cursor: pointer;
	}
	.pick:hover {
		border-color: #7ee0c0;
	}
	.pick input {
		display: none;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border: 1px solid #1c1c24;
		border-radius: 10px;
		background: #101016;
	}
	.row.bad {
		border-color: #6a3030;
	}
	.main {
		flex: 1;
		min-width: 0;
	}
	.line {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.play {
		width: 32px;
		height: 32px;
		flex: none;
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		cursor: pointer;
		font-size: 12px;
	}
	.play.on {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	input,
	select {
		border: 1px solid #2a2a36;
		border-radius: 6px;
		background: #16161d;
		color: #e8e8ee;
		font: inherit;
		font-size: 12px;
		padding: 5px 7px;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.name {
		width: 190px;
		font-family: ui-monospace, monospace;
	}
	.section {
		width: 120px;
	}
	.dur {
		font-size: 12px;
		color: #8b8b98;
		font-variant-numeric: tabular-nums;
		min-width: 52px;
	}
	.use {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid #2a2a36;
		color: #8b8b98;
		cursor: help;
		white-space: nowrap;
	}
	.use.bound {
		border-color: #2c4a3e;
		color: #7ee0c0;
	}
	.use.override {
		border-color: #4a4020;
		color: #d3b483;
	}
	.use.unbound {
		border-color: #3a3a46;
		color: #6f6f7d;
	}
	.hint.good {
		color: #7ee0c0;
	}
	.names {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: #6f6f7d;
		line-height: 1.9;
		margin: 8px 0 0;
		max-width: 900px;
	}
	.linky {
		border: 0;
		background: none;
		color: #b9b9c4;
		font: inherit;
		font-size: 12px;
		padding: 8px 0 0;
		cursor: pointer;
		text-align: left;
	}
	.linky:hover {
		color: #7ee0c0;
	}
	.vol,
	.loop,
	.approve {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #8b8b98;
	}
	.vol input {
		width: 62px;
	}
	.approve {
		margin-left: auto;
		padding: 4px 9px;
		border: 1px solid #2a2a36;
		border-radius: 999px;
		cursor: pointer;
	}
	.approve.on {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.del {
		border: 1px solid #2a2a36;
		border-radius: 6px;
		background: #16161d;
		color: #8b8b98;
		cursor: pointer;
		width: 26px;
		height: 26px;
		font-size: 14px;
		line-height: 1;
	}
	.del:hover {
		border-color: #6a3030;
		color: #ff9d9d;
	}

	details {
		margin-top: 6px;
	}
	summary {
		font-size: 11px;
		color: #6f6f7d;
		cursor: pointer;
	}
	summary:hover {
		color: #b9b9c4;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		padding: 10px 0 2px;
	}
	.meta label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: #6f6f7d;
	}
	.meta label.wide {
		flex: 1;
		min-width: 240px;
	}
	.meta label.wide input {
		width: 100%;
	}
	.meta .file {
		width: 100%;
		margin: 4px 0 0;
		font-size: 11px;
		color: #4d4d59;
		font-family: ui-monospace, monospace;
	}

	.save {
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		padding: 6px 14px;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.conflict {
		border: 1px solid #6a3030;
		background: #1d1113;
		border-radius: 10px;
		padding: 14px 16px;
		margin-bottom: 18px;
	}
	.conflict p {
		margin: 0 0 6px;
		font-size: 13px;
		color: #ffbcbc;
	}
	.conflict-sub {
		font-size: 12px !important;
		color: #b9b9c4 !important;
	}
	.conflict-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.conflict-actions button {
		border: 1px solid #2a2a36;
		border-radius: 8px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 12px;
		padding: 6px 12px;
		cursor: pointer;
	}
	.conflict-actions .danger {
		border-color: #6a3030;
		color: #ff9d9d;
	}
</style>
