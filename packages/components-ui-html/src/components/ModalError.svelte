<script lang="ts">
	import { Popup } from 'components-shared';
	import { zIndex } from 'constants-shared/zIndex';
	import { stateModal } from 'state-shared';

	import BaseContent from './BaseContent.svelte';

	/**
	 * Whatever was thrown, as something a person can read.
	 *
	 * This used to render a structured error only when it carried BOTH `error` and `message`, and
	 * fall back to `{error}` otherwise — which prints `[object Object]` for any object missing one of
	 * them. Our own throws carry both, so it looked fine for years. A partner RGS does not: it reports
	 * failures as HTTP 200 with `{result, error, errorCode}` and no `message`, so **every** partner-side
	 * failure reached the player as `[object Object]`. Found against the live node, where an expired
	 * session should have said "not authorized".
	 *
	 * It SEARCHES rather than reads a fixed path, because the sentence is nested at a different depth
	 * on each shape — ours puts it at `message`, the partner's arrives wrapped as
	 * `{status: {statusMessage}, error: {error}}`. Hunting the known human-readable keys breadth-first
	 * finds it wherever a future transport decides to put it, and the JSON tail is the last resort that
	 * guarantees we never print a type name at somebody's player again.
	 */
	const HUMAN_KEYS = ['statusMessage', 'error', 'message', 'detail'];

	const readable = (error: unknown, depth = 0): string => {
		if (error === null || error === undefined) return '';
		if (typeof error === 'string') return error.trim();
		if (error instanceof Error) return error.message;
		if (typeof error !== 'object') return String(error);
		if (depth > 3) return '';

		const record = error as Record<string, unknown>;
		const found: string[] = [];
		for (const key of HUMAN_KEYS) {
			const text = readable(record[key], depth + 1);
			if (text && !found.includes(text)) found.push(text);
		}
		if (found.length) return found.join(' — ');

		// Nothing recognisable. Show the shape rather than its type name: a player cannot act on
		// either, but support can act on the first.
		if (depth > 0) return '';
		try {
			return JSON.stringify(error);
		} catch {
			return '';
		}
	};
</script>

{#if stateModal.modal?.name === 'error'}
	<Popup zIndex={zIndex.modal} persistent onclose={() => (stateModal.modal = null)}>
		<BaseContent maxWidth="100%">
			{@const text = readable(stateModal.modal?.error)}
			<span>Sorry, something went wrong.</span>
			<div class="scrollY error-text">
				{#if text}
					<p>{text}</p>
				{:else}
					<span>unknown error</span>
				{/if}
			</div>
		</BaseContent>
	</Popup>
{/if}

<style lang="scss">
	.error-text {
		max-height: 100px;
		max-width: 480px;
		border-radius: 8px;
		border: 1px solid red;
		white-space: normal;
		padding: 1rem;
	}
</style>
