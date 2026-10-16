# Prompt: install auth-totp

Paste this to the agent working in your Rust off Rails app:

---

Install the **auth-totp** sample (two-factor authentication) from the Rust off Rails samples (`get_sample auth-totp` on the samples MCP server, or the `samples/auth-totp/` folder) into this app. The app must already have **auth-core** and a sign-in method (**auth-password** and/or **auth-magic-link**); install those first if `docs/decisions.md` doesn't list them.

1. Read `samples/auth-totp/README.md` and `CHECKS.md` first.
2. If this repo has `tools/install.sh`, run `tools/install.sh auth-totp .`. Otherwise follow the README's "Install" steps by hand: the three `cargo add` lines (no versions), copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment (several are in auth-core's files: `before sign in`, `step-up second factor`, `revoke everything`, `revoke other access`, the account page and "Confirm it's you").
3. Change only lines marked `// APP:` (and `{# APP: … #}`). Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Don't change the RFC 6238 parameters.
4. Add `APP_TOTP_ENCRYPTION_KEY` (`openssl rand -base64 32`) to the deploy configuration, never to the repo, and tell the human to back it up. Log the install in `docs/decisions.md`.
5. Prove it, and paste the output:

```sh
cargo fmt --all
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo clippy -q --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used
cargo nextest run auth_totp_test rfc6238
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -- db rollback --steps 1 && cargo run -- db migrate
cargo run -- task auth_demo    # development: demo-2fa@example.com, fake key AAAA…
```

Then run the app (`bin/dev`): turn two-factor on from `/account` with an authenticator app, save the recovery codes, sign out, sign in (the code step), sign in once with a recovery code, and check every screen in light and dark mode.

Report what you installed, what you adapted (and which `// APP:` lines), and the results.
