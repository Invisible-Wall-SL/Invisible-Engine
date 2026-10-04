import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { appSettings } from './db/schema';
import { ENV } from './env';

/** Settings key for the shared build/deploy token (overrides `EDITOR_DOC_SECRET`). */
export const DEPLOY_TOKEN_KEY = 'deployToken';

/** Settings key: whether the ComfyUI R&D pod idle auto-stop watchdog is enabled ('1'/'0'). */
export const RUNPOD_IDLE_ENABLED_KEY = 'runpodIdleEnabled';
/** Settings key: minutes of no activity before the idle watchdog stops the pod. */
export const RUNPOD_IDLE_MINUTES_KEY = 'runpodIdleMinutes';
/** Default idle window (minutes) when the admin hasn't set one. */
export const RUNPOD_IDLE_MINUTES_DEFAULT = 20;
/**
 * Settings key: the admin-managed ComfyUI R&D pod FLEET, JSON `[{id,label}, …]`.
 * Each entry is a RunPod pod (different GPU card) the artist can pick from; the pod's
 * ComfyUI URL is DERIVED from its id (`podUrl` in `runpod.ts`), not stored. Empty/unset
 * falls back to the legacy single-pod env path (`RUNPOD_POD_ID`).
 */
export const RUNPOD_PODS_KEY = 'runpodPods';

/** Settings key: the Invisible Director per-run budget cap in USD (ADR-0006). */
export const DIRECTOR_RUN_BUDGET_KEY = 'DIRECTOR_RUN_BUDGET_USD';
/** Budget cap when the admin hasn't set one. */
export const DIRECTOR_RUN_BUDGET_DEFAULT_USD = 25;
/** Lowest cap a run can be given — below this a run would pause on its first call. */
export const DIRECTOR_RUN_BUDGET_MIN_USD = 1;
/** Highest cap Settings accepts, so a typo (2500 for 25.00) can't remove the guard. */
export const DIRECTOR_RUN_BUDGET_MAX_USD = 500;
/**
 * Settings key: an optional JSON override laid over `services/director-worker/pricing.json`
 * (same shape, every field optional). Unset means the file's prices apply.
 */
export const DIRECTOR_PRICING_OVERRIDE_KEY = 'directorPricingOverride';

/**
 * Read a single app setting's value, or `undefined` when unset. The value may be
 * a SECRET — only call from server code behind an admin/capability gate; never
 * surface it through a non-admin route.
 */
export async function getAppSetting(key: string): Promise<string | undefined> {
	const [row] = await getDb()
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, key));
	return row?.value;
}

/** Upsert an app setting, recording the admin who set it. */
export async function setAppSetting(key: string, value: string, userId: string): Promise<void> {
	await getDb()
		.insert(appSettings)
		.values({ key, value, updatedBy: userId })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value, updatedAt: new Date(), updatedBy: userId },
		});
}

/** Remove an app setting, so its reader falls back to the default. */
export async function deleteAppSetting(key: string): Promise<void> {
	await getDb().delete(appSettings).where(eq(appSettings.key, key));
}

/**
 * The effective shared build/deploy token: the DB-managed value if an admin has
 * set one, else the `EDITOR_DOC_SECRET` env var (the bootstrap default/fallback,
 * so today's prod keeps working with no DB row). `undefined`/empty when neither
 * is configured. Never log the result. A per-request DB read is intentional —
 * keep it simple; rotations take effect immediately for new builds.
 *
 * Fails SAFE: a DB read error (most importantly the `app_settings` table not yet
 * existing — there is no auto-migrate on deploy, so the new code can ship before
 * migration 0009 is applied) falls back to the env var instead of throwing, so
 * the token gates keep working through the deploy→migrate window. Logs the error
 * (never the token).
 */
export async function getDeployToken(): Promise<string | undefined> {
	try {
		const fromDb = await getAppSetting(DEPLOY_TOKEN_KEY);
		if (fromDb) return fromDb;
	} catch (err) {
		console.warn(
			'[appSettings] deploy-token DB read failed — falling back to EDITOR_DOC_SECRET ' +
				'(is migration 0009 / app_settings applied?):',
			err instanceof Error ? err.message : err,
		);
	}
	return ENV.EDITOR_DOC_SECRET || undefined;
}

/**
 * The effective ComfyUI R&D pod idle auto-stop config: `{ enabled, minutes }`. Idle is
 * OFF unless an admin has enabled it; the window defaults to `RUNPOD_IDLE_MINUTES_DEFAULT`
 * (20) and is clamped to a sane floor. Fails SAFE — a DB read error (e.g. `app_settings`
 * not yet migrated) degrades to disabled so the watchdog never acts on garbage. Never throws.
 */
export async function getRunpodIdleConfig(): Promise<{ enabled: boolean; minutes: number }> {
	try {
		const [enabledRaw, minutesRaw] = await Promise.all([
			getAppSetting(RUNPOD_IDLE_ENABLED_KEY),
			getAppSetting(RUNPOD_IDLE_MINUTES_KEY),
		]);
		const enabled = enabledRaw === '1';
		const parsed = Number(minutesRaw);
		const minutes =
			Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : RUNPOD_IDLE_MINUTES_DEFAULT;
		return { enabled, minutes };
	} catch (err) {
		console.warn(
			'[appSettings] runpod idle-config DB read failed — treating idle auto-stop as disabled:',
			err instanceof Error ? err.message : err,
		);
		return { enabled: false, minutes: RUNPOD_IDLE_MINUTES_DEFAULT };
	}
}

/**
 * Clamp a budget figure into `[DIRECTOR_RUN_BUDGET_MIN_USD, DIRECTOR_RUN_BUDGET_MAX_USD]`,
 * rounded to cents. `null` for anything that isn't a positive finite number.
 */
export function clampDirectorBudget(value: number): number | null {
	if (!Number.isFinite(value) || value <= 0) return null;
	const clamped = Math.min(
		DIRECTOR_RUN_BUDGET_MAX_USD,
		Math.max(DIRECTOR_RUN_BUDGET_MIN_USD, value),
	);
	return Math.round(clamped * 100) / 100;
}

/**
 * The Invisible Director per-run budget cap in USD (`DIRECTOR_RUN_BUDGET_USD`). Defaults to
 * `DIRECTOR_RUN_BUDGET_DEFAULT_USD` (25) when unset or unparseable, and is clamped to the
 * min/max above. A run copies this at start, so a change here never moves a running run.
 * Fails SAFE — a DB read error degrades to the default, never to "no cap". Never throws.
 */
export async function getDirectorRunBudget(): Promise<number> {
	try {
		const raw = await getAppSetting(DIRECTOR_RUN_BUDGET_KEY);
		if (raw === undefined || raw.trim() === '') return DIRECTOR_RUN_BUDGET_DEFAULT_USD;
		return clampDirectorBudget(Number(raw)) ?? DIRECTOR_RUN_BUDGET_DEFAULT_USD;
	} catch (err) {
		console.warn(
			'[appSettings] director budget DB read failed — using the default cap:',
			err instanceof Error ? err.message : err,
		);
		return DIRECTOR_RUN_BUDGET_DEFAULT_USD;
	}
}

/**
 * The admin-managed ComfyUI R&D pod FLEET (`runpodPods` = JSON `[{id,label}, …]`).
 * Fails SAFE — missing/blank value, malformed JSON, a non-array, or a DB read error all
 * degrade to `[]` (the caller then falls back to the legacy single-pod env path). Bad
 * entries (missing id) are dropped; a blank label defaults to the id. Never throws.
 */
export async function getRunpodPods(): Promise<{ id: string; label: string }[]> {
	try {
		const raw = await getAppSetting(RUNPOD_PODS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
			.filter((p) => typeof p.id === 'string' && (p.id as string).trim() !== '')
			.map((p) => {
				const id = (p.id as string).trim();
				const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : id;
				return { id, label };
			});
	} catch (err) {
		console.warn(
			'[appSettings] runpodPods read/parse failed — treating fleet as empty:',
			err instanceof Error ? err.message : err,
		);
		return [];
	}
}
