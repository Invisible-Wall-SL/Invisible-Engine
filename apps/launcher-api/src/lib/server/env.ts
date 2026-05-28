import { env } from '$env/dynamic/private';

function required(name: string): string {
	const value = env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

export const ENV = {
	get DATABASE_URL() {
		return required('DATABASE_URL');
	},
	get RESEND_API_KEY() {
		return required('RESEND_API_KEY');
	},
	get AUTH_FROM_EMAIL() {
		return env.AUTH_FROM_EMAIL ?? 'auth@invisiblewall.org';
	},
	get AUTH_FROM_NAME() {
		return env.AUTH_FROM_NAME ?? 'Invisible Wall';
	},
	get ORIGIN() {
		return env.ORIGIN ?? 'http://localhost:3010';
	},
	get MAGIC_LINK_TTL_MINUTES() {
		return Number(env.MAGIC_LINK_TTL_MINUTES ?? '15');
	},
	get SESSION_TTL_DAYS() {
		return Number(env.SESSION_TTL_DAYS ?? '30');
	},
};
