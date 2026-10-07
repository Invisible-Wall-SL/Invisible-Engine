# Publisher runbook — ☁ Publish and 📦 Deliver a standalone game

One page for whoever ships a game build from the desktop **Invisible Launcher**. The full guide
(every button, why it works that way) is [tools/invisible-launcher.md](../tools/invisible-launcher.md).

## Before you start

| You need | Check |
| --- | --- |
| Invisible Launcher **v1.0.56 or newer** | header → *Check for updates* |
| A portal account with **Build & publish games** (`gamePublish`) | an admin grants it in `/admin` → Roles or the user panel |
| The project synced to this machine | Projects → **↻ Sync from cloud**; its card shows ☁ Publish |
| Node 22 + pnpm | the launcher offers to set them up the first time a build needs them |

You do **not** need R2 credentials. Builds upload through the portal as you.

## ☁ Publish — put a build on our test server

1. **Author and save online first.** A build compiles whatever is saved in the portal (scenes,
   flow, Game Config, art). An unsaved tab is not in the build.
2. On the card, set **🐞 Debug** (in-game debug tools) and **🗜 Optimize** (smaller upload) as
   wanted, then press **☁ Publish**.
3. Watch the progress log: update to `origin/main` → advance the engine → build → upload through the
   portal (unchanged files are skipped) → register the card → wait until the live server serves
   *this* build.
4. The final dialog shows the **build number**, the **engine / game / lockfile** fingerprints, and
   the game URL. **✓ LIVE & VERIFIED** means the test server is already serving it.

To check which build a running game is: open the browser console and type `__IE_BUILD__`, or open
`https://games.invisiblewall.org/<cloud key>/build-info.json`.

## 📦 Deliver — hand a build to a partner

1. **Untick 🐞 Debug** unless the partner asked for it: Debug ships our tooling to their site.
2. Press **📦 Deliver**. Pick the **profile** (`operator-embed` for a real handover). Check the
   **alias** against the partner's CDN folder name: a wrong alias means their script tag 404s.
3. When it finishes, **▶ Play it**. Paste a session token from their platform and their RGS origin,
   and it plays exactly as it will on their page. This is the only way to open a delivery.
4. Send the partner the **`<alias>.zip`**. The folder inside goes on their CDN. `embed.html` at the
   zip root goes on their application server, not the CDN. `EMBED.md` explains both, and its §5
   names the exact build, which they can quote back to you.

## When the engine refuses the build

The engine now stops a build rather than ship something broken. The launcher shows its reason and
its findings in a **Build refused** dialog. You can override from the dialog, but only by ticking
*I understand — ship this anyway* and then pressing **Build anyway**.

| Refusal | What it means | Fix it properly |
| --- | --- | --- |
| **The flow failed validation** | the Invisible Flow graph has errors (e.g. one exec-out wired twice, a missing scene) | Invisible Flow → Validation panel, save, publish again |
| **The paytable disagrees with the partner's** | the authored paytable no longer matches the one captured from the partner's `/config` | Invisible Game Config → fix or re-import the paytable |
| **The game references art that will not ship** *(Deliver only)* | placed regions or rigs that no shipped atlas contains | re-pick or re-pack them in the editor |

Override only when you know why the check is wrong for this build. Nothing is published or
delivered until you confirm. A missing-art override re-packages the build you already have, so it
takes seconds; a flow or paytable override rebuilds.

## Other failures

| Message | Do this |
| --- | --- |
| *needs "Build & publish games" (gamePublish)* | ask an admin for the capability |
| *N file(s) are over the portal's … MB per-file limit* | tick **🗜 Optimize** and publish again (it re-encodes PNG pages as WebP) |
| *'…' is published ONLINE by the Invisible Game Maker* | give the desktop build its own cloud key (e.g. `<game>build`) in Edit → Cloud publish |
| *Session expired — sign in again* | sign in from the header and press ☁ Publish again. The unchanged files are skipped, so the retry is quick. |
| *Uploaded, but the live server hadn't caught up* | wait a minute and reopen the game. The build is already in the cloud. |
| *Build failed (exit N)* + a log tail | a real build error. The full log is `%TEMP%\iw_build_<key>.log`. |

## About 🗜 Optimize

Optimize makes the upload smaller without changing how the game looks. PNG atlas pages become
**near-lossless WebP**, the setting the engine's page store uses: each pixel moves by at most
4/255, and there is no banding. Pages the server already encoded are left untouched, other PNGs are
re-packed losslessly, and audio is trimmed to mp3. Log: `%TEMP%\iw_optimize.log`.

## For the owner

- The R2 write key is **not needed on any publisher's machine** from v1.0.56, so it can be rotated
  without touching a desktop (see [INFRA.md](../INFRA.md) "Security / secret rotation").
- Settings has an **Advanced** switch, *☁ Publish games straight to R2 with saved owner
  credentials*. It is off by default. With it on, uploads go straight to the bucket, and the
  launcher falls back to the portal if R2 is blocked or rejects the saved key.
