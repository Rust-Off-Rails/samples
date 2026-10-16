// Screenshots of every screen the samples build: light and dark, desktop (1440x900) and mobile
// (390x844), into docs/screenshots/<sample>/<screen>-<theme>-<viewport>.png. <theme> is the OS
// scheme the browser emulates; a screen with `cookie` also forces the header's theme switch
// (the `offrails_theme` cookie), to prove the choice beats the OS.
// AXE=1 also runs axe-core (WCAG 2.2 AA) on every shot and prints each violation.
// Run through tools/screenshots.sh, which starts the demo (seeded, synthetic data) first and passes
// INSTALLED (the samples in the demo): a sample's screens are shot only when it is installed.
//
// A screen is [name, path | async () => path, act?, options?]; options: `cookie` (force the theme
// switch), `themes`, `storageState` (a signed-in browser), `after` (runs after the shot).
// The auth samples' screens live in samples/auth-core/screenshots.mjs, realtime's in
// ./realtime.mjs (a cast of three people kept signed in); jobs-dashboard has its own script.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { authScreens } from "../../samples/auth-core/screenshots.mjs";
import { realtimeScreens } from "./realtime.mjs";

const BASE = process.env.BASE ?? "http://localhost:3900";
const OUT = process.env.OUT ?? "docs/screenshots";
const AXE = process.env.AXE === "1";
const INSTALLED = (process.env.INSTALLED ?? "").split(/\s+/).filter(Boolean);
const only = process.argv.slice(2);
const axeSource = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

const openThemeSwitch = async (page) => {
  await page.locator("[data-theme-switch] > summary").click();
  await page.locator("[data-theme-switch] button[aria-pressed=true]").waitFor();
};

const idOf = async (subject) => {
  const res = await fetch(`${BASE}/dev/mailbox.json?subject=${encodeURIComponent(subject)}`);
  const list = await res.json();
  if (!list.length) throw new Error(`no seeded mail with subject ${subject}`);
  return list[0].id;
};

const screens = {
  host: async () => [
    ["home", "/"],
    ["dev", "/dev"],
    ["routes", "/dev/routes"],
    ["system", "/dev/system"],
    ["theme-switch-open", "/dev", openThemeSwitch],
    // The switch beats the OS: Dark chosen while the system is Light, and the other way round.
    ["forced-dark", "/dev", openThemeSwitch, { cookie: "dark", themes: ["light"] }],
    ["forced-light", "/dev", openThemeSwitch, { cookie: "light", themes: ["dark"] }],
    // App pages (Tailwind `dark:`) follow the same cookie.
    ["home-forced-dark", "/", null, { cookie: "dark", themes: ["light"] }],
  ],
  mailer: async () => [
    ["test-email-preview", "/dev/mailbox/previews/test_mailer/test_email"],
    ["test-email-text", "/dev/mailbox/previews/test_mailer/test_email?tab=text"],
  ],
  "dev-mailbox": async () => {
    const code = await idOf("verification code");
    const receipt = await idOf("Receipt");
    const invite = await idOf("invited you");
    const digest = await idOf("Weekly digest");
    return [
      ["inbox", `/dev/mailbox/${code}`],
      ["attachments", `/dev/mailbox/${receipt}`],
      ["checks", `/dev/mailbox/${invite}`],
      ["dark-preview", `/dev/mailbox/${digest}?view=dark`],
      ["width-320", `/dev/mailbox/${digest}?view=320`],
      ["raw", `/dev/mailbox/${receipt}?tab=raw`],
      ["headers", `/dev/mailbox/${receipt}?tab=headers`],
      ["search", `/dev/mailbox?q=password`],
      ["previews", `/dev/mailbox/previews`],
      ["shortcuts", `/dev/mailbox/${code}`, async (page) => { await page.keyboard.press("?"); }],
      ["forced-dark", `/dev/mailbox/${code}`, null, { cookie: "dark", themes: ["light"] }],
    ];
  },
  ...authScreens,
  realtime: realtimeScreens,
};

// A deliberate 4xx (a 422 form, a 403 wrong-browser page) logs "Failed to load resource: … status
// of 4xx"; anything else (a CSP violation, a script error, a 5xx) fails the run.
const isError = (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text());

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const castErrors = [];
let count = 0;
let violations = 0;
try {
  for (const [sample, list] of Object.entries(screens)) {
    if (only.length && !only.includes(sample)) continue;
    if (sample !== "host" && INSTALLED.length && !INSTALLED.includes(sample)) continue;
    mkdirSync(`${OUT}/${sample}`, { recursive: true });
    for (const [screen, pathOrFn, act, opt = {}] of await list({ browser, base: BASE, errors: castErrors })) {
      for (const theme of opt.themes ?? ["light", "dark"]) {
        for (const [vp, opts] of Object.entries(viewports)) {
          const context = await browser.newContext({
            viewport: { width: opts.width, height: opts.height },
            deviceScaleFactor: opts.deviceScaleFactor,
            isMobile: opts.isMobile,
            hasTouch: opts.hasTouch ?? false,
            colorScheme: theme,
            reducedMotion: "reduce",
            ...(opt.storageState ? { storageState: opt.storageState } : {}),
          });
          if (opt.cookie) {
            await context.addCookies([{ name: "offrails_theme", value: opt.cookie, url: BASE }]);
          }
          const page = await context.newPage();
          const errors = [];
          page.on("console", (m) => { if (isError(m)) errors.push(m.text()); });
          const path = typeof pathOrFn === "function" ? await pathOrFn() : pathOrFn;
          await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
          if (act) await act(page);
          await page.waitForTimeout(300);
          const file = `${OUT}/${sample}/${screen}-${theme}-${vp}.png`;
          await page.screenshot({ path: file });
          if (AXE) {
            await page.evaluate(axeSource);
            const result = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }));
            for (const v of result.violations) {
              violations += 1;
              console.log(`AXE ${sample} ${screen} ${theme} ${vp}: ${v.id} (${v.impact}) ${v.nodes.length}x: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
            }
          }
          if (errors.length) throw new Error(`${sample}/${screen} ${path}: console errors: ${errors.join("; ")}`);
          await context.close();
          if (opt.after) await opt.after();
          count += 1;
        }
      }
    }
  }
} finally {
  await browser.close();
}
if (castErrors.length) throw new Error(`console errors in the realtime cast: ${castErrors.join("; ")}`);
console.log(`${count} screenshots in ${OUT}${AXE ? `, ${violations} axe violations` : ""}`);
