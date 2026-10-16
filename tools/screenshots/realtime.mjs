// The realtime sample's screens for shoot.mjs: the live room with a cast of three people who stay
// signed in for every shot (so they are "here", typing, waving), /dev/sockets with a frame log,
// and the development sign-in. Synthetic people and messages only.
//
// Without auth-core the cast are development guests (/dev/guests/sign-in). With auth-core (the
// demo with every sample) people are accounts: the cast signs in with an emailed code
// (auth-magic-link), their names come from their example.com addresses, and the guest sign-in
// screen doesn't exist.

const CAST = ["Avery Example", "Blake Example", "Casey Example"];

const settled = async (page) => {
  await page.waitForTimeout(400);
  await page.waitForLoadState("networkidle");
};

const roomOpen = async (page) => {
  await page.waitForFunction(() => document.querySelector("[data-live-room]")?.dataset.status === "open");
};

/** Does the demo use accounts (auth-core) instead of development guests? */
const usesAccounts = async (base) => {
  const res = await fetch(`${base}/dev/guests/sign-in`, { redirect: "manual" });
  return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/session/new");
};

/** `name` signed in, in a browser context of their own, on /live/lobby. */
const signIn = async (browser, base, name, accounts, errors) => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  if (accounts) {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    await page.goto(`${base}/session/new`, { waitUntil: "networkidle" });
    await page.fill("#link_email", email);
    await page.click("button:has-text('Email me a sign-in link')");
    await settled(page);
    const mail = await (await fetch(`${base}/dev/mailbox/latest.json?to=${encodeURIComponent(email)}`)).json();
    await page.fill("#login_code", mail.codes[0]); // auto-submits at six digits
    await settled(page);
    await page.goto(`${base}/live/lobby`, { waitUntil: "networkidle" });
  } else {
    await page.goto(`${base}/dev/guests/sign-in`);
    await page.fill("#name", name);
    await Promise.all([page.waitForURL(/\/live\/lobby$/), page.click("form button")]);
  }
  await roomOpen(page);
  return page;
};

const say = async (page, text) => {
  await page.fill("[data-composer] textarea", text);
  await page.press("[data-composer] textarea", "Enter");
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll("[data-messages] [data-f=body]")).some((e) => e.textContent === t),
    text,
  );
};

/** shoot.mjs calls it once, before the realtime shots: sets the cast up, returns the screens. */
export const realtimeScreens = async ({ browser, base, errors }) => {
  const accounts = await usesAccounts(base);
  const cast = [];
  for (const name of CAST) cast.push(await signIn(browser, base, name, accounts, errors));
  const [a, b, c] = cast;

  await a.click("summary:has-text('Edit headline')");
  await a.fill("#headline", "Launch week: onboarding review at 3 pm");
  await a.click("#room-header button");
  await b.waitForFunction(() => document.querySelector("[data-headline]")?.textContent.includes("Launch week"));
  for (const [who, text] of [
    [a, "Morning! Is the new onboarding flow ready for review?"],
    [b, "Almost. The copy is done; I'm fixing the empty states now."],
    [c, "I can take the mobile pass after lunch."],
    [a, "Great. Post the preview link here when it's up."],
    [b, "Preview build 42 is up on staging, same login as last week."],
    [c, "Looks good on my phone. One overflow on the pricing card, filing it."],
  ]) {
    await say(who, text);
  }
  // Every shot is Avery's: another tab of the same session, so her messages and avatar match.
  const averyState = await a.context().storageState();
  await a.close();

  const inRoom = async (page) => {
    await roomOpen(page);
    await page.waitForFunction(() => document.querySelectorAll("[data-presence] li").length >= 3);
  };
  // Typing indicators expire between shots.
  const quiet = async () => {
    await b.fill("[data-composer] textarea", "");
    await c.fill("[data-composer] textarea", "");
  };
  const asAvery = { storageState: averyState, after: quiet };

  const screens = [
    ["live-room", "/live/lobby", async (page) => {
      await inRoom(page);
      await b.waitForTimeout(3100); // the client sends "typing" at most every 3 s
      await b.fill("[data-composer] textarea", "Fixed the overflow, deploying");
      await page.waitForFunction(() => document.querySelector("[data-typing]").textContent.includes("typing"));
    }, asAvery],
    ["presence", "/live/lobby", async (page) => {
      await inRoom(page);
      const me = await page.evaluate(() => document.querySelector("[data-live-room]").dataset.me);
      await b.waitForFunction((k) => document.querySelector(`[data-presence] li[data-key="${k}"] [data-wave]`), me);
      await b.click(`[data-presence] li[data-key="${me}"] [data-wave]`);
      await page.waitForFunction(() => document.querySelector("[data-toasts]").textContent.includes("waved at you"));
      await c.waitForTimeout(3100);
      await c.fill("[data-composer] textarea", "One more thing about the pricing card");
      await page.waitForFunction(() => document.querySelector("[data-typing]").textContent.includes("typing"));
      // Phones show the conversation first: bring "Here now" into view.
      await page.evaluate(() => document.querySelector("[data-presence]").closest("aside").scrollIntoView({ block: "end" }));
    }, asAvery],
    ["dev-sockets", async () => {
      const conns = (await (await fetch(`${base}/dev/sockets.json`)).json()).conns;
      const blakes = conns.find((x) => x.label === "Blake Example" && x.transport === "websocket");
      if (!blakes) throw new Error("no websocket connection labelled Blake Example on /dev/sockets");
      return `/dev/sockets?conn=${blakes.id}`;
    }, null, asAvery],
  ];
  if (!accounts) screens.push(["sign-in", "/dev/guests/sign-in"]);
  return screens;
};
