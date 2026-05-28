# Code Review Guidelines — SOLID Compliance

> How to use automated tool output and what additional manual checks to perform for SOLID principles in the @hermes/mcp-toolset TypeScript monorepo.

## Overview

This project enforces SOLID principles through a layered approach:

| Layer | Tool | What it catches |
|---|---|---|
| **Static analysis** | ESLint + `@typescript-eslint` | Unused vars, explicit-any, type-checking errors |
| **Type checking** | `tsc --noEmit` | Type-level violations, interface mismatches |
| **SOLID checks** | `solid-enforcer` (MCP tool) | Principle-specific violations per file |
| **Architecture** | `dependency-cruiser` | Module-level dependency direction violations (DIP) |
| **Human review** | This guide | Semantic gaps, cross-file concerns, design patterns |

The automated tools catch the *mechanical* violations. The reviewer catches the *semantic* ones. Both are required.

---

## 1. Running the Automated Checks

Before requesting review, the author runs:

```bash
# Full SOLID scan on changed files
npx hermes-mcp call solid_enforcer.check '{"file":"packages/<name>/src/<file>.ts","code":"$(cat packages/<name>/src/<file>.ts)"}'

# Single principle (faster during iteration)
npx hermes-mcp call solid_enforcer.check_single '{"file":"...","code":"$(cat ...)","principle":"single_responsibility"}'

# Type check
npx tsc --noEmit

# ESLint
npx eslint packages/<name>/src/

# Architecture (dependency-cruiser)
npx depcruise packages/<name>/src/ --ts-config tsconfig.json
```

---

## 2. Per-Principle Review Guide

### 2.1 Single Responsibility Principle (SRP)

**What the automated tool checks:**
- Regex-based concern-area detection — flags classes referencing >1 domain (DB, UI, business logic, external services, logging, etc.)
- Skips delegation calls (`this.repo.save()`) and constructor type annotations
- Configurable via `minConcernAreas` (default: 2)

**What the tool misses — manual checks:**

- **Cohesion of purpose.** A class may reference only one concern area but still have unrelated responsibilities. Example: a `ReportGenerator` that both fetches data *and* formats it as HTML *and* emails it — even if all uses are "reporting," there are three reasons to change.
- **Hidden side effects.** A method named `getUser()` that also logs, sends metrics, and writes to a cache. The tool sees the method name, not the side effects.
- **Cross-cutting concerns mixed with business logic.** Transaction management, caching, retry logic, authorization checks woven into business methods.

**Common violation & fix:**

```typescript
// BAD: UserManager handles DB, formatting, notifications, and logging
export class UserManager {
  async saveUser(user: User) { /* DB query */ }
  formatUserHTML(user: User): string { /* template */ }
  sendWelcomeEmail(user: User) { /* fetch call */ }
  logActivity(userId: string) { /* logger call */ }
}

// GOOD: Decomposed into focused collaborators
export class UserRepository { /* DB only */ }
export class UserFormatter { /* formatting only */ }
export class WelcomeEmailSender { /* notification only */ }
export class UserActivityLogger { /* logging only */ }
```

**Reviewer's question:** *"Does this class have more than one reason to change?"*

---

### 2.2 Open/Closed Principle (OCP)

**What the automated tool checks:**
- Switch statements with >3 branches on a type discriminator
- If-else chains on string/value comparisons (consecutive, within 3 lines)
- Typeof/instanceof chains (>3 branches)

**What the tool misses — manual checks:**

- **Strategy pattern that's grown too wide.** A strategy interface with 15+ implementations where every new feature adds a new strategy class is mechanically OCP-compliant but indicates a design that should be data-driven (registry/map lookup) rather than class-per-variant.
- **Visitor pattern abuse.** Adding a new visitor means editing all visited element classes — that's OCP violation in the visited hierarchy.
- **Decorator / middleware that adds behavior *before* the guarded check.** A decorator that says "if slow, time it" is fine. A decorator that adds new logic unrelated to the base interface is a violation.
- **Conditional compilation / feature flags.** Multiple code paths behind `if (process.env.FLAG)` are modification-prone and violate the spirit of OCP.
- **Large `switch` on non-type discriminators** (e.g., switching on string IDs where no polymorphism is possible — may be a leaky abstraction).

**Common violation & fix:**

```typescript
// BAD: Modification-prone switch
function calculateDiscount(userType: string): number {
  switch (userType) {
    case 'guest': return 0;
    case 'regular': return 0.1;
    case 'premium': return 0.2;
    case 'vip': return 0.3;
    // Adding a new type → edit this method
  }
}

// GOOD: Extensible via strategy pattern
interface DiscountStrategy {
  getDiscount(): number;
}

class GuestDiscount implements DiscountStrategy {
  getDiscount(): number { return 0; }
}

class PremiumDiscount implements DiscountStrategy {
  getDiscount(): number { return 0.2; }
}

// New strategy → new class, no editing
```

**Reviewer's question:** *"Can I add new behavior without modifying existing code?"*

---

### 2.3 Liskov Substitution Principle (LSP)

**What the automated tool checks:**
- `NotImplementedError` throws in derived classes
- Empty method stubs (body is whitespace-only)
- Generic `throw new Error(...)` in derived class methods

**What the tool misses — manual checks:**

- **Precondition strengthening.** A derived class that adds input validation the base class doesn't have (`if (x < 0) throw...` where base allows any number). The tool doesn't analyze runtime contracts.
- **Postcondition weakening.** A derived class that returns a subset of what the base contract promises (returns `null` where base guarantees non-null; returns partial data).
- **Invariant violation.** A derived class that breaks the base class's internal consistency rules (e.g., a `SortedSet` that doesn't actually keep elements sorted).
- **Type covariance/contravariance issues.** A derived class's method returning a more specific type is usually fine, but accepting a broader type of parameter than the base is not.
- **Side-effect changes.** A derived `save()` that silently skips the database and logs to console instead — the tool sees the method exists, not what it does.
- **Thrown exception types.** The tool detects `throw new Error()` but won't catch a derived class that throws `DatabaseException` where the base is documented to throw `ValidationException`.

**Common violation & fix:**

```typescript
// BAD: Derived class throws NotImplementedError
abstract class Repository {
  abstract save(entity: Entity): Promise<void>;
}

class ReadOnlyRepository extends Repository {
  async save(entity: Entity): Promise<void> {
    throw new NotImplementedError('Read-only repository cannot save');
  }
}

// GOOD: Split the interface
interface ReadableRepository {
  find(id: string): Promise<Entity | null>;
}

interface WritableRepository extends ReadableRepository {
  save(entity: Entity): Promise<void>;
}

class ReadOnlyRepo implements ReadableRepository { /* ... */ }
class FullRepo implements WritableRepository { /* ... */ }
```

**Reviewer's question:** *"Can I swap any derived class instance with its base type without breaking the program?"*

---

### 2.4 Interface Segregation Principle (ISP)

**What the automated tool checks:**
- Interfaces with >5 methods (configurable via `minInterfaceMethods`)
- Type aliases with >5 method signatures
- Classes that implement an interface but leave some methods throwing `NotImplementedError`

**What the tool misses — manual checks:**

- **Semantic cohesion.** An interface with 4 methods where 2 are about data access and 2 are about formatting — the tool only counts methods, not cohesion. The reviewer must judge whether the methods belong together conceptually.
- **Role interfaces vs. header interfaces.** A `User` class implementing `IUserRepository`, `INotifiable`, `IAuditable`, and `ISerializable` is ISP-friendly. A single `IUserContract` with all those methods jammed together is not — but if it has only 4 methods, the tool won't flag it.
- **Fat type unions.** A union type like `type Handler = FetchFn | ParseFn | StoreFn | NotifyFn | LogFn` — the tool only checks object-type interfaces, not union members.
- **Callback-heavy interfaces.** An interface with 4 callbacks (`onSuccess`, `onError`, `onProgress`, `onComplete`) is mechanically fine but might be better split into separate listener interfaces.

**Common violation & fix:**

```typescript
// BAD: Fat interface forces partial implementations
interface MediaPlayer {
  play(): void;
  pause(): void;
  stop(): void;
  nextTrack(): void;
  previousTrack(): void;
  shuffle(): void;
  repeat(): void;
  adjustVolume(level: number): void;
  mute(): void;
  equalizer(settings: EqualizerSettings): void;
}

class BasicAudioPlayer implements MediaPlayer {
  play(): void { /* ok */ }
  pause(): void { /* ok */ }
  stop(): void { /* ok */ }
  nextTrack(): void { throw new NotImplementedError(); }   // forced stub
  previousTrack(): void { throw new NotImplementedError(); }
  shuffle(): void { throw new NotImplementedError(); }
  // ... more stubs
}

// GOOD: Segregated by role
interface PlaybackControl { play(): void; pause(): void; stop(): void; }
interface TrackNavigation { nextTrack(): void; previousTrack(): void; }
interface PlaylistManagement { shuffle(): void; repeat(): void; }
interface AudioControl { adjustVolume(level: number): void; mute(): void; }

class BasicAudioPlayer implements PlaybackControl { /* only what it needs */ }
```

**Reviewer's question:** *"Does any implementor of this interface have to leave methods unimplemented?"*

---

### 2.5 Dependency Inversion Principle (DIP)

**What the automated tool checks:**
- `new ConcreteClassName()` calls inside class methods (excludes value objects/DTOs and built-ins)
- Static method calls on concrete classes (e.g., `MetricsCollector.record()`)
- Constructor parameters that don't look like interface/abstract types (when concrete instantiations exist)
- Configurable via `valueObjectPatterns` to skip DTOs, events, config objects, etc.

**What the tool misses — manual checks:**

- **Module-level coupling.** Package A importing directly from Package B's concrete module rather than through an interface defined in a shared package. The tool checks *file-level* code, not module dependencies across packages.
- **Service locator pattern.** `container.get(ConcreteService)` — the tool doesn't flag this because there's no `new`. But this still couples the consumer to a specific service resolution strategy.
- **Temporal coupling / partial injection.** A class that receives some dependencies via constructor but pulls others from globals, singletons, or process.env mid-method.
- **Factory misuse.** A `WidgetFactory` that is itself a concrete class rather than an interface. The consumer who uses `new WidgetFactory()` is still coupled to a concrete factory.
- **Leaky abstractions.** An injected interface that exposes concrete dependency details (e.g., `IRepository` with a `getConnection(): SqlConnection` method that returns a MySQL-specific type).
- **Over-injection.** A constructor with 7+ interface parameters — this suggests SRP is being violated at the class level even though DIP is satisfied.

**Common violation & fix:**

```typescript
// BAD: Direct concrete instantiation + static method call
class OrderService {
  private db: MySqlDatabase;
  constructor() {
    this.db = new MySqlDatabase();
    MetricsCollector.getInstance().record('order.service.created', 1);
  }
}

// GOOD: Constructor injection with abstractions
interface IDatabase { save(table: string, data: any): Promise<void>; }
interface IMetrics { increment(name: string): void; }

class OrderService {
  constructor(
    private db: IDatabase,
    private metrics: IMetrics,
  ) {}
}
```

**Reviewer's question:** *"Does this class depend on abstractions, not concretions?"*

---

## 3. Cross-File / Cross-Module Review

Automated tools operate on single files. The reviewer checks:

- **Circular dependencies.** Run `npx madge packages/<name>/src/ --circular --extensions ts` to detect cycles. Circular dependencies are a sign of misplaced abstraction boundaries.
- **Package-level DIP.** `packages/a/src/` should import interfaces from `packages/shared/src/`, not concrete classes from `packages/b/src/`. The `dependency-cruiser` config (if configured) enforces this — run `npx depcruise packages/`.
- **Module cohesion.** Package exports should feel like a coherent unit. If `packages/repograph/src/index.ts` also exports a markdown-rendering function, that's a smell.
- **Testability.** If a class is hard to unit-test without mocks, it's probably violating DIP. The inability to inject test doubles is a red flag.

---

## 4. PR Workflow

### Before Review (Author)

1. Run `npm run build` → confirms `tsc` compiles cleanly
2. Run `npm test` → confirms all tests pass
3. Run ESLint on changed files
4. Run `solid_enforcer.check` on each changed source file
5. Self-review each violation: is it a false positive (skip) or real (fix)?

### During Review (Reviewer)

1. Check the automated tool output was run (author should have a comment or commit showing it)
2. For each changed file, evaluate the 5 manual check areas above
3. Specifically verify: no SRP cross-concern mixing, no OCP large switches on types, no LSP throw-not-implemented stubs, no ISP fat interfaces, no DIP concrete `new` calls
4. Check cross-file concerns — especially if the PR touches multiple packages
5. If the PR introduces a new abstraction (interface, abstract class), verify it is actually used polymorphically — unused abstractions are complexity without benefit

### Post-Merge

When the PR template checkbox for SOLID is checked and the review has validated it, merge is safe. If you find violations that the automated tool *should* have caught but didn't, open an issue against `packages/solid-enforcer` to improve the rule.

---

## 5. False Positive Handling

Automated tools produce false positives. The reviewer decides:

| Tool output | Possibly false if... | Action |
|---|---|---|
| SRP: "multiple concerns" | Class is a well-known Facade or Mediator | Acknowledge in PR description, explain pattern |
| OCP: "switch with 4 branches" | Switch is in a data-mapping layer (JSON→model) where mapping is inherently one-to-one | Move to a lookup table if possible, or document why switch is correct |
| ISP: "interface has 8 methods" | Interface represents a well-known protocol (e.g., HTTP handler with exact interface) | Reference the protocol spec in a comment |
| DIP: "instantiates Logger" | Logger is a well-known cross-cutting concern, not a business dependency | Acceptable — but prefer injection when practical |

Document false positives in a comment or the PR description so the next reviewer knows.

---

## References

- SOLID Enforcement Report: `research/SOLID-ENFORCEMENT-REPORT.md`
- solid-enforcer rules: `packages/solid-enforcer/src/rules/`
- Project architecture: `ARCHITECTURE.md`
- Roadmap: `PROJECT_ROADMAP.md`
