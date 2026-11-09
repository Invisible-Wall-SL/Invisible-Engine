import { MAX_PASSWORD_LENGTH, passwordTooLong } from './passwordLimit';

/**
 * The rule for a NEW password — set by an admin (create / reset) or by the user on
 * `/account/password`. Length only, no composition rules. It is never applied at sign-in: a
 * password set under an older, shorter minimum keeps working.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Why `password` is too short (or too long) to set, or `null` when its length is acceptable. */
export function passwordLengthProblem(password: string): string | null {
	if (password.length < MIN_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
	}
	if (passwordTooLong(password)) {
		return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
	}
	return null;
}

export interface PasswordChange {
	/** The current password as typed. */
	current: string;
	next: string;
	confirm: string;
	/** The account's email, which the new password must not be. */
	email: string;
}

/** Why a self-service change cannot go ahead, or `null` when the new password is acceptable. */
export function passwordChangeProblem({
	current,
	next,
	confirm,
	email,
}: PasswordChange): string | null {
	if (!current) return 'Enter your current password.';
	if (next !== confirm) return 'The new passwords do not match.';
	const tooShort = passwordLengthProblem(next);
	if (tooShort) return tooShort;
	if (next === current) return 'The new password must be different from the current one.';
	if (next.trim().toLowerCase() === email.trim().toLowerCase()) {
		return 'The new password must not be your email address.';
	}
	return null;
}
