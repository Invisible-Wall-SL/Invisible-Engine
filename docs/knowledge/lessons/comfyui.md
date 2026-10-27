# ComfyUI — lessons

What has bitten ComfyUI work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/comfyui.md](../../status/comfyui.md); this file only keeps the traps.
Covers the generation path (Atlas Maker → RunPod Serverless worker, `services/atlas-serverless`),
the R&D pod fleet (`/comfyui`, `services/atlas-comfy-pod`), the `nodes.json` node list and a
person's own ComfyUI over the tunnel. Runbooks and env vars: `docs/INFRA.md` "ComfyUI".

### Every background cutout failed for hours
- **Symptom:** every cutout on the serverless worker failed until someone noticed.
- **Cause:** the worker linked the volume's shared `models/RMBG/`, a folder the node itself
  rewrites; it tore once (2026-09-04) and broke every job.
- **Fix:** the worker skips `RMBG`, and `fetch-models.py --verify --stage` copies checksummed
  `rmbg` + `birefnet` files into the container; a bad file is left for the node to fetch locally.
- **Guard:** boot log `== verified N file(s)`; `services/atlas-comfy-pod/test_fetch_models.py`.
- **PR:** not recorded (2026-09-30) · source: `docs/status/comfyui.md`

### A graph showed UNKNOWN nodes that one machine had
- **Symptom:** an artist's graph opened with red `UNKNOWN` stubs; the blueprint could never run.
- **Cause:** two packs it needed were on nobody's list: `nodes.json` is what the images, the panel
  and `sync-local-nodes.py` read. And the worker Dockerfile ignored `skipRequirements`.
- **Fix:** both packs listed (vendored / pinned); the worker applies the same skip filter.
- **Guard:** none; a flag honoured on one of two images is worse than none. Check both Dockerfiles.
- **PR:** not recorded (2026-09-16) · source: `docs/status/comfyui.md`

### Generation failed with error pulling image denied
- **Symptom:** RunPod could not pull the endpoint image (`denied`), so no job ran.
- **Cause:** the endpoint was set to the R&D POD image, which has no handler and sleeps forever;
  and both GHCR packages are private, with access granted per package, not "public" as documented.
- **Fix:** endpoint image is `atlas-comfy-worker`, never `atlas-comfy-pod`; vendored packs the
  worker needs are copied into its build too.
- **Guard:** none; INFRA "The endpoint's image is `atlas-comfy-worker`".
- **PR:** not recorded (2026-09-14) · source: `docs/status/comfyui.md`

### Extracted layers arrived on black
- **Symptom:** a MAIN_CHARACTER layer from the SemanticLayers router was opaque, not cut out.
- **Cause:** `merge_layers` returns `(rgb, mask)` and the router node dropped the mask, though
  Qwen's decode returns real per-layer alpha.
- **Fix:** `output_rgba` (default true) carries coverage as a 4th channel; empty roles are clear.
- **Guard:** `ComfyUI-SemanticLayers/tests/test_pipeline.py` (run by `scripts/check-python.py`).
- **PR:** not recorded (2026-09-10) · source: `docs/status/comfyui.md`

### Florence-2 keeps failing on the pod
- **Symptom:** four image cycles, four Florence-2 failures (last: every weight `UNEXPECTED`).
- **Cause:** its remote code is frozen at 2024 and breaks on current transformers; the native
  loader needs a converted checkpoint nobody has published. Pinning transformers back would drag
  IPAdapter, PuLID, RMBG and controlnet_aux with it.
- **Fix:** the default analyzer is CLIP zero-shot. Do not retry Florence-2.
- **Guard:** none (a rule). Note the pod's transformers differs from a dev box's.
- **PR:** not recorded (2026-09-10) · source: `docs/status/comfyui.md`

### A blueprint from the pod failed on another ComfyUI
- **Symptom:** `missing_node_type` (e.g. `PulidModelLoader`), then `value_not_in_list` on a model.
- **Cause:** blueprints are authored on the R&D pod; the target lacked the pack or the weights.
  The importer also wrote `"models": []`, so no blueprint declared what it needed.
- **Fix:** node types and models are checked before a job is spent; models are read out of the
  graph and resolved against the R2 mirror; `tools/sync-local-nodes.py` matches a local install.
- **Guard:** `test_blueprint_models.py`, `test_model_mirror.py`.
- **PR:** #604 (2026-09-07) · source: `docs/status/atlas-maker.md`

### My computer rendered in a data centre
- **Symptom:** "My computer" said "your ComfyUI has never answered" at a RunPod address.
- **Cause:** `COMFY_URL` on Railway was set to a pod; it must be the tunnel to a person's own
  ComfyUI. Production generation reads `RUNPOD_ENDPOINT_ID`, never `COMFY_URL`.
- **Fix:** `ui_server` refuses a local render whose URL is a RunPod host (`_REMOTE_HOST_MARKERS`).
- **Guard:** that refusal.
- **PR:** not recorded (2026-09-04) · source: `docs/status/atlas-maker.md`

### A render showed Rendering 0 of 2 forever
- **Symptom:** no error, and the ComfyUI queue and history were both empty.
- **Cause:** `batch_atlas.comfy_post` (the `/prompt` submit) had no timeout; a Cloudflare host
  whose tunnel connector is down completes TLS and then never answers.
- **Fix:** `/prompt` is capped (`_COMFY_POST_TIMEOUT`), and the panel surfaces the failure.
- **Guard:** `test_render_slot.py`. Every outbound call gets a timeout.
- **PR:** not recorded (2026-09-04) · source: `docs/status/atlas-maker.md`

### Cancelled jobs kept running and billing
- **Symptom:** the UI said cancelled; RunPod showed the worker still generating.
- **Cause:** RunPod `/cancel` does not interrupt a synchronous handler. And Stop only sent
  `/interrupt`, which aborts what ComfyUI runs now, not the queue.
- **Fix:** the worker polls its own status and kills ComfyUI on `CANCELLED` (`_job_cancelled`);
  it needs `RUNPOD_ENDPOINT_ID` + `RUNPOD_API_KEY` set on the ENDPOINT. Stop cancels remote jobs.
- **Guard:** the worker logs a line at the first cancel check when they are missing.
- **PR:** not recorded (2026-09-02; 2026-09-04) · source: `docs/INFRA.md`

### Update to sha pointed pods at a missing image
- **Symptom:** RunPod refused the container: `manifest unknown` on a 12-character tag.
- **Cause:** CI pushes `:<full 40-char sha>`; the panel shortened it before sending it to RunPod.
- **Fix:** `imageForSha` (`podImage.ts`) takes the full sha; `shortSha` is display-only.
- **Guard:** none.
- **PR:** not recorded (2026-09-02) · source: `docs/status/comfyui.md`

### The panel said a healthy pod was broken
- **Symptom:** 0 models, 0 node packs, or `8188 → 404` and `8189 → 502` with ComfyUI running.
- **Cause:** a RunPod port is HTTP or TCP, not both: exposing TCP 8188 removes its HTTP proxy.
  The code then kept the derived (dead) proxy URL because `pod.url` is always truthy.
- **Fix:** the image serves ComfyUI on two ports; both URL candidates are re-checked with
  `comfyReady()` before use.
- **Guard:** none.
- **PR:** not recorded (2026-08-19; 2026-08-20) · source: `docs/status/comfyui.md`

### A green image build shipped a broken face stack
- **Symptom:** nothing failed; the build log showed `ml_dtypes` 0.6 → 0.3.2 and `onnx` downgraded.
- **Cause:** each node's `requirements.txt` is applied with `|| true`, so a stale pin is honoured
  silently; `ml_dtypes` 0.3.2 cannot import under numpy 2, and insightface needs it via onnx.
- **Fix:** the face-stack step (after the loop) carries floors (`ml_dtypes>=0.5.4`, `onnx>=1.22`).
- **Guard:** none; read the build log of a green image. Unpinned packs go in `skipRequirements`.
- **PR:** not recorded (2026-08-20) · source: `docs/status/comfyui.md`

### The idle watchdog stopped pods mid-session
- **Symptom:** "ComfyUI keeps disconnecting, I can't finish processing my network".
- **Cause:** `comfyQueueBusy` read "could not reach ComfyUI" as "queue empty" (ComfyUI goes silent
  while busiest), and the `/comfyui` heartbeat stopped once the artist switched to the pod tab.
- **Fix:** tri-state busy (unknown = busy), a one-hour lease on Open, a 3-tick debounce.
- **Guard:** none; this area has no committed regression test.
- **PR:** not recorded (2026-08-19) · source: `docs/status/comfyui.md`

### Pod link says access denied from a page only
- **Symptom:** clicking a pod link from a tool gives Chrome's 403; pasting it in a tab works.
- **Cause:** RunPod's proxy rejects any browser request with `Sec-Fetch-Site: cross-site`; it is
  their edge rule, not our pod, and no header tweak gets past it.
- **Fix:** the card links the direct TCP endpoint instead of the proxy.
- **Guard:** none; INFRA "ComfyUI R&D pod" documents it.
- **PR:** not recorded (2026-08-19) · source: `docs/status/comfyui.md`

### Each new serverless variant overwrote the last
- **Symptom:** a region only ever kept one variant from the serverless backend.
- **Cause:** every job lands on a fresh worker whose save counter restarts at `00001`.
- **Fix:** `batch_atlas._next_variant_filename` numbers variants locally; prefers `SaveImage`.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-08-15) · source: `docs/status/atlas-maker.md`

### Back-to-back serverless jobs ran out of VRAM
- **Symptom:** a 24 GB worker OOM'd after a few jobs.
- **Cause:** controlnet_aux DepthAnything loads a transformers model outside ComfyUI's memory
  manager, so `/free` cannot release it.
- **Fix:** `handler.py` restarts ComfyUI before a job when free VRAM is below
  `RESTART_VRAM_FRACTION`.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-08-15) · source: `docs/status/comfyui.md`

### A resumed pod crash-looped
- **Symptom:** an R&D pod that ran yesterday would not start ComfyUI after Start.
- **Cause:** RunPod recreates the container on resume, wiping hand-installed site-packages; only
  the Network Volume survives.
- **Fix:** the baked pod image; try a node on the volume (`custom_nodes` + `/workspace/pysite`).
- **Guard:** none; never hand-install into a pod's container.
- **PR:** not recorded (2026-08-13) · source: `docs/status/comfyui.md`

### Python calls to the tunnel got 403
- **Symptom:** every Atlas Maker call to ComfyUI over a Cloudflare host returned 403.
- **Cause:** Cloudflare blocks the default `Python-urllib` User-Agent.
- **Fix:** all calls send `InvisibleAtlas/1.0` via `iw_common.comfy.cf_headers()`.
- **Guard:** none; never add a ComfyUI call that skips `cf_headers()`.
- **PR:** not recorded (2026-05-31) · source: `docs/INFRA.md`
