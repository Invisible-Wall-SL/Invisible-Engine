# Rig modules — a template as switchable parts

> Status: design, building (2026-11-27). Templates: [rig-templates](rig-templates.md) · Sheet and
> frame rigs: [frame-to-rig](frame-to-rig.md) §12–13 · 3D: [rig-2p5d](rig-2p5d.md) · Controls:
> [rig-controls](rig-controls.md).

## 1. The ask

The owner, 2026-11-27, on their 🗺 From my sheet rig: "we should also have an option to remove the hand
rigs or have a rig version with no hands, but that would need continues integration between all the
templates, and sounds like a lot of work, having something dynamic and modular would be better!"

A template today is one whole skeleton with its parts, controls, motion map and 3D setup. A rig with
no hands, or simpler hands, would be another template — and Bust with face, Half body and Full body
already repeat each other's neck, head, face and arms by hand. The first thing the owner can use is
**no hands**; the shape around it is **one definition, switchable pieces**.

## 2. The model

A template keeps **one complete definition** and declares its **modules**: a piece a rig may have one
of several ways (`RigTemplate.modules`):

```ts
interface RigTemplateModule {
	id: string; // 'hands'
	label: string; // 'Hands'
	tip: string;
	default: string; // the option the definition is (a rig with no choice has it)
	options: {
		id: string; // 'fingers' | 'simple' | 'none'
		label: string;
		bones?: string[]; // taken away, with every bone that hangs from them
		bare?: string[]; // kept, with nothing on them (a wrist that ends the arm)
	}[];
}
```

**An option takes away; everything that names what it takes follows** (`templateWithModules`, one
generic pass, so a module never lists its consequences by hand):

| What goes                                | What follows it                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a bone (`bones`, and what hangs from it) | its slots; every drive on it; a 3D turn, a finger segment, a limb, an anchor naming it; constraints and 3D IK naming it; its control, picker button and set entries; its depth; clip timelines on it |
| a bare bone (`bare`)                     | the same, but the bone stays and so do drives moving it (x / y): it still ends its chain, so an arm's IK, its capture reach and its foreshortening keep their end                                    |
| a slot                                   | its parts (drawings by angle too); swaps on it, `hides` and draw-order steps naming it; its 3D views and layer place                                                                                 |
| a control                                | left with nothing to drive, set, mix, swap or order, it goes; so does every key a starter clip has on it, a 2D map entry, a `replaces` naming it                                                     |

The result is an ordinary template, validated as any other (`rigTemplateProblem`): every option of
every built-in is gated to validate, build a rig over the template's art and load.

**A rig remembers its choice** beside its template: `template.json` `{ id, version, modules }` (only
modules off their default are written; a rig with none is the definition, so every rig made before
this keeps what it has). A 🗺 sheet mapping keeps it in `template` too, so 🔄 Update rig builds the
same rig. Everything that reads "the template this rig was made from" reads it through the choice:

| Reader                                      | How it follows                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ＋ New rig, 🗺 From my sheet, 🎞 Frame to rig | a Modules row under the template picker; the build is `templateWithModules`'s, so the parts asked for, cut, mapped and drawn are the module set's |
| Controls, Picker, IK, the 3D setup          | the template a rig is given (`rigTemplateForSidecar`) is filtered; `controls.json` is written from it at create                                   |
| 🎥 Motion (2D and 3D)                       | the motion map is filtered: no hand entry, no finger segment, so a capture keys no hand the rig lacks                                             |
| 🔄 Update rig                               | builds with the rig's own module set                                                                                                              |
| 📐 Save as template                         | reads the rig itself: a no-hands rig saves a template with no hands                                                                               |
| `rig_templates/*.json` mirrors              | generated from the definition (`template-art.mjs --write`), unchanged by a choice                                                                 |

## 3. The modules

**Hands** (Half body: `fingers` default, `simple`, `none`; Full body: `simple` default, `none`):

- **fingers** — today's hand: the hand image, its pose drawings, the 15 finger bones and their
  segment slots, the finger controls (curls, thumb, spread), the hand map and the 3D finger segments.
- **simple** — one bone, one image: the finger bones go (and with them the segments, the finger
  controls and their capture); the hand's image, its pose drawings and Wrist stay.
- **none** — the arm ends at the wrist: the fingers go and `hand_l` / `hand_r` are **bare**, so the
  hand's slot, drawings, Hand pose, Wrist and Shorten hand go, while the bone stays as the forearm's
  end (the arm IK, its control at the wrist, the capture's reach to the tracked wrist and the
  forearm's foreshortening all need it). Nothing draws there; a sleeve or a prop drawn on the forearm
  carries on.

Later modules on the same mechanism (§6): **legs** (Full body), **neck** (two bones or one), the
**mouth** (shapes or jointed — today's optional slots), **head turn** (today a mapping option).

## 4. An existing rig: adding or taking away a module

A rig's modules can change in place, with no rebuild (`changeModules`, `rigFrameUpdate.ts`):

- **Taking one away** removes from the open rig what the old set has and the new one lacks: slots
  with their attachments and keys (every draw-order key re-read without them), bones with their keys
  and the constraints naming them. A weighted vertex naming a bone that goes hands its share to the
  nearest bone kept above it where the vertex is at setup, and the bones are renumbered — weighted
  vertices name bones by place. A bone kept with nothing left on it is reported **bared** (a wrist),
  so the page drops its ring and picker button too. A bone or slot of the author's own on a bone
  that goes stops the change, named, rather than going with it.
- **Adding one** takes what the new set has and the old lacks from a build of it over the rig's art
  (`fresh`): bones where the build has them (appended in its order, so nothing renumbers), slots
  where its draw order has them, their art bound to the rig's bones by name, constraints naming them.
- **Where.** 🧩 in the rig panel: a ＋ New rig rig gets a dialog (`POST /api/rigger/modules` plans it
  over the rig's own art on its fit, the page takes it as one undo step and saves, then `PUT` writes
  `template.json`); a 🗺 rig opens 🗺 Edit mapping, whose top row has the pickers — 🔄 Update rig runs
  `changeModules` between the kept mapping's set and the edited one before the parts merge, and
  sends back the new set's controls; the page drops what went from `controls.json` and the 3D data
  and takes the new set's control entries for what came (`modulesOnSidecars`). A 🎞 rig keeps every
  module for now.

## 5. Stack

1. **Modules and no hands** (bottom): `modules` on the built-ins, `templateWithModules`, the choice
   in `template.json` and the mapping, ＋ New rig / 🗺 From my sheet / 🎞 Frame to rig pick it, every
   reader in §2 follows; gate `rig-modules.mjs`.
2. **Change a rig's modules in place** (§4): remove with renumbered weights, add over the rig's
   art; 🧩 and 🗺 Edit mapping; gate `rig-modules-change.mjs`.
3. **🎞 Frame to rig with modules**: the cut asks for the module set's parts, the frame rig records
   it, its 🔄 Update rig changes it.
4. **Presets of modules**: Bust with face, Half body and Full body written as a base and the same
   module builders (neck, head and face, arms, hands, legs), so a module is defined once; gated to
   produce today's templates exactly (a snapshot of each), so no rig sees a difference.

## 6. Not doing

- No new template versions: a module set is a choice over the same version, and an unchosen rig is
  the definition.
- A user template (📐 Save as template) has no modules of its own: it is the rig it was saved from.
- Mirrored hands, a hand drawn into the sleeve as one part with the forearm: the arm's art decides.
