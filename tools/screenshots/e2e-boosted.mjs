// Every interactive app page, reached the way people reach it: through a boosted link or form
// (`<body hx-boost="true">`), never by a fresh page load. A boosted click swaps <body> and runs
// nothing in the next page's <head>, so a page script loaded there works on a direct load (and in
// screenshots) and is dead after a click. This drives a real browser through the auth samples and
// the live room and checks each behavior after a boosted arrival and after an htmx re-render:
// password Show (type=text, aria-pressed=true, once per click), the Caps Lock hint, one-time-code
// auto-submit, copy and print on the recovery codes, entering and switching live rooms.
//
//   tools/e2e.sh                                     builds and starts the demo, runs this, stops it
//   BASE=http://localhost:4000 node tools/screenshots/e2e-boosted.mjs   against a running demo
//
// Needs the demo with every sample (tools/demo.sh all: seeded accounts, the dev mailbox). Fails on
// any failed check and on any console error (a CSP violation, a script error). Synthetic data only:
// example.com addresses, fresh accounts, the fake demo password.
import { createHmac } from "node:crypto";
import { chromium } from "playwright-core";

const BASE = (process.env.BASE ?? "http://localhost:4000").replace(/\/$/, "");
const DEMO = { email: "demo@example.com", password: "not-a-real-password-42" };
const HEADED = process.env.HEADED === "1";

let failures = 0;
let passes = 0;
const check = (ok, what) => {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

// ---- helpers --------------------------------------------------------------------------------

let n = 0;
const fresh = () => `e2e-${Date.now().toString(36)}-${n++}@example.com`;

const latest = async (to, { after = 0, want = () => true } = {}) => {
  for (let i = 0; i < 50; i += 1) {
    const res = await fetch(`${BASE}/dev/mailbox/latest.json?to=${encodeURIComponent(to)}`);
    if (res.ok) {
      const mail = await res.json();
      if (mail.id > after && want(mail)) return mail;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no new mail for ${to}`);
};
const lastId = async (to) => {
  const res = await fetch(`${BASE}/dev/mailbox/latest.json?to=${encodeURIComponent(to)}`);
  return res.ok ? (await res.json()).id : 0;
};

const base32 = (s) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
// RFC 6238: HMAC-SHA-1, 30 s steps, 6 digits.
const totp = (secret, offset = 0) => {
  const step = Math.floor(Date.now() / 1000 / 30) + offset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};

const settle = async (page) => {
  await page.waitForLoadState("networkidle");
  // htmx settles after the swap (20 ms by default): let it finish.
  await page.waitForTimeout(150);
};

// A full page load clears this; a boosted swap keeps it.
const mark = (page) => page.evaluate(() => { window.e2eSamePage = true; });
const samePage = async (page, what) => {
  check(await page.evaluate(() => window.e2eSamePage === true), `${what}: arrived through a boosted swap, no page load`);
  check(await page.evaluate(() => document.querySelectorAll('script[src*="/static/auth.js"]').length === 1), `${what}: auth.js is on the page once`);
};

/** Clicks a link or a submit button and waits for the boosted swap that follows. */
const click = async (page, locator, what, { url } = {}) => {
  await mark(page);
  const swapped = page.evaluate(() => new Promise((resolve) => {
    document.addEventListener("htmx:afterSettle", () => resolve(), { once: true });
  }));
  await locator.click();
  await swapped;
  if (url) await page.waitForURL(url);
  await settle(page);
  await samePage(page, what);
};

/** For a page people reach from an email: an in-app link to it, boosted like any other, clicked. */
const follow = async (page, href, what) => {
  await page.evaluate((h) => {
    const a = document.createElement("a");
    a.href = h;
    a.id = "e2e-link";
    a.textContent = "e2e";
    document.querySelector("main").append(a);
    window.htmx.process(a);
  }, href);
  await click(page, page.locator("#e2e-link"), what);
};

const reveal = async (page, id, what) => {
  const button = page.locator(`[data-reveal="${id}"]`).first();
  const input = page.locator(`#${id}`);
  await button.click();
  check(await input.getAttribute("type") === "text", `${what}: Show makes the password visible (type=text)`);
  check(await button.getAttribute("aria-pressed") === "true", `${what}: Show is pressed (aria-pressed=true)`);
  check(await button.locator("[data-reveal-label]").innerText() === "Hide", `${what}: the button reads Hide`);
  await button.click();
  check(await input.getAttribute("type") === "password" && await button.getAttribute("aria-pressed") === "false", `${what}: a second click hides it again (bound once)`);
};

const capsLock = async (page, id, hint, what) => {
  const input = page.locator(`#${id}`);
  await input.focus();
  const key = (caps) => page.evaluate(([i, c]) => {
    document.getElementById(i).dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, modifierCapsLock: c }));
  }, [id, caps]);
  await key(true);
  check(await page.locator(`#${hint}`).isVisible(), `${what}: the Caps Lock hint shows while Caps Lock is on`);
  await key(false);
  check(!(await page.locator(`#${hint}`).isVisible()), `${what}: the hint hides when it's off`);
};

/** Types a code key by key (no submit click): the form must submit itself at six digits. */
const typeCode = async (page, id, code, what) => {
  await mark(page);
  const swapped = page.evaluate(() => new Promise((resolve) => {
    document.addEventListener("htmx:afterSettle", () => resolve(), { once: true });
  }));
  await page.locator(`#${id}`).pressSequentially(code, { delay: 20 });
  await Promise.race([swapped, page.waitForTimeout(5000)]);
  await settle(page);
  // Accepted: the next page has no such field (a rejected code re-renders the form with it).
  check(await page.locator(`#${id}`).count() === 0, `${what}: six digits submit the form by themselves`);
  await samePage(page, what);
};

const signedIn = async (page) => (await page.locator("nav button:has-text('Sign out')").count()) > 0;
const signOut = async (page, what) => {
  await click(page, page.locator("nav button:has-text('Sign out')"), what);
  check(!(await signedIn(page)), `${what}: signed out`);
};

const magicLinkSignIn = async (page, email, what) => {
  await click(page, page.locator("nav a:has-text('Sign in')"), `${what}: the nav's Sign in link`, { url: /\/session\/new/ });
  const before = await lastId(email);
  await page.fill("#link_email", email);
  await click(page, page.locator("button:has-text('Email me a sign-in link')"), `${what}: the check-your-email page`);
  const mail = await latest(email, { after: before, want: (m) => m.codes?.length });
  await typeCode(page, "login_code", mail.codes[0], `${what}: the emailed code`);
};

// ---- the run --------------------------------------------------------------------------------

const browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
const errors = [];
const newPage = async (name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  // A 4xx on purpose (a 422 form) logs "Failed to load resource"; anything else fails the run.
  page.on("console", (m) => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  return page;
};

try {
  // 1. Password sign-in, reached from the home page through the nav's boosted Sign in link.
  const page = await newPage("password");
  await click(page, page.locator("nav a:has-text('Sign in')"), "sign-in page", { url: /\/session\/new/ });
  await reveal(page, "signin_password", "sign-in page");
  await capsLock(page, "signin_password", "signin_capslock", "sign-in page");

  // A failed attempt re-renders the form (a 422 swap): the new form works the same.
  await page.fill("#signin_email", fresh());
  await page.fill("#signin_password", "not-the-password");
  await click(page, page.locator("form[action='/session/password'] button:has-text('Sign in')"), "sign-in after a failed attempt");
  check(await page.locator("#password_form_alert").isVisible(), "sign-in after a failed attempt: the form says why");
  await reveal(page, "signin_password", "sign-in after a failed attempt");
  await capsLock(page, "signin_password", "signin_capslock", "sign-in after a failed attempt");

  // Forgot password: the reset page, opened from the email through an in-app boosted link.
  await click(page, page.locator("a:has-text('Forgot password?')"), "forgot-password page", { url: /\/passwords\/new/ });
  const resetBefore = await lastId(DEMO.email);
  await page.fill("#email", DEMO.email);
  await click(page, page.locator("button:has-text('Email me a reset link')"), "reset requested");
  const reset = (await latest(DEMO.email, { after: resetBefore, want: (m) => m.links?.some((l) => l.includes("/passwords/")) })).links.find((l) => l.includes("/passwords/"));
  await follow(page, reset, "reset-password page");
  await reveal(page, "password", "reset-password page");
  await capsLock(page, "password", "password_capslock", "reset-password page");

  // Sign in for real, then the account pages.
  await click(page, page.locator("nav a:has-text('Sign in')"), "sign-in page again", { url: /\/session\/new/ });
  await page.fill("#signin_email", DEMO.email);
  await page.fill("#signin_password", DEMO.password);
  await click(page, page.locator("form[action='/session/password'] button:has-text('Sign in')"), "signed in with a password");
  check(await signedIn(page), "signed in with a password: the nav offers Sign out");
  await click(page, page.locator("nav a[href='/account']").first(), "account page", { url: /\/account$/ });
  await click(page, page.locator("a:has-text('Change password'), a:has-text('Set a password')").first(), "change-password page", { url: /\/account\/password\/edit/ });
  await reveal(page, "password", "change-password page");
  await follow(page, "/account/confirm", "confirm-it's-you page");
  await reveal(page, "confirm_password", "confirm-it's-you page");
  await capsLock(page, "confirm_password", "confirm_capslock", "confirm-it's-you page");
  await signOut(page, "sign out");

  // 2. Magic link: request, then type the emailed code (no click): it submits itself.
  const email = fresh();
  await magicLinkSignIn(page, email, "magic link");
  check(await signedIn(page), "magic link: six digits signed in");

  // 3. Two-factor: enrol (the code submits itself), then copy and print the recovery codes.
  await click(page, page.locator("nav a[href='/account']").first(), "account page (magic link)", { url: /\/account$/ });
  await click(page, page.locator("a:has-text('Turn on')"), "two-factor setup page", { url: /\/two-factor\/new/ });
  const key = base32(await page.locator("#manual_key").innerText());
  await typeCode(page, "enrol_code", totp(key), "two-factor setup");
  check(await page.locator("#recovery_codes").isVisible(), "two-factor setup: the recovery codes show");
  const first = (await page.locator("#recovery_codes li").first().innerText()).trim();
  const copy = page.locator("[data-copy='recovery_codes']");
  await copy.click();
  await page.waitForFunction(() => document.querySelector("[data-copy='recovery_codes']").textContent === "Copied");
  check(true, "recovery codes: Copy says Copied");
  check((await page.evaluate(() => navigator.clipboard.readText())).includes(first), "recovery codes: the codes are on the clipboard");
  await page.evaluate(() => { window.e2ePrinted = 0; window.print = () => { window.e2ePrinted += 1; }; });
  await page.locator("[data-print]").click();
  check(await page.evaluate(() => window.e2ePrinted) === 1, "recovery codes: Print opens the print dialog once");

  // The next sign-in asks for a code on the challenge page; it submits itself too.
  await signOut(page, "sign out (two-factor)");
  await magicLinkSignIn(page, email, "two-factor sign-in");
  check(await page.locator("#totp_code").isVisible(), "two-factor sign-in: the challenge page asks for a code");
  await typeCode(page, "totp_code", totp(key, 1), "two-factor challenge");
  check(await signedIn(page), "two-factor challenge: six digits signed in");

  // 4. The live room: in through the nav's boosted link, then from room to room.
  await click(page, page.locator("nav a:has-text('Live room')"), "live room", { url: /\/live/ });
  await page.waitForFunction(() => document.querySelector("[data-live-room]")?.dataset.status === "open", null, { timeout: 10000 }).catch(() => {});
  check(await page.evaluate(() => document.querySelector("[data-live-room]")?.dataset.status) === "open", "live room: connected after a boosted link");
  const topic = await page.evaluate(() => document.querySelector("[data-live-room]").dataset.topic);
  const other = page.locator("nav[aria-label=Rooms] a:not([aria-current])").first();
  if (await other.count()) {
    await click(page, other, "another live room");
    await page.waitForFunction((t) => {
      const room = document.querySelector("[data-live-room]");
      return room && room.dataset.topic !== t && room.dataset.status === "open";
    }, topic, { timeout: 10000 }).catch(() => {});
    check(await page.evaluate((t) => {
      const room = document.querySelector("[data-live-room]");
      return room.dataset.topic !== t && room.dataset.status === "open";
    }, topic), "another live room: connected after a boosted link between rooms");
    await page.fill("[data-composer] textarea", "hello from e2e");
    await page.press("[data-composer] textarea", "Enter");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("[data-messages] [data-f=body]")).some((e) => e.textContent === "hello from e2e"), null, { timeout: 10000 }).catch(() => {});
    check(await page.evaluate(() => Array.from(document.querySelectorAll("[data-messages] [data-f=body]")).some((e) => e.textContent === "hello from e2e")), "another live room: a message posts and shows");
  } else {
    check(false, "live room: a second room to switch to");
  }

  // Out through a boosted link: the room leaves its topics (signing out in the room reloads it).
  await click(page, page.locator("nav[aria-label=Main] > a[href='/']"), "home page (left the live room)");
  check(await page.evaluate(() => window.OffRails.socket().channels.size === 0), "home page (left the live room): the room's topics were left");

  // 5. Sign-up, and its email link opened in another browser (asks for the password).
  await signOut(page, "sign out (after the live room)");
  await click(page, page.locator("nav a:has-text('Sign in')"), "sign-in page (sign-up)", { url: /\/session\/new/ });
  await click(page, page.locator("a:has-text('Create an account')"), "sign-up page", { url: /\/registration\/new/ });
  await reveal(page, "password", "sign-up page");
  await capsLock(page, "password", "password_capslock", "sign-up page");
  const signup = fresh();
  await page.fill("#email", signup);
  await page.fill("#password", "copper kettle lighthouse e2e");
  await click(page, page.locator("button:has-text('Create account')"), "sign-up sent");
  const verify = (await latest(signup, { want: (m) => m.links?.some((l) => l.includes("/email-verification/")) })).links.find((l) => l.includes("/email-verification/"));
  const other2 = await newPage("other browser");
  await follow(other2, verify, "confirm-your-email page (another browser)");
  await reveal(other2, "verify_password", "confirm-your-email page (another browser)");
  await other2.context().close();

  // 6. The dev dashboard's browser beacon, loaded once by the layout, still reports after a boosted
  // link: the lab widget whose script only binds on a full load is reported as dead clicks.
  if ((await fetch(`${BASE}/dev/lab/ux`)).ok) {
    await follow(page, `${BASE}/dev/lab/ux`, "UX trouble page");
    await click(page, page.locator("#to-widget"), "lab widget (boosted)", { url: /\/dev\/lab\/ux\/widget/ });
    for (let i = 0; i < 3; i += 1) {
      await page.locator("#show-code").click();
      await page.waitForTimeout(1300);
    }
    check(await page.locator("#lab-code").isHidden(), "lab widget (boosted): Show stays dead, as planted");
    await page.waitForTimeout(3500);
    const frontend = await (await fetch(`${BASE}/dev/dashboard/frontend`)).text();
    check(/#show-code[\s\S]{0,400}dead[\s\S]{0,400}\/dev\/lab\/ux\/widget/.test(frontend), "beacon: the dead clicks after a boosted link are reported");
  }
} finally {
  await browser.close();
}

for (const e of errors) check(false, `console: ${e}`);
console.log(`\ne2e-boosted: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
