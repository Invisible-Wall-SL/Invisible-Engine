import { getRunpodIdleConfig } from './appSettings';
import {
	comfyQueueBusy,
	getEffectiveFleet,
	podControlConfigured,
	podStatus,
	podStop,
} from './runpod';
import { lastActivity, leaseActive, markActivity } from './runpodActivity';

/**
 * Idle auto-stop watchdog for the ComfyUI R&D pod FLEET. Started ONCE from
 * `hooks.server.ts#init`, it wakes every ~60s and — only when pod control is
 * configured AND an admin has enabled idle auto-stop — stops any running pod that's
 * gone idle so the GPU stops billing.
 *
 * Reclaiming a GPU is destructive: it drops the artist's ComfyUI session and kills
 * whatever it was rendering. So the bar for stopping is deliberately high — a pod is
 * stopped only when EVERY hold below is clear:
 *
 * 1. **A session lease.** Opening ComfyUI moves the artist to another tab, which
 *    silences the launcher's visibility-gated heartbeat exactly when the pod is being
 *    used. The lease is the stand-in for that heartbeat, and it also covers the long
 *    stretch where a network is being BUILT — real work that leaves the queue empty.
 * 2. **A busy or unreachable ComfyUI.** `comfyQueueBusy` returns `null` when it could
 *    not tell; unknown is treated as busy, never as idle. ComfyUI goes silent while it
 *    loads a model or decodes, and a stop on that silence kills the render.
 * 3. **The idle window**, then `IDLE_TICKS_REQUIRED` CONSECUTIVE confirmations of it.
 *    One unlucky sample must never be able to reclaim a GPU that's mid-session.
 *
 * The whole loop is wrapped in try/catch so it can never crash the server, and a module
 * singleton flag ensures it starts once. The timer resets on redeploy — that just
 * grants a fresh idle window, which is acceptable.
 */

let started = false;
const TICK_MS = 60_000;
/** Consecutive confirmed-idle ticks required before a pod is actually stopped. */
const IDLE_TICKS_REQUIRED = 3;

let idleTicks = 0;

export function startRunpodIdleWatchdog(): void {
	if (started) return;
	started = true;

	const timer = setInterval(() => {
		void tick();
	}, TICK_MS);
	// Don't hold the event loop open for the watchdog alone.
	if (typeof timer.unref === 'function') timer.unref();
}

async function tick(): Promise<void> {
	try {
		if (!(await podControlConfigured())) return;
		const { enabled, minutes } = await getRunpodIdleConfig();
		if (!enabled) {
			idleTicks = 0;
			return;
		}

		const fleet = await getEffectiveFleet();
		const statuses = await Promise.all(fleet.map((p) => podStatus(p.id)));
		const running = fleet.filter((_, i) => statuses[i] === 'running');
		if (!running.length) {
			idleTicks = 0;
			return;
		}

		// Hold 1 — an open ComfyUI session. Bump the clock too, so the idle countdown
		// starts when the lease EXPIRES rather than when it was granted.
		if (leaseActive()) {
			idleTicks = 0;
			markActivity();
			return;
		}

		// Hold 2 — queued work on ANY running pod, or a pod we could not reach at all.
		// `q !== false` deliberately covers `null`: only a CONFIRMED empty queue is idle.
		const queue = await Promise.all(running.map((p) => comfyQueueBusy(p.url)));
		if (queue.some((q) => q !== false)) {
			idleTicks = 0;
			markActivity();
			return;
		}

		// Hold 3 — the idle window, then several consecutive confirmations of it.
		if (Date.now() - lastActivity() <= minutes * 60_000) {
			idleTicks = 0;
			return;
		}
		if (++idleTicks < IDLE_TICKS_REQUIRED) return;

		// Nothing is holding the fleet — stop every running pod, then reset so we don't
		// hammer stop before RunPod reflects it.
		for (let i = 0; i < fleet.length; i++) {
			if (statuses[i] === 'running') await podStop(fleet[i].id);
		}
		idleTicks = 0;
		markActivity();
	} catch {
		// Fail-safe: a watchdog error must never crash the server or block the next tick.
	}
}
