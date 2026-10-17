//! What the "Ask AI" assistant may tell a provider about each dashboard page: one builder per tab,
//! each a plain-text summary built from data the dashboard already holds **in redacted form**.
//!
//! The rules every builder follows (and a new one must):
//! - SQL is the recorded fingerprint (literals stripped), parameters as type and length only;
//! - paths are the recorded ones (`kernel::redact::path` already applied), routes are patterns;
//! - free text (log lines, failure output, error messages) goes through `kernel::redact::text`;
//! - schema is names, types, keys and counts, never a row;
//! - never env values, config, cookies, headers, tokens, the GitHub data, or the load lab's rows;
//! - the read-only production view (`ro`) gets less: no parameters, no log events, no span fields.
//!
//! Each builder is bounded (top N rows); `ai::cap` cuts the whole at `MAX_CONTEXT_CHARS`.

use std::fmt::Write as _;
use std::path::Path;

use super::ai::Tab;
use super::web::{micros, route_findings, route_problems};
use super::{HUB, insights, lock, migrations, route_explorer as rx, schema, sql, testruns};
use crate::kernel::redact;
use crate::state::AppState;

/// Free text, redacted and shortened.
fn clean(s: &str, max: usize) -> String {
    crate::kernel::ui::truncate(&redact::text(s), max)
}

/// The context for `tab` (and one item of it). `Err` when the item is gone.
pub async fn build(
    state: &AppState,
    ro: bool,
    tab: Tab,
    item: Option<&str>,
) -> Result<String, String> {
    match (tab, item) {
        (Tab::Overview, _) => Ok(overview()),
        (Tab::Insights, None) => Ok(insights_all(state).await),
        (Tab::Insights, Some(key)) => finding(state, key).await,
        (Tab::Requests, _) => Ok(requests()),
        (Tab::Traces, None) => Ok(traces()),
        (Tab::Traces, Some(id)) => trace(id, ro),
        (Tab::Sql, None) => Ok(sql_all(ro)),
        (Tab::Sql, Some(id)) => sql_one(state, id, ro).await,
        (Tab::Logs, _) => Ok(logs()),
        (Tab::Schema, None) => Ok(schema_all(state).await),
        (Tab::Schema, Some(t)) => schema_one(state, t).await,
        (Tab::Migrations, _) => Ok(migrations_ctx(state).await),
        (Tab::Routes, _) => Ok(routes(state).await),
        (Tab::Tests, _) => Ok(tests()),
    }
}

/// APP: the overview: the latest second's numbers, the busiest and slowest routes and queries.
fn overview() -> String {
    let mut s = String::from("## Latest numbers (one-second sample)\n");
    if let Some(l) = lock(&HUB.series).latest() {
        let _ = writeln!(
            s,
            "requests/s {:.1}, 4xx/s {:.1}, 5xx/s {:.1}, latency p50 {} p95 {} p99 {}, SQL/s {:.1}, \
             memory {} MB, CPU {:.0}%, pool {} of {} (idle {}), tokio tasks {}",
            l.req,
            l.e4,
            l.e5,
            micros(u64::from(l.p50)),
            micros(u64::from(l.p95)),
            micros(u64::from(l.p99)),
            l.sql,
            l.rss / 1_048_576,
            l.cpu,
            l.pool_size,
            l.pool_max,
            l.pool_idle,
            l.tasks
        );
    } else {
        s.push_str("(no sample yet)\n");
    }
    s.push_str("\n## Slowest routes (p95)\n");
    let mut rows = lock(&HUB.http).rows();
    rows.sort_by_key(|r| std::cmp::Reverse(r.p95));
    for r in rows.iter().take(8) {
        let _ = writeln!(
            s,
            "- {} {}: {} requests, p95 {}, 5xx {}, 4xx {}",
            r.method,
            r.route,
            r.count,
            micros(r.p95),
            r.s5,
            r.s4
        );
    }
    s.push_str("\n## Most expensive SQL (total time)\n");
    let stats = lock(&HUB.sql);
    for q in stats.rows(sql::Sort::Total).iter().take(8) {
        let _ = writeln!(
            s,
            "- {}× total {} p95 {}: {}",
            q.count,
            micros(q.total),
            micros(q.p95),
            clean(&q.sql, 300)
        );
    }
    let _ = writeln!(s, "\nN+1 patterns flagged: {}", stats.n_plus_one().len());
    s
}

/// APP: every finding, as the Insights page ranks them.
async fn insights_all(state: &AppState) -> String {
    let mut all = insights::findings(state).await;
    all.extend(route_findings(state).await);
    all.sort_by(|a, b| b.severity.cmp(&a.severity).then(b.score.cmp(&a.score)));
    let mut s = String::from("## Findings, most important first\n");
    for f in all.iter().take(30) {
        let _ = writeln!(
            s,
            "- [{}] {} ({}). Evidence: {}. Suggested fix: {}. Guide: {}",
            f.severity.key(),
            clean(&f.title, 200),
            f.kind,
            clean(&f.evidence, 400),
            clean(&f.fix, 300),
            f.guide
        );
    }
    if all.is_empty() {
        s.push_str("(no findings)\n");
    }
    s
}

/// APP: one finding, with the data behind it when it points at a query or a trace.
async fn finding(state: &AppState, key: &str) -> Result<String, String> {
    let mut all = insights::findings(state).await;
    all.extend(route_findings(state).await);
    let f = all
        .into_iter()
        .find(|f| super::web::finding_id(&f.key) == key)
        .ok_or("That finding is gone (fixed, or the data aged out).")?;
    let mut s = format!(
        "## Finding\n[{}] {} ({})\nEvidence: {}\nSuggested fix: {}\nGuide: {}\n",
        f.severity.key(),
        clean(&f.title, 200),
        f.kind,
        clean(&f.evidence, 800),
        clean(&f.fix, 400),
        f.guide
    );
    if let Some(id) = f.href.strip_prefix("/dev/dashboard/sql/")
        && let Ok(q) = sql_one(state, id, false).await
    {
        s.push('\n');
        s.push_str(&q);
    }
    Ok(s)
}

/// APP: requests per route.
fn requests() -> String {
    let mut s = String::from("## Requests per route\n");
    let mut rows = lock(&HUB.http).rows();
    rows.sort_by_key(|r| std::cmp::Reverse(r.count));
    for r in rows.iter().take(40) {
        let _ = writeln!(
            s,
            "- {} {}: {} hits (2xx {}, 3xx {}, 4xx {}, 5xx {}), p50 {} p95 {} p99 {} max {}, {} bytes total, N+1 in {}",
            r.method,
            r.route,
            r.count,
            r.s2,
            r.s3,
            r.s4,
            r.s5,
            micros(r.p50),
            micros(r.p95),
            micros(r.p99),
            micros(r.max),
            r.bytes,
            r.n_plus_one
        );
    }
    s
}

/// APP: the recent traces, notable ones first.
fn traces() -> String {
    let mut s = String::from("## Recent requests (notable first: 5xx, N+1, slow)\n");
    let traces = lock(&HUB.traces);
    let mut list = traces.list(true);
    list.extend(traces.list(false).into_iter().take(20));
    list.dedup_by_key(|t| t.id);
    for t in list.iter().take(40) {
        let _ = writeln!(
            s,
            "- trace {}: {} {} ({}) → {} in {}, {} SQL statements ({}){}",
            t.id,
            t.method,
            t.route,
            clean(&t.path, 120),
            t.status,
            micros(t.dur_us),
            t.statements,
            micros(t.sql_us),
            if t.n_plus_one.is_empty() {
                ""
            } else {
                ", N+1 flagged"
            }
        );
    }
    s
}

/// APP: one trace: its spans, its SQL in order, and (development only) its log events.
fn trace(id: &str, ro: bool) -> Result<String, String> {
    let t = id
        .parse::<u64>()
        .ok()
        .and_then(|id| {
            lock(&HUB.traces)
                .find(id)
                .or_else(|| lock(&HUB.http).example(id))
        })
        .ok_or("That trace is no longer kept.")?;
    let mut s = format!(
        "## Trace {}\n{} {} (path {}) → {} in {}; {} SQL statements taking {}\n\n### Spans (start, duration)\n",
        t.id,
        t.method,
        t.route,
        clean(&t.path, 160),
        t.status,
        micros(t.dur_us),
        t.statements,
        micros(t.sql_us)
    );
    for sp in t.spans.iter().take(60) {
        let _ = writeln!(
            s,
            "- {} ({}) at +{} for {}",
            sp.name,
            sp.target,
            micros(sp.start_us),
            micros(sp.dur_us)
        );
    }
    s.push_str("\n### SQL, in order (fingerprints: literals stripped)\n");
    for q in t.sql.iter().take(80) {
        let _ = writeln!(
            s,
            "- +{} {}: {}",
            micros(q.start_us),
            micros(q.dur_us),
            clean(&q.sql, 300)
        );
    }
    for (_, n, q) in &t.n_plus_one {
        let _ = writeln!(s, "\nN+1: ran {n} times in this request: {}", clean(q, 300));
    }
    if !ro && !t.events.is_empty() {
        s.push_str("\n### Log events (redacted)\n");
        for e in t.events.iter().take(40) {
            let _ = writeln!(
                s,
                "- +{} {}: {}",
                micros(e.at_us),
                e.level,
                clean(&e.message, 300)
            );
        }
    }
    Ok(s)
}

/// APP: every statement by fingerprint, the N+1 list, writes during a GET.
fn sql_all(ro: bool) -> String {
    let stats = lock(&HUB.sql);
    let mut s = String::from("## SQL by fingerprint (total time first)\n");
    for q in stats.rows(sql::Sort::Total).iter().take(30) {
        let _ = writeln!(
            s,
            "- id {}: {}× total {} mean {} p95 {} max {}, failed {}, routes {}{}: {}",
            q.id,
            q.count,
            micros(q.total),
            micros(q.mean),
            micros(q.p95),
            micros(q.max),
            q.failed,
            q.routes.join(" "),
            if ro || q.params.is_empty() {
                String::new()
            } else {
                format!(", parameters {}", q.params.join(", "))
            },
            clean(&q.sql, 400)
        );
    }
    s.push_str("\n## N+1 (the same statement more than 5 times in one request)\n");
    for n in stats.n_plus_one().iter().take(20) {
        let _ = writeln!(
            s,
            "- {} ran it {}× in one request ({} requests did): {}",
            n.route,
            n.count,
            n.times,
            clean(&n.sql, 300)
        );
    }
    drop(stats);
    let writes = lock(&HUB.http).get_writes().len();
    let _ = writeln!(s, "\nWrites during a GET: {writes}");
    s
}

/// APP: one statement: its numbers, the routes that run it, and (development) its plan, with
/// literals stripped from the plan (a Postgres plan can quote a bound value).
async fn sql_one(state: &AppState, id: &str, ro: bool) -> Result<String, String> {
    let fp = sql::parse_hex(id).ok_or("No such query.")?;
    let q = lock(&HUB.sql)
        .get(fp)
        .ok_or("That query is no longer kept.")?;
    let mut s = format!(
        "## Query {}\n{}\n\n{}× total {} mean {} p95 {} max {}, failed {}\nRoutes: {}\n",
        q.id,
        clean(&q.sql, 2_000),
        q.count,
        micros(q.total),
        micros(q.mean),
        micros(q.p95),
        micros(q.max),
        q.failed,
        q.routes.join(", ")
    );
    if !ro && !q.params.is_empty() {
        let _ = writeln!(
            s,
            "Parameters (type and length only): {}",
            q.params.join(", ")
        );
    }
    if let Some(n) = lock(&HUB.sql).n_plus_one().iter().find(|n| n.fp == fp) {
        let _ = writeln!(
            s,
            "Flagged N+1: {} ran it {}× in one request.",
            n.route, n.count
        );
    }
    if !ro
        && q.select
        && let Ok(plan) = sql::explain(&state.db, fp).await
    {
        s.push_str("\n### Query plan\n");
        for line in plan.iter().take(40) {
            let _ = writeln!(s, "{}", sql::fingerprint(line));
        }
    }
    Ok(s)
}

/// APP: the live log tail's latest lines, redacted.
fn logs() -> String {
    let mut s = String::from("## Latest log lines (newest last, redacted)\n");
    let lines = lock(&HUB.logs).lines();
    let start = lines.len().saturating_sub(60);
    for l in &lines[start..] {
        let _ = writeln!(
            s,
            "- {} {} {}: {}{}",
            l.at.format("%H:%M:%S"),
            l.level,
            l.target,
            clean(&l.message, 300),
            if l.fields.is_empty() {
                String::new()
            } else {
                format!(" [{}]", clean(&l.fields, 200))
            }
        );
    }
    s
}

fn table_text(t: &schema::Table, s: &mut String) {
    let _ = writeln!(
        s,
        "### {} ({} rows)",
        t.name,
        t.rows.map_or_else(|| "?".into(), |n| n.to_string())
    );
    for c in &t.columns {
        let _ = writeln!(
            s,
            "- {} {}{}{}",
            c.name,
            c.ty,
            if c.nullable { " null" } else { " not null" },
            if c.pk { " primary key" } else { "" }
        );
    }
    for i in &t.indexes {
        let _ = writeln!(
            s,
            "- index {} ({}){}",
            i.name,
            i.columns.join(", "),
            if i.unique { " unique" } else { "" }
        );
    }
    for fk in &t.fks {
        let _ = writeln!(
            s,
            "- foreign key ({}) → {}({}) on delete {}",
            fk.columns.join(", "),
            fk.table,
            fk.to.join(", "),
            fk.on_delete
        );
    }
}

/// APP: the schema: names, types, keys, indexes, foreign keys and row counts. Never a row.
async fn schema_all(state: &AppState) -> String {
    let tables = schema::tables(&state.db).await.unwrap_or_default();
    let mut s = format!("## Schema ({}, {} tables)\n", backend(state), tables.len());
    for t in &tables {
        table_text(t, &mut s);
    }
    s
}

/// APP: one table, the queries that touch it, the migration that made it.
async fn schema_one(state: &AppState, name: &str) -> Result<String, String> {
    let tables = schema::tables(&state.db).await.unwrap_or_default();
    let t = tables
        .iter()
        .find(|t| t.name == name)
        .ok_or("No such table.")?;
    let mut s = format!("## Table ({})\n", backend(state));
    table_text(t, &mut s);
    let referencing: Vec<String> = tables
        .iter()
        .filter(|o| o.fks.iter().any(|fk| fk.table == name))
        .map(|o| o.name.clone())
        .collect();
    if !referencing.is_empty() {
        let _ = writeln!(s, "Referenced by: {}", referencing.join(", "));
    }
    s.push_str("\n### Recent queries touching it\n");
    for q in super::web::queries_touching(name, 10) {
        let _ = writeln!(s, "- {}× p95 {}: {}", q.count, q.p95, clean(&q.sql, 300));
    }
    let report = migrations::report(&state.db, &tables, Path::new(".")).await;
    for m in &report.migrations {
        for e in &m.effects {
            if matches!(e, migrations::Effect::CreateTable { table, .. } | migrations::Effect::AlterTable { table, .. } if table == name)
            {
                let _ = writeln!(s, "Migration {}: {}", m.name, e.text());
            }
        }
    }
    Ok(s)
}

/// APP: the migrations timeline and the drift.
async fn migrations_ctx(state: &AppState) -> String {
    let tables = schema::tables(&state.db).await.unwrap_or_default();
    let report = migrations::report(&state.db, &tables, Path::new(".")).await;
    let mut s = format!("## Migrations ({}), oldest first\n", backend(state));
    for m in &report.migrations {
        let _ = writeln!(
            s,
            "- {} [{}] {}{}: {}",
            m.name,
            m.area,
            if m.applied() { "applied" } else { "PENDING" },
            if m.edited {
                ", edited after it was applied"
            } else {
                ""
            },
            m.effects
                .iter()
                .map(migrations::Effect::text)
                .collect::<Vec<_>>()
                .join("; ")
        );
    }
    s.push_str("\n## Drift between the migrations and the database\n");
    for d in &report.drift {
        let _ = writeln!(s, "- {}: {}", d.title, d.detail);
    }
    if report.drift.is_empty() {
        s.push_str("(none)\n");
    }
    for (n, _) in &report.unknown_applied {
        let _ = writeln!(s, "- applied but unknown to this code: {n}");
    }
    s
}

/// APP: the route table with live numbers and the detectors' problems.
async fn routes(state: &AppState) -> String {
    let p = route_problems(state).await;
    let stats = lock(&HUB.http).rows();
    let mut s = String::from("## Routes (method, pattern, handler, access, hits, p95)\n");
    for r in rx::table() {
        let st = stats
            .iter()
            .find(|x| x.route == r.path && x.method == r.method);
        let _ = writeln!(
            s,
            "- {} {} → {} [{}] {}",
            r.method,
            r.path,
            r.handler,
            rx::access_label(r.access),
            st.map_or_else(
                || "never hit".to_owned(),
                |x| format!("{} hits, p95 {}, 5xx {}", x.count, micros(x.p95), x.s5)
            )
        );
    }
    let list = |s: &mut String, label: &str, v: &[String]| {
        if !v.is_empty() {
            let _ = writeln!(s, "\n{label}: {}", v.join(", "));
        }
    };
    list(&mut s, "Mutating routes without CSRF", &p.without_csrf);
    list(&mut s, "Admin or dev paths without a gate", &p.ungated);
    list(
        &mut s,
        "Open to anyone in production",
        &p.open_in_production,
    );
    list(&mut s, "Missing from docs/routes.md", &p.missing_docs);
    list(&mut s, "No test mentions them", &p.untested);
    for (a, b) in &p.overlaps {
        let _ = writeln!(s, "Overlapping patterns: {a} and {b}");
    }
    s
}

/// APP: the latest test run: per database, failures with (redacted) output, the slowest tests.
fn tests() -> String {
    let dir = testruns::root().join(testruns::DIR);
    let runs = testruns::load_runs(&dir);
    let Some(run) = runs.first() else {
        return "No test runs yet (`app test`, or the Run tests button).\n".into();
    };
    let mut s = format!("## Latest test run ({}, {})\n", run.id, run.source);
    for suite in &run.suites {
        let _ = writeln!(
            s,
            "- {:?}: {} passed, {} failed, {} skipped, {} flaky, {} ms",
            suite.db, suite.passed, suite.failed, suite.skipped, suite.flaky, suite.duration_ms
        );
    }
    for db in [testruns::Db::Sqlite, testruns::Db::Postgres] {
        let mut cases = testruns::load_cases(&dir, &run.id, db);
        let failed: Vec<&testruns::Case> = cases
            .iter()
            .filter(|c| matches!(c.outcome, testruns::Outcome::Failed))
            .collect();
        if !failed.is_empty() {
            let _ = writeln!(s, "\n### Failures on {db:?}");
            for c in failed.iter().take(10) {
                let _ = writeln!(
                    s,
                    "- {} ({} ms):\n{}",
                    c.name,
                    c.time_ms,
                    clean(&c.output, 1_200)
                );
            }
        }
        cases.sort_by_key(|c| std::cmp::Reverse(c.time_ms));
        if !cases.is_empty() {
            let _ = writeln!(s, "\n### Slowest on {db:?}");
            for c in cases.iter().take(8) {
                let _ = writeln!(s, "- {} {} ms", c.name, c.time_ms);
            }
        }
    }
    s
}

fn backend(state: &AppState) -> &'static str {
    match state.db.get_database_backend() {
        sea_orm::DbBackend::Postgres => "Postgres",
        _ => "SQLite",
    }
}
