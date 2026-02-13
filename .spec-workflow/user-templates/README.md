# User Templates -- MC Server Manager

Custom spec-workflow templates tailored for this project's architecture and conventions.

## What's Customized

These templates override the generic defaults in `../templates/` with MC Server Manager-specific content:

### Spec Templates (Requirements -> Design -> Tasks)

| Template | Key Customizations |
|----------|-------------------|
| `requirements-template.md` | MC Server Manager user roles (player/host/admin), standing non-functional requirements, dependency tracking between specs, migration/compatibility section |
| `design-template.md` | Project architecture reference (Express+ws/React+Zustand/Electron/shared), exact TypeScript interface format, API endpoint tables, WS event tables, implementation order as first-class section, verification strategy (manual -- no test framework) |
| `tasks-template.md` | **Highest impact.** Full architecture reference in comments, correct build order (shared types -> migrations -> models -> services -> routes -> mount -> WS -> frontend API -> stores -> WS wiring -> components -> pages -> verify), exhaustive `_Prompt` field quality checklist, oh-my-opencode delegation protocol baked in |

### Steering Templates (Product / Tech / Structure)

| Template | Key Customizations |
|----------|-------------------|
| `product-template.md` | Pre-seeded with MC Server Manager product context, user personas, implemented vs planned features, product principles |
| `tech-template.md` | Pre-seeded with actual tech stack (versions, rationale), architecture patterns, auth flow, decision log |
| `structure-template.md` | Pre-seeded with actual directory tree, naming conventions, import patterns, code structure examples (route/model/store/page patterns), module boundaries, code size guidelines |

## How It Works

The spec-workflow system checks `user-templates/` first. If a matching filename is found, it's used instead of the default from `templates/`. See the [spec-workflow guide](../templates/) for the full workflow.

## When to Update These Templates

Update these templates when:
- A new package is added to the monorepo
- A major dependency is changed (e.g., swapping Zustand for something else)
- New architectural patterns are established (e.g., adding a test framework)
- A completed spec changes how features are structured

The steering templates (`product-template.md`, `tech-template.md`, `structure-template.md`) are especially sensitive to project evolution -- they contain pre-seeded project facts that go stale.
