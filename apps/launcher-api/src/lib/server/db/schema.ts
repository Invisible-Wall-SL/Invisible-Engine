import {
	bigserial,
	boolean,
	check,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
		ownerUserId: text('owner_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** The art agents' settings (SPEC §1.1 "Preset"): blueprint, resolutions, variants, GPU. */
		presetJson: jsonb('preset_json').notNull().default({}),
		/** Mockups (with screen tags), fidelity, notes and the recorded ownership check. */
		startingPointJson: jsonb('starting_point_json').notNull().default({}),
		/** `{ breakdown, regionBatch }`; `before_publish` is not stored because it cannot be off. */
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
			.$type<'breakdown' | 'style_pack' | 'regions' | 'build' | 'handoff'>()
			.notNull()
			.default('breakdown'),
		/** The open checkpoint while `waiting`; null otherwise. */
		waitingOn: text('waiting_on').$type<'breakdown' | 'region_batch' | 'before_publish'>(),
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
		check(
			'director_runs_status_check',
			sql`${table.status} in ('draft', 'running', 'waiting', 'paused', 'stopping', 'stopped', 'failed', 'handed_off')`,
		),
		check(
			'director_runs_step_check',
			sql`${table.step} in ('breakdown', 'style_pack', 'regions', 'build', 'handoff')`,
		),
		check(
			'director_runs_waiting_on_check',
			sql`(${table.status} = 'waiting') = (${table.waitingOn} is not null) and (${table.waitingOn} is null or ${table.waitingOn} in ('breakdown', 'region_batch', 'before_publish'))`,
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
 * into `main`, written in the same flow as GitHub's merge. GitHub stays the record of the merge
 * itself; this holds what GitHub cannot — the launcher user who merged, the approvals that counted
 * at that moment, and which change a revert undoes. `request_id` makes a resent merge idempotent;
 * `pr_number` is unique because a pull request merges once.
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
		mergeSha: text('merge_sha').notNull(),
		mergedById: text('merged_by_id').notNull(),
		mergedBy: text('merged_by').notNull(),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
		approvals: jsonb('approvals').$type<MergeApproval[]>().notNull().default([]),
		revertOf: integer('revert_of'),
	},
	(table) => [
		uniqueIndex('pipeline_merges_pr_number_idx').on(table.prNumber),
		uniqueIndex('pipeline_merges_request_id_idx').on(table.requestId),
		index('pipeline_merges_revert_of_idx').on(table.revertOf),
	],
);

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
export type AppSetting = typeof appSettings.$inferSelect;
export type SharedRig = typeof sharedRigs.$inferSelect;
export type SharedAnimation = typeof sharedAnimations.$inferSelect;
export type DocLease = typeof docLeases.$inferSelect;
export type CostMonth = typeof costMonths.$inferSelect;
export type DirectorSpend = typeof directorSpend.$inferSelect;
export type DirectorRun = typeof directorRuns.$inferSelect;
export type DirectorEvent = typeof directorEvents.$inferSelect;
export type DirectorMessage = typeof directorMessages.$inferSelect;
export type DirectorRegion = typeof directorRegions.$inferSelect;
export type DirectorOp = typeof directorOps.$inferSelect;
export type DirectorAtlasJob = typeof directorAtlasJobs.$inferSelect;
export type PipelineApproval = typeof pipelineApprovals.$inferSelect;
export type PipelineMerge = typeof pipelineMerges.$inferSelect;
