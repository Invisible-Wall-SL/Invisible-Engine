/**
 * Client soft-lease lifecycle rune (multi-user-concurrency Phase 2c).
 *
 * The browser half of the coordination hint whose Postgres/endpoint halves shipped in
 * 2b (`$lib/server/lease.ts`, `POST /api/lease`). It owns ACQUIRE → HEARTBEAT →
 * (TAKEOVER) → RELEASE against one key `(toolId, clientKey, projectKey, docKey)` and
 * exposes the reactive `held` / `readOnly` / `heldBy` a tool reads to gate editing and
 * draw the presence banner. It is a coordination HINT, never authz — `toolScope.gate()`
 * stays the real boundary — and it never persists anything itself; the R2 `If-Match`
 * floor still guards every write for the cases a lease structurally cannot cover (a
 * stale tab whose lease expired, a takeover mid-flight, the Python tools).
 *
 * MUST stay `.svelte.ts` — the `$state` runes are compiler transforms that only fire for
 * that extension ([[gotcha_runes_in_plain_ts]]).
 *
 * Design invariants:
 * - `enabled:false` (no active project) makes EVERY method a no-op — it never acquires,
 *   never heartbeats, and `readOnly` stays false so a project-less tab is never wedged.
 * - `readOnly` is true ONLY when we have a KNOWN other holder (`heldBy !== null`). That
 *   fails OPEN before the first acquire resolves and on any network error, so a blip can
 *   never lock the doc — the CAS floor, not the lease, is what prevents lost writes in
 *   those windows. In steady state (post-acquire, no error) this equals `enabled && !held`.
 * - A heartbeat that returns `held:false` means we were TAKEN OVER: flip to read-only but
 *   keep the timer running as a POLL — re-acquiring each tick so the tab auto-recovers the
 *   moment the other holder's lease is released or expires, and the "active N ago" the
 *   banner shows stays live instead of frozen at first acquire. A live holder is always
 *   respected (re-acquire returns `held:false`); only a freed/expired lease is grabbed.
 * - `takeover()` is ALWAYS available (even when disabled it still no-ops) — a crashed tab
 *   must never permanently wedge a doc; expiry is the backstop, explicit takeover the plan.
 */

/** The other holder, enriched for the presence banner. `activeAgoMs` prefers the
 *  server-provided value (from acquire) and is otherwise derived from `heartbeatAt`. */
export interface LeaseHolderView {
	name: string | null;
	email: string | null;
	/** The holder is the caller's OWN other tab/session (a stale/duplicate tab of theirs). */
	mine: boolean;
	/** Milliseconds since the holder last heartbeat — how "live" they are. */
	activeAgoMs: number;
}

/** The `holderView` shape the endpoint returns (a superset of what the banner needs). */
interface HolderWire {
	userId: string;
	name: string | null;
	email: string | null;
	mine: boolean;
	acquiredAt: string;
	heartbeatAt: string;
	expiresAt: string;
}

type AcquireWire =
	| { held: true; heartbeatMs: number; ttlMs: number }
	| { held: false; heldBy: HolderWire; activeAgoMs: number };

type HeartbeatWire =
	| { held: true; heartbeatMs: number }
	| { held: false; heldBy: HolderWire | null };

export interface LeaseStateOptions {
	toolId: string;
	clientKey: string;
	projectKey: string;
	/** The doc under the lease. For the whole-project-doc tools this is the tool id. */
	docKey: string;
	/** False when there is no active project — the lease no-ops entirely. */
	enabled: boolean;
	/** Injected for tests; defaults to the global `fetch`. */
	fetch?: typeof fetch;
	/** POST target; defaults to the real endpoint. */
	endpoint?: string;
}

const DEFAULT_HEARTBEAT_MS = 10_000;

export class LeaseState {
	#opts: LeaseStateOptions;
	#fetch: typeof fetch;
	#endpoint: string;
	#held = $state(false);
	#heldBy = $state<LeaseHolderView | null>(null);
	#heartbeatMs = DEFAULT_HEARTBEAT_MS;
	#timer: ReturnType<typeof setInterval> | null = null;
	#beating = false;
	/** True once an acquire/takeover response has been processed — gates `readOnly` so a
	 *  tab is never read-only in the brief window before the first acquire resolves. */
	#resolved = $state(false);

	constructor(opts: LeaseStateOptions) {
		this.#opts = opts;
		this.#fetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
		this.#endpoint = opts.endpoint ?? '/api/lease';
	}

	/** True while WE hold the lease (editing enabled). */
	get held(): boolean {
		return this.#held;
	}
	/** True exactly when a KNOWN other holder has the lease and the tool is enabled — the
	 *  read-only gate. Fails open before the first acquire / on error (`heldBy === null`). */
	get readOnly(): boolean {
		return this.#opts.enabled && this.#resolved && this.#heldBy !== null;
	}
	/** The other holder, for the presence banner. `null` while held / disabled / pre-acquire. */
	get heldBy(): LeaseHolderView | null {
		return this.#heldBy;
	}
	/** Whether this lease is active at all (there is a project to coordinate on). */
	get enabled(): boolean {
		return this.#opts.enabled;
	}

	#key(): Record<string, string> {
		return {
			toolId: this.#opts.toolId,
			clientKey: this.#opts.clientKey,
			projectKey: this.#opts.projectKey,
			docKey: this.#opts.docKey,
		};
	}

	async #post(action: string): Promise<unknown> {
		const res = await this.#fetch(this.#endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action, ...this.#key() }),
		});
		if (!res.ok) throw new Error(`lease ${action} failed (${res.status})`);
		return res.json();
	}

	#view(holder: HolderWire, activeAgoMs?: number): LeaseHolderView {
		return {
			name: holder.name,
			email: holder.email,
			mine: holder.mine,
			activeAgoMs:
				activeAgoMs ?? Math.max(0, Date.now() - Date.parse(holder.heartbeatAt)),
		};
	}

	/** Acquire the lease (or learn who holds it), then run the periodic tick (heartbeat while
	 *  held, re-acquire poll while an observer). No-op when disabled. */
	async start(): Promise<void> {
		if (!this.#opts.enabled) return;
		try {
			this.#applyAcquire((await this.#post('acquire')) as AcquireWire);
		} catch {
			// Fail open: a failed acquire must never lock the doc — the CAS floor guards writes.
			this.#held = false;
			this.#heldBy = null;
		}
		this.#startTicking();
	}

	/** Fold an `acquire` (or poll-acquire) response into state: we either took the lease, or
	 *  we learned a live holder. Shared by {@link start} and the observer poll in {@link #tick}. */
	#applyAcquire(out: AcquireWire): void {
		this.#resolved = true;
		if (out.held) {
			this.#held = true;
			this.#heldBy = null;
			this.#heartbeatMs = out.heartbeatMs || DEFAULT_HEARTBEAT_MS;
		} else {
			this.#held = false;
			this.#heldBy = this.#view(out.heldBy, out.activeAgoMs);
		}
	}

	/** Force-acquire regardless of the current holder. ALWAYS available (no-op only when
	 *  disabled) so a crashed tab can never permanently wedge a doc. */
	async takeover(): Promise<void> {
		if (!this.#opts.enabled) return;
		try {
			const out = (await this.#post('takeover')) as { held: true; heartbeatMs: number };
			this.#resolved = true;
			this.#held = true;
			this.#heldBy = null;
			this.#heartbeatMs = out.heartbeatMs || DEFAULT_HEARTBEAT_MS;
			this.#startTicking();
		} catch {
			// Leave state as-is; the user can retry the Take over button.
		}
	}

	#startTicking(): void {
		this.#stopTicking();
		this.#timer = setInterval(() => void this.#tick(), this.#heartbeatMs);
	}

	#stopTicking(): void {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	/** One periodic tick: HEARTBEAT while we hold the lease (a `held:false` reply means we were
	 *  taken over → flip read-only but keep ticking), or POLL-ACQUIRE while an observer (grabs a
	 *  freed/expired lease → auto-recover; otherwise refreshes the live holder for the banner). */
	async #tick(): Promise<void> {
		if (this.#beating || !this.#opts.enabled) return;
		this.#beating = true;
		try {
			if (this.#held) {
				const out = (await this.#post('heartbeat')) as HeartbeatWire;
				if (!out.held) {
					// Taken over — flip to read-only; the timer keeps running to poll for recovery.
					this.#held = false;
					this.#resolved = true;
					this.#heldBy = out.heldBy ? this.#view(out.heldBy) : null;
				}
			} else {
				// Read-only observer: re-acquire. A live holder is respected (stays `held:false`,
				// refreshing "active N ago"); a freed/expired lease is grabbed → we become editable.
				this.#applyAcquire((await this.#post('acquire')) as AcquireWire);
			}
		} catch {
			// Transient failure — keep state and try again on the next tick.
		} finally {
			this.#beating = false;
		}
	}

	/** Best-effort release on teardown/unload. Backend expiry is the real backstop, so this
	 *  is fire-and-forget via `keepalive` (survives the unload) with a `sendBeacon` fallback. */
	release(): void {
		this.#stopTicking();
		if (!this.#opts.enabled || !this.#held) return;
		this.#held = false;
		const body = JSON.stringify({ action: 'release', ...this.#key() });
		try {
			if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
				navigator.sendBeacon(this.#endpoint, new Blob([body], { type: 'application/json' }));
				return;
			}
		} catch {
			// fall through to keepalive fetch
		}
		void this.#fetch(this.#endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			keepalive: true,
		}).catch(() => {});
	}

	/** Stop all timers without releasing (e.g. HMR teardown). Prefer {@link release}. */
	stop(): void {
		this.#stopTicking();
	}
}
