# Rust off Rails samples

Tested reference code for the parts every [Rust off Rails](https://rustoffrails.org) app needs: a mailer, a dev mailbox, a job queue, accounts, realtime. An agent copies a sample into its app and adapts it; from then on the app owns that code. Nothing here is a dependency, and nothing is mandatory: the framework's guides describe each part, and a sample is the version that was built, tested on SQLite and Postgres, and reviewed for security.

Every sample follows the framework's conventions exactly (stack, layout, naming, the Definition of Done), so copied code looks like code the agent would have written. Comments mark what to change (`// APP:`), what to keep and why (`// WHY:`, `// INVARIANT:`, `// SECURITY:`), and the guide section it implements (`// GUIDE:`), so even a small model adapts a sample safely ([format](samples/FORMAT.md#comments-that-guide-the-next-model)).

## Samples

| Sample | Depends on | Status | What |
|--------|-----------|--------|------|
| [mailer](samples/mailer/) | — | ready | Templated HTML + text email; SMTP, dev mailbox storage, log and memory adapters; previews; a test-email task; header-injection checks |
| [dev-mailbox](samples/dev-mailbox/) | mailer | ready | `/dev/mailbox`: live inbox, sandboxed HTML viewer with width and dark previews, codes and links with copy, attachments, checks, search, keyboard, JSON and a CLI. Development only |
| [jobs](samples/jobs/) | — | ready | A database-backed job queue: `SKIP LOCKED` on Postgres, retries with backoff, unique and scheduled jobs, cron |
| [jobs-dashboard](samples/jobs-dashboard/) | jobs | ready | `/admin/jobs`: queues, states, job detail, errors grouped by root cause, retry/cancel, live refresh; admin only |
| [auth-core](samples/auth-core/) | mailer, dev-mailbox | ready | Users, database sessions with rotation and revocation, the account security page, re-auth, email change, security emails, audit trail, throttling |
| [auth-password](samples/auth-password/) | auth-core | ready | Email + password: argon2id, verification, reset, rate limits, no user enumeration |
| [auth-magic-link](samples/auth-magic-link/) | auth-core | ready | Passwordless sign-in with single-use, hashed, short-lived tokens or codes |
| [auth-totp](samples/auth-totp/) | auth-core | ready | TOTP two-factor with recovery codes, trusted devices and replay protection |
| [realtime](samples/realtime/) | — (accounts with auth-core) | ready | Channels over WebSocket with topic authorization, presence and SSE/long-poll fallbacks; development guests alone, auth-core accounts when installed |

Screenshots of every screen, light and dark, desktop and mobile, are in [`docs/screenshots/`](docs/screenshots/).

## Using a sample

From an agent, through the samples MCP server on rustoffrails.org: `list_samples`, then `get_sample <name>` (the files, the wiring and the procedure), or `diff_sample <name>` to compare an app's copy with the current release.

By hand: each sample's `README.md` has the exact install procedure, and its `PROMPT.md` is a ready-to-paste prompt for your agent. In short:

1. Add the crates in `sample.toml` with `cargo add` (never with a version).
2. Copy `files/` into the app at the same paths.
3. Apply the wiring: each `[[wire]]` in `sample.toml` names a file, the spot (a `samples: <anchor>` comment in apps generated since 0.7.0, described in words in the README) and the exact code.
4. `cargo fmt --all`, then the Definition of Done.

Or mechanically, from a checkout of this repo:

```sh
tools/install.sh dev-mailbox path/to/app     # installs mailer first; refuses to overwrite a file (--force does)
```

## Repository

```
host/                 the blank app (generators/new.md, htmx) every sample installs into and is tested in
samples/<name>/       sample.toml, README.md, CHECKS.md, PROMPT.md, files/  (format: samples/FORMAT.md)
tools/install.sh      install a sample (and its dependencies) into an app
tools/install-test.sh regression checks for install.sh: dependency resolution, optional wiring (fixtures, no cargo)
tools/ci.sh           prove samples: fresh host copy, install, fmt, clippy, tests on SQLite and Postgres, offrails-check, cargo deny, cargo audit
tools/security-check.sh   every SECURITY marker and CHECKS.md row cites a test that exists
tools/demo.sh         a running demo with every sample and seed data (demo/, git-ignored)
tools/screenshots.sh  regenerate docs/screenshots/ from the demo with Playwright
tools/vendor-framework.sh   fetch the framework release (checksum-verified) into host/.offrails
```

Prove everything (needs a Postgres the suite may create databases in):

```sh
tools/vendor-framework.sh host
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres tools/ci.sh   # each sample alone, then all together
tools/security-check.sh
tools/demo.sh && open http://localhost:3900/dev/mailbox                              # tools/demo.sh stop
```

`host/` in development listens on 127.0.0.1 only and answers only local `Host` names (DNS rebinding can't reach `/dev`); `APP_BIND=0.0.0.0` opens it to a container's network and `APP_ALLOWED_HOSTS` adds a tunnel or LAN name. An unset `APP_ENV` means development and says so loudly at boot.

CI (`.github/workflows/ci.yml`) runs the same, plus gitleaks over the whole history and an OWASP ZAP baseline against the demo with every sample installed.

## Versions

Samples are released with the framework: `version` in each `sample.toml` is the samples release it belongs to, and the repository is tagged per release (`v0.7.0`). `FRAMEWORK_VERSION` is the framework release `host/` is generated from and every sample is proven against.

## License

MIT or Apache-2.0, like the framework.
