import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadAgents, pricedModels } from './agents.ts';
import { driveRun } from './driver.ts';
import { describeEnv, readEnv } from './env.ts';
import { httpLauncher } from './launcher.ts';
import { log } from './log.ts';
import { anthropicTransport, modelProfile } from './model.ts';
import { pricingSource } from './pricing.ts';
import { KNOWN_TOOLS } from './tools.ts';
import { CONCURRENCY, startWake, type Wake } from './wake.ts';

/**
 * Invisible Director worker (ADR-0001). Boot order: environment, agent definitions (a bad one stops
 * the boot), the database and its wake-up listener, then `/healthz`. Runs are driven only when the
 * Anthropic key and the launcher's service token are both set.
 */

const root = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const env = readEnv();
log.info('boot', describeEnv(env));

const agents = loadAgents(root('agents'), {
	models: pricedModels(root('pricing.json')),
	tools: KNOWN_TOOLS,
});
for (const agent of agents.values()) modelProfile(agent.model);
log.info('agents loaded', {
	agents: [...agents.values()].map((a) => ({
		name: a.name,
		model: a.model,
		tools: a.tools.length,
	})),
});

/** Never log the error itself: a malformed URL's error carries the URL, password included. */
function openDatabase(url: string) {
	try {
		// Each drive holds at most one connection in a transaction; the rest is for its other queries,
		// lease renewals and the sweep.
		return postgres(url, {
			max: CONCURRENCY * 2 + 2,
			onnotice: () => {},
			connection: { application_name: 'director-worker' },
		});
	} catch (error) {
		log.error('DATABASE_URL is not a valid connection string', {
			code: (error as { code?: unknown }).code ?? null,
		});
		process.exit(1);
	}
}

/** How long a shutdown lets turns in flight finish before it stops them (Railway's SIGTERM). */
const SHUTDOWN_GRACE_MS = 20_000;

const sql = env.databaseUrl ? openDatabase(env.databaseUrl) : null;
const shuttingDown = new AbortController();
let wake: Wake | null = null;
if (!sql) log.warn('DATABASE_URL is unset: no runs will be claimed');
else if (!env.anthropicApiKey || !env.directorServiceToken) {
	log.warn('ANTHROPIC_API_KEY or DIRECTOR_SERVICE_TOKEN is unset: no runs will be claimed');
} else {
	const deps = {
		sql,
		transport: anthropicTransport(env.anthropicApiKey),
		launcher: httpLauncher(env.launcherUrl, env.directorServiceToken),
		agents,
		pricing: pricingSource(sql, root('pricing.json')),
		retries: new Map<string, number>(),
		shutdown: shuttingDown.signal,
	};
	try {
		wake = await startWake(sql, env.workerId, (claimed) => driveRun(deps, claimed));
	} catch (error) {
		log.error('database unreachable at boot', { error });
		process.exit(1);
	}
}

/** 200 when the agents loaded and the database answers; 503 otherwise, naming which. */
const server = createServer((req, res) => {
	if (req.method === 'GET' && req.url === '/healthz') {
		const db =
			sql === null
				? 'unconfigured'
				: wake === null
					? 'not_driving'
					: wake.healthy()
						? 'up'
						: 'down';
		res.writeHead(db === 'up' ? 200 : 503, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: db === 'up', agents: agents.size, db, workerId: env.workerId }));
		return;
	}
	res.writeHead(404, { 'content-type': 'application/json' });
	res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(env.port, () => log.info('http listening', { port: env.port }));

/**
 * Stop claiming, let the turns in flight finish (a model call cut off is billed only as far as it
 * streamed, and its turn runs again), then stop the rest: each gives its run back on the way out.
 */
async function shutdown(signal: string) {
	log.info('shutdown', { signal });
	server.close();
	try {
		await wake?.stop();
		await wake?.drain(SHUTDOWN_GRACE_MS);
		shuttingDown.abort(new Error(`worker shutting down (${signal})`));
		await wake?.drain(5_000);
		await sql?.end({ timeout: 5 });
	} catch (error) {
		log.warn('shutdown: database already gone', { error });
	} finally {
		process.exit(0);
	}
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
