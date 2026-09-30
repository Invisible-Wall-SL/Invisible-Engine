// TEMPORARY (removed before merge): how long the OLD spike launch takes to print its DevTools URL on
// the CI runner. Launches `pairs` pairs of Chrome at once, exactly as the spikes did, waits up to
// 90 s for the endpoint, and prints the distribution plus stderr for every launch over 20 s.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH;
const PAIRS = Number(process.argv[2] ?? 20);
const LOAD = process.argv.includes('--load');
const COLD = process.argv.includes('--cold');
const IO = process.argv.includes('--io');

function launchOnce(tag) {
	const profile = mkdtempSync(join(tmpdir(), `probe-${tag}-`));
	const began = Date.now();
	const chrome = spawn(
		CHROME,
		[
			'--headless',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`,
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--use-gl=angle',
			'--use-angle=swiftshader',
			'--enable-unsafe-swiftshader',
			'--window-size=1600,1000',
			'about:blank',
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let buf = '';
	return new Promise((done) => {
		const finish = (ms) => {
			clearTimeout(t);
			chrome.kill('SIGKILL');
			setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
			done({ ms, stderr: buf });
		};
		const t = setTimeout(() => finish(null), 90_000);
		chrome.stderr.on('data', (c) => {
			buf += c;
			if (/ws:\/\/\S+\/devtools\/browser\/\S+/.test(buf)) finish(Date.now() - began);
		});
		chrome.on('exit', (code) => buf.includes('ws://') || finish(`exit ${code}`));
	});
}

const burn = LOAD
	? Array.from({ length: 2 }, () =>
			spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }),
		)
	: [];
// Disk contention like a check-all shard's: other processes reading many cold files at once.
const io = IO
	? spawn('sh', ['-c', 'while :; do find /usr /opt -xdev -type f -size +200k 2>/dev/null | xargs cat > /dev/null 2>&1; done'], { stdio: 'ignore', detached: true })
	: null;
const results = [];
for (let i = 0; i < PAIRS; i++) {
	if (COLD) execSync('sync && echo 3 | sudo tee /proc/sys/vm/drop_caches > /dev/null');
	const pair = await Promise.all([launchOnce(`a${i}`), launchOnce(`b${i}`)]);
	results.push(...pair);
	await new Promise((r) => setTimeout(r, 300));
}
for (const b of burn) b.kill();
if (io) process.kill(-io.pid, 'SIGKILL');

const times = results.map((r) => r.ms).filter((m) => typeof m === 'number').sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
console.log(`times: ${results.map((r) => r.ms).join(' ')}`);
console.log(
	`launches=${results.length} load=${LOAD} cold=${COLD} io=${IO} ok=${times.length} p50=${pct(50)} p90=${pct(90)} p99=${pct(99)} max=${times.at(-1)} over20s=${results.filter((r) => typeof r.ms !== 'number' || r.ms > 20_000).length}`,
);
for (const r of results)
	if (typeof r.ms !== 'number' || r.ms > 20_000)
		console.log(`\n--- slow/failed launch: ${r.ms}\n${r.stderr.slice(-3000)}`);
