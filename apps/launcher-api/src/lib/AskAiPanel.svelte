<script lang="ts">
	// "Ask the AI": a floating chat window over any tool, opened from the tool bar. It moves by its
	// title bar and goes away only through its own Minimize / Close buttons — no Escape, no click
	// outside — so it never vanishes mid-answer. The answer comes from `/api/ask-ai`, Claude
	// speaking as the tool's agent from the tool's guide. The conversation lives for the browser
	// tab (sessionStorage, per tool); the window's place for the browser (localStorage).
	import { Marked, type Tokens } from 'marked';
	import { tick } from 'svelte';
	import { ASK_AI_MAX_CHARS, settledChat, type AskAiEvent, type AskAiMessage } from '$lib/askAi';

	let {
		tool,
		toolName,
		projectKey,
		onclose,
	}: {
		tool: string;
		toolName: string;
		projectKey?: string;
		onclose: () => void;
	} = $props();

	const WIDTH = 400;
	const HEIGHT = 540;
	const MARGIN = 12;
	const chatKey = $derived(`iw-ask-ai:chat:${tool}`);
	const PLACE_KEY = 'iw-ask-ai:place';

	function read<T>(storage: () => Storage, key: string): T | undefined {
		try {
			const raw = storage().getItem(key);
			return raw ? (JSON.parse(raw) as T) : undefined;
		} catch {
			return undefined;
		}
	}
	function write(storage: () => Storage, key: string, value: unknown): void {
		try {
			storage().setItem(key, JSON.stringify(value));
		} catch {
			// Storage blocked or full: the chat still works, it just isn't remembered.
		}
	}

	let messages = $state<AskAiMessage[]>(
		settledChat(read<unknown>(() => sessionStorage, `iw-ask-ai:chat:${tool}`)),
	);
	let draft = $state('');
	let pending = $state('');
	let busy = $state(false);
	let failure = $state('');
	let minimized = $state(false);
	let controller: AbortController | null = null;
	/** Bumped by "New chat", so an answer still arriving for the old chat is dropped. */
	let chatId = 0;

	const saved = read<{ x: number; y: number }>(() => localStorage, PLACE_KEY);
	let x = $state(saved?.x ?? window.innerWidth - WIDTH - MARGIN * 2);
	let y = $state(saved?.y ?? 72);

	let panel = $state<HTMLElement | null>(null);
	let log = $state<HTMLElement | null>(null);
	let input = $state<HTMLTextAreaElement | null>(null);

	/** Keep the title bar on screen, so the window can always be dragged back. */
	function clamp(): void {
		const w = panel?.offsetWidth ?? WIDTH;
		const h = panel?.querySelector('header')?.offsetHeight ?? 40;
		x = Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - w - MARGIN));
		y = Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - h - MARGIN));
	}

	$effect(() => {
		clamp();
		const onResize = () => clamp();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	$effect(() => write(() => sessionStorage, chatKey, messages));

	$effect(() => () => controller?.abort());

	// Capture-phase window listeners while a drag is on, so neither a fast pointer leaving the title
	// bar nor a tool canvas that stops pointer events can strand the window.
	let stopDrag: (() => void) | null = null;
	function startDrag(e: PointerEvent): void {
		if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
		e.preventDefault();
		const id = e.pointerId;
		const dx = e.clientX - x;
		const dy = e.clientY - y;
		const move = (ev: PointerEvent) => {
			if (ev.pointerId !== id) return;
			x = ev.clientX - dx;
			y = ev.clientY - dy;
			clamp();
		};
		const end = (ev: PointerEvent) => {
			if (ev.pointerId !== id) return;
			stopDrag?.();
			write(() => localStorage, PLACE_KEY, { x, y });
		};
		stopDrag?.();
		window.addEventListener('pointermove', move, true);
		window.addEventListener('pointerup', end, true);
		window.addEventListener('pointercancel', end, true);
		stopDrag = () => {
			window.removeEventListener('pointermove', move, true);
			window.removeEventListener('pointerup', end, true);
			window.removeEventListener('pointercancel', end, true);
			stopDrag = null;
		};
	}

	$effect(() => () => stopDrag?.());

	const md = new Marked({
		gfm: true,
		breaks: true,
		renderer: {
			// The model's text is never trusted as markup: raw HTML is shown as text.
			html: ({ text }) => escapeHtml(text),
			image: ({ text }) => escapeHtml(text),
			link({ href, tokens }: Tokens.Link) {
				const label = this.parser.parseInline(tokens);
				if (!/^(https?:\/\/|\/)/.test(href)) return label;
				// A new tab, so following a guide link never navigates the open tool away.
				return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
			},
		},
	});
	function escapeHtml(s: string): string {
		return s.replace(
			/[&<>"']/g,
			(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
		);
	}
	const render = (text: string): string => md.parse(text, { async: false });

	async function scrollDown(): Promise<void> {
		await tick();
		log?.scrollTo({ top: log.scrollHeight });
	}

	async function send(): Promise<void> {
		const question = draft.trim();
		if (!question || busy) return;
		draft = '';
		failure = '';
		messages = [...messages, { role: 'user', content: question }];
		busy = true;
		pending = '';
		const thisChat = chatId;
		void scrollDown();
		controller = new AbortController();
		try {
			const res = await fetch('/api/ask-ai', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ tool, messages, project: projectKey }),
				signal: controller.signal,
			});
			if (!res.ok || !res.body) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				throw new Error(body?.message ?? `The AI could not answer (${res.status}).`);
			}
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line) continue;
					const event = JSON.parse(line) as AskAiEvent;
					if (event.t === 'text') pending += event.v;
					else if (event.t === 'error') throw new Error(event.v);
				}
				void scrollDown();
			}
		} catch (err) {
			if (!controller?.signal.aborted) {
				failure = err instanceof Error ? err.message : 'The AI could not answer.';
			}
		} finally {
			if (thisChat === chatId) {
				if (pending.trim()) messages = [...messages, { role: 'assistant', content: pending }];
				else {
					// Nothing came back: take the question off the log and give it back to edit.
					messages = messages.slice(0, -1);
					if (!draft) draft = question;
				}
			}
			pending = '';
			busy = false;
			controller = null;
			void scrollDown();
			input?.focus();
		}
	}

	function stop(): void {
		controller?.abort();
	}

	function newChat(): void {
		chatId++;
		controller?.abort();
		messages = [];
		failure = '';
		input?.focus();
	}

	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void send();
		}
	}
</script>

<section
	class="ask-ai"
	class:minimized
	bind:this={panel}
	style="left:{x}px; top:{y}px"
	role="dialog"
	aria-label={`Ask the AI about ${toolName}`}
>
	<header onpointerdown={startDrag}>
		<span class="title">Ask the AI <span class="about">· {toolName}</span></span>
		{#if !minimized && messages.length}
			<button type="button" title="Start a new chat" onclick={newChat}>New chat</button>
		{/if}
		<button
			type="button"
			class="icon"
			title={minimized ? 'Restore' : 'Minimize'}
			aria-label={minimized ? 'Restore' : 'Minimize'}
			onclick={() => {
				minimized = !minimized;
				void tick().then(clamp);
			}}>{minimized ? '▢' : '–'}</button
		>
		<button type="button" class="icon" title="Close" aria-label="Close" onclick={onclose}>×</button>
	</header>

	{#if !minimized}
		<div class="log" bind:this={log}>
			{#if !messages.length && !busy}
				<p class="hint">
					Ask how to do something in {toolName} — for example “How do I start?” or “What does this panel
					do?”. Answers come from the {toolName} guide.
				</p>
			{/if}
			{#each messages as m, i (i)}
				{#if m.role === 'user'}
					<div class="msg user">{m.content}</div>
				{:else}
					<!-- Rendered by `md`, which escapes raw HTML and drops images and unsafe links. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="msg ai">{@html render(m.content)}</div>
				{/if}
			{/each}
			{#if busy}
				<div class="msg ai">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{#if pending}{@html render(pending)}{:else}<span class="thinking">Thinking…</span>{/if}
				</div>
			{/if}
			{#if failure}<p class="failure">{failure}</p>{/if}
		</div>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<textarea
				bind:this={input}
				bind:value={draft}
				onkeydown={onKey}
				rows="2"
				placeholder={`Ask about ${toolName}…`}
				maxlength={ASK_AI_MAX_CHARS}
			></textarea>
			{#if busy}
				<button type="button" onclick={stop}>Stop</button>
			{:else}
				<button type="submit" class="send" disabled={!draft.trim()}>Send</button>
			{/if}
		</form>
		<p class="note">AI answers can be wrong — the guide is the reference.</p>
	{/if}
</section>

<style>
	.ask-ai {
		position: fixed;
		z-index: 9000;
		display: flex;
		flex-direction: column;
		width: min(400px, calc(100vw - 24px));
		height: min(540px, calc(100vh - 24px));
		border: 1px solid #2c2c38;
		border-radius: 10px;
		background: #121218;
		color: #e8e8ee;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
		font-size: 13px;
		overflow: hidden;
	}
	.ask-ai.minimized {
		height: auto;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 8px 8px 8px 12px;
		background: #0f0f14;
		border-bottom: 1px solid #1c1c24;
		cursor: move;
		user-select: none;
		touch-action: none;
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 700;
		color: #9ab8ff;
	}
	.about {
		font-weight: 600;
		color: #888;
	}
	header button {
		flex: none;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #b9b9c4;
		font-size: 12px;
		cursor: pointer;
	}
	header button.icon {
		width: 26px;
		padding: 3px 0;
	}
	header button:hover {
		color: #e8e8ee;
		border-color: #3a3a48;
	}
	.log {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.hint,
	.note {
		margin: 0;
		color: #888;
		line-height: 1.45;
	}
	.note {
		flex: none;
		padding: 0 12px 8px;
		font-size: 11px;
		color: #666;
	}
	.msg {
		max-width: 92%;
		padding: 8px 11px;
		border-radius: 9px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.msg.user {
		align-self: flex-end;
		background: #1f2a44;
		white-space: pre-wrap;
	}
	.msg.ai {
		align-self: flex-start;
		background: #1b1b22;
	}
	.msg.ai :global(p),
	.msg.ai :global(ul),
	.msg.ai :global(ol) {
		margin: 0 0 6px;
	}
	.msg.ai :global(:last-child) {
		margin-bottom: 0;
	}
	.msg.ai :global(ul),
	.msg.ai :global(ol) {
		padding-left: 20px;
	}
	.msg.ai :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		background: #26262f;
		padding: 1px 4px;
		border-radius: 4px;
	}
	.msg.ai :global(pre) {
		overflow-x: auto;
		background: #26262f;
		padding: 8px;
		border-radius: 6px;
	}
	.msg.ai :global(a) {
		color: #7ee0c0;
	}
	.thinking {
		color: #888;
	}
	.failure {
		margin: 0;
		color: #ff8a8a;
	}
	form {
		display: flex;
		gap: 8px;
		flex: none;
		padding: 10px 12px 6px;
		border-top: 1px solid #1c1c24;
	}
	textarea {
		flex: 1;
		resize: none;
		padding: 7px 9px;
		border-radius: 8px;
		border: 1px solid #2c2c38;
		background: #0f0f14;
		color: #e8e8ee;
		font: inherit;
	}
	textarea:focus {
		outline: none;
		border-color: #4a5f9a;
	}
	form button {
		flex: none;
		align-self: flex-end;
		padding: 7px 12px;
		border-radius: 8px;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #e8e8ee;
		font-weight: 600;
		cursor: pointer;
	}
	form button.send {
		background: #2a3b66;
		border-color: #3b5290;
	}
	form button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
