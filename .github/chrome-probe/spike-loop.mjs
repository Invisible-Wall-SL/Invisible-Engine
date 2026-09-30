// TEMPORARY (removed before merge): run every Chrome spike `rounds` times, `jobs` at once, and count
// launch retries, launch failures and spike failures from the helper's `[chrome]` lines.
import { spawn } from 'node:child_process';

const SPIKES = ['skins-panel', 'rig-switch', 'rigtext-panel', 'rigtext-browser', 'trimmesh'];
const ROUNDS = Number(process.argv[2] ?? 6);
const JOBS = Number(process.argv[3] ?? 5);
const queue = Array.from({ length: ROUNDS }, () => SPIKES).flat();

const stats = { runs: 0, failed: 0, retries: 0, launchFailures: 0, ready: [] };
const failures = [];
async function worker() {
	while (queue.length) {
		const spike = queue.shift();
		const out = await new Promise((done) => {
			const child = spawn(process.execPath, [`tools/rigger-spike/${spike}.mjs`], {
				env: { ...process.env, FORCE_COLOR: '0' },
			});
			let log = '';
			child.stdout.on('data', (d) => (log += d));
			child.stderr.on('data', (d) => (log += d));
			child.on('close', (code) => done({ code, log }));
		});
		stats.runs++;
		for (const [, ms] of out.log.matchAll(/\[chrome\] ready in (\d+) ms/g)) stats.ready.push(+ms);
		stats.retries += (out.log.match(/\[chrome\] launch attempt/g) ?? []).length;
		if (/Chrome did not start/.test(out.log)) stats.launchFailures++;
		if (out.code !== 0) {
			stats.failed++;
			failures.push(`${spike}:\n${out.log.split('\n').slice(-25).join('\n')}`);
		}
		console.log(`${out.code === 0 ? '✓' : '✗'} ${spike}`);
	}
}
await Promise.all(Array.from({ length: JOBS }, worker));
const r = stats.ready.sort((a, b) => a - b);
console.log(
	`\nruns=${stats.runs} failed=${stats.failed} launchRetries=${stats.retries} launchFailures=${stats.launchFailures} ready p50=${r[r.length >> 1]} max=${r.at(-1)}`,
);
for (const f of failures) console.log(`\n--- ${f}`);
process.exit(stats.failed ? 1 : 0);
