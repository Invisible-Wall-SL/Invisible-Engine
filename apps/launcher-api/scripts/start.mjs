// Production entry: set the env defaults adapter-node reads AT IMPORT, then boot the built server.
//
// `BODY_SIZE_LIMIT` exists here because adapter-node caps request bodies at 512 KB and offers no
// build-time option for it — it reads the env var when `build/index.js` initialises. That default
// silently 413s the game-bundle relay (`api/launcher/game-upload`): a game's art pages and audio
// are routinely 1–6 MB per file, so 89 of one real bundle's 528 files were over the cap. Setting it
// in code follows the house convention that non-secret config must not depend on the Railway
// dashboard (`apps/launcher-api/CLAUDE.md` §Conventions) — a var set there stages, and a publish
// that fails only for big files is a confusing way to find that out.
//
// A value already in the environment WINS, so the dashboard can still raise or lower it.
process.env.BODY_SIZE_LIMIT ??= '32M';

await import('../build/index.js');
