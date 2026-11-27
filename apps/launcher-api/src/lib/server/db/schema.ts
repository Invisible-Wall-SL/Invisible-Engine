import {
	type AnyPgColumn,
	bigint,
	bigserial,
	boolean,
	check,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
	FixRunChoice,
	FixRunExplanation,
	FixRunDiagnosis,
	FixRunMode,
	FixRunOutcome,
	FixRunSecondBug,
	FixRunStatus,
} from '$lib/bugFixRuns';
import type { BugKind, BugPriority, BugStatus, LinkState } from '$lib/bugReports';
import type { MergeRunExplanation, MergeRunFile, MergeRunStatus } from '$lib/mergeMainRuns';
import type { PartnerLaunch } from '$lib/partnerLaunch';
import type { ArcadePhaseSummaries } from '$lib/profiler';
import type { PerfBuildCategory } from '$lib/profilerBuilds';
import type { BuildFacts, ReportFacts } from '$lib/profilerFindings/facts';
import type { PerfCounts } from '$lib/profilerLab';
import type { NetworkSummary } from '$lib/profilerNetwork';
import type { Role } from '$lib/roles';

export const users = pgTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull().unique(),
	name: text('name'),
	role: text('role').$type<Role>().notNull().default('artist'),
	passwordHash: text('password_hash'),
	active: boolean('active').notNull().default(true),
	/** When set and in the past, the account is denied at login and session validation. */
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Client registry. A client groups projects (launcher-side organization only). */
export const clients = pgTable('clients', {
	key: text('key').primaryKey(),
	name: text('name').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Project registry. `cloud` is the default project (seeded). */
export const projects = pgTable('projects', {
	key: text('key').primaryKey(),
	name: text('name').notNull(),
	/** Owning client; null = unassigned (the default `cloud` and legacy projects). */
	clientKey: text('client_key').references(() => clients.key, { onDelete: 'set null' }),
	/**
	 * Game kind this project targets (a built-in kind — see
	 * `GAME_KINDS` in `constants-shared/gameKinds`). Picks the editor template + scaffold
	 * projection. Nullable + no default: legacy rows and the seeded `cloud`
	 * project stay null and fall back to `'lines'` via `projectGameType`.
	 */
	gameType: text('game_type'),
	/**
	 * Per-project READ-ONLY token for the public live-fetch runtime (Invisible Game
	 * Maker). A browser-served generic-runtime game fetches this project's authoring
	 * data from `/api/editor/runtime` + `/api/deploy/f/...` using THIS token, so the
	 * shared build/deploy token is never embedded in a public game URL. Path-safe
	 * (`[A-Za-z0-9]`). Minted lazily by `getOrMintReadToken`; null until first publish.
	 */
	readToken: text('read_token'),
	/**
	 * Machine-independent "launcher profile" published by the owner from the desktop
	 * launcher. Opaque JSON — the shape is owned by the desktop client; the server
	 * stores and returns it as-is. Null until first published.
	 */
	launcherProfile: jsonb('launcher_profile'),
	/**
	 * Where this project is played on a PARTNER RGS: the partner's game id, and optionally the
	 * `PARTNER_RGS` profile and the delivery alias (`$lib/partnerLaunch.ts`). Set on the Game Maker
	 * card; read by `/api/partner-session` when its query names no `game`/`profile`. Null = no
	 * partner launch for this project — nothing else reads it.
	 */
	partnerLaunch: jsonb('partner_launch').$type<PartnerLaunch>(),
	/**
	 * Soft-delete tombstone. Non-null = deleted: the project vanishes from every
	 * picker and grant (`listProjects` filters it out), but its row — and crucially
	 * its `readToken` and `clientKey` — survive, so a restore is one click and the
	 * R2 prefix stays reachable.
	 *
	 * Delete is NOT destructive here on purpose. An accidental delete once stranded
	 * 2,488 R2 objects (2.3 GB) whose owning row was gone, and the only reason the
	 * project came back was that the delete had never touched R2. Permanently
	 * destroying the bytes is a SEPARATE, explicitly-labelled purge on an
	 * already-deleted project — never the button sitting next to Rescaffold.
	 */
	deletedAt: timestamp('deleted_at', { withTimezone: true }),
	/**
	 * An admin marked this PUBLISHED project as a template Invisible Director re-themes
	 * (`docs/director/OPEN_QUESTIONS.md` Q1). Set only from Admin › Projects, which refuses an
	 * unpublished project; `gamemaker.list_templates` lists only these.
	 */
	directorTemplate: boolean('director_template').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Game registry. Each game has its own display name + launch URL, editable in
 * `/admin`. Games live on a future dedicated game server; the registry is editable
 * now so the home Games grid can open each at its configured URL.
 */
export const games = pgTable('games', {
	key: text('key').primaryKey(),
	name: text('name').notNull(),
	url: text('url').notNull().default(''),
	/** Owning project; null = global (the game shows on every project selection). */
	projectKey: text('project_key').references(() => projects.key, { onDelete: 'set null' }),
	/**
	 * Build metadata stamped by the desktop launcher at publish time (optional —
	 * legacy rows and hand-added games leave these at their defaults). `version` is
	 * a per-project build number string; `builtAt` the build's ISO timestamp;
	 * `debug` whether the published bundle is a debug build. The engine bakes a
	 * matching in-game stamp so portal + game agree on what's live.
	 */
	version: text('version').notNull().default(''),
	builtAt: timestamp('built_at', { withTimezone: true }),
	debug: boolean('debug').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** Active project for this session; null = the default project (`cloud`). */
	activeProjectKey: text('active_project_key').references(() => projects.key, {
		onDelete: 'set null',
	}),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-user project grants. A row grants `userId` access to `projectKey`. Admins
 * implicitly get every project; everyone always gets the default `cloud` project.
 */
export const userProjectAccess = pgTable(
	'user_project_access',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		projectKey: text('project_key')
			.notNull()
			.references(() => projects.key, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.userId, table.projectKey] })],
);

/**
 * Per-user client grants. A row grants `userId` access to every project owned by
 * `clientKey`. Resolved as a union with the per-project `user_project_access`
 * grants and the always-available default `cloud` project.
 */
export const userClientAccess = pgTable(
	'user_client_access',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		clientKey: text('client_key')
			.notNull()
			.references(() => clients.key, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.userId, table.clientKey] })],
);

/** Per-user local-tool install paths, keyed by (userId, toolKey). */
export const toolInstalls = pgTable(
	'tool_installs',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		toolKey: text('tool_key').notNull(),
		installPath: text('install_path').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.toolKey] })],
);

/**
 * Per-user tool overrides layered on top of the role defaults (`ROLE_TOOLS`).
 * `granted = true` grants a tool the role lacks; `granted = false` revokes a tool
 * the role would otherwise have. Absent rows fall back to the role default.
 */
export const userToolAccess = pgTable(
	'user_tool_access',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		toolKey: text('tool_key').notNull(),
		granted: boolean('granted').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.toolKey] })],
);

/**
 * Per-role capability overrides layered on top of the role defaults (`ROLE_TOOLS`).
 * `granted = true` grants a role a tool/capability it lacks by default; `granted =
 * false` revokes a default. Absent rows fall back to `ROLE_TOOLS`. Resolved BEFORE
 * the per-user `user_tool_access` layer. `toolKey` may also be a managed capability
 * key (e.g. `adminPanel`) in addition to a real tool id.
 */
export const roleToolAccess = pgTable(
	'role_tool_access',
	{
		role: text('role').$type<Role>().notNull(),
		toolKey: text('tool_key').notNull(),
		granted: boolean('granted').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.role, table.toolKey] })],
);

/**
 * Brute-force throttle counters for the password-login surfaces (the web `/login`
 * form and the open `POST /api/launcher/login` endpoint). One row per scope `key`
 * — either `ip:<addr>` or `email:<addr>`. `failures` accumulates while the scope
 * stays active; once it crosses the free-attempt threshold, `lockedUntil` carries
 * an exponential-backoff lockout. A successful login clears the scope's row. See
 * `src/lib/server/loginThrottle.ts` for the policy.
 */
export const loginAttempts = pgTable('login_attempts', {
	key: text('key').primaryKey(),
	failures: integer('failures').notNull().default(0),
	lockedUntil: timestamp('locked_until', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * No-login PARTNER SHARE LINKS: `/play/<token>` opens a project's published game on its partner RGS
 * with a freshly minted session, for someone with no launcher account (`$lib/server/partnerShare.ts`).
 * Only the token's SHA-256 is stored — the link itself is shown once, when it is made. A link is
 * live while `revoked_at` is null and `expires_at` is ahead; `window_*` is its per-minute open
 * budget, spent by one conditional UPDATE so parallel opens cannot overspend it.
 */
export const partnerShareLinks = pgTable(
	'partner_share_links',
	{
		id: text('id').primaryKey(),
		tokenHash: text('token_hash').notNull(),
		projectKey: text('project_key')
			.notNull()
			.references(() => projects.key, { onDelete: 'cascade' }),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		revokedBy: text('revoked_by').references(() => users.id, { onDelete: 'set null' }),
		lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
		openCount: integer('open_count').notNull().default(0),
		windowStartedAt: timestamp('window_started_at', { withTimezone: true }),
		windowOpens: integer('window_opens').notNull().default(0),
	},
	(t) => [
		uniqueIndex('partner_share_links_token_hash_idx').on(t.tokenHash),
		index('partner_share_links_project_idx').on(t.projectKey),
	],
);

/**
 * Append-only log of every mutating `/admin` action: who, when, which action, on what, and the
 * submitted fields with secrets redacted (`$lib/server/adminAudit.ts`). A refused attempt is logged
 * too. `actor_id` carries no foreign key on purpose — deleting a user must not erase or rewrite
 * what they did. The migration adds a trigger that rejects UPDATE, DELETE and TRUNCATE.
 */
export const adminAudit = pgTable(
	'admin_audit',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		actorId: text('actor_id').notNull(),
		action: text('action').notNull(),
		/** The user, project, role, … the action was aimed at; null for panel-wide settings. */
		target: text('target'),
		details: jsonb('details').notNull().default({}),
	},
	(table) => [index('admin_audit_at_idx').on(table.at)],
);

/**
 * Generic key/value app settings — admin-managed runtime config that should live
 * in the DB (not just a Railway env var) so it can be edited + rotated from the
 * admin panel. First use: the shared build/deploy token (`deployToken`), which
 * overrides the `EDITOR_DOC_SECRET` env bootstrap default when set. The value
 * column may hold a SECRET; never expose it through a non-admin route.
 */
export const appSettings = pgTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	/** The admin user who last set this value; null when set out-of-band. */
	updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * Catalog of the CROSS-PROJECT rig library — the replacement for the old
 * `_shared/rigs/index.json` blob. One row per rig; the heavy `skeleton` body stays
 * in R2 at `sharedRigKey(id)`.
 *
 * This is a table and not an object because the blob was read-modify-written by
 * `rigs/{save,delete}` with no guard, and it is GLOBAL across every client and
 * project — so it raced between users who share no project at all, silently
 * dropping each other's rows. A row upsert removes that race structurally rather
 * than guarding it. See `docs/design/multi-user-concurrency.md` Phase 0.
 *
 * `id` is the `r2Slug`-normalized id and is also the R2 object key stem, so the
 * row and its blob are addressed by the same value.
 */
export const sharedRigs = pgTable('shared_rigs', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
	/** Where the rig was authored — display provenance only, NOT an access scope. */
	sourceClient: text('source_client').notNull().default(''),
	sourceProject: text('source_project').notNull().default(''),
	sourceRig: text('source_rig'),
	/** `{ bones, slots, skins, animations: string[] }` — opaque display counts. */
	stats: jsonb('stats').$type<SharedRigStats>().notNull(),
});

/**
 * Catalog of the CROSS-PROJECT animation library — replaces
 * `_shared/animations/index.json`. Same rationale, same race, same fix as
 * {@link sharedRigs}; the heavy `animation` subtree stays in R2 at
 * `sharedAnimationKey(id)`.
 */
export const sharedAnimations = pgTable('shared_animations', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
	sourceClient: text('source_client').notNull().default(''),
	sourceProject: text('source_project').notNull().default(''),
	sourceRig: text('source_rig'),
	/** `{ bones, slots, events }` — the names this clip animates, for rig-match UX. */
	refs: jsonb('refs').$type<SharedAnimationRefs>().notNull(),
	/** Clip length in seconds (float). */
	duration: doublePrecision('duration').notNull().default(0),
});

/**
 * Soft, cooperative edit lease for an authored doc — the Postgres half of
 * `docs/design/multi-user-concurrency.md` Phase 2. A lease is a COORDINATION
 * HINT, never an authz boundary (`toolScope.gate()` remains the real gate); it
 * only lets two people on the same `(client, project)` avoid clobbering each
 * other in the first place, with R2 `If-Match` as the correctness floor beneath.
 *
 * Keyed per-project for now: `(toolId, clientKey, projectKey, docKey)`, where
 * `docKey` is the tool's single project doc (pass the tool id as `docKey` when a
 * tool has one doc). Per-doc granularity is a later upgrade — see the design doc.
 *
 * The lease lives HERE, in Postgres, and never in the R2 sidecar it protects — a
 * lock stored in the blob is clobberable by the exact race it exists to prevent.
 * Acquire is a single conditional upsert so the DATABASE adjudicates (an expired
 * or same-holder lease is takeable; a live other holder is not), which is why the
 * key tuple is the composite primary key: it is both the uniqueness constraint
 * and the `ON CONFLICT` target. `expiresAt` is the backstop so a crashed tab can
 * never permanently wedge a doc; explicit takeover from the UI is the plan.
 */
export const docLeases = pgTable(
	'doc_leases',
	{
		toolId: text('tool_id').notNull(),
		clientKey: text('client_key').notNull(),
		projectKey: text('project_key').notNull(),
		docKey: text('doc_key').notNull(),
		holderUserId: text('holder_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** The holder's server-side session id (the hashed session token, not the raw cookie). */
		holderSessionId: text('holder_session_id').notNull(),
		acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
		heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.toolId, table.clientKey, table.projectKey, table.docKey],
		}),
	],
);

export interface SharedRigStats {
	bones: number;
	slots: number;
	skins: number;
	animations: string[];
}

export interface SharedAnimationRefs {
	bones: string[];
	slots: string[];
	events: string[];
}

/**
 * Per-provider, per-month running cost for Admin → Costs.
 *
 * Months are **Europe/Madrid calendar months**, grouped into calendar years, because
 * the Spanish tax year is the calendar year — the whole point of the table is that a
 * year's rows add up to something fileable.
 *
 * The lifecycle is deliberately two-state:
 * - **Open** (`lockedAt` null) — the current month. Its `amountUsdCents` is rewritten
 *   from the live estimate on every snapshot, so the figure rises and falls during the
 *   month exactly as the providers revise it.
 * - **Locked** (`lockedAt` set) — a month that has ended. Frozen at the last value
 *   observed while it was open, and never recomputed. Without this the row would keep
 *   moving under a filed number, and the providers cannot rebuild a past month anyway
 *   (RunPod has no history at all, Railway reports current-cycle only, R2's analytics
 *   retention is short).
 *
 * `eurCents` is the amount the bank ACTUALLY charged, typed in by an admin. It is not
 * a conversion of `amountUsdCents`: card FX spread means the real debit differs from
 * any reference rate, and for tax the real debit is the number that counts. Null until
 * someone enters it.
 *
 * Both money columns are INTEGER cents — these are summed per year, and floats
 * accumulate drift across a sum.
 */
export const costMonths = pgTable(
	'cost_months',
	{
		/** Matches `ProviderId` in `$lib/server/costs/types.ts` (e.g. 'runpod'). */
		provider: text('provider').notNull(),
		/** Calendar year, Europe/Madrid. */
		year: integer('year').notNull(),
		/** Calendar month 1–12, Europe/Madrid. */
		month: integer('month').notNull(),
		/** USD spend for the month, in cents. */
		amountUsdCents: integer('amount_usd_cents').notNull().default(0),
		/**
		 * True when `amountUsdCents` was typed in by an admin rather than measured.
		 *
		 * Needed because two providers cannot report a period total at all: RunPod
		 * publishes a balance and a burn rate but no spend history, and Railway's API
		 * exposes only usage units (its enum has no cost measurement — the dashboard
		 * prices them client-side). Without a manual figure those months would silently
		 * under-count, and RunPod is typically the largest line.
		 *
		 * Also a WRITE GUARD: `recordAndLock` refuses to overwrite a manual row, so a
		 * typed figure survives every later snapshot.
		 */
		manualUsd: boolean('manual_usd').notNull().default(false),
		/** What the bank actually charged, in euro cents. Admin-entered; null until then. */
		eurCents: integer('eur_cents'),
		/** Set when the month ended and the figure was frozen. Null while open. */
		lockedAt: timestamp('locked_at', { withTimezone: true }),
		note: text('note'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		/** The admin who last edited the EUR figure; null for automatic updates. */
		updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
	},
	(table) => [primaryKey({ columns: [table.provider, table.year, table.month] })],
);

/**
 * Invisible Director spend ledger (ADR-0006): one row per billed unit of work — a Messages
 * response's `usage` (`kind: 'claude'`) or a serverless GPU job (`kind: 'runpod'`). Written
 * once by the worker, never updated. Admin › Costs sums the `claude` rows month-to-date for
 * the "Anthropic (agents)" card; RunPod rows are already inside the RunPod account card.
 *
 * `runId` has no foreign key (OPEN_QUESTIONS, #1044): the ledger outlives a deleted run.
 */
export const directorSpend = pgTable(
	'director_spend',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		runId: text('run_id').notNull(),
		/** The runtime agent that spent it (`services/director-worker/agents/<agent>.md`). */
		agent: text('agent').notNull(),
		/** The model that served the turn (the fallback model, after a refusal fallback), or
		 *  the GPU type for a RunPod row. */
		model: text('model').notNull(),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
		cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
		usd: doublePrecision('usd').notNull(),
		kind: text('kind').$type<'claude' | 'runpod'>().notNull(),
		/** What was billed: the Messages response id, or `runpod:<jobRef>`. Unique, so a retried
		 *  write of the same response or job is ignored instead of billed twice. */
		requestId: text('request_id'),
	},
	(table) => [
		uniqueIndex('director_spend_request_id_idx').on(table.requestId),
		index('director_spend_at_idx').on(table.at),
		index('director_spend_run_idx').on(table.runId),
		check('director_spend_kind_check', sql`${table.kind} in ('claude', 'runpod')`),
	],
);

/**
 * Invisible Director run (ADR-0003). The launcher inserts it as a `draft` and from then on only
 * appends `director_events`; the worker is the single writer of `status`, `step` and `waiting_on`,
 * through the pure state machine in `services/director-worker/src/runState.ts` (whose fixture holds
 * the lists below to its own). A worker drives a run only while it holds the lease: it claims one with
 * `FOR UPDATE SKIP LOCKED`, and every write it makes is conditional on `lease_holder` still being it
 * and `lease_until` still in the future.
 */
export const directorRuns = pgTable(
	'director_runs',
	{
		id: text('id').primaryKey(),
		/** The project the run creates and then works on. It need not exist until
		 *  `gamemaker.create_from_template` creates it. */
		projectKey: text('project_key').notNull(),
		/** The client the project is created under; null = unassigned. */
		clientKey: text('client_key'),
		templateProjectKey: text('template_project_key').notNull(),
		/** The game family whose pack the run's agents read (9F): frozen at create from the template's
		 *  kind, so a template whose kind is edited later cannot change a run's pack mid-way. */
		family: text('family').$type<'slot' | 'match3' | 'arcade' | 'card'>().notNull(),
		ownerUserId: text('owner_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Mockups (with screen tags), fidelity, notes and the recorded ownership check. */
		startingPointJson: jsonb('starting_point_json').notNull().default({}),
		/** `{ breakdown, artPlan, regionBatch }`; `before_publish` is not stored because it cannot be off. */
		checkpointsJson: jsonb('checkpoints_json').notNull().default({}),
		status: text('status')
			.$type<
				| 'draft'
				| 'running'
				| 'waiting'
				| 'paused'
				| 'stopping'
				| 'stopped'
				| 'failed'
				| 'handed_off'
			>()
			.notNull()
			.default('draft'),
		step: text('step')
			.$type<
				| 'breakdown'
				| 'style_pack'
				| 'regions'
				| 'build'
				| 'reproduce'
				| 'fix'
				| 'verify'
				| 'handoff'
			>()
			.notNull()
			.default('breakdown'),
		/** The open checkpoint while `waiting`; null otherwise. */
		waitingOn: text('waiting_on').$type<
			'breakdown' | 'art_plan' | 'region_batch' | 'before_publish' | 'repair_review'
		>(),
		/** `create` makes the project from a template; `repair` fixes one game bug in its own project
		 *  (ADR-0012). The state machine, the lead agent and the owner actions all read it. */
		kind: text('kind').$type<'create' | 'repair'>().notNull().default('create'),
		/** The game bug a repair run fixes; a create run has none (CHECK). Set null when the bug is
		 *  deleted (a project purge deletes its game bugs), so a repair run is not required to keep
		 *  one: `createRepairRun` always sets it. */
		bugNumber: integer('bug_number').references(() => bugReports.number, {
			onDelete: 'set null',
		}),
		/** How a repair run ended; null until hand-off, and always null for a create run. */
		repairOutcome: text('repair_outcome').$type<
			'fixed' | 'escalated' | 'needs_person' | 'not_reproduced'
		>(),
		/** Null until the run starts, when the worker copies `DIRECTOR_RUN_BUDGET_USD` onto it; a run
		 *  that somehow has none gets the default. The worker pauses the run before the call or GPU
		 *  submit that would reach it (ADR-0006). */
		budgetCapUsd: doublePrecision('budget_cap_usd'),
		/** The worker driving the run, and until when. Both null = nobody. */
		leaseHolder: text('lease_holder'),
		leaseUntil: timestamp('lease_until', { withTimezone: true }),
		/** Set when `gamemaker.create_from_template` starts copying: from then on the run's project
		 *  key is this run's, so a retry after a crash finishes the copy instead of refusing it. */
		projectCreateStartedAt: timestamp('project_create_started_at', { withTimezone: true }),
		/** ETag of the template's `config/config.json` when the project was copied from it, and of
		 *  the copy's own right after — the math lock QA checks (Q3). Null until the copy. */
		templateConfigEtag: text('template_config_etag'),
		projectConfigEtag: text('project_config_etag'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('director_runs_status_idx').on(table.status),
		/** One live run per project, of either kind (ADR-0012): two repair runs would each play a
		 *  draft holding the other's half-done edits. */
		uniqueIndex('director_runs_live_project_idx')
			.on(table.projectKey)
			.where(sql`${table.status} in ('draft', 'running', 'waiting', 'paused', 'stopping')`),
		check(
			'director_runs_status_check',
			sql`${table.status} in ('draft', 'running', 'waiting', 'paused', 'stopping', 'stopped', 'failed', 'handed_off')`,
		),
		check('director_runs_family_check', sql`${table.family} in ('slot', 'match3', 'arcade')`),
		check(
			'director_runs_step_check',
			sql`${table.step} in ('breakdown', 'style_pack', 'regions', 'build', 'reproduce', 'fix', 'verify', 'handoff')`,
		),
		check('director_runs_kind_check', sql`${table.kind} in ('create', 'repair')`),
		check(
			'director_runs_bug_number_check',
			sql`${table.kind} = 'repair' or ${table.bugNumber} is null`,
		),
		check(
			'director_runs_repair_outcome_check',
			sql`${table.repairOutcome} is null or (${table.kind} = 'repair' and ${table.repairOutcome} in ('fixed', 'escalated', 'needs_person', 'not_reproduced'))`,
		),
		check(
			'director_runs_waiting_on_check',
			sql`(${table.status} = 'waiting') = (${table.waitingOn} is not null) and (${table.waitingOn} is null or ${table.waitingOn} in ('breakdown', 'art_plan', 'region_batch', 'before_publish', 'repair_review'))`,
		),
		check(
			'director_runs_lease_check',
			sql`(${table.leaseHolder} is null) = (${table.leaseUntil} is null)`,
		),
	],
);

/**
 * Everything that happens in a run, append-only (ADR-0003): the Activity feed, checkpoints, region
 * statuses, GPU jobs, spend and errors, plus the owner's own rows — the launcher's form actions only
 * ever INSERT here (`owner_message`, `checkpoint_resolved`, `owner_request` for start / pause /
 * resume / stop), and an AFTER INSERT trigger (migration 0025) NOTIFYs `director_wake` with the
 * run id for those and for `job_done`; the worker reacts. `run_status` records each transition
 * the worker makes. The live page streams this table after `Last-Event-ID` (= `id`).
 *
 * A row's content never changes. The one column written later is `handled_at`, which the worker
 * stamps on a waking event once it has acted on it. That is per row, not an id high-water mark,
 * because bigserial ids are taken before commit: a slow insert can commit with a LOWER id than one
 * already handled, and a mark would skip it for good.
 */
export const directorEvents = pgTable(
	'director_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		runId: text('run_id')
			.notNull()
			.references(() => directorRuns.id, { onDelete: 'cascade' }),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		/** The runtime agent, `worker`, or `owner`. */
		agent: text('agent').notNull(),
		kind: text('kind')
			.$type<
				| 'activity'
				| 'owner_message'
				| 'owner_request'
				| 'checkpoint_open'
				| 'checkpoint_resolved'
				| 'region_status'
				| 'job_queued'
				| 'job_done'
				| 'spend'
				| 'run_status'
				| 'error'
			>()
			.notNull(),
		/** The tool used (`<tool>.<op>`), for the Activity feed; null when none. */
		tool: text('tool'),
		payloadJson: jsonb('payload_json').notNull().default({}),
		/** When the worker acted on this event; null until then. Only waking kinds are stamped. */
		handledAt: timestamp('handled_at', { withTimezone: true }),
	},
	(table) => [
		index('director_events_run_idx').on(table.runId, table.id),
		index('director_events_unhandled_idx')
			.on(table.runId)
			.where(sql`${table.handledAt} is null`),
		check(
			'director_events_kind_check',
			sql`${table.kind} in ('activity', 'owner_message', 'owner_request', 'checkpoint_open', 'checkpoint_resolved', 'region_status', 'job_queued', 'job_done', 'spend', 'run_status', 'error')`,
		),
	],
);

/**
 * Each agent's conversation, append-only: one row per Messages API message, in order (`seq` per run
 * and agent). An agent's next turn is built from these rows, so a restart replays nothing (ADR-0001).
 */
export const directorMessages = pgTable(
	'director_messages',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		runId: text('run_id')
			.notNull()
			.references(() => directorRuns.id, { onDelete: 'cascade' }),
		agent: text('agent').notNull(),
		seq: integer('seq').notNull(),
		role: text('role').$type<'user' | 'assistant'>().notNull(),
		/** The message's `content` exactly as sent or received, thinking blocks included. */
		contentJson: jsonb('content_json').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('director_messages_run_agent_seq_idx').on(table.runId, table.agent, table.seq),
		check('director_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
	],
);

/** One row per template region a run works on: its review status and the art director's pick. */
export const directorRegions = pgTable(
	'director_regions',
	{
		runId: text('run_id')
			.notNull()
			.references(() => directorRuns.id, { onDelete: 'cascade' }),
		region: text('region').notNull(),
		/** The gallery group: Symbols, Coins & jackpots, Backgrounds, … */
		regionGroup: text('region_group').notNull(),
		status: text('status')
			.$type<'queued' | 'drafting' | 'to_review' | 'approved' | 'rejected'>()
			.notNull()
			.default('queued'),
		variantsJson: jsonb('variants_json').notNull().default([]),
		artDirectorPickJson: jsonb('art_director_pick_json'),
		ownerNote: text('owner_note'),
		/** The technician's plan for the region (ADR-0008 §5, `director-costs/recipe`), validated by
		 *  the worker before it is stored; null until one is planned. Written by the worker only. */
		recipeJson: jsonb('recipe_json'),
		/** The stored recipe's revision; 0 = none yet. */
		recipeRev: integer('recipe_rev').notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.region] }),
		check(
			'director_regions_status_check',
			sql`${table.status} in ('queued', 'drafting', 'to_review', 'approved', 'rejected')`,
		),
	],
);

/**
 * A template's default recipe per region group (ADR-0008 §5 "Reuse"): the chain an owner approved
 * at an Art plan, which the technician starts from on the template's next run. Append-only and
 * versioned: the worker writes version n + 1 after an approval, naming the run, so reverting is
 * reading the previous version. Never written into the template project (SPEC rule 2).
 */
export const directorTemplateRecipes = pgTable(
	'director_template_recipes',
	{
		templateProjectKey: text('template_project_key').notNull(),
		regionGroup: text('region_group').notNull(),
		version: integer('version').notNull(),
		/** `DefaultStep[]` (`director-costs/recipe`). */
		chainJson: jsonb('chain_json').notNull(),
		runId: text('run_id').notNull(),
		approvedBy: text('approved_by').notNull(),
		approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.templateProjectKey, table.regionGroup, table.version] }),
	],
);

/**
 * Measured GPU time per (effective pipeline id, generation size) (ADR-0008 §2 "Measured GPU
 * seconds"): a rolling mean of execution and of queue delay per job, for the card editor to show.
 * Agents read the card, never this table. Written from `job_done` (card 8E).
 */
export const directorBlueprintTimings = pgTable(
	'director_blueprint_timings',
	{
		pipeline: text('pipeline').notNull(),
		genPx: integer('gen_px').notNull(),
		jobs: integer('jobs').notNull().default(0),
		meanExecSeconds: doublePrecision('mean_exec_seconds').notNull().default(0),
		meanDelaySeconds: doublePrecision('mean_delay_seconds').notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.pipeline, table.genPx] })],
);

/**
 * Director write idempotency (ADR-0002): one row per WRITE, keyed by the worker's
 * `runId:step:seq` for an adapter op, or by `runId:owner:<requestId>` for one of the owner's own
 * rows (`director/store.ts` `appendOwnerEvent`; the two shapes cannot collide). A row is claimed
 * `pending` before the write runs and becomes `done` with its result after; a replayed `opId`
 * returns that stored result instead of running again. A failed write releases its row, so only
 * successes are remembered. A `pending` row older than the stale window (a crash between the write
 * and its record) is reclaimed by the next call with that `opId`.
 */
export const directorOps = pgTable(
	'director_ops',
	{
		opId: text('op_id').primaryKey(),
		runId: text('run_id')
			.notNull()
			.references(() => directorRuns.id, { onDelete: 'cascade' }),
		agent: text('agent').notNull(),
		/** `<tool>.<op>`, e.g. `gamemaker.create_from_template`. */
		op: text('op').notNull(),
		/** SHA-256 of the call's input: an `opId` replayed with a different input is a worker bug,
		 *  refused rather than answered with the first call's result. */
		inputHash: text('input_hash').notNull(),
		status: text('status').$type<'pending' | 'done'>().notNull(),
		result: jsonb('result'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
	},
	(table) => [
		index('director_ops_run_idx').on(table.runId),
		check('director_ops_status_check', sql`${table.status} in ('pending', 'done')`),
	],
);

/**
 * Atlas Maker still renders a Director run queued (`atlas.queue_variants`), keyed by atlas-tool's
 * `jobRef`. A row is `queued` when the render starts and moves to its terminal status exactly once,
 * from the signed completion callback or the launcher's `/progress` fallback, whichever lands
 * first: that one transition writes the run's `job_done` row to `director_events`, which wakes the
 * worker.
 */
export const directorAtlasJobs = pgTable(
	'director_atlas_jobs',
	{
		jobRef: text('job_ref').primaryKey(),
		runId: text('run_id')
			.notNull()
			.references(() => directorRuns.id, { onDelete: 'cascade' }),
		agent: text('agent').notNull(),
		/** The Atlas Maker atlas (manifest stem) the render works on. */
		atlas: text('atlas').notNull(),
		regions: jsonb('regions').$type<string[]>().notNull(),
		/**
		 * The approved recipe steps the render runs (`queue_variants`' matched steps), so its
		 * failure counts against them even when a revision has since replanned the step.
		 */
		steps: jsonb('steps').$type<{ recipe: string; n: number; region: string }[]>(),
		/** When the worker counted this render against `steps`: once, however often it is told. */
		stepsSettledAt: timestamp('steps_settled_at', { withTimezone: true }),
		status: text('status').$type<'queued' | 'finished' | 'failed' | 'cancelled'>().notNull(),
		/** What settled it: the callback body, or the `/progress` view the fallback read. */
		result: jsonb('result'),
		doneVia: text('done_via').$type<'callback' | 'poll'>(),
		queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
		doneAt: timestamp('done_at', { withTimezone: true }),
	},
	(table) => [
		index('director_atlas_jobs_run_idx').on(table.runId),
		check(
			'director_atlas_jobs_status_check',
			sql`${table.status} in ('queued', 'finished', 'failed', 'cancelled')`,
		),
		check(
			'director_atlas_jobs_done_check',
			sql`(${table.status} = 'queued') = (${table.doneAt} is null)`,
		),
	],
);

/**
 * A QA play of a run's frozen draft (ADR-0010). Modelled on {@link directorAtlasJobs}: the launcher
 * inserts and settles rows, and `queued` -> terminal there is the one transition that writes the
 * run's `job_done` event. The one other writer is the worker's stop (`cancelQueuedDrafts`), which
 * flips a stopping run's queued rows to `cancelled` with no event. `draftId` names a folder under the run's `director/drafts/`.
 */
export const directorDraftJobs = pgTable(
	'director_draft_jobs',
	{
		jobRef: text('job_ref').primaryKey(),
		runId: text('run_id')
			.notNull()
			.references(() => directorRuns.id, { onDelete: 'cascade' }),
		agent: text('agent').notNull(),
		draftId: text('draft_id').notNull(),
		/** The scenarios asked for; null plays every scenario of the kind's script. */
		scenarios: jsonb('scenarios').$type<string[]>(),
		status: text('status').$type<'queued' | 'finished' | 'failed' | 'cancelled'>().notNull(),
		/** The report summary (or the failure reason) that settled it. */
		result: jsonb('result'),
		doneVia: text('done_via').$type<'callback' | 'poll' | 'inline'>(),
		queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
		doneAt: timestamp('done_at', { withTimezone: true }),
	},
	(table) => [
		index('director_draft_jobs_run_idx').on(table.runId),
		check(
			'director_draft_jobs_status_check',
			sql`${table.status} in ('queued', 'finished', 'failed', 'cancelled')`,
		),
		check(
			'director_draft_jobs_done_check',
			sql`(${table.status} = 'queued') = (${table.doneAt} is null)`,
		),
	],
);

/**
 * Invisible Pipeline Changes: an owner's approval of one changed screen the current-games harness
 * found (ADR-0004 "Approving an intended difference", ADR-0007). `diffId` is the screen's stable id
 * from the report, `<head sha>:<game key>:<screen>:<diff hash>`: it embeds the head, so a new push
 * leaves every approval of the old head behind, and the hash, so a screen whose picture changed
 * again needs approving again. One row per diff per approver: an approval counts only while its approver holds
 * `pipelineMerge`, so another approver can add theirs beside one that lapsed. The approver is a
 * snapshot (`approver`, the name at the time) beside the user id: the row is a record, and
 * outlives a renamed or deleted account.
 */
export const pipelineApprovals = pgTable(
	'pipeline_approvals',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		diffId: text('diff_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		headSha: text('head_sha').notNull(),
		approverId: text('approver_id').notNull(),
		approver: text('approver').notNull(),
		note: text('note'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('pipeline_approvals_diff_approver_idx').on(table.diffId, table.approverId),
		index('pipeline_approvals_head_sha_idx').on(table.headSha),
	],
);

/** One approved changed screen as it stood when a change merged (ADR-0007 "approvals snapshot"). */
export interface MergeApproval {
	diffId: string;
	game: string;
	screen: string;
	approverId: string;
	approver: string;
	note: string | null;
	at: string;
}

/**
 * Invisible Pipeline Changes merges (ADR-0007): one row per pull request the launcher squash-merged
 * into `main`. GitHub stays the record of the merge itself; this holds what GitHub cannot — the
 * launcher user who merged, the approvals that counted at that moment, and which change a revert
 * undoes. A row is written as a CLAIM (`merge_sha` null) before GitHub is asked to merge, and
 * completed with the merge commit once GitHub has merged, so a merge GitHub made always has a row
 * to complete. `pr_number` is unique because a pull request merges once (and so is claimed once);
 * `request_id` makes a resent merge idempotent. `revert_pr` is the revert pull request the launcher
 * itself opened for this merge, and `revert_of` the merge a revert undoes: a revert is known by the
 * pull request the launcher opened, never by its branch name.
 */
export const pipelineMerges = pgTable(
	'pipeline_merges',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		requestId: text('request_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		title: text('title').notNull(),
		headSha: text('head_sha').notNull(),
		/** `null` while the row is a claim: GitHub has not answered the merge yet. */
		mergeSha: text('merge_sha'),
		mergedById: text('merged_by_id').notNull(),
		mergedBy: text('merged_by').notNull(),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		approvals: jsonb('approvals').$type<MergeApproval[]>().notNull().default([]),
		revertOf: integer('revert_of'),
		revertPr: integer('revert_pr'),
	},
	(table) => [
		uniqueIndex('pipeline_merges_pr_number_idx').on(table.prNumber),
		uniqueIndex('pipeline_merges_request_id_idx').on(table.requestId),
		index('pipeline_merges_revert_of_idx').on(table.revertOf),
		index('pipeline_merges_revert_pr_idx').on(table.revertPr),
	],
);

/**
 * Bug reports, pipeline and game alike: one row per reported bug, known to people as `BUG-<number>`
 * (one numbering for both kinds). `kind` says which tool it lives in (`$lib/bugReports.ts`): a
 * `pipeline` bug in Invisible Pipeline Bug Reports, a `game` bug in its project's Invisible Game Bug
 * Reports — a game bug always names its project, and is never sent to Pipeline Changes. The reporter
 * is a snapshot (`reporter`, the name at the time) beside the user id, like an approval: the report
 * outlives a renamed or deleted account. `priority` is null until someone sets one. `status_auto`
 * says the status was last set by a linked pull request rather than a person, which is what lets a
 * closed pull request put an automatic Working on back to Open (`autoStatus`). `revision` counts
 * edits of the text, so two people editing the description at once cannot overwrite each other;
 * a status, priority or comment does not bump it. `sent_at` is when it was sent to Invisible
 * Pipeline Changes; null when it is not there.
 */
export const bugReports = pgTable(
	'bug_reports',
	{
		number: serial('number').primaryKey(),
		kind: text('kind').$type<BugKind>().notNull().default('pipeline'),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		/** Per kind (`isBugArea`): a tool id or `engine` / `launcher` / `other`, or a part of a game. */
		area: text('area').notNull(),
		/**
		 * No foreign key, on purpose: the key outlives a purged project, so the bug stays an admin's
		 * (and its reporter's) to see rather than turning project-less, which everyone sees. A purge
		 * deletes the project's game bugs (`deleteProject`).
		 */
		projectKey: text('project_key'),
		/** Where it happened, as the reporter gave it; http(s) only. */
		pageUrl: text('page_url'),
		reporterId: text('reporter_id').notNull(),
		reporter: text('reporter').notNull(),
		priority: text('priority').$type<BugPriority>(),
		status: text('status').$type<BugStatus>().notNull().default('open'),
		/** Who set the status last: a name, or `#<n>` when a linked pull request did. */
		statusBy: text('status_by'),
		statusAt: timestamp('status_at', { withTimezone: true }),
		statusAuto: boolean('status_auto').notNull().default(false),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		sentBy: text('sent_by'),
		revision: integer('revision').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('bug_reports_kind_project_idx').on(table.kind, table.projectKey),
		index('bug_reports_sent_at_idx').on(table.sentAt),
		check('bug_reports_kind_check', sql`${table.kind} in ('pipeline', 'game')`),
		check(
			'bug_reports_game_project_check',
			sql`${table.kind} <> 'game' or ${table.projectKey} is not null`,
		),
		check(
			'bug_reports_status_check',
			sql`${table.status} in ('open', 'working', 'resolved', 'wontFix')`,
		),
		check(
			'bug_reports_priority_check',
			sql`${table.priority} is null or ${table.priority} in ('critical', 'high', 'medium', 'low')`,
		),
	],
);

/**
 * A bug's screenshots. The bytes live in R2 at `_bugs/<number>/<id>.<ext>` (no shipped asset class
 * reads `_bugs/`); the row is what lists them, so an object the row does not name is never served.
 */
export const bugReportScreenshots = pgTable(
	'bug_report_screenshots',
	{
		id: text('id').primaryKey(),
		bugNumber: integer('bug_number')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		/** The object's basename, `<id>.<ext>`. */
		file: text('file').notNull(),
		mediaType: text('media_type').notNull(),
		bytes: integer('bytes').notNull(),
		uploadedById: text('uploaded_by_id').notNull(),
		uploadedBy: text('uploaded_by').notNull(),
		uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('bug_report_screenshots_bug_idx').on(table.bugNumber)],
);

export type BugEventKind =
	| 'reported'
	| 'edited'
	| 'comment'
	| 'priority'
	| 'status'
	| 'sent'
	| 'unsent'
	| 'screenshot_added'
	| 'screenshot_removed'
	| 'linked'
	| 'unlinked'
	| 'escalated'
	| 'repair'
	| 'fix_run'
	| 'fix_decision';

/**
 * A bug's activity, append-only: who did what and when. `actor_id` is null for what the launcher
 * did by itself (a linked pull request on GitHub moving the status); `actor` is then `GitHub`.
 */
export const bugReportEvents = pgTable(
	'bug_report_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		bugNumber: integer('bug_number')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		kind: text('kind').$type<BugEventKind>().notNull(),
		actorId: text('actor_id'),
		actor: text('actor').notNull(),
		data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
	},
	(table) => [
		index('bug_report_events_bug_idx').on(table.bugNumber, table.id),
		check(
			'bug_report_events_kind_check',
			sql`${table.kind} in ('reported', 'edited', 'comment', 'priority', 'status', 'sent', 'unsent', 'screenshot_added', 'screenshot_removed', 'linked', 'unlinked', 'escalated', 'repair', 'fix_run', 'fix_decision')`,
		),
	],
);

/**
 * The pull requests that name a bug (`BUG-<n>` in their title, branch or body), with the state
 * GitHub last answered. A row changes only when that state does, and that change is what moves the
 * bug's status (`autoStatus`).
 */
export const bugReportLinks = pgTable(
	'bug_report_links',
	{
		bugNumber: integer('bug_number')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		prNumber: integer('pr_number').notNull(),
		title: text('title').notNull(),
		url: text('url').notNull(),
		state: text('state').$type<LinkState>().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.bugNumber, table.prNumber] }),
		check('bug_report_links_state_check', sql`${table.state} in ('open', 'merged', 'closed')`),
	],
);

/**
 * A game bug handed to the pipeline (ADR-0012 §3): `from_bug` is the game bug, `to_bug` the
 * pipeline bug filed for its cause. Queryable state — "which game bugs wait on BUG-12?" — where
 * the `escalated` events on each bug are the history the activity shows. One escalation per game
 * bug (the primary key), so a replayed escalation can never relate it twice. `run_id` is the repair
 * run that proposed it, null for a triager's manual escalation.
 */
export const bugReportRelations = pgTable(
	'bug_report_relations',
	{
		fromBug: integer('from_bug')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		toBug: integer('to_bug')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		kind: text('kind').$type<'escalated_to'>().notNull(),
		runId: text('run_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdBy: text('created_by').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.fromBug, table.kind] }),
		index('bug_report_relations_to_idx').on(table.toBug),
		check('bug_report_relations_kind_check', sql`${table.kind} in ('escalated_to')`),
	],
);

/**
 * A fix run on a pipeline bug (ADR-0013): Claude Code in a GitHub Actions job (`bug-fix.yml`),
 * whose result the launcher turns into a draft pull request on `bug-<n>-fix-<id>`. Queryable state —
 * "is a run live on this bug?", "how many are live?" — where the bug's `fix_run` events are the
 * history its activity shows. One live run per bug (`bug_fix_runs_live_idx`); one Actions run binds
 * one fix run (`gh_run_id` unique), at dispatch when GitHub names it, else at the job's first
 * contact. `summary` and `second_bug` are the run's own words (untrusted, capped, unlinked);
 * `reason` is the launcher's sentence for how it ended. `result_at` is set when a result is
 * accepted, before its pull request is made: the claim that lets only the first result in and
 * keeps the backstop off a run mid-commit. `started_by` is a snapshot, like a reporter.
 *
 * ADR-0014: a run is a `diagnose` run (changes no file; ends `diagnosed` with its options in
 * `diagnosis`) or a `build` run (a row from before the ADR is one). A build comes from a person
 * choosing an option of a diagnose run: `parent_run_id` is that run and `chosen_option` the choice.
 */
export const bugFixRuns = pgTable(
	'bug_fix_runs',
	{
		id: text('id').primaryKey(),
		bugNumber: integer('bug_number')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		mode: text('mode').$type<FixRunMode>().notNull().default('build'),
		status: text('status').$type<FixRunStatus>().notNull().default('dispatched'),
		outcome: text('outcome').$type<FixRunOutcome>(),
		/** Main's commit when the run was dispatched: the job checks it out, the change sits on it. */
		baseSha: text('base_sha').notNull(),
		ghRunId: bigint('gh_run_id', { mode: 'number' }),
		prNumber: integer('pr_number'),
		branch: text('branch'),
		summary: text('summary'),
		reason: text('reason'),
		secondBug: jsonb('second_bug').$type<FixRunSecondBug>(),
		diagnosis: jsonb('diagnosis').$type<FixRunDiagnosis>(),
		chosenOption: jsonb('chosen_option').$type<FixRunChoice>(),
		explanation: jsonb('explanation').$type<FixRunExplanation>(),
		parentRunId: text('parent_run_id').references((): AnyPgColumn => bugFixRuns.id),
		/** What the run's result reported, priced; 0 for a run that ended before its brief (it never ran
		 *  Claude Code); null while none was reported ("spend unknown"). */
		spendUsd: doublePrecision('spend_usd'),
		startedById: text('started_by_id').notNull(),
		startedBy: text('started_by').notNull(),
		requestId: text('request_id').notNull(),
		resultAt: timestamp('result_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
	},
	(table) => [
		uniqueIndex('bug_fix_runs_request_id_idx').on(table.requestId),
		uniqueIndex('bug_fix_runs_gh_run_id_idx').on(table.ghRunId),
		uniqueIndex('bug_fix_runs_live_idx')
			.on(table.bugNumber)
			.where(sql`${table.status} in ('dispatched', 'running')`),
		index('bug_fix_runs_bug_idx').on(table.bugNumber, table.createdAt),
		check(
			'bug_fix_runs_status_check',
			sql`${table.status} in ('dispatched', 'running', 'diagnosed', 'pr_opened', 'no_fix', 'failed', 'cancelled')`,
		),
		check('bug_fix_runs_mode_check', sql`${table.mode} in ('diagnose', 'build')`),
		check(
			'bug_fix_runs_outcome_check',
			sql`${table.outcome} is null or ${table.outcome} in ('fixed', 'not_reproduced', 'needs_person', 'second_area', 'diagnosed')`,
		),
	],
);

/**
 * A Resolve conflict run on a pipeline change (ADR-0015): `merge-main.yml` merges `main` into the
 * change's head and proposes how to settle what conflicts; nothing reaches the branch until a person
 * accepts. One live run per pull request (`merge_main_runs_live_idx`; a proposal waiting counts as
 * live); one Actions run binds one merge run (`gh_run_id` unique). `files` and `explanation` are the
 * job's own words (untrusted, capped, cleaned); `reason` is the launcher's sentence for how it ended.
 * `result_at` is set once, when the job's result is accepted. `started_by` and `accepted_by` are
 * snapshots, like a reporter.
 */
export const mergeMainRuns = pgTable(
	'merge_main_runs',
	{
		id: text('id').primaryKey(),
		prNumber: integer('pr_number').notNull(),
		branch: text('branch').notNull(),
		/** The change's head when the run was dispatched: the proposal is for exactly this head. */
		headSha: text('head_sha').notNull(),
		/** `main`'s commit when the run was dispatched. */
		mainSha: text('main_sha').notNull(),
		status: text('status').$type<MergeRunStatus>().notNull().default('dispatched'),
		reason: text('reason'),
		files: jsonb('files').$type<MergeRunFile[]>(),
		explanation: jsonb('explanation').$type<MergeRunExplanation>(),
		mergeSha: text('merge_sha'),
		spendUsd: doublePrecision('spend_usd'),
		ghRunId: bigint('gh_run_id', { mode: 'number' }),
		startedById: text('started_by_id').notNull(),
		startedBy: text('started_by').notNull(),
		acceptedById: text('accepted_by_id'),
		acceptedBy: text('accepted_by'),
		requestId: text('request_id').notNull(),
		resultAt: timestamp('result_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
	},
	(table) => [
		uniqueIndex('merge_main_runs_request_id_idx').on(table.requestId),
		uniqueIndex('merge_main_runs_gh_run_id_idx').on(table.ghRunId),
		uniqueIndex('merge_main_runs_live_idx')
			.on(table.prNumber)
			.where(sql`${table.status} in ('dispatched', 'running', 'proposed')`),
		index('merge_main_runs_pr_idx').on(table.prNumber, table.createdAt),
		check(
			'merge_main_runs_status_check',
			sql`${table.status} in ('dispatched', 'running', 'proposed', 'accepted', 'discarded', 'stale', 'needs_person', 'no_proposal', 'failed', 'cancelled')`,
		),
	],
);

export type MergeMainRun = typeof mergeMainRuns.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ToolInstall = typeof toolInstalls.$inferSelect;
export type UserToolAccess = typeof userToolAccess.$inferSelect;
export type RoleToolAccess = typeof roleToolAccess.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type UserProjectAccess = typeof userProjectAccess.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type UserClientAccess = typeof userClientAccess.$inferSelect;
export type Game = typeof games.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type PartnerShareLink = typeof partnerShareLinks.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type SharedRig = typeof sharedRigs.$inferSelect;
export type SharedAnimation = typeof sharedAnimations.$inferSelect;
export type DocLease = typeof docLeases.$inferSelect;
export type CostMonth = typeof costMonths.$inferSelect;
export type DirectorSpend = typeof directorSpend.$inferSelect;
/**
 * Invisible Director's saved prompts: named notes-and-style texts the New game screen loads into
 * its Notes box. Listed per client (`client_key` is the form's client, `unassigned` for none), and
 * re-saved under another client to reuse them. A name is unique per client, ignoring case. `version`
 * is the optimistic-concurrency counter every update and delete is conditional on.
 */
export const directorPrompts = pgTable(
	'director_prompts',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		clientKey: text('client_key').notNull(),
		name: text('name').notNull(),
		body: text('body').notNull(),
		createdByUserId: text('created_by_user_id').references(() => users.id, {
			onDelete: 'set null',
		}),
		updatedByUserId: text('updated_by_user_id').references(() => users.id, {
			onDelete: 'set null',
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1),
	},
	(table) => [
		uniqueIndex('director_prompts_client_name_idx').on(table.clientKey, sql`lower(${table.name})`),
	],
);

export type DirectorRun = typeof directorRuns.$inferSelect;
export type DirectorPrompt = typeof directorPrompts.$inferSelect;
export type DirectorEvent = typeof directorEvents.$inferSelect;
export type DirectorMessage = typeof directorMessages.$inferSelect;
export type DirectorRegion = typeof directorRegions.$inferSelect;
export type DirectorOp = typeof directorOps.$inferSelect;
export type DirectorAtlasJob = typeof directorAtlasJobs.$inferSelect;
export type DirectorDraftJob = typeof directorDraftJobs.$inferSelect;
export type PipelineApproval = typeof pipelineApprovals.$inferSelect;
export type PipelineMerge = typeof pipelineMerges.$inferSelect;
export type BugReport = typeof bugReports.$inferSelect;
export type BugReportRelation = typeof bugReportRelations.$inferSelect;
export type BugReportScreenshot = typeof bugReportScreenshots.$inferSelect;
export type BugReportEvent = typeof bugReportEvents.$inferSelect;
export type BugReportLink = typeof bugReportLinks.$inferSelect;
export type BugFixRun = typeof bugFixRuns.$inferSelect;

/**
 * Invisible Profiler readings (`docs/design/invisible-profiler.md` §3): one row per `?perf=1`
 * report, its summary for listing and comparing; the full JSON lives in R2 at `r2_key`
 * (`<client>/<project>/perf/reports/<id>.json`). `source` is `capture` (a phone sent it with a
 * capture session's token), `paste` (a signed-in user pasted a delivery's Copy) or `lab` (a scripted
 * headless run with CI's lab session, P6).
 *
 * Retention (owner, 2026-11-16): the daily purge (`profiler/purge.ts`) deletes a reading older than
 * 15 days unless `keep`. It claims a row first (`purging_at`), then deletes the R2 file, then the
 * row, so a row is never gone while its file stays, a claimed row is retried until both are, and
 * Keep cannot be set on a row the purge has claimed (the toggle's update requires
 * `purging_at IS NULL`). Listing hides claimed rows.
 */
export const perfReports = pgTable(
	'perf_reports',
	{
		id: text('id').primaryKey(),
		projectKey: text('project_key')
			.notNull()
			.references(() => projects.key, { onDelete: 'cascade' }),
		clientKey: text('client_key').notNull(),
		r2Key: text('r2_key').notNull(),
		bytes: integer('bytes').notNull(),
		source: text('source').notNull(),
		session: text('session'),
		label: text('label'),
		/** The game card the reading was taken on (P2: one capture token per game; Paste's picker). */
		gameKey: text('game_key'),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
		perfVersion: integer('perf_version').notNull(),
		buildVersion: text('build_version'),
		buildSha: text('build_sha'),
		/** An online game's runtime release, stamped at receipt (`store.ts` `runtimeReleaseOf`). */
		runtimeRelease: text('runtime_release'),
		deviceClass: text('device_class'),
		deviceReason: text('device_reason'),
		gpu: text('gpu'),
		uaFamily: text('ua_family'),
		dpr: doublePrecision('dpr'),
		canvas: text('canvas'),
		flags: jsonb('flags').$type<Record<string, string>>().notNull().default({}),
		idleFps: doublePrecision('idle_fps'),
		idleP50: doublePrecision('idle_p50'),
		idleP95: doublePrecision('idle_p95'),
		idleHitches: integer('idle_hitches'),
		spinFps: doublePrecision('spin_fps'),
		spinP50: doublePrecision('spin_p50'),
		spinP95: doublePrecision('spin_p95'),
		spinHitches: integer('spin_hitches'),
		roundFps: doublePrecision('round_fps'),
		roundP50: doublePrecision('round_p50'),
		roundP95: doublePrecision('round_p95'),
		roundHitches: integer('round_hitches'),
		/** Frame counts per phase, so an empty phase reads as "no frames", not as 0 fps. */
		idleFrames: integer('idle_frames').notNull().default(0),
		spinFrames: integer('spin_frames').notNull().default(0),
		roundFrames: integer('round_frames').notNull().default(0),
		/** The family the probe named (`perf: 8`: slot, arcade, match3, card); null for `perf: 7`. */
		gameKind: text('game_kind'),
		/** An arcade reading's menu / play summaries (the slot columns above stay empty); null for a slot. */
		arcadePhases: jsonb('arcade_phases').$type<ArcadePhaseSummaries>(),
		/** A browser's 30 fps cap (`profiler.ts` `capped30`): fps and p95 are not judged. */
		capped30: boolean('capped30').notNull().default(false),
		drawsMean: doublePrecision('draws_mean'),
		jsMs: doublePrecision('js_ms'),
		textureMb: doublePrecision('texture_mb'),
		/** A `perf: 9` reading's download weight, MB (`profilerNetwork.ts`); null for an older one. */
		transferMb: doublePrecision('transfer_mb'),
		/** ms from navigation start to the game's first frame; null before `perf: 9` or when unknown. */
		firstFrameMs: doublePrecision('first_frame_ms'),
		/** The rest of the reading's network summary, as the page lists it; null before `perf: 9`. */
		network: jsonb('network').$type<NetworkSummary>(),
		/** Per-phase per-frame counts (`profilerLab.ts`); null on a reading kept before P6. */
		counts: jsonb('counts').$type<PerfCounts>(),
		/** What the Findings rules read beyond the summary (`profilerFindings/facts.ts`); null until filled. */
		facts: jsonb('facts').$type<ReportFacts>(),
		keep: boolean('keep').notNull().default(false),
		purgingAt: timestamp('purging_at', { withTimezone: true }),
	},
	(table) => [
		index('perf_reports_project_idx').on(table.projectKey, table.capturedAt),
		index('perf_reports_purge_idx').on(table.keep, table.capturedAt),
		index('perf_reports_session_idx').on(table.session),
		check('perf_reports_source_check', sql`${table.source} in ('capture', 'paste', 'lab')`),
	],
);

export type PerfReport = typeof perfReports.$inferSelect;

/**
 * Invisible Profiler build records (`docs/design/invisible-profiler.md` §2, step P2): one row per
 * desktop ☁ Publish or 📦 Deliver, the summary of the `build-breakdown.json` the desktop launcher
 * uploads after it; the full JSON lives in R2 at `r2_key` (`perfBuildKey`). The id is the presigned
 * upload's, so a registration sent twice lands once. `build` is the launcher's build number for
 * `game_key` — counted per machine, so it is not unique on its own. Readings join on it and on
 * `engine_sha` (`readingOnBuild`): a desktop build's stamp names the engine commit it compiled,
 * which stands in for a runtime release (a desktop build boots no shared runtime).
 *
 * Retention as `perf_reports` (claim, file, row; `profiler/purgeJob.ts`), from `registered_at`,
 * except that the newest build of each game key and kind is never claimed (`buildPurgeable`).
 */
export const perfBuilds = pgTable(
	'perf_builds',
	{
		id: text('id').primaryKey(),
		projectKey: text('project_key')
			.notNull()
			.references(() => projects.key, { onDelete: 'cascade' }),
		clientKey: text('client_key').notNull(),
		gameKey: text('game_key').notNull(),
		build: text('build').notNull(),
		kind: text('kind').notNull(),
		profile: text('profile'),
		debug: boolean('debug').notNull().default(false),
		optimize: boolean('optimize').notNull().default(false),
		builtAt: text('built_at'),
		engineSha: text('engine_sha'),
		gameSha: text('game_sha'),
		launcherVersion: text('launcher_version'),
		breakdownVersion: integer('breakdown_version').notNull(),
		files: integer('files').notNull(),
		shippedBytes: bigint('shipped_bytes', { mode: 'number' }).notNull(),
		codeBytes: bigint('code_bytes', { mode: 'number' }).notNull(),
		gpuBytes: bigint('gpu_bytes', { mode: 'number' }).notNull(),
		removedBytes: bigint('removed_bytes', { mode: 'number' }).notNull(),
		unreferencedBytes: bigint('unreferenced_bytes', { mode: 'number' }).notNull(),
		duplicateBytes: bigint('duplicate_bytes', { mode: 'number' }).notNull(),
		categories: jsonb('categories').$type<PerfBuildCategory[]>().notNull().default([]),
		/** What the Findings rules read beyond the summary (`profilerFindings/facts.ts`); null until filled. */
		facts: jsonb('facts').$type<BuildFacts>(),
		issuesError: integer('issues_error').notNull().default(0),
		issuesWarn: integer('issues_warn').notNull().default(0),
		issuesInfo: integer('issues_info').notNull().default(0),
		r2Key: text('r2_key').notNull(),
		bytes: integer('bytes').notNull(),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
		keep: boolean('keep').notNull().default(false),
		purgingAt: timestamp('purging_at', { withTimezone: true }),
	},
	(table) => [
		index('perf_builds_project_idx').on(table.projectKey, table.registeredAt),
		index('perf_builds_line_idx').on(
			table.projectKey,
			table.gameKey,
			table.kind,
			table.registeredAt,
		),
		index('perf_builds_purge_idx').on(table.keep, table.registeredAt),
		check('perf_builds_kind_check', sql`${table.kind} in ('publish', 'delivery')`),
	],
);

export type PerfBuild = typeof perfBuilds.$inferSelect;

/**
 * Invisible Profiler budgets (`docs/design/invisible-profiler.md` §3, step P3): a project's
 * override of one studio default line (`STUDIO_BUDGETS` in `$lib/profilerBudgets` — the owner's
 * numbers live in code, reviewed, not in a row any role could edit for every project). No row = the
 * studio default. `device_class` is `all` for what does not depend on the device (shipped size);
 * `phase` is `''` for a metric that is not per phase, so the key never holds a null.
 *
 * Every role may edit (owner decision 2026-11-16), so two people can save the same line at once:
 * each write names the `rev` it was made against and only lands while it is still current
 * (`profiler/budgets.ts`), so a stale save is refused with the line as it now stands, never silently
 * overwriting someone else's.
 */
export const perfBudgets = pgTable(
	'perf_budgets',
	{
		projectKey: text('project_key')
			.notNull()
			.references(() => projects.key, { onDelete: 'cascade' }),
		deviceClass: text('device_class').notNull(),
		metric: text('metric').notNull(),
		phase: text('phase').notNull().default(''),
		warn: doublePrecision('warn'),
		fail: doublePrecision('fail'),
		rev: integer('rev').notNull(),
		updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.projectKey, table.deviceClass, table.metric, table.phase] }),
		check(
			'perf_budgets_device_class_check',
			sql`${table.deviceClass} in ('phone', 'tablet', 'desktop', 'all')`,
		),
		check('perf_budgets_line_check', sql`${table.warn} is not null or ${table.fail} is not null`),
	],
);

export type PerfBudget = typeof perfBudgets.$inferSelect;

/**
 * Invisible Profiler P5: a finding filed as a bug (`profiler/findingBugs.ts`). One row per finding
 * of a project — the primary key is what refuses a second filing, two people at once included —
 * and gone with its bug, so a finding whose bug is deleted can be filed again. The readings and
 * builds the bug cites are kept: Keep is set when it is filed, cannot be taken off while the bug
 * exists, and the purge never claims a cited row. Keep stays on after the bug is deleted.
 */
export const perfFindingBugs = pgTable(
	'perf_finding_bugs',
	{
		projectKey: text('project_key')
			.notNull()
			.references(() => projects.key, { onDelete: 'cascade' }),
		/** P4's `Finding.id`: the rule and what it read, the build stamp included. */
		findingId: text('finding_id').notNull(),
		bugNumber: integer('bug_number')
			.notNull()
			.references(() => bugReports.number, { onDelete: 'cascade' }),
		readingIds: text('reading_ids')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		buildIds: text('build_ids')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.projectKey, table.findingId] }),
		index('perf_finding_bugs_bug_idx').on(table.bugNumber),
	],
);

export type PerfFindingBug = typeof perfFindingBugs.$inferSelect;
