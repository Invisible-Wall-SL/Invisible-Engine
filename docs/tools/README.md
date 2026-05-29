# Tool docs

User-facing documentation, one page per tool in the Invisible Wall pipeline.

Our tools are branded **"Invisible …"**; third-party products keep their real
names. Every online tool is reached through **the launcher** at
`app.invisiblewall.org` after you sign in (it gates by role and opens the tool
full-page — never in an iframe). Local tools you install on your own machine.

| Tool | Where it runs | Access | Doc |
|---|---|---|---|
| **The Launcher** | Cloud (Railway) | `app.invisiblewall.org` | [launcher.md](launcher.md) |
| **Invisible Atlas Maker** | Cloud (Railway) + your local ComfyUI | launcher → `/atlas` | [atlas-maker.md](atlas-maker.md) |
| **Invisible Spine Viewer** | Cloud (launcher static) | launcher → `/spine` | [spine-viewer.md](spine-viewer.md) |
| **Invisible Sheet Maker** | Cloud (Railway) | launcher → `/sheet` (route pending) | [sheet-maker.md](sheet-maker.md) |
| **Invisible Test Server** | Local | install via launcher | [test-server.md](test-server.md) |
| **ComfyUI** (third-party) | Local (your GPU) | runs locally, exposed via tunnel | [comfyui.md](comfyui.md) |

For the authoritative live state, deploy details and env vars see
[`../STATUS.md`](../STATUS.md) and [`../INFRA.md`](../INFRA.md). New-starter
setup is in [`../ONBOARDING.md`](../ONBOARDING.md).
