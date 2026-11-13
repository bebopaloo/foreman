<!-- factory-core 0.8.1: from Rule template coding. The team owns this file. -->
# Coding

## Input validation

- Validate input at every boundary: request handlers, message consumers, file readers, responses from other services, URL parameters and browser storage.
- Check shape, type, range and length. Reject unknown fields; do not ignore them.
- Use the stack's schema library, not hand-written `if` chains. Code behind a boundary trusts the validated types.

## Output encoding

- Encode for the destination: an HTML body, an HTML attribute, JavaScript, a URL, CSS, a shell command, SQL and JSON each need their own encoder.
- Use the framework's encoder. Never write your own.
- Build SQL with parameters and shell commands with argument lists. Never join untrusted text into either.

## Errors and logs

- Send a generic error message to the caller. Log the details internally.
- Mask sensitive log fields by key name, not by a pattern on the value.
- Never log secrets or personal data.

## Dependencies

- Pin every dependency to an exact version.
- Adopt only releases that are at least 7 days old. The exception is a documented security fix.
- Prefer the first-party package to a wrapper.

## Comments

- Write a comment only to explain why, when the reason is not obvious from the code.
- Describe the code as it is now. Do not mention tickets, earlier versions or pull requests: that history is in git.
- When you change code, fix or delete any comment that it makes untrue.
