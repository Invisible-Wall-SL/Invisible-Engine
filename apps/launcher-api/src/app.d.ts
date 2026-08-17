import type { Role } from '$lib/roles';

declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				email: string;
				name: string | null;
				role: Role;
			} | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		/** The shell's CRT boot splash (`static/shared/boot-splash.js`) — present only on a hard
		 *  load of a tool page, injected by `hooks.server.ts`. */
		IWBoot?: { done: () => void; dismiss: () => void };
	}
}

export {};
