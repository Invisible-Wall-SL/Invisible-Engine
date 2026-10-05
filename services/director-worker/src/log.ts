/**
 * Structured logs: one JSON object per line on stdout (stderr for errors), which Railway's log view
 * indexes by field. Never pass a secret as a field — `env.ts` keeps them out of reach by handing the
 * rest of the worker only whether each one is set.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

function write(level: Level, msg: string, fields: LogFields): void {
	const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...fields }, (_k, v) =>
		v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
	);
	(level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
	debug: (msg: string, fields: LogFields = {}) => write('debug', msg, fields),
	info: (msg: string, fields: LogFields = {}) => write('info', msg, fields),
	warn: (msg: string, fields: LogFields = {}) => write('warn', msg, fields),
	error: (msg: string, fields: LogFields = {}) => write('error', msg, fields),
};
