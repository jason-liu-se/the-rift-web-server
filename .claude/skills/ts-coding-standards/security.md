# Security: Keeping Secrets Out

Code, tests, docs, logs, and commit messages must never contain information that
exposes the host machine or credentials.

## Never Include

| Category                | Examples                                                       |
| ----------------------- | -------------------------------------------------------------- |
| Host absolute paths     | `/home/<user>/...`, `/Users/<user>/...`, `C:\Users\<user>\...` |
| Environment values      | API keys, tokens, any `*_TOKEN` / `*_SECRET` value             |
| Database credentials    | Connection strings with passwords, database passwords          |
| Keys                    | SSH private keys, signing keys, key passphrases                |
| Service credentials     | OAuth tokens, JWT secrets, service account keys                |
| Private repository URLs | Unless the user explicitly asks                                |

## Guidelines

- **Paths:** use paths relative to the project root, or build them from the
  module's location (`path.join(import.meta.dirname, "file.json")`).
- **Credentials:** read them from configuration (see `CLAUDE.md` for how this
  repo loads env), never hard-code them, including in tests and examples. In
  example config, show a placeholder or variable reference, not a real value.
- **Logs and errors:** don't log secrets or full connection strings. Redact
  before logging when an object might contain them.
- **Docs:** describe locations relative to the repo, not your machine.

## Before Committing

- [ ] No absolute host paths
- [ ] No environment variable values (names and references are fine)
- [ ] No keys, tokens, or passwords
- [ ] No connection strings with credentials
- [ ] No private repository URLs (unless requested)

## If a Request Would Break These Rules

1. Warn the user about the risk.
2. Suggest a safe alternative (environment variable, secret manager).
3. Proceed only if the user confirms after understanding the risk.

## References

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [The Twelve-Factor App: Config](https://12factor.net/config)
