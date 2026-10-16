// Screenshots + axe for the jobs dashboard. BASE, OUT, AXE=1. Screens are resolved from the page.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3981";
const OUT = process.env.OUT ?? "out";
const AXE = process.env.AXE === "1";
const only = process.argv.slice(2);
const axeSource = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

// The first job link in a filtered list.
const firstJob = async (page, query) => {
  await page.goto(`${BASE}/admin/jobs/list?${query}`);
  const href = await page.locator("a.row-link").first().getAttribute("href");
  if (!href) throw new Error(`no job for ${query}`);
  return href;
};

const screens = [
  ["overview", async () => "/admin/jobs"],
  ["list", async () => "/admin/jobs/list"],
  ["list-filtered", async () => "/admin/jobs/list?state=discarded&worker=deliver_webhook"],
  ["job-failed", async (p) => firstJob(p, "state=discarded&worker=deliver_webhook")],
  ["job-running", async (p) => firstJob(p, "state=executing")],
  ["job-retrying", async (p) => firstJob(p, "state=retryable&worker=resize_image")],
  ["errors", async () => "/admin/jobs/errors"],
  ["cron", async () => "/admin/jobs/cron"],
  ["confirm", async () => "/admin/jobs/list?state=discarded", async (page) => {
    await page.locator('button[formaction="/admin/jobs/bulk?action=retry"]').click();
    await page.waitForLoadState("networkidle");
  }],
  ["shortcuts", async () => "/admin/jobs/list", async (page) => { await page.keyboard.press("?"); }],
];

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
let count = 0;
let violations = 0;
try {
  mkdirSync(OUT, { recursive: true });
  for (const [screen, resolve, act] of screens) {
    if (only.length && !only.includes(screen)) continue;
    for (const theme of ["light", "dark"]) {
      for (const [vp, opts] of Object.entries(viewports)) {
        const context = await browser.newContext({
          viewport: { width: opts.width, height: opts.height },
          deviceScaleFactor: opts.deviceScaleFactor, isMobile: opts.isMobile, hasTouch: opts.hasTouch ?? false,
          colorScheme: theme, reducedMotion: "reduce",
        });
        const page = await context.newPage();
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(String(e)));
        const path = await resolve(page);
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        if (act) await act(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${screen}-${theme}-${vp}.png`, fullPage: process.env.FULL === "1" });
        if (AXE) {
          await page.evaluate(axeSource);
          const result = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }));
          for (const v of result.violations) {
            violations += 1;
            console.log(`AXE ${screen} ${theme} ${vp}: ${v.id} (${v.impact}) ${v.nodes.length}x: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
          }
        }
        if (errors.length) console.log(`CONSOLE ${screen} ${theme} ${vp}: ${errors.join("; ")}`);
        // Horizontal page scroll is a mobile bug.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) console.log(`OVERFLOW ${screen} ${theme} ${vp}: ${overflow}px`);
        await context.close();
        count += 1;
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`${count} screenshots, ${violations} axe violations`);
