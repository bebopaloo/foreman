# _context

The knowledge base for this repo. Agents read it before they plan. It describes the code as it is now; history stays in git.

| Path | Holds | Written by |
|---|---|---|
| `terminology.md` | The glossary. Use these terms in code, docs and conversation. | `grill-me` |
| `adr/NNNN-<slug>.md` | One record per decision that a reader of the code cannot see | `grill-me`, `to-spec` |
| `features/<slug>.md` | One **Spec** per feature: problem, acceptance criteria, design, gating, rollout | `to-spec` |
| `plans/` | Plans for one work item. Not committed (`.gitignore`). | `write-plan` |

## Terminology entry

```markdown
### Term
One to three sentences. **Bold** a term only when it refers to another entry.\
_Parent:_ **Wider term** (only when this term is a kind or a part of it)\
_Subtypes:_ **A**, **B**\
_Refs:_ **C**\
_Avoid_: other names people use for it
```

- A reader who does not code must understand the entry. No file paths, class names or field names.
- Put basic terms first and terms that depend on them after.
- Add a `### A vs B` entry under `## Flagged ambiguities` when two terms are easy to confuse.

## ADR

File name: `NNNN-<slug>.md`, numbered from `0001`. Write an ADR only when the decision is hard to reverse, a reader would be surprised by it, and there was a real alternative.

```markdown
# N. <Decision as a short statement>

## Status

Accepted, YYYY-MM-DD. (Or: Superseded by NNNN.)

## Context

<The problem and the forces, in a few sentences.>

## Decision

<What we do now.>

## Consequences

<What this makes easier and harder. Leave out what is obvious.>
```

Change an ADR in place while its decision stands. When a new decision replaces it, write a new ADR and mark the old one "Superseded by NNNN".
