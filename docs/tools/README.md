# Tool docs

User-facing documentation, one page per tool in the Invisible Wall pipeline.

Our tools are branded **"Invisible …"**; third-party products keep their real
names. Every online tool is reached through **the launcher** at
`app.invisiblewall.org` after you sign in (it gates by role and opens the tool
full-page — never in an iframe). Local tools you install on your own machine.

> These guides are also readable inside the launcher: each tool's onboarding
> card links to `/docs/<slug>` (rendered from the matching file here). The
> source of truth stays in this folder — edit the markdown here, not in the app.

## Online tools (run in the launcher)

| Tool | Opens at | Default roles | Doc |
|---|---|---|---|
| **The Launcher** (the portal itself) | `app.invisiblewall.org` | all | [launcher.md](launcher.md) |
| **Invisible Game Maker** | `/game-maker` | admin · developer | [game-maker.md](game-maker.md) |
| **Invisible Scene Editor** | `/editor` | admin · developer · artist | [invisible-editor.md](invisible-editor.md) |
| **Invisible Flow** | `/flow` | admin · developer · artist | [flow.md](flow.md) |
| **Invisible FX** | `/fx` | admin · developer · artist | [fx.md](fx.md) |
| **Invisible Symbols State Machine** | `/symbols` | admin · developer · artist | [symbols-state-machine.md](symbols-state-machine.md) |
| **Invisible Sheet Maker** | `/sheet` | admin · artist | [sheet-maker.md](sheet-maker.md) |
| **Invisible Atlas Maker** | `/atlas` | admin · developer · artist | [atlas-maker.md](atlas-maker.md) |
| **Invisible Component Editor** | `/components` | admin · developer · artist | [component-editor.md](component-editor.md) |
| **Invisible Storybook** | `/storybook` | admin · developer | [storybook.md](storybook.md) |
| **Invisible Spine Viewer** | `/spine` | admin · developer · animator | [spine-viewer.md](spine-viewer.md) |
| **Invisible Rigger** | `/rigger` | admin · developer · animator | [rigger.md](rigger.md) |
| **Invisible Font Maker** | `/fonts` | admin · developer · artist | [font-maker.md](font-maker.md) |
| **Invisible Localization** | `/localization` | admin · developer · artist | [localization.md](localization.md) |
| **Invisible FTP Browser** | `/files` | admin · developer | [ftp-browser.md](ftp-browser.md) |

## Local tools (install on your machine)

| Tool | Where it runs | Default roles | Doc |
|---|---|---|---|
| **Invisible Launcher** (desktop ComfyUI + tunnel manager) | your machine | admin · developer · artist | [invisible-launcher.md](invisible-launcher.md) |
| **Spine Editor** (third-party) | your machine (licensed) | admin · animator | [spine-editor.md](spine-editor.md) |
| **ComfyUI** (third-party) | your GPU, via the Invisible Launcher | — (powers the Atlas Maker) | [comfyui.md](comfyui.md) |

> Roles are the **defaults** from `ROLE_TOOLS` in
> `apps/launcher-api/src/lib/roles.ts`; admins can grant/revoke any tool per role
> or per user from the admin panel. The launcher is the single registry — add a
> tool there (`TOOLS`, `ROLE_TOOLS`, `TOOL_BAR_ORDER`, `TOOL_DOC_SLUG`) **and add
> its doc here in the same change** (see the docs rule in the root `CLAUDE.md`).

For the authoritative live state, deploy details and env vars see
[`../STATUS.md`](../STATUS.md) and [`../INFRA.md`](../INFRA.md). New-starter
setup is in [`../ONBOARDING.md`](../ONBOARDING.md). Cross-cutting naming rules
(e.g. [symbol naming](../conventions/symbol-naming.md)) live in
[`../conventions/`](../conventions/).
