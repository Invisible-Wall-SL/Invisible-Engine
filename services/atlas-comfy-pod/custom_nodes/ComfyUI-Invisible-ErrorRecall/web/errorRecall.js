import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';

/**
 * Invisible Error Recall — put the error back on the node when the socket dropped.
 *
 * ComfyUI fires `execution_error` over the /ws socket ONCE. Miss it (RunPod's proxy
 * closing an idle connection mid-render, a sleeping laptop, a pod restart) and the UI
 * never learns the run failed: no red node, no dialog, just a canvas that looks idle.
 * The server still has it in /history. This goes back and reads it.
 *
 * Deliberately conservative:
 * - It NEVER mutates the graph. Node highlighting goes through `app.lastNodeErrors`,
 *   the same transient channel ComfyUI uses for /prompt validation errors, so nothing
 *   can end up saved into the artist's workflow.
 * - Every frontend API it touches is feature-detected. This rides a pinned ComfyUI
 *   (v0.3.66) but the frontend bundle is the fastest-moving part of ComfyUI, and a
 *   debugging aid that throws is worse than one that quietly does less.
 * - It always logs a structured line to the console, so even if every UI hook is gone
 *   the information is still one devtools glance away.
 */

const SEEN_KEY = 'invisible.errorRecall.seen';

function loadSeen() {
	try {
		return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'));
	} catch {
		return new Set();
	}
}
const seen = loadSeen();

function markSeen(promptId) {
	if (!promptId) return;
	seen.add(promptId);
	try {
		sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
	} catch {
		// Private mode / quota — in-memory dedupe still works for this tab.
	}
}

/** The most recent errored prompt in /history, or null. */
async function newestError() {
	let hist;
	try {
		// max_items keeps this cheap on a pod with a long session; older builds that
		// don't know the param just return everything, which still works.
		const res = await api.fetchApi('/history?max_items=20');
		if (!res?.ok) return null;
		hist = await res.json();
	} catch {
		return null; // Still disconnected — the next reconnect tries again.
	}
	const entries = Object.entries(hist || {});
	for (let i = entries.length - 1; i >= 0; i--) {
		const [promptId, entry] = entries[i];
		if (entry?.status?.status_str !== 'error') continue;
		const msg = (entry.status.messages || []).find((m) => m?.[0] === 'execution_error');
		if (msg) return { promptId, info: msg[1] || {} };
	}
	return null;
}

/** Highlight the node through the same transient channel as validation errors. */
function highlight(nodeId, message, nodeType) {
	if (nodeId === undefined || nodeId === null) return null;
	const id = String(nodeId);
	try {
		app.lastNodeErrors = {
			...(app.lastNodeErrors || {}),
			[id]: { errors: [{ message, details: nodeType || '' }] },
		};
		app.canvas?.draw?.(true, true);
	} catch {
		// Frontend changed shape — the console line and the dialog still carry it.
	}
	let node = null;
	try {
		node = app.graph?.getNodeById?.(Number(nodeId)) ?? null;
		if (node) {
			app.canvas?.centerOnNode?.(node);
			app.canvas?.selectNode?.(node);
		}
	} catch {
		node = null;
	}
	return node;
}

function notify(summary, detail, modal) {
	// Preferred: the frontend's own toast, non-blocking.
	try {
		const toast = app.extensionManager?.toast;
		if (toast?.add) {
			toast.add({ severity: 'error', summary, detail, life: 15000 });
			if (!modal) return;
		}
	} catch {
		// fall through
	}
	if (!modal) return;
	try {
		app.ui?.dialog?.show?.(`${summary}\n\n${detail}`);
	} catch {
		// Console already has it.
	}
}

/**
 * @param modal true when the artist was just here (a reconnect) and should be
 * interrupted; false on page load, where a silent highlight + toast is enough.
 */
function surface({ promptId, info }, modal) {
	const nodeId = info.node_id;
	const nodeType = info.node_type || '';
	const message = (info.exception_message || '').trim() || 'unknown error';
	const node = highlight(nodeId, message, nodeType);
	// The canvas shows the TITLE, so lead with that where there is one.
	const label = node?.title || nodeType || `node ${nodeId}`;

	console.error(
		`[Invisible Error Recall] recovered from /history: node ${nodeId} (${nodeType || '?'}) failed -- ${message}`,
		{ promptId, info },
	);
	notify(
		`Run failed on "${label}"`,
		`${info.exception_type || 'Error'}: ${message}\n\n` +
			`Node ${nodeId}${nodeType ? ` (${nodeType})` : ''}. Recovered from history -- the ` +
			`connection dropped before ComfyUI could report it.`,
		modal,
	);
}

async function check(modal) {
	const found = await newestError();
	if (!found || seen.has(found.promptId)) return;
	markSeen(found.promptId);
	surface(found, modal);
}

app.registerExtension({
	name: 'Invisible.ErrorRecall',
	async setup() {
		// A live error already paints itself; record it so a later reconnect doesn't
		// re-report what the artist has already seen.
		api.addEventListener('execution_error', (ev) => markSeen(ev?.detail?.prompt_id));
		api.addEventListener('execution_start', (ev) => {
			// Nothing to do yet, but touching the id here means a prompt that errors
			// while we're disconnected is still the one /history hands back.
			void ev?.detail?.prompt_id;
		});

		// The whole point: the socket came back, so go find what we missed.
		api.addEventListener('reconnected', () => void check(true));

		// Reopening the tab after a drop should also tell you what happened -- but
		// without a modal, since you may just be starting a fresh session.
		setTimeout(() => void check(false), 1500);
	},
});
