import { Resend } from 'resend';
import { ENV } from './env';

let instance: Resend | null = null;

function getResend(): Resend {
	if (!instance) instance = new Resend(ENV.RESEND_API_KEY);
	return instance;
}

export async function sendMagicLink(email: string, link: string): Promise<void> {
	const { error } = await getResend().emails.send({
		from: `${ENV.AUTH_FROM_NAME} <${ENV.AUTH_FROM_EMAIL}>`,
		to: email,
		subject: 'Your Invisible Wall sign-in link',
		text: `Sign in to the Invisible Wall launcher:\n\n${link}\n\nThis link expires in ${ENV.MAGIC_LINK_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email.`,
		html: `
			<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
				<h2 style="margin-bottom: 8px;">Sign in to Invisible Wall</h2>
				<p style="color: #555;">Click the button below to sign in to the launcher.</p>
				<p style="margin: 24px 0;">
					<a href="${link}" style="background: #6b5bff; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; display: inline-block;">Sign in</a>
				</p>
				<p style="color: #888; font-size: 13px;">This link expires in ${ENV.MAGIC_LINK_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email.</p>
			</div>
		`,
	});

	if (error) throw new Error(`Failed to send magic link: ${error.message}`);
}
