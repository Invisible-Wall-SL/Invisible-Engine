#!/usr/bin/env node
/**
 * "Which node failed, and why?" — for a ComfyUI run whose WebSocket dropped.
 *
 * ComfyUI reports execution errors over the /ws progress socket. When that socket dies
 * (RunPod's proxy times it out, the laptop sleeps, the pod restarts) the browser shows
 * "Reconnecting…" and the real error is never painted on the node — even though the
 * server recorded it. /history keeps it, so this reads it back after the fact.
 *
 * A pod's ComfyUI URL is derived from its RunPod id — see the /comfyui panel, or
 * `docs/INFRA.md` §"ComfyUI R&D pod". Reads only; safe to run against a live render.
 *
 * Usage:  node scripts/comfy-last-error.mjs <comfy-url> [promptId]
 *   node scripts/comfy-last-error.mjs https://abc123-8188.proxy.runpod.net
 *
 * Three outcomes, each a diagnosis in itself:
 *   a failing node        → a real graph error; fix that node
 *   "last run did NOT fail" → transport only; the render probably finished
 *   "No history"          → ComfyUI RESTARTED, i.e. the process died (OOM/crash)
 */

const base = (process.argv[2] || '').replace(/\/$/, '');
const wantId = process.argv[3];
if (!base) {
	console.error('usage: node scripts/comfy-last-error.mjs <comfy-url> [promptId]');
	process.exit(2);
}

const UA = { 'user-agent': 'InvisibleAtlas/1.0' }; // Cloudflare 403s the default UA.

async function get(path) {
	let res;
	try {
		res = await fetch(base + path, { headers: UA });
	} catch (err) {
		// Unreachable IS a diagnosis, so report it as one rather than a raw stack.
		console.error(`Could not reach ComfyUI at ${base} (${err.cause?.code || err.message}).`);
		console.error('The pod is stopped, still booting, or ComfyUI never started on it.');
		console.error('Check the /comfyui panel, then `tail -200 /workspace/comfyui.log` on the pod.');
		process.exit(1);
	}
	if (!res.ok) {
		console.error(`ComfyUI answered ${res.status} ${res.statusText} for ${path}.`);
		if (res.status === 401 || res.status === 403) {
			console.error('That is the proxy rejecting you, not ComfyUI — check the pod URL/auth.');
		}
		process.exit(1);
	}
	return res.json();
}

const hist = await get(wantId ? `/history/${wantId}` : '/history');
const entries = Object.entries(hist);
if (!entries.length) {
	console.log('No history on this ComfyUI. Nothing has run since it last restarted —');
	console.log('which is itself a finding: a restart means the process died (OOM/crash).');
	process.exit(0);
}

// /history is insertion-ordered oldest-first; walk back to the newest failure.
const failed = entries.filter(([, e]) => (e.status || {}).status_str === 'error');
const [pid, entry] = (failed.length ? failed : entries).at(-1);
const status = entry.status || {};
const graph = Array.isArray(entry.prompt) ? entry.prompt[2] || {} : {};

console.log(`prompt   ${pid}`);
console.log(`status   ${status.status_str || '?'}${status.completed ? ' (completed)' : ''}`);
if (!failed.length) {
	console.log('\nNo errored prompt in history — the last run did NOT fail on a node.');
	console.log('So the disconnect was transport or process death, not a graph error:');
	console.log('  • pod still running? -> the WebSocket dropped; the render likely finished.');
	console.log('  • pod restarted?     -> check /workspace/comfyui.log for OOM / Killed.');
	process.exit(0);
}

for (const [kind, info = {}] of status.messages || []) {
	if (kind !== 'execution_error') continue;
	const id = String(info.node_id ?? '?');
	const node = graph[id] || {};
	const title = (node._meta || {}).title;

	console.log('\n--- failing node -------------------------------------------');
	console.log(`node id    ${id}`);
	console.log(`class      ${info.node_type || node.class_type || '?'}`);
	// The canvas shows the TITLE, so this is what you actually look for.
	if (title && title !== node.class_type)
		console.log(`title      "${title}"  <-- find THIS on the canvas`);
	console.log(`error      ${(info.exception_type || '').trim()}`);
	console.log(`message    ${(info.exception_message || '').trim()}`);

	const inputs = node.inputs || {};
	const literals = Object.entries(inputs).filter(([, v]) => !Array.isArray(v));
	if (literals.length) {
		console.log('inputs (literal values on that node):');
		for (const [k, v] of literals) {
			const s = typeof v === 'string' && v.length > 90 ? v.slice(0, 90) + '…' : JSON.stringify(v);
			console.log(`  ${k} = ${s}`);
		}
	}
	const wired = Object.entries(inputs).filter(([, v]) => Array.isArray(v));
	if (wired.length) {
		console.log('fed by:');
		for (const [k, v] of wired) {
			const src = graph[String(v[0])] || {};
			console.log(`  ${k} <- node ${v[0]} (${src.class_type || '?'})`);
		}
	}
	if (info.traceback?.length) {
		console.log('\ntraceback (last 12 lines):');
		const tb = Array.isArray(info.traceback) ? info.traceback : String(info.traceback).split('\n');
		for (const line of tb.slice(-12)) console.log('  ' + String(line).trimEnd());
	}
}
console.log('\n------------------------------------------------------------');
