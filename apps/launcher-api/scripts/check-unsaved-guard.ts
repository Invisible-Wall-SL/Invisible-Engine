/**
 * The leave guard (`src/lib/unsavedGuardCore.ts`, behind `guardUnsavedWork`) asks ONCE per
 * navigation however many guards a page holds, and the navigation it re-issues on "Leave anyway"
 * goes through. The REAL coordinator, driven the way SvelteKit drives `beforeNavigate`: every
 * registered callback, synchronously, with the same navigation object.
 *
 *   1. one dirty guard: cancel, ask its own question, re-issue the link; the re-issued navigation
 *      passes and the ticket is spent, so the next one is asked again;
 *   2. two dirty guards (`/editor`: layout + timeline + component): ONE question naming both, and
 *      the re-issued navigation passes BOTH — with a ticket per guard they cancelled each other's
 *      re-issue and asked forever;
 *   3. "Stay" re-issues nothing; Back/Forward is replayed with `history.go(delta)`, not `goto`;
 *   4. a real unload, a clean page, and a navigation a guard hands to its page are never cancelled;
 *   5. a re-issue that never reaches the hooks (same URL) leaves no ticket behind.
 *
 * Run:  pnpm --filter launcher-api check:unsaved-guard
 */
import { setImmediate } from 'node:timers';
import type { ConfirmOptions } from '../src/lib/dialogs.svelte.ts';
import { createLeaveGuard, type GuardedNavigation } from '../src/lib/unsavedGuardCore.ts';

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`✗ ${label}\n    expected ${e}\n    actual   ${a}`);
}

const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

interface Nav extends GuardedNavigation {
	cancelled: boolean;
}
function nav(href: string | null, extra: { willUnload?: boolean; delta?: number } = {}): Nav {
	const n: Nav = {
		willUnload: extra.willUnload ?? false,
		to: href ? { url: new URL(href, 'https://app.example') } : null,
		cancelled: false,
		cancel() {
			n.cancelled = true;
		},
	};
	if (extra.delta !== undefined) n.delta = extra.delta;
	return n;
}

const question = (title: string): ConfirmOptions => ({
	title,
	message: 'Leaving this page discards them.',
	confirmLabel: 'Leave anyway',
	danger: true,
});

interface Guard {
	dirty: boolean;
	title: string;
	handledElsewhere?: (n: Nav) => boolean;
}

/** A page with `guards`, a SvelteKit stand-in, and a dialog that answers from `answers`. */
function page(guards: Guard[], answers: boolean[], opts: { gotoReachesHooks?: boolean } = {}) {
	const asked: ConfirmOptions[] = [];
	const gotos: string[] = [];
	const historyMoves: number[] = [];
	const reissued: Nav[] = [];
	const leaveGuard = createLeaveGuard({
		ask: async (q) => {
			asked.push(q);
			return answers.shift() ?? false;
		},
		goto: async (to) => {
			gotos.push(to.pathname);
			// SvelteKit awaits the route's intent before it runs the hooks.
			await Promise.resolve();
			if (opts.gotoReachesHooks !== false) reissued.push(fire(nav(to.href)));
		},
		historyGo: (delta) => {
			historyMoves.push(delta);
			setImmediate(() => reissued.push(fire(nav('/previous', { delta }))));
		},
	});
	function fire(n: Nav): Nav {
		for (const g of guards) {
			leaveGuard(n, () => (g.dirty ? question(g.title) : null), g.handledElsewhere);
		}
		return n;
	}
	return { fire, asked, gotos, historyMoves, reissued };
}

// ── 1. One dirty guard ───────────────────────────────────────────────────────
{
	const p = page([{ dirty: true, title: 'Unsaved flow' }], [true]);
	const first = p.fire(nav('/sound'));
	check('one dirty guard cancels the tool switch', first.cancelled, true);
	await settle();
	check('and asks its own question', p.asked, [question('Unsaved flow')]);
	check('"Leave anyway" re-issues the same link', p.gotos, ['/sound']);
	check(
		'the re-issued navigation goes through',
		p.reissued.map((n) => n.cancelled),
		[false],
	);
	check('without asking again', p.asked.length, 1);
	check('the ticket is spent: the next navigation is asked', p.fire(nav('/fx')).cancelled, true);
}

// ── 2. Several dirty guards on one page ─────────────────────────────────────
{
	const p = page(
		[
			{ dirty: true, title: 'Unsaved layout' },
			{ dirty: false, title: 'Unsaved timeline "intro"' },
			{ dirty: true, title: 'Unsaved component' },
		],
		[true, true, true],
	);
	check('two dirty guards cancel the tool switch', p.fire(nav('/flow-v2')).cancelled, true);
	await settle();
	check('with ONE question', p.asked.length, 1);
	check(
		'naming both, and not the clean one',
		p.asked[0]?.message,
		'• Unsaved layout\n• Unsaved component\n\nLeaving this page discards them all.',
	);
	check('one re-issue', p.gotos, ['/flow-v2']);
	check(
		'which passes every guard',
		p.reissued.map((n) => n.cancelled),
		[false],
	);
	await settle();
	check('and nothing asks after it', p.asked.length, 1);
}

// ── 3. Stay; Back/Forward ────────────────────────────────────────────────────
{
	const p = page(
		[
			{ dirty: true, title: 'A' },
			{ dirty: true, title: 'B' },
		],
		[false],
	);
	check('a dirty page cancels', p.fire(nav('/sound')).cancelled, true);
	await settle();
	check('"Stay" re-issues nothing', [p.gotos, p.historyMoves], [[], []]);
	check('and asks once', p.asked.length, 1);
}
{
	const p = page([{ dirty: true, title: 'A' }], [true]);
	check('Back is cancelled', p.fire(nav('/previous', { delta: -1 })).cancelled, true);
	await settle();
	await settle();
	check('and replayed as the same history move, not a goto', [p.historyMoves, p.gotos], [[-1], []]);
	check(
		'which goes through',
		p.reissued.map((n) => n.cancelled),
		[false],
	);
	check('asked once', p.asked.length, 1);
}

// ── 4. Never cancelled ───────────────────────────────────────────────────────
{
	const p = page([{ dirty: true, title: 'A' }], []);
	check(
		'a real unload is left to beforeunload',
		p.fire(nav('/sound', { willUnload: true })).cancelled,
		false,
	);
	await settle();
	check('without the app dialog', p.asked.length, 0);
}
{
	const p = page([{ dirty: false, title: 'A' }], []);
	check('a clean page leaves', p.fire(nav('/sound')).cancelled, false);
}
{
	const toEditor = (n: Nav): boolean => n.to?.url.pathname === '/editor';
	const p = page(
		[
			{ dirty: true, title: 'Layout', handledElsewhere: toEditor },
			{ dirty: false, title: 'Timeline', handledElsewhere: toEditor },
		],
		[],
	);
	check(
		'a navigation the page applies itself is not the guard’s',
		p.fire(nav('/editor?view=components')).cancelled,
		false,
	);
	const q = page(
		[
			{ dirty: false, title: 'Layout', handledElsewhere: toEditor },
			{ dirty: true, title: 'Elsewhere' },
		],
		[false],
	);
	check('but another guard still asks for it', q.fire(nav('/editor')).cancelled, true);
	await settle();
	check('its own question only', q.asked, [question('Elsewhere')]);
}

// ── 5. No stale ticket ───────────────────────────────────────────────────────
{
	const p = page([{ dirty: true, title: 'A' }], [true], { gotoReachesHooks: false });
	p.fire(nav('/flow-v2'));
	await settle();
	check('a re-issue that never reached the hooks', p.gotos, ['/flow-v2']);
	check('leaves no ticket: the next navigation is asked', p.fire(nav('/sound')).cancelled, true);
}

if (failures) {
	console.error(`\n${failures} of ${checks} unsaved-guard checks failed`);
	process.exit(1);
}
console.log(`✓ ${checks} unsaved-guard checks passed`);
