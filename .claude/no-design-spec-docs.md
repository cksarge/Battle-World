---
name: no-design-spec-docs
description: User dislikes the design-spec/implementation-plan docs workflow; build directly or use plan mode
metadata:
  node_type: memory
  type: feedback
  originSessionId: 05495cc9-a450-4fc7-9f5b-7be51f8e06d3
  modified: 2026-11-14T05:04:40.829Z
---

Don't write design specs or implementation-plan documents (e.g. into docs/) before building features. Start the changes directly; at most, make a plan in plan mode.

**Why:** On 2026-11-13 the user said they had a design-spec/plan plugin enabled by mistake and didn't like it.
**How to apply:** For new features, skip spec/plan files and either build straight away or use EnterPlanMode if a plan is genuinely needed.
