import { fail, isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import {
	OWNER_ONLY_ADMIN_ACTIONS,
	ownerActionDenial,
	type OwnerOnlyAdminAction,
} from '$lib/accessRules';
import { getDb } from './db';
import { adminAudit } from './db/schema';

/**
 * The two rules every `/admin` form action runs under, applied once around the whole actions table
 * rather than repeated in each of its sixty bodies:
 *
 *  1. the owner-only actions (`OWNER_ONLY_ADMIN_ACTIONS`) are refused to anyone whose role is not
 *     the owner's, however the `adminPanel` capability was granted — before the action runs;
 *  2. every action that changes something writes one `admin_audit` row: who, which action, its
 *     target, the submitted fields with secrets redacted, and how it ended (a refusal included).
 *
 * The per-action `requireAdmin` (the `adminPanel` capability) still runs inside each body.
 */

/** Actions that only read; they leave no audit row. */
const READ_ONLY_ADMIN_ACTIONS: ReadonlySet<string> = new Set(['loadSessions', 'bookOfDryRun']);

/** A submitted field whose value is never written to the audit log. */
const SECRET_FIELD = /password|token|secret|api_?key|credential/i;

/** The fields that name what an action was aimed at, most specific first. */
const TARGET_FIELDS = [
	'userId',
	'sessionId',
	'projectKey',
	'project',
	'key',
	'clientKey',
	'role',
	'podId',
	'provider',
] as const;

/** Longest field value kept in the log; the rest is cut (a cost import's pasted text, a profile). */
const MAX_FIELD_LENGTH = 200;

export const REDACTED = '[redacted]';

export type AuditFields = Record<string, string | string[]>;

/** The submitted fields as the audit log keeps them: secrets redacted, files named, long values cut. */
export function auditFields(form: FormData): AuditFields {
	const out: AuditFields = {};
	for (const [name, value] of form.entries()) {
		const kept = SECRET_FIELD.test(name)
			? REDACTED
			: typeof value === 'string'
				? value.length > MAX_FIELD_LENGTH
					? `${value.slice(0, MAX_FIELD_LENGTH)}… (${value.length} chars)`
					: value
				: `[file ${value.name}, ${value.size} bytes]`;
		const prior = out[name];
		out[name] = prior === undefined ? kept : [...(Array.isArray(prior) ? prior : [prior]), kept];
	}
	return out;
}

/** `field=value` for the first target-naming field the form carries, or `null`. */
export function auditTarget(form: FormData): string | null {
	for (const field of TARGET_FIELDS) {
		const value = form.get(field);
		if (typeof value === 'string' && value.trim()) return `${field}=${value.trim()}`;
	}
	return null;
}

export type AuditOutcome =
	| { outcome: 'ok' }
	| { outcome: 'refused'; status: number }
	| { outcome: 'redirect'; status: number }
	| { outcome: 'error'; status?: number; message: string };

export interface AdminAuditEntry {
	actorId: string;
	action: string;
	target: string | null;
	details: { fields: AuditFields } & AuditOutcome;
}

/**
 * Append one audit row. A failed write is logged, never thrown: the action it describes has already
 * happened, and its answer must still reach the admin.
 */
export async function recordAdminAudit(entry: AdminAuditEntry): Promise<void> {
	try {
		await getDb().insert(adminAudit).values(entry);
	} catch (err) {
		console.error(`[adminAudit] could not record ${entry.action}:`, err);
	}
}

async function readForm(request: Request): Promise<FormData> {
	try {
		return await request.formData();
	} catch {
		return new FormData();
	}
}

function outcomeOfResult(result: unknown): AuditOutcome {
	return isActionFailure(result)
		? { outcome: 'refused', status: result.status }
		: { outcome: 'ok' };
}

function outcomeOfThrow(e: unknown): AuditOutcome {
	if (isRedirect(e)) return { outcome: 'redirect', status: e.status };
	if (isHttpError(e)) return { outcome: 'error', status: e.status, message: e.body.message };
	return { outcome: 'error', message: e instanceof Error ? e.message : String(e) };
}

const isOwnerOnly = (name: string): name is OwnerOnlyAdminAction =>
	(OWNER_ONLY_ADMIN_ACTIONS as readonly string[]).includes(name);

type AdminActionEvent = Pick<RequestEvent, 'request' | 'locals'>;

/**
 * Wrap the `/admin` actions table. Throws at load if an owner-only action is missing from it, so a
 * rename cannot quietly leave that action delegable.
 */
export function withAdminGuards<T extends Record<string, (event: never) => unknown>>(
	actions: T,
): T {
	for (const name of OWNER_ONLY_ADMIN_ACTIONS) {
		if (!Object.hasOwn(actions, name)) {
			throw new Error(`withAdminGuards: no "${name}" action to restrict to the owner`);
		}
	}

	const guarded: Record<string, (event: AdminActionEvent) => Promise<unknown>> = {};
	for (const [name, action] of Object.entries(actions)) {
		const run = action as (event: AdminActionEvent) => unknown;
		guarded[name] = async (event) => {
			const user = event.locals.user;
			if (!user) return run(event);

			const audited = !READ_ONLY_ADMIN_ACTIONS.has(name);
			const form = audited || isOwnerOnly(name) ? await readForm(event.request.clone()) : null;
			const audit = (outcome: AuditOutcome) =>
				form && audited
					? recordAdminAudit({
							actorId: user.id,
							action: name,
							target: auditTarget(form),
							details: { fields: auditFields(form), ...outcome },
						})
					: Promise.resolve();

			if (isOwnerOnly(name)) {
				const denial = ownerActionDenial(user.role, name, {
					actorId: user.id,
					userId: stringField(form, 'userId'),
					toolKey: stringField(form, 'toolKey'),
				});
				if (denial) {
					await audit({ outcome: 'refused', status: 403 });
					return fail(403, { action: name, error: denial });
				}
			}

			let result: unknown;
			try {
				result = await run(event);
			} catch (e) {
				await audit(outcomeOfThrow(e));
				throw e;
			}
			await audit(outcomeOfResult(result));
			return result;
		};
	}
	// Same keys; each wrapper takes its action's event and answers its results, or a refusal shaped
	// like the ones every action already returns (`{ action, error }`).
	return guarded as unknown as T;
}

function stringField(form: FormData | null, name: string): string | null {
	const value = form?.get(name);
	return typeof value === 'string' ? value : null;
}
