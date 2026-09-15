/**
 * Read a source file as text with LF newlines, whatever the checkout uses.
 *
 * Why this is shared rather than re-typed in every guard: a guard that greps source and names a line
 * break in its pattern is RED on any Windows clone (`core.autocrlf=true`) unless it normalizes. The
 * failure is not obvious — a LEADING `\n` in a pattern survives CRLF and a TRAILING one does not, so
 * it reds in ones and twos and reads like a real contract breach rather than an environment problem.
 * It has shipped that way twice (`check:clear-reel`, 2-of-33 on 2026-09-10; `check:tumble-pattern`,
 * 1-of-34 on 2026-09-15), both times found by someone hitting it locally and never by CI, because CI
 * runs on LF. The danger is the repair, not the red: a guard that cries wolf gets ignored, or
 * "fixed" by weakening the assertion, which is how a bundle-path check stops checking.
 * See `docs/status/symbols.md` for the full story.
 *
 * NOT for generators. `gen-*`, `sync-*`, `i18n-*` and anything that writes a file back read the
 * CURRENT bytes in order to compare or rewrite them; normalizing there would silently rewrite the
 * file's line endings as a side effect. Those call `readFileSync` directly, on purpose.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One source file, LF-normalized. Takes anything `readFileSync` takes — a path string or a URL. */
export const readLF = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

/** The common shape: a reader bound to a base directory, so callers pass repo-relative paths. */
export const lfReaderFrom = (baseDir) => (rel) => readLF(join(baseDir, rel));
