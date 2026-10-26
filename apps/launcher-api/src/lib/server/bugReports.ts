import { randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import {
	BUG_KINDS,
	BUG_TOOL,
	MAX_COMMENT,
	MAX_DESCRIPTION,
	MAX_SCREENSHOTS,
	MAX_SCREENSHOT_BYTES,
	MAX_TITLE,
	autoStatus,
	bugRefsIn,
	cleanPageUrl,
	isBugArea,
	isBugKind,
	isBugPriority,
	isBugStatus,
	type BugKind,
	type BugPriority,
	type BugStatus,
	type LinkState,
} from '$lib/bugReports';
import { BUG_TRIAGE_CAPABILITY, TOOLS, roleHasCapability, roleHasTool } from '$lib/roles';
import {
	deleteScreenshot,
	existingBugNumbers,
	getBugFull,
	getScreenshot,
	insertBug,
	insertScreenshot,
	listBugRows,
	listOpenLinkPrs,
	mutateBug,
	reconcileLinks,
	type Actor,
	type BugEventInput,
	type BugFull,
	type BugPatch,
	type BugReport,
	type BugReportLink,
	type ObservedLink,
} from './bugReportsStore';
import { createSingleFlight, mapWithConcurrency } from './concurrency';
import { SERVED_IMAGE_TYPES, sniffServedImage } from './director/mockups';
import { ENV } from './env';
import { githubApp, type GithubApp } from './githubApp';
import { accessibleProjects } from './projects';
import { deleteObject, deleteObjects, getObjectBytes, listAllKeys, putObjectBytes } from './r2';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * Bug reports, one module behind two tools (`$lib/bugReports.ts` names the kinds): Invisible
 * Pipeline Bug Reports (`/bugs`, `pipeline` bugs) and Invisible Game Bug Reports (`/game-bugs`, one
 * project's `game` bugs). Reporting with screenshots, the overview, the detail, triage (priority,
 * status, and for a pipeline bug sending it to Invisible Pipeline Changes) and the automatic status
 * a linked pull request sets. Rows live in Postgres (`bugReportsStore.ts`), screenshots in R2 under
 * `_bugs/<number>/`, which no shipped asset class reads.
 *
 * Who may do what:
 *  - see and comment: the kind's tool (every role has both by default), on bugs that name no project
 *    or a project the user can open — a bug never shows a project to someone without it;
 *  - edit the text: the reporter, or a triager;
 *  - add a screenshot: anyone who sees the bug; remove one: its uploader, the reporter or a triager;
 *  - priority, status, send to / take back from Pipeline Changes: `bugTriage`.
 */

type User = NonNullable<App.Locals['user']>;

export interface BugAccess {
	user: User;
	actor: Actor;
	canTriage: boolean;
	/** The projects the user may name on a bug. */
	projects: Set<string>;
	/** An admin sees every bug, whatever project it names. */
	seesAll: boolean;
	/** The kinds whose tool the user has: they see and report only those. */
	kinds: Set<BugKind>;
}

/** How a person is named on a bug: the account's name, else the local part of its email. */
export const personName = (user: { name: string | null; email: string }): string =>
	user.name?.trim() || user.email.split('@')[0];

/** No person: a linked pull request on GitHub moved the bug (the launcher's sync records it). */
export const AUTO_ACTOR: Actor = { id: null, name: 'GitHub' };

/**
 * What a viewer may see: the kinds named, and the projects they can open. Bug Reports' own pages
 * pass the kinds whose tool the user has; the Pipeline Changes Bugs tab passes `pipeline`.
 */
export async function bugScopeOf(
	user: User,
	kinds: readonly BugKind[],
): Promise<Omit<BugAccess, 'canTriage'>> {
	const projects = new Set((await accessibleProjects(user.id, user.role)).map((p) => p.key));
	return {
		user,
		actor: { id: user.id, name: personName(user) },
		projects,
		seesAll: user.role === 'admin',
		kinds: new Set(kinds),
	};
}

/**
 * The session gate of every `/api/bugs` endpoint: logged in + at least one of the two tools. What a
 * request then touches is checked against its kind (`requireKind`, `canSee`).
 */
export async function requireBugAccess(locals: App.Locals): Promise<BugAccess> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const { role } = locals.user;
	const roleOverrides = await getRoleOverrides(role);
	const overrides = await getToolOverrides(locals.user.id);
	const kinds = BUG_KINDS.filter((k) => roleHasTool(role, BUG_TOOL[k], roleOverrides, overrides));
	if (!kinds.length) throw error(403, 'Your role does not have access to bug reports.');
	return {
		...(await bugScopeOf(locals.user, kinds)),
		canTriage: roleHasCapability(role, BUG_TRIAGE_CAPABILITY, roleOverrides, overrides),
	};
}

/** The kind a request names, refused when it is not one or the user lacks its tool. */
export function requireKind(access: Pick<BugAccess, 'kinds'>, v: unknown): BugKind {
	if (!isBugKind(v)) throw error(400, 'Say which bug list: pipeline or game.');
	if (!access.kinds.has(v)) {
		throw error(403, `Your role does not have access to ${TOOLS[BUG_TOOL[v]].name}.`);
	}
	return v;
}

export const canSee = (
	scope: Pick<BugAccess, 'projects' | 'seesAll' | 'kinds'>,
	bug: { kind: BugKind; projectKey: string | null },
) =>
	scope.kinds.has(bug.kind) &&
	(bug.projectKey === null || scope.seesAll || scope.projects.has(bug.projectKey));

const TRIAGE = 'the “Triage bug reports” permission';
const TRIAGERS = `someone with ${TRIAGE}`;

function requireTriage(access: BugAccess, what: string): void {
	if (!access.canTriage) throw error(403, `${what} needs ${TRIAGE}.`);
}

// ── What the page reads ────────────────────────────────────────────────────────

export interface BugLinkView {
	number: number;
	title: string;
	/** GitHub's page for it; null for anything that is not `https://github.com/…`. */
	url: string | null;
	state: LinkState;
}

export interface BugSummary {
	number: number;
	kind: BugKind;
	title: string;
	description: string;
	area: string;
	projectKey: string | null;
	pageUrl: string | null;
	reporter: string;
	priority: BugPriority | null;
	status: BugStatus;
	statusBy: string | null;
	statusAt: string | null;
	statusAuto: boolean;
	sentAt: string | null;
	sentBy: string | null;
	createdAt: string;
	updatedAt: string;
	screenshots: number;
	links: BugLinkView[];
	/** The viewer reported it. */
	mine: boolean;
}

export interface BugScreenshotView {
	id: string;
	mediaType: string;
	bytes: number;
	uploadedBy: string;
	uploadedAt: string;
	/** The viewer may remove it: they uploaded it, reported the bug, or triage. */
	canRemove: boolean;
}

export interface BugEventView {
	id: number;
	kind: string;
	actor: string;
	/** Done by the launcher itself, from a linked pull request. */
	auto: boolean;
	at: string;
	data: Record<string, unknown>;
}

export interface BugDetail extends BugSummary {
	revision: number;
	canEdit: boolean;
	screenshotList: BugScreenshotView[];
	events: BugEventView[];
}

/** Whether a linked pull request can move statuses, and when GitHub last answered. */
export interface LinkSync {
	state: 'off' | 'ok' | 'error';
	message: string | null;
	at: string | null;
}

export interface BugList {
	bugs: BugSummary[];
	sync: LinkSync;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const linkView = (l: BugReportLink): BugLinkView => ({
	number: l.prNumber,
	title: l.title,
	url: /^https:\/\/github\.com\//.test(l.url) ? l.url : null,
	state: l.state,
});

function summaryOf(
	viewerId: string,
	bug: BugReport,
	screenshots: number,
	links: BugReportLink[],
): BugSummary {
	return {
		number: bug.number,
		kind: bug.kind,
		title: bug.title,
		description: bug.description,
		area: bug.area,
		projectKey: bug.projectKey,
		pageUrl: bug.pageUrl,
		reporter: bug.reporter,
		priority: bug.priority,
		status: bug.status,
		statusBy: bug.statusBy,
		statusAt: iso(bug.statusAt),
		statusAuto: bug.statusAuto,
		sentAt: iso(bug.sentAt),
		sentBy: bug.sentBy,
		createdAt: bug.createdAt.toISOString(),
		updatedAt: bug.updatedAt.toISOString(),
		screenshots,
		links: links.map(linkView),
		mine: bug.reporterId === viewerId,
	};
}

const isReporter = (access: BugAccess, bug: BugReport) => bug.reporterId === access.user.id;

function detailOf(access: BugAccess, full: BugFull): BugDetail {
	const { bug } = full;
	const mine = isReporter(access, bug);
	return {
		...summaryOf(access.user.id, bug, full.screenshots.length, full.links),
		revision: bug.revision,
		canEdit: mine || access.canTriage,
		screenshotList: full.screenshots.map((s) => ({
			id: s.id,
			mediaType: s.mediaType,
			bytes: s.bytes,
			uploadedBy: s.uploadedBy,
			uploadedAt: s.uploadedAt.toISOString(),
			canRemove: mine || access.canTriage || s.uploadedById === access.user.id,
		})),
		events: full.events.map((e) => ({
			id: e.id,
			kind: e.kind,
			actor: e.actor,
			auto: e.actorId === null,
			at: e.at.toISOString(),
			data: e.data,
		})),
	};
}

/** Every bug of one kind the viewer may see, newest first; a game list is one project's. */
export async function listBugs(
	scope: Omit<BugAccess, 'canTriage'>,
	where: { kind: BugKind; projectKey?: string },
): Promise<BugSummary[]> {
	const rows = await listBugRows();
	return rows.bugs
		.filter(
			(b) =>
				b.kind === where.kind &&
				(where.projectKey === undefined || b.projectKey === where.projectKey) &&
				canSee(scope, b),
		)
		.map((b) =>
			summaryOf(
				scope.user.id,
				b,
				rows.screenshots.get(b.number) ?? 0,
				rows.links.get(b.number) ?? [],
			),
		);
}

const PRIORITY_RANK: Record<BugPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK: Record<BugStatus, number> = { working: 0, open: 1, resolved: 2, wontFix: 3 };

/**
 * The pipeline bugs sent to Invisible Pipeline Changes, for its Bugs tab: still to do first
 * (Working on, then Open), each by priority (unset last), then newest.
 */
export async function listSentBugs(scope: Omit<BugAccess, 'canTriage'>): Promise<BugSummary[]> {
	const rank = (p: BugPriority | null) => (p ? PRIORITY_RANK[p] : 4);
	return (await listBugs(scope, { kind: 'pipeline' }))
		.filter((b) => b.sentAt !== null)
		.sort(
			(a, b) =>
				STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
				rank(a.priority) - rank(b.priority) ||
				b.number - a.number,
		);
}

/** One bug the viewer may see, or the 404 that never says whether it exists. */
async function readVisible(access: BugAccess, number: number): Promise<BugFull> {
	const full = await getBugFull(number);
	if (!full || !canSee(access, full.bug)) throw error(404, `There is no BUG-${number}.`);
	return full;
}

export async function getBug(access: BugAccess, number: number): Promise<BugDetail> {
	return detailOf(access, await readVisible(access, number));
}

export function parseBugNumber(param: string): number {
	const n = Number(param);
	if (!/^\d{1,9}$/.test(param) || !Number.isSafeInteger(n) || n <= 0) {
		throw error(404, 'No such bug.');
	}
	return n;
}

// ── Writes ─────────────────────────────────────────────────────────────────────

const record = (v: unknown): Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function cleanTitle(v: unknown): string {
	const title = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
	if (!title) throw error(400, 'Give the bug a title.');
	if (title.length > MAX_TITLE) throw error(400, `A title is at most ${MAX_TITLE} characters.`);
	return title;
}

function cleanDescription(v: unknown): string {
	const text = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
	if (text.length > MAX_DESCRIPTION) {
		throw error(400, `A description is at most ${MAX_DESCRIPTION} characters.`);
	}
	return text;
}

function cleanArea(kind: BugKind, v: unknown): string {
	if (!isBugArea(kind, v)) {
		throw error(
			400,
			kind === 'game'
				? 'Pick the part of the game the bug is in.'
				: 'Pick the tool or area the bug is in.',
		);
	}
	return v;
}

/** A project the user can open; a game bug must name one. */
function cleanProject(access: BugAccess, kind: BugKind, v: unknown): string | null {
	if (v === null || v === undefined || v === '') {
		if (kind === 'game') throw error(400, 'A game bug belongs to a project: name it.');
		return null;
	}
	if (typeof v !== 'string' || !access.projects.has(v)) {
		throw error(400, 'That project is not one you can open.');
	}
	return v;
}

function cleanUrl(v: unknown): string | null {
	if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
	const url = cleanPageUrl(v);
	if (!url) throw error(400, 'The page address must be an http(s) address.');
	return url;
}

function cleanPriority(v: unknown): BugPriority | null {
	if (v === null || v === undefined || v === '') return null;
	if (!isBugPriority(v)) throw error(400, 'Unknown priority.');
	return v;
}

/**
 * Report a bug of the kind the body names (`pipeline` or `game`). The reporter is the signed-in
 * user, recorded as they are named now.
 */
export async function createBug(access: BugAccess, body: unknown): Promise<BugDetail> {
	const input = record(body);
	const kind = requireKind(access, input.kind);
	const bug = await insertBug(
		{
			kind,
			title: cleanTitle(input.title),
			description: cleanDescription(input.description),
			area: cleanArea(kind, input.area),
			projectKey: cleanProject(access, kind, input.project),
			pageUrl: cleanUrl(input.pageUrl),
			priority: cleanPriority(input.priority),
			reporterId: access.user.id,
			reporter: access.actor.name,
		},
		access.actor,
	);
	return getBug(access, bug.number);
}

const EDITABLE = ['title', 'description', 'area', 'project', 'pageUrl'] as const;

const GAME_NOT_SENT =
	'A game bug is fixed in its project, not through Pipeline Changes. If the cause is in the ' +
	'engine or a tool, report it as a pipeline bug.';

/**
 * Apply one action to a bug the viewer can see: `edit` (the text, pinned to the revision the editor
 * opened), `comment`, `priority`, `status`, `send`, `unsend`. Answers the bug as it now stands.
 */
export async function actOnBug(
	access: BugAccess,
	number: number,
	body: unknown,
): Promise<BugDetail> {
	const input = record(body);
	const full = await readVisible(access, number);
	const decide = decisionFor(access, full.bug, input);
	const updated = await mutateBug(number, access.actor, decide);
	if (!updated) throw error(404, `There is no BUG-${number}.`);
	return getBug(access, number);
}

function decisionFor(
	access: BugAccess,
	seen: BugReport,
	input: Record<string, unknown>,
): (bug: BugReport) => { set: BugPatch; events: BugEventInput[] } | null {
	switch (input.action) {
		case 'edit': {
			if (!isReporter(access, seen) && !access.canTriage) {
				throw error(403, `Only the bug's reporter, or ${TRIAGERS}, can edit it.`);
			}
			const base = input.revision;
			const next: BugPatch = {};
			if ('title' in input) next.title = cleanTitle(input.title);
			if ('description' in input) next.description = cleanDescription(input.description);
			if ('area' in input) next.area = cleanArea(seen.kind, input.area);
			if ('project' in input) next.projectKey = cleanProject(access, seen.kind, input.project);
			if ('pageUrl' in input) next.pageUrl = cleanUrl(input.pageUrl);
			return (bug) => {
				if (base !== bug.revision) {
					throw error(
						409,
						'Someone else edited this bug since you opened it. Reload to see their text, then edit again.',
					);
				}
				const fields = EDITABLE.filter((f) => {
					const key = f === 'project' ? 'projectKey' : f;
					return key in next && next[key] !== bug[key];
				});
				if (!fields.length) return null;
				return {
					set: { ...next, revision: bug.revision + 1 },
					events: [{ kind: 'edited', data: { fields } }],
				};
			};
		}
		case 'comment': {
			const text = typeof input.text === 'string' ? input.text.replace(/\r\n/g, '\n').trim() : '';
			if (!text) throw error(400, 'Write a comment first.');
			if (text.length > MAX_COMMENT) {
				throw error(400, `A comment is at most ${MAX_COMMENT} characters.`);
			}
			return () => ({ set: {}, events: [{ kind: 'comment', data: { text } }] });
		}
		case 'priority': {
			requireTriage(access, "Changing a bug's priority");
			const to = cleanPriority(input.priority);
			return (bug) =>
				bug.priority === to
					? null
					: {
							set: { priority: to },
							events: [{ kind: 'priority', data: { from: bug.priority, to } }],
						};
		}
		case 'status': {
			requireTriage(access, "Changing a bug's status");
			if (!isBugStatus(input.status)) throw error(400, 'Unknown status.');
			const to = input.status;
			return (bug) =>
				bug.status === to
					? null
					: {
							set: {
								status: to,
								statusAuto: false,
								statusBy: access.actor.name,
								statusAt: new Date(),
							},
							events: [{ kind: 'status', data: { from: bug.status, to } }],
						};
		}
		case 'send':
			requireTriage(access, 'Sending a bug to Pipeline Changes');
			if (seen.kind === 'game') throw error(400, GAME_NOT_SENT);
			return (bug) =>
				bug.sentAt
					? null
					: {
							set: { sentAt: new Date(), sentBy: access.actor.name },
							events: [{ kind: 'sent' }],
						};
		case 'unsend':
			requireTriage(access, 'Taking a bug back from Pipeline Changes');
			if (seen.kind === 'game') throw error(400, GAME_NOT_SENT);
			return (bug) =>
				bug.sentAt ? { set: { sentAt: null, sentBy: null }, events: [{ kind: 'unsent' }] } : null;
		default:
			throw error(400, 'Unknown action.');
	}
}

// ── Screenshots ────────────────────────────────────────────────────────────────

const SCREENSHOT_ID = /^[a-f0-9]{16}$/;
const SCREENSHOT_FILE = /^[a-f0-9]{16}\.(png|jpg|webp)$/;

export const screenshotKey = (number: number, file: string): string => `_bugs/${number}/${file}`;

/**
 * Store one screenshot (PNG, JPEG or WebP, by its bytes, at most 10 MB, at most 10 per bug). The
 * object is written create-only first, then recorded; a recording that is refused (the bug filled
 * up meanwhile, or is gone) deletes it again, so nothing is left that no row names.
 */
export async function addScreenshot(
	access: BugAccess,
	number: number,
	bytes: Uint8Array,
): Promise<BugDetail> {
	await readVisible(access, number);
	if (bytes.length === 0) throw error(400, 'The file is empty.');
	if (bytes.length > MAX_SCREENSHOT_BYTES) throw error(413, 'A screenshot is at most 10 MB.');
	const ext = sniffServedImage(bytes);
	if (!ext) throw error(415, 'A screenshot must be a PNG, JPEG or WebP image.');
	const id = randomBytes(8).toString('hex');
	const file = `${id}.${ext}`;
	const mediaType = SERVED_IMAGE_TYPES[ext];
	const key = screenshotKey(number, file);
	await putObjectBytes(key, bytes, mediaType, { ifNoneMatch: '*' });
	const outcome = await insertScreenshot(
		{
			id,
			bugNumber: number,
			file,
			mediaType,
			bytes: bytes.length,
			uploadedById: access.user.id,
			uploadedBy: access.actor.name,
		},
		MAX_SCREENSHOTS,
		access.actor,
	).catch(async (e: unknown) => {
		await deleteObject(key).catch(() => undefined);
		throw e;
	});
	if (outcome !== 'added') {
		await deleteObject(key).catch(() => undefined);
		if (outcome === 'full') {
			throw error(409, `A bug holds at most ${MAX_SCREENSHOTS} screenshots.`);
		}
		throw error(404, `There is no BUG-${number}.`);
	}
	return getBug(access, number);
}

export async function removeScreenshot(
	access: BugAccess,
	number: number,
	id: string,
): Promise<BugDetail> {
	const full = await readVisible(access, number);
	const shot = full.screenshots.find((s) => s.id === id);
	if (!SCREENSHOT_ID.test(id) || !shot) throw error(404, 'No such screenshot.');
	if (!isReporter(access, full.bug) && !access.canTriage && shot.uploadedById !== access.user.id) {
		throw error(
			403,
			`Only whoever added the screenshot, the bug's reporter, or ${TRIAGERS}, can remove it.`,
		);
	}
	const gone = await deleteScreenshot(number, id, access.actor);
	if (gone && SCREENSHOT_FILE.test(gone.file)) {
		await deleteObject(screenshotKey(number, gone.file)).catch(() => undefined);
	}
	return getBug(access, number);
}

/** A screenshot's bytes, only through the row that lists it, on a bug the viewer can see. */
export async function readScreenshot(
	access: BugAccess,
	number: number,
	id: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mediaType: string }> {
	if (!SCREENSHOT_ID.test(id)) throw error(404, 'No such screenshot.');
	await readVisible(access, number);
	const shot = await getScreenshot(number, id);
	const got =
		shot && SCREENSHOT_FILE.test(shot.file)
			? await getObjectBytes(screenshotKey(number, shot.file))
			: null;
	if (!shot || !got) throw error(404, 'No such screenshot.');
	return { bytes: got.body, mediaType: shot.mediaType };
}

/**
 * The screenshots of bugs whose rows are gone — a purged project's game bugs (`deleteProject`
 * deletes the rows). Best-effort: a leftover object is never served, as no row names it.
 */
export async function deleteBugScreenshots(numbers: number[]): Promise<void> {
	for (const n of numbers) {
		await listAllKeys(`_bugs/${n}/`)
			.then(deleteObjects)
			.catch(() => undefined);
	}
}

// ── Linked pull requests ───────────────────────────────────────────────────────

interface GhListedPull {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	state: string;
	merged_at: string | null;
	head: { ref: string; repo: { full_name: string } | null };
	base: { ref: string };
}

const SYNC_EVERY_MS = 60_000;
const PAGE = 100;
const OPEN_PAGES = 3;
/** Links still open that the lists no longer show are read one by one, at most this many. */
const STALE_READS = 20;

let lastSync: { at: number; result: LinkSync } | null = null;
const syncFlight = createSingleFlight();

/** Drop the remembered sync, so the next read asks GitHub again. */
export function forgetBugSync(): void {
	lastSync = null;
}

const linkStateOf = (pull: GhListedPull): LinkState =>
	pull.state === 'open' ? 'open' : pull.merged_at ? 'merged' : 'closed';

/** The bugs each pull request names, as one bug's view of its links. */
export function observeLinks(pulls: GhListedPull[], repo: string): Map<number, ObservedLink[]> {
	const out = new Map<number, ObservedLink[]>();
	for (const pull of pulls) {
		if (pull.base.ref !== 'main' || pull.head.repo?.full_name !== repo) continue;
		const link: ObservedLink = {
			prNumber: pull.number,
			title: pull.title,
			url: pull.html_url,
			state: linkStateOf(pull),
		};
		for (const n of bugRefsIn(`${pull.title}\n${pull.head.ref}\n${pull.body ?? ''}`)) {
			out.set(n, [...(out.get(n) ?? []), link]);
		}
	}
	return out;
}

const STATE_ORDER: Record<LinkState, number> = { closed: 0, open: 1, merged: 2 };

/**
 * What one bug's links write: the rows that are new or changed, and the status their CHANGES move
 * the bug to (`autoStatus`), each move recorded as a `status` event naming the pull request. A
 * link whose state did not change moves nothing, so a status set by hand stays. Within one read,
 * closes apply before opens and merges last, so a bug a merged pull request fixed ends Resolved.
 */
export function planLinks(
	bug: Pick<BugReport, 'status' | 'statusAuto'>,
	existing: Pick<BugReportLink, 'prNumber' | 'title' | 'url' | 'state'>[],
	observed: ObservedLink[],
	at: Date,
): { upserts: ObservedLink[]; set: BugPatch; events: BugEventInput[] } {
	const before = new Map(existing.map((l) => [l.prNumber, l]));
	const after = new Map<number, { prNumber: number; state: LinkState }>(before);
	for (const o of observed) after.set(o.prNumber, o);
	const upserts = observed.filter((o) => {
		const e = before.get(o.prNumber);
		return !e || e.state !== o.state || e.title !== o.title || e.url !== o.url;
	});
	const moved = upserts
		.filter((o) => before.get(o.prNumber)?.state !== o.state)
		.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.prNumber - b.prNumber);
	const events: BugEventInput[] = moved
		.filter((o) => !before.has(o.prNumber))
		.map((o) => ({ kind: 'linked', data: { pr: o.prNumber, title: o.title, state: o.state } }));
	let status = bug.status;
	let auto = bug.statusAuto;
	const set: BugPatch = {};
	for (const o of moved) {
		const otherOpen = [...after.values()].some(
			(l) => l.prNumber !== o.prNumber && l.state === 'open',
		);
		const to = autoStatus(status, o.state, auto, otherOpen);
		if (!to || to === status) continue;
		events.push({ kind: 'status', data: { from: status, to, pr: o.prNumber, because: o.state } });
		status = to;
		auto = true;
		Object.assign(set, { status: to, statusAuto: true, statusBy: `#${o.prNumber}`, statusAt: at });
	}
	return { upserts, set, events };
}

async function readPulls(app: GithubApp, repo: string): Promise<GhListedPull[]> {
	const byNumber = new Map<number, GhListedPull>();
	for (let page = 1; page <= OPEN_PAGES; page++) {
		const batch = await app.json<GhListedPull[]>(
			`/repos/${repo}/pulls?state=open&base=main&per_page=${PAGE}&page=${page}`,
		);
		for (const p of batch) byNumber.set(p.number, p);
		if (batch.length < PAGE) break;
	}
	// Read after the open list, so a pull request that closed in between is known closed.
	const closed = await app.json<GhListedPull[]>(
		`/repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=${PAGE}`,
	);
	for (const p of closed) byNumber.set(p.number, p);
	// A link still open that neither list shows closed too long ago to be in the recent page.
	const stale = (await listOpenLinkPrs()).filter((n) => !byNumber.has(n)).slice(0, STALE_READS);
	const read = await mapWithConcurrency(stale, 4, (n) =>
		app.json<GhListedPull>(`/repos/${repo}/pulls/${n}`).catch(() => null),
	);
	for (const p of read) if (p) byNumber.set(p.number, p);
	return [...byNumber.values()];
}

/**
 * Read the engine repository's pull requests and move the bugs they name: at most once a minute,
 * one read at a time, whatever asks. Off (and says why) until the GitHub App is configured; a
 * GitHub failure is reported as a state and never fails the page that asked.
 */
export function syncBugLinks(app: GithubApp = githubApp): Promise<LinkSync> {
	const missing = app.missing();
	if (missing) return Promise.resolve({ state: 'off', message: missing, at: null });
	if (lastSync && Date.now() - lastSync.at < SYNC_EVERY_MS) {
		return Promise.resolve(lastSync.result);
	}
	return syncFlight('sync', async () => {
		let result: LinkSync;
		try {
			const repo = ENV.GITHUB_ENGINE_REPO;
			const observed = observeLinks(await readPulls(app, repo), repo);
			const known = await existingBugNumbers([...observed.keys()]);
			const at = new Date();
			for (const n of known) {
				const seen = observed.get(n) ?? [];
				await reconcileLinks(n, AUTO_ACTOR, (bug, existing) => planLinks(bug, existing, seen, at));
			}
			result = { state: 'ok', message: null, at: at.toISOString() };
		} catch (err) {
			const why = err instanceof Error ? err.message : String(err);
			result = {
				state: 'error',
				message: `GitHub did not answer: ${why}`,
				at: new Date().toISOString(),
			};
		}
		lastSync = { at: Date.now(), result };
		return result;
	});
}
