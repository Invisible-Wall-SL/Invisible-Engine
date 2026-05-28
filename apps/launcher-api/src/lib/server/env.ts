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
	get ORIGIN() {
		return env.ORIGIN ?? 'http://localhost:3010';
	},
	/** Session lifetime when "remember me" is checked (persistent cookie). */
	get REMEMBER_TTL_DAYS() {
		return Number(env.REMEMBER_TTL_DAYS ?? '30');
	},
	/** Session lifetime when "remember me" is unchecked (browser-session cookie). */
	get SESSION_TTL_HOURS() {
		return Number(env.SESSION_TTL_HOURS ?? '12');
	},
};
