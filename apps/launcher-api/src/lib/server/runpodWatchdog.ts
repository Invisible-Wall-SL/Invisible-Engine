import { getRunpodIdleConfig } from './appSettings';
import {
	comfyQueueBusy,
	getEffectiveFleet,
	podControlConfigured,
	podStatus,
	podStop,
} from './runpod';
import { lastActivity, markActivity } from './runpodActivity';

/**
 * Idle auto-stop watchdog for the ComfyUI R&D pod FLEET. Started ONCE from
 * `hooks.server.ts#init`, it wakes every ~60s and — only when pod control is
 * configured AND an admin has enabled idle auto-stop — stops any running pod that's
 * gone idle so the GPU stops billing.
 *
 * Iterates the effective fleet (usually one pod runs at a time, but iterating is
 * correct either way). Never stops mid-render: a non-empty ComfyUI queue on ANY running
 * pod counts as fleet activity (bumps the shared heartbeat). Only when no pod is busy
 * AND `now - lastActivity() > minutes` does it stop the running pods. The whole loop is
 * wrapped in try/catch so it can never crash the server, and a module singleton flag
 * ensures it starts once. The timer resets on redeploy — that just grants a fresh idle
 * window, which is acceptable.
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
		if (!(await podControlConfigured())) return;
		const { enabled, minutes } = await getRunpodIdleConfig();
		if (!enabled) return;

		const fleet = await getEffectiveFleet();
		const statuses = await Promise.all(fleet.map((p) => podStatus(p.id)));

		// Pass 1: a live render (or queued work) on ANY running pod is fleet activity —
		// bump the shared heartbeat so we never stop a pod that's mid-job.
		const busy = await Promise.all(
			fleet.map((p, i) => (statuses[i] === 'running' ? comfyQueueBusy(p.url) : Promise.resolve(false))),
		);
		if (busy.some(Boolean)) {
			markActivity();
			return;
		}

		// Pass 2: nothing is rendering — if we're past the idle window, stop every
		// running pod, then reset so we don't hammer stop before RunPod reflects it.
		if (Date.now() - lastActivity() > minutes * 60_000) {
			for (let i = 0; i < fleet.length; i++) {
				if (statuses[i] === 'running') await podStop(fleet[i].id);
			}
			markActivity();
		}
	} catch {
		// Fail-safe: a watchdog error must never crash the server or block the next tick.
	}
}
