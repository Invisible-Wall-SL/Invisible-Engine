# OPEN QUESTIONS — for the owner

Each question has a suggested default. If a question is still open when its task starts, we go
with the default.

## Open

1. **What is a "template"?**
   - Hold and Win 3 Pots Sample, hw-classic-sample and hw-collector-sample are ordinary projects.
     The platform has no template kind for them.
   - *Default:* a template is any **published** project of the chosen game type that an admin marks
     "Director template". The mark lives in Admin › Projects and is stored on the project. A new run
     duplicates it with `duplicate full`.
2. **What does "creates the project on main" mean?**
   - Game Maker makes no git commit. It writes a `projects` row and an R2 tree under
     `<client>/<project>/`.
   - *Default:* Director does exactly that, through the same code path. The project gets no
     branch, and the repo is never touched.
3. **How is the math lock enforced?**
   - The platform has no lock on `config/config.json` today.
   - *Default:* the Director adapters refuse every Game Config write. The run also records the
     template config's ETag, and QA fails the run if that ETag changes mid-run.
   - A human can still edit Game Config in its own tool. That is outside Director, by design.
4. **Agent runtime:** ADR-0001 recommends the Anthropic SDK tool runner in a new
   `services/director-worker` Railway service, rather than the brief's default, the Agent SDK.
   - *Default:* approve ADR-0001 as written.
5. **Who are the agents when they write to R2?**
   - *Default:* every write is attributed to the run's owner and stamped `tool: director` and
     `agent: <name>`, so the existing audit and `saved_by` keep working.
6. **Which games does the harness compare?**
   - *Default:* every game in the `games` table, using its **published** snapshot. A desktop-built
     game is checked for build and tests only, and the report marks it that way.
8. **CI access for the harness.**
   - It needs a read-only R2 token, scoped to `*/published/**` and `test_server/games.json`, and a
     CI token for `/api/pipeline/games`.
   - *Default:* the owner creates both as GitHub Actions secrets. We never commit them.
9. **How are pipeline changes recorded?**
   - *Default:* each pipeline change is a GitHub branch with a PR, squash-merged with a scoped
     title. History is the merged PRs. Rollback is a revert PR that goes through the same checks.
     This becomes ADR-0007, before Phase 5.
## Answered

- **(was Q7) Pixel tolerance.** Answered 2026-10-04: not a fixed 0.1 %. Tolerance is a tunable
  config (`scripts/current-games/tolerance.json`), changed as needed with the owner's approval.
  Agents should actively propose improvements, including visual ones, as pipeline changes with
  before/after screenshots. See ADR-0004.
- **(was Q10) Mockup gaps.** Answered 2026-10-04: the owner sent `02-director-new-game.html` and `04-director-live-run.png`, so the set is now complete.
