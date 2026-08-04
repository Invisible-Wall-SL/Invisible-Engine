/**
 * Shared save-state rune helper (multi-user-concurrency Phase 2a).
 *
 * Consolidates the save/dirty/etag/conflict state machine that eight authoring tools
 * hand-rolled after Phase 1. The helper owns STATE + POLICY (the status machine, the
 * held ETag re-adopted from each save response, dirty tracking, the autosave debounce,
 * the no-re-arm-on-conflict rule, force/overwrite, the create path); the CALLER owns
 * the actual request via the injected `save` transport, so a `fetch` and a SvelteKit
 * form action fit the same shape. It does NOT render — every tool reads the exposed
 * state and draws its own pill/banner/confirm, so appearance is preserved.
 *
 * MUST stay `.svelte.ts` — the `$state` runes below are compiler transforms that only
 * fire for that extension ([[gotcha_runes_in_plain_ts]]).
 *
 * This is a BEHAVIOR-PRESERVING consolidation: it deliberately reproduces two DIFFERENT
 * debounce semantics the two autosavers ship today (see `resetDebounceOnEveryEdit`).
 * Phase 2c (lease / read-only / takeover) becomes a one-place change on top of this.
 */

/** The save-status state machine. `conflict` / `scope-mismatch` are STICKY: autosave
 *  must not re-arm from them, or the write would only ever lose again. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'scope-mismatch';

/**
 * The result of the caller's transport. A success carries the new ETag (re-adopted so
 * the next save CASes against what was just written, not the page-load value). The three
 * failure reasons map 1:1 to the sticky/terminal statuses:
 * - `conflict`   — a lost CAS (412). Forceable via "overwrite with mine".
 * - `scope-mismatch` — the tab's project ≠ the save target's project. NEVER forceable.
 * - `error`      — a transient/other failure. The next autosave (or Retry) tries again.
 */
export type SaveOutcome =
	| { ok: true; etag: string | null }
	| { ok: false; reason: 'conflict' | 'scope-mismatch' | 'error'; message?: string };

/** What the helper hands the transport for each attempt. */
export interface SaveContext {
	/** The CAS base: the ETag the helper currently holds. `null` = create (no stored
	 *  doc). The transport encodes it per its wire (JSON `null` vs form `''`). */
	baseEtag: string | null;
	/** True when the author explicitly chose "overwrite theirs" from a conflict. The
	 *  transport drops the precondition (sends `force`) instead of `baseEtag`. */
	force: boolean;
}

export interface SaveStateOptions {
	/** The transport. Owns the request + its wire encoding; returns a typed outcome. */
	save: (ctx: SaveContext) => Promise<SaveOutcome>;
	/** The ETag from the page load. `null` (or omitted) = no stored doc yet = create. */
	initialEtag?: string | null;
	/** Autosave debounce in ms. Omit / `0` = MANUAL save (no debounce, `markDirty` only
	 *  flips the dirty flag). */
	autosaveMs?: number;
	/**
	 * How the debounce reacts to edits WHILE already dirty — the two autosavers differ:
	 * - `true`  (flow-v2, 800 ms): every edit resets the timer → fires 800 ms after the
	 *   LAST edit (a trailing debounce).
	 * - `false` (Scene Editor, 1200 ms): the timer arms only on the clean→dirty edge and
	 *   is NOT reset by further edits → fires 1200 ms after the FIRST edit since the last
	 *   save (a leading batch). This reproduces the editor's `$effect`-on-`dirty` idiom,
	 *   where a `true→true` write re-runs nothing. Its undo/redo path re-arms explicitly
	 *   via {@link rearmAutosave}, mirroring the old imperative `restartAutosave()`.
	 * Defaults to `true` (the trailing debounce most tools want).
	 */
	resetDebounceOnEveryEdit?: boolean;
	/** Extra gate consulted before ARMING the debounce (never blocks a manual save).
	 *  The editor passes `() => !crossTypeLoaded` so a cross-type preview never autosaves. */
	canAutosave?: () => boolean;
	/** Fallback message for a conflict whose transport supplied none. */
	conflictMessage?: string;
	/**
	 * Hard read-only gate (multi-user-concurrency Phase 2c). When it returns `true`, BOTH
	 * autosave arming AND an explicit `save()` become no-ops (`save()` returns `false`),
	 * so a user who does NOT hold the edit lease can't write. Unlike `canAutosave` (which
	 * only vetoes the debounce, never a manual save), this blocks the manual path too —
	 * the lease is what stops the collision; the CAS floor still guards the rest. Absent /
	 * `false` = no gate, and NOTHING about the existing behavior changes. A tool wires this
	 * as `blockWhen: () => lease.readOnly`.
	 */
	blockWhen?: () => boolean;
}

export class SaveState {
	#opts: SaveStateOptions;
	#status = $state<SaveStatus>('idle');
	#dirty = $state(false);
	#message = $state('');
	// The held ETag is $state so a template/scope-switch adoption re-renders any consumer
	// that reads it; the save machine reads it fresh on every attempt.
	#etag = $state<string | null>(null);
	#autosaveMs: number;
	#reset: boolean;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#pending = false;

	constructor(opts: SaveStateOptions) {
		this.#opts = opts;
		this.#etag = opts.initialEtag ?? null;
		this.#autosaveMs = opts.autosaveMs ?? 0;
		this.#reset = opts.resetDebounceOnEveryEdit ?? true;
	}

	/** The live status-machine value. */
	get status(): SaveStatus {
		return this.#status;
	}
	/** True between a save starting and its outcome. */
	get busy(): boolean {
		return this.#status === 'saving';
	}
	/** True while there are unsaved edits (drives the "Unsaved changes" pill). */
	get dirty(): boolean {
		return this.#dirty;
	}
	/** The conflict / scope-mismatch / error explanation for the banner. */
	get message(): string {
		return this.#message;
	}
	/** The held ETag — the CAS base for the next save. */
	get etag(): string | null {
		return this.#etag;
	}
	/** The two STICKY statuses autosave must never re-arm from. */
	get blocked(): boolean {
		return this.#status === 'conflict' || this.#status === 'scope-mismatch';
	}

	/**
	 * Repoint the held ETag directly — the save TARGET changed. Used by the "Save as…" copy
	 * path (fx / flipbook, → `null` = create, restored if the save is declined), opening a
	 * different component, and switching the game-type template. Because the CAS baseline is
	 * now a different object, any prior `conflict` / `scope-mismatch` — which was about the OLD
	 * baseline — is moot, so this ALSO resets the status machine to `idle`. Without that reset a
	 * sticky conflict would survive the target switch and short-circuit (or force-clobber
	 * without a CAS) the next save of the NEW target — a real lost-update regression.
	 */
	adoptEtag(etag: string | null): void {
		this.#etag = etag;
		this.#status = 'idle';
		this.#message = '';
	}

	/** Set the dirty flag directly — for tools whose dirty is a `$derived` signature
	 *  compare (symbols / win-text / components) rather than an edit-driven flag. */
	setDirty(dirty: boolean): void {
		this.#dirty = dirty;
	}

	/** An edit happened: flag dirty and (re)arm the autosave debounce per the configured
	 *  semantics. A no-op for the debounce when blocked (conflict / scope-mismatch) or
	 *  when `canAutosave()` vetoes it — but the dirty flag is always set. */
	markDirty(): void {
		const wasDirty = this.#dirty;
		this.#dirty = true;
		this.#arm(wasDirty);
	}

	/** Force-(re)arm the debounce regardless of the clean→dirty edge — the imperative
	 *  path the editor's undo/redo used (`restartAutosave`), where a `true→true` dirty
	 *  write would otherwise arm nothing. No-op in manual mode / when blocked / vetoed. */
	rearmAutosave(): void {
		this.#arm(false);
	}

	#arm(wasDirty: boolean): void {
		if (this.#autosaveMs <= 0) return; // manual
		if (this.blocked) return; // never re-arm a sticky conflict/scope-mismatch
		if (this.#opts.blockWhen && this.#opts.blockWhen()) return; // read-only: not our lease
		if (this.#opts.canAutosave && !this.#opts.canAutosave()) return;
		// Leading batch (editor): arm ONLY on the clean→dirty edge; further edits don't
		// reset. Trailing debounce (flow): always reset.
		if (!this.#reset && wasDirty) return;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.save();
		}, this.#autosaveMs);
	}

	/** Cancel any pending autosave (page teardown / explicit stop). */
	cancelAutosave(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}

	/**
	 * Attempt a save. Returns TRUE only when the doc actually reached the store — callers
	 * that navigate away on a flush (the editor's component-editor hop) MUST check it.
	 *
	 * Policy enforced here so every tool spells it the same way:
	 * - `scope-mismatch` is terminal until reload — never forceable, never retried.
	 * - `conflict` blocks all but a `force` save (the explicit "overwrite theirs").
	 * - a save already in flight COALESCES: the in-flight attempt's `finally` re-fires if
	 *   still dirty and not blocked.
	 * - on success the new ETag + clean state are adopted together, so the next autosave
	 *   CASes against what was just written.
	 */
	async save({ force = false }: { force?: boolean } = {}): Promise<boolean> {
		// Read-only gate (Phase 2c): a user who doesn't hold the lease can't write — even the
		// manual/force path. Checked FIRST so it also short-circuits an in-flight coalesce.
		if (this.#opts.blockWhen && this.#opts.blockWhen()) return false;
		if (this.#status === 'scope-mismatch') return false;
		if (this.#status === 'conflict' && !force) return false;
		if (this.#status === 'saving') {
			this.#pending = true;
			return false;
		}
		this.#status = 'saving';
		let saved = false;
		try {
			const outcome = await this.#opts.save({ baseEtag: this.#etag, force });
			if (outcome.ok) {
				this.#etag = outcome.etag;
				this.#dirty = false;
				this.#message = '';
				this.#status = 'saved';
				// Cancel a pending debounce on success ONLY in leading mode (editor). There,
				// an edit arriving mid-flight never armed a timer (the clean→dirty edge already
				// passed), so the only timer that can exist is a PRE-EXISTING one, and killing
				// it reproduces the editor's `$effect`-on-`dirty` cleanup exactly. In trailing
				// mode (flow-v2) a mid-flight edit DID arm a fresh timer that must survive to
				// save that edit — flow-v2 never cancels on success, so neither do we.
				if (!this.#reset) this.cancelAutosave();
				saved = true;
			} else if (outcome.reason === 'conflict') {
				// Keep the local doc + stay dirty. Never discard the author's work here.
				this.#status = 'conflict';
				this.#message = outcome.message ?? this.#opts.conflictMessage ?? '';
			} else if (outcome.reason === 'scope-mismatch') {
				this.#status = 'scope-mismatch';
				this.#message = outcome.message ?? '';
			} else {
				this.#status = 'error';
				this.#message = outcome.message ?? 'Save failed.';
			}
		} catch (e) {
			this.#status = 'error';
			this.#message = e instanceof Error ? e.message : 'Save failed.';
		} finally {
			if (this.#pending) {
				this.#pending = false;
				if (this.#dirty && !this.blocked) void this.save();
			}
		}
		return saved;
	}
}
