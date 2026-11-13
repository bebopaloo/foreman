# 2. Usage adds a list-price estimate to the ADR 0007 scope

## Status

Accepted, 2026-11-13.

## Context

Factory ADR 0007 sets the scope of Foreman: three views, of which Usage is the first. The subscription has no per-token bill, so tokens and turns are the true measures of use. The Operator also wants to compare usage in money, for example to see what a skill or a Project would cost at API prices.

## Decision

The Usage view adds a **List-price estimate** as a third metric, next to Tokens and Turns. Tokens stay the default metric.

- A **Price table** in this repo holds the public per-token API prices, with a source URL and an `as_of` date for each row.
- Foreman calculates the estimate when it reads and never stores it, so a price fix changes all of the history.
- Each estimate carries the note: "List-price estimate: what this usage costs at the public API prices. It is not what your subscription charges."
- A model with no price has no estimate. Foreman does not guess a rate.
- A weekly GitHub Actions workflow compares the table with the public pricing page and opens an issue when they differ. Foreman itself makes no outbound HTTP calls.

## Consequences

- The Operator can compare usage in money across Projects, models and skills.
- A reader can mistake the estimate for a charge. The note and the term **List-price estimate** reduce this risk.
- The Price table needs upkeep when prices or models change. The weekly check finds most changes, and it opens an issue when it cannot parse the page.
