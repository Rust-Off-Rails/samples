# Prompt: install auth-magic-link

Paste this to the agent working in your Rust off Rails app:

---

Install the **auth-magic-link** sample from the Rust off Rails samples (the `samples/auth-magic-link/` folder of github.com/rust-off-rails/samples) into this app. It brings **auth-core** (sessions, account page, re-auth, security emails), and needs **dev-mailbox** and **mailer**.

1. Read `samples/auth-magic-link/README.md` and `CHECKS.md`, and `samples/auth-core/README.md` and `CHECKS.md`, first.
2. If this repo has `tools/install.sh`, run `tools/install.sh auth-magic-link .` (it installs auth-core first). Otherwise follow both READMEs' "Install" steps by hand, auth-core first: copy each `files/` keeping paths (replace `offrails_host` with this crate's name), the `cargo add` lines (no versions), then each wiring step at its `samples: <anchor>` comment.
3. Change only lines marked `// APP:` (and `{# APP: … #}`), and `paths::after_sign_in()`. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Keep the browser binding on unless a human decides otherwise (and log that decision).
4. Set `ACCOUNTS: magic-link` in `AGENTS.md` (`magic-link invite` when only invited people get accounts: then set `DEFAULT_SIGNUP = Signup::Invite` in `src/config.rs` and keep every route and test; README "Adapting it"). Add `APP_SECRET_KEY` (≥ 32 characters) and `SMTP_URL` to the deploy configuration, never to the repo. Schedule `app task auth_cleanup` daily. Log the install in `docs/decisions.md`.
5. Put `RequireUser` on every private handler, and `RequireRecentAuth` on anything that changes the email or money.
6. Prove it, and paste the output:

```sh
cargo fmt --all
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo clippy -q --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used
cargo nextest run auth_
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -- db rollback --steps 5 && cargo run -- db migrate
```

Then run the app (`bin/dev`), ask for a link for `ada@example.com`, read it with `curl -s $URL/dev/mailbox/latest.json?to=ada@example.com`, sign in once with the link and once with the code, and check `/account` in light and dark mode.

Report what you installed, what you adapted (and which `// APP:` lines), and the results.
