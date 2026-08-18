import {
	boolean,
	doublePrecision,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';
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
	 * Game kind this project targets (lines/ways/cluster/scatter/bookOf — see
	 * `GAME_KINDS` in `$lib/roles`). Picks the editor template + scaffold
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
		/** Estimated USD spend for the month, in cents. */
		amountUsdCents: integer('amount_usd_cents').notNull().default(0),
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
