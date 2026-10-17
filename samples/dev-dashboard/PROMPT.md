# Prompt: install the dev-dashboard sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **dev-dashboard** sample from the Rust off Rails samples (`get_sample dev-dashboard` on the samples MCP server, or the `samples/dev-dashboard/` folder) into this app. It depends on no other sample.

1. Read `samples/dev-dashboard/README.md` and `CHECKS.md` first.
2. If this repo has `tools/install.sh`, run `tools/install.sh dev-dashboard .`; otherwise follow the README's "Install" steps by hand: `cargo add` the four crates (never with a version), copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes. If the app has no `tracing layers`, `outer layers`, `hidden tabs` or `dev csp` anchor, apply that wiring by hand where the README says.
3. Change only lines marked `// APP:` unless the README's "Adapting it" says otherwise: point `lab::seed` at this app's models, register panels for this app's subsystems, add insight rules. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Every app link into `/dev/dashboard` carries `hx-boost="false"`.
4. Add `GITHUB_REPO=owner/name` to `.env` (and a read-only `GITHUB_TOKEN` if the repo is private); never commit the token.
5. Schema diagram: put this app's table prefixes in `AREAS` (`// APP:` in `src/kernel/dashboard/erd.rs`) so the diagram colours tables by area, then open `/dev/dashboard/schema` and `/dev/dashboard/schema/migrations`: the drift panel should say "None"; if it lists something, explain each line before changing anything.
6. Ask AI is optional. Leave it off unless I give you a provider. If I do, add `DASHBOARD_AI_PROVIDER`, `DASHBOARD_AI_MODEL` and (if needed) `DASHBOARD_AI_BASE_URL` to `.env`, and tell me to put `DASHBOARD_AI_API_KEY` there myself: never ask me to paste the key to you, never commit it, never put it in a test. Keep every context builder in `ai_context.rs` to redacted data; if you add a source, extend `ai_contexts_carry_no_rows_parameters_or_secrets`. Don't enable `DASHBOARD_AI_IN_PRODUCTION` unless I ask.
7. Prove it, and paste the output:

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
curl -s http://localhost:3000/dev/dashboard/schema/erd.mmd | head -20
PATHS="/dev/dashboard /dev/dashboard/charts /dev/dashboard/insights /dev/dashboard/routes /dev/dashboard/schema /dev/dashboard/schema/migrations" BASE=http://localhost:3000 bash .offrails/tools/browser-smoke/run.sh a11y
```

Then open `/dev/dashboard/lab`, press **N+1**, follow the link to the trace, and check light and dark. On `/dev/dashboard/schema`, click a table in the diagram (its neighbours light up), drag one, reload (it stays), press Reset layout, and copy the Mermaid text. Report what you installed, what you adapted, the overhead the release test printed, and the results.
