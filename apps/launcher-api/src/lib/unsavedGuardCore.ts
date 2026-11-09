import type { ConfirmOptions } from './dialogs.svelte';

/** The part of SvelteKit's `BeforeNavigate` the leave guard reads. */
export interface GuardedNavigation {
	willUnload: boolean;
	to: { url: URL } | null;
	delta?: number;
	cancel(): void;
}

export interface LeaveGuardDeps {
	ask: (question: ConfirmOptions) => Promise<boolean>;
	goto: (url: URL) => Promise<void>;
	historyGo: (delta: number) => void;
}

/** One dialog for every guard that has something at risk on the same navigation. */
export function combineQuestions(questions: readonly ConfirmOptions[]): ConfirmOptions {
	if (questions.length === 1) return questions[0];
	return {
		title: 'You have unsaved changes in more than one place',
		message: `${questions.map((q) => `• ${q.title}`).join('\n')}\n\nLeaving this page discards them all.`,
		confirmLabel: 'Leave anyway',
		danger: true,
	};
}

/**
 * The `beforeNavigate` half of {@link guardUnsavedWork}, free of Svelte and `$app` so a fixture can
 * drive it (`check:unsaved-guard`). See `unsavedGuard.ts` for why it cancels first and re-issues.
 *
 * It is ONE coordinator for every guard on the page, because a page can hold several (`/editor`:
 * the layout, each Timeline panel, the Components side). SvelteKit runs every `beforeNavigate`
 * callback, synchronously, with the same navigation object. With a ticket per guard, two dirty
 * guards each asked, and the navigation one re-issued was cancelled by the other, which asked
 * again and re-issued one the first cancelled — a loop the author could only leave by staying.
 * So the guards that see the same navigation share ONE question, and the re-issued navigation
 * carries ONE ticket every guard honours; it is spent once all of them have run.
 */
export function createLeaveGuard(deps: LeaveGuardDeps) {
	let approved = false;
	let gathering: { navigation: GuardedNavigation; questions: ConfirmOptions[] } | null = null;

	return function check<N extends GuardedNavigation>(
		navigation: N,
		cost: () => ConfirmOptions | null,
		handledElsewhere?: (navigation: N) => boolean,
	): void {
		if (approved) {
			queueMicrotask(() => (approved = false));
			return;
		}
		if (navigation.willUnload || handledElsewhere?.(navigation)) return;
		const question = cost();
		if (!question) return;
		if (gathering?.navigation === navigation) {
			gathering.questions.push(question);
			return;
		}

		const asked = { navigation: navigation as GuardedNavigation, questions: [question] };
		gathering = asked;
		const to = navigation.to?.url;
		const { delta } = navigation;
		navigation.cancel();

		void (async () => {
			// The other guards' callbacks run in the same synchronous pass: let them add theirs.
			await Promise.resolve();
			if (gathering === asked) gathering = null;
			if (!(await deps.ask(combineQuestions(asked.questions)))) return;
			approved = true;
			if (typeof delta === 'number') {
				// Redoes the exact history move SvelteKit just undid; the guards spend the ticket.
				deps.historyGo(delta);
				return;
			}
			if (!to) {
				approved = false;
				return;
			}
			try {
				await deps.goto(to);
			} finally {
				approved = false;
			}
		})();
	};
}
