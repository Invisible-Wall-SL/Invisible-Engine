#!/usr/bin/env node
/**
 * Tell "the games are broken" apart from "this network cannot reach them".
 *
 *   node scripts/check-games-reachability.mjs [host]   (default games.invisiblewall.org)
 *
 * Spanish ISPs null-route individual Cloudflare anycast IPs under the LaLiga
 * anti-piracy orders. Those IPs are shared by thousands of zones, so ours goes
 * dark with nothing deployed and no error anywhere — a bare TCP timeout that
 * looks exactly like a broken engine release. See docs/INFRA.md → DNS.
 *
 * The trick this script leans on: any Cloudflare edge IP serves any proxied
 * zone (SNI does the routing). So if the IPs DNS hands us are dead but the same
 * request succeeds through a different edge IP, the platform is healthy and the
 * local network is at fault.
 */
import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';

const HOST = process.argv[2] ?? 'games.invisiblewall.org';
const CONNECT_TIMEOUT_MS = 3000;
const FETCH_TIMEOUT_MS = 15000;

/** Cloudflare edge IPs to fall back to, spread across ranges so one blocklist can't cover them all. */
const EDGE_CANDIDATES = [
	'188.114.96.1',
	'188.114.96.9',
	'104.16.123.96',
	'104.21.1.1',
	'172.67.1.1',
];

/** Resolve via a public resolver too — a local resolver can lie, and we want to know if it does. */
async function resolveA(host) {
	const system = await new Resolver().resolve4(host).catch(() => []);
	const cf = new Resolver();
	cf.setServers(['1.1.1.1']);
	const public4 = await cf.resolve4(host).catch(() => []);
	return { system, public4 };
}

function tcpOk(ip, port = 443) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		const done = (ok) => {
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(CONNECT_TIMEOUT_MS);
		socket.once('connect', () => done(true));
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false));
		socket.connect(port, ip);
	});
}

/** GET `https://host/path` but forced over `ip`, keeping SNI + Host as `host`. */
function fetchVia(ip, host, path) {
	return new Promise((resolve) => {
		const req = https.request(
			{
				host,
				servername: host,
				path,
				method: 'GET',
				timeout: FETCH_TIMEOUT_MS,
				// Node calls this with `all: true` on some paths and wants an array back then.
				lookup: (_h, opts, cb) =>
					opts?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4),
			},
			(res) => {
				let bytes = 0;
				res.on('data', (c) => (bytes += c.length));
				res.on('end', () => resolve({ status: res.statusCode, bytes, headers: res.headers }));
			},
		);
		req.on('timeout', () => {
			req.destroy();
			resolve({ error: 'timeout' });
		});
		req.on('error', (e) => resolve({ error: e.message }));
		req.end();
	});
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const { system, public4 } = await resolveA(HOST);
if (system.length === 0 && public4.length === 0) {
	console.error(`✗ ${HOST} does not resolve at all. That is DNS, not reachability.`);
	process.exit(2);
}

const dnsIps = system.length > 0 ? system : public4;
console.log(`${HOST} resolves to: ${dnsIps.join(', ')}`);
if (system.length > 0 && public4.length > 0 && system.join() !== public4.join()) {
	console.log(`  note: 1.1.1.1 disagrees — it returns ${public4.join(', ')}`);
}

console.log('\nTCP :443 to the IPs DNS gave us');
const reachable = [];
for (const ip of dnsIps) {
	const ok = await tcpOk(ip);
	if (ok) reachable.push(ip);
	console.log(`  ${ip.padEnd(16)} ${ok ? 'open' : 'BLOCKED (no response)'}`);
}

if (reachable.length > 0) {
	const res = await fetchVia(reachable[0], HOST, '/');
	if (res.error) {
		console.log(`\n✗ Connects, but the request failed: ${res.error}`);
		console.log('  The network is fine — look at the service.');
		process.exit(1);
	}
	console.log(`\n✓ Reachable. GET / → ${res.status}, ${kb(res.bytes)}.`);
	console.log('  Nothing network-level is wrong. A broken game is a real bug — go debug it.');
	process.exit(res.status >= 500 ? 1 : 0);
}

// Every IP DNS gave us is dead. Is the origin dead, or just our path to it?
console.log('\nEvery IP is unreachable. Retrying through other Cloudflare edge IPs');
for (const ip of EDGE_CANDIDATES) {
	if (dnsIps.includes(ip)) continue;
	if (!(await tcpOk(ip))) {
		console.log(`  ${ip.padEnd(16)} blocked too, skipping`);
		continue;
	}
	const res = await fetchVia(ip, HOST, '/');
	if (res.error) {
		console.log(`  ${ip.padEnd(16)} open, but request failed: ${res.error}`);
		continue;
	}
	console.log(
		`  ${ip.padEnd(16)} → ${res.status}, ${kb(res.bytes)} (via ${res.headers['x-railway-edge'] ?? 'origin'})`,
	);
	console.log(`\n✓ THE PLATFORM IS HEALTHY. Your network cannot reach the IPs DNS hands you.`);
	console.log(`  This is an ISP-level block on shared Cloudflare addresses — not our bug, not our`);
	console.log(`  deploy, and not fixable by re-publishing or re-running the runtime release.`);
	console.log(`\n  Unblock this machine (admin PowerShell), then hard-refresh:`);
	console.log(
		`    Add-Content -Path "$env:SystemRoot\\System32\\drivers\\etc\\hosts" -Value "\`n${ip} ${HOST}" -Encoding utf8`,
	);
	console.log(`\n  Permanent fix + why this happens: docs/INFRA.md → DNS (Cloudflare).`);
	process.exit(3);
}

console.log(`\n✗ No Cloudflare edge IP was reachable either.`);
console.log('  Either this machine has no working internet, or the block is very wide.');
console.log('  Check a non-Cloudflare host before concluding anything about the games.');
process.exit(2);
