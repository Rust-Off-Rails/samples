// Screenshots of every screen the samples build: light and dark, desktop (1440x900) and mobile
// (390x844), into docs/screenshots/<sample>/<screen>-<theme>-<viewport>.png. <theme> is the OS
// scheme the browser emulates; a screen with `cookie` also forces the header's theme switch
// (the `offrails_theme` cookie), to prove the choice beats the OS.
// AXE=1 also runs axe-core (WCAG 2.2 AA) on every shot and prints each violation.
// Run through tools/screenshots.sh, which starts the demo (seeded, synthetic data) first.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3900";
const OUT = process.env.OUT ?? "docs/screenshots";
const AXE = process.env.AXE === "1";
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
};

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
let count = 0;
let violations = 0;
try {
  for (const [sample, list] of Object.entries(screens)) {
    if (only.length && !only.includes(sample)) continue;
    mkdirSync(`${OUT}/${sample}`, { recursive: true });
    for (const [screen, path, act, opt = {}] of await list()) {
      for (const theme of opt.themes ?? ["light", "dark"]) {
        for (const [vp, opts] of Object.entries(viewports)) {
          const context = await browser.newContext({
            viewport: { width: opts.width, height: opts.height },
            deviceScaleFactor: opts.deviceScaleFactor,
            isMobile: opts.isMobile,
            hasTouch: opts.hasTouch ?? false,
            colorScheme: theme,
            reducedMotion: "reduce",
          });
          if (opt.cookie) {
            await context.addCookies([{ name: "offrails_theme", value: opt.cookie, url: BASE }]);
          }
          const page = await context.newPage();
          const errors = [];
          page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
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
          if (errors.length) throw new Error(`${path}: console errors: ${errors.join("; ")}`);
          await context.close();
          count += 1;
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`${count} screenshots in ${OUT}${AXE ? `, ${violations} axe violations` : ""}`);
