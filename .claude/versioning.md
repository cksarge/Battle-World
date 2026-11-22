---
name: versioning
description: Every change bumps GAME_VERSION (MAJOR.Minor.patch) and adds a CHANGELOG.md entry
metadata:
  node_type: memory
  type: feedback
  originSessionId: 480bd8a4-1072-444c-a036-f498d32c7b4e
  modified: 2026-11-18T18:51:50.967Z
---

Every change to the game must bump `GAME_VERSION` in `js/config.js` (format MAJOR.Minor.patch) and add an entry at the top of `CHANGELOG.md` in the same commit. MAJOR = game-changing update (new kind of play / rework), Minor = new feature or content, patch = fix, balance change or small tweak. Docs- or hosting-only commits don't bump.

**Why:** the user asked for this on 2026-11-16 when the changelog and in-menu "Version x.y.z (commit)" footer were added. History was back-filled from 1.0.0 (launch) to 3.6.0 (the changelog itself); 2.0.0 = ranked seasons, 3.0.0 = zombies and objective modes.

**How to apply:** when committing a change, pick the bump, edit GAME_VERSION, and add a `x.y.z · YYYY-MM-DD` section with player-facing bullets. Heading level marks the bump (user's choice): `##` major, `###` minor, `####` patch. The changelog is player-facing: no explanation of the versioning scheme in it (the user removed that intro). Leave the newest entry without a commit link (its hash doesn't exist yet); add the link to it when the next version is written. Before every commit, check that every entry below the new one has its `· [hash](https://github.com/cksarge/John-Paul-Simulator/commit/hash)` link; the user called this out on 2026-11-18 after three entries in a row (4.7.4–4.7.6) went in without them. The footer's commit hash is fetched live from GitHub's API (js/ui/changelog.js), so it needs no manual update.
