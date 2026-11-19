# Character facings network — 8-direction character clips from ComfyUI

> Status: **planned 2026-11-19. No character has been made with it, and its stills stage has
> never run on a GPU.** One blueprint is drafted and checked offline (§3, stage 1); the rest is a
> plan waiting on the first experiment (§8).
> State: [status/flipbook](../status/flipbook.md). Agent: `atlas-python-tools` (blueprints, pod),
> `invisible-flipbook` (clips). Related: [invisible-flipbook-video](invisible-flipbook-video.md)
> (the video session this rides), [invisible-blueprints](invisible-blueprints.md),
> [model-licences](../reference/model-licences.md) (the licence authority),
> [game-families §9 #28](game-families.md) (the facings a game draws).

**Owner request (2026-11-19):** "now I want to be able to edit the sprites for the bear and the
fisherman … and we need to setup the 8 direction animations for them!" and, on where the frames
come from: "the 8 frames can come from different sources, and we still need to create a comfy ui
network to achive that".

So the game takes character frames from any source that meets one contract (§1): frames painted
by hand, a sheet imported in the Sheet Maker, or this network. This document plans the network.

## In short

1. **One still per facing, then one clip per state and facing.** A reference image becomes an
   approved **master** still of the character. The master is edited into the four other facings
   the game draws. Each still is then animated once per state, cut to transparent frames, packed
   into a sheet and saved as a clip named `<prefix>_<state>_<facing>`.
2. **Two models do it, both licence-clean:** Qwen-Image-Edit-2509 for the stills, Wan 2.2
   image-to-video for the motion. The video model, the matting and the packer are on the fleet,
   and the video session has rendered on the GPU. The edit model is in the licence registry but
   **not on the volume**, and its graph has never run.
3. **It cannot promise the bar the owner set.** The earlier generated clips were rejected
   (2026-11-09). An edit model can drift between facings, and a video model can slide the feet and
   miss the loop. §7 says how each is checked, and §8 is a small run that tells us before anything
   is built: one character, two facings, two states, about an hour of a person and a dollar or
   two of GPU.
4. **Every generated picture stays editable.** A facing still is a region in an atlas; a frame is
   a region in a sheet. §5 says how a person replaces either by hand.

## 1. The contract any source must meet

| | |
|---|---|
| Clip name | `<prefix>_<state>_<facing>`, lower case. Prefixes `bear`, `fisherman` |
| States | `bear`: `idle`, `walk`, `swipe`. `fisherman`: `idle`, `walk`, `cast`, `reel` |
| Facings drawn | `n`, `ne`, `e`, `se`, `s`. The game mirrors `nw`, `w`, `sw` from `ne`, `e`, `se` |
| Count | bear 3 × 5 = **15 clips**, fisherman 4 × 5 = **20 clips** |
| View | 2:1 isometric, the character upright. A 2:1 ground diamond means the camera looks down from 30° above the horizon |
| Size | drawn at the body's width: bear 92 px, fisherman 56 px |
| Anchor | the bottom centre of the clip's box is the feet |

A facing is a direction on the screen. `s` faces the viewer, `n` shows the back, `e` is a profile
facing right, `se` is the front three-quarter view and `ne` the back three-quarter view.

**One box per character.** The game draws a clip at `body width ÷ box width`, where the box is the
clip's ⬚ Bounds, or the frame's canvas when it has none (`SpawnLayer.svelte`). So every clip of one
character must carry **the same box size**, with its bottom edge on the ground line and its centre
on the feet. A box fitted to each clip's own ink (⊙ Fit per clip, as the superseded S0 runbook
said) draws a narrow front view larger than a long side view. The network keeps this by making
every still and every frame of a character on the same square canvas.

**Mirroring flips what is one-sided.** The fisherman's rod changes hands in `nw`, `w` and `sw`.
Keep the characters free of lettering and one-sided markings.

**The line is the game's.** The game draws the fishing line from the fisherman's hand. `cast` and
`reel` show the rod and no line.

## 2. What the network can and cannot promise

**It can:** produce stills and clips in the contract's names, canvas and anchor; use only models
the registry marks clear; repeat a render from its seed; leave every picture replaceable by hand.

**It cannot promise:**

- that five edits of one master read as the same character at the owner's bar;
- the exact camera height from a text prompt;
- feet that do not slide in a generated walk;
- a walk that closes into a loop without a second pass;
- a clean matte on hatched ink edges in every frame.

Today's bear art is a painting from straight above. An upright bear is a **new drawing** in that
painting's colours and ink. The model invents its face and its side, so the owner approves the
master before anything follows from it.

The likely outcome is uneven: `idle` is the easy state and `walk` the hard one. The plan is
ordered so a partial result is still useful. Five approved stills, with their background cut
(§5), are already 8-direction sprites: a one-frame clip per facing, with no video at all.

## 3. The stages

| # | Stage | Picked | Runs today? |
|---|---|---|---|
| 0 | Reference → master still (`se`) | Qwen-Image-Edit-2509 | no: model not on the volume, graph never run |
| 1 | Master → the other four facings | the same blueprint, one edit per facing | no, as above. **Drafted** |
| 2 | Still → motion, per state | Wan 2.2 I2V (`wan22_i2v_flipbook`) | the video session has rendered on the GPU since 2026-09-01. The docs do not say with which blueprint; the sessions they describe in detail used the owner's looping one |
| 3 | Video → transparent frames | BiRefNet inside the video graph | it runs, but no record shows a file coming back with alpha. The one packed sheet on record held opaque frames (its cutout setting is not recorded) |
| 4 | Frames → sheet and named clip | 🎞 Make flipbook (`video_to_clip.py`) | yes: a real render was packed (`S_New_Squid_Idle`, 2026-09) |

### Stage 0 and 1: the stills

The master and the facings are the same operation: an edit of a reference image, told what view
to draw. One blueprint does both.

| Candidate | For | Against |
|---|---|---|
| **Qwen-Image-Edit-2509, one edit per facing** (picked) | Apache-2.0. Identity comes from the reference image, with no face detector: the registry's own replacement for PuLID. The repo already carries its wiring (`qwen_bust_face_variant`). One model makes the master, a new character in the same style, and the facings. Seeds repeat | Not on the volume (20.4 GB). Never run here. The facing and camera come from the prompt only |
| FLUX.2 [klein] 4B edit | Apache-2.0, 12.5 GB, in the fetch list, takes several references | No graph in the repo. Node names unconfirmed |
| `gpt_image` | Runs today. Clear licence. Redraws a reference well | An API billed in credits, not our network. No seed. A credit-billed card cannot be reviewed for agents |
| One picture holding all five views, then sliced | The model keeps the character and the scale alike inside one image | About a fifth of the pixels per view, too few to start a 640 px video from |
| SDXL + IPAdapter + ControlNet (pose or depth) | All on the fleet | IPAdapter copies colour and texture, not the drawing. Juggernaut is "conditional" |
| A 3D mesh made from the picture, rendered from five angles | Perfect angle, scale and feet | New models and nodes, licence doubts (§10), a rendered look that is not the painting's |

**Picked: one Qwen-Image-Edit-2509 edit per facing, always from the master.** Editing from the
master each time means drift does not add up from facing to facing.

Drafted as `services/atlas-tool/blueprints_src/qwen_character_facing/`:

- The graph is `qwen_bust_face_variant`'s with one change. The latent is an empty square 1024
  instead of the encoded reference. The reference then only conditions the edit, so it can be any
  shape (the bear art is 256 × 138), and the still is always square, which the video stage needs.
- Roles: the region's prompt (the view instruction), its reference image, the seed. Width and
  height are left unbound on purpose. There is no cutout: the plain background is what the video
  stage animates and mattes.
- Checked offline by `test_character_facing_blueprint.py`: the tool's validators, a closed graph,
  no node class or input name that a bundled Qwen graph does not already use, every model declared
  and clear in the registry, and the runner's prompt, reference and seed handling.

**Starting prompts (written here, not run).** The atlas's positive suffix carries what every
facing shares; each region's prompt is one line.

| Use | Reference | Region prompt |
|---|---|---|
| Master from art | the art (`bear` in `salmons_characters`) | Redraw this bear as a game sprite standing on all four legs, seen from above at an isometric three-quarter angle, facing down-right towards the viewer. Keep its fur colours, ink outlines and hatching |
| Master from a description | another character's master | Replace the bear with a fisherman in waders and a brimmed hat, holding a fishing rod upright, with no fishing line. Same art style, outlines, hatching and palette, same camera angle, facing down-right towards the viewer |
| `s` | the master | Turn the character to face straight towards the viewer, a front view |
| `e` | the master | Turn the character to face right, a side view |
| `ne` | the master | Turn the character to face up-right, away from the viewer, a back three-quarter view |
| `n` | the master | Turn the character to face straight away from the viewer, a back view |

Shared suffix: *Keep the same character, proportions, colours, outline weight and art style, the
same size in the frame and the same camera height. Whole body in frame, centred, feet on one
ground line. Plain flat light grey background, no shadow, no ground, no text.*

**If the prompt cannot hold the angle or the scale** (§8 decides), the next step is a **guide
image**: a grey blockout of the body (a biped, a quadruped) rendered from the five angles by one
fixed camera, given to the edit as a second image. The feet and the size are then set by the
guide, not by words. It needs no new model, but it needs the encode node's second image input,
which no graph in the repo uses (§9).

### Stage 2: motion

| Candidate | For | Against |
|---|---|---|
| **Wan 2.2 I2V, one render per state and facing** (picked) | Apache-2.0. On the fleet, with its 4-step LoRAs. Its blueprint is bundled and its video session is built. The still is the clip's first frame, so the clip starts as the approved drawing | Only the start is pinned: the feet can slide, the size can drift, the last frame is wherever the motion stopped |
| Wan 2.2 with the same still as first and last frame | Every clip starts and ends on the facing's still, so loops close and states join without a pop | Node inputs not in the repo; whether enough motion survives is unknown (§9) |
| The library's looping blueprint (`wanloopingvideo__3_`) | Loops by design. Has rendered on the GPU | Two passes: 15 to 18 min a render in the owner's sessions. Two defects listed in the blueprint catalogue draft (`shape_ref` bound beside the source image, `models[]` empty) |
| Wan2.2-Animate-2, driven by a motion video | Motion and in-place feet come from the driving clip. Clear licence | Trained on people: a bear on all fours likely fails. Weights not fetched (18–35 GB). Needs a driving-video input the video session does not have ([status/flipbook](../status/flipbook.md) item 4) |
| A rigged 3D stand-in, rendered and restyled by a control video model | The most consistent: angle, feet, scale and loop come from the rig | A rig and clips per body type (the repo has a humanoid armature, no quadruped), a control model not on the fleet, the most to build |

**Picked: `wan22_i2v_flipbook` as it is**, with these settings:

- fast mode on, generation 640, output 320, 16 fps;
- 3 s for loops, 2 s for one-shots (the owner's S0 defaults);
- cutout on with **`BiRefNet-general`** (MIT). The blueprint's default, `BiRefNet_toonout`, has
  no recorded licence;
- matte offset 0 to start. The default grows the matte 5 px, which shows as a fringe on a sprite
  drawn 92 px wide;
- prompt: the state's motion, ending with "in place, the camera and angle stay fixed";
- negative: `camera movement, zoom, background, text`.

| Clip | Loop | Motion prompt |
|---|---|---|
| `bear_idle` | yes | the bear stands and breathes, head turning slightly |
| `bear_walk` | yes | the bear walks in place on all fours |
| `bear_swipe` | no | the bear rears and swipes one paw forward, then returns to standing |
| `fisherman_idle` | yes | the fisherman stands holding his rod, shifting his weight |
| `fisherman_walk` | yes | the fisherman walks in place holding his rod |
| `fisherman_cast` | no | the fisherman casts his rod forward, then returns to standing |
| `fisherman_reel` | yes | the fisherman reels in, the rod bending |

**Do loops need the looping blueprint?**

- `idle`: no. A clip can play ping-pong (forward, then back), which closes any motion for free.
- `walk` and `reel`: a walk repeats, so a 3 s render usually holds more than one cycle. Keep
  **one cycle**: the From and To frames where the same foot is forward. Only if no cut closes
  does the walk need a second pass.
- If a second pass is needed, the first choice is the single-pass graph with the still as first
  and last frame (half the compute of the library's two-pass one), once confirmed on the pod.

### Stage 3: transparent frames

| Candidate | For | Against |
|---|---|---|
| **BiRefNet per frame, inside the video graph** (picked) | Already wired, all twelve variants in the fetch list with checksums. `-general`, `-HR` and `-matting` are MIT | Each frame is matted alone, so an edge can flicker |
| A flat key colour, removed by script | Stable from frame to frame, no model | The video model shades and spills the colour onto the character |
| A video model that makes the alpha itself | No matting step | None on the fleet; existence and licence unknown (§10) |

The still's plain flat background is what gives the matte an easy job.

### Stage 4: sheet and clips

🎞 Make flipbook already does it: frames are trimmed to their ink, their place on the canvas is
recorded, pages are capped at 2048, and the clip is saved with its frames in order. The clip's
name is typed into the panel today (§5).

**Keep few frames.** A clip is a sprite animation, not a video. Kept at every second frame, the
35 clips are about 800 frames, or about eight 2048 pages. A proposal, at Max px 256:

| State | Kept | How |
|---|---|---|
| `idle` | 8 frames | the first 1.5 s, every 3rd frame, ping-pong |
| `walk`, `reel` | 8 frames | one cycle, every 2nd frame |
| `swipe`, `cast` | 10 frames | the action, every 2nd frame |

That is 130 frames for the bear and 170 for the fisherman, about three 2048 pages for both. These
page counts are arithmetic on an assumed ink size, not a measurement.

## 4. What the fleet has, and what must be added

Nothing is added to the pod image, the worker image or the fetch list in this pass. A fetch set
names what the fleet knows how to fetch; whether its files are on the volume today shows only in
`/comfyui` → What's installed.

**In the images and the fetch list today**

| Piece | Where | Licence |
|---|---|---|
| Wan 2.2 I2V A14B high and low, umT5, the Wan VAE | fetch set `wan22-i2v` | Apache-2.0, clear |
| lightx2v 4-step LoRAs | fetch set `wan22-turbo` | Apache-2.0, clear |
| BiRefNet general, HR, matting, lite | fetch set `birefnet`, staged per worker | MIT, clear |
| `BiRefNet_toonout`, `Lucida` | the same set | **unknown** |
| `BiRefNetRMBG` node | `ComfyUI-RMBG`, baked into pod and worker | node code Apache |
| Qwen2.5-VL-7B encoder, the Qwen-Image VAE | fetch set `qwen-image` | Apache-2.0, clear |
| FLUX.2 [klein] 4B, its encoder and VAE | fetch set `flux2-klein` | Apache-2.0, clear |
| The video graph's other nodes | ComfyUI core, checked at the pinned v0.33.1 ([invisible-flipbook-video](invisible-flipbook-video.md)) | — |
| The edit graph's nodes | ComfyUI core by the bundled sibling's own declaration (`custom_nodes: []`); not checked on a pod | — |
| `gpt_image` | comfy.org API, no weights | clear |

**To add**

| Piece | For | Size | Licence | Note |
|---|---|---|---|---|
| `qwen_image_edit_2509_fp8_e4m3fn.safetensors` | stages 0 and 1 | 20.4 GB | Apache-2.0, clear (registry id `qwen-image`) | In no fetch set. The URL is in the blueprint's `models`. The one attempt to store it was refused: "storage quota exceeded", 345 of 400 GB in use (2026-11-17) |

That is the whole list for the picked pipeline. In the fetch list it would be one new set,
`qwen-image-edit`, holding this file; its encoder and VAE are the `qwen-image` set's. **No custom
node is added** to either image: both graphs use ComfyUI core nodes and `ComfyUI-RMBG`.

**Only if a later step needs it** (none is in the plan above)

| Piece | For | Licence |
|---|---|---|
| Wan2.2-Animate-2 Distilled, `clip_vision_h` (about 18 GB) | motion from a driving video | Apache-2.0, clear (registry) |
| A multi-angle LoRA for Qwen-Image-Edit | camera angle by trained words | to look up (§10) |
| A control video model (Wan Fun Control or VACE) | motion from a 3D stand-in | to look up (§10) |
| An image-to-3D model and its render nodes | a mesh from the picture | to look up (§10); not recommended |

## 5. How it is launched

### Today, with the tools as they are

1. **Stills, Invisible Atlas Maker.** A new atlas `<prefix>_facings` with five regions
   `<prefix>_se`, `_s`, `_e`, `_ne`, `_n`, pipeline `qwen_character_facing`. The shared suffix
   goes in the atlas's positive suffix.
   - Render `<prefix>_se` from the art, pick a variant and lock it: that is the master.
   - Give the other four regions the master as their reference image (📁 Pick from R2 →
     `batch/<prefix>_se_…png`) and their one-line prompt. **▶ Render selected** queues all four.
   - Pick, lock, **🧩 Create Atlas**.
   - Region names are one pile per project. If the S0 atlas `s0_characters` already has
     `bear_se`, reuse that atlas or delete its region first.
2. **Motion, Invisible Flipbook 🎬 Video.** Blueprint `wan22_i2v_flipbook`, source image = the
   atlas region, the state's prompt, the settings of §3. One session per state: generate on `se`,
   then **⧉ duplicate** the tile once per other facing, changing only the source image.
3. **Clips.** **🎞 Make flipbook** on the best tile of each facing, typing the clip name
   `<prefix>_<state>_<facing>`. In Clips mode set Loop, ping-pong for `idle`, and the same ⬚ Bounds
   numbers in every clip of the character.
4. **Publish** in Game Maker.

Every step exists in the tools today, but the chain has not been run end to end. It is also 35
names typed by hand and 35 bounds boxes copied, which is where mistakes come from, so the build
plan removes the typing (§9, step 3).

### Names without hand renaming (to build after §8 passes)

No new blueprint card is needed for the fan-out: the two tools already hold its halves.

- **Stills:** an atlas is already a fan-out over its regions. A "character facings" preset
  creates the atlas with the five regions, their names, prompts and reference filled in, the way
  🖼 To Atlas Maker creates an atlas from a video today.
- **Motion:** a "character set" panel in 🎬 Video takes a prefix, the facings atlas and the state
  table of §3. It creates one session per state with one tile per facing, each tile carrying a
  **label** `<prefix>_<state>_<facing>` and its facing's still as source. A session's tiles can
  already differ in source image and prompt; the label is the one new field.
- **Clips:** "Make all clips" runs Make flipbook on each labelled tile the author picked, names
  the sheet and the clip from the label, and writes the loop flag and the character's one bounds
  box.

Where those clips land is built (2026-11-19): Invisible Flipbook's **Characters** mode
([status/flipbook](../status/flipbook.md)). A clip named `<prefix>_<state>_<facing>` shows in its
grid whichever route made it, and its **One Bounds box** and **Directions** check the set. "Make
all clips" should take its per-state loop and its box from the same code rather than a second
copy: `apps/launcher-api/src/lib/flipbook/characterSet.ts` (`characterStates`,
`defaultStateSettings`, `characterBounds`) and `characterWrites.ts` (`createClips`,
`applyBoundsToClips`). The facings atlas's five stills (`<prefix>_se` …) are already matched
there to the one-frame `idle` clips of "Stills as sprites" below.

### What a person can replace by hand

| Replace | How | Then |
|---|---|---|
| A facing still | Paint over the variant, set it as the region's reference image, and use the reference as the tile (the card shows ★ your image) | re-run that facing's motion |
| The master | The same, on `<prefix>_se` | re-run the facings |
| One frame of a clip | **⤓** the tile's PNG zip, or **🖼 To Atlas Maker** for a grid atlas with one region per frame; paint; commit each as the region's tile; Create Atlas; point the clip's frames at the new sheet in Clips mode | nothing |
| A whole clip | Any sheet made in the Sheet Maker, with a clip of the same name | nothing |

Whether one frame of a Flipbook-packed sheet can be replaced **in place** in the Sheet Maker with
its trim kept is not confirmed (§9).

### Stills as sprites, before any motion

A one-frame clip per facing (`<prefix>_idle_<facing>`) gives 8-direction sprites with no video.
The still then needs its background cut, and the stills blueprint has no cutout. The library's
`birefnet` blueprint cuts a still, but it bakes `BiRefNet_toonout`, whose licence is unknown. So
this needs one small addition, not drafted: that blueprint re-published with a model setting, or a
cutout switch on the stills blueprint built from the three nodes the video graph already uses.

## 6. Cost of one character, and the queue

**The rates the docs hold**

| Render | Rate | Source |
|---|---|---|
| Wan 2.2 I2V, fast mode, 640, 81 frames | about 100 s warm | said in passing, with no run on record ([flipbook-history](../status/flipbook-history.md), 2026-09-01) |
| The same | 200 s, plus 240 s to wake | the blueprint card, `source: guess` |
| The looping blueprint | 15–18 min (927–1061 s) | the owner's sessions, [flipbook-history](../status/flipbook-history.md) |
| Qwen-Image 1024, 20 steps | 14–16 s warm; 130–199 s cold or after idle | measured 2026-11-16, [status/comfyui](../status/comfyui.md) |
| Qwen-Image-Edit-2509 1024 | 45 s | card, `source: guess` |
| A GPU second | $0.00053 (L40S 48 GB) | `pricing.json`, **placeholder** |

**One character end to end**, at two variations per clip and no re-rolls:

| | Bear | Fisherman |
|---|---|---|
| Clips | 15 | 20 |
| Video per set of five facings | 8 s (3 + 3 + 2) | 11 s (3 + 3 + 2 + 3) |
| Video renders | 30 | 40 |
| Video GPU time, low: 100 s per 81 frames, scaled by length | 27 min | 37 min |
| Video GPU time, high: 200 s a render | 100 min | 133 min |
| Stills: 4 master variants and 12 facing variants at 45 s | 12 min | 12 min |
| Waking the GPU, three times | 12 min | 12 min |
| **GPU time** | **0.9–2.1 h** | **1.0–2.6 h** |
| **At the placeholder price** | **$1.6–4.0** | **$1.9–5.0** |

Both characters: 2–5 GPU hours, $4–9, plus re-rolls. Each re-roll is one more render of 1 to 3.5
minutes. If the walks need the library's looping blueprint, the bear's ten walk renders alone are
150 to 180 min.

Every figure is an estimate. The low video rate has no run on record behind it, and the price is
a placeholder. §8's run replaces them: each video tile records when it started and finished, and
each still job records its GPU seconds.

**A person's time** is the larger cost by hand: 35 clips to judge, trim and name.

**The queue**

- **Stills** go through ▶ Render selected. Each job has a record in R2 (`still_jobs.py`), and a
  new container re-attaches to jobs in flight.
- **Video:** one session runs and four wait. A session is written to R2 before it is sent, each
  tile is saved as it lands, and a restarted container collects renders already paid for. Cancel
  stops the GPU.
- One session per state fits the queue as it is: three sessions for the bear, four for the
  fisherman. Both characters at once is seven, so they run one after the other.
- Tiles of one session run one at a time unless `VIDEO_PARALLEL_JOBS` is raised. More workers
  shorten the wait at the same GPU time, and each pays its own wake.

Nothing waits on a GPU job in a loop a person has to keep open.

## 7. Risks, and how each is checked

| Risk | A person looks at | A script can measure |
|---|---|---|
| **Identity drifts between facings** | the five stills side by side | mean colour of the silhouette per facing. Likeness itself has no dependable measure: the face-identity models are non-commercial and made for human faces |
| **Scale drifts between facings** | the stills on one ground line | silhouette height per facing (meaningful for the upright fisherman, not for a bear seen end-on) |
| **The camera is not the game's** | the still over a 2:1 diamond: is the top of the back visible as much as in the master | nothing reliable. The guide image is the remedy |
| **Feet slide, size drifts in a clip** | Clips mode with ⬚ Bounds shown: do the feet leave the box's bottom edge | per frame, the bottom of the silhouette and the centre of its lowest tenth: the largest distance from frame 0 (`drift_px`); the height's spread |
| **The loop does not close** | play at 1× on loop | last frame against first, as a multiple of a normal step between frames (`loop_seam`); the best From and To for one cycle |
| **The matte fails on toon edges** | the tile on the checkerboard, then the clip over dark and over light | transparent holes inside the silhouette per frame; the silhouette's area jumping in one frame and back |
| **The video redraws the character** | first frame against last | mean colour of the silhouette over time |
| **The mirrored facing reads wrong** | Mirror X in Clips mode | — |
| **Texture cost** | the page count Make flipbook reports | the frame budget of §3 |

The measuring script is **not built**. It is a small Pillow tool beside `rig_parts.py`, run on a
tile's downloaded WEBP (build plan, step 4). Its pass marks can only be set once real renders
exist; §8's numbers are provisional.

## 8. The first experiment

The smallest run that says whether the approach holds: **the bear, `idle` and `walk`, facings
`se` and `e`**, plus one still of the fisherman. The bear is the hard case: its only art is from
above, and it walks on four legs.

**Before it (owner):** RunPod credit (a pod start was refused on 2026-11-17); 21 GB free on the
volume and the edit model stored there (`/comfyui` → What's installed → Add a model, with the URL
from the blueprint's `models`).

**A. Stills, on an R&D pod, in ComfyUI.** Load
`services/atlas-tool/blueprints_src/qwen_character_facing/workflow.json`. No merge or deploy is
needed for this. It is an API-format graph; if the pod's ComfyUI will not open one, start from its
own Qwen 2509 image-edit template and swap the latent for an empty 1024 × 1024 one.

1. Bear master: reference = the `bear` art, the master prompt, 4 seeds.
2. Bear `e`: reference = the chosen master, the `e` prompt, 3 seeds.
3. Fisherman master: reference = the bear master, the fisherman prompt, 4 seeds.
4. The same three through `gpt_image` in the Atlas Maker, 2 variants each, to compare.

**B. Motion, in Invisible Flipbook 🎬 Video.** Upload the two bear stills as source images.
`wan22_i2v_flipbook` with §3's settings: `idle` and `walk` on `se` and `e`, 2 variations each.

**C. Clips, no GPU.** Make flipbook for the best tile of each, named `bear_idle_se`,
`bear_idle_e`, `bear_walk_se`, `bear_walk_e`, kept as §3 says, the same ⬚ Bounds in all four.

**Cost:** 11 stills and 8 videos, about 25–45 min of GPU, $1–2 at the placeholder price, six
`gpt_image` credits' worth, and about an hour of a person.

| # | Check | Pass | If it fails |
|---|---|---|---|
| G1 | The graph loads on the pod with no red node and renders | yes | A wrong node or input name: fix it, run again. Not a verdict on the approach |
| G2 | `wan22_i2v_flipbook` renders, and its tile has alpha with the cutout on (the Make flipbook panel says so) | yes | Flipbook open item 1: fix before judging the matte |
| S1 | The master is the bear's colours and ink, upright, at the game's angle | the owner accepts 1 of 4 | Use the `gpt_image` master, or paint it |
| S2 | `e` is the same bear as `se` | the owner accepts 1 of 3 | Look up the multi-angle LoRA and a newer edit model (§10), or paint the facings |
| S3 | Same camera height; shoulder height within 10 % (provisional); feet on one line | yes | Add the guide image |
| S4 | The fisherman is in the bear's style | the owner accepts 1 of 4 | Use `gpt_image`, or a painted fisherman |
| M1 | The bear is the same in the last frame as in the first | 1 of 2 tiles, in all four clips | Shorter clips; or stills animated in code |
| M2 | The feet stay within 6 px of their start in the 320 px frame (provisional); no zoom or pan | `idle` on both facings; `walk` judged apart | `walk`: the first-and-last-frame pass |
| M3 | `idle` ping-pong shows no pop; `walk` has a one-cycle cut with no pop at 1× | yes | `walk`: the first-and-last-frame pass |
| M4 | The matte is clean on the checkerboard, over dark and over light | yes | `BiRefNet-HR` or `-matting`; `toonout` if its licence clears |
| M5 | The owner would ship `idle`; would ship `walk` | per state | Decides which states the network makes |

**Reading the result**

- G, S and `idle` pass: go. Make the bear's five stills and its `idle` clips; build step 3.
- Stills pass, `walk` fails: ship stills and `idle`; `walk` goes to the second pass, or stays in
  code, or is drawn.
- S2 fails on every arm: the network does not make the facings. A person paints the five stills
  and the network animates them (stages 2 to 4 still apply).
- M1 fails: the video model cannot hold this art. The facings are still worth having as stills.

Write the measured seconds into the two cards and [status/flipbook](../status/flipbook.md).

## 9. Build plan, and what to confirm on the pod

1. **The experiment** (§8). Owner and a pod. No code.
2. **The stills blueprint in the library.** Merging its branch publishes the draft to the shared
   library at the next boot, as the two Qwen bust drafts were. It stays a draft card until it has
   run and the owner reviews it. If the stills ship first, the cutout for stills comes here (§5).
3. **The fan-out** (§5): the facings preset, the tile label, the character set panel, Make all
   clips with one bounds box. A pipeline change of its own, with the Flipbook guide.
4. **The measuring script** (§7).
5. **Only if §8 says so:** the first-and-last-frame video blueprint; the guide image.
6. **Cards:** measured timings, then the owner's review.

**To confirm on the pod** (not drafted, because the repo cannot confirm them):

| What | Why it matters |
|---|---|
| `qwen_character_facing` loads and renders at v0.33.1 | Its nodes are the bundled sibling's, and that graph has not run either |
| An empty 1024 latent with a reference of another shape edits cleanly | The one change from the sibling's wiring |
| `TextEncodeQwenImageEditPlus` takes a second and third image, and follows a depth or pose picture given as one | The guide image; a style reference beside a subject reference |
| `WanFirstLastFrameToVideo`: its input names; that it runs on the fetched I2V pair with the same picture first and last; that the 4-step LoRA still moves | The loop pass. The library's looping blueprint uses the node, but its graph is not in the repo |
| The animated WEBP keeps its alpha through the cutout | Unobserved since the video mode shipped |
| Qwen-Image-Edit-2509 fp8: seconds per still and peak VRAM on the endpoint's card | The card says 45 s and 24 GB as guesses |
| FLUX.2 [klein] 4B edit: its node names | The runner-up for the stills has no graph here |
| One frame of a Flipbook-packed sheet replaced in the Sheet Maker keeps its trim | The shortest hand edit of a frame |

## 10. Facts to look up

The plan leans on these and none could be checked from a cloud session.

1. Is there a Qwen-Image-Edit release newer than 2509, under Apache-2.0, with a Comfy-Org
   repack? Does it hold a character across views better?
2. What is the exact name and licence of a multi-angle (camera rotation) LoRA for
   Qwen-Image-Edit, and which base release does it need?
3. Does Qwen-Image-Edit-2509 follow a depth map or a pose skeleton given as an input image, with
   no ControlNet model?
4. What licence does the `BiRefNet_toonout` fine-tune carry, the one `1038lab/ComfyUI-RMBG`
   serves? The same for `Lucida`.
5. Does ComfyUI's own Wan 2.2 first-and-last-frame template use the I2V A14B high and low models
   the fleet already has, or a separate checkpoint?
6. What does RunPod charge per second for the serverless endpoint's GPU? (`pricing.json` holds a
   placeholder.)
7. Is there an image-to-video model or LoRA that outputs an alpha channel itself, and under what
   licence?
8. For the Qwen-Image-Edit-2509 4-step or 8-step Lightning LoRA: the exact file name and licence.
   It would cut a still from 20 steps to 4 or 8.
9. Only if the 3D route is ever wanted: does the Hunyuan3D licence exclude the EU, and what
   licences do TRELLIS and the renderer it needs carry?
10. Only if the stand-in route is ever wanted: the names and licences of Wan 2.2 Fun Control and
    Wan VACE, and whether ComfyUI core runs them.

### Answers (web search, 2026-11-19)

Read off search results and model cards, not off the files themselves. A row marked "confirm"
needs the licence tag read on the model's own page before anything is fetched; the registry
(`model_licences.json`) stays the authority.

| # | Answer | Source | Still to confirm |
| --- | --- | --- | --- |
| 1 | **Yes: Qwen-Image-Edit-2511.** Its card lists Apache-2.0 and says character consistency is "significantly improved" over 2509; Comfy's tutorial uses the Comfy-Org repack `qwen_image_edit_2511_bf16.safetensors` and needs a recent ComfyUI. So §8's stills should be tried on 2511, not 2509, if the pod's ComfyUI is new enough. | [model card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511), [Comfy tutorial](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511) | the repack's own licence tag; an fp8 file and its size; the pod's ComfyUI version |
| 2 | Two exist. `dx8152/Qwen-Edit-2509-Multiple-angles` (base 2509: rotate left / right, move forward, tilt up / down, wide lens). `fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA` (base 2511, 96 camera positions). | [2509 LoRA](https://huggingface.co/dx8152/qwen-edit-2509-multiple-angles), [2511 LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) | **both licences**: only a third-party mirror showed apache-2.0 for the 2509 one, and none was seen for the 2511 one |
| 3 | Not looked up. | | all of it |
| 4 | **`BiRefNet_toonout`: the ToonOut weights' card lists MIT** (a fine-tune of MIT BiRefNet); its training set is CC-BY 4.0, which binds whoever redistributes the data, not the weights. `Lucida` not looked up. | [weights](https://huggingface.co/joelseytre/toonout), [paper](https://arxiv.org/html/2509.06839v1) | that the file `ComfyUI-RMBG` serves is those weights; `Lucida` |
| 5 | **The fleet's own models.** Comfy's Wan 2.2 14B first-and-last-frame template uses the I2V 14B high-noise and low-noise files with the `WanFirstLastFrameToVideo` node (the Fun Inpaint models are a different route with a different node). So a walk that must close needs no new weights. | [Comfy template](https://comfy.org/hub/workflows/wan-2-2-14b-first-last-frame-to-video-7016f027bcf1/), [Wan 2.2 tutorial](https://docs.comfy.org/tutorials/video/wan/wan2_2) | the node's input names on the pod (§9) |
| 6 | Not looked up: read it off the RunPod bill. | | |
| 7 | Wan-Alpha (Apache-2.0) makes RGBA video, but it is **text-to-video** on the Wan 2.1 T2V 14B base with its own VAE and LoRA. It does not animate a still, so it does not replace the matte in stage 3. | [model card](https://huggingface.co/htdong/Wan-Alpha), [Comfy tutorial](https://docs.comfy.org/tutorials/video/wan/wan-alpha) | |
| 8 | `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors`, in `lightx2v/Qwen-Image-Lightning` (an 8-step file is released beside it). | [repository](https://github.com/ModelTC/LightX2V-Qwen-Image-Lightning) | its licence tag (the registry already lists Qwen-Image-Lightning as Apache-2.0); whether a 2511 one exists |
| 9, 10 | Not looked up: neither route is chosen. | | |

## 11. Owner decisions

1. **Run §8?** It needs RunPod credit and 21 GB on the volume: delete something, or grow the
   volume ($0.07 per GB a month, and it cannot shrink).
2. **Stills on our GPU with Qwen-Image-Edit, or `gpt_image` for now?** `gpt_image` runs today and
   needs no weights, but it is a paid API and not our network.
3. **Ship the stills first?** Five approved stills per character as one-frame clips give
   8-direction sprites before any motion passes. It needs a licence-clear cutout for stills (§5).
4. **The frame budget** of §3: 8 to 10 frames a clip at 256 px, about three pages for both.
5. **A walk that fails:** a second video pass, the code animation, or drawn frames?
6. **`BiRefNet_toonout`:** allowed once its licence is looked up and clear?
7. **The rod changes hands in the mirrored facings.** Accepted, as the mirroring of game-families
   §9 #28 implies?
8. **Merge the draft blueprint?** It then shows in the Atlas Maker's pipeline picker for everyone.
   Its card stays a draft, so agents are not offered it.
