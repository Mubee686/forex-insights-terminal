---
name: Bun project lockfiles
description: Keep imported Bun projects from accumulating an incidental npm lockfile during dependency repairs.
---

When repairing dependencies in a Bun project, the package-management installer may use npm and create a package-lock.json even though the repository uses Bun.

**Why:** An extra npm lockfile creates a second package-manager source of truth and can cause Vite to re-optimize dependencies unexpectedly.

**How to apply:** Keep the dependency declarations needed in package.json, remove a newly created package-lock.json if the project did not already use one, and let the existing Bun workflow manage installed modules.