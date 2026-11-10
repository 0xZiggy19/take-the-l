// Headless end-to-end test of every UI flow against the live testnet contract.
// Uses the E2E build (VITE_E2E_KEY_SIGNER=1) so the UI signs with test keys read from
// ~/.near-credentials at runtime (never stored in the repo).
//   npm run build:e2e && npx vite preview --outDir dist-e2e --port 4174 &
//   BASE=http://localhost:4174 CALLER=... FADER1=... FADER2=... node e2e/flows.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4174";
const SHOTS = process.env.SHOTS ?? path.resolve("../docs/screenshots");
const [CALLER, FADER1, FADER2] = [process.env.CALLER, process.env.FADER1, process.env.FADER2];
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const results = [];
const log = (ok, name, extra = "") => { results.push({ ok, name, extra }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); };

function key(account) {
  const f = path.join(os.homedir(), ".near-credentials", "testnet", `${account}.json`);
  return JSON.parse(fs.readFileSync(f, "utf8")).private_key;
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function as(account, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  if (account) {
    const k = key(account);
    await ctx.addInitScript(([a, k]) => {
      localStorage.setItem("ttl_e2e_account", a);
      localStorage.setItem("ttl_e2e_key", k);
    }, [account, k]);
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [pageerror ${account ?? "anon"}]`, e.message));
  return page;
}

async function step(name, fn) {
  try { const extra = await fn(); log(true, name, extra ?? ""); }
  catch (e) { log(false, name, e.message.split("\n")[0]); }
}

const txs = [];
/** Waits for a NEW toast (one whose tx link we haven't seen before) and returns its tx link. */
async function waitToast(page, kind = "ok") {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const err = await page.getByTestId("toast-err").allTextContents();
    if (kind === "ok" && err.length) throw new Error(`error toast: ${err.join(" | ")}`);
    const hrefs = await page.locator(`[data-testid=toast-${kind}] a`).evaluateAll((as) => as.map((a) => a.href));
    const fresh = hrefs.find((h) => !txs.includes(h));
    if (fresh) { txs.push(fresh); return fresh; }
    await page.waitForTimeout(300);
  }
  throw new Error("no new toast");
}

async function createCall(page, text, stake, durTestId) {
  await page.goto(`${BASE}/#/new`);
  await page.getByTestId("in-text").fill(text);
  await page.getByTestId("in-stake").fill(stake);
  await page.getByTestId(durTestId).click();
  await page.getByTestId("in-handle").fill("0xZiggy_eth");
  await page.getByTestId("btn-create").click();
  const href = await waitToast(page);
  await page.waitForURL(/#\/claim\/\d+/, { timeout: 30_000 });
  const id = Number(page.url().match(/claim\/(\d+)/)[1]);
  await page.getByTestId("claim-text").waitFor();
  return { id, href };
}

async function fade(page, id, amount) {
  await page.goto(`${BASE}/#/claim/${id}`);
  await page.getByTestId("in-fade").fill(amount);
  await page.getByTestId("btn-fade").click();
  return waitToast(page);
}

async function statusIs(page, id, label) {
  await page.goto(`${BASE}/#/claim/${id}`);
  await page.getByTestId("status").filter({ hasText: label }).first().waitFor({ timeout: 20_000 });
}

const caller = await as(CALLER), f1 = await as(FADER1), f2 = await as(FADER2), anon = await as(null);

// ---------- W path
let W;
await step("caller creates a call via the form", async () => {
  W = await createCall(caller, "$NEAR 2x by Friday", "1", "dur-10");
  return `claim #${W.id} ${W.href}`;
});
await step("fader1 fades 0.3 via the claim page", async () => `${await fade(f1, W.id, "0.3")}`);
await step("fader2 fades 0.2", async () => `${await fade(f2, W.id, "0.2")}`);
await step("caller sees W/L buttons, fader does not", async () => {
  await caller.goto(`${BASE}/#/claim/${W.id}`);
  await caller.getByTestId("btn-resolve-w").waitFor();
  await f1.goto(`${BASE}/#/claim/${W.id}`);
  await f1.getByTestId("btn-fade").waitFor();
  if (await f1.getByTestId("btn-resolve-w").count()) throw new Error("fader can see resolve");
});
await step("screenshot: live claim page (caller view)", async () => {
  await caller.goto(`${BASE}/#/claim/${W.id}`);
  await caller.getByTestId("btn-resolve-w").waitFor();
  await caller.waitForTimeout(800);
  await caller.screenshot({ path: `${SHOTS}/03-claim-live-caller.png`, fullPage: true });
});
await step("caller resolves W", async () => {
  await caller.getByTestId("btn-resolve-w").click();
  const h = await waitToast(caller);
  await statusIs(caller, W.id, "W");
  await caller.getByTestId("verdict").waitFor();
  await caller.screenshot({ path: `${SHOTS}/04-claim-won.png`, fullPage: true });
  return h;
});
await step("fader1 has nothing to collect after W", async () => {
  await f1.goto(`${BASE}/#/claim/${W.id}`);
  await f1.getByTestId("verdict").waitFor();
  await f1.waitForTimeout(1500);
  if (await f1.getByTestId("btn-collect").count()) throw new Error("collect visible after W");
});

// ---------- L path
let L;
await step("caller creates a second call", async () => {
  L = await createCall(caller, "$BTC 150k by Sunday", "0.5", "dur-10");
  return `claim #${L.id}`;
});
await step("fader1 over-fades 1 NEAR (capped at stake)", async () => {
  const h = await fade(f1, L.id, "1");
  await f1.getByText("This call is fully faded").waitFor({ timeout: 20_000 });
  return h;
});
await step("caller takes the L", async () => {
  await caller.goto(`${BASE}/#/claim/${L.id}`);
  await caller.getByTestId("btn-resolve-l").click();
  const h = await waitToast(caller);
  await statusIs(caller, L.id, "L");
  return h;
});
await step("fader1 sees claimable 2x and collects", async () => {
  await f1.goto(`${BASE}/#/claim/${L.id}`);
  const amt = await f1.getByTestId("claimable").textContent({ timeout: 20_000 });
  await f1.screenshot({ path: `${SHOTS}/05-claim-lost-collect.png`, fullPage: true });
  await f1.getByTestId("btn-collect").click();
  const h = await waitToast(f1);
  await f1.getByTestId("btn-collect").waitFor({ state: "detached", timeout: 20_000 });
  return `claimable ${amt} ${h}`;
});

// ---------- Ghost path
let G;
await step("caller creates a 1-minute call", async () => {
  G = await createCall(caller, "$NEAR flips $SOL this week", "0.5", "dur-1");
  return `claim #${G.id}`;
});
await step("fader2 fades 0.2", async () => `${await fade(f2, G.id, "0.2")}`);
await step("timeout button hidden before the deadline", async () => {
  await f1.goto(`${BASE}/#/claim/${G.id}`);
  await f1.getByTestId("countdown").waitFor();
  if (await f1.getByTestId("btn-timeout").count()) throw new Error("timeout visible early");
});
await step("fade form closes after 3/4 of the call's time", async () => {
  await f1.getByTestId("fades-closed").waitFor({ timeout: 70_000 });
  if (await f1.getByTestId("btn-fade").count()) throw new Error("fade form still visible after cutoff");
});
await step("after the deadline, fader1 settles it as GHOSTED", async () => {
  await f1.getByTestId("btn-timeout").waitFor({ timeout: 100_000 });
  await f1.screenshot({ path: `${SHOTS}/06-claim-awaiting-timeout.png`, fullPage: true });
  await f1.getByTestId("btn-timeout").click();
  const h = await waitToast(f1);
  await statusIs(f1, G.id, "GHOSTED");
  return h;
});
await step("fader2 collects after ghosting", async () => {
  await f2.goto(`${BASE}/#/claim/${G.id}`);
  await f2.getByTestId("btn-collect").click();
  return waitToast(f2);
});

// ---------- read-only, no wallet
await step("feed renders without login (RPC only)", async () => {
  await anon.goto(`${BASE}/#/`);
  await anon.getByTestId(`claim-card-${G.id}`).waitFor({ timeout: 20_000 });
  await anon.waitForTimeout(800);
  await anon.screenshot({ path: `${SHOTS}/01-feed.png` });
  return `${await anon.locator("[data-testid^=claim-card-]").count()} cards`;
});
await step("filter chips work (L)", async () => {
  await anon.getByRole("tab", { name: "L", exact: true }).click();
  await anon.waitForTimeout(300);
  const statuses = await anon.getByTestId("status").allTextContents();
  if (!statuses.length || statuses.some((s) => s.trim() !== "L")) throw new Error(`got ${statuses}`);
});
await step("scoreboard 'Ls taken' lists the caller", async () => {
  await anon.goto(`${BASE}/#/board`);
  await anon.getByTestId("board").getByText(CALLER.slice(0, 20)).waitFor({ timeout: 20_000 });
  await anon.screenshot({ path: `${SHOTS}/07-scoreboard.png` });
});
await step("profile shows W/L/ghost record", async () => {
  await anon.goto(`${BASE}/#/u/${CALLER}`);
  const rec = await anon.getByTestId("record").textContent({ timeout: 20_000 });
  await anon.waitForTimeout(500);
  await anon.screenshot({ path: `${SHOTS}/08-profile.png` });
  return rec;
});
await step("share button builds an x.com intent link", async () => {
  await anon.goto(`${BASE}/#/claim/${L.id}`);
  const href = await anon.getByTestId("btn-share").getAttribute("href");
  const u = new URL(href);
  if (u.origin + u.pathname !== "https://x.com/intent/post") throw new Error(href);
  if (!u.searchParams.get("url").includes(`#/claim/${L.id}`)) throw new Error("no claim url");
  if (!u.searchParams.get("text").includes("took the L")) throw new Error("text");
  return u.searchParams.get("text").split("\n")[0];
});
await step("create form screenshot", async () => {
  await caller.goto(`${BASE}/#/new`);
  await caller.getByTestId("in-text").fill("$NEAR 2x by Friday");
  await caller.getByTestId("dur-3").click();
  await caller.screenshot({ path: `${SHOTS}/02-create.png`, fullPage: true });
});
await step("mobile: feed + claim page", async () => {
  const m = await as(null, { width: 390, height: 844 });
  await m.goto(`${BASE}/#/`);
  await m.getByTestId(`claim-card-${G.id}`).waitFor({ timeout: 20_000 });
  await m.screenshot({ path: `${SHOTS}/09-mobile-feed.png` });
  await m.goto(`${BASE}/#/claim/${L.id}`);
  await m.getByTestId("verdict").waitFor({ timeout: 20_000 });
  await m.screenshot({ path: `${SHOTS}/10-mobile-claim.png`, fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("horizontal overflow on mobile");
});

await browser.close();
fs.writeFileSync(path.join(SHOTS, "..", "e2e-results.json"), JSON.stringify({ when: new Date().toISOString(), base: BASE, ids: { W: W?.id, L: L?.id, G: G?.id }, results, txs }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
