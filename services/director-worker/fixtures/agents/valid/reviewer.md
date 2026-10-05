---
name: reviewer
model: claude-sonnet-5-5
effort: medium
role: 'A fixture agent: reviews variants.'
tools:
  - atlas.list_variants
  - run.post_activity
inputs: A region's variants.
outputs: A pick per region.
---

You review variants. This is a fixture, not a real agent.
