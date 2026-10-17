// A loopback stand-in for an OpenAI-compatible provider, for the dev dashboard's "Ask AI"
// screenshots (tools/screenshots.sh starts it, then a demo server pointed at it). It answers every
// chat completion with a canned, clearly fake answer; it never calls a real API.
//
//   node tools/screenshots/ai-mock.mjs <port>
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3939);

const ANSWERS = {
  sql: `## What's happening

\`/dev/lab/orders/n-plus-one\` loads the orders, then runs **one query per order** for its items: the same \`SELECT … FROM "lab_order_items" WHERE "order_id" = ?\` ran 20 times in one request.

## The fix

Load the items for every order in one query with SeaORM's loader, then group them in memory:

\`\`\`rust
let orders = lab_order::Entity::find().all(db).await?;
let items = orders.load_many(lab_order_item::Entity, db).await?;
\`\`\`

1. Two queries instead of 21, whatever the page size.
2. Keep the index on \`lab_order_items.order_id\` (it's there: \`lab_order_items_order_id_idx\`).

See \`.offrails/guides/models.md\` for eager loading, and add a query-count test (\`assert_query_count_stable\`) so it can't come back.`,
  default: `## In short

The app is healthy: p95 is under 50 ms on every route except **\`/dev/lab/slow\`**, which sleeps on purpose.

- The busiest query is the orders list: fast, and indexed.
- One N+1 is flagged on \`/dev/lab/orders/n-plus-one\` (the load lab's example).

Start with the N+1; \`.offrails/guides/models.md\` shows the fix.`,
};

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let page = "default";
    try {
      const user = JSON.parse(body).messages.find((m) => m.role === "user")?.content ?? "";
      if (user.includes('page="sql"')) page = "sql";
    } catch {
      /* answer the default */
    }
    // A short pause, so the spinner shows.
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: ANSWERS[page] }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1840, completion_tokens: 212 },
      }));
    }, 600);
  });
}).listen(port, "127.0.0.1", () => console.log(`ai-mock on http://127.0.0.1:${port}/v1`));
