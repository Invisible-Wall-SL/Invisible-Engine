// Verify the Rigger page itself, headlessly, on the SHIPPED view.html:
//  - every inline <script> parses. One syntax error anywhere stops the whole page, and nothing
//    else here loads the full page (the other spikes pull out single functions) — a literal
//    newline inside a string, written by a shell heredoc, once broke it this way unseen;
//  - the New-rig "Apply" choice sends a saved rig as `rigId` and a template as `templateId`;
//  - after a create from a template, the missing parts are named (needed ones first), and nothing
//    is shown when the art has every part.
//   node tools/rigger-spike/new-rig-template.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url),
	'utf8',
);
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

const dir = mkdtempSync(join(tmpdir(), 'rigger-page-'));
try {
	blocks.forEach(([, attrs, body], i) => {
		const file = join(dir, `s${i}${/\bmodule\b/.test(attrs) ? '.mjs' : '.js'}`);
		writeFileSync(file, body);
		try {
			execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
			ok(`inline script ${i} parses`, true);
		} catch (e) {
			ok(
				`inline script ${i} parses`,
				false,
				String(e.stderr).split('\n').slice(0, 4).join('\n        '),
			);
		}
	});
} finally {
	rmSync(dir, { recursive: true, force: true });
}
ok('the page has inline scripts to check', blocks.length > 0);

const src = blocks.map((b) => b[2]).join('\n');
function grab(name) {
	const at = src.indexOf(`function ${name}(`);
	if (at === -1) throw new Error(`view.html has no function ${name}`);
	let depth = 0;
	let j = src.indexOf('{', at);
	for (; j < src.length; j++) {
		if (src[j] === '{') depth++;
		else if (src[j] === '}' && --depth === 0) break;
	}
	return src.slice(at, j + 1);
}

const select = { value: '' };
const alerts = [];
const { newRigApplyChoice, reportTemplateParts } = new Function(
	'$',
	'showAlert',
	`${grab('newRigApplyChoice')}\n${grab('reportTemplateParts')}\nreturn { newRigApplyChoice, reportTemplateParts };`,
)(
	() => select,
	(message, title) => alerts.push({ title, message }),
);

const choice = (v) => {
	select.value = v;
	return JSON.stringify(newRigApplyChoice());
};
ok('no choice sends nothing', choice('') === '{}');
ok('a saved rig is sent as rigId', choice('lib-1') === '{"rigId":"lib-1"}');
ok(
	'a template is sent as templateId',
	choice('template:bust-face') === '{"templateId":"bust-face"}',
);

reportTemplateParts(undefined);
reportTemplateParts({ id: 'bust-face', missing: [], missingRequired: [] });
ok('no popup when the art has every part', alerts.length === 0);
reportTemplateParts({
	id: 'bust-face',
	missing: ['mouth_O', 'nose'],
	missingRequired: ['mouth_O'],
});
const m = alerts[0]?.message ?? '';
ok(
	'missing parts are named, the needed ones first and apart',
	alerts.length === 1 &&
		m.indexOf('mouth_O') < m.indexOf('nose') &&
		/Needed[^\n]*\n {2}mouth_O\n\nOptional[^\n]*\n {2}nose\n/.test(m),
	JSON.stringify(m),
);

if (fails) {
	console.error(`new-rig template: ${fails} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`new-rig template: ${checks}/${checks} checks pass`);
