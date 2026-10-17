# Prompt: install the dev-mailbox sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **dev-mailbox** sample from the Rust off Rails samples (the `samples/dev-mailbox/` folder of github.com/Rust-Off-Rails/samples) into this app. It needs the **mailer** sample; install that first if `src/kernel/mailer.rs` doesn't exist.

1. Read `samples/dev-mailbox/README.md` and `CHECKS.md` first.
2. If this repo has `tools/install.sh`, run `tools/install.sh dev-mailbox .`; otherwise follow the README's "Install" steps by hand: copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes.
3. If the app already has a dev mailbox (`src/kernel/mailbox.rs` with a router, `templates/kernel/mailbox/`), replace it: keep the app's mailers and previews, move any mailbox styles out of `assets/app.css`, and delete the old router and templates.
4. Change only lines marked `// APP:` unless the README's "Adapting it" says otherwise. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Every app link into `/dev/mailbox` carries `hx-boost="false"`.
5. Prove it, and paste the output:

```sh
cargo fmt --all && cargo run -q -- routes
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo nextest run dev_mailbox_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -q -- mailbox seed --app-url http://localhost:3000
# with the app running (bin/dev):
curl -s http://localhost:3000/dev/mailbox/latest.json | jq '.subject, .codes, .links'
PATHS="/dev/mailbox /dev/mailbox/previews" BASE=http://localhost:3000 bash .offrails/tools/browser-smoke/run.sh a11y
```

Then open `/dev/mailbox` in a browser, press `?`, and check light and dark. Report what you installed, what you replaced, and the results.
