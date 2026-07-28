# Agent Guidelines

This is a TanStack Start (React 19 + Vite + file-based routing) project with
Tailwind CSS v4, Supabase for auth/database, and Bun as the package manager.

## Key conventions
- Package manager: **Bun** (`bun add`, `bun install`). Do not create `package-lock.json`.
- Supabase credentials come from environment variables — never hard-code them.
- Generated files (`src/routeTree.gen.ts`, `src/integrations/supabase/types.ts`) are
  auto-regenerated; avoid editing them directly.
- Server-only modules use the `.server.ts` suffix and must not be imported from
  client-side code.
- Stop the dev workflow before restoring or editing files that affect
  `routeTree.gen.ts`, then restart it afterward.
