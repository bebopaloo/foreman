<!-- stack-ts 0.7.0: from Rule template postgres-drizzle. The team owns this file. -->
# Postgres with Drizzle

## Schema and migrations

- The Drizzle schema in TypeScript is the source of truth. Generate each migration with `drizzle-kit generate` and commit the SQL file with the schema change.
- Read every generated migration before you commit it. Drizzle can drop and re-create a column when you meant a rename.
- Never edit a migration that has run outside your machine. Write a new one.
- Never run `drizzle-kit push` against a shared database. Apply migrations with `drizzle-kit migrate` only.
- Make a breaking change in steps, so the old and the new code both work during a deploy: add the new column, write to both, backfill, read from the new one, then drop the old one in a later release.
- Every foreign key column has an index. Add an index for every filter that a list route uses.

## Queries

- Use the Drizzle query builder or the `sql` tagged template. Both send parameters. Never join a value into SQL text with string concatenation or `sql.raw`.
- Scope every query on tenant or user data by the owner id in the `where` clause.
- Select the columns you need, not every column. A response must not depend on the table shape.
- Watch for N+1 queries: load related rows with a join or one `inArray` query, not one query per row.
- Run writes that must succeed together in `db.transaction`. Keep calls to other services outside the transaction.
- Set a `statement_timeout` on the connection pool.

## Data

- Store time as `timestamp with time zone`, in UTC.
- Store money as integer minor units, never `real` or `double precision`.
- Seed and test data are synthetic. Never copy production data to a local or test database.
