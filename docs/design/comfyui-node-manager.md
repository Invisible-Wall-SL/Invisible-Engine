# ComfyUI Node Manager — add a node from the launcher, rebuild, redeploy

> Current state: [status/comfyui](../status/comfyui.md) · Backend: [runpod-comfyui-backend](runpod-comfyui-backend.md) · The image: [`services/atlas-comfy-pod/`](../../services/atlas-comfy-pod/README.md) · Agents: `atlas-python-tools` (the image) + `launcher-studio` (the UI)

**One line:** turn "add a custom node" from a four-context developer loop into three buttons on `/comfyui` — **edit the node list · rebuild the image · move the pod to the new build** — without giving up the commit pinning that keeps R&D and prod on identical code.

## The loop today

Adding `ComfyUI-VideoHelperSuite` (2026-08-25) took: edit two `ARG`s in the pod Dockerfile → open a PR → squash-merge → wait **34 minutes** for CI → open the RunPod console → terminate the pod → deploy a new one from the image. Steps 1–3 need a developer with a repo checkout; steps 5–7 need the RunPod console. So the artist who needs the node cannot get it, and the person who can spends four context switches on a two-line change.

None of that is inherent. The launcher already holds every credential involved, and the CI workflow already accepts a manual trigger. What is missing is the plumbing between them — plus one prerequisite that matters more than any of the UI: **the 34 minutes.**

## What already exists (the green)

| Piece | Where | What it already does |
|---|---|---|
| RunPod client | `apps/launcher-api/src/lib/server/runpod.ts` | `gql()` against `api.runpod.io/graphql` with `RUNPOD_API_KEY`; `podResume`, `podStop`, `podProbe`, `podSpecs`, `probeFleet` |
| Fleet + admin | `appSettings.ts` (`runpodPods`), `/admin` | the pod list is already admin-managed data, not code |
| Fleet UI | `routes/(app)/comfyui/+page.svelte` | per-pod row, live status badge, specs line, Start/Open/Stop, a 5s status poll, inline per-row errors with Retry |
| Live node inventory | `comfyInventory.ts` + `/comfyui/inventory` | already reads **which node packs the answering pod loaded** (Manager API, falling back to a streamed `/object_info` scan). This is the READ half of the manager, built and shipping |
| GitHub client | `apps/launcher-api/src/lib/server/engineSource.ts` | already calls `api.github.com` with `GITHUB_ENGINE_READ_TOKEN` / `GIT_CLONE_TOKEN` against `GITHUB_ENGINE_REPO` |
| The build | `.github/workflows/atlas-comfy-pod.yml` | already declares `workflow_dispatch: {}`, and already tags **both** `:latest` and an immutable `:<sha>` |
| A dep guard | `services/atlas-comfy-pod/tools/verify-deps.py` | fails the build if the shared dep base stops importing — the check that catches a node dragging a package backwards |

Read that table honestly and the feature is mostly wiring, not invention.

## The gaps

### Gap 0 — the rebuild is 34 minutes (the prerequisite)

Docker's cache is linear: change a layer, and every layer after it rebuilds. The node clones sit **above** the node-requirements loop, the face-stack pip step and the 3 GB cu128 torch force-reinstall, so even a pure node addition invalidates the expensive tail. (The VideoHelperSuite build was worse still — it touched the apt line, layer 2 of 21, so *nothing* was reused.)

The clones sit there because of one rule: **cu128 torch must be the last pip step**, since any node's `requirements.txt` can drag torch back to a cu124 build that is dead on Blackwell. That rule is the reason the volatile part of the file is pinned under the expensive part.

Replace the ordering trick with a `constraints.txt` (`torch==2.11.0`, `torchvision==0.26.0`, `torchaudio==2.11.0`, plus the existing `ml_dtypes>=0.5.4` / `onnx>=1.22` floors) passed as `-c` to every pip step. Then nothing *can* move torch, the node section is free to move to the tail, and a node-only change rebuilds a few short layers. **This also closes a live hole:** the `|| true` requirements loop is currently free to rewrite any other shared package on the way past — exactly how `ComfyUI-PuLID-Flux2`'s `ml_dtypes==0.3.2` shipped an image whose face stack could not import (2026-08-20).

A rebuild button that costs half an hour is a coffee break. One that costs three minutes is a tool. **Phase 0 is not optional.**

### Gap 1 — the node list is `ARG`s, not data

A UI cannot edit `ARG PULID_REF=93e0c4c226b8`. The list has to become a file the build reads and a form can write.

### Gap 2 — the launcher cannot trigger CI

`workflow_dispatch` needs a token with `actions: write`. `GITHUB_ENGINE_READ_TOKEN` is, as named, read-only.

### Gap 3 — the launcher cannot change a pod's image

Today's client is GraphQL-only (resume/stop/query). Swapping an image is RunPod's **REST** API: `PATCH /pods/{podId}` accepts `imageName`, and the docs note it "potentially triggers a reset". So this is a second, small client next to the GraphQL one — not a rewrite of it.

### Gap 4 — nothing proves the new node actually works

`verify-deps.py` proves the shared dep base still imports. It says nothing about whether the node you just added **registered its classes**, which is the failure mode of a node pinned behind our core (`ComfyUI-PuLID-Flux2`, still unverified — status open item 8) or one that reaches into core internals.

## Design decisions

1. **The node list lives in git, and the UI edits it with a commit.** A `services/atlas-comfy-pod/nodes.json` (`{name, url, sha, notes}`), `COPY`'d into the build and looped over by the clone step. The UI writes it through the GitHub contents API, so every add is a real diff with an author and a revert.
   *Rejected: passing the node list as `workflow_dispatch` inputs.* It looks simpler and it destroys reproducibility — the image would then depend on form values nobody recorded, and `git checkout <sha> && docker build` would no longer reproduce what is running. The pinning work of 2026-08-19 exists precisely to stop that.
   *Rejected: the list in R2.* Same defect, plus it splits the source of truth away from the Dockerfile that consumes it.
2. **`constraints.txt` replaces the "torch last" trick** (Gap 0), which is what lets `nodes.json`, the clone step and the node requirements loop all sit in the cheap tail.
3. **Nobody types a ref.** The UI takes a repo URL, resolves it to the tip SHA server-side (`GET /repos/{owner}/{repo}/commits/HEAD`), shows the date and subject of the commit it is about to pin, and stores the SHA. A node pinned to a branch is how silent drift comes back.
4. **Pods move to the `:<sha>` tag, never `:latest`.** CI already pushes both. `:latest` is a mutable pointer, and a resumed pod may reuse a host's cached copy — moving a pod to an immutable tag makes "which build is this pod on?" answerable, and the card can then show it.
5. **Promotion to the serverless worker is explicit, never automatic.** A node added here lands on the **R&D pod only**. `services/atlas-serverless` gets it via a separate, deliberate action, because that image is the prod generation path and the repo rule is "promote after the R&D pod renders clean". Without the button, R&D and prod drift — status open item 9, of which VideoHelperSuite is now the first live case.
6. **A volume test lane, for trying rather than shipping.** ComfyUI's `init_external_custom_nodes()` scans *every* path in `folder_paths.get_folder_paths("custom_nodes")`, and `extra_model_paths.yaml` keys are appended to that list (verified against the `v0.33.1` pin, not assumed). So one line in `extra_model_paths.yaml` gives a volume-backed node directory that survives container recreation, and `pip install --target /workspace/pysite` + `PYTHONPATH` does the same for its deps — two minutes instead of a build **and** a redeploy. It is deliberately Phase 5 and deliberately labelled a test lane: a node living only on a volume is un-pinned, invisible in git, can differ per pod, and does not exist on the serverless worker.

## Build plan (phases)

### Phase 0 — `constraints.txt` + reorder the image *(gate)* — ✅ DONE (2026-08-25)
Move the node clones, their requirements loop and the apt extras below the torch step; pin torch through constraints instead of through ordering. **Gate: a node-only change rebuilds in under ~5 minutes and `verify-deps.py` still passes.** No UI work starts until this holds — everything downstream is only pleasant if the build is short.

Shipped: `constraints.txt` is exported as `PIP_CONSTRAINT` so it binds every pip step (and every pip on a live pod); torch moved to the FIRST pip step and is now installed once instead of twice; the face stack moved above the nodes; `verify-deps.py` gained a torch-BUILD assertion to replace what the ordering used to guarantee. **Gate MET, measured 2026-08-25:** a fully-cached rebuild is **2m6s**, against 33m for a full one, so a node-only change lands around 3-4 minutes once its own layers are added. The export/push worry was unfounded in the way that mattered: the ~18 minutes of push in a FULL build is the cost of uploading every layer as new, and with a cached prefix only the changed layers upload. Phase 1 can therefore be an interactive button rather than a fire-and-forget job. Details in [status/comfyui](../status/comfyui.md).

### Phase 1 — Rebuild + Move-pod buttons (no node editing yet) — ✅ DONE (2026-08-25)
Two server actions and two buttons on `/comfyui`: **Rebuild image** (`workflow_dispatch` → poll the run → show status inline, reusing the existing poll) and **Move this pod to build `<sha>`** (`PATCH /pods/{podId}` with the `:<sha>` tag, then resume). Show each pod's current image tag on its card. Needs `GITHUB_ACTIONS_TOKEN` (scope `actions: write`) on the launcher.
*This phase alone removes the RunPod console from the loop* — worth shipping on its own.

Shipped as planned, plus one thing the plan did not call for: **the move READS the pod before it writes.** RunPod REST had never been called from here, and its own docs describe the PATCH as "potentially triggering a reset" — so the endpoint GETs the pod first (proving base URL, auth and field names with a request that cannot break anything), PATCHes only `imageName`, then reads back and reports before/after including ports and volume mount. That turns "trust me" into evidence for the one call here that can damage something. Moving a RUNNING pod is refused outright.

### Phase 2 — `nodes.json` + the add/remove UI
The Dockerfile reads the list; the page grows a node table (name · pinned SHA · commit date · remove) and an **Add node** form that resolves a URL to a SHA and commits the change. Adding a node = one commit + one dispatch, both from the browser.

### Phase 3 — Post-build smoke: do the new node's classes register?
After a build lands and a pod is moved, hit the pod's `/object_info` and check the added pack contributed classes; surface a per-node **verified / not seen** badge. This is the check `verify-deps.py` structurally cannot do, and the one that would flag a node pinned behind our core.

### Phase 4 — Promote to the serverless worker
The same list, a second target, an explicit button; keeps `atlas-serverless` in lockstep on purpose rather than by memory.

### Phase 5 — The volume test lane *(optional)*
`custom_nodes:` in `extra_model_paths.yaml` + `PYTHONPATH=/workspace/pysite` in `start.sh`, and a UI affordance that installs a node there for an immediate try, clearly marked temporary, with a "bake this one" action that turns it into a Phase 2 commit.

## Risks / failure modes

- **Self-service installs are what the pinning was introduced to control.** Mitigated by the commit path (every add is a revertible diff), by resolving SHAs server-side, and by `verify-deps.py` + Phase 3. Not mitigated by hoping.
- **A node's `requirements.txt` moves a shared package.** Already happened once. Constraints (Phase 0) turn it from a silent green build into a resolution error.
- **`PATCH` resets a running pod.** It must confirm — an artist mid-render will lose the session.
- **CI minutes.** This repo is private, so every rebuild is billed Actions time, and a button makes rebuilds frequent. Phase 0 cuts the per-build cost; a "there is already a build running" guard avoids stacking them.
- **RunPod schema drift.** `podSpecs` already queries in tiers because `machine`'s sub-fields are the least certain part of the schema. Any new call takes the same shape: degrade a line, never a card.

## Key file anchors

| Concern | File |
|---|---|
| Node list + image | `services/atlas-comfy-pod/Dockerfile`, `nodes.json` (new), `constraints.txt` (new) |
| Dep guard | `services/atlas-comfy-pod/tools/verify-deps.py` |
| Build | `.github/workflows/atlas-comfy-pod.yml` (already has `workflow_dispatch`) |
| Prod twin | `services/atlas-serverless/Dockerfile` |
| RunPod calls | `apps/launcher-api/src/lib/server/runpod.ts` (+ a small REST client for `PATCH /pods/{id}`) |
| GitHub calls | `apps/launcher-api/src/lib/server/engineSource.ts` (pattern), `env.ts` (new `GITHUB_ACTIONS_TOKEN`) |
| UI | `apps/launcher-api/src/routes/(app)/comfyui/+page.svelte` + the `/comfyui/*` endpoints |
| Live inventory | `apps/launcher-api/src/lib/server/comfyInventory.ts` |
