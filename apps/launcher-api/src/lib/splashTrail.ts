/**
 * The CRT boot splash's per-tab handoff latch + breadcrumb trail.
 *
 * Opening ONE tool can legitimately span TWO documents in the same tab: a
 * launcher route that redirects to a static `view.html`, or an in-tool full
 * navigation (`/fx?effect=…`, `/flipbook?clip=…`, the Editor → Component
 * Editor hop). Each document boots its own splash, so with nothing shared
 * between them the second one replays the whole opening — power-on sweep,
 * ASCII logo, BIOS dateline — and the CRT reads as firing twice.
 *
 * `sessionStorage` is per-TAB and survives a document navigation, so a splash
 * that finds a still-warm heartbeat knows it is CONTINUING one that was on
 * screen a moment ago: it skips the intro, picks up at the phrase loop, and
 * the two documents read as one uninterrupted boot. A splash writes the
 * heartbeat on every poll tick, so the latch holds however long the first one
 * ran — it means "a splash was up moments ago", not "a splash started
 * recently".
 *
 * SAME-ORIGIN ONLY. The Python tools (Atlas / Sheet Maker) are a different
 * origin and cannot see this storage; that pair is covered by
 * `ToolDef.handsOff`, which stops the launcher splashing the hop at all.
 *
 * The trail is also the DIAGNOSTIC. A double is intermittent and crosses a
 * document boundary, so it cannot be caught by watching one page: every start
 * is recorded with its URL and navigation type, and a continuation logs the
 * document it continued FROM. Read `window.__IW_SPLASH_TRAIL__` in the console
 * after a suspected double and the two documents name themselves.
 *
 * Twin: the same logic, inlined and dependency-free, in
 * `static/shared/boot-splash.js` — see docs/ui-inventory.md §12.
 */

const HEARTBEAT_KEY = 'iw:splash:alive';
const TRAIL_KEY = 'iw:splash:trail';

/** A heartbeat younger than this means a splash was on screen a moment ago. */
export const HANDOFF_MS = 1500;

const TRAIL_MAX = 8;

export interface SplashTrailEntry {
	/** `Date.now()` at the moment this splash started. */
	t: number;
	/** Which implementation drew it — `svelte` (in-app) or `vanilla` (shell/static). */
	impl: 'svelte' | 'vanilla';
	tool: string;
	url: string;
	/** `navigate` | `reload` | `back_forward` — how this document was reached. */
	nav: string;
	/** Set when this splash continued one from a previous document. */
	from?: string;
}

/** sessionStorage throws outright in some privacy modes — never let that break a boot. */
function read(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		/* no trail, no latch — the splash just plays in full, as it did before */
	}
}

function navType(): string {
	try {
		const entry = performance.getEntriesByType('navigation')[0] as
			| PerformanceNavigationTiming
			| undefined;
		return entry?.type ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

export function splashTrail(): SplashTrailEntry[] {
	try {
		const raw = read(TRAIL_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? (parsed as SplashTrailEntry[]) : [];
	} catch {
		return [];
	}
}

/** Mark the splash as still on screen. Call it on the poll tick, not once at start. */
export function splashAlive(): void {
	write(HEARTBEAT_KEY, String(Date.now()));
}

/**
 * Record this splash and report whether it CONTINUES one from a previous
 * document. A continuation skips the intro so the boot reads as one screen.
 */
export function splashBegin(tool: string, impl: 'svelte' | 'vanilla'): boolean {
	const now = Date.now();
	const beat = Number(read(HEARTBEAT_KEY));
	const trail = splashTrail();
	const previous = trail[trail.length - 1];
	const continuing = Number.isFinite(beat) && beat > 0 && now - beat < HANDOFF_MS;

	const entry: SplashTrailEntry = {
		t: now,
		impl,
		tool,
		url: location.pathname + location.search,
		nav: navType(),
	};
	if (continuing && previous) entry.from = previous.url;

	write(TRAIL_KEY, JSON.stringify([...trail, entry].slice(-TRAIL_MAX)));
	splashAlive();

	if (continuing && previous) {
		// The pinpoint: a double crosses documents, so this is the only place both
		// halves are visible at once. Left in production deliberately — the report
		// is "every now and then", which no reproduction step will catch.
		console.info(
			`[iw-splash] continuing the splash from ${previous.url} (${previous.impl}) — ` +
				`intro skipped. window.__IW_SPLASH_TRAIL__ for the full trail.`,
		);
	}

	try {
		Object.defineProperty(window, '__IW_SPLASH_TRAIL__', {
			configurable: true,
			get: splashTrail,
		});
	} catch {
		/* nothing to expose — the trail still works */
	}

	return continuing;
}
