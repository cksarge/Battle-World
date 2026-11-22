---
name: github-branch-rule
description: "main requires PRs + CODEOWNERS (* @cksarge) for outside contributors; the user's own pushes bypass it — keep pushing straight to main"
metadata:
  node_type: memory
  type: project
  originSessionId: 480bd8a4-1072-444c-a036-f498d32c7b4e
  modified: 2026-11-17T01:28:15.738Z
---

Since 2026-11-16 the repo's main branch has a "changes must be made through a pull request" rule, plus .github/CODEOWNERS (`* @cksarge`), so the user reviews any outside contribution (e.g. people going for the Developer calling card). The user's own pushes print "Bypassed rule violations" and still succeed.

**Why:** the rule is for others, not for this workflow.
**How to apply:** keep committing and pushing directly to main when asked; the bypass warning is expected and not worth flagging again. See [[versioning]].
