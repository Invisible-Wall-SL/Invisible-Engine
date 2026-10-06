/**
 * What `/healthz` answers. Liveness, not readiness: 200 means the process is up and its run tables
 * answer, whether or not runs are being driven. "Not driving" — `ANTHROPIC_API_KEY` or
 * `DIRECTOR_SERVICE_TOKEN` unset at boot, so the wake loop never started — is a configuration state
 * the owner reads off the body (`driving: false`), not a failed deploy: answered as a 503 it had
 * Railway refuse every image until both secrets existed, while the build that was running could not
 * say "up but idle". A 503 is kept for what a deploy must not hide — no `DATABASE_URL`, or a
 * database (or schema) that does not answer — so Railway then keeps the previous worker.
 */

export interface HealthState {
	/** `DATABASE_URL` is set. */
	configured: boolean;
	/** The wake loop runs: both secrets were set at boot. */
	driving: boolean;
	/** The run tables answered: the last sweep when driving, a read-only probe when not. */
	dbUp: boolean;
}

export interface HealthReport {
	status: 200 | 503;
	body: {
		ok: boolean;
		db: 'up' | 'down' | 'unconfigured';
		driving: boolean;
		agents: number;
		workerId: string;
	};
}

export function healthReport(
	state: HealthState,
	info: { agents: number; workerId: string },
): HealthReport {
	const db = !state.configured ? 'unconfigured' : state.dbUp ? 'up' : 'down';
	const ok = db === 'up';
	return {
		status: ok ? 200 : 503,
		body: {
			ok,
			db,
			driving: state.configured && state.driving,
			agents: info.agents,
			workerId: info.workerId,
		},
	};
}
