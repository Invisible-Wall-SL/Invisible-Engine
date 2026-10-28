// The game server `scripts/room-load.mjs` measures, in a process of its own so the bots' CPU is not
// counted against it: `services/game-server` as `main.ts` runs it, from a config directory, with
// the per-address limits raised (every bot shares one address) and every room step timed. Each
// second it tells its parent (IPC) what it did: the steps, their times, its CPU and memory.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/room-load-server.mjs <configDir> <port>

import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createGameServer } from '../services/game-server/src/server.ts';

const [dir, port] = process.argv.slice(2);
let times = [];
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 4,
	commit: 'room-load',
	gracefullyShutdown: false,
	matchmakePerWindow: 10_000,
	perAddress: { sockets: 10_000, upgrades: 10_000 },
	onStep: (ms) => times.push(ms),
});
await server.listen(Number(port));

let cpu = process.cpuUsage();
let at = performance.now();
setInterval(() => {
	const now = performance.now();
	const used = process.cpuUsage(cpu);
	cpu = process.cpuUsage();
	const memory = process.memoryUsage();
	process.send?.({
		elapsedMs: now - at,
		cpuMs: (used.user + used.system) / 1000,
		steps: times,
		rssMb: memory.rss / 2 ** 20,
		heapMb: memory.heapUsed / 2 ** 20,
	});
	at = now;
	times = [];
}, 1000).unref();
process.send?.({ ready: true });
process.on('disconnect', () => process.exit(0));
