# Prompt: install the mailer sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **mailer** sample from the Rust off Rails samples (`get_sample mailer` on the samples MCP server, or the `samples/mailer/` folder) into this app.

1. Read `samples/mailer/README.md` and `CHECKS.md` first.
2. If this repo has `tools/install.sh`, run `tools/install.sh mailer .`; otherwise follow the README's "Install" steps by hand: the `cargo add` line (no version), copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes.
3. Change only lines marked `// APP:` (and `{# APP: … #}`) unless the README's "Adapting it" says otherwise. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it.
4. Update `AGENTS.md`'s `EMAIL:` line and add `SMTP_URL` / `MAIL_FROM` to the deploy configuration (not to the repo). Log the install in `docs/decisions.md` (one dated line).
5. Prove it, and paste the output:

```sh
cargo fmt --all
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo nextest run mailer_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -- db rollback --steps 1 && cargo run -- db migrate
cargo run -- task send_test_email ada@example.com    # development: lands in the mailbox table
```

Report what you installed, what you adapted (and which `// APP:` lines), and the results.
