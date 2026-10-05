// The harness report: `report.json` (what the Pipeline Changes UI and the commit status read) and
// a static `index.html` beside it. One row per game — build / tests / looks the same — and, for a
// changed screen, before / after / diff images, the tolerance it ran with and its stable id
// (`<head sha>:<game>:<screen>:<diff hash>`, what an approval will name in Phase 5).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { redactReport } from './redact.mjs';

/**
 * pass / fail of one row; `null` for a row that was not rendered — no snapshot, not published, or a
 * desktop build's own bundle — which is visible in the report but never counts as a pass.
 */
export function rowVerdict(row) {
	if (row.build?.status === 'fail' || row.tests?.status === 'fail') return 'fail';
	if (row.looks.status === 'changed' || row.looks.status === 'error') return 'fail';
	if (row.looks.status === 'same') return 'pass';
	return null;
}

export function summarize(games, aborted) {
	const counts = { pass: 0, fail: 0, notRendered: 0 };
	for (const row of games) {
		const v = rowVerdict(row);
		if (v === 'pass') counts.pass++;
		else if (v === 'fail') counts.fail++;
		else counts.notRendered++;
	}
	const rendered = games.filter((g) => g.looks.status === 'same' || g.looks.status === 'changed');
	const changedScreens = games.flatMap((g) => g.screens.filter((s) => !s.pass).map((s) => s.id));
	const verdict = aborted || counts.fail || !rendered.length ? 'fail' : 'pass';
	const line = aborted
		? aborted
		: !rendered.length
			? 'no game was rendered'
			: `${counts.pass} pass · ${counts.fail} fail · ${counts.notRendered} not rendered · ` +
				`${changedScreens.length} changed screen(s)`;
	return { verdict, ...counts, rendered: rendered.length, changedScreens, line };
}

const esc = (s) =>
	String(s ?? '').replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);

const LOOKS = {
	same: 'looks the same',
	changed: 'changed',
	'own-bundle': 'own bundle — build + tests only',
	'no-snapshot': 'not rendered (no snapshot)',
	unpublished: 'skip: not published',
	refused: "not rendered (main's runtime refuses the snapshot)",
	error: 'error',
	skip: 'skip',
};

const pct = (r) => (r === undefined ? '' : `${(r * 100).toFixed(4)}%`);

function html(report) {
	const { summary } = report;
	const cell = (status, text) => `<td class="s-${esc(status)}">${esc(text ?? status)}</td>`;
	const rows = report.games
		.map((g) => {
			const looks = LOOKS[g.looks.status] ?? g.looks.status;
			const looksText =
				g.looks.status === 'changed'
					? `${g.looks.changed} of ${g.looks.of} screens changed`
					: g.looks.status === 'same'
						? `${looks} (${g.looks.of} screens)`
						: g.looks.detail
							? `${looks}: ${g.looks.detail}`
							: looks;
			const failedGates = (g.tests.gates ?? []).filter((x) => !x.pass).map((x) => x.gate);
			const smoke = g.tests.smoke;
			const testsText =
				g.tests.status === 'fail'
					? [
							failedGates.length ? `failed: ${failedGates.join(', ')}` : '',
							smoke?.failures?.length
								? `smoke: ${smoke.failures.map((f) => `${f.side}/${f.scenario} ${f.error ?? `errors ${f.errors}, stalls ${f.stalls}`}`).join('; ')}`
								: '',
						]
							.filter(Boolean)
							.join(' · ')
					: g.tests.status;
			const v = rowVerdict(g) ?? 'none';
			return `<tr class="v-${v}"><td><b>${esc(g.name)}</b><br><code>${esc(g.key)}</code></td><td>${esc(g.gameType ?? '—')}<br><small>script ${esc(g.script ?? '—')}</small></td>${cell(g.build.status, g.build.status)}${cell(g.tests.status, testsText)}${cell(g.looks.status, looksText)}<td>${g.notes.map(esc).join('<br>')}</td></tr>`;
		})
		.join('\n');
	const changed = report.games
		.flatMap((g) =>
			g.screens
				.filter((s) => !s.pass)
				.map(
					(
						s,
					) => `<section class="diff"><h3>${esc(g.name)} · ${esc(s.screen)} <small>(${esc(s.scenario)}, draw ${esc(s.draw)})</small></h3>
<p>${esc(s.reason)}${s.measured ? ` · measured ${pct(s.measured.diffRatio)} of pixels, worst block ${pct(s.measured.maxBlockRatio)}` : ''}</p>
<p><code>${esc(s.id ?? '')}</code></p>
<p class="tol">tolerance: <code>${esc(JSON.stringify(s.tolerance))}</code></p>
<div class="imgs">${['before', 'after', 'diff']
						.map((k) =>
							s.images?.[k]
								? `<figure><img src="${esc(s.images[k])}" loading="lazy"><figcaption>${k === 'before' ? 'before (main)' : k === 'after' ? 'after (branch)' : 'diff'}</figcaption></figure>`
								: '',
						)
						.join('')}</div></section>`,
				),
		)
		.join('\n');
	const noise = report.games
		.flatMap((g) =>
			g.screens.map(
				(s) =>
					`<tr><td>${esc(g.key)}</td><td>${esc(s.screen)}</td><td>${esc(s.draw)}</td><td>${s.identical ? 'byte-identical' : pct(s.measured?.diffRatio)}</td><td>${s.identical ? '' : pct(s.measured?.maxBlockRatio)}</td><td>${s.pass ? 'pass' : 'FAIL'}</td></tr>`,
			),
		)
		.join('\n');
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Current games report</title>
<style>
:root{--bg:#0f1115;--fg:#e8e8ea;--muted:#9aa0aa;--line:#2a2e36;--pass:#1f6f43;--fail:#8f2630;--warn:#7a5a12}
@media (prefers-color-scheme: light){:root{--bg:#fff;--fg:#16181d;--muted:#5d636e;--line:#dde0e5;--pass:#cdeedb;--fail:#f7d4d7;--warn:#f6e7bf}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;max-width:1400px}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.s-pass,.s-same{background:var(--pass)}.s-fail,.s-changed,.s-error{background:var(--fail)}.s-skip,.s-no-snapshot,.s-unpublished,.s-own-bundle,.s-refused{background:var(--warn)}
.verdict{font-size:20px;font-weight:700}.imgs{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;flex:1 1 300px}img{width:100%;border:1px solid var(--line)}
small,.tol{color:var(--muted)}code{word-break:break-all}details{margin:12px 0}
</style></head><body>
<h1>Current games</h1>
<p class="verdict">${summary.verdict === 'pass' ? 'PASS' : 'FAIL'} — ${esc(summary.line)}</p>
<p>branch <code>${esc(report.head?.sha)}</code> vs main <code>${esc(report.base?.sha)}</code> · seed <code>${esc(report.seed)}</code> · ${esc(report.viewport)} · ${esc(report.seconds)} s${report.shards ? ` · ${report.shards} shard(s)` : ''}</p>
${Object.entries(report.browser ?? {})
	.map(([name, paths]) => `<p><small>browser (${esc(name)}): ${esc(paths)}</small></p>`)
	.join('')}
<table><thead><tr><th>Game</th><th>Type</th><th>Build</th><th>Tests</th><th>Looks the same</th><th>Notes</th></tr></thead><tbody>
${rows}
</tbody></table>
${changed ? `<h2>Changed screens</h2>${changed}` : '<p>No changed screens.</p>'}
<details><summary>Every screen's measured difference (the noise record)</summary>
<table><thead><tr><th>Game</th><th>Screen</th><th>Draw</th><th>Differing pixels</th><th>Worst block</th><th></th></tr></thead><tbody>
${noise}
</tbody></table></details>
</body></html>`;
}

/**
 * Write `report.json` + `index.html` into `out`; returns the report with its summary. Everything in
 * it is redacted first: the summary line becomes the commit status, and the report an artifact.
 */
export function writeReport(out, data) {
	const clean = redactReport(data);
	const report = { ...clean, summary: summarize(clean.games, clean.aborted) };
	writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
	writeFileSync(join(out, 'index.html'), html(report));
	return report;
}

/**
 * A plain-text account of every row that is not a pass, for the job log: the artifact needs a
 * download, the log does not. Built from the (already redacted) report.
 */
const short = (text) =>
	text
		.replace(/\?[^\s):]*ie_determinism=[^\s):]*/g, '')
		.split('\n')
		.slice(0, 6)
		.join(' | ')
		.slice(0, 600);

export function digest(report) {
	const lines = Object.entries(report.browser ?? {}).map(
		([name, paths]) => `browser (${name}): ${paths}`,
	);
	for (const g of report.games) {
		const v = rowVerdict(g);
		const failedGates = (g.tests.gates ?? []).filter((x) => !x.pass);
		lines.push(
			`${v ?? 'not rendered'} · ${g.key} (${g.gameType ?? '—'}, script ${g.script ?? '—'}) · ` +
				`looks ${g.looks.status}${g.looks.of ? ` ${g.looks.changed ?? 0}/${g.looks.of}` : ''}` +
				(report.renderSeconds?.[g.key] ? ` · ${report.renderSeconds[g.key]} s rendering` : ''),
		);
		if (v === 'pass') continue;
		for (const note of g.notes ?? []) lines.push(`    note: ${note}`);
		if (g.looks.detail) lines.push(`    looks: ${short(g.looks.detail)}`);
		for (const gate of failedGates)
			lines.push(`    gate ${gate.gate}: ${(gate.tail ?? 'failed').slice(-300)}`);
		const failures = [...(g.tests.smoke?.failures ?? []), ...(g.looks.baseFailures ?? [])];
		for (const f of failures) {
			lines.push(
				`    ${f.side}/${f.scenario}: ${short(f.error ?? '')} errors ${f.errors} stalls ${f.stalls}`,
			);
			for (const c of f.console ?? []) lines.push(`      ${short(c)}`);
		}
		for (const s of g.screens.filter((x) => !x.pass))
			lines.push(
				`    screen ${s.screen} (${s.scenario}): ${s.reason}` +
					(s.measured?.box ? ` · box ${JSON.stringify(s.measured.box)}` : '') +
					` · frames ${s.state?.base?.frame ?? '-'}/${s.state?.head?.frame ?? '-'}` +
					` · screens ${s.state?.base?.screens?.join('>') ?? '-'} | ${s.state?.head?.screens?.join('>') ?? '-'}`,
			);
		for (const s of g.screens.filter((x) => !x.pass && x.heatmap))
			lines.push(`    ${s.screen} diff map:`, ...s.heatmap.map((r) => `      |${r}|`));
	}
	return lines.join('\n');
}

/**
 * `summary.txt` (verdict, then the status line) and `digest.txt` beside the report, for the
 * workflow's status step and log.
 */
export function writeSummaryFiles(out, report) {
	// Each scenario's slower side, for `costs.json` (the shard balance).
	const seconds = Object.fromEntries(
		report.games.flatMap((g) =>
			Object.entries(g.timings ?? {}).map(([sc, t]) => [
				`${g.key}/${sc}`,
				Math.round(Math.max(t.base, t.head)),
			]),
		),
	);
	writeFileSync(
		join(out, 'digest.txt'),
		`${digest(report)}\ncosts: ${JSON.stringify({ seconds })}\n`,
	);
	writeFileSync(join(out, 'summary.txt'), `${report.summary.verdict}\n${report.summary.line}\n`);
}
