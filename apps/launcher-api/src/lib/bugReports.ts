import {
	CAPABILITIES,
	GAME_BUG_TRIAGE_CAPABILITY,
	PIPELINE_BUG_TRIAGE_CAPABILITY,
	TOOLS,
} from '$lib/roles';

/**
 * Bug reports, the parts the pages, the server and Invisible Pipeline Changes share. One module
 * serves two tools that differ only by the bug's `kind`:
 *  - `pipeline` — Invisible Pipeline Bug Reports (`/bugs`): a bug in a tool, the engine or the
 *    launcher, fixed by a pipeline change and sent to Pipeline Changes for it;
 *  - `game` — Invisible Game Bug Reports (`/game-bugs`): one project's own list, a bug in that game,
 *    fixed in the project's content the way Game Maker makes a game (no branch, no pipeline change).
 * Here: the vocabularies (kind, status, priority, area), the `BUG-<n>` reference a pull request names
 * to link a bug, the automatic status rule, and the fix brief. No Svelte, no server imports, so a
 * Node fixture can import it as it is.
 */

export const BUG_KINDS = ['pipeline', 'game'] as const;
export type BugKind = (typeof BUG_KINDS)[number];

export const isBugKind = (v: unknown): v is BugKind =>
	typeof v === 'string' && (BUG_KINDS as readonly string[]).includes(v);

/** The tool (in `TOOLS`) each kind is reported and read in. */
export const BUG_TOOL: Record<BugKind, string> = { pipeline: 'pipelineBugs', game: 'gameBugs' };

/** The capability that triages each kind: each card is granted, per role or per user, on its own. */
export const BUG_TRIAGE: Record<BugKind, string> = {
	pipeline: PIPELINE_BUG_TRIAGE_CAPABILITY,
	game: GAME_BUG_TRIAGE_CAPABILITY,
};

/** How the triage capability of a kind is named, as Admin › Roles names it. */
export const bugTriageName = (kind: BugKind): string =>
	CAPABILITIES.find((c) => c.key === BUG_TRIAGE[kind])?.name ?? BUG_TRIAGE[kind];

export const BUG_STATUSES = ['open', 'working', 'resolved', 'wontFix'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
	open: 'Open',
	working: 'Working on',
	resolved: 'Resolved',
	wontFix: "Won't fix",
};

/** Highest first: the order the filter and the sort use. */
export const BUG_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type BugPriority = (typeof BUG_PRIORITIES)[number];

export const BUG_PRIORITY_LABELS: Record<BugPriority, string> = {
	critical: 'Critical',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
};

export const NO_PRIORITY_LABEL = 'No priority';

/** A pull request a bug is linked to, as GitHub last answered for it. */
export const LINK_STATES = ['open', 'merged', 'closed'] as const;
export type LinkState = (typeof LINK_STATES)[number];

export const isBugStatus = (v: unknown): v is BugStatus =>
	typeof v === 'string' && (BUG_STATUSES as readonly string[]).includes(v);
export const isBugPriority = (v: unknown): v is BugPriority =>
	typeof v === 'string' && (BUG_PRIORITIES as readonly string[]).includes(v);

/** Where a pipeline bug lives that is not one tool. */
const PIPELINE_AREAS: Record<string, string> = {
	engine: 'Game runtime (engine)',
	launcher: 'Launcher / portal',
	other: 'Something else',
};

/** The part of a game a game bug is in, as a player or tester sees it. */
const GAME_AREAS: Record<string, string> = {
	gameplay: 'Gameplay and flow',
	wins: 'Wins, paytable and math',
	features: 'Bonus and free spins',
	art: 'Art and animation',
	ui: 'Buttons, menus and HUD',
	text: 'Text and translations',
	sound: 'Sound',
	loading: 'Loading and speed',
	other: 'Something else',
};

/**
 * Every area a bug of this kind can be filed against: for a pipeline bug each registered tool then
 * the non-tool areas, for a game bug the parts of a game.
 */
export function bugAreas(kind: BugKind): { id: string; name: string }[] {
	if (kind === 'game') return Object.entries(GAME_AREAS).map(([id, name]) => ({ id, name }));
	return [
		...Object.values(TOOLS)
			.map((t) => ({ id: t.id, name: t.name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		...Object.entries(PIPELINE_AREAS).map(([id, name]) => ({ id, name })),
	];
}

// `Object.hasOwn`, never `in`: `constructor` or `__proto__` is not an area.
export const isBugArea = (kind: BugKind, v: unknown): v is string =>
	typeof v === 'string' &&
	(kind === 'game'
		? Object.hasOwn(GAME_AREAS, v)
		: Object.hasOwn(TOOLS, v) || Object.hasOwn(PIPELINE_AREAS, v));

export const bugAreaName = (kind: BugKind, id: string): string => {
	if (!isBugArea(kind, id)) return id;
	return kind === 'game' ? GAME_AREAS[id] : (TOOLS[id]?.name ?? PIPELINE_AREAS[id]);
};

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 20_000;
export const MAX_COMMENT = 5_000;
export const MAX_PAGE_URL = 2_000;
export const MAX_SCREENSHOTS = 10;
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export const bugRef = (number: number): string => `BUG-${number}`;

/**
 * Where a game bug stands on the pipeline bug it was escalated to (ADR-0012 §3): derived from that
 * bug's status, never stored, so a new status never spreads into the lists and filters.
 */
export type PipelineWait = 'waiting' | 'fixed' | 'wontFix';

export const pipelineWaitOf = (status: BugStatus): PipelineWait =>
	status === 'resolved' ? 'fixed' : status === 'wontFix' ? 'wontFix' : 'waiting';

export const pipelineWaitLabel = (number: number, state: PipelineWait): string =>
	state === 'waiting'
		? `Waiting on pipeline · ${bugRef(number)}`
		: state === 'fixed'
			? 'Pipeline fix merged: check the game'
			: "Pipeline: won't fix";

/**
 * The bugs a text names: `BUG-12`, `bug-12` (a branch name). The link sync reads a pull request's
 * title and branch with it, never its description. `debug-12` is not one (the word must start at
 * `bug`).
 */
export function bugRefsIn(text: string): number[] {
	const found = new Set<number>();
	for (const m of text.matchAll(/\bbug-(\d{1,7})\b/gi)) {
		const n = Number(m[1]);
		if (n > 0) found.add(n);
	}
	return [...found].sort((a, b) => a - b);
}

/**
 * The status a linked pull request moves a bug to, or `null` to leave it. Only a CHANGE of the
 * link (a new link, or GitHub answering a new state for it) is fed here, so a status someone set
 * by hand after a merge stays until the next pull request moves:
 *  - a pull request opened for an Open bug → Working on;
 *  - one merged → Resolved, unless someone already resolved it or said Won't fix;
 *  - one closed unmerged → back to Open, but only when a pull request set Working on and no other
 *    linked one is still open.
 */
export function autoStatus(
	current: BugStatus,
	link: LinkState,
	statusWasAuto: boolean,
	otherOpenLinks: boolean,
): BugStatus | null {
	if (link === 'open') return current === 'open' ? 'working' : null;
	if (link === 'merged') return current === 'open' || current === 'working' ? 'resolved' : null;
	return current === 'working' && statusWasAuto && !otherOpenLinks ? 'open' : null;
}

/** Where a bug is read in its own tool: a game bug under its project. */
export function bugPath(bug: { number: number; kind: BugKind; projectKey: string | null }): string {
	return bug.kind === 'game' && bug.projectKey
		? `/game-bugs?project=${encodeURIComponent(bug.projectKey)}&bug=${bug.number}`
		: `/bugs?bug=${bug.number}`;
}

/** What the brief and the Pipeline Changes card need of a bug. */
export interface BriefInput {
	number: number;
	kind: BugKind;
	title: string;
	description: string;
	area: string;
	projectKey: string | null;
	pageUrl: string | null;
	priority: BugPriority | null;
	reporter: string;
	createdAt: string | Date;
	screenshots: number;
}

/**
 * The text a fix starts from — pasted into a Claude Code session, or read by a person. A pipeline
 * bug's brief names the build agent that takes it (`.claude/agents/pipeline-triage.md`) and the
 * branch to fix it on, which is what links the change back to the bug. A game bug's brief is about
 * that game alone: the fix belongs in the project's own content, never in the engine, a tool or a
 * template (those are pipeline changes, reported as a pipeline bug instead).
 */
export function bugBrief(bug: BriefInput, origin: string): string {
	const ref = bugRef(bug.number);
	const created = new Date(bug.createdAt).toISOString().slice(0, 10);
	const game = bug.kind === 'game';
	// A game bug always names its project; the server refuses one without.
	const project = bug.projectKey ?? '';
	const lines = game
		? [
				`Fix ${ref} in the game ${project}: ${bug.title}`,
				'',
				`This is a problem in one game, the project ${project}. Fix it in that ` +
					"project's own content — its game config, scenes, flow, symbols, win text, sound, " +
					'text or art — the way Game Maker makes a game, and check it in the game. Do not change ' +
					'the engine, a tool, a template or another project: if the cause is there, stop and ' +
					'report it as a pipeline bug instead.',
				'',
			]
		: [`Fix ${ref}: ${bug.title}`, ''];
	lines.push(
		`Priority: ${bug.priority ? BUG_PRIORITY_LABELS[bug.priority] : 'not set yet'}`,
		`${game ? 'Part of the game' : 'Area'}: ${bugAreaName(bug.kind, bug.area)}`,
	);
	if (bug.projectKey && !game) lines.push(`Project: ${bug.projectKey}`);
	if (bug.pageUrl) lines.push(`Where: ${bug.pageUrl}`);
	lines.push(
		`Reported by ${bug.reporter} on ${created}`,
		'',
		bug.description.trim() || '(no description)',
		'',
		`Screenshots and discussion: ${origin}${bugPath(bug)}` +
			(bug.screenshots
				? ` (${bug.screenshots} screenshot${bug.screenshots === 1 ? '' : 's'})`
				: ''),
	);
	if (!game) {
		lines.push(
			'',
			`Start with the \`pipeline-triage\` agent, and name the branch \`${ref.toLowerCase()}-…\`. ` +
				'Invisible Pipeline Bug Reports then marks the bug Working on while the pull request is ' +
				'open and Resolved when it merges.',
		);
	}
	return lines.join('\n');
}

/** A page address a report may carry: http(s) only, so it is safe to render as a link. */
export function cleanPageUrl(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const s = v.trim();
	if (!s || s.length > MAX_PAGE_URL) return null;
	try {
		const u = new URL(s);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
	} catch {
		return null;
	}
}
