# Invisible Model Viewer

The **3D models of a 3D game**. Upload a model's **master GLB**, read what the validator found in
it, see what each **quality tier** (Ultra, Full, Half, Quarter) ships for it, and tune its LODs and
maps where the model should differ from its class.

You make **one master** per model, in Blender, to the
[3D asset conventions](../conventions/blender-3d-assets.md). The launcher derives every tier from
it: a tier is never made by hand.

> Part of a game character? [Where each part of a character is made](invisible-characters.md#where-each-part-of-a-character-is-made) lists every tool that makes one.

## What it is

A **model** is one master GLB with its full LOD chain, plus a small record (`model.json`) that holds
its class, its own settings and what the validator found in the master. The page lists the
project's models on the left and shows the open one on the right, as foldable cards:

- **Tiers** — what each quality tier ships: LOD levels, triangles, download, GPU memory and maps.
- **The validator report** — Budgets, LOD chain, Textures, Names and sockets, Tier windows.
- **The settings** — Overrides and LOD screen sizes (the model's own), and **Game Config
  defaults**: what the project sets for every model of a class, which you can edit here too.

Hover a card's title or its ⓘ to read what the card shows. A card folds with its chevron, and the
fold is remembered in this browser.

- **Where it runs:** the launcher itself, at `/models`. It is a full-page tool inside the signed-in
  area, **never an iframe**. The top-bar switcher lists it as **Model Viewer**, in the Assets group
  after Rigger.
- **Access:** the `admin`, `developer`, `artist`, `animator` and `pipelineTester` roles get it by
  default (`ROLE_TOOLS` in `apps/launcher-api/src/lib/roles.ts`). The localization reviewer and
  music/SFX roles do not. Like any tool, an admin can grant or revoke it per role or per user in
  the admin panel. **Editing the Game Config defaults** also needs access to
  [Invisible Game Config](game-config.md): of those roles the `animator` does not have it by
  default, and sees that card read-only.
- **Scope:** per **active project**, and **3D games only**: an arcade project whose Game Config
  has a 3D world (`arcade.world3d`). A slot, match-3 or card project does not list the tool, and a
  direct link shows "Invisible Model Viewer is not used by slot games" (or "match-3", "card"). An
  arcade project with no 3D world does not list it either, and a direct link shows "Invisible Model
  Viewer is for 3D games". Add the 3D world in [Invisible Game Config](game-config.md) and the tool
  appears on the next page.

## How to use it

### Open it

Sign in to the launcher (`app.invisiblewall.org`), pick a 3D arcade project in the top bar, and open
**Invisible Model Viewer**. The page opens the first model of the list. Opening a model puts it in
the URL (`/models?model=<id>`), so a reload or a shared link opens the same one.

### The models list

Each row shows the model's **id**, its **class** and the size of its master. On the right of a row:

- an amber number: the warnings in its validator report;
- **in game**: a scene or the Game Config names it, so it ships (see
  "[In the game or not](#in-the-game-or-not)").

Click a row to open the model. If the open one has unsaved settings, the page asks before it leaves
it (also when a model you just uploaded would open in its place). A project with no models says "No
models yet. Upload a master GLB to start."

### Upload a master

1. Press **Upload** above the list, then choose a `.glb` or drop it on the dialog.
2. Check the **Id** and the **Class**. Both are read off the file name, as the Blender export names
   it: `PR_crate_small.glb` gives the id `PR_crate_small` and the class `prop`; `CH_brawler.glb`
   gives `CH_brawler`, a `hero`. You can change either before you upload.
3. Press **Upload**. The dialog reads **Preparing…**, **Uploading… N%**, then **Validating…**. When
   it closes, the model is in the list and open.

- **The id** is the file name without `.glb`, kept **exactly**: the prefix stays and the case stays.
  The game names the model by that exact string (`modelId`). It is a letter, then letters, digits
  or underscores, 64 characters at most. An id the project already has is refused, and so is one
  that differs from an existing model's only in case. **It cannot be changed later.**
- **The class** is read off the prefix: `CH` hero, `WP` weapon, `PR` prop, `TL` tile, `FX` fx. A
  file name without one keeps the class the dialog shows (`prop` when it opens).
- **The file:** a `.glb`, not empty, **256 MB** at most. It goes straight from your browser to the
  project's storage, not through the launcher.

The launcher then **validates** the master. An **error** refuses the upload: nothing is stored, and
the dialog lists each issue with its code, so you can fix the file and upload it again.

| Code                | The upload is refused when                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `GLB_UNREADABLE`    | the file is not a GLB the launcher can read                                                             |
| `MODEL_OVER_LIMIT`  | it has more than 32 images, 1,000,000 vertices, 2,000,000 triangles or 512 MiB of geometry once decoded |
| `TEXTURE_TOO_LARGE` | a texture is over 8192 px on a side                                                                     |
| `TEXTURE_NOT_POW2`  | a texture's width or height is not a power of two                                                       |
| `NO_LOD0`           | the master has no mesh                                                                                  |

A **warning** does not stop the upload. The model is stored, and the warning shows in its report:

| Code                 | Warned when                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `TRIS_OVER_BUDGET`   | a level is more than a tenth over its class's triangle budget                               |
| `TEXTURE_OVER_CLASS` | a map is larger than the largest master map of its class; every tier resizes it down        |
| `LODU_UNUSED`        | the master has a `_LODU` level but its class (weapon, tile, fx) has none, so it never ships |

The budgets and the largest map of each class are in the
[conventions](../conventions/blender-3d-assets.md).

### Replace a master

**Replace master**, in the open model's header, uploads a new master for the same model. The dialog
is the same without the Id and Class fields: both stay as they are. The model's overrides and LOD
screen sizes are kept, its report is rebuilt from the new file, and the tier table reads **Out of
date** until you derive again.

- Save first: the button is disabled while the model has unsaved settings.
- If someone changed the model after you opened it, the upload is refused ("This model changed
  since you opened it. Reload it, then upload again.") and nothing changes.

### The open model's header

- **The id**, then **In the game** or **Not placed in the game**, and the report's totals: **N
  errors**, **N warnings**.
- **Class** — `hero`, `weapon`, `prop`, `tile` or `fx`. It decides the triangle budgets, the largest
  map and which LOD levels each tier ships. Change it and the report follows at once; when you
  save, the master is checked again as the new class. If the model has LOD screen sizes of its own,
  they are refitted to the new class: one size per level it has, the inherited size for a level the
  model had none for.
- **Master** — the master's size (hover it for the file's SHA-256). **Updated** — when the model was
  last written, by an upload or a save.
- **Replace master**.

### In the game or not

Only a model the game **names** ships. A model is named when a scene or the Game Config carries its
exact id in a `modelId` (or `modelIds`) field. Such a model reads **In the game** (and **in game**
in the list), and a publish writes its tiers.

**Not placed in the game** means no scene and no Game Config entry names the model, so a publish
leaves it out. Everything on this page still works for it: you can upload a model, derive it and
tune it before anyone places it.

### Read the tier table

The **Tiers** card shows what each tier ships for this model. Its numbers come from a **derive**:
the launcher makes every tier from the saved master and the saved settings, the way a publish
makes them.

**Derive tiers** runs one. For each tier it takes the tier's window on the LOD chain (a level the
master lacks is generated by simplifying the nearest richer one), resizes and encodes each map, and
compresses the rest.

- **How long:** a few seconds for a small prop; about half a minute for a hero with 2048² maps the
  texture cache has not seen. Encoding the maps is the slow part. Each encoded map is cached, so
  the next derive with the same maps is quick, and a publish after it does not encode them again.
- **What it writes:** what each tier comes to (the numbers in this table), nothing else. It keeps
  no tier file, it does not change the model's settings, and it does not change what the game
  loads: a publish writes that.
- **Every tier is derived**, also one this project does not publish, so you can see what it would
  cost.
- Two derives of one model never run at once: the second waits for the first. Across the launcher
  two masters are worked on at a time, so a third derive waits its turn, and so does a save that
  changes a model's class (it reads the master to check it).
- A derive that fails shows its reason under the status line, and the table keeps the last
  derive's numbers.
- A derive runs inside the launcher, and encoding large maps keeps it busy: a first derive of a hero
  can slow the launcher for everyone for some seconds. Derives move to a worker soon.

The line above the table says where the numbers stand:

| It reads                                                                | Meaning                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Not derived yet.**                                                    | no derive has run for this model: press **Derive tiers**   |
| **Derived _date_ from `source.….glb`.**                                 | the numbers match the saved master and settings            |
| **Out of date: the master or its settings changed since this derive.**  | press **Derive again**                                     |
| **These numbers are from the saved settings. Save, then derive again.** | you have unsaved changes; the button is off until you save |

"Unsaved changes" are this model's settings, or project defaults you are editing that change what
its class ships (see "[Set the project's defaults](#set-the-projects-defaults)").

A new master, a saved class or override, and a saved change to the project's defaults for the class
all make a derive out of date. The LOD screen sizes do not: they change when a level draws, not the
files.

**Ultra · Full · Half · Quarter** above the table picks the tier whose levels and maps show under
it. Beside the switch are the tier's target and an ⓘ with its **scene budget**: what a whole scene
on screen may cost on that tier.

| Tier        | For                              | A whole scene may cost                                         | Download                    |
| ----------- | -------------------------------- | -------------------------------------------------------------- | --------------------------- |
| **Ultra**   | latest desktop GPUs, opt-in      | 3,000,000 triangles · 500 draw calls · 3072 MB of GPU textures | packaged game under 1536 MB |
| **Full**    | desktop game, and every fallback | 1,000,000 · 300 · 1024 MB                                      | packaged game under 500 MB  |
| **Half**    | web desktop                      | 300,000 · 150 · 256 MB                                         | first load under 40 MB      |
| **Quarter** | web mobile                       | 150,000 · 80 · 64 MB                                           | first load under 15 MB      |

The table has one row per tier:

- **Published** — whether a publish writes this tier for the project. Full always is. The others
  follow the project's tier list, kept by the [Scene Editor](invisible-editor.md) under **Canvas
  Size**: its **Also publish half-resolution art** checkbox is Half. It has no switch for Ultra or
  Quarter yet.
- **LODs** — the master levels the tier ships (`LOD0–2`). `LODU` is the ultra-only top level.
- **Top level** — the triangles of its most detailed level.
- **Download** — the size of the tier's files: its GLB and its textures.
- **GPU memory** — what its textures take on the GPU, mipmaps included.

A row can also read **Not derived yet**, or **Same as Full: no copy, the game loads Full** when the
tier's files would equal Full's (Ultra over a master with no `_LODU` and no map larger than Full's).
Such a tier costs nothing extra.

Under the table, for the chosen tier:

- **Levels** — each level it ships: its triangles, whether it is **The master**'s own or
  **Generated**, and **Drawn above**: the share of the screen height the model must cover for the
  level to draw (set under LOD screen sizes).
- **Maps** — each map's size, encoding (UASTC, ETC1S or PNG) and mip count, or **Dropped on this
  tier**. A model without textures says "No textures".

### Read the validator report

Five cards check the master against its class. Each row has a coloured dot (**OK**, **Note**,
**Warning** or **Error**), a value and a note, and a row that is not OK ends with its issue code.
A card's header sums the card up (**OK**, **N warnings**, **N errors**); the model's header adds
the cards up.

The report is built on the page from what the upload read out of the master, so it follows the
class and the overrides you are editing, saved or not.

- **Budgets** — the triangles of every level in the master against the class budget (hover the
  title for the class's numbers). `TRIS_OVER_BUDGET`: a level more than a tenth over; it still
  ships. `LODU_UNUSED`: a `_LODU` in a class without an ultra level. A level the class does not have
  is a note: no tier ships it.
- **LOD chain** — which levels the master brings (**Authored**) and which the export makes
  (**Generated at export**, by simplifying the nearest richer level). An authored level always wins.
  `_LODU` is never generated: without one, Ultra ships LOD0 as its top level. `NO_LOD0`: the master
  has no mesh. `LOD_MISSING_BASE`: a mesh has lower levels but no LOD0 to generate them from.
- **Textures** — every image in the master, with its size. `TEXTURE_TOO_LARGE`: over 8192 px.
  `TEXTURE_NOT_POW2`: a side is not a power of two. `TEXTURE_NOT_DIV4`, a warning: a side does not
  divide by 4 (a map 1 or 2 px wide or high; the upload does not refuse it).
  `TEXTURE_OVER_CLASS`: above the class maximum, so every tier resizes it down.
  `TEXTURE_BELOW_FULL` is a note: the map is below the Full size, so Full ships it at its own size
  (nothing is scaled up). An image with `palette` or `ramp` in its name is small on purpose and is
  not noted.
- **Names and sockets** — the meshes, the sockets and the clips by name. `NAME_UNKNOWN`: a mesh is
  not named `<prefix>_<name>`, or carries another class's prefix. `NAME_DUPLICATE_SUFFIX`: a mesh
  still has Blender's copy suffix (`.001`). `SOCKET_NAME`: a socket's name is not lower-case
  letters and digits joined by underscores (`SK_hand_r`). `ACTION_NAME`: a clip is not named
  `<set>.<clip>`.
- **Tier windows** — the window of master levels each tier ships with the settings on the page, and
  the maps it drops. A window that ships no level, or that runs past the class's last level, is a
  warning. A tier the project does not publish is marked "(not published)".

A sixth card, **Upload report**, appears only when the upload stored an issue none of the five
recomputes.

### Tune a model: overrides

A model takes each setting from three places, **the most specific first**:

1. **This model** — what you set in its Overrides and LOD screen sizes cards (kept in its
   `model.json`);
2. **Game Config** — what the project sets for every model of the class (kept in the project's Game
   Config, and edited in the **Game Config defaults** card);
3. **Default** — the built-in values of the class.

The **Overrides** card is a grid: a column per tier, a row for the **LOD window** and a row per map
(**Base colour**, **Normal**, **ORM**, **Emissive**). Every cell shows the value in effect and,
under it, where that value comes from: **This model**, **Game Config** or **Default**.

- **LOD window** — the first and the last master level the tier ships (`LOD0` to `LOD2`). Move one
  end past the other and the other follows.
- **A map** — its largest size on that tier (4096² down to 64², or **Dropped**) and its encoding:
  **UASTC** (high quality, a larger download), **ETC1S** (small) or **PNG** (lossless, and
  uncompressed on the GPU: for a decal that must stay pixel-exact). The size is a ceiling: a map is
  never scaled up.
- **Reset** — a cell this model sets has a reset icon, back to what it inherits. The card's header
  counts the values set (**N set**) and has a reset icon that clears them all.

### Tune a model: LOD screen sizes

**LOD screen sizes** says when each level draws, by how much of the screen height the model covers.
**LOD0 from 25%** means LOD0 draws while the model covers a quarter of the screen height or more.
Each level is used from its own size up to the next richer level's, and under **Hidden below** the
model is not drawn at all. A class with an ultra level (hero, prop) has a **LODU from** field too.

- A model inherits its sizes (the header says **Game Config** or **Default**) and the fields are
  greyed out. **Set sizes for this model** copies them so you can edit them.
- A model's own sizes replace the inherited ones **as a whole**, not field by field. The reset icon
  in the header goes back to the inherited sizes.
- Sizes are per **master** level, so a tier that leaves the top levels out shows its first level at
  every larger size.
- The Tiers card's **Drawn above** column shows the sizes in effect.

### Save

The class, the overrides and the screen sizes are saved together, and nothing saves by itself. A
change turns the pill in the top bar to **Unsaved changes** with a **Save** button beside it; after
that it reads **Saving…**, then **Saved**, or **Save failed — retry** (click it to retry; the
reason shows under the model's header).

- A save changes the settings only. The master stays as it is.
- With a new **class**, the master is validated again as that class before the save is stored, and
  the model's stored warnings become that class's.
- Unsaved settings switch off **Derive** and **Replace master**, and the page asks before you open
  another model or leave.

### Set the project's defaults

The **Game Config defaults** card, under the model's own settings, holds what the project sets for
**every model of a class**: the middle layer of the three above. It is kept in the project's Game
Config, not in a model, so it has its own Edit, its own Save and its own lock.

As it opens the card is **read-only**. It lists what the Game Config sets for the open model's
class where that differs from the built-in defaults (for example "Half: Base colour 512² (default
1024²)"), or says that it sets nothing.

To change the defaults:

1. Press **Edit the defaults**. The button reads **Opening the Game Config…** while the page takes
   the Game Config's lock and reads the Game Config fresh.
2. Choose the **Class**. It opens on the open model's class.
3. Change the grid. It is the Overrides grid, for the class instead of one model: a column per
   tier, a row for the **LOD window** and a row per map. A value the project sets reads **Game
   Config** and has a reset icon; the rest read **Default**.
4. Under the grid, **LOD screen sizes**. While the class uses the built-in sizes they read
   **Default** and are greyed out: **Set sizes for every _class_** copies them so you can edit
   them, and the reset icon goes back to the built-in ones. Sizes set here replace the built-in
   sizes as a whole, for every model of the class that has no sizes of its own.
5. Press **Save**, beside the **Unsaved changes** pill at the top of the card. It reads
   **Saving…**, then **Saved**.
6. Press **Done** to stop editing. With unsaved changes it asks first.

- The card's header reads **Editing**, **Unsaved** or **Read-only**, counts what the project sets
  for the class shown (**N set**), and has a reset icon that clears all of it for that class.
- **While you edit, the open model is shown against your changes**, saved or not: its Overrides
  card, its report and its tier windows follow them. If they change what the model's class ships,
  the Tiers card reads "These numbers are from the saved settings. Save, then derive again." and
  **Derive** is off until you save the defaults or press Done.
- **A save changes that one block of the Game Config** and nothing else in it. Like any other save
  of the Game Config it keeps a copy of the version it replaces, under **History…** in Invisible
  Game Config. After a save the page reads again what every model inherits, and a derived model of
  that class reads **Out of date** until you derive it again (not after a change to screen sizes
  alone: they change no file).
- **The two saves are separate.** The pill in the top bar is about the open model only; the
  defaults have their own pill in the card. Nothing saves by itself, and the page asks before you
  leave with either unsaved.
- The edit stays open while you open other models, so you can check several against the same
  change. To start one, a model must be open: the card sits under it.
- **No Game Config yet.** A project that never saved a Game Config has nowhere to keep defaults:
  the card says so and links to [Invisible Game Config](game-config.md). Save one there first; this
  page never creates it.
- **Without access to Invisible Game Config** the card stays read-only and says "Editing these
  defaults needs access to Invisible Game Config."
- If the rest of the Game Config has a blocking issue, the save is refused and the card names the
  first one. Fix it in Invisible Game Config, then save here: your changes stay on the card.

### Working with others

Only one person edits a model at a time. The lock is per model, so two people can work on two
models of one project.

- **Read-only.** If someone else has the model open (or you do, in another tab), the top bar reads
  "_name_ is editing this — read-only", with how long ago they were active. The class, the
  overrides, the screen sizes, **Derive** and **Replace master** are switched off. You can still
  read everything, switch tiers and upload a new model.
- **Take over** moves editing to you. The other tab turns read-only a moment later. When editing
  comes back to you and you have no unsaved settings, the page reads the model again, so you start
  from what they left.
- **"⚠ This model changed".** If the model was changed after you opened it (a new master, or
  someone's settings), your save is refused, the pill reads **⚠ This model changed**, and a note
  under the header gives two ways on:
  - **Load theirs** drops your changes and shows the stored model.
  - **Keep my settings** takes their version (its master and its report) and leaves your class,
    overrides and screen sizes on the page, unsaved. Look them over, then **Save** to put them on
    top of theirs.

  Nothing is ever written over a version you have not loaded.

The **project's defaults** are part of the Game Config, which has **one lock for the whole
project**, shared with Invisible Game Config and Invisible Characters.

- The lock is taken when you press **Edit the defaults** and given back when you press **Done** or
  leave the page. While you hold it, those tools are read-only for everyone else, so press Done
  when you have finished. Only looking at models never takes it.
- If someone else is editing the Game Config (in any of those tools), the card opens read-only and
  reads "_name_ is editing this — read-only" with **Take over**, as the top bar does for a model.
  When editing comes back to you and you have no unsaved defaults, the card reads the Game Config
  again.
- **"⚠ The Game Config changed".** If the Game Config was saved after you opened it here, your save
  is refused and a note in the card gives the same two ways on: **Load theirs** drops your changes
  and shows the stored defaults; **Keep my defaults** takes their Game Config and puts what you
  changed back on the card, unsaved, so the next **Save** writes it into theirs. Only what you
  changed is kept: a class's grid and its screen sizes count separately, and for every class or
  part you left alone the card now shows what they saved.

## Where it is stored

Everything is in the project's storage, under `<client>/<project>/models/`:

| Path                             | Holds                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `models/<id>/model.json`         | the model's record: class, overrides, LOD screen sizes, the validator's findings |
| `models/<id>/source.<sha12>.glb` | the master, named by the first 12 characters of its content hash                 |
| `models/<id>/viewer-tiers.json`  | what the Viewer's last derive came to, tier by tier: the numbers, no tier file   |
| `models/_cache/`                 | encoded maps, shared by the Viewer's derive and a publish                        |

- **A new master is a new file.** `model.json` names the one in use; a replaced master is not
  removed.
- **`model.json` is only written against the version you loaded** (a compare-and-swap), by a save
  and by a master upload alike. That is why a save over a model that changed under you is refused
  until you have loaded the newer version.
- **The Viewer keeps numbers, not tiers.** What a game loads is written under `deploy/models/` by a
  publish, for the models the game names and the tiers the project publishes.
- **The project's defaults are not under `models/`.** They are the `models` block of the project's
  Game Config (`<client>/<project>/config/config.json`): per class, tier overrides (`profiles`) and
  LOD screen sizes (`lodScreenSize`). The card saves the whole Game Config with that block
  replaced, against the version it loaded; a block that sets nothing is removed.

## Traps

- **The id is for good, and exact.** It cannot be renamed here, and the game names the model by
  that string, case included: `PR_crate_small` and `pr_crate_small` are not the same name.
- **"Not placed in the game" ships nothing**, however good its tier table looks.
- **The tier table is not live.** It shows the last derive. After a new master or a saved override
  it reads **Out of date** until you press **Derive again**; with unsaved changes it still shows
  the saved settings' numbers.
- **"Not published" is not a fault.** A tier this project does not publish is still derived and
  shown, as a preview of what it would cost.
- **Changing any cell makes an override**, also when you pick the value the cell already inherits.
  Use the cell's reset icon to go back to inheriting. The same goes for the Game Config defaults
  grid.
- **Editing the defaults locks the Game Config.** From **Edit the defaults** until **Done**, this
  project opens read-only for everyone else in Invisible Game Config and Invisible Characters
  (unless they take over). Press Done when you have finished; closing the page gives the lock back
  too.
- **A change to the defaults reaches every model of the class**, except where a model sets its own
  value. After you save a change to a LOD window or a map, the tier table of every model it
  reaches reads **Out of date**.
- **Two saves on one page.** The top bar's **Save** stores the open model; the card's **Save**
  stores the project's defaults. Neither does the other.
- **A row that reads "unreadable model.json"** opens to a red note and no cards. **Upload its master
  again**, in that note, rebuilds the record: choose the master and its class. Settings the
  unreadable record held are not recovered.

## Known limitations / TODOs

Not here yet:

- **The 3D preview.** A three.js stage with the model's clips, its sockets and LOD switching arrives
  with the `engine-3d` loader, in a follow-up.
- **The defaults of a project with no model.** The Game Config defaults card sits under the open
  model, so an edit of them starts from a model.
- **Deleting a model.** A model cannot be deleted from this page: use
  [Invisible FTP Browser](ftp-browser.md).
- **Deriving the published tiers only.** Every tier is derived, also the unpublished ones.

## For developers

- **Plan:** [`../design/3d-games.md`](../design/3d-games.md) §3 and §5, and
  [`../design/3d/assets-evaluation.md`](../design/3d/assets-evaluation.md) §4–§5. **Current state:**
  [`../status/3d.md`](../status/3d.md).
- **The page:** `apps/launcher-api/src/routes/(app)/models/`. The report and the settings model are
  pure (`src/lib/models/modelReport.ts`, `modelProfile.ts`); the server side is
  `src/lib/server/modelViewer.ts` and `modelStorage.ts`, behind `/api/models/*`.
- **The project's defaults:** `ProjectDefaultsCard.svelte` over `projectDefaultsEdit.svelte.ts` (the
  edit session: the `gameConfig` lease, the fresh read, the save) and the pure
  `src/lib/models/projectDefaults.ts`. They go through `GET` / `PUT /api/game-config`, which gates
  on Invisible Game Config; the block's shape and what the server keeps of it are
  `src/lib/server/modelConfig.ts`.
- **The tier tables:** `packages/constants-shared/modelTiers.ts`.
- **Gate:** `pnpm --filter launcher-api check:model-viewer`.
