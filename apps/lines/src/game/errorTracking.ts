import { dev } from '$app/environment';
import { addSensitiveParam, initErrorTracking } from 'error-tracking';
import {
	deliveryAllowsErrorReporting,
	getDeliveryProfile,
	getDeliveryProfileSource,
} from 'delivery-profile';
import { PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_SAMPLE_RATE } from 'envs';

const sampleRate = (): number => {
	const rate = Number.parseFloat(PUBLIC_SENTRY_SAMPLE_RATE ?? '');
	return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1;
};

/** The runtime this bundle is: the commit prefix a runtime release names its `_runtime/<id>@<version>`
 *  after, else the version a desktop build stamps. */
const runtimeId = (): string | undefined => {
	if (typeof __IE_BUILD__ === 'undefined') return undefined;
	return __IE_BUILD__.sha?.slice(0, 12) || __IE_BUILD__.version || undefined;
};

/**
 * Start error reporting for this boot. Called first thing in the layout `load`, so the SDK is on its
 * way before the runtime-bundle fetch — the part of the boot most likely to fail.
 *
 * Inert unless the BUILD carries `PUBLIC_SENTRY_DSN`, and, for a delivery, unless its baked profile
 * opted in (`telemetry.errors`). The DSN test is what keeps the SDK out of a build without one: the
 * value is static, so the bundler drops the whole call — and with it the SDK import — when it is
 * empty.
 *
 * Not awaited: a slow or blocked SDK must never cost the boot. Captures made before it lands queue.
 */
export function startErrorTracking(): void {
	if (!PUBLIC_SENTRY_DSN || typeof window === 'undefined') return;
	if (!deliveryAllowsErrorReporting()) return;

	addSensitiveParam(getDeliveryProfile().session.param);
	const params = new URLSearchParams(window.location.search);
	const runtimeBoot = params.get('runtime') === '1';
	const runtime = runtimeId();
	void initErrorTracking({
		dsn: PUBLIC_SENTRY_DSN,
		environment: dev ? 'dev' : 'production',
		release: runtime,
		sampleRate: sampleRate(),
		tags: {
			runtime,
			// A published game is served at `<games host>/<gameKey>/`; only then is the first path
			// segment ours to read — a delivery's path is the operator's.
			game: runtimeBoot ? window.location.pathname.split('/').filter(Boolean)[0] : undefined,
			project: params.get('project') ?? undefined,
			profile: getDeliveryProfile().id,
			profile_source: getDeliveryProfileSource(),
			authoring: params.get('ie_authoring') === '1' ? 'yes' : undefined,
		},
	});
}
