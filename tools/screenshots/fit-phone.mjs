// At a phone's width (390 px), no kernel page scrolls sideways: wide tables scroll inside their
// own wrapper and tab bars inside themselves. Every dev-dashboard and jobs-dashboard tab (from their
// nav bars) plus the mailbox and /dev; prints each page's width and the elements that stick out.
// tools/e2e.sh runs it (CI's e2e job).
//
//   BASE=http://localhost:3900 node tools/screenshots/fit-phone.mjs [path…]
import { chromium } from "playwright-core";

const BASE = (process.env.BASE ?? "http://localhost:3900").replace(/\/$/, "");
const FIXED = [
  "/dev", "/dev/mailbox", "/dev/dashboard", "/admin/dashboard", "/admin/dashboard/requests",
  "/admin/jobs", "/admin/jobs/cron", "/admin/jobs/list", "/admin/jobs/errors",
];
const browser = await chromium.launch({ channel: "chrome" });
let failures = 0;
try {
  // Every tab the dev dashboard and the jobs dashboard link to, discovered from their nav bars.
  let paths = process.argv.slice(2);
  if (!paths.length) {
    const found = new Set(FIXED);
    const scout = await browser.newPage();
    for (const [start, sel] of [["/dev/dashboard", ".dash-nav a[href]"], ["/admin/jobs", "main nav a[href]"]]) {
      await scout.goto(`${BASE}${start}`, { waitUntil: "load" });
      for (const href of await scout.$$eval(sel, (as) => as.map((a) => a.getAttribute("href")))) {
        if (href.startsWith("/") && !href.includes("#")) found.add(href.split("?")[0]);
      }
    }
    await scout.close();
    paths = [...found];
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const path of paths) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const culprits = [];
        for (const el of document.querySelectorAll("body *")) {
          const b = el.getBoundingClientRect();
          if (b.right > vw + 1 && b.width > 0) {
            // only the outermost: skip if an ancestor already overflows and clips (scrolls)
            let p = el.parentElement, clipped = false;
            while (p && p !== document.body) {
              const s = getComputedStyle(p);
              if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; }
              p = p.parentElement;
            }
            if (!clipped) culprits.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${[...el.classList].join(".")} right=${Math.round(b.right)}`);
          }
        }
        return { vw, sw, culprits: culprits.slice(0, 6) };
      });
      const ok = r.sw <= r.vw + 1 && (res?.status() ?? 500) < 400;
      if (!ok) failures += 1;
      console.log(`${ok ? "ok  " : "FAIL"} ${path} (${res?.status()}) scrollWidth ${r.sw} / ${r.vw}${ok ? "" : "\n     " + r.culprits.join("\n     ")}`);
    }
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
