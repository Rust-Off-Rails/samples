// Screenshots + axe for the dev dashboard. BASE, OUT, AXE=1. Run through tools/screenshots.sh,
// which starts the demo (fake orders, synthetic test runs, a recorded GitHub repo, a warmup burst).
// Live pages hold a Server-Sent Events stream open, so pages are shot after "load", not
// "networkidle" (which never comes).
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3900";
const OUT = process.env.OUT ?? "out";
const AXE = process.env.AXE === "1";
const only = process.argv.slice(2);
const axeSource = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

// The first link matching `selector` on `path`.
const firstHref = async (page, path, selector) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  const href = await page.locator(selector).first().getAttribute("href");
  if (!href) throw new Error(`no ${selector} on ${path}`);
  return href;
};

// Starts a traffic run once, so the four lab shots catch it mid-run.
let labStarted = false;
const startTraffic = async () => {
  if (labStarted) return;
  labStarted = true;
  const body = new URLSearchParams({ paths: "/dev/lab/orders\n/\n/dev/lab/slow\n/dev/lab/orders/n-plus-one", rps: "40", secs: "45" });
  await fetch(`${BASE}/dev/dashboard/lab/traffic`, { method: "POST", body, redirect: "manual" });
  await new Promise((r) => setTimeout(r, 3000));
};

const screens = [
  ["overview", async () => "/dev/dashboard"],
  ["charts", async () => "/dev/dashboard/charts?range=15m"],
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
  ["schema", async () => "/dev/dashboard/schema"],
  ["tests", async () => "/dev/dashboard/tests"],
  ["github", async () => "/dev/dashboard/github"],
  ["config", async () => "/dev/dashboard/config"],
  ["lab-running", async () => { await startTraffic(); return "/dev/dashboard/lab"; }],
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
    for (const theme of opt.themes ?? ["light", "dark"]) {
      for (const [vp, opts] of Object.entries(viewports)) {
        const context = await browser.newContext({
          viewport: { width: opts.width, height: opts.height },
          deviceScaleFactor: opts.deviceScaleFactor, isMobile: opts.isMobile, hasTouch: opts.hasTouch ?? false,
          colorScheme: theme, reducedMotion: "reduce",
        });
        if (opt.cookie) await context.addCookies([{ name: "offrails_theme", value: opt.cookie, url: BASE }]);
        const page = await context.newPage();
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(String(e)));
        const path = await resolve(page);
        await page.goto(`${BASE}${path}`, { waitUntil: "load" });
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
