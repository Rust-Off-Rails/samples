# Prompt: install the jobs sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **jobs** sample from the Rust off Rails samples (`get_sample jobs` on the samples MCP server, or the `samples/jobs/` folder) into this app. It has no dependencies.

1. Read `samples/jobs/README.md` and `CHECKS.md` first, and `.offrails/guides/jobs.md`.
2. If this repo has `tools/install.sh`, run `tools/install.sh jobs .`; otherwise follow the README's "Install" steps by hand: `cargo add croner`, copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes.
3. If the app already has a queue in `src/kernel/jobs/` (older apps do), stop and tell me before replacing it: list its workers, then move each into the sample's `Worker` trait, keep every `NAME` string unchanged, and write a migration from its tables to the sample's instead of editing a shipped one.
4. Change only lines marked `// APP:` unless the README's "Adapting it" says otherwise: register this app's workers in `dispatch`, `worker_config` and `WORKERS`, set the queues in `APP_QUEUES`, add cron entries to `SCHEDULE`. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Args hold ids, never records or secrets. Delete `src/jobs/examples.rs` (and its arms, `SCHEDULE` entries and the `webhooks` queue) once the app has its own workers.
5. Record the queues and any changed default in `docs/decisions.md`, and add `APP_QUEUES` and `APP_JOBS_SHUTDOWN_GRACE` to the deploy config, with `app worker` as a process (or `APP_INLINE_WORKER=true` on one server).
6. Prove it, and paste the output:

```sh
cargo fmt --all && cargo run -q -- db migrate && cargo run -q -- routes
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo clippy --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used
cargo nextest run jobs_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -q -- db rollback --steps 1 && cargo run -q -- db migrate
cargo run -q -- jobs stats
cargo run -q -- jobs cron
cargo run -q -- jobs list --state discarded --json
```

Report what you installed, which workers you registered, the queues you configured, and the results.
