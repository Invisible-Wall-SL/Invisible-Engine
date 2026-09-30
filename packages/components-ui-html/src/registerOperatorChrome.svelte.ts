import { untrack } from 'svelte';
import {
	registerComponentActions,
	registerComponentValues,
	registerComponentVisibility,
	type BoolSource,
	type ValueSource,
} from 'engine-layout';
import { stateI18n, stateOperator } from 'state-shared';

/**
 * The OPERATOR's chrome — the wall clock, the session timer, and the HOME / HISTORY links an
 * operator's embed page may declare (`clock`/`showTime`, `elapsedTime`, `home`,
 * `externalHistoryUrl` — see `stateOperator`) — published as engine feeds, so an authored HUD can
 * place each one where its art wants it:
 *
 *  - value sources `clock` (`HH:MM` in the player's locale) and `sessionTime` (`H:MM:SS` since boot);
 *  - visibility sources `clockShow`, `sessionTimeShow`, `homeShow`, `historyShow`;
 *  - actions `home` (the top window goes to the lobby) and `history` (a new tab, no opener).
 *
 * Nothing here decides a market. A surface exists only because the page declared it: an undeclared
 * source emits '' / false and starts no timer, an undeclared action does nothing. With no operator
 * field a game behaves exactly as it did before this module existed.
 *
 * The same model backs `<OperatorChrome>`, the fallback strip every game gets without authoring. The
 * strip must not draw what the HUD already shows, and the only thing the engine knows about an
 * authored HUD is who SUBSCRIBES to a feed — so the public feeds count their subscribers and the strip
 * reads through an uncounted path. See {@link OperatorChrome.shows}.
 */

/** What the fallback strip can draw. */
export type ChromeItem = 'clock' | 'sessionTime' | 'home' | 'history';

/** Every counted feed: the value and visibility sources, plus the two actions' `disabled` flags. */
export type ChromeFeed =
	| 'clock'
	| 'clockShow'
	| 'sessionTime'
	| 'sessionTimeShow'
	| 'home'
	| 'homeShow'
	| 'history'
	| 'historyShow';

/**
 * The feeds whose subscribers mean "the authored HUD already shows this item". A button bound to the
 * `home` action subscribes its `disabled` flag, so it counts even when the author did not also gate
 * it with `homeShow`.
 */
const ITEM_FEEDS: Record<ChromeItem, readonly ChromeFeed[]> = {
	clock: ['clock', 'clockShow'],
	sessionTime: ['sessionTime', 'sessionTimeShow'],
	home: ['home', 'homeShow'],
	history: ['history', 'historyShow'],
};

const TICK_MS = 1000;

/** The browser seams, injectable so a fixture drives time and navigation. */
export interface OperatorChromeHost {
	/** Wall-clock ms since the epoch — what the clock shows. */
	now(): number;
	/** Monotonic ms — what the session timer measures, so a system clock change cannot skew it. */
	uptime(): number;
	/** Call `tick` every `ms` until the returned stop is called. */
	every(ms: number, tick: () => void): () => void;
	navigateTop(url: string): void;
	openTab(url: string): void;
}

const browserHost: OperatorChromeHost = {
	now: () => Date.now(),
	uptime: () => performance.now(),
	every: (ms, tick) => {
		const id = setInterval(tick, ms);
		return () => clearInterval(id);
	},
	navigateTop: (url) => {
		// The lobby is the operator's page, which embeds us; leaving only our frame would strand the
		// player in the lobby-inside-the-game. A cross-origin or sandboxed top may refuse — then the
		// frame itself goes, which is still out of the game. The press is the user activation a
		// browser requires before a frame may navigate its top.
		try {
			(window.top ?? window).location.href = url;
		} catch {
			window.location.href = url;
		}
	},
	openTab: (url) => {
		window.open(url, '_blank', 'noopener,noreferrer');
	},
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** `H:MM:SS` — hours unpadded and unbounded, so a long session reads `12:00:00`, not a wrap. */
export const formatElapsed = (ms: number): string => {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

// A formatter cache, never rendered — reactivity would only cost.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const clockFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * `HH:MM`, 12- or 24-hour as the locale writes it (`en-US` ⇒ `03:07 PM`, `en-GB` ⇒ `15:07`). The
 * operator spells locales `pt_BR`; Intl wants `pt-BR`, and throws on a tag it cannot parse — that
 * falls back to `en` rather than taking the clock down with it.
 */
export const formatClock = (epochMs: number, locale: string): string => {
	const tag = locale.replaceAll('_', '-') || 'en';
	let format = clockFormats.get(tag);
	if (!format) {
		const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
		try {
			format = new Intl.DateTimeFormat(tag, options);
		} catch {
			format = new Intl.DateTimeFormat('en', options);
		}
		clockFormats.set(tag, format);
	}
	return format.format(epochMs);
};

/**
 * Replay `read()` to `run` now and on every change, until the returned stop. The first pass is
 * untracked: `subscribe` is called from inside `<ComponentInstance>`'s effect, which must not start
 * depending on operator state — this watcher owns reacting to it.
 */
function watch<T>(read: () => T, run: (value: T) => void): () => void {
	let last = untrack(read);
	untrack(() => run(last));
	return $effect.root(() => {
		$effect(() => {
			const next = read();
			if (next === last) return;
			last = next;
			untrack(() => run(next));
		});
	});
}

interface Ticker {
	subscribe(run: (value: string) => void): () => void;
}

/**
 * A string feed that re-renders once a second — but only while someone listens AND the operator
 * declared it. Undeclared, it emits '' and holds no timer; one timer serves every subscriber.
 */
function ticker(render: () => string, declared: () => boolean, host: OperatorChromeHost): Ticker {
	// Plain on purpose: subscribing runs inside a consumer's effect, which must not come to depend on
	// who else is listening.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const listeners = new Set<{ run: (value: string) => void }>();
	let value = '';
	let stopTimer: (() => void) | null = null;
	let stopWatch: (() => void) | null = null;

	const publish = (next: string) => {
		value = next;
		for (const listener of listeners) listener.run(next);
	};
	const tick = () => {
		const next = render();
		if (next !== value) publish(next);
	};
	const apply = (on: boolean) => {
		stopTimer?.();
		stopTimer = null;
		if (!on) return publish('');
		publish(render());
		stopTimer = host.every(TICK_MS, tick);
	};

	return {
		subscribe(run) {
			const listener = { run };
			listeners.add(listener);
			if (listeners.size === 1) stopWatch = watch(declared, apply);
			else run(value);
			return () => {
				if (!listeners.delete(listener) || listeners.size > 0) return;
				stopWatch?.();
				stopWatch = null;
				stopTimer?.();
				stopTimer = null;
			};
		},
	};
}

export interface OperatorChrome {
	/**
	 * Whether the fallback strip draws `item`: the operator declared it AND no authored surface
	 * subscribes to any of its feeds. Reactive — reads operator state and the subscriber counts.
	 */
	shows(item: ChromeItem): boolean;
	/** How many authored surfaces subscribe to `feed` right now. */
	subscribers(feed: ChromeFeed): number;
	/** The strip's own, UNCOUNTED reads of the two ticking values. */
	clock: Ticker;
	sessionTime: Ticker;
	home(): void;
	history(): void;
	/** The feeds as registered — exposed so a fixture can drive them as an authored HUD would. */
	values: Record<'clock' | 'sessionTime', ValueSource>;
	visibility: Record<'clockShow' | 'sessionTimeShow' | 'homeShow' | 'historyShow', BoolSource>;
	disabled: Record<'home' | 'history', BoolSource>;
}

/** Build the model without registering it — the fixture's entry; the game goes through the next. */
export function createOperatorChrome(host: OperatorChromeHost = browserHost): OperatorChrome {
	const bootedAt = host.uptime();
	const counts = $state<Record<ChromeFeed, number>>({
		clock: 0,
		clockShow: 0,
		sessionTime: 0,
		sessionTimeShow: 0,
		home: 0,
		homeShow: 0,
		history: 0,
		historyShow: 0,
	});

	/** Wrap a feed so every live subscription is counted under `feed`, released exactly once. */
	const counted = <V>(
		feed: ChromeFeed,
		subscribe: (run: (value: V) => void) => () => void,
	): ((run: (value: V) => void) => () => void) => {
		return (run) => {
			untrack(() => (counts[feed] += 1));
			const stop = subscribe(run);
			let live = true;
			return () => {
				if (!live) return;
				live = false;
				stop();
				untrack(() => (counts[feed] -= 1));
			};
		};
	};
	const flag = (feed: ChromeFeed, read: () => boolean): BoolSource => ({
		subscribe: counted(feed, (run: (value: boolean) => void) => watch(read, run)),
	});

	const clock = ticker(
		() => formatClock(host.now(), stateI18n.i18n.locale || 'en'),
		() => stateOperator.clock,
		host,
	);
	const sessionTime = ticker(
		() => formatElapsed(host.uptime() - bootedAt),
		() => stateOperator.elapsedTime,
		host,
	);

	const declared: Record<ChromeItem, () => boolean> = {
		clock: () => stateOperator.clock,
		sessionTime: () => stateOperator.elapsedTime,
		home: () => stateOperator.home !== null,
		history: () => stateOperator.externalHistoryUrl !== null,
	};

	return {
		shows: (item) => declared[item]() && ITEM_FEEDS[item].every((feed) => counts[feed] === 0),
		subscribers: (feed) => counts[feed],
		clock,
		sessionTime,
		home: () => {
			if (stateOperator.home) host.navigateTop(stateOperator.home);
		},
		history: () => {
			if (stateOperator.externalHistoryUrl) host.openTab(stateOperator.externalHistoryUrl);
		},
		values: {
			clock: { subscribe: counted('clock', clock.subscribe) },
			sessionTime: { subscribe: counted('sessionTime', sessionTime.subscribe) },
		},
		visibility: {
			clockShow: flag('clockShow', declared.clock),
			sessionTimeShow: flag('sessionTimeShow', declared.sessionTime),
			homeShow: flag('homeShow', declared.home),
			historyShow: flag('historyShow', declared.history),
		},
		disabled: {
			home: flag('home', () => !declared.home()),
			history: flag('history', () => !declared.history()),
		},
	};
}

/**
 * Build the chrome and publish its feeds to the engine registries. Called by `<OperatorChrome>`,
 * which `GlobalStyle` mounts AHEAD of the game: `<ComponentInstance>` resolves a feed name once, at
 * its init, so a feed registered after an authored HUD mounted would never bind to it.
 */
export function registerOperatorChrome(host: OperatorChromeHost = browserHost): OperatorChrome {
	const chrome = createOperatorChrome(host);
	registerComponentValues(chrome.values);
	registerComponentVisibility(chrome.visibility);
	registerComponentActions({
		home: { onpress: chrome.home, disabled: chrome.disabled.home },
		history: { onpress: chrome.history, disabled: chrome.disabled.history },
	});
	return chrome;
}
