/**
 * `confirm()` / `alert()` / `prompt()` for the launcher — the same three blocking
 * questions, asked through the app's own `<ConfirmDialog>` instead of the browser chrome.
 *
 * Why a promise API and not "render a dialog per call site": a native `confirm()` is an
 * EXPRESSION in the middle of a handler. Rewriting each of the ~46 of them into
 * open-a-dialog / resume-in-a-callback state would have meant ~46 new `$state` targets and
 * ~46 chances to resume into the wrong one. `await askConfirm({…})` keeps the control flow
 * the author already wrote:
 *
 *   if (!confirm(msg)) return;            →   if (!(await askConfirm({ title, message }))) return;
 *   const name = prompt('Name:', sugg);   →   const name = await askText({ title, value: sugg });
 *   alert(msg);                           →   await askMessage({ title, message: msg });
 *
 * One host renders them (`DialogHost.svelte`, mounted once in the `(app)` layout), so the
 * page-inertness `showModal()` gives is global rather than per-tool. Requests are a FIFO
 * QUEUE, not a single slot: `confirm()` blocked the thread, so two asks could never overlap;
 * an un-awaited `askConfirm()` can, and dropping the second would silently answer it `false`.
 *
 * What this deliberately does NOT do is `busy` / `error` / a rich `body` — those need the
 * dialog to stay open ACROSS the action, which is not a question-and-answer. A call site
 * that needs them renders `<ConfirmDialog>` itself and owns `open` (admin's project delete
 * and purge are the worked examples).
 */

export interface DialogInputSpec {
	/** Label above the field. Omitted for a bare one-line prompt. */
	label?: string;
	/** Seeded value — selected on open, so typing replaces it. */
	value?: string;
	placeholder?: string;
	/** By default Confirm stays locked while the field is blank. */
	allowEmpty?: boolean;
}

interface CommonOptions {
	title: string;
	/** Plain text; newlines survive. */
	message?: string;
}

export interface ConfirmOptions extends CommonOptions {
	confirmLabel?: string;
	cancelLabel?: string;
	/** Destructive fill on the confirm button. Use it for every delete. */
	danger?: boolean;
	/** Confirm unlocks only on this exact typed string — for the unrecoverable ones. */
	requireText?: string;
	requireHint?: string;
}

export interface MessageOptions extends CommonOptions {
	okLabel?: string;
}

export interface TextOptions extends CommonOptions, DialogInputSpec {
	confirmLabel?: string;
	cancelLabel?: string;
}

export interface PendingDialog {
	id: number;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	danger: boolean;
	requireText: string;
	requireHint: string;
	hideCancel: boolean;
	input: DialogInputSpec | undefined;
	settle: (typed: string | null) => void;
}

let seq = 0;
let queue = $state<PendingDialog[]>([]);

/** Read by the single host. `null` when nothing is being asked. */
export const dialogQueue = {
	get current(): PendingDialog | null {
		return queue[0] ?? null;
	},
};

/** The host's answer: the typed text, or `null` for cancel/Escape/backdrop. */
export function settleDialog(typed: string | null): void {
	const top = queue[0];
	if (!top) return;
	queue = queue.slice(1);
	top.settle(typed);
}

function ask(spec: Omit<PendingDialog, 'id' | 'settle'>): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		seq += 1;
		queue = [...queue, { ...spec, id: seq, settle: resolve }];
	});
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
	return ask({
		title: options.title,
		message: options.message ?? '',
		confirmLabel: options.confirmLabel ?? 'Confirm',
		cancelLabel: options.cancelLabel ?? 'Cancel',
		danger: options.danger ?? false,
		requireText: options.requireText ?? '',
		requireHint: options.requireHint ?? '',
		hideCancel: false,
		input: undefined,
	}).then((typed) => typed !== null);
}

export function askMessage(options: MessageOptions): Promise<void> {
	return ask({
		title: options.title,
		message: options.message ?? '',
		confirmLabel: options.okLabel ?? 'OK',
		cancelLabel: 'Cancel',
		danger: false,
		requireText: '',
		requireHint: '',
		hideCancel: true,
		input: undefined,
	}).then(() => undefined);
}

/** Resolves the typed string, or `null` if dismissed — exactly `prompt()`'s contract. */
export function askText(options: TextOptions): Promise<string | null> {
	return ask({
		title: options.title,
		message: options.message ?? '',
		confirmLabel: options.confirmLabel ?? 'OK',
		cancelLabel: options.cancelLabel ?? 'Cancel',
		danger: false,
		requireText: '',
		requireHint: '',
		hideCancel: false,
		input: {
			label: options.label,
			value: options.value,
			placeholder: options.placeholder,
			allowEmpty: options.allowEmpty,
		},
	});
}
