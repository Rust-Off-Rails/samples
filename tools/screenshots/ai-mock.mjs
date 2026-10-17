// A loopback stand-in for an OpenAI-compatible provider (tool calling included), for the dev
// dashboard's "Ask AI" screenshots: tools/screenshots.sh starts it, then a demo server pointed at
// it. It never calls a real API: it plays a scripted, clearly fake investigation, reading the
// ids it cites (SQL fingerprints, traces, findings, source lines) out of the tool results the
// dashboard sends back, so every citation links somewhere real in the demo.
//
//   node tools/screenshots/ai-mock.mjs <port>      (STEP_MS=1400: the wait before each reply)
//
// The script per question (by the page data's `page="…"` and the question):
//   - an N+1 / SQL question: query_sql + list_traces (in parallel), search_source, read_source,
//     propose_action (the N+1 scenario), then the answer with a Fix and a Test;
//   - the health summary: get_overview + list_insights, compare_windows, then the verdict;
//   - the watcher's incident: one look, then a short narrative;
//   - anything else (the mailbox, jobs, …): the page's own tool, then a short answer.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3939);
const STEP_MS = Number(process.env.STEP_MS ?? 1400);

const clock = (t) => new Date(t).toISOString().slice(11, 16);
const now = () => Date.now();

// What the dashboard sent back so far: every tool result, joined.
const results = (messages) => messages.filter((m) => m.role === "tool").map((m) => String(m.content ?? "")).join("\n");
const turns = (messages) => messages.filter((m) => m.role === "assistant").length;
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ role: "assistant", content: null, tool_calls: calls });
const text = (content) => ({ role: "assistant", content });
const first = (re, s, fallback = "") => (s.match(re) ?? [])[1] ?? fallback;
const N1 = /ran sql ([0-9a-f]+) (\d+)× in one request \((\d+) requests did; worst trace (\d+)\)/;
const SOURCE_HIT = /- (src\/[^\s:]+\.rs):(\d+):/;

function nPlusOne(messages) {
  const seen = results(messages);
  switch (turns(messages)) {
    case 0:
      return tools(call("call_sql", "query_sql", { sort: "total", limit: 8 }), call("call_traces", "list_traces", { filter: "n_plus_one", limit: 5 }));
    case 1:
      return tools(call("call_find", "search_source", { query: "async fn orders_n_plus_one(" }));
    case 2: {
      const hit = seen.match(SOURCE_HIT);
      const [path, line] = hit ? [hit[1], Number(hit[2])] : ["src/kernel/dashboard/lab.rs", 1];
      return tools(call("call_read", "read_source", { path, start_line: Math.max(1, line - 2), end_line: line + 24 }));
    }
    case 3:
      return tools(call("call_act", "propose_action", { kind: "run_scenario", target: "n-plus-one", reason: "Reproduce the loop, then compare the SQL count after the fix." }));
    default: {
      const n1 = seen.match(N1);
      const sqlId = n1?.[1] ?? first(/- sql ([0-9a-f]+):/, seen, "1");
      const count = n1?.[2] ?? "20";
      const trace = n1?.[4] ?? first(/trace (\d+):/, seen, "1");
      const hit = seen.match(SOURCE_HIT);
      const file = hit ? `${hit[1]}:${hit[2]}` : "src/kernel/dashboard/lab.rs:1";
      const t = now();
      return text(`## What's happening

\`GET /dev/lab/orders/n-plus-one\` loads a page of orders, then asks for **each order's items in its own query**: [sql:${sqlId}] ran ${count}× in one request [trace:${trace}] on [route:GET /dev/lab/orders/n-plus-one]. The loop is in the handler at [file:${file}]. SQL per second follows the load lab's runs [chart:sql ${clock(t - 15 * 60_000)}-${clock(t - 60_000)}].

## Fix

In [file:${file}], load the items for the whole page in one query, then group them in memory:

\`\`\`rust
let orders = lab_order::Entity::find().limit(20).all(&state.db).await?;
let items = orders.load_many(lab_order_item::Entity, &state.db).await?;
\`\`\`

Two statements instead of ${Number(count) + 1}, whatever the page size. The foreign key is indexed, so the batched lookup stays fast. See \`.offrails/guides/models.md\` (eager loading).

## Test

Add a query-count test with \`TestApp::assert_query_count_stable\` for \`/dev/lab/orders/n-plus-one\`: seed 5 orders, then 50, and assert the count doesn't grow.

(A canned demo answer from tools/screenshots/ai-mock.mjs, not a real model.)`);
    }
  }
}

function health(messages) {
  const seen = results(messages);
  switch (turns(messages)) {
    case 0:
      return tools(call("call_ov", "get_overview", {}), call("call_ins", "list_insights", { limit: 8 }));
    case 1:
      return tools(call("call_cmp", "compare_windows", { minutes: 10 }));
    default: {
      const findings = [...seen.matchAll(/- finding ([0-9a-f]{8}) \[(high|medium|low)\] (.+?) \(/g)].slice(0, 3);
      const slow = first(/- (GET \S+): \d+ requests, p95/, seen, "GET /dev/lab/slow");
      const t = now();
      const list = findings.length
        ? findings.map((f, i) => `${i + 1}. **${f[3].trim()}** (${f[2]}) [finding:${f[1]}]`).join("\n")
        : "1. Nothing ranked high.";
      return text(`**Verdict: Needs attention.** The app serves its traffic well, but a few things cost time on every request.

## Healthy

- Memory and the DB pool are flat across the window, with no growth since boot.
- Server errors stay near zero outside the load lab's error burst [chart:errors ${clock(t - 15 * 60_000)}-${clock(t - 60_000)}].

## Needs attention

${list}

## Fix first

The N+1 on the orders page: it multiplies SQL by the page size, so it gets worse as data grows, and the fix is one \`load_many\`. Then look at [route:${slow}] [chart:latency ${clock(t - 12 * 60_000)}-${clock(t - 60_000)}].

(A canned demo answer from tools/screenshots/ai-mock.mjs, not a real model.)`);
    }
  }
}

function incident(messages) {
  const seen = results(messages);
  const user = String(messages.find((m) => m.role === "user")?.content ?? "");
  const kind = first(/watcher saw this signal: ([^.]+)\./, user);
  const look = /N\+1/.test(kind)
    ? call("call_n1", "query_sql", { sort: "count", limit: 5 })
    : /[Ll]atency|errors/.test(kind)
      ? call("call_cmp", "compare_windows", { minutes: 5 })
      : /tests/.test(kind)
        ? call("call_tests", "test_results", {})
        : /jobs/.test(kind)
          ? call("call_jobs", "job_error_groups", { limit: 5 })
          : call("call_ov", "get_overview", {});
  if (turns(messages) === 0) return tools(look);
  const t = now();
  const n1 = seen.match(N1);
  const story = /N\+1/.test(kind)
    ? `A real N+1, not a one-off: [sql:${n1?.[1] ?? "1"}] runs ${n1?.[2] ?? "20"}× per request [trace:${n1?.[4] ?? "1"}]. Batch the items with \`load_many\` (\`.offrails/guides/models.md\`). Medium: fine in development, slow with real data.`
    : /[Ll]atency|errors/.test(kind)
      ? `The spike lines up with the load lab's slow-endpoint run [chart:latency ${clock(t - 10 * 60_000)}-${clock(t)}]: [route:GET /dev/lab/slow] waits on a slow upstream on purpose. Nothing else moved, so no action unless real routes show it.`
      : /tests/.test(kind)
        ? "One test fails on one database only: a portability bug, not a flaky test. Open Tests, read its output, and run it on both databases."
        : /jobs/.test(kind)
          ? `The failures share one cause${first(/e\.g\. job (\d+)/, seen) ? ` (e.g. [job:${first(/e\.g\. job (\d+)/, seen)}])` : ""}; retries won't fix it. Fix the cause, then retry from the jobs dashboard.`
          : "Worth a look; nothing urgent.";
  return text(`${story}

(A canned demo narrative from tools/screenshots/ai-mock.mjs.)`);
}

function page(messages, key) {
  const tool = { mailbox: "mailbox_summary", jobs: "jobs_summary", sockets: "app_snapshot", dev: "app_snapshot" }[key] ?? "get_overview";
  const seen = results(messages);
  if (turns(messages) === 0) return tools(call("call_page", tool, {}));
  const mail = first(/- mail (\d+):/, seen);
  const job = first(/e\.g\. job (\d+)/, seen);
  const extra = mail
    ? ` The latest is [mail:${mail}]: it has a text part and its links are https.`
    : job
      ? ` The failures cluster on one cause, e.g. [job:${job}]: retrying won't help until the cause is fixed.`
      : "";
  return text(`## In short

This page looks healthy.${extra}

- Nothing here needs a code change right now.
- The dashboard's Insights rank what to fix first.

(A canned demo answer from tools/screenshots/ai-mock.mjs, not a real model.)`);
}

function reply(body) {
  const messages = body.messages ?? [];
  const user = String(messages.find((m) => m.role === "user")?.content ?? "");
  const key = first(/<dashboard-data page="(\w+)">/, user, "overview");
  const question = user.split("Question:").pop();
  let message;
  if (user.includes("watcher saw this signal")) message = incident(messages);
  else if (question.includes("Write a health summary")) message = health(messages);
  else if (key === "sql" || /N\+1/.test(question)) message = nPlusOne(messages);
  else message = page(messages, key);
  if (body.tool_choice === "none" && message.tool_calls) message = text("I ran out of steps; here is what I have so far.");
  return {
    choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 1800 + 900 * turns(messages), completion_tokens: message.tool_calls ? 60 : 420 },
  };
}

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4_000_000) req.destroy();
  });
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let out;
    try {
      out = reply(JSON.parse(body));
    } catch {
      out = { choices: [{ message: text("The demo mock couldn't read that request."), finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    }
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    }, STEP_MS);
  });
}).listen(port, "127.0.0.1", () => console.log(`ai-mock on http://127.0.0.1:${port}/v1`));
