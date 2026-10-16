// Screenshots of every auth screen (auth-core, auth-password, auth-magic-link, auth-totp), light
// and dark, desktop (1440x900) and mobile (390x844), into
// docs/screenshots/<sample>/<screen>-<theme>-<viewport>.png.
//
// Against the demo (tools/demo.sh, with `app task auth_demo` seeded; all four auth samples
// installed), from the repo root:
//
//   (cd tools/screenshots && pnpm install --frozen-lockfile)
//   BASE=http://localhost:3900 node samples/auth-core/screenshots.mjs [sample…]
//
// Every address is on example.com; the only TOTP secret shown is the fixed, fake demo key
// (AAAA…); fresh accounts get random secrets that exist only in the throwaway demo database.
// `authScreens` has the same shape as tools/screenshots/shoot.mjs's `screens`, which imports it:
// tools/screenshots.sh shoots these with every other installed sample (and runs axe with AXE=1).
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3900";
const OUT = process.env.OUT ?? "docs/screenshots";
const DEMO = { email: "demo@example.com", twoFactor: "demo-2fa@example.com", password: "not-a-real-password-42" };

// ---- helpers --------------------------------------------------------------------------------

const latest = async (to) => {
  const res = await fetch(`${BASE}/dev/mailbox/latest.json?to=${encodeURIComponent(to)}`);
  if (!res.ok) throw new Error(`no mail for ${to}`);
  return res.json();
};

const base32 = (s) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

// RFC 6238: HMAC-SHA-1, 30 s, 6 digits.
const totp = (secret, offset = 0) => {
  const step = Math.floor(Date.now() / 1000 / 30) + offset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};

let fresh = 0;
const freshEmail = () => `shot-${Date.now().toString(36)}-${fresh++}@example.com`;

const settle = async (page) => {
  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle");
};

const passwordSignIn = async (page, email) => {
  await page.goto(`${BASE}/session/new`, { waitUntil: "networkidle" });
  await page.fill("#signin_email", email);
  await page.fill("#signin_password", DEMO.password);
  await page.click("form[action='/session/password'] button:has-text('Sign in')");
  await settle(page);
};

/** Signs up a fresh account with an emailed code; returns its address. */
const magicSignUp = async (page) => {
  const email = freshEmail();
  await page.goto(`${BASE}/session/new`, { waitUntil: "networkidle" });
  await page.fill("#link_email", email);
  await page.click("button:has-text('Email me a sign-in link')");
  await settle(page);
  await page.waitForTimeout(400);
  const mail = await latest(email);
  await page.fill("#login_code", mail.codes[0]); // auto-submits at six digits
  await settle(page);
  return email;
};

/** A fresh account with two-factor turned on; leaves the page on the recovery codes. */
const enrolFresh = async (page) => {
  await magicSignUp(page);
  await page.goto(`${BASE}/account/two-factor/new`, { waitUntil: "networkidle" });
  const key = await page.locator("#manual_key").innerText();
  await page.fill("#enrol_code", totp(base32(key)));
  await settle(page);
};

const go = (path) => async (page) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
};

// ---- screens --------------------------------------------------------------------------------

export const authScreens = {
  "auth-core": async () => [
    ["sign-in", "/session/new"],
    ["account", "/", async (page) => { await passwordSignIn(page, DEMO.email); await go("/account")(page); }],
    ["confirm", "/", async (page) => { await passwordSignIn(page, DEMO.email); await go("/account/confirm")(page); }],
    ["change-email", "/", async (page) => { await passwordSignIn(page, DEMO.email); await go("/account/email/edit")(page); }],
    ["not-me", "/", async (page) => {
      await passwordSignIn(page, DEMO.email); // a new browser: the notice email has a not-me link
      await page.waitForTimeout(500);
      const mail = await latest(DEMO.email);
      const link = mail.links.find((l) => l.includes("/security/not-me/"));
      await page.context().clearCookies();
      await page.goto(link, { waitUntil: "networkidle" });
    }],
    ["invalid-link", "/security/not-me/this-link-was-already-used"],
  ],
  "auth-password": async () => [
    ["sign-up", "/registration/new"],
    ["sign-up-strength", "/registration/new", async (page) => {
      await page.fill("#email", "ada@example.com");
      await page.type("#password", "copper kettle lighthouse", { delay: 5 });
      await page.waitForTimeout(700);
    }],
    ["sign-up-errors", "/registration/new", async (page) => {
      await page.fill("#email", "ada@example.com");
      await page.fill("#password", "password1234");
      await page.click("button:has-text('Create account')");
      await settle(page);
    }],
    ["check-email", "/registration/sent"],
    ["verify-other-browser", "/registration/new", async (page) => {
      const email = freshEmail();
      await page.fill("#email", email);
      await page.fill("#password", "copper kettle lighthouse");
      await page.click("button:has-text('Create account')");
      await settle(page);
      await page.waitForTimeout(400);
      const link = (await latest(email)).links.find((l) => l.includes("/email-verification/"));
      await page.context().clearCookies();
      await page.goto(link, { waitUntil: "networkidle" });
    }],
    ["sign-in", "/session/new"],
    ["forgot-password", "/passwords/new"],
    ["reset", "/passwords/new", async (page) => {
      await page.fill("#email", DEMO.email);
      await page.click("button:has-text('Email me a reset link')");
      await settle(page);
      await page.waitForTimeout(400);
      const link = (await latest(DEMO.email)).links.find((l) => l.includes("/passwords/"));
      await page.goto(link, { waitUntil: "networkidle" });
    }],
    ["change-password", "/", async (page) => { await passwordSignIn(page, DEMO.email); await go("/account/password/edit")(page); }],
  ],
  "auth-magic-link": async () => [
    ["sign-in", "/session/new"],
    ["sent", "/session/new", async (page) => {
      await page.fill("#link_email", "ada@example.com");
      await page.click("button:has-text('Email me a sign-in link')");
      await settle(page);
    }],
    ["confirm", "/session/new", async (page) => {
      await page.fill("#link_email", "ada@example.com");
      await page.click("button:has-text('Email me a sign-in link')");
      await settle(page);
      await page.waitForTimeout(400);
      await page.goto((await latest("ada@example.com")).links[0], { waitUntil: "networkidle" });
    }],
    ["other-browser", "/session/new", async (page) => {
      await page.fill("#link_email", "ada@example.com");
      await page.click("button:has-text('Email me a sign-in link')");
      await settle(page);
      await page.waitForTimeout(400);
      const link = (await latest("ada@example.com")).links[0];
      await page.context().clearCookies();
      await page.goto(link, { waitUntil: "networkidle" });
    }],
    ["email", "/session/new", async (page) => {
      await page.fill("#link_email", "ada@example.com");
      await page.click("button:has-text('Email me a sign-in link')");
      await settle(page);
      await page.waitForTimeout(400);
      await go(`/dev/mailbox/${(await latest("ada@example.com")).id}`)(page);
    }],
  ],
  "auth-totp": async () => [
    ["enrol", "/", async (page) => { await passwordSignIn(page, DEMO.email); await go("/account/two-factor/new")(page); }],
    ["challenge", "/", async (page) => { await passwordSignIn(page, DEMO.twoFactor); }],
    ["challenge-recovery", "/", async (page) => {
      await passwordSignIn(page, DEMO.twoFactor);
      await page.click("summary:has-text('Lost your phone?')");
      await page.waitForTimeout(200);
    }],
    ["recovery-codes", "/", enrolFresh],
    ["account", "/", async (page) => { await enrolFresh(page); await go("/account")(page); }],
    ["confirm-with-code", "/", async (page) => { await enrolFresh(page); await go("/account/confirm")(page); }],
  ],
};

// ---- runner ---------------------------------------------------------------------------------

const viewports = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import(new URL("../../tools/screenshots/node_modules/playwright-core/index.mjs", import.meta.url));
  const only = process.argv.slice(2);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let count = 0;
  try {
    for (const [sample, list] of Object.entries(authScreens)) {
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
            // A 4xx status on purpose (a 422 form, a 403 wrong-browser page) logs "Failed to load
            // resource"; anything else (CSP violations, script errors) fails the run.
            page.on("console", (m) => {
              if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(m.text());
            });
            await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
            if (act) await act(page);
            await page.waitForTimeout(300);
            await page.screenshot({ path: `${OUT}/${sample}/${screen}-${theme}-${vp}.png` });
            if (errors.length) throw new Error(`${sample}/${screen}: console errors: ${errors.join("; ")}`);
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
}
