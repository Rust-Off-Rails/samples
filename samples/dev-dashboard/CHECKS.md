# dev-dashboard: checks

What "working and safe" means for the dev dashboard, and the test that proves each item. `tools/security-check.sh` fails when a test named here doesn't exist; `tools/ci.sh dev-dashboard` runs them all on SQLite and Postgres.

The dashboard sees everything the app does: SQL with its parameters, log lines, request paths, the schema, the environment, a GitHub token. Treat each of those as something that must not leave this machine, and the dashboard's actions (traffic, EXPLAIN, running tests) as things an attacker would love to trigger.

## Threat model

| STRIDE | Threat | Control | Test |
|--------|--------|---------|------|
| Spoofing | A cross-site page makes the browser start traffic, run tests, EXPLAIN, seed data or dismiss findings (CSRF) | Every action is a POST through the app's `CsrfLayer`; GETs change nothing | `cross_site_posts_to_every_unsafe_route_are_403`, `the_origin_header_decides_without_fetch_metadata` |
| Spoofing | Someone guesses the production view's password | 16+ characters (refused at boot otherwise); failed tries rate limited per client (the real guard); the compare is of SHA-256 digests with a branch-free fold, best-effort constant time (no early exit, no length leak; the compiler is not forbidden from optimizing it) | `the_production_dashboard_needs_the_admin_password`, `failed_dashboard_passwords_are_rate_limited`, `dashboard_secrets_compare_exactly` |
| Denial of service | Behind a proxy without `APP_TRUSTED_PROXY`, every client shares the proxy's address and one failed-password budget: anyone can lock the admins out for 3 minutes at a time | Known trade-off of keying failures by client address; the misconfiguration is logged once per process when `X-Forwarded-For` arrives untrusted; set `APP_TRUSTED_PROXY=true` behind a proxy | `an_untrusted_forwarded_for_header_warns_once` |
| Tampering | The traffic generator is pointed at another host (SSRF) or at a stream that never ends | It takes paths, never URLs: GET routes from `ROUTES` only, no dashboard, no streams; the host is always the app's own loopback address; caps of 200 req/s, 60 s, 32 in flight | `traffic_only_targets_this_app` |
| Tampering | EXPLAIN runs a write, or runs statements of the attacker's choosing | Only fingerprints the app itself ran, only single SELECTs, never `ANALYZE` (the plan is computed, nothing runs), development only | `explain_runs_for_selects_only`, `only_single_selects_are_explainable` |
| Tampering | The CSRF detector itself changes data | It probes each mutating route with a method that route doesn't have: the CSRF layer answers 403 before routing, and without it the router answers 405; no handler runs | `a_mutating_route_without_csrf_is_spotted` |
| Tampering | A run id or a table name from the URL reaches the filesystem or SQL | Run ids are `[0-9a-z-]` only; catalog SQL interpolates only `[A-Za-z0-9_]` names read from the catalog itself | `run_ids_never_leave_the_runs_folder`, `only_plain_identifiers_reach_catalog_sql` |
| Tampering | Markup in a path, a log line, a SQL statement or API data is rendered as HTML, or a `javascript:` link from the GitHub API | Askama escapes every value (live fragments are rendered by the same templates); only `https://` links from the API become hrefs | `github_links_are_https_only`, `not_found_paths_keep_the_nearest_route_and_a_safe_referrer` |
| Repudiation | n/a: a development tool on the developer's machine; the production view is read-only, so there is nothing to attribute | — | — |
| Information disclosure | The dashboard (SQL, logs, traces, env) is reachable in production | Dev routes are merged only in development (production and test: the router's 404, and nothing is recorded); the read-only view only with `DASHBOARD_IN_PRODUCTION=true` and an admin gate, and without parameters, EXPLAIN, logs, schema, lab, tests or GitHub | `the_dashboard_is_404_in_production_by_default`, `the_production_dashboard_needs_the_admin_password`, `dev_routes_are_404_outside_development` |
| Information disclosure | SQL parameters (emails, tokens, password digests) show on a page | Parameters are kept as type and length ("text (15 chars)"); development keeps the last SELECT's values for EXPLAIN only, never rendered | `sql_parameter_values_never_reach_any_page`, `sql_parameters_are_never_shown` |
| Information disclosure | Secrets logged as fields reach the live tail | Fields named like passwords, tokens, cookies, keys or sessions show as `[redacted]` | `secrets_logged_as_fields_never_reach_the_tail`, `secrets_in_log_fields_are_redacted` |
| Information disclosure | The Config page shows secrets, credentials or the machine's identity | Only the app's own variables (`APP_`, `DATABASE_`, …; not `HOME`, `USER`, `PATH`); values only for an allowlist of never-secret names (`ENV_VALUES_SHOWN`), every other one "set (redacted)" or "not set" (so `SMTP_PASS`, `GITHUB_PAT`, `APP_PEPPER` never show); credentials and query removed from URLs; host name redacted | `config_redacts_secrets_and_credentials` |
| Information disclosure | The production view's trace page shows what the app logged (emails, ids, amounts in events and span fields) | Read-only mode renders spans, timings and normalized SQL only; events and span fields are development-only | `the_production_trace_page_hides_events_and_fields` |
| Information disclosure | The GitHub token leaks | Sent only in the `Authorization` header (marked sensitive); never on a page, in `Debug`, or in the log; network calls only when the page is opened, cached 60 s | `the_github_token_is_never_shown_or_logged` |
| Information disclosure | A token in a URL (an emailed sign-in link's path, a query string in a referrer or a CSP report) is stored and shown | Recorded paths go through the host's `kernel::redact::path` (token routes and long random segments become `[redacted]`); referrers are cut to a path (this app) or a host (another site); report URLs lose their query string and fragment | `not_found_paths_keep_the_nearest_route_and_a_safe_referrer`, `csp_reports_are_collected_without_query_strings` |
| Information disclosure | The schema browser shows customer data; the routes explorer shows the checkout's absolute path | The browser reads the catalog and counts only, never rows; handler sources are app-relative | `the_schema_browser_never_shows_row_data`, `route_sources_are_app_relative` |
| Information disclosure | Dashboard data stays in a shared or back/forward cache | Every response of both routers is `Cache-Control: no-store` | `every_dashboard_response_is_no_store` |
| Denial of service | Traffic (or a scanner) grows the dashboard's memory without bound | Every ring and map is fixed-size: routes keyed by `ROUTES` pattern with one `(unmatched)` bucket, 500 fingerprints, 300 + 100 traces with per-trace caps, 1,000 log lines, 100 404 paths, 100 CSP reports | `the_dashboard_stays_within_its_memory_bound` |
| Denial of service | The middleware slows every request | A few µs in release (measured); one atomic check when off; the dashboard's own pages aren't recorded | `the_middleware_overhead_is_small` |
| Denial of service | The load lab or the test runner takes the machine down | Hard caps (rate, duration, in flight; skipped requests are counted, never queued); one run at a time; the memory spike frees itself; one test run at a time | `traffic_only_targets_this_app`, `the_memory_spike_is_freed`, `the_run_tests_button_runs_in_the_background_with_progress` |
| Denial of service | GitHub's rate limit is burned by page views | Answers cached for 60 s; a used-up limit stops calls until its reset; 4 s timeout | `github_rate_limits_and_timeouts_are_respected` |
| Elevation of privilege | A signed-in non-admin opens the production view | `admin_from_session` returns `Some(false)` and the view answers 404, even with the Basic password; with auth-core installed, `accounts.rs` asks auth-core's session (`is_admin` is the `// APP:` hook, nobody until the app adds a role) | `a_signed_in_non_admin_gets_404_from_the_production_view` |

## Invariants

| Invariant | Test |
|-----------|------|
| Every page renders with its own stylesheet and script, never `app.css`, and follows the theme switch (`light-dark()` tokens, no `prefers-color-scheme` blocks) | `every_dashboard_page_renders_with_its_own_assets`, `the_dashboard_stylesheet_follows_the_theme_switch`, `every_kernel_page_renders_data_theme` |
| The dashboard replaces the System and Routes tabs; their pages stay | `the_dashboard_replaces_the_system_and_routes_tabs` |
| Requests are grouped by route pattern with status classes, percentiles and bytes; the dashboard doesn't record itself | `requests_are_recorded_per_route_with_percentiles`, `requests_are_grouped_by_their_route_pattern`, `the_dashboard_ignores_itself` |
| SQL is grouped by fingerprint; an N+1 is flagged with its route and trace | `sql_is_grouped_by_fingerprint`, `fingerprints_strip_literals_and_collapse_lists`, `an_n_plus_one_is_flagged_with_its_route_and_trace` |
| A trace's waterfall shows its spans, its SQL under the right span, and its events | `the_trace_waterfall_shows_spans_sql_and_events` |
| The live tail streams and filters | `the_log_tail_streams_lines_and_filters` |
| The collector feeds the charts, each with a data table as its text alternative; legends summarize the window and read "—" without data | `the_collector_feeds_the_charts_and_cards`, `a_chart_has_a_text_alternative_and_stays_in_its_box` |
| Charts zoom into a range, mark events, carry the heatmap and the "demo data" badge over synthetic history; a minute drills into its traces | `charts_zoom_annotate_and_drill_into_traces`, `the_latency_heatmap_shades_each_moment`, `the_demo_history_fills_every_range_and_is_marked` |
| Live pages update over Server-Sent Events | `the_live_stream_sends_fragments` |
| Percentiles are within 10% | `quantiles_are_within_ten_percent` |
| The load lab drives real requests and scenarios light up their panel; `app bench` drives a running server | `the_load_lab_runs_traffic_and_scenarios`, `bench_drives_a_running_server` |
| Insights rank findings with evidence, a fix and a guide; dismissing lasts the session | `insights_rank_findings_and_can_be_dismissed`, `an_unindexed_foreign_key_is_found`, `plans_reveal_full_scans` |
| Each route detector finds its planted bug | `a_mutating_route_without_csrf_is_spotted`, `ungated_admin_and_dev_paths_are_spotted`, `a_get_that_writes_is_spotted`, `not_found_paths_keep_the_nearest_route_and_a_safe_referrer`, `overlaps_untested_and_undocumented_routes_are_spotted`, `typos_find_their_route` |
| The explorer groups routes with live numbers and problems | `the_routes_explorer_groups_routes_with_stats_and_problems` |
| Test runs are imported from JUnit, with flaky tests, coverage and spec coverage | `test_runs_are_imported_with_flaky_tests_and_coverage`, `nextest_progress_lines_parse` |
| The GitHub page explains itself without a repo, and renders from a recorded fixture | `the_github_page_explains_itself_without_a_repo`, `the_github_page_renders_ci_and_repo_status_from_a_fixture` |
| Agents get the numbers as JSON | `agents_get_the_numbers_as_json` |

## In a browser (not part of the test suite)

- axe-core (WCAG 2.2 AA) on every page, with the OS light and dark and with the switch forcing each: 0 violations (`AXE=1 tools/screenshots.sh dev-dashboard`).
- No console errors and no CSP violations on any page (the screenshot script fails on either; a violation would also show on Insights).
- Keyboard: every action is a link, button or form; charts have data tables; live regions announce run progress politely and nothing else.

## Commands

```sh
TEST_DATABASE_URL=postgres://… tools/ci.sh dev-dashboard   # on both databases
tools/security-check.sh
cargo nextest run --release the_middleware_overhead_is_small --no-capture   # the release overhead
```
