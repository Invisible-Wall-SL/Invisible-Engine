import { getRunpodIdleConfig } from './appSettings';
import { comfyQueueBusy, podControlConfigured, podStatus, podStop } from './runpod';
import { lastActivity, markActivity } from './runpodActivity';

/**
 * Idle auto-stop watchdog for the ComfyUI R&D pod. Started ONCE from
 * `hooks.server.ts#init`, it wakes every ~60s and — only when pod control is
 * configured AND an admin has enabled idle auto-stop — checks whether the pod has
 * gone idle and, if so, STOPS it so the GPU stops billing.
 *
 * Never stops mid-render: a non-empty ComfyUI queue counts as activity (bumps the
 * heartbeat). Only when the queue is empty AND `now - lastActivity() > minutes` does
 * it stop. The whole loop is wrapped in try/catch so it can never crash the server,
 * and a module singleton flag ensures it starts once. The timer resets on redeploy —
 * that just grants a fresh idle window, which is acceptable.
 */

let started = false;
const TICK_MS = 60_000;

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
		if (!podControlConfigured()) return;
		const { enabled, minutes } = await getRunpodIdleConfig();
		if (!enabled) return;

		const status = await podStatus();
		if (status !== 'running') return;

		// A live render (or queued work) is activity — bump the heartbeat and bail so
		// we never stop a pod that's mid-job.
		if (await comfyQueueBusy()) {
			markActivity();
			return;
		}

		const idleMs = Date.now() - lastActivity();
		if (idleMs > minutes * 60_000) {
			await podStop();
			// Reset so we don't hammer stop each tick before RunPod reflects the change.
			markActivity();
		}
	} catch {
		// Fail-safe: a watchdog error must never crash the server or block the next tick.
	}
}
