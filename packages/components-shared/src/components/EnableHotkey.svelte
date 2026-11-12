<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	import { getContextEventEmitter } from 'utils-event-emitter';

	import { hotkeyPressesFor } from '../hotkeyPress';
	import type { EmitterEventHotKey } from '../types';

	const context = getContextEventEmitter<EmitterEventHotKey>();
	const presses = hotkeyPressesFor(context.eventEmitter);
	const PREVENT_DEFAULT_KEYS = ['Space', 'ArrowUp', 'ArrowDown'];
	const EXCLUDED_TAGS = ['input', 'textarea', 'select'];

	const getValidElement = (e: KeyboardEvent) =>
		!EXCLUDED_TAGS.includes(e?.target?.tagName?.toLowerCase());

	function handleKeydown(e: KeyboardEvent) {
		if (getValidElement(e)) {
			const isSpace = e.key === ' ';
			const key = isSpace ? 'Space' : e.key;
			if (PREVENT_DEFAULT_KEYS.includes(key)) e.preventDefault();
			if (key) {
				presses.down(key, e.repeat);
				context.eventEmitter.broadcast({
					type: 'hotKey',
					key,
					action: 'keyDown',
					repeat: e.repeat,
				});
			}
		}
	}

	function handleKeyup(e: KeyboardEvent) {
		if (getValidElement(e)) {
			const isSpace = e.key === ' ';
			const key = isSpace ? 'Space' : e.key;
			if (PREVENT_DEFAULT_KEYS.includes(key)) e.preventDefault();
			if (key) {
				presses.up(key);
				context.eventEmitter.broadcast({ type: 'hotKey', key, action: 'keyUp' });
			}
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('keyup', handleKeyup);
		window.addEventListener('blur', presses.drop);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('keyup', handleKeyup);
		window.removeEventListener('blur', presses.drop);
	});
</script>
