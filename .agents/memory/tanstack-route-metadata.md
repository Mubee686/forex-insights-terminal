---
name: TanStack route metadata
description: A workflow cleanup lesson for imported TanStack Start projects whose generated route file changes during dev startup.
---

TanStack Start's dev process may rewrite the generated route metadata file when the dependency environment changes, even when the requested work is unrelated to routing.

**Why:** A CSS-only task can otherwise appear to include unrelated generated route changes after starting or restarting Vite.

**How to apply:** Verify the generated route file against the baseline after dependency setup. If it changed only in generated ordering, stop the workflow, restore that incidental diff, and rely on the already-verified preview rather than restarting again before delivery.