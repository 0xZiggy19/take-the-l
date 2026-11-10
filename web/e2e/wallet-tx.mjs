// Regression test for wallet transactions in the PRODUCTION build (real Wallet Selector, not the e2e key signer).
// Bug it guards: "Can't find variable: Buffer" on Fade/Create/W/L/Collect, because wallet libraries use a
// Node-style global Buffer that browsers don't have.
//
// No funds move and nothing is signed with a real key:
//  - a fake MyNearWallet session is put in localStorage with a throwaway, random, never-on-chain key;
//  - deposit calls (fade, create_claim) must open the MyNearWallet /sign popup: we decode the tx in its URL, then close it;
//  - the zero-deposit call (resolve "L") is signed locally with the throwaway key: we intercept the RPC send and reply
//    with a mocked error, so nothing reaches the chain.
// Runs in Chromium and (if installed) WebKit, the Safari engine. Neither has Node globals; we also delete them defensively.
import { chromium, webkit } from "playwright-core";
import { KeyPair } from "near-api-js";

const BASE = process.env.BASE ?? "http://localhost:4173";
const CONTRACT = process.env.CONTRACT ?? "takethel-eadf0a.testnet";
const CLAIM = Number(process.env.CLAIM ?? 11); // an Open call whose fades are still open
const ACCOUNT = "ttl-regression.testnet"; // fake session; the key below is random and never added on-chain
const ENGINES = (process.env.ENGINES ?? "chromium,webkit").split(",");

const results = [];
const check = (engine, name, ok, extra = "") => { results.push({ engine, name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"} [${engine}] ${name}${extra ? ` | ${extra}` : ""}`); };
const b64 = (s) => Buffer.from(s, "base64");

async function runEngine(engineName) {
  const type = engineName === "webkit" ? webkit : chromium;
  let browser;
  try {
    browser = await type.launch(engineName === "chromium" ? { executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true } : { headless: true });
  } catch (e) {
    console.log(`SKIP [${engineName}] cannot launch: ${String(e.message).split("\n")[0]}`);
    return;
  }
  const key = KeyPair.fromRandom("ed25519");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: engineName === "webkit", hasTouch: true });
  await ctx.addInitScript(({ account, contract, privateKey }) => {
    // Make sure no Node globals leak in from anywhere: the app must bring its own.
    for (const k of ["Buffer", "process", "global"]) { try { delete globalThis[k]; } catch { /* ignore */ } }
    // Record every toast ever shown (they auto-hide).
    window.__toasts = [];
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains("toast")) window.__toasts.push(n.textContent); })
      .observe(document, { childList: true, subtree: true });
    if (sessionStorage.getItem("ttl_seeded")) return;
    sessionStorage.setItem("ttl_seeded", "1");
    localStorage.setItem("signedAccountId", account);
    localStorage.setItem("functionCallKey", JSON.stringify({ privateKey, contractId: contract, methods: [] }));
    localStorage.setItem("near-wallet-selector:selectedWalletId", JSON.stringify("my-near-wallet"));
    localStorage.setItem("near-wallet-selector:recentlySignedInWallets", JSON.stringify(["my-near-wallet"]));
    localStorage.setItem("near-wallet-selector:contract", JSON.stringify({ contractId: contract, methodNames: [] }));
  }, { account: ACCOUNT, contract: CONTRACT, privateKey: key.toString() });

  // RPC interception: optionally rewrite get_claim so the fake account is the caller; never let a tx reach the chain.
  let asCaller = false;
  const sent = [];
  await ctx.route(/https:\/\/(test\.rpc\.fastnear\.com|rpc\.testnet\.near\.org|rpc\.testnet\.fastnear\.com).*/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    let body; try { body = JSON.parse(req.postData() ?? "{}"); } catch { return route.continue(); }
    const p = body.params ?? {};
    if (["send_tx", "broadcast_tx_commit", "broadcast_tx_async"].includes(body.method)) {
      sent.push(body);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: {} }, code: -32000, message: "Server error", data: "mocked by wallet-tx test: not broadcast" } }) });
    }
    if (body.method === "query" && p.request_type === "view_access_key") {
      const blk = await (await route.fetch({ postData: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) })).json();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { nonce: 1, permission: { FunctionCall: { allowance: null, receiver_id: CONTRACT, method_names: [] } }, block_height: blk.result.header.height, block_hash: blk.result.header.hash } }) });
    }
    if (asCaller && body.method === "query" && p.request_type === "call_function" && p.method_name === "get_claim") {
      const res = await route.fetch();
      const json = await res.json();
      const claim = JSON.parse(Buffer.from(json.result.result).toString());
      claim.caller = ACCOUNT;
      json.result.result = [...Buffer.from(JSON.stringify(claim))];
      return route.fulfill({ response: res, body: JSON.stringify(json) });
    }
    return route.continue();
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const toastText = async () => (await page.evaluate(() => window.__toasts ?? []).catch(() => [])).join(" | ");
  let mark = 0; // only look at toasts shown since the current step started
  const stepStart = async () => { mark = (await page.evaluate(() => (window.__toasts ?? []).length).catch(() => 0)); };
  const stepToasts = async () => (await page.evaluate(() => window.__toasts ?? []).catch(() => [])).slice(mark).join(" | ");
  const noBufferErr = async () => { const t = await stepToasts(); return !/Buffer|find variable|is not defined/i.test(t + errors.join(" ")); };

  // 1) Fade (deposit) -> MyNearWallet /sign popup with a decodable tx
  await page.goto(`${BASE}/#/claim/${CLAIM}`);
  await page.getByTestId("account").waitFor({ timeout: 30000 });
  check(engineName, "fake MyNearWallet session restored", (await page.getByTestId("account").innerText()).includes("ttl-regression"));
  await page.getByTestId("in-fade").fill("0.1");
  await stepStart();
  let popupP = ctx.waitForEvent("page", { timeout: 20000 });
  await page.getByTestId("btn-fade").click();
  let popup = await popupP.catch(() => null);
  if (popup) await popup.waitForURL(/mynearwallet/, { timeout: 15000 }).catch(() => {});
  let url = popup ? popup.url() : "";
  let tx = url.includes("/sign") ? b64(new URL(url).searchParams.get("transactions") ?? "") : Buffer.alloc(0);
  check(engineName, "fade opens MyNearWallet /sign popup", url.includes("testnet.mynearwallet.com") && url.includes("/sign"), url.slice(0, 60));
  check(engineName, "fade tx targets the contract and method 'fade'", tx.includes(Buffer.from(CONTRACT)) && tx.includes(Buffer.from("fade")), `${tx.length} bytes`);
  check(engineName, "no Buffer error on fade", await noBufferErr(), await stepToasts());
  if (popup) await popup.close();
  await page.waitForTimeout(1200);
  check(engineName, "closing the wallet shows 'Cancelled in wallet'", /Cancelled in wallet/.test(await stepToasts()), await stepToasts());

  // 2) Create (deposit) -> popup with create_claim
  await page.goto(`${BASE}/#/new`);
  await page.locator("textarea").first().fill("regression test call (never signed)");
  await stepStart();
  popupP = ctx.waitForEvent("page", { timeout: 20000 });
  await page.getByRole("button", { name: /Stake it/ }).click();
  popup = await popupP.catch(() => null);
  if (popup) await popup.waitForURL(/mynearwallet/, { timeout: 15000 }).catch(() => {});
  url = popup ? popup.url() : "";
  tx = url.includes("/sign") ? b64(new URL(url).searchParams.get("transactions") ?? "") : Buffer.alloc(0);
  check(engineName, "create opens /sign popup with create_claim", tx.includes(Buffer.from("create_claim")), `${tx.length} bytes`);
  check(engineName, "no Buffer error on create", await noBufferErr(), await stepToasts());
  if (popup) await popup.close();

  // 3) Zero-deposit resolve ("I take the L") -> signed locally with the function-call key, send intercepted
  asCaller = true;
  await page.goto(`${BASE}/#/`);
  await page.goto(`${BASE}/#/claim/${CLAIM}`);
  const lBtn = page.getByRole("button", { name: "I take the L" });
  await lBtn.waitFor({ timeout: 30000 });
  await stepStart();
  await lBtn.click();
  for (let i = 0; i < 40 && sent.length === 0; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(800);
  const signed = sent[0] ? b64(sent[0].params.signed_tx_base64 ?? sent[0].params[0] ?? "") : Buffer.alloc(0);
  check(engineName, "resolve L is signed with the function-call key (no popup)", signed.includes(Buffer.from("resolve")) && signed.includes(Buffer.from(CONTRACT)), `${signed.length} bytes, send intercepted`);
  check(engineName, "no Buffer error on resolve", await noBufferErr(), await stepToasts());
  check(engineName, "no uncaught page errors", errors.length === 0, errors.join(" ; "));
  await browser.close();
}

for (const e of ENGINES) await runEngine(e);
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed }, null, 2));
process.exit(failed.length || results.length === 0 ? 1 : 0);
