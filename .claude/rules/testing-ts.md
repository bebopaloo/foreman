<!-- stack-ts 0.5.1: from Rule template testing-ts. The team owns this file. -->
# Testing in TypeScript

The core testing rule says what to test. This rule names the tools for each layer. For the test skeleton and helpers of a layer, load the `stack-ts:test-recipes` skill.

| Layer | Tool | Where |
|---|---|---|
| Unit | Vitest | `*.test.ts` next to the code |
| Component | Vitest, React Testing Library, `@testing-library/user-event`, jsdom | `*.test.tsx` next to the component |
| API integration | Vitest, Fastify `app.inject()`, a real Postgres database | `apps/api/test/` |
| End to end | Playwright, `@axe-core/playwright` | `e2e/` |

- Query the DOM by role and accessible name (`getByRole`), then by label. Use `data-testid` only when no accessible query works.
- Drive the UI with `userEvent`, not `fireEvent`.
- API integration tests use a real Postgres database with the migrations applied. Do not mock Drizzle or the database driver.
- Mock only at the system boundary: other services over HTTP (with `msw`), the clock (`vi.useFakeTimers`) and randomness.
- Every end-to-end test of a page runs an axe scan and fails on any WCAG 2.2 AA violation.
- Commands: `pnpm test` runs the unit, component and integration tests; `pnpm test:e2e` runs Playwright.
