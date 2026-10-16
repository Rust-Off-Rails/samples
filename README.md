# Rust off Rails samples

Tested reference code for the parts every [Rust off Rails](https://rustoffrails.org) app needs: a mailer, a dev mailbox, a job queue, accounts, realtime. An agent copies a sample into its app and adapts it; from then on the app owns that code. Nothing here is a dependency, and nothing is mandatory: the framework's guides describe each part, and a sample is the version that was built, tested on SQLite and Postgres, and reviewed for security.

Every sample follows the framework's conventions exactly (stack, layout, naming, the Definition of Done), so copied code looks like code the agent would have written. Comments mark what to change (`// APP:`), what to keep and why (`// WHY:`, `// INVARIANT:`, `// SECURITY:`), and the guide section it implements (`// GUIDE:`), so even a small model adapts a sample safely ([format](samples/FORMAT.md#comments-that-guide-the-next-model)).

## Samples

| Sample | Depends on | Status | What |
|--------|-----------|--------|------|
| [mailer](samples/mailer/) | — | ready | Templated HTML + text email; SMTP, dev mailbox storage, log and memory adapters; previews; a test-email task; header-injection checks |
| [dev-mailbox](samples/dev-mailbox/) | mailer | ready | `/dev/mailbox`: live inbox, sandboxed HTML viewer with width and dark previews, codes and links with copy, attachments, checks, search, keyboard, JSON and a CLI. Development only |
| jobs | — | planned | A database-backed job queue: `SKIP LOCKED` on Postgres, retries with backoff, unique and scheduled jobs, cron |
| jobs-dashboard | jobs | planned | `/admin/jobs`: queues, states, job detail, retry/cancel, live refresh; admin only |
| auth-password | mailer | planned | Email + password: argon2id, verification, reset, rate limits, no user enumeration |
| auth-magic-link | mailer | planned | Passwordless sign-in with single-use, hashed, short-lived tokens |
| auth-totp | an auth sample | planned | TOTP two-factor with recovery codes and replay protection |
| realtime | an auth sample | planned | Channels over WebSocket with topic authorization, presence and SSE fallback |

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
tools/install-test.sh regression checks for install.sh's dependency resolution (fixtures, no cargo)
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

CI (`.github/workflows/ci.yml`) runs the same, plus gitleaks over the whole history and an OWASP ZAP baseline against the demo with every sample installed.

## Versions

Samples are released with the framework: `version` in each `sample.toml` is the samples release it belongs to, and the repository is tagged per release (`v0.7.0`). `FRAMEWORK_VERSION` is the framework release `host/` is generated from and every sample is proven against.

## License

MIT or Apache-2.0, like the framework.
