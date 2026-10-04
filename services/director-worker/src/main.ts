import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadAgents, pricedModels } from './agents.ts';
import { describeEnv, readEnv } from './env.ts';
import { log } from './log.ts';
import { KNOWN_TOOLS } from './tools.ts';
import { startWake, type Wake } from './wake.ts';

/**
 * Invisible Director worker (ADR-0001). Boot order: environment, agent definitions (a bad one stops
 * the boot), the database and its wake-up listener, then `/healthz`.
 */

const root = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const env = readEnv();
log.info('boot', describeEnv(env));

const agents = loadAgents(root('agents'), {
	models: pricedModels(root('pricing.json')),
	tools: KNOWN_TOOLS,
});
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
		return postgres(url, {
			max: 4,
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

const sql = env.databaseUrl ? openDatabase(env.databaseUrl) : null;
let wake: Wake | null = null;
if (sql) {
	try {
		wake = await startWake(sql);
	} catch (error) {
		log.error('database unreachable at boot', { error });
		process.exit(1);
	}
} else {
	log.warn('DATABASE_URL is unset: no runs will be claimed');
}

/** 200 when the agents loaded and the database answers; 503 otherwise, naming which. */
const server = createServer((req, res) => {
	if (req.method === 'GET' && req.url === '/healthz') {
		const db = sql === null ? 'unconfigured' : wake?.healthy() ? 'up' : 'down';
		res.writeHead(db === 'up' ? 200 : 503, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: db === 'up', agents: agents.size, db, workerId: env.workerId }));
		return;
	}
	res.writeHead(404, { 'content-type': 'application/json' });
	res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(env.port, () => log.info('http listening', { port: env.port }));

async function shutdown(signal: string) {
	log.info('shutdown', { signal });
	server.close();
	try {
		await wake?.stop();
		await sql?.end({ timeout: 5 });
	} catch (error) {
		log.warn('shutdown: database already gone', { error });
	} finally {
		process.exit(0);
	}
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
