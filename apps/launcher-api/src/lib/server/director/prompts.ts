import { and, asc, eq, sql } from 'drizzle-orm';
import { mayTargetClient } from '$lib/accessRules';
import type { Role } from '$lib/roles';
import { getDb } from '../db';
import { directorPrompts, type DirectorPrompt } from '../db/schema';
import { UNASSIGNED_CLIENT } from '../projectPaths';
import { MAX_NOTES_LENGTH } from './notesLimit';

/**
 * Saved prompts for the New game screen: named notes-and-style texts, listed per client and
 * re-saved under another client to reuse them. Everything is scoped by `mayTargetClient`, the rule
 * the New game form's client list uses: a prompt of a client the caller cannot target is never
 * listed, read or changed, and answers the same 404 as one that does not exist. Updates and
 * deletes are conditional on the row's `version`, so a stale write changes nothing.
 *
 * The functions take a `PromptStore` (Postgres by default) so a fixture can run the same
 * scenarios over memory and over a real database.
 */

export const MAX_PROMPT_BODY_LENGTH = MAX_NOTES_LENGTH;
export const MAX_PROMPT_NAME_LENGTH = 80;

export class PromptError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'PromptError';
	}
}

const bad = (code: string, message: string) => new PromptError(400, code, message);
const notFound = () => new PromptError(404, 'not_found', 'No such saved prompt.');

export type PromptRow = DirectorPrompt;

export interface PromptView {
	id: string;
	clientKey: string;
	name: string;
	body: string;
	version: number;
	updatedAt: string;
}

export interface PromptPatch {
	name?: string;
	body?: string;
	clientKey?: string;
}

/** `name_taken`: another prompt of that client has the name (ignoring case). `stale`: the version moved. */
export interface PromptStore {
	list(): Promise<PromptRow[]>;
	get(id: string): Promise<PromptRow | null>;
	insert(
		row: Omit<PromptRow, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
	): Promise<PromptRow | 'name_taken'>;
	update(
		id: string,
		version: number,
		patch: PromptPatch,
		userId: string,
	): Promise<PromptRow | 'stale' | 'name_taken'>;
	remove(id: string, version: number): Promise<boolean>;
}

/** Who is asking: the clients they may target are `grants` (all of them for an admin). */
export interface PromptCaller {
	id: string;
	role: Role;
	grants: readonly string[];
	/** Every client key that exists. */
	clientKeys: readonly string[];
}

const mayTarget = (caller: PromptCaller, clientKey: string) =>
	mayTargetClient(caller.role, clientKey === UNASSIGNED_CLIENT ? null : clientKey, caller.grants);

const view = (row: PromptRow): PromptView => ({
	id: row.id,
	clientKey: row.clientKey,
	name: row.name,
	body: row.body,
	version: row.version,
	updatedAt: row.updatedAt.toISOString(),
});

export function parsePromptName(raw: unknown): string {
	const name = typeof raw === 'string' ? raw.trim() : '';
	if (!name) throw bad('name_required', 'Give the prompt a name.');
	if (name.length > MAX_PROMPT_NAME_LENGTH) {
		throw bad('name_too_long', `A name is at most ${MAX_PROMPT_NAME_LENGTH} characters.`);
	}
	return name;
}

export function parsePromptBody(raw: unknown): string {
	const body = typeof raw === 'string' ? raw.trim() : '';
	if (!body) throw bad('body_required', 'A saved prompt needs some text.');
	if (body.length > MAX_PROMPT_BODY_LENGTH) {
		throw bad('body_too_long', `A prompt is at most ${MAX_PROMPT_BODY_LENGTH} characters.`);
	}
	return body;
}

export function parsePromptVersion(raw: unknown): number {
	const version = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw bad('version_required', 'Send the version of the prompt you read.');
	}
	return version;
}

function checkClient(caller: PromptCaller, raw: unknown): string {
	const clientKey = typeof raw === 'string' ? raw.trim() : '';
	if (!clientKey) throw bad('client_required', 'Choose a client.');
	if (clientKey !== UNASSIGNED_CLIENT && !caller.clientKeys.includes(clientKey)) {
		throw bad('unknown_client', 'No such client.');
	}
	if (!mayTarget(caller, clientKey)) {
		throw new PromptError(403, 'client_forbidden', 'You cannot save prompts for that client.');
	}
	return clientKey;
}

const nameTaken = () =>
	new PromptError(409, 'name_taken', 'That client already has a prompt with this name.');
const conflict = () =>
	new PromptError(409, 'conflict', 'Someone saved this since it was read. Reload and retry.');

async function visibleRow(
	store: PromptStore,
	caller: PromptCaller,
	id: string,
): Promise<PromptRow> {
	const row = await store.get(id);
	if (!row || !mayTarget(caller, row.clientKey)) throw notFound();
	return row;
}

export async function listPrompts(
	caller: PromptCaller,
	store: PromptStore = pgPromptStore,
): Promise<PromptView[]> {
	return (await store.list()).filter((row) => mayTarget(caller, row.clientKey)).map(view);
}

export async function createPrompt(
	caller: PromptCaller,
	input: Record<string, unknown>,
	store: PromptStore = pgPromptStore,
): Promise<PromptView> {
	const clientKey = checkClient(caller, input.clientKey);
	const name = parsePromptName(input.name);
	const body = parsePromptBody(input.body);
	const made = await store.insert({
		clientKey,
		name,
		body,
		createdByUserId: caller.id,
		updatedByUserId: caller.id,
	});
	if (made === 'name_taken') throw nameTaken();
	return view(made);
}

export async function updatePrompt(
	caller: PromptCaller,
	id: string,
	input: { name?: unknown; body?: unknown; clientKey?: unknown; version: unknown },
	store: PromptStore = pgPromptStore,
): Promise<PromptView> {
	const version = parsePromptVersion(input.version);
	const patch: PromptPatch = {};
	if (input.name !== undefined) patch.name = parsePromptName(input.name);
	if (input.body !== undefined) patch.body = parsePromptBody(input.body);
	if (input.clientKey !== undefined) patch.clientKey = checkClient(caller, input.clientKey);
	if (Object.keys(patch).length === 0) {
		throw bad('nothing_to_change', 'Send a name, a body or a client to change.');
	}
	await visibleRow(store, caller, id);
	const next = await store.update(id, version, patch, caller.id);
	if (next === 'name_taken') throw nameTaken();
	if (next === 'stale') throw conflict();
	return view(next);
}

export async function deletePrompt(
	caller: PromptCaller,
	id: string,
	rawVersion: unknown,
	store: PromptStore = pgPromptStore,
): Promise<void> {
	const version = parsePromptVersion(rawVersion);
	await visibleRow(store, caller, id);
	if (!(await store.remove(id, version))) throw conflict();
}

// ── Postgres ──────────────────────────────────────────────────────────────────

function isUniqueViolation(e: unknown): boolean {
	for (
		let err: unknown = e;
		err && typeof err === 'object';
		err = (err as { cause?: unknown }).cause
	) {
		if ((err as { code?: unknown }).code === '23505') return true;
	}
	return false;
}

export const pgPromptStore: PromptStore = {
	async list() {
		return getDb()
			.select()
			.from(directorPrompts)
			.orderBy(asc(directorPrompts.clientKey), asc(sql`lower(${directorPrompts.name})`));
	},
	async get(id) {
		const [row] = await getDb().select().from(directorPrompts).where(eq(directorPrompts.id, id));
		return row ?? null;
	},
	async insert(row) {
		try {
			const [made] = await getDb().insert(directorPrompts).values(row).returning();
			return made;
		} catch (e) {
			if (isUniqueViolation(e)) return 'name_taken';
			throw e;
		}
	},
	async update(id, version, patch, userId) {
		try {
			const [row] = await getDb()
				.update(directorPrompts)
				.set({
					...patch,
					updatedByUserId: userId,
					updatedAt: new Date(),
					version: sql`${directorPrompts.version} + 1`,
				})
				.where(and(eq(directorPrompts.id, id), eq(directorPrompts.version, version)))
				.returning();
			return row ?? 'stale';
		} catch (e) {
			if (isUniqueViolation(e)) return 'name_taken';
			throw e;
		}
	},
	async remove(id, version) {
		const rows = await getDb()
			.delete(directorPrompts)
			.where(and(eq(directorPrompts.id, id), eq(directorPrompts.version, version)))
			.returning({ id: directorPrompts.id });
		return rows.length > 0;
	},
};
