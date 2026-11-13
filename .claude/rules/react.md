---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---
<!-- stack-ts 0.5.1: from Rule template react. The team owns this file. -->

# React

## Components

- Function components only. Keep a component's props as a named type next to it.
- Derive values during render. Use `useEffect` only to sync with a system outside React, not to compute state from props or state.
- Keep server state (data from the API) in TanStack Query, not in `useState` or a global store. Keep a global store only for client state that many routes share.
- Validate every API response with the Zod schema from the shared package before the UI uses it.

## Accessibility

WCAG 2.2 AA is the minimum standard.

- Use semantic elements: `button` for actions, `a` with `href` for navigation, `label` for every form control, headings in order.
- Every interaction works with the keyboard alone, with a visible focus indicator.
- Give an image a text alternative, or `alt=""` when it is decorative.
- Do not use colour as the only way to give information. Text contrast is at least 4.5:1.
- Announce errors and async results to screen readers: link an error to its field with `aria-describedby`, and use a live region for status messages.
- Add ARIA only when no native element does the job.

## Security

- Never use `dangerouslySetInnerHTML` with text that a user or an API can control. If HTML must be rendered, sanitise it with DOMPurify first.
- Never build a URL for `href` or `src` from user input without checking its scheme against an allow-list (`https:`, `mailto:`).
- Keep tokens out of `localStorage`. Use `HttpOnly`, `Secure`, `SameSite` cookies.

## Async UI

- Handle the loading, error and empty states of every query. Show a generic error message; log the details.
- Disable a submit button while its request runs, so a double click does not send the request twice.
- Ignore a response that arrives after the component unmounted or after a newer request started.
