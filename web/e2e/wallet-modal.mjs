// Checks the production build: read-only pages load with no wallet, and Connect opens
// NEAR Wallet Selector listing the wallets we ship.
import { chromium } from "playwright-core";
const BASE = process.env.BASE ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS ?? "../docs/screenshots";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/#/`);
await page.locator("[data-testid^=claim-card-]").first().waitFor({ timeout: 20000 });
await page.getByTestId("btn-connect").click();
const wanted = ["MyNearWallet", "Meteor Wallet", "HOT Wallet", "Intear Wallet"];
const found = [];
for (const w of wanted) {
  try { await page.getByText(w, { exact: false }).first().waitFor({ timeout: 15000 }); found.push(w); } catch { /* missing */ }
}
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/11-wallet-selector.png` });
console.log(JSON.stringify({ found, missing: wanted.filter((w) => !found.includes(w)), pageErrors: errors }, null, 2));
await browser.close();
process.exit(found.length === wanted.length && errors.length === 0 ? 0 : 1);
