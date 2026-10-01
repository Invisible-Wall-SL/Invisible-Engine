import { registerHooks } from 'node:module';
import { resolve } from './appStubs.hooks.mjs';

// In-thread hooks, not `register()`: tsx ≥ 4.20 resolves through `registerHooks` itself and
// short-circuits every specifier, so an off-thread hook never sees one. In-thread hooks run
// last-registered-first, and this file is imported after tsx's loader.
registerHooks({ resolve });
