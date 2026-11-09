/**
 * The longest password the launcher accepts — at sign-in, and when one is set. Sign-in is open to
 * the internet and runs scrypt over whatever it is sent, so a request is refused on length before
 * any of that work; no real passphrase comes near the limit. Kept apart from `passwordPolicy.ts`
 * (whose minimum sign-in must never apply) and shared by both, so a password that can be set can
 * always be used to sign in.
 */
export const MAX_PASSWORD_LENGTH = 256;

export function passwordTooLong(password: string): boolean {
	return password.length > MAX_PASSWORD_LENGTH;
}
