---
name: reuse-check
description: Check the existing UI/feature inventory before building a recurring surface, so we don't re-implement what already exists. Use BEFORE building a file browser, table/data-grid, page layout, item/floating toolbar, region thumbnail, client/project selector, tool top bar, or a server auth-gate / project-scope helper — or whenever the user says "don't recreate what we already have."
---

# Reuse check

This project has re-implemented the same surfaces many times — file browsers (≥4), tables, layouts, item UIs. Before adding another, follow this. The catalog is **`docs/ui-inventory.md`** — it is the source of truth; this skill is the procedure.

## When this applies

You're about to build (or the user asks for) any of: a **file/asset browser or R2 picker**, a **table / data-grid**, a **page layout / section shell**, an **item UI / floating toolbar** attached to a selection, a **region/sprite thumbnail**, a **client/project selector**, a **tool top bar / cross-tool nav**, or a server **auth-gate / active-scope (client,project) resolver**.

## Procedure

1. **Open `docs/ui-inventory.md`** and find the matching pattern (sections 1–8).
2. **Identify the reuse domain** of what you're building:
   - **Domain A = Launcher** (`apps/launcher-api`, Svelte 5) → shared code lives in `packages/components-*`.
   - **Domain B = Python tools** (`services/atlas-tool`, `services/sheet-tool`, server-rendered HTML) → shared code per the `iw_pipeline_common` plan.
   - ⚠️ **You cannot share a component across A and B.** Only look for reuse *within the same domain*. A launcher file browser ≠ the Python `/fsbrowse`.
3. **Decide, in this order:**
   - **A shared component already exists** (status "canonical" / a `components-*` import) → **import it.** Do not copy.
   - **An unshared implementation exists in your domain** (status "reference impl" / "most complete") → **extract it** into the shared location, then use the extracted version. Note the extraction in `docs/ui-inventory.md`. (If a full extraction is out of scope for the current task, say so explicitly and at minimum copy from the named reference — never reinvent — and add a STATUS backlog note to extract later.)
   - **Nothing exists in your domain** → build it **as a shared component from the start** (in `packages/components-*` for A) and **add a row to `docs/ui-inventory.md`**.
4. **For gates/scoping specifically:** always use `lib/server/ftpScope.ts` (`gate` + `assertAllowed` + `allowedPrefixes`) — do NOT write a new inline gate. See inventory §8 and STATUS health-eval #4.
5. **Heed the ⚠️ flags** in the inventory — e.g. the client/project selector (§6) is currently buggy (STATUS B23); don't propagate it before it's rebuilt.

## After you build/extract

- Update `docs/ui-inventory.md` (new row, or flip status to "canonical" with the new import path).
- If you only partially consolidated, log the remaining extraction as a STATUS backlog item.

## Why a skill, not a subagent

The existing area subagents (`launcher-studio`, `atlas-python-tools`, `engine-pixi-svelte`) own these surfaces. This is a *cross-cutting check* that must fire inside whichever agent is doing the work — that's what a skill does. A separate "reuse cop" subagent would only run when explicitly invoked and would fragment ownership.
