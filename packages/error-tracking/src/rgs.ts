import { captureError } from './browser';

const MAX_REASON = 200;

const text = (value: unknown): string | undefined => {
	if (typeof value === 'string' && value.trim()) return value.trim().slice(0, MAX_REASON);
	if (typeof value === 'object' && value !== null) {
		return text((value as { error?: unknown }).error);
	}
	return undefined;
};

const statusCodeOf = (failure: Record<string, unknown>): string | undefined => {
	const status = failure.status;
	if (typeof status !== 'object' || status === null) return undefined;
	const code = (status as { statusCode?: unknown }).statusCode;
	return typeof code === 'string' && code ? code : undefined;
};

/**
 * Report an RGS call that failed, at the one place the engine gives up on it — the boot's
 * authenticate, a spin's bet, a round's end — so a failure is one event, whichever transport made
 * the call and however many requests it took.
 *
 * `failure` is what the engine caught: a thrown `Error` (the network, a bad parse) is reported as
 * itself; anything else is the transport's error RESULT (`{ status: { statusCode }, error }`), of
 * which only the status code and the short reason are kept. The rest of such an object — a
 * `message` that serialises the whole response, a session snapshot — never reaches the report.
 *
 * Grouped by action + status, not by stack: every result-shaped failure is raised from here, so a
 * stack would fold an insufficient-balance refusal and a 502 into one issue.
 */
export function captureRgsFailure(action: string, failure: unknown): void {
	if (failure instanceof Error) {
		captureError(failure, { tags: { area: 'rgs', action, status: 'exception' } });
		return;
	}
	const record =
		typeof failure === 'object' && failure !== null ? (failure as Record<string, unknown>) : {};
	const status = statusCodeOf(record) ?? 'none';
	const reason = text(record.error) ?? (typeof failure === 'string' ? text(failure) : undefined);
	captureError(new Error(`RGS ${action} failed: ${reason ?? status}`), {
		tags: { area: 'rgs', action, status },
		fingerprint: ['rgs', action, status],
	});
}
