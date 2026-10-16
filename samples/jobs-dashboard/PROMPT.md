# Prompt: install the jobs-dashboard sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **jobs-dashboard** sample from the Rust off Rails samples (`get_sample jobs-dashboard` on the samples MCP server, or the `samples/jobs-dashboard/` folder) into this app. It needs the **jobs** sample; install that first if `src/kernel/jobs/mod.rs` doesn't exist.

1. Read `samples/jobs-dashboard/README.md` and `CHECKS.md` first, and `.offrails/guides/jobs-dashboard.md`.
2. If this repo has `tools/install.sh`, run `tools/install.sh jobs-dashboard .`; otherwise follow the README's "Install" steps by hand: copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes.
3. If the app already has a dashboard (`src/kernel/jobs/web.rs`, `templates/kernel/jobs/`), replace it: delete the old router, templates and any dashboard styles in `assets/app.css` or `static/kernel/admin.css`, and keep the old routes' paths if other pages link to them.
4. **The gate.** If the app has accounts with an admin role, wire `admin_from_session` in `src/controllers/admin_access.rs` to the app's current-user extractor and set `HAS_ACCOUNTS = true` (README, "Adapting it"), and add a test that a signed-in member gets 404 and an admin 200. Otherwise tell me to set `APP_ADMIN_PASSWORD` (16+ characters) in production. Record the choice in `docs/decisions.md`.
5. Change only lines marked `// APP:` / `/* APP: */` unless "Adapting it" says otherwise. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Every app link into `/admin/jobs` carries `hx-boost="false"`.
6. Prove it, and paste the output:

```sh
cargo fmt --all && cargo run -q -- routes
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo clippy --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used
cargo nextest run jobs_dashboard_test jobs_test security_test kernel_web_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo run -q -- task jobs_demo
# with the app running (bin/dev):
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/jobs            # 200 in development
PATHS="/admin/jobs /admin/jobs/list /admin/jobs/errors /admin/jobs/cron" BASE=http://localhost:3000 bash .offrails/tools/browser-smoke/run.sh a11y
```

Then open `/admin/jobs` in a browser, press `?`, try light and dark and a phone-sized window. Report what you installed, which gate you chose, and the results.
