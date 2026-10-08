/**
 * The BOOK-OF MIGRATION (`docs/design/book-feature.md` §6, Phase 6): every project of the retired
 * `bookOf` kind becomes a `lines` project whose Game Config carries the Book-of mechanic
 * (`freeSpins.expandingSymbol`), so the lines mock deals it what the book mock deals it now.
 *
 * Three parts, all server-side (the owner presses the button in `/admin`; no credential leaves the
 * server):
 *   - {@link bookOfCensus} — read-only: every project it acts on with the facts the migration needs,
 *     every `book` manifest entry, and whether `_shared/editor-templates/bookOf.json` exists
 *     (Phase 7 needs all three at zero);
 *   - {@link planBookOfMigration} — the dry run: per project, exactly what each step would change,
 *     and what blocks it — the publish gates of its republish included, run against the config it
 *     would save, so a refusal stops the project before anything is written;
 *   - {@link applyBookOfMigrationTo} — the same plan, run for ONE project: config, layout, kind,
 *     republish. The page calls it per project, so no request carries more than one republish.
 *
 * Idempotent: a migrated project is no longer listed, so a second run finds nothing to do; each
 * step compares before it writes; and a project whose kind moved but whose republish did not land
 * is remembered (a pending marker under `_shared/migrations/book-of/`) and retried by the next run.
 *
 * Every write goes through its store's compare-and-swap with a History backup (`'always'`), the
 * kind moves only from `bookOf`, and nothing is written while another session holds a lease on a
 * doc it changes — the precedent is the pots-overlay add-on (`projectAddOn.ts`).
 */ import {
	BOOK_FREE_SPINS_DEFAULTS,
	bookOfThermopylaePreset,
	gameConfigErrors,
	inPlayScatterSymbol,
	normalizeGameConfigDoc,
	resolveBetModes,
	resolveExpandingSymbol,
	resolveFreeSpins,
	symbolsInPlay,
	type BetMode,
	type FreeSpinsConfig,
	type GameConfigDoc,
} from 'game-config';
import type { LayoutDoc } from 'engine-layout';
import { leaseBlocker } from './projectAddOn';
import { ConflictError, loadGameConfigDocWithEtag, saveGameConfigDoc } from './gameConfigStorage';
import { loadDocWithEtag, saveDoc } from './editorStorage';
import { listGamesOwnedByProject } from './games';
import { liveLeases } from './lease';
import { editorTemplateKey, UNASSIGNED_CLIENT } from './projectPaths';
import { listProjects, projectGameType, switchProjectGameType } from './projects';
import { currentPointer } from './publishedRuntime';
import {
	hasOwnBuiltBundle,
	PublishBlockedError,
	publishGame,
	publishGateRefusal,
} from './publishGame';
import {
	deleteObject,
	getObjectText,
	getObjectTextWithEtag,
	listAllKeys,
	objectExists,
	precondition,
	putObjectText,
} from './r2';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import { loadTestServerManifest, type TestServerGameEntry } from './testServerManifest';

/** The kind being retired, and the one its projects become. */
export const BOOK_OF_KIND = 'bookOf';
const LINES_KIND = 'lines';
/** The buy every Book-of game sells (decision 4): the book mock's `betOptions [10, 1000]`. */
const BUY_COST_MULTIPLE = 100;
/** The captured scatter row, paid (decision 1). */
const SCATTER_ROW: Record<number, number> = { 3: 2, 4: 20, 5: 200 };

// ─── the config: pure ─────────────────────────────────────────────────────────────────────────

const preset = (): GameConfigDoc =>
	normalizeGameConfigDoc(bookOfThermopylaePreset()) as GameConfigDoc;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const rowsOf = (table: Record<number, number>) =>
	Object.entries(table).map(([count, pay]) => ({ [count]: pay }));

export type ConfigMigration = {
	/** The config the project would have — `null` only when a blocker stops it. */
	doc: GameConfigDoc | null;
	/** Each change in words, for the dry run. Empty ⇒ the config already says all of it. */
	changes: string[];
	/** What stops the config being migrated (a game that is not 5×3, a result that would not save). */
	blockers: string[];
};

/**
 * The project's config as the migrated game needs it — step 1 of §6. PURE and idempotent: a config
 * it already produced comes back unchanged with no changes listed. An UN-authored project (`null`)
 * gets the Book of Thermopylae preset.
 *
 * What it writes is exactly the departures that make the lines mock deal what the book mock deals:
 * the expanding symbol (the captured weights for the symbols this game can draw, `H1` from 2 reels),
 * `'wild'` on the book scatter, the ten captured paylines, the +10 retrigger (the book mock's
 * untold default, which the lines default of +5 is not), the base bet plus the one 100× buy under
 * the buy's existing name (decision 4), and the scatter row `3:2 4:20 5:200`, paid (decision 1). An
 * author's own expanding block and retrigger table are kept as authored. What it cannot migrate
 * without guessing — a board that is not 5×3, no scatter on the strips, free spins switched off —
 * is a blocker, never a rewrite.
 */
export function migrateBookOfConfig(current: GameConfigDoc | null): ConfigMigration {
	const captured = preset();
	if (!current) {
		return {
			doc: captured,
			changes: ['un-authored: the Book of Thermopylae preset is stored as its config'],
			blockers: [],
		};
	}
	const rows = current.numRows;
	if (current.numReels !== 5 || rows.length !== 5 || rows.some((r) => r !== 3)) {
		return {
			doc: null,
			changes: [],
			blockers: [
				`the board is ${current.numReels}×${rows.join('/')}, not the book mock's 5×3 — fix it in /config first`,
			],
		};
	}
	const book = inPlayScatterSymbol(current.symbols, symbolsInPlay(current));
	if (!book) {
		return {
			doc: null,
			changes: [],
			blockers: ['no scatter on the strips: there is no book — fix it in /config first'],
		};
	}
	if (current.freeSpins?.enabled === false) {
		return {
			doc: null,
			changes: [],
			blockers: [
				'free spins are off: turn them on in /config or migrate it by hand (its buy is kept either way)',
			],
		};
	}
	const doc = structuredClone(current);
	const changes: string[] = [];

	// The book scatter: wild too, paying the captured row.
	const symbol = doc.symbols[book];
	const props = symbol.special_properties ?? [];
	if (!props.includes('wild')) {
		symbol.special_properties = [...props, 'wild'];
		changes.push(`${book}: add 'wild' (the book substitutes on lines)`);
	}
	const row = rowsOf(SCATTER_ROW);
	if (!same(symbol.paytable, row)) {
		symbol.paytable = row;
		changes.push(`${book}: scatter pays 3:2 4:20 5:200 × the bet`);
	}

	// The ten captured paylines.
	if (!same(doc.paylines, captured.paylines)) {
		doc.paylines = structuredClone(captured.paylines);
		changes.push('paylines: the ten captured Book of Thermopylae lines');
	}

	// Free spins: the retrigger the book mock deals untold, and the expanding symbol.
	const freeSpins: FreeSpinsConfig = { ...doc.freeSpins };
	if (!freeSpins.retriggerAwards) {
		const count = resolveFreeSpins(doc, BOOK_FREE_SPINS_DEFAULTS).triggerCount;
		freeSpins.retriggerAwards = [{ count, spins: BOOK_FREE_SPINS_DEFAULTS.retrigger }];
		changes.push(`free spins: retrigger +${BOOK_FREE_SPINS_DEFAULTS.retrigger} (stated, as lines defaults to +5)`); // prettier-ignore
	}
	if (!freeSpins.expandingSymbol) {
		const eligible =
			resolveExpandingSymbol({
				...doc,
				freeSpins: { ...freeSpins, enabled: undefined, expandingSymbol: {} },
			})?.candidates.map((c) => c.symbol) ?? [];
		const capturedBlock = captured.freeSpins?.expandingSymbol ?? {};
		const weights = Object.fromEntries(
			Object.entries(capturedBlock.weights ?? {}).filter(([name]) => eligible.includes(name)),
		);
		const minReels = Object.fromEntries(
			Object.entries(capturedBlock.minReels ?? {}).filter(([name]) => eligible.includes(name)),
		);
		const left = Object.keys(capturedBlock.weights ?? {}).filter((n) => !eligible.includes(n));
		freeSpins.expandingSymbol = {
			weights,
			...(Object.keys(minReels).length ? { minReels } : {}),
		};
		changes.push(
			`expanding symbol: the captured weights for ${Object.keys(weights).join(', ') || 'no symbol'}` +
				`${minReels.H1 ? ', H1 from 2 reels' : ''}` +
				`${left.length ? ` (${left.join(', ')} not drawable here, left out)` : ''}`,
		);
	}
	if (!same(freeSpins, doc.freeSpins ?? {})) doc.freeSpins = freeSpins;

	// Bet modes: the base and the one 100× buy, under the buy's existing name (decision 4).
	const resolved = resolveBetModes(doc);
	const base = resolved.find((m) => m.kind === 'base');
	if (!base) {
		return { doc: null, changes, blockers: ['no base bet mode — fix it in /config first'] };
	}
	const buy = resolved.find((m) => m.kind === 'buy');
	const baseMath = doc.betModes[base.mode];
	const buyId = buy?.mode ?? 'bonus';
	const buyMath: BetMode = buy
		? { ...doc.betModes[buy.mode] }
		: { ...captured.betModes.bonus, max_win: baseMath.max_win };
	buyMath.cost = baseMath.cost * BUY_COST_MULTIPLE;
	const betModes: Record<string, BetMode> = { [base.mode]: baseMath, [buyId]: buyMath };
	if (!same(betModes, doc.betModes)) {
		const dropped = Object.keys(doc.betModes).filter((m) => !(m in betModes));
		const added = Object.keys(betModes).filter((m) => !(m in doc.betModes));
		doc.betModes = betModes;
		if (doc.betModePresentation) {
			const kept = Object.entries(doc.betModePresentation).filter(([m]) => m in betModes);
			if (kept.length) doc.betModePresentation = Object.fromEntries(kept);
			else delete doc.betModePresentation;
		}
		changes.push(
			`bet modes: ${base.mode} + ${buyId} at ${BUY_COST_MULTIPLE}×` +
				`${added.length ? ` (added ${added.join(', ')})` : ''}` +
				`${dropped.length ? ` (removed ${dropped.join(', ')}, which the book mock never sold)` : ''}`,
		);
	}

	const normalized = normalizeGameConfigDoc(doc);
	if (!normalized)
		return { doc: null, changes, blockers: ['the migrated config does not normalize'] };
	const errors = gameConfigErrors(normalized);
	if (errors.length) {
		return {
			doc: null,
			changes,
			blockers: errors.map((e) => `the migrated config would not save: ${e.path} — ${e.message}`),
		};
	}
	return { doc: changes.length ? normalized : current, changes, blockers: [] };
}

/** Step 2: the layout's `gameType`, and nothing else. `null` ⇒ nothing to change. */
export const migrateBookOfLayout = (doc: LayoutDoc): LayoutDoc | null =>
	doc.gameType === BOOK_OF_KIND ? { ...doc, gameType: LINES_KIND } : null;

// ─── the census: read-only ────────────────────────────────────────────────────────────────────

/**
 * A project whose kind moved but whose republish did not land. Written BEFORE the kind moves and
 * deleted once every republish has, so a project that is no longer a `bookOf` row is still found
 * by the next run (and its players, on the lines mock with an old snapshot, are not forgotten).
 */
const PENDING_PREFIX = '_shared/migrations/book-of/';
const pendingKey = (project: string) => `${PENDING_PREFIX}${project}.json`;
type PendingRepublish = { project: string; games: string[]; by: string; at: string };

export type ManifestFact = {
	key: string;
	protocol: string;
	/** The shared runtime it is served from, or `null` for a desktop build (its own bundle). */
	runtime: string | null;
	projectKey: string | null;
	tableCapable: boolean;
};

export type CardFact = {
	key: string;
	url: string;
	/** Served by the Invisible Test Server and dealt by its mock (not a partner card). */
	testServer: boolean;
	/** A desktop build: its manifest entry has no shared runtime, or its own bundle is uploaded. */
	desktop: boolean;
};

export type BookOfProjectFacts = {
	key: string;
	name: string;
	clientKey: string;
	/** The project's kind now: `bookOf`, or `lines` for one whose republish is still pending. */
	kind: string;
	/** The games a previous run moved the kind for and could not republish. */
	pendingRepublish: string[] | null;
	/** `null` ⇒ un-authored (the template); `'unreadable'` ⇒ a stored doc that does not parse. */
	config: 'authored' | null | 'unreadable';
	/** The in-play scatter (the book) and its special properties. */
	book: { symbol: string; specialProperties: string[] } | null;
	alreadyWild: boolean;
	betModes: { mode: string; kind: string; cost: number }[];
	freeSpins: FreeSpinsConfig | null;
	potsOverlay: boolean;
	/** The stored layout's `gameType`, `null` when none is stored, `'unreadable'` when it does not
	 *  parse. */
	layoutGameType: string | null;
	manifest: ManifestFact[];
	cards: CardFact[];
	/** It has a published runtime snapshot (a republish target). */
	published: boolean;
};

export type BookOfCensus = {
	projects: BookOfProjectFacts[];
	/** Every manifest entry still dealt by the book mock — Phase 7 needs none. */
	bookManifestEntries: ManifestFact[];
	/** Whether `_shared/editor-templates/bookOf.json` exists — Phase 7 needs it gone. */
	editorTemplate: boolean;
};

const manifestFact = (key: string, entry: TestServerGameEntry): ManifestFact => ({
	key,
	protocol: entry.protocol,
	runtime: typeof entry.runtime === 'string' && entry.runtime ? entry.runtime : null,
	projectKey: entry.projectKey ?? null,
	tableCapable: entry.tableCapable === true,
});

/**
 * A card the Invisible Test Server serves AND deals: its page is on the games host, and its RGS is
 * the test server's own mock for that key. A partner card (another `rgs_url`, or a delivery
 * profile's `rgs_profile`) is not, and the migration never republishes it (§6 step 4).
 */
export function isTestServerCard(url: string, gamesBaseUrl: string): boolean {
	try {
		const card = new URL(url);
		const games = new URL(gamesBaseUrl);
		if (card.host !== games.host || card.searchParams.has('rgs_profile')) return false;
		const rgs = card.searchParams.get('rgs_url') ?? '';
		return rgs.replace(/^https?:\/\//, '').startsWith(`${games.host}/api/`);
	} catch {
		return false;
	}
}

async function readPending(): Promise<Map<string, PendingRepublish>> {
	const out = new Map<string, PendingRepublish>();
	for (const key of await listAllKeys(PENDING_PREFIX)) {
		try {
			const marker = JSON.parse((await getObjectText(key)) ?? '') as PendingRepublish;
			if (typeof marker.project === 'string' && Array.isArray(marker.games)) {
				out.set(marker.project, marker);
			}
		} catch {
			// An unreadable marker names no project; the row's kind still lists a bookOf project.
		}
	}
	return out;
}

type MigrationRow = Awaited<ReturnType<typeof listProjects>>[number];

/** The projects the migration acts on: every `bookOf` row, and every row with a republish pending. */
async function migrationRows(): Promise<{ row: MigrationRow; pending: PendingRepublish | null }[]> {
	const [rows, pending] = await Promise.all([listProjects(), readPending()]);
	return rows
		.filter((p) => p.gameType === BOOK_OF_KIND || pending.has(p.key))
		.map((row) => ({ row, pending: pending.get(row.key) ?? null }));
}

async function projectFacts(
	{ row, pending }: { row: MigrationRow; pending: PendingRepublish | null },
	entries: ManifestFact[],
	gamesBaseUrl: string,
): Promise<BookOfProjectFacts> {
	const clientKey = row.clientKey ?? UNASSIGNED_CLIENT;
	const stored = await loadGameConfigDocWithEtag(clientKey, row.key);
	const doc = stored.doc;
	const book = doc ? inPlayScatterSymbol(doc.symbols, symbolsInPlay(doc)) : undefined;
	const props = book ? (doc?.symbols[book]?.special_properties ?? []) : [];
	const layout = await loadDocWithEtag(clientKey, row.key, BOOK_OF_KIND);
	const cards: CardFact[] = [];
	for (const g of await listGamesOwnedByProject(row.key)) {
		const entry = entries.find((e) => e.key === g.key);
		cards.push({
			key: g.key,
			url: g.url,
			testServer: isTestServerCard(g.url, gamesBaseUrl),
			desktop: (entry !== undefined && entry.runtime === null) || (await hasOwnBuiltBundle(g.key)),
		});
	}
	return {
		key: row.key,
		name: row.name,
		clientKey,
		kind: row.gameType ?? '',
		pendingRepublish: pending ? pending.games : null,
		config: doc ? 'authored' : stored.existed ? 'unreadable' : null,
		book: book ? { symbol: book, specialProperties: [...props] } : null,
		alreadyWild: props.includes('wild'),
		betModes: doc
			? resolveBetModes(doc).map((m) => ({ mode: m.mode, kind: m.kind, cost: m.costMultiplier }))
			: [],
		freeSpins: doc?.freeSpins ?? null,
		potsOverlay: Boolean(doc?.potsOverlay),
		layoutGameType: layout.corrupt
			? 'unreadable'
			: layout.etag === null
				? null
				: (layout.doc.gameType ?? null),
		manifest: entries.filter((e) => (e.projectKey ?? e.key) === row.key),
		cards,
		published: (await currentPointer(clientKey, row.key)) !== null,
	};
}

const manifestFacts = async (): Promise<ManifestFact[]> =>
	Object.entries((await loadTestServerManifest()).games).map(([key, entry]) =>
		manifestFact(key, entry),
	);

/** Read every fact the migration acts on. Writes nothing. */
export async function bookOfCensus(gamesBaseUrl: string): Promise<BookOfCensus> {
	const [rows, entries, editorTemplate] = await Promise.all([
		migrationRows(),
		manifestFacts(),
		objectExists(editorTemplateKey(BOOK_OF_KIND)),
	]);
	const projects: BookOfProjectFacts[] = [];
	for (const row of rows) projects.push(await projectFacts(row, entries, gamesBaseUrl));
	return {
		projects,
		bookManifestEntries: entries.filter((e) => e.protocol === 'book'),
		editorTemplate,
	};
}

// ─── the plan: what each step would do ────────────────────────────────────────────────────────

export type BookOfPlan = {
	key: string;
	name: string;
	/** Anything here stops the whole project; nothing of it is written. */
	blockers: string[];
	config: ConfigMigration;
	layout: string | null;
	kind: string;
	/** The game keys it republishes, and the ones it leaves alone (and why). */
	republish: { games: string[]; skipped: { key: string; why: string }[] };
};

/**
 * The dry run for one project, from its census facts, its migrated config and the publish gates'
 * verdict on each republish target (`refusals`: game → why it would be refused). Pure.
 */
export function planFor(
	facts: BookOfProjectFacts,
	config: ConfigMigration,
	refusals: ReadonlyMap<string, string> = new Map(),
): BookOfPlan {
	const blockers = [...config.blockers];
	if (facts.config === 'unreadable') {
		blockers.push('its stored Game Config does not parse — open it in /config first');
	}
	if (facts.layoutGameType === 'unreadable') {
		blockers.push('its stored layout does not parse — open it in /editor first');
	}
	if (facts.kind !== BOOK_OF_KIND && facts.kind !== LINES_KIND) {
		blockers.push(`its kind is '${facts.kind}', not ${BOOK_OF_KIND} or ${LINES_KIND} — left alone`);
	}
	// A desktop build re-reads its project's contract and would flip to the lines mock; one built
	// before bet-option tables would lose its buy (§6 step 5). It must be rebuilt first.
	for (const build of facts.manifest.filter((m) => m.runtime === null && !m.tableCapable)) {
		blockers.push(
			`its desktop build "${build.key}" is not stamped table-capable — rebuild it from the desktop launcher first (☁ Publish)`,
		);
	}
	const skipped: { key: string; why: string }[] = [];
	const games: string[] = [];
	for (const card of facts.cards) {
		if (card.desktop) {
			skipped.push({ key: card.key, why: 'a desktop build (its own bundle): rebuilt, not republished' }); // prettier-ignore
		} else if (card.key !== facts.key) {
			skipped.push({ key: card.key, why: "not the project's own online card: publish names that one only" }); // prettier-ignore
		} else if (!card.testServer) {
			skipped.push({
				key: card.key,
				why: 'not a test-server card (a partner game): its server deals it, and its tools read the live config',
			});
		} else if (!facts.published) {
			skipped.push({ key: card.key, why: 'no published snapshot: nothing to republish' });
		} else {
			games.push(card.key);
			const refused = refusals.get(card.key);
			if (refused) blockers.push(`its republish of "${card.key}" would be refused — ${refused}`);
		}
	}
	return {
		key: facts.key,
		name: facts.name,
		blockers,
		config,
		layout:
			facts.layoutGameType === BOOK_OF_KIND
				? `layout gameType ${BOOK_OF_KIND} → ${LINES_KIND}`
				: null,
		kind:
			facts.kind === BOOK_OF_KIND
				? `kind ${BOOK_OF_KIND} → ${LINES_KIND}`
				: `kind already ${facts.kind}${facts.pendingRepublish ? ' (republish pending from an earlier run)' : ''}`,
		republish: { games, skipped },
	};
}

const emptyMigration = (): ConfigMigration => ({ doc: null, changes: [], blockers: [] });

/** One project's plan, its publish gates run against the config it would save. Writes nothing. */
async function planProject(facts: BookOfProjectFacts): Promise<BookOfPlan> {
	const config =
		facts.config === 'unreadable'
			? emptyMigration()
			: migrateBookOfConfig(
					facts.config === 'authored'
						? (await loadGameConfigDocWithEtag(facts.clientKey, facts.key)).doc
						: null,
				);
	const draft = planFor(facts, config);
	const refusals = new Map<string, string>();
	for (const game of draft.republish.games) {
		const refusal = await publishGateRefusal(game, {
			...(config.doc ? { config: config.doc } : {}),
		});
		if (refusal) refusals.set(game, `${refusal.reason}: ${refusal.message}`);
	}
	return refusals.size ? planFor(facts, config, refusals) : draft;
}

/** The dry run for every project the migration acts on. Writes nothing. */
export async function planBookOfMigration(
	gamesBaseUrl: string,
): Promise<{ census: BookOfCensus; plans: BookOfPlan[] }> {
	const census = await bookOfCensus(gamesBaseUrl);
	const plans: BookOfPlan[] = [];
	for (const facts of census.projects) plans.push(await planProject(facts));
	return { census, plans };
}

// ─── apply: one project per call ──────────────────────────────────────────────────────────────

export type BookOfResult = {
	key: string;
	/** `republish-pending`: the kind moved, a republish did not land — the next run retries it. */
	status: 'migrated' | 'blocked' | 'republish-pending' | 'error' | 'nothing-to-do';
	/** What each step did, in order. */
	steps: string[];
	/** Why it stopped, when it did. */
	error?: string;
};

const LEASE_TARGETS = [
	{ toolId: 'gameConfig', docKey: 'gameConfig', path: '/config' },
	{ toolId: 'editor', docKey: 'editor', path: '/editor' },
] as const;

async function writePending(marker: PendingRepublish): Promise<void> {
	const current = await getObjectTextWithEtag(pendingKey(marker.project));
	await putObjectText(
		pendingKey(marker.project),
		JSON.stringify(marker, null, 2),
		'application/json; charset=utf-8',
		precondition(current ? current.etag : null),
	);
}

/**
 * Run §6 steps 1–4 on ONE project — the page calls it once per planned project, so no request
 * carries more than one republish. The plan is re-derived here, never taken from the client, so
 * what is applied is what the project says now; its publish gates have passed before anything is
 * written. `launcherOrigin` and `by` are what a publish records; `sessionId` is the caller's, so
 * their own open tabs never block it. Never throws: every outcome is a result.
 */
export async function applyBookOfMigrationTo(
	key: string,
	opts: { gamesBaseUrl: string; launcherOrigin: string; sessionId: string; by: string },
): Promise<BookOfResult> {
	const steps: string[] = [];
	try {
		const row = (await migrationRows()).find((r) => r.row.key === key);
		if (!row) {
			return { key, status: 'nothing-to-do', steps, error: 'not a Book-of project, and no republish pending' }; // prettier-ignore
		}
		const facts = await projectFacts(row, await manifestFacts(), opts.gamesBaseUrl);
		const plan = await planProject(facts);
		if (plan.blockers.length) {
			return { key, status: 'blocked', steps, error: plan.blockers.join('; ') };
		}
		const { clientKey } = facts;
		const editing = leaseBlocker(
			await liveLeases(
				LEASE_TARGETS.map(({ toolId, docKey }) => ({ toolId, docKey, clientKey, projectKey: key })),
			),
			opts.sessionId,
			LEASE_TARGETS,
		);
		if (editing) return { key, status: 'blocked', steps, error: editing };

		// 1. The config, re-read under its ETag so a save since the plan is never overwritten.
		const stored = await loadGameConfigDocWithEtag(clientKey, key);
		if (stored.existed && !stored.doc) throw new Error('its stored Game Config does not parse');
		const config = migrateBookOfConfig(stored.doc);
		if (config.blockers.length) throw new Error(config.blockers.join('; '));
		if (config.changes.length && config.doc) {
			await saveGameConfigDoc(clientKey, key, config.doc, stored.etag, 'always');
			steps.push(`config: ${config.changes.join('; ')}`);
		} else {
			steps.push('config: already migrated');
		}
		// 2. The layout's kind, under its own ETag.
		const layout = await loadDocWithEtag(clientKey, key, BOOK_OF_KIND);
		if (layout.corrupt) throw new Error('its stored layout does not parse');
		const next = layout.etag === null ? null : migrateBookOfLayout(layout.doc);
		if (next) {
			await saveDoc(clientKey, key, next, layout.etag, 'always');
			steps.push(`layout: gameType ${BOOK_OF_KIND} → ${LINES_KIND}`);
		} else {
			steps.push(layout.etag === null ? 'layout: none stored' : 'layout: already lines');
		}
		// 3. The kind — only from bookOf, so a kind changed meanwhile is never overwritten. Every tool
		// reads it, so it moves only once its docs have; the pending marker goes first, so a republish
		// that does not land after it is found again by the next run.
		const games = plan.republish.games;
		if (games.length) {
			await writePending({ project: key, games, by: opts.by, at: new Date().toISOString() });
		}
		if (await switchProjectGameType(key, BOOK_OF_KIND, LINES_KIND)) {
			steps.push(`kind: ${BOOK_OF_KIND} → ${LINES_KIND}`);
		} else {
			const now = await projectGameType(key);
			if (now !== LINES_KIND) {
				throw new Error(`its kind is now '${now ?? 'none'}' — changed meanwhile, left alone`);
			}
			steps.push('kind: already lines');
		}
		invalidateRuntimeBundle(key);
		// 4. Republish what players boot, so its snapshot carries the block and the manifest the lines
		// contract. Its gates passed in the plan; one that refuses now (a draft sound since) is
		// reported for the owner, never overridden.
		const failed: string[] = [];
		for (const game of games) {
			try {
				await publishGame(game, opts.launcherOrigin, { by: opts.by });
				steps.push(`republish ${game}: published`);
			} catch (e) {
				failed.push(game);
				const why =
					e instanceof PublishBlockedError
						? `REFUSED (${e.reason}) — ${e.message}`
						: `FAILED — ${e instanceof Error ? e.message : String(e)}`;
				steps.push(`republish ${game}: ${why}`);
			}
		}
		for (const { key: game, why } of plan.republish.skipped) steps.push(`republish ${game}: skipped — ${why}`); // prettier-ignore
		if (failed.length) {
			return {
				key,
				status: 'republish-pending',
				steps,
				error: `${failed.join(', ')} not republished: players are on the lines mock with the old snapshot until it is. Run the migration again to retry.`,
			};
		}
		if (games.length || facts.pendingRepublish) await deleteObject(pendingKey(key));
		return { key, status: 'migrated', steps };
	} catch (e) {
		const why =
			e instanceof ConflictError
				? 'a doc was saved by someone else meanwhile'
				: e instanceof Error
					? e.message
					: String(e);
		// Say "run again" only when a run would pick it up: still a bookOf row, or a republish pending.
		const listed = await migrationRows().then(
			(rows) => rows.some((r) => r.row.key === key),
			() => true,
		);
		const next = listed
			? 'It is still listed: run the migration again.'
			: 'It is no longer listed, so a re-run will not pick it up: check it by hand (the steps above were written).';
		return { key, status: 'error', steps, error: `${why}. ${next}` };
	}
}
