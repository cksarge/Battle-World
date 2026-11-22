---
name: local-test-server
description: "How to load the game in a browser for testing — WebStorm's built-in server at localhost:63342, no command needed"
metadata:
  node_type: memory
  type: reference
  originSessionId: 480bd8a4-1072-444c-a036-f498d32c7b4e
  modified: 2026-11-16T17:02:58.791Z
---

If using WebStorm, open http://localhost:63342/John%20Paul%20Simulator/index.html to test the game. WebStorm's built-in server serves the project there; the user enabled "Allow unsigned requests" (Settings → Build, Execution, Deployment → Debugger) on 2026-11-16 so outside browsers can load it. All game paths are relative, so it works under that prefix.

Starting `python3 -m http.server` from Bash is often blocked by the auto-mode permission check, so prefer the WebStorm URL. It is a different origin from localhost:8765, so localStorage (settings, guest data) starts empty there. Chrome caches modules: `fetch(url, {cache: 'reload'})` the changed files, then reload.
