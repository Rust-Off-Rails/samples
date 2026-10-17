// Screenshots + axe for the dev dashboard. BASE, OUT, AXE=1. Run through tools/screenshots.sh,
// which starts the demo (fake orders, synthetic test runs, a recorded GitHub repo, a warmup burst).
// Live pages hold a Server-Sent Events stream open, so pages are shot after "load", not
// "networkidle" (which never comes).
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3900";
// A second demo server whose "Ask AI" talks to tools/screenshots/ai-mock.mjs (screenshots.sh
// starts both); without it the screens that need an answer are skipped.
const AI_BASE = process.env.AI_BASE ?? "";
const OUT = process.env.OUT ?? "out";
const AXE = process.env.AXE === "1";
const only = process.argv.slice(2);
const axeSource = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

// Ask AI's runs: one owner cookie for every AI context (so a run started in one shot can be
// reopened in the next), and at most 5 runs a minute (the dashboard allows 6, PER_MINUTE).
const OWNER = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
let lastRun = "/dev/dashboard/ai/history";
// The AI server's watcher may start up to four investigations of its own in its first minute.
const runsAt = [Date.now(), Date.now(), Date.now(), Date.now()];
const throttle = async () => {
  const minute = () => runsAt.filter((t) => Date.now() - t < 61_000);
  while (minute().length >= 5) await new Promise((r) => setTimeout(r, 2_000));
  runsAt.push(Date.now());
};
// Clicks Investigate (or Generate health summary) in `scope` and waits for the run to start; the
// AI server's watcher spends from the same per-minute budget, so a "a minute" refusal waits and
// retries.
const startRun = async (page, scope) => {
  for (let i = 0; i < 6; i++) {
    await throttle();
    await page.locator(`${scope} [data-ai-send]`).click();
    await page.locator(`${scope} .ai-run`).first().waitFor({ timeout: 30_000 });
    const refused = await page.locator(`${scope} .ai-run [role=alert]`).count();
    if (!refused) return;
    const text = await page.locator(`${scope} .ai-run [role=alert]`).first().textContent();
    if (!/a minute/.test(text ?? "")) throw new Error(`run refused: ${text}`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
  throw new Error("the run never started");
};

// The AI server is a second process with its own numbers: give it traffic too (and an N+1, so its
// watcher posts an incident).
let aiTrafficUntil = 0;
const ensureAiTraffic = async () => {
  if (!AI_BASE || Date.now() < aiTrafficUntil) return;
  const body = new URLSearchParams({ paths: "/dev/lab/orders\n/dev/lab/orders/n-plus-one\n/dev/lab/slow\n/", rps: "8", secs: "60" });
  await fetch(`${AI_BASE}/dev/dashboard/lab/traffic`, { method: "POST", body, redirect: "manual" });
  aiTrafficUntil = Date.now() + 61_000;
  await new Promise((r) => setTimeout(r, 3000));
};

// The first link matching `selector` on `path`.
const firstHref = async (page, path, selector) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  const href = await page.locator(selector).first().getAttribute("href");
  if (!href) throw new Error(`no ${selector} on ${path}`);
  return href;
};

// Keeps a gentle traffic run going (the lab's own generator, at most 60 s each), so the live
// numbers move in every shot and the lab screens catch a run mid-way.
let runUntil = 0;
const ensureTraffic = async () => {
  if (Date.now() < runUntil) return;
  const body = new URLSearchParams({ paths: "/dev/lab/orders\n/\n/dev/lab/orders\n/dev/lab/slow\n/dev/lab/orders/n-plus-one\n/up", rps: "12", secs: "60" });
  await fetch(`${BASE}/dev/dashboard/lab/traffic`, { method: "POST", body, redirect: "manual" });
  runUntil = Date.now() + 61_000;
  await new Promise((r) => setTimeout(r, 4000));
};

// Hot functions sample on demand: start it now, so the profile screens have 15 minutes to fill.
await fetch(`${BASE}/dev/dashboard/profile/toggle`, { method: "POST", body: new URLSearchParams({ paused: "0" }), redirect: "manual" });

// The signals (Upstreams, Security, Frontend): slow and flaky simulated APIs and a dozen
// checkouts, the attack simulator's every run, and the UX trouble page playing itself in a real
// browser (its deliberate errors happen in that context, which is not shot).
const post = (path, form) => fetch(`${BASE}${path}`, { method: "POST", body: new URLSearchParams(form), redirect: "manual" });
const prepareSignals = async () => {
  await post("/dev/dashboard/lab/upstreams", { preset: "reset" });
  await post("/dev/dashboard/lab/upstreams", { preset: "slow-payments" });
  await post("/dev/dashboard/lab/upstreams", { preset: "flaky-shipping" });
  for (let i = 0; i < 4; i++) for (const mode of ["sequential", "parallel"]) await fetch(`${BASE}/dev/lab/checkout?mode=${mode}`);
  await post("/dev/dashboard/lab/upstreams", { preset: "timeouts" });
  for (let i = 0; i < 3; i++) await fetch(`${BASE}/dev/lab/checkout?mode=retry`);
  await post("/dev/dashboard/lab/attack", { kind: "all" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dev/lab/ux?simulate=1`, { waitUntil: "load" });
  await page.waitForURL(/\/dev\/lab\/ux\/widget/, { timeout: 30_000 });
  await page.waitForTimeout(9_000);
  await page.goto(`${BASE}/dev/lab/ux`, { waitUntil: "load" });
  await page.waitForTimeout(1_000);
  await ctx.close();
  // The attack simulator sends 50 requests a second.
  await new Promise((r) => setTimeout(r, 6_000));
};
// The trace of a fresh checkout (its page links to its waterfall).
const checkoutTrace = async (p, mode) => {
  await p.goto(`${BASE}/dev/lab/checkout?mode=${mode}`, { waitUntil: "load" });
  const href = await p.locator("a[href^='/dev/dashboard/traces/']").first().getAttribute("href");
  if (!href) throw new Error("no checkout trace");
  return href;
};

const screens = [
  // The overview opens with the AI command center (expanded): without a key here, with the mock
  // in "overview-ai" (the AI server's proactive mode writes the briefing on its first visit).
  ["overview", async () => "/dev/dashboard"],
  ["overview-ai", async () => "/dev/dashboard", async (page) => {
    await page.locator("#health .ai-run, #health [data-ai-send]").first().waitFor();
    if (!(await page.locator("#health .ai-run").count())) await startRun(page, "#health");
    await page.locator("#health .ai-end .ai-text").waitFor({ timeout: 90_000 });
    await page.goto(page.url(), { waitUntil: "load" });
  }, { base: AI_BASE }],
  ["charts", async () => "/dev/dashboard/charts?range=1h"],
  ["charts-readout", async () => "/dev/dashboard/charts?range=1h", async (page) => {
    const box = await page.locator("#chart-latency .plot").boundingBox();
    if (box) await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.5);
  }],
  ["insights", async () => "/dev/dashboard/insights"],
  ["requests", async () => "/dev/dashboard/requests?sort=p95"],
  ["routes", async () => "/dev/dashboard/routes?area=dev&q=lab"],
  // The traces explorer: collapsed; a row open inline with the N+1's folded row unfolded; two
  // traces compared; the trace page (the permalink) with a statement in the side panel.
  ["traces", async () => "/dev/dashboard/traces"],
  ["traces-expanded", async () => "/dev/dashboard/traces?route=%2Fdev%2Flab%2Forders%2Fn-plus-one", async (page) => {
    await page.locator(".tx-d > summary").first().click();
    const wf = page.locator(".tx-d[open] [data-waterfall]").first();
    await wf.waitFor({ timeout: 15_000 });
    await wf.locator("tr.grp.flagged .wf-caret").first().evaluate((el) => el.click());
    await page.locator(".tx-d[open]").first().scrollIntoViewIfNeeded();
  }],
  ["traces-compare", async (p) => {
    await p.goto(`${BASE}/dev/dashboard/traces?route=%2Fdev%2Flab%2Forders%2Fn-plus-one`, { waitUntil: "load" });
    const a = await p.locator(".tx-pick").nth(0).getAttribute("value");
    await p.goto(`${BASE}/dev/dashboard/traces?route=%2Fdev%2Flab%2Forders`, { waitUntil: "load" });
    const b = await p.locator(".tx-pick").nth(0).getAttribute("value");
    return `/dev/dashboard/traces/compare?cmp=${b}&cmp=${a}`;
  }],
  ["waterfall", async (p) => firstHref(p, "/dev/dashboard/traces?route=%2Fdev%2Flab%2Forders%2Fn-plus-one", ".tx-body a")],
  ["waterfall-panel", async (p) => firstHref(p, "/dev/dashboard/traces?route=%2Fdev%2Flab%2Forders%2Fn-plus-one", ".tx-body a"), async (page) => {
    await page.locator("[data-wf-reveal]").first().evaluate((el) => el.click());
    // A script click: on a phone the label sits in a narrow, sideways-scrolling column.
    await page.locator("tr.k-sql.flagged:not([hidden]) .wf-label").first().evaluate((el) => el.click());
    await page.locator("[data-wf-panel]:not([hidden])").waitFor();
  }],
  ["methods", async () => "/dev/dashboard/methods?sort=p95"],
  ["icicle", async () => "/dev/dashboard/methods?route=%2Fdev%2Flab%2Forders%2Fn-plus-one", async (page) => {
    await page.locator(".icicle").scrollIntoViewIfNeeded();
  }],
  ["hot-functions", async () => "/dev/dashboard/profile?window=15"],
  ["flame-graph", async () => "/dev/dashboard/profile?window=15", async (page) => {
    await page.locator("#flame-title").scrollIntoViewIfNeeded();
  }],
  ["insight-slow-function", async () => "/dev/dashboard/insights", async (page) => {
    const f = page.locator(".finding", { hasText: "Slow function" }).first();
    if (await f.count()) await f.scrollIntoViewIfNeeded();
  }],
  ["job-trace", async (p) => {
    // A job this demo process ran (so it has a trace): the explorer's job rows say `job_id=…`.
    await p.goto(`${BASE}/dev/dashboard/traces?kind=job`, { waitUntil: "load" });
    const text = await p.locator(".tx-path .mono").first().textContent();
    const id = /job_id=(\d+)/.exec(text ?? "")?.[1];
    if (!id) throw new Error("no job trace in the demo");
    return `/admin/jobs/${id}`;
  }, async (page) => {
    await page.locator("#h-trace").scrollIntoViewIfNeeded();
    await page.locator("[data-inline-wf] > summary").first().click();
    await page.locator("[data-inline-wf] [data-waterfall]").first().waitFor({ timeout: 15_000 });
  }],
  ["sql", async () => "/dev/dashboard/sql?sort=total"],
  ["n-plus-one", async () => "/dev/dashboard/sql", async (page) => { await page.locator("#n-plus-one").scrollIntoViewIfNeeded(); }],
  ["explain", async (p) => firstHref(p, "/dev/dashboard/sql?sort=count", "a[href*='/dev/dashboard/sql/']"), async (page) => {
    await page.locator("form[action$='/explain'] button").click();
    await page.waitForLoadState("load");
  }],
  ["logs", async () => "/dev/dashboard/logs"],
  ["schema", async () => "/dev/dashboard/schema", async (page) => { await page.locator("#table-lab_orders").scrollIntoViewIfNeeded(); }],
  ["erd", async () => "/dev/dashboard/schema", async (page) => { await page.locator("[data-erd]").scrollIntoViewIfNeeded(); }],
  ["erd-focus", async () => "/dev/dashboard/schema", async (page) => {
    await page.locator('.erd-t[data-table="users"]').click();
    await page.locator("[data-erd-detail] [data-table-detail]").waitFor();
    await page.locator("[data-erd-viewport]").scrollIntoViewIfNeeded();
  }],
  ["table", async () => "/dev/dashboard/schema/tables/lab_order_items"],
  ["migrations", async () => "/dev/dashboard/schema/migrations"],
  // A tab's Ask AI panel opens by itself on the first visit of the session.
  ["ai-setup", async () => "/dev/dashboard/sql", async (page) => {
    await page.locator("[data-ai-panel] .ai-setup").waitFor();
  }],
  // Ask AI as an agent, against tools/screenshots/ai-mock.mjs (a scripted, clearly fake
  // investigation): the health summary, a run mid-stream and finished (citations, an inline
  // chart, a proposed action, the fix prompt), the history, an incident card, the bar on the
  // mailbox and jobs pages. "What am I looking at?" needs no key.
  ["ai-explain", async () => "/dev/dashboard/explain"],
  ["ai-incident", async () => "/dev/dashboard/insights", async (page) => {
    await page.locator("#incidents .incident-story").first().waitFor({ timeout: 120_000 });
    await page.locator("#incidents").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-health", async () => "/dev/dashboard", async (page) => {
    await startRun(page, "#health");
    await page.locator("#health .ai-end .ai-text").waitFor({ timeout: 90_000 });
    await page.locator("#health").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-run-live", async () => "/dev/dashboard/sql", async (page) => {
    await page.locator("[data-ai-panel] [data-ai-form]").waitFor();
    await page.locator("[data-ai-panel] [data-ai-prompt]").first().click();
    await startRun(page, "[data-ai-panel]");
    await page.locator(".ai-run .ai-step").nth(2).waitFor({ timeout: 60_000 });
    const href = await page.locator(".ai-run .ai-permalink").getAttribute("href");
    if (href) lastRun = href;
    // The run's element is re-rendered as steps arrive: scroll its stable container.
    await page.locator("[data-ai-panel]").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-run-done", async () => `${lastRun}?wait=1`, async (page) => {
    await page.locator(".ai-end .ai-chart").first().waitFor({ timeout: 60_000 });
    await page.locator(".ai-end").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-history", async () => "/dev/dashboard/ai/history", null, { base: AI_BASE }],
  ["ai-mailbox", async () => "/dev/mailbox", async (page) => {
    await page.locator(".ai-bar > summary").click();
    await page.locator(".ai-bar [data-ai-prompt]").first().click();
    await startRun(page, ".ai-bar");
    await page.locator(".ai-bar .ai-end .ai-text").waitFor({ timeout: 60_000 });
    await page.locator(".ai-bar").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-jobs", async () => "/admin/jobs", async (page) => {
    await page.locator(".ai-bar > summary").click();
    await page.locator(".ai-bar [data-ai-form]").waitFor();
  }, { base: AI_BASE }],
  ["fanout-sequential", async (p) => {
    await post("/dev/dashboard/lab/upstreams", { preset: "reset" });
    await post("/dev/dashboard/lab/upstreams", { preset: "slow-payments" });
    return checkoutTrace(p, "sequential");
  }, async (page) => { await page.locator(".wf-summary").first().evaluate((el) => el.scrollIntoView({ block: "start" })); }],
  ["fanout-parallel", async (p) => {
    await post("/dev/dashboard/lab/upstreams", { preset: "timeouts" });
    return checkoutTrace(p, "retry");
  }, async (page) => { await page.locator(".wf-toolbar").first().evaluate((el) => el.scrollIntoView({ block: "start" })); }],
  ["upstreams", async () => "/dev/dashboard/upstreams", async (page) => { await page.locator(".dash-head").first().evaluate((el) => el.scrollIntoView({ block: "start" })); }],
  ["security", async () => "/dev/dashboard/security", async (page) => { await page.locator(".dash-head").first().evaluate((el) => el.scrollIntoView({ block: "start" })); }],
  ["frontend", async () => "/dev/dashboard/frontend", async (page) => { await page.locator(".dash-head").first().evaluate((el) => el.scrollIntoView({ block: "start" })); }],
  ["insights-signals", async () => "/dev/dashboard/insights", async (page) => {
    const f = page.locator(".finding", { hasText: "Slow upstream" }).first();
    if (await f.count()) await f.scrollIntoViewIfNeeded();
  }],
  ["tests", async () => "/dev/dashboard/tests"],
  ["github", async () => "/dev/dashboard/github"],
  ["config", async () => "/dev/dashboard/config"],
  ["lab-running", async () => "/dev/dashboard/lab"],
  ["forced-dark", async () => "/dev/dashboard", null, { themes: ["light"], cookie: "dark" }],
];

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
let count = 0;
let violations = 0;
let problems = 0;
try {
  mkdirSync(OUT, { recursive: true });
  if (!only.length || only.some((n) => ["fanout-sequential", "fanout-parallel", "upstreams", "security", "frontend", "insights-signals", "insights"].includes(n))) await prepareSignals();
  for (const [screen, resolve, act, opt = {}] of screens) {
    if (only.length && !only.includes(screen)) continue;
    if (opt.base === "") { console.log(`skip ${screen}: no AI_BASE`); continue; }
    const base = opt.base ?? BASE;
    for (const theme of opt.themes ?? ["light", "dark"]) {
      for (const [vp, opts] of Object.entries(viewports)) {
        const context = await browser.newContext({
          viewport: { width: opts.width, height: opts.height },
          deviceScaleFactor: opts.deviceScaleFactor, isMobile: opts.isMobile, hasTouch: opts.hasTouch ?? false,
          colorScheme: theme, reducedMotion: "reduce",
        });
        if (opt.cookie) await context.addCookies([{ name: "offrails_theme", value: opt.cookie, url: base }]);
        if (base === AI_BASE) {
          await context.addCookies([{ name: "dashboard_ai", value: OWNER, url: base }]);
          await ensureAiTraffic();
        }
        const page = await context.newPage();
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(String(e)));
        await ensureTraffic();
        const path = await resolve(page);
        await page.goto(`${base}${path}`, { waitUntil: "load" });
        if (act) await act(page);
        await page.waitForTimeout(1200);
        const name = `${screen}-${theme}-${vp}`;
        await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: process.env.FULL === "1" });
        if (AXE) {
          await page.evaluate(axeSource);
          const result = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }));
          for (const v of result.violations) {
            violations += 1;
            console.log(`AXE ${screen} ${theme} ${vp}: ${v.id} (${v.impact}) ${v.nodes.length}x: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
          }
        }
        if (errors.length) { problems += 1; console.log(`CONSOLE ${screen} ${theme} ${vp}: ${errors.join("; ")}`); }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) { problems += 1; console.log(`OVERFLOW ${screen} ${theme} ${vp}: ${overflow}px`); }
        await context.close();
        count += 1;
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`${count} screenshots, ${violations} axe violations, ${problems} console or overflow problems`);
if (violations || problems) process.exitCode = 1;
