<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { CodeDraft, normalizeNewlines } from './shaderEditor';

	// A Custom GLSL node's code: a monospace field with line numbers, the lines something is wrong
	// with marked in the gutter (their messages on hover). Tab types a tab; Esc then Tab leaves the
	// field. What is typed reaches the doc as one edit (one undo step) once typing pauses, or when the
	// field is left (`CodeDraft`); Ctrl+Z inside the field is the field's own. Read-only, it can still
	// be read, scrolled and copied. Its lines are the checker's: any `\r\n` or lone `\r` breaks a line.
	interface Props {
		code: string;
		readOnly?: boolean;
		/** Messages by line (1-based). */
		marks?: ReadonlyMap<number, readonly string[]>;
		label: string;
		/** The doc takes `code`. Bound when the field is made: it outlives a change of node. */
		onCommit: (code: string) => void;
	}
	let { code, readOnly = false, marks = new Map(), label, onCommit }: Props = $props();

	const commit = untrack(() => onCommit);
	const draft = new CodeDraft(normalizeNewlines(untrack(() => code)), (text) => commit(text));
	let text = $state(draft.text);
	let field: HTMLTextAreaElement | undefined = $state();
	let gutter: HTMLDivElement | undefined = $state();
	/** Esc was pressed: the next Tab moves on rather than typing a tab. */
	let leaving = false;

	$effect(() => {
		draft.sync(normalizeNewlines(code));
		text = draft.text;
	});
	onDestroy(() => {
		draft.flush();
		draft.dispose();
	});

	const lineCount = $derived(text.split('\n').length);

	function typed(value: string): void {
		text = normalizeNewlines(value);
		draft.type(text);
	}

	function onKeydown(e: KeyboardEvent): void {
		const el = e.currentTarget as HTMLTextAreaElement;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			// The page saves on Ctrl+S: what was typed goes to the doc first.
			draft.flush();
			return;
		}
		if (e.key === 'Escape') {
			leaving = true;
			return;
		}
		const tab = e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
		if (!tab || leaving || readOnly) {
			leaving = false;
			return;
		}
		e.preventDefault();
		// `insertText` keeps the field's own undo; where it is gone, the tab is set in directly.
		if (!document.execCommand?.('insertText', false, '\t')) {
			el.setRangeText('\t', el.selectionStart, el.selectionEnd, 'end');
			typed(el.value);
		}
	}

	/** Put the caret at the start of `line` (1-based) and show it. */
	export function reveal(line: number): void {
		if (!field) return;
		const starts = text.split('\n');
		const at = starts.slice(0, Math.max(0, line - 1)).reduce((sum, l) => sum + l.length + 1, 0);
		field.focus();
		field.setSelectionRange(at, at + (starts[line - 1]?.length ?? 0));
		const lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 16;
		field.scrollTop = Math.max(0, (line - 3) * lineHeight);
	}
</script>

<div class="code-editor" class:readonly={readOnly}>
	<div class="gutter" bind:this={gutter} aria-hidden="true">
		{#each { length: lineCount } as _, i (i)}
			{@const messages = marks.get(i + 1)}
			<div class:bad={!!messages} title={messages?.join('\n')}>{i + 1}</div>
		{/each}
	</div>
	<textarea
		bind:this={field}
		aria-label={label}
		value={text}
		readonly={readOnly}
		spellcheck="false"
		autocomplete="off"
		autocapitalize="off"
		wrap="off"
		oninput={(e) => typed(e.currentTarget.value)}
		onblur={() => draft.flush()}
		onkeydown={onKeydown}
		onscroll={(e) => {
			if (gutter) gutter.scrollTop = e.currentTarget.scrollTop;
		}}
	></textarea>
</div>

<style>
	.code-editor {
		display: flex;
		height: 240px;
		min-height: 120px;
		resize: vertical;
		overflow: hidden;
		border: 1px solid #2a323d;
		border-radius: 4px;
		background: #0b0e13;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11.5px;
		line-height: 16px;
	}
	.code-editor:focus-within {
		border-color: #60a5fa;
	}
	.code-editor.readonly {
		background: #0f141b;
	}
	.gutter {
		flex: none;
		min-width: 30px;
		/* Room below the last line for the field's own scrollbar, so the two scroll as far. */
		padding: 4px 0 24px;
		overflow: hidden;
		text-align: right;
		color: #475569;
		background: #0f141b;
		border-right: 1px solid #1f2937;
		user-select: none;
	}
	.gutter div {
		height: 16px;
		padding: 0 6px 0 4px;
	}
	.gutter div.bad {
		color: #fecaca;
		background: #7f1d1d;
	}
	textarea {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 4px 6px;
		border: 0;
		outline: none;
		resize: none;
		background: transparent;
		color: #e2e8f0;
		font: inherit;
		line-height: inherit;
		tab-size: 4;
		white-space: pre;
		overflow: auto;
	}
</style>
