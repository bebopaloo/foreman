<!-- factory-core 0.8.1: from Rule template testing. The team owns this file. -->
# Testing

- Every change ships with tests. Write the failing test first, then the code: use the `tdd` skill.
- Test behaviour through the public interface. A test must survive a refactor that keeps the behaviour.
- Mock only at the boundaries of the system: the network, the clock, randomness and third-party services. Never mock your own modules.
- Use the lowest test layer that can show the behaviour. Add a higher-layer test only for what the lower layer cannot reach.
- A bug fix starts with a test that reproduces the bug.
- Never weaken, skip or delete a test to make it pass. If a test is wrong, say why and fix it in its own change.
- Test data is synthetic. Never copy real personal data into fixtures or seed data.
