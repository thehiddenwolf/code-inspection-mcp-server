## Description

<!-- Describe the change and the problem it solves. Max 3 sentences. -->

Closes #<!-- issue number if applicable -->

## Type of Change

- [ ] feat: new feature (non-breaking)
- [ ] fix: bug fix (non-breaking)
- [ ] refactor: code change that neither fixes a bug nor adds a feature
- [ ] docs: documentation only
- [ ] test: adding or updating tests
- [ ] chore: tooling, CI, dependencies

## SOLID Compliance Checklist

Run the automated SOLID checks before requesting review. See `CODE-REVIEW-GUIDELINES.md` for detailed manual checks that complement the tooling.

```bash
# Check changed files (full scan)
npx hermes-mcp call solid_enforcer.check '{"file":"<file>","code":"$(cat <file>)"}'

# Single principle (faster iteration)
npx hermes-mcp call solid_enforcer.check_single '{"file":"<file>","code":"$(cat <file>)","principle":"single_responsibility"}'

# Type checks
npx tsc --noEmit
npx eslint packages/<name>/src/<changed-file>
```

- [ ] [SRP] Each changed class has a single, well-defined responsibility *and all concerns are cohesive*
- [ ] [OCP] No large switch/if-else chains on type discriminators; new behavior can be added by extending, not modifying existing code
- [ ] [LSP] No NotImplementedError stubs, empty method bodies, or generic Error throws in derived classes; derived types are truly substitutable
- [ ] [ISP] Interfaces are focused (<5 methods); no implementors forced to leave methods unimplemented; method groups are semantically cohesive
- [ ] [DIP] Dependencies injected as abstractions (interfaces), not concrete classes; no direct `new ConcreteClass()` in methods; no service-locator or static-method coupling

## Testing

- [ ] `npm run build` passes
- [ ] `npm test` passes (100% of existing tests)
- [ ] Added/updated tests for new code (if applicable)

## Additional Notes

<!-- Any false-positive flags from automated checks, design decisions, or migration notes -->
