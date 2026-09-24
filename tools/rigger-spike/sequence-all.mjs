// Run the sequence spike over EVERY rig in the repo, so the numbers quoted in
// docs/status/rigger.md are reproducible with one command rather than living in someone's shell
// history.
//   node tools/rigger-spike/sequence-all.mjs
//
// Pairs each <dir>/*.json skeleton with an atlas in the same dir (stem-matched, else the lone
// .atlas), exactly as batch.mjs does. A rig with no sequence timeline still runs the synthetic
// blocks, so "no sequence here" is a pass, not a skip.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPIKE = fileURLToPath(new URL('./sequence.mjs', import.meta.url));

function* walk(dir) {
	let entries;
	try { entries = readdirSync(dir); } catch { return; }
	for (const name of entries) {
		if (name === 'node_modules' || name === '.git' || name === '.claude') continue;
		const p = join(dir, name);
		let st;
		try { st = statSync(p); } catch { continue; }
		if (st.isDirectory()) yield* walk(p);
		else if (name.endsWith('.json')) yield p;
	}
}

function atlasFor(jsonPath) {
	const dir = jsonPath.slice(0, jsonPath.length - basename(jsonPath).length);
	const stem = basename(jsonPath, '.json');
	const exact = join(dir, stem + '.atlas');
	if (existsSync(exact)) return exact;
	const found = readdirSync(dir).filter((f) => f.endsWith('.atlas'));
	return found.length ? join(dir, found[0]) : null;
}

const roots = ['apps', 'packages', 'services'].map((d) => join(ROOT, d));
const rigs = [];
for (const r of roots) for (const j of walk(r)) if (/spine/i.test(j) && atlasFor(j)) rigs.push(j);
rigs.sort();

let pass = 0, fail = 0, checks = 0, withSeq = 0;
const failed = [];
for (const j of rigs) {
	let out = '';
	try {
		out = execFileSync(process.execPath, [SPIKE, j, atlasFor(j)], { encoding: 'utf8' });
	} catch (e) {
		fail++; failed.push(j);
		const why = String((e.stdout || '') + (e.stderr || '')).split('\n').filter((l) => l.includes('✗')).slice(0, 2);
		for (const w of why) console.log('  ' + j.slice(ROOT.length) + why.length + ' ' + w.trim());
		continue;
	}
	pass++;
	const m = /PASS \((\d+)/.exec(out);
	if (m) checks += Number(m[1]);
	if (!out.includes('no sequence timeline in this rig')) withSeq++;
}

console.log('='.repeat(56));
console.log(`${rigs.length} rigs · ${pass} PASS · ${fail} FAIL · ${withSeq} carry a real sequence timeline`);
console.log(`total assertions: ${checks}`);
for (const f of failed) console.log('  FAILED: ' + f.slice(ROOT.length));
process.exit(fail ? 1 : 0);
