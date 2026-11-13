<!-- stack-ts 0.7.0: from Rule template fastify-api. The team owns this file. -->
# Fastify API

## Routes

- Every route declares Zod schemas for its params, query, body and response through `fastify-type-provider-zod`. A response schema stops the API from sending fields that it must not send.
- Reject unknown fields: use `.strict()` on body and query schemas.
- Every list route is paginated, with a default and a maximum page size.
- Register routes in one plugin per feature. A plugin gets its dependencies (database, config, clients) as options; it does not import them as globals. Tests can then pass fakes at the boundary.

## Access control

- Every route has an explicit auth decision: an `onRequest` hook that checks the session, or a `public: true` route option that a reviewer can see. Deny by default.
- Check that the signed-in user may act on the record itself, not only that the route is allowed. Load the record with the user or tenant id in the `where` clause.
- Register `@fastify/helmet`, `@fastify/cors` with an allow-list of origins, and `@fastify/rate-limit` on sign-in and other costly routes.
- With cookie sessions, protect every state-changing route against CSRF (`@fastify/csrf-protection`). Set cookies `HttpOnly`, `Secure` and `SameSite=Lax` or stricter.

## Errors and logs

- One `setErrorHandler` maps errors to responses. It sends a generic message and the request id to the caller, and logs the details.
- Use the Fastify logger (Pino). Set `redact` to the key names of secrets and personal data: `authorization`, `cookie`, `password`, `token`, and the personal fields of the domain.
- Never put personal data in a URL path or query string: it reaches access logs.

## Outbound calls

- Every call to another service has a timeout and validates the response with Zod.
- Allow-list the hosts that the server may call. Never fetch a URL that a user gave without that check.

## Server

- Build the app in a `buildApp(options)` function that returns the Fastify instance without listening. Tests use `app.inject()`; `server.ts` calls `listen`.
- Read config once, at start-up, from the validated config module. Fail fast on a missing variable.
- Close the database pool in an `onClose` hook, so tests and shutdown do not leak connections.
