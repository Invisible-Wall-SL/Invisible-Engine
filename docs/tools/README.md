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
| **Invisible Game Maker** | `/game-maker` | admin · developer · pipeline tester | [game-maker.md](game-maker.md) |
| **Invisible Scene Editor** | `/editor` | admin · developer · artist · pipeline tester | [invisible-editor.md](invisible-editor.md) |
| **Invisible Flow** | `/flow-v2` | admin · developer · artist · pipeline tester | [flow.md](flow.md) |
| **Invisible FX** | `/fx` | admin · developer · artist · pipeline tester | [fx.md](fx.md) |
| **Invisible Flipbook** | `/flipbook` | admin · developer · artist · pipeline tester | [flipbook.md](flipbook.md) |
| **Invisible Symbols State Machine** | `/symbols` | admin · developer · artist · pipeline tester | [symbols-state-machine.md](symbols-state-machine.md) |
| **Invisible Sheet Maker** | `/sheet` | admin · artist · pipeline tester | [sheet-maker.md](sheet-maker.md) |
| **Invisible Atlas Maker** | `/atlas` | admin · developer · artist · pipeline tester | [atlas-maker.md](atlas-maker.md) |
| **ComfyUI** (third-party) | `/comfyui` | admin · developer · artist | [comfyui.md](comfyui.md) |
| **Invisible Component Editor** | `/components` | admin · developer · artist · pipeline tester | [component-editor.md](component-editor.md) |
| **Invisible Storybook** | `/storybook` | admin · developer · pipeline tester · music/SFX | [storybook.md](storybook.md) |
| **Invisible Spine Viewer** | `/spine` | admin · developer · animator · pipeline tester | [spine-viewer.md](spine-viewer.md) |
| **Invisible Rigger** | `/rigger` | admin · developer · animator | [rigger.md](rigger.md) |
| **Invisible Cinematic** | `/rigger` → 🎬 Cinematic (a mode, not a separate tool — so no registry entry of its own) | admin · developer · animator | [rigger.md §Cinematic mode](rigger.md#cinematic-mode) |
| **Invisible Font Maker** | `/fonts` | admin · developer · artist · pipeline tester | [font-maker.md](font-maker.md) |
| **Invisible Win Text** | `/win-text` | admin · developer · artist · pipeline tester · localization reviewer | [win-text.md](win-text.md) |
| **Invisible Game Config** | `/config` | admin · developer · artist · pipeline tester | [game-config.md](game-config.md) |
| **Invisible Localization** | `/localization` | admin · developer · artist · pipeline tester · localization reviewer | [localization.md](localization.md) |
| **Invisible FTP Browser** | `/files` | admin · developer · pipeline tester · music/SFX | [ftp-browser.md](ftp-browser.md) |

## Local tools (install on your machine)

| Tool | Where it runs | Default roles | Doc |
|---|---|---|---|
| **Invisible Launcher** (desktop ComfyUI + tunnel manager) | your machine | admin · developer · artist · pipeline tester · music/SFX | [invisible-launcher.md](invisible-launcher.md) |
| **Spine Editor** (third-party) | your machine (licensed) | admin · animator | [spine-editor.md](spine-editor.md) |

> The full role list (admin · developer · artist · animator · pipeline tester ·
> localization reviewer · music/SFX) and what each one gets is in
> [launcher.md](launcher.md#roles-and-the-tool-manifest).
>
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
