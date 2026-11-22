---
name: supabase-connection
description: "How WebStorm connects to the John-Paul Simulator Supabase DB (IPv4 session pooler, us-west-1)"
metadata:
  node_type: memory
  type: reference
  originSessionId: 80a0d22e-54fa-42ef-91a0-4100f4916468
  modified: 2026-11-13T22:03:02.242Z
---

If using WebStorm, the direct host db.xchruhouswgbakgovzus.supabase.co is IPv6-only and unreachable from the user's network. WebStorm connects through the session pooler instead: aws-1-us-west-1.pooler.supabase.com:5432, database postgres, user postgres.xchruhouswgbakgovzus (aws-0 pooler says "tenant not found"). Credentials live in the WebStorm data source (.idea is gitignored). Writes need approval: [[database-read-only]].

As of 2026-11-13 the user confirmed the WebStorm connection works, so read-only queries can go through the webstorm MCP SQL tools directly. WebStorm flags ~38 "errors" in supabase/schema.sql (auth.users / auth.uid() unresolved because the auth schema isn't introspected, plus make_interval named-arg false positives); they're expected, not real problems.
