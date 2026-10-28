/**
 * The layout doc on stdin, as the editor's save stores it and its load reads it back: the real
 * server reader (`editorStorage.normalizeDoc`), through JSON as R2 holds it. Run with the launcher's
 * scripts tsconfig (`$env` stubbed), by `screenFxEditor.mjs`.
 */
import { readFileSync } from 'node:fs';
import { normalizeDoc } from '../../../apps/launcher-api/src/lib/server/editorStorage';

const doc = normalizeDoc(JSON.parse(readFileSync(0, 'utf8')), 'project');
process.stdout.write(JSON.stringify(JSON.parse(JSON.stringify(doc))));
