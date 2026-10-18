# Prompt: install auth-core

You rarely install this one directly: [auth-password](../auth-password/PROMPT.md) and [auth-magic-link](../auth-magic-link/PROMPT.md) bring it. Use this prompt when you want the accounts layer first and a sign-in method later.

---

Install the **auth-core** sample from the Rust off Rails samples (the `samples/auth-core/` folder of github.com/rust-off-rails/samples) into this app.

1. Read `samples/auth-core/README.md` and `CHECKS.md` first. It needs the `dev-mailbox` sample (and so `mailer`); install those first if `docs/decisions.md` doesn't list them.
2. If this repo has `tools/install.sh`, run `tools/install.sh auth-core .`; otherwise follow the README's "Install" steps by hand: `cargo add hmac` (no version), copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment.
3. Change only lines marked `// APP:` (and `{# APP: … #}`), plus `paths::after_sign_in()`. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it, and keep the `samples:` anchors in the files this sample ships: the method samples plug in there.
4. Add `APP_SECRET_KEY` (≥ 32 characters, `openssl rand -base64 48`) to the deploy configuration, never to the repo. Schedule `app task auth_cleanup` daily. Log the install in `docs/decisions.md`.
5. Install a sign-in method next (auth-password and/or auth-magic-link); auth-core alone has no sign-in form.
6. Prove it, and paste the output:

```sh
cargo fmt --all
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo clippy -q --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used
cargo nextest run auth_core_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -- db rollback --steps 4 && cargo run -- db migrate
cargo run -- task auth_demo        # development: prints fake demo credentials
```

Report what you installed, what you adapted (and which `// APP:` lines), and the results.
