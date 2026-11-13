<!-- stack-ts 0.7.0: from Rule template typescript. The team owns this file. -->
# TypeScript

## Compiler

- Keep `strict: true` and `noUncheckedIndexedAccess: true` in every `tsconfig.json`. Never turn a strict flag off to make code compile.
- Never use `any`. Use `unknown` and narrow it. A `// @ts-expect-error` needs a reason on the same line; never use `// @ts-ignore`.
- Never use a non-null assertion (`!`) or a type assertion (`as`) on data that crosses a boundary. Validate it instead.
- The type check (`pnpm typecheck`) passes before every commit.

## Types

- Validate data at every boundary with Zod: request bodies, query strings, environment variables, responses from other services, browser storage. Infer the type from the schema with `z.infer`; do not write the type twice.
- Model states that must not occur as types that cannot express them: discriminated unions, not optional fields that must be set together.
- Give a domain value its own branded type when two values share a primitive type but must not be mixed, for example a patient id and a user id.
- Never use floating point for money. Store integer minor units.

## Modules

- ES modules only. Use named exports; no default exports, except where a framework requires one.
- One package per deployable or shared library in the pnpm workspace. A package imports another only through its declared entry point, never through a relative path into its `src/`.
- Read `process.env` in one config module that validates it with Zod at start-up. Other modules import the config.

## Errors

- Throw `Error` objects or subclasses, never strings. Give each expected failure its own error class or a result type.
- Never swallow an error with an empty `catch`. Handle it, add context and rethrow, or let it reach the error handler.
- Every `Promise` is awaited, returned or passed to a handler. Keep the `no-floating-promises` lint rule on.

## Tooling

- pnpm is the only package manager. Commit `pnpm-lock.yaml`. Never commit a `package-lock.json` or `yarn.lock`.
- Add a dependency with an exact version (`pnpm add -E`).
- ESLint with the `typescript-eslint` type-checked rules, and Prettier, run in CI. Do not disable a rule inline without a reason.
