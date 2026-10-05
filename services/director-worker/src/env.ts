/**
 * The worker's environment (docs/INFRA.md § "Invisible Director worker"). Read once, here. The two
 * secrets stay inside this module's return value: anything logged about them is `*Set` booleans.
 */
export interface WorkerEnv {
	port: number;
	/** Postgres shared with the launcher; unset only in local runs without a database. */
	databaseUrl: string | null;
	/** Read but unused until the turn loop (PLAN 3.4). */
	anthropicApiKey: string | null;
	/** Bearer token for the launcher's adapter gate; unused until the turn loop calls adapters. */
	directorServiceToken: string | null;
	/** This process's lease-holder id: Railway's replica id when present, else host + pid. */
	workerId: string;
}

const nonEmpty = (value: string | undefined) => (value && value.trim() ? value : null);

export function readEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
	const port = Number(env.PORT ?? 8080);
	if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT is not a port: ${env.PORT}`);
	const replica = nonEmpty(env.RAILWAY_REPLICA_ID);
	return {
		port,
		databaseUrl: nonEmpty(env.DATABASE_URL),
		anthropicApiKey: nonEmpty(env.ANTHROPIC_API_KEY),
		directorServiceToken: nonEmpty(env.DIRECTOR_SERVICE_TOKEN),
		workerId: `${replica ?? env.HOSTNAME ?? 'local'}:${process.pid}`,
	};
}

/** What may be logged about the environment. */
export function describeEnv(env: WorkerEnv) {
	return {
		port: env.port,
		workerId: env.workerId,
		databaseUrlSet: env.databaseUrl !== null,
		anthropicApiKeySet: env.anthropicApiKey !== null,
		directorServiceTokenSet: env.directorServiceToken !== null,
	};
}
