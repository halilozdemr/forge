# Code Conventions

## Naming
- Files: kebab-case (`user-repository.ts`)
- Classes: PascalCase (`UserRepository`)
- Functions/variables: camelCase (`getUserById`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- Types/Interfaces: PascalCase, no `I` prefix (`User`, not `IUser`)

## File Structure
- One class/component per file
- File name matches the exported class name
- Test files: `{name}.test.ts` alongside source

## Imports
- Absolute imports preferred over relative when depth > 2
- Group: external packages → internal modules → types
- No wildcard imports (`import * as X`)

## Comments
- KDoc/JSDoc on all public functions and classes
- Inline comments only for non-obvious logic
- No commented-out code in commits
- `[OPEN_QUESTION]` for intentional unresolved items

## Error Handling
- Never swallow exceptions silently
- Use typed error classes, not raw `Error`
- Return `Result<T>` pattern for expected failures
- Throw for unexpected/programmer errors

## Git
- Conventional Commits: `feat`, `fix`, `chore`, `test`, `docs`, `refactor`
- Scope is the module/component affected: `feat(auth): add refresh token`
- Never commit `.env` files
- Never force push to `main` or `develop`
