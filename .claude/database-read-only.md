---
name: database-read-only
description: Supabase Postgres for John-Paul Simulator is read-only unless the user approves a specific write first
metadata:
  node_type: memory
  type: feedback
  originSessionId: 80a0d22e-54fa-42ef-91a0-4100f4916468
  modified: 2026-11-13T04:00:51.529Z
---

If using WebStorm, treat the John-Paul Simulator Supabase database (WebStorm connection "John-Paul Simulator (Supabase)") as read-only. Any write, DDL, schema script or data change requires asking first and getting the user's explicit approval for that specific action before running it. Read-only queries (SELECT, introspection) are fine.

**Why:** the user stated it outright ("treat the database as read-only no matter what… only exception being if you ask for permission and i approve it before running anything").

**How to apply:** before any non-SELECT statement against the DB, describe exactly what will run and wait for a yes. Approval for one write does not carry over to later writes. See [[supabase-connection]].
