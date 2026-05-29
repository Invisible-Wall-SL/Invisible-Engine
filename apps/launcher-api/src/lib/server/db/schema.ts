import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
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

/** Project registry. `cloud` is the default project (seeded). */
export const projects = pgTable('projects', {
	key: text('key').primaryKey(),
	name: text('name').notNull(),
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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ToolInstall = typeof toolInstalls.$inferSelect;
export type UserToolAccess = typeof userToolAccess.$inferSelect;
export type RoleToolAccess = typeof roleToolAccess.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type UserProjectAccess = typeof userProjectAccess.$inferSelect;
