# Engineering Standards

These standards are non-negotiable. Every agent enforces them. Every line of code must comply.

## SOLID

### Single Responsibility Principle
One class = one reason to change.
If a class does two things, split it.

### Open/Closed Principle
Open for extension, closed for modification.
Add behavior by adding code, not changing existing code.

### Liskov Substitution Principle
Subtypes must be fully substitutable for their base types.
If you override a method, the contract must hold.

### Interface Segregation Principle
Many small, focused interfaces over one large general-purpose one.
Clients should not depend on methods they don't use.

### Dependency Inversion Principle
Depend on abstractions, not concrete implementations.
High-level modules should not import low-level modules directly.

---

## DRY — Don't Repeat Yourself

If logic appears in two places, it must be extracted.
Duplication is a bug waiting to happen.
Shared logic belongs in a shared module.

---

## YAGNI — You Aren't Gonna Need It

Build what is needed today, not what might be needed tomorrow.
No speculative abstractions.
No "just in case" parameters.
No unused code.

---

## Quality Gates (Reviewer enforces all of these)

### Tests
- Every task must produce unit tests
- Minimum: happy path + at least one error/edge path
- Tests must be deterministic — no flakiness
- No `skip` or `todo` in test files without `[OPEN_QUESTION]` comment

### Code
- No `TODO` without `[OPEN_QUESTION]` and explanation
- No hardcoded strings visible to users
- No magic numbers — use named constants
- No dead code
- No console.log / print statements in production paths

### Architecture
- No circular dependencies
- No layer violations (UI → Domain → Data, not the reverse)
- Dependencies point inward only
