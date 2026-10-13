/**
 * Flow Preview → the editor stage (Rive plan §6.2 step 5, Phase 7b). The `/flow-v2` preview and
 * the `/editor` State Machine panel are different pages, so the bridge is a `BroadcastChannel`
 * per project: the preview posts each instance op its headless run reaches (a trigger fired, an
 * input set), and a State Machine panel open on that component applies it through the SAME
 * `fire` / `setPreviewInput` path its own Preview inputs use — one runner, one dispatcher. A
 * message names the component, so a panel on another component ignores it; a page on another
 * project is on another channel. No `BroadcastChannel` (an old browser, SSR) ⇒ no bridge.
 */

export interface FlowStageMessage {
	v: 1;
	componentId: string;
	/** The placed node id the Flow node named — which placement of the component the op was for. */
	instance: string;
	op: 'fire' | 'set';
	/** The trigger or input id. */
	name: string;
	value?: number | boolean | string;
}

export const flowStageChannelName = (projectKey: string): string => `ie-flow-stage:${projectKey}`;

export function isFlowStageMessage(value: unknown): value is FlowStageMessage {
	if (typeof value !== 'object' || value === null) return false;
	const m = value as Record<string, unknown>;
	return (
		m.v === 1 &&
		typeof m.componentId === 'string' &&
		typeof m.instance === 'string' &&
		(m.op === 'fire' || m.op === 'set') &&
		typeof m.name === 'string' &&
		(m.value === undefined ||
			typeof m.value === 'number' ||
			typeof m.value === 'boolean' ||
			typeof m.value === 'string')
	);
}

export interface FlowStageChannel {
	post(message: FlowStageMessage): void;
	subscribe(listener: (message: FlowStageMessage) => void): () => void;
	close(): void;
}

/** The project's bridge, or `null` where `BroadcastChannel` does not exist. */
export function openFlowStageChannel(projectKey: string): FlowStageChannel | null {
	if (typeof BroadcastChannel === 'undefined') return null;
	const channel = new BroadcastChannel(flowStageChannelName(projectKey));
	return {
		post: (message) => channel.postMessage(message),
		subscribe: (listener) => {
			const handler = (event: MessageEvent): void => {
				if (isFlowStageMessage(event.data)) listener(event.data);
			};
			channel.addEventListener('message', handler);
			return () => channel.removeEventListener('message', handler);
		},
		close: () => channel.close(),
	};
}
