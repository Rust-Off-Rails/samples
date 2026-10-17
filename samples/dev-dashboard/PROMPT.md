# Prompt: install the dev-dashboard sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **dev-dashboard** sample from the Rust off Rails samples (the `samples/dev-dashboard/` folder of github.com/Rust-Off-Rails/samples) into this app. It depends on no other sample.

1. Read `samples/dev-dashboard/README.md` and `CHECKS.md` first.
2. If this repo has `tools/install.sh`, run `tools/install.sh dev-dashboard .`; otherwise follow the README's "Install" steps by hand: `cargo add` the seven crates (never with a version; `pprof` only for `cfg(unix)`), copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes. If the app has no `tracing layers`, `outer layers`, `hidden tabs`, `dev csp`, `kernel head` or `kernel main` anchor, apply that wiring by hand where the README says.
3. Change only lines marked `// APP:` unless the README's "Adapting it" says otherwise: point `lab::seed` at this app's models, register panels for this app's subsystems, add insight rules. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Every app link into `/dev/dashboard` carries `hx-boost="false"`.
4. Instrument this app's key methods so they show in the waterfalls and Methods: `#[tracing::instrument(level = "debug", skip_all)]` on controller actions' helpers, model/query functions and services (README "Instrumenting your own methods"); never put a secret or personal data in a span field. Keep `RUST_LOG` at development's default (or `info,<crate>=debug`) so debug spans show. The history file lands in `storage/dashboard/` (git-ignored); leave `DASHBOARD_HISTORY` on.
5. Add `GITHUB_REPO=owner/name` to `.env` (and a read-only `GITHUB_TOKEN` if the repo is private); never commit the token.
6. Schema diagram: put this app's table prefixes in `AREAS` (`// APP:` in `src/kernel/dashboard/erd.rs`) so the diagram colours tables by area, then open `/dev/dashboard/schema` and `/dev/dashboard/schema/migrations`: the drift panel should say "None"; if it lists something, explain each line before changing anything.
7. Ask AI (an agent with read-only tools) is optional. Leave it off unless I give you a provider. If I do, add `DASHBOARD_AI_PROVIDER`, `DASHBOARD_AI_MODEL` and (if needed) `DASHBOARD_AI_BASE_URL` to `.env` (for OpenRouter: `openai-compatible`, `https://openrouter.ai/api/v1`, and a model id from `curl -s https://openrouter.ai/api/v1/models` whose `supported_parameters` include `tools`, e.g. `deepseek/deepseek-v4.1-flash`), and tell me to put `DASHBOARD_AI_API_KEY` there myself: never ask me to paste the key to you, never commit it, never put it in a test. Keep every context builder in `ai_context.rs` and every tool in `ai_tools.rs` to redacted data and read-only: a new tool gets a schema, a description, and a case in `every_tool_answers_within_its_cap`; anything that changes state is a `propose_action` kind rendered as a button, never a tool. Don't widen `read_source`'s allowlist. Don't enable `DASHBOARD_AI_IN_PRODUCTION` or `DASHBOARD_AI_PROACTIVE` unless I ask. Budgets are env too (`DASHBOARD_AI_DAILY_TOKENS`, `DASHBOARD_AI_DAILY_QUESTIONS`, `DASHBOARD_AI_RUN_MAX_TOKENS`, `DASHBOARD_AI_MAX_ANSWER_TOKENS`, and a dollar cap with `DASHBOARD_AI_PRICE_IN`, `DASHBOARD_AI_PRICE_OUT`, `DASHBOARD_AI_DAILY_USD`); keep the defaults unless I give you numbers. Then open the overview: the AI command center at the top must be expanded, with a briefing, four small charts and "What you can do here" even without a key. Open `/dev/dashboard/explain` (no key needed) and, with a key, press **Generate AI briefing** in the command center and watch the steps arrive.
8. Outbound calls: find every place this app calls another HTTP API (`reqwest::`, an SDK) and move it onto `kernel::outbound` (README "Calling other APIs"): one `Outbound::new("<service>", &config.<x>_url)` per API with a timeout near its SLO, `.bearer(...)` for its key (never in the URL), `.idempotent().retries(n)` only for calls that are safe to send twice, and `tokio::join!` for calls that don't depend on each other. Put each API's SLO in `SLOS` (`upstreams.rs`). Then open `/dev/dashboard/upstreams`: every API should be there, with the routes that call it.
9. Security and the frontend: put this app's sign-in paths in `SIGN_IN_ROUTES` if it doesn't use auth-core (with auth-core the optional wire feeds the detectors); keep every threshold's default unless I give you numbers. Give the app's important buttons a stable `id` or `data-rum="…"` (never personal data in either) so the Frontend tab names them. Don't turn on `DASHBOARD_RUM` in production unless I ask; if I do, add `DASHBOARD_RUM_SAMPLE` and a line in `docs/decisions.md`. In the load lab run **Checkout fan-out**, the **attack simulator**'s "All of them", and open the UX trouble page with "simulate": the Upstreams, Security and Frontend tabs and Insights should all have findings.
10. Prove it, and paste the output:

```sh
cargo fmt --all && cargo run -q -- db migrate && cargo run -q -- routes
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo nextest run dev_dashboard_test
cargo nextest run dev_dashboard_signals_test
cargo nextest run read_source_stays_inside_the_allowlist a_prompt_injection_in_app_data_has_no_side_effect_and_leaks_nothing an_agent_run_stops_at_its_budget_and_says_so
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo nextest run --release the_middleware_overhead_is_small method_spans_are_cheap --no-capture
# with the app running (bin/dev):
cargo run -q -- dashboard warmup --url http://localhost:3000
curl -s http://localhost:3000/dev/dashboard.json | jq '.latest, .routes[0], .n_plus_one'
cargo run -q -- bench --rps 50 --secs 10 --route /
curl -s http://localhost:3000/dev/dashboard/schema/erd.mmd | head -20
curl -s "http://localhost:3000/dev/lab/checkout?mode=sequential" > /dev/null && curl -s http://localhost:3000/dev/dashboard/upstreams | grep -c up-map
PATHS="/dev/dashboard /dev/dashboard/charts /dev/dashboard/traces /dev/dashboard/methods /dev/dashboard/insights /dev/dashboard/routes /dev/dashboard/schema /dev/dashboard/schema/migrations /dev/dashboard/upstreams /dev/dashboard/security /dev/dashboard/frontend" BASE=http://localhost:3000 bash .offrails/tools/browser-smoke/run.sh a11y
```

Then open `/dev/dashboard/lab`, press **N+1**, follow the link to the trace, unfold `load_items ×20`, click a statement (the side panel), and check light and dark. Open `/dev/dashboard/traces`, filter to the N+1 route, open a row inline, tick two rows and Compare. Open `/dev/dashboard/methods` and `/dev/dashboard/profile` (Hot functions, Linux/macOS). Restart the app and check `/dev/dashboard/charts?range=24h` still shows the last hour. On `/dev/dashboard/schema`, click a table in the diagram (its neighbours light up), drag one, reload (it stays), press Reset layout, and copy the Mermaid text. Report what you installed, what you adapted (which methods you instrumented, which API calls you moved onto `kernel::outbound`), the overhead the release tests printed, and the results.
