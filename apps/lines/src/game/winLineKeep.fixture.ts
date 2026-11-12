/**
 * Offline fixture: the win line overlay (`WinLine.svelte`) keeps the stroke and the stamp it drew and
 * hands them each line after, where it used to mount them per line and destroy them at each hide:
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/winLineKeep.fixture.ts
 *
 * Pins, in the source:
 *   - kept only one line at a time with no big-win run-up; the list path is the one that ran before;
 *   - the kept stroke is shown while a line is up, drawn from the line it is handed;
 *   - the kept stamp is mounted the first time a line's stamp would have been, and shown exactly when
 *     a line's own was mounted (same conditions), at the line's place and fade;
 *   - the stamp reports its size to each line it is handed: the callback moves with the line, so it
 *     reports even when the new line's text is the old one's.
 */

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
let failures = 0;
const check = (label: string, ok: boolean): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}`);
	}
};

// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then(({ readFileSync }: Fs) => {
	const source = readFileSync(new URL('../components/WinLine.svelte', import.meta.url), 'utf8');
	const markup = source.slice(source.lastIndexOf('</script>'));
	console.log('WinLine.svelte');
	check(
		'kept only one line at a time with no big-win run-up',
		/const keep = !allAtOnce && !cueBigWin;/.test(source),
	);
	check(
		'the container stays once a kept line is drawn; the list path mounts it as before',
		markup.includes('{#if keep ? !!keptLine : lines.length || cue}'),
	);
	check(
		'the kept line is the one up, or the last one while none is',
		/const keptLine = \$derived\(keep \? \(lines\[0\] \? \(lastLine = lines\[0\]\) : lastLine\) : undefined\);/.test(
			source,
		),
	);
	check(
		'the kept stroke draws the kept line and shows while a line is up',
		/<Graphics draw=\{drawFor\(keptLine\)\} visible=\{keptUp\} \/>/.test(markup) &&
			/const keptUp = \$derived\(lines\.length > 0\);/.test(source),
	);
	check(
		"the kept stamp shows when a line's own stamp was mounted, and is mounted from the first time",
		/const keptStamps = \$derived\(\s*!!keptLine &&\s*keptUp &&\s*showText &&\s*!!keptLabel &&\s*keptLine\.progress\.current >= 1 &&\s*!!keptText,\s*\);/.test(
			source,
		) &&
			/const drawsKeptStamp = \$derived\(\(stampDrawn \|\|= keptStamps\)\);/.test(source) &&
			/\{#if drawsKeptStamp\}\s*<Container\s+x=\{keptLabel\?\.x\}\s+y=\{keptLabel\?\.y\}\s+alpha=\{keptLine\.fade\.current\}\s+visible=\{keptStamps\}/.test(
				markup,
			),
	);
	check(
		"…the list path's own condition being the same one",
		/\{@const stamps = showText && \(!centreText \|\| index === lines\.length - 1\)\}\s*\{#if stamps && label && entry\.progress\.current >= 1 && labelText\}/.test(
			markup,
		),
	);
	check(
		'the stamp reports its size to each line it is handed',
		/const keptResize = \$derived\.by\(\(\) => \{\s*const line = keptLine;/.test(source) &&
			/onresize=\{keptResize\}\s+text=\{keptText\}/.test(markup),
	);
	check(
		'every line strokes before its stamp in both paths',
		markup.indexOf('<Graphics draw={drawFor(keptLine)}') < markup.indexOf('{#if drawsKeptStamp}') &&
			markup.indexOf('<Graphics draw={drawFor(entry)} />') <
				markup.indexOf('{#each lines as entry, index (entry.id)}'),
	);
	if (failures) throw new Error(`winLineKeep.fixture: ${failures} FAILED`);
	console.log('\nwinLineKeep.fixture: all ok');
});
