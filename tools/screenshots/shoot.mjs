// Screenshots of every screen the samples build: light and dark, desktop (1440x900) and mobile
// (390x844), into docs/screenshots/<sample>/<screen>-<theme>-<viewport>.png.
// Run through tools/screenshots.sh, which starts the demo (seeded, synthetic data) first.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3900";
const OUT = process.env.OUT ?? "docs/screenshots";
const only = process.argv.slice(2);

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
    ];
  },
};

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
let count = 0;
try {
  for (const [sample, list] of Object.entries(screens)) {
    if (only.length && !only.includes(sample)) continue;
    mkdirSync(`${OUT}/${sample}`, { recursive: true });
    for (const [screen, path, act] of await list()) {
      for (const theme of ["light", "dark"]) {
        for (const [vp, opts] of Object.entries(viewports)) {
          const context = await browser.newContext({
            viewport: { width: opts.width, height: opts.height },
            deviceScaleFactor: opts.deviceScaleFactor,
            isMobile: opts.isMobile,
            hasTouch: opts.hasTouch ?? false,
            colorScheme: theme,
            reducedMotion: "reduce",
          });
          const page = await context.newPage();
          const errors = [];
          page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
          await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
          if (act) await act(page);
          await page.waitForTimeout(300);
          const file = `${OUT}/${sample}/${screen}-${theme}-${vp}.png`;
          await page.screenshot({ path: file });
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
console.log(`${count} screenshots in ${OUT}`);
