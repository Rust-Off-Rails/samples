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
const runsAt = [];
const throttle = async () => {
  const minute = () => runsAt.filter((t) => Date.now() - t < 61_000);
  while (minute().length >= 5) await new Promise((r) => setTimeout(r, 2_000));
  runsAt.push(Date.now());
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

const screens = [
  ["overview", async () => "/dev/dashboard"],
  ["charts", async () => "/dev/dashboard/charts?range=1h"],
  ["charts-readout", async () => "/dev/dashboard/charts?range=1h", async (page) => {
    const box = await page.locator("#chart-latency .plot").boundingBox();
    if (box) await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.5);
  }],
  ["insights", async () => "/dev/dashboard/insights"],
  ["requests", async () => "/dev/dashboard/requests?sort=p95"],
  ["routes", async () => "/dev/dashboard/routes?area=dev&q=lab"],
  ["traces", async () => "/dev/dashboard/traces?notable=1"],
  ["waterfall", async (p) => firstHref(p, "/dev/dashboard/traces?route=%2Fdev%2Flab%2Forders%2Fn-plus-one", "table a.mono")],
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
  ["ai-setup", async () => "/dev/dashboard/sql", async (page) => {
    await page.locator("[data-ai-panel] > summary").click();
    await page.locator(".ai-setup").waitFor();
  }],
  // Ask AI as an agent, against tools/screenshots/ai-mock.mjs (a scripted, clearly fake
  // investigation): the health summary, a run mid-stream and finished (citations, an inline
  // chart, a proposed action, the fix prompt), the history, an incident card, the bar on the
  // mailbox and jobs pages. "What am I looking at?" needs no key.
  ["ai-explain", async () => "/dev/dashboard/explain"],
  ["ai-health", async () => "/dev/dashboard", async (page) => {
    await throttle();
    await page.locator("#health [data-ai-send]").click();
    await page.locator("#health .ai-end .ai-text").waitFor({ timeout: 90_000 });
    await page.locator("#health").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-run-live", async () => "/dev/dashboard/sql", async (page) => {
    await page.locator("[data-ai-panel] > summary").click();
    await page.locator("[data-ai-prompt]").first().click();
    await throttle();
    await page.locator("[data-ai-send]").click();
    await page.locator(".ai-run .ai-step").nth(2).waitFor({ timeout: 60_000 });
    const href = await page.locator(".ai-run .ai-permalink").getAttribute("href");
    if (href) lastRun = href;
    await page.locator(".ai-run").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-run-done", async () => `${lastRun}?wait=1`, async (page) => {
    await page.locator(".ai-end .ai-chart").first().waitFor({ timeout: 60_000 });
    await page.locator(".ai-end").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-history", async () => "/dev/dashboard/ai/history", null, { base: AI_BASE }],
  ["ai-incident", async () => "/dev/dashboard/insights", async (page) => {
    await page.locator("#incidents .incident-story").first().waitFor({ timeout: 120_000 });
    await page.locator("#incidents").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-mailbox", async () => "/dev/mailbox", async (page) => {
    await page.locator(".ai-bar > summary").click();
    await page.locator(".ai-bar [data-ai-prompt]").first().click();
    await throttle();
    await page.locator(".ai-bar [data-ai-send]").click();
    await page.locator(".ai-bar .ai-end .ai-text").waitFor({ timeout: 60_000 });
    await page.locator(".ai-bar").scrollIntoViewIfNeeded();
  }, { base: AI_BASE }],
  ["ai-jobs", async () => "/admin/jobs", async (page) => {
    await page.locator(".ai-bar > summary").click();
    await page.locator(".ai-bar [data-ai-form]").waitFor();
  }, { base: AI_BASE }],
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
