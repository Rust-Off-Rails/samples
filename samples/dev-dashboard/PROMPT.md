# Prompt: install the dev-dashboard sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **dev-dashboard** sample from the Rust off Rails samples (`get_sample dev-dashboard` on the samples MCP server, or the `samples/dev-dashboard/` folder) into this app. It depends on no other sample.

1. Read `samples/dev-dashboard/README.md` and `CHECKS.md` first.
2. If this repo has `tools/install.sh`, run `tools/install.sh dev-dashboard .`; otherwise follow the README's "Install" steps by hand: `cargo add` the four crates (never with a version), copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes. If the app has no `tracing layers`, `outer layers`, `hidden tabs` or `dev csp` anchor, apply that wiring by hand where the README says.
3. Change only lines marked `// APP:` unless the README's "Adapting it" says otherwise: point `lab::seed` at this app's models, register panels for this app's subsystems, add insight rules. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Every app link into `/dev/dashboard` carries `hx-boost="false"`.
4. Add `GITHUB_REPO=owner/name` to `.env` (and a read-only `GITHUB_TOKEN` if the repo is private); never commit the token.
5. Prove it, and paste the output:

```sh
cargo fmt --all && cargo run -q -- db migrate && cargo run -q -- routes
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo nextest run dev_dashboard_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo nextest run --release the_middleware_overhead_is_small --no-capture
# with the app running (bin/dev):
cargo run -q -- dashboard warmup --url http://localhost:3000
curl -s http://localhost:3000/dev/dashboard.json | jq '.latest, .routes[0], .n_plus_one'
cargo run -q -- bench --rps 50 --secs 10 --route /
PATHS="/dev/dashboard /dev/dashboard/charts /dev/dashboard/insights /dev/dashboard/routes" BASE=http://localhost:3000 bash .offrails/tools/browser-smoke/run.sh a11y
```

Then open `/dev/dashboard/lab`, press **N+1**, follow the link to the trace, and check light and dark. Report what you installed, what you adapted, the overhead the release test printed, and the results.
