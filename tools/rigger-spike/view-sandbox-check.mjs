// The spikes that run view.html's functions in a `vm` sandbox build it through view-sandbox.mjs, so
// a view.html function that starts calling a new helper, or reading a new top-level `let` / `const`,
// does not turn them red. Before it, each spike hand-built its sandbox and listed what to pull, and
// four times in one week a product change that was fine broke CI with a bare ReferenceError (`rig3d`,
// `controlsDoc`, three draw-order helpers).
//
// A copy of view.html is patched: a new top-level helper reads a new `let` with a literal, one with
// a `new Set()`, one with a browser-only initialiser, and a new `const`; a function each migrated
// spike reaches calls it as its first statement. Asserted:
//  - every migrated spike passes on the patched page (RIGGER_VIEW_HTML);
//  - with the helper made to throw, every one fails: the patched functions are on its path;
//  - the sandbox defines each new name with its default (the literal, a Set of the sandbox's own
//    realm, null for the browser one), and a spike's own value for a name wins;
//  - a name nothing at the top level declares fails with a ReferenceError naming it and the view.html
//    function (and line) that reads it; so does a const whose initialiser cannot run here; an entry
//    the page lacks and a mutant whose text is not in the pulled source fail naming them.
//   node tools/rigger-spike/view-sandbox-check.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { readView, viewSandbox } from './view-sandbox.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SPINES = 'apps/lines/static/assets/spines';
/** The migrated spikes, with the args check-all gives them (a small rig where it takes one). */
const SPIKES = [
	['rig-duplicate-slot.mjs'],
	['rig-presets.mjs'],
	['linkedmesh.mjs'],
	['sequence.mjs', `${SPINES}/symbols3/W.json`, `${SPINES}/symbols3/symbols3.atlas`],
];
/** One function each spike reaches, which the patch makes call the new helper first. */
const CALLERS = [
	'duplicateSlotCore',
	'moveSlot',
	'deleteBoneCore',
	'addLinkedMesh',
	'sequenceArrForTrack',
];

let checks = 0;
let failed = 0;
const check = (ok, msg) => {
	checks++;
	if (!ok) failed++;
	console.log(`  ${ok ? '✅' : '✗'} ${msg}`);
	return ok;
};
const throwsWith = (fn, ...parts) => {
	try {
		fn();
	} catch (e) {
		const missing = parts.filter((p) => !String(e.message).includes(p));
		return missing.length ? `the message lacks ${missing.join(', ')}: ${e.message}` : '';
	}
	return 'it did not throw';
};

const shipped = readView();
const dir = mkdtempSync(join(tmpdir(), 'view-sandbox-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/** View.html with `decls` put before the first caller and `call` made each caller's first line. */
function patched(name, decls, call) {
	let html = shipped.html;
	const first = Math.min(...CALLERS.map((n) => shipped.top.get(n).at));
	const bodies = CALLERS.map((n) => shipped.top.get(n))
		.sort((a, b) => b.at - a.at)
		.map((d) => d.at + d.src.indexOf('{\n') + 2);
	for (const at of bodies) html = html.slice(0, at) + `\t${call}\n` + html.slice(at);
	html = html.slice(0, first) + decls + html.slice(first);
	const path = join(dir, `${name}.html`);
	writeFileSync(path, html);
	return path;
}

const PROBE = `let probeCount = 0;
let probeSeen = new Set();
let probeNode = document.getElementById("probe");
const PROBE_STEP = 1;
function viewSandboxProbe() {
	probeCount += PROBE_STEP;
	probeSeen.add(probeCount);
	return probeNode;
}
`;
const inert = patched('inert', PROBE, 'viewSandboxProbe();');
const throwing = patched(
	'throwing',
	PROBE.replace('return probeNode;', 'throw new Error("viewSandboxProbe reached");'),
	'viewSandboxProbe();',
);
const run = (page, [spike, ...args]) =>
	spawnSync(process.execPath, [join('tools/rigger-spike', spike), ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, RIGGER_VIEW_HTML: page },
	});

console.log('\nThe migrated spikes on a view.html whose functions read new top-level names');
for (const spike of SPIKES) {
	const r = run(inert, spike);
	const why = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ');
	check(r.status === 0, `${spike[0]} passes${r.status === 0 ? '' : ` — exit ${r.status}: ${why}`}`);
	const t = run(throwing, spike);
	check(
		t.status !== 0,
		`${spike[0]} fails when the new helper throws (it reaches a patched function)`,
	);
}

console.log('\nWhat the sandbox defines');
{
	const ui = viewSandbox({ entry: [...CALLERS], html: inert, label: 'check' });
	check(
		typeof ui.viewSandboxProbe === 'function',
		'a new helper a pulled function calls is pulled',
	);
	ui.viewSandboxProbe();
	check(
		ui.probeCount === 1,
		"a let's literal initialiser is its default, and the helper writes it",
	);
	check(
		ui.probeSeen.has(1) && ui.probeSeen instanceof vm.runInContext('Set', ui),
		"a let's self-contained initialiser (new Set()) is its default, in the sandbox's own realm",
	);
	check(ui.probeNode === null, 'a let whose initialiser needs the browser starts null');
	check(ui.PROBE_STEP === 1, 'a new const is pulled and readable on the sandbox');
	const own = viewSandbox({
		entry: ['viewSandboxProbe'],
		html: inert,
		globals: { probeCount: 41 },
	});
	own.viewSandboxProbe();
	check(own.probeCount === 42, "the spike's own value for a name wins over the default");
	const stubbed = viewSandbox({
		entry: ['duplicateSlotCore'],
		html: inert,
		stubs: ['viewSandboxProbe'],
	});
	check(
		stubbed.viewSandboxProbe() === undefined && !('probeSeen' in stubbed),
		'a stub is not pulled, nor what only it reads',
	);
}

console.log('\nWhat still cannot be supplied fails naming it');
{
	const page = patched('browser', '', 'void someBrowserOnlyThing;');
	const ui = viewSandbox({ entry: ['duplicateSlotCore'], html: page, label: 'check' });
	const line = readView(page).top.get('duplicateSlotCore').line;
	const why = throwsWith(
		() => ui.duplicateSlotCore('a', 'b', 'after'),
		'someBrowserOnlyThing',
		'duplicateSlotCore',
		`line ${line}`,
	);
	check(
		!why,
		`a name the page does not declare: ReferenceError naming it, its reader and the line${why ? ` — ${why}` : ''}`,
	);
	const nested = patched(
		'nested',
		'function viewSandboxInner() {\n\treturn viewSandboxNested;\n}\n',
		'viewSandboxInner();',
	);
	const deep = viewSandbox({
		entry: ['moveSlot'],
		html: nested,
		globals: { rawDoc: { slots: [] } },
	});
	const why2 = throwsWith(() => deep.moveSlot(0, 1), 'viewSandboxNested', 'viewSandboxInner');
	check(!why2, `the innermost pulled function is the one named${why2 ? ` — ${why2}` : ''}`);
	const cpage = patched('const', 'const PROBE_BODY = document.body;\n', 'void PROBE_BODY;');
	const cui = viewSandbox({ entry: ['duplicateSlotCore'], html: cpage, label: 'check' });
	const why3 = throwsWith(
		() => cui.duplicateSlotCore('a', 'b', 'after'),
		'PROBE_BODY',
		'document is not defined',
	);
	check(
		!why3,
		`a const whose initialiser cannot run here names itself and why${why3 ? ` — ${why3}` : ''}`,
	);
	const why4 = throwsWith(
		() => viewSandbox({ entry: ['noSuchViewFunction'] }),
		'noSuchViewFunction',
	);
	check(!why4, `an entry the page lacks is named${why4 ? ` — ${why4}` : ''}`);
	const why5 = throwsWith(
		() => viewSandbox({ entry: ['moveSlot'], mutate: [['no such text', '']] }),
		'no such text',
	);
	check(!why5, `a mutant whose text is not pulled is named${why5 ? ` — ${why5}` : ''}`);
}

console.log(`\n${failed ? '✗ FAIL' : '✅ PASS'} — ${checks - failed}/${checks} checks`);
process.exit(failed ? 1 : 0);
