// npm run smoke [widget] [-- --deployed] [--headed] [--product=<id>]
//
// End-to-end check against the sandbox, as a new guest shopper:
//   1. the widget mounts exactly once on the shipping step
//   2. cwh.checkout.fillShippingAddress() makes checkout save the address and quote shipping
//   3. leaving the step unmounts the widget, and coming back remounts it (no duplicates)
//   4. the widget's own step, <widget folder>/smoke.ts, if it has one (see scripts/lib/widget-smoke.ts)
//   5. ?cwh=off disables it
//   6. the harness logs no errors
// By default it injects the local build. With --deployed it tests what Script Manager serves.
// --product picks the product added to the cart (default 113, a physical product on the sandbox).
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { buildOptions, resolveWidget, root, widgetDir } from './lib/bundle.ts';
import { continueAsGuest, ensureCart, forwardConsole, injectBundle, openShippingStep } from './lib/browser.ts';
import { storefrontUrl } from './lib/env.ts';
import type { WidgetSmoke } from './lib/widget-smoke.ts';

const args = process.argv.slice(2);
const widget = resolveWidget(args.find((a) => !a.startsWith('--')));
const deployed = args.includes('--deployed');
const productId = Number(args.find((a) => a.startsWith('--product='))?.split('=')[1] ?? 113);
const storefront = await storefrontUrl();

const ADDRESS = { countryCode: 'AU', firstName: 'Smoke', lastName: 'Test', address1: '175 Pitt St', city: 'Sydney', stateOrProvinceCode: 'NSW', postalCode: '2000', phone: '0400000000' };
const host = `[data-cwh-widget="${widget}"]`;
const widgetSmokeFile = `${widgetDir(widget)}/smoke.ts`;
const widgetSmoke: WidgetSmoke | undefined = existsSync(`${root}${widgetSmokeFile}`) ? (await import(`${root}${widgetSmokeFile}`)).default : undefined;
const results: { name: string; ok: boolean; skipped?: boolean; detail?: string }[] = [];
const harnessErrors: string[] = [];

let stopped = false;
async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  if (stopped) {
    results.push({ name, ok: false, detail: 'skipped (earlier step failed)' });
    return false;
  }
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || undefined });
    return true;
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message.split('\n')[0] : String(error) });
    stopped = true;
    return false;
  }
}
const count = (page: Page) => page.locator(host).count();

async function expectSavedAddress(page: Page, fields: Record<string, string>, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  let saved: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    saved = await page.evaluate(async () => (await window.cwh!.checkout.getCheckout())?.consignments?.[0]?.shippingAddress);
    if (saved && Object.entries(fields).every(([key, value]) => String(saved![key] ?? '').toLowerCase() === value.toLowerCase())) return;
    await page.waitForTimeout(500);
  }
  const actual = Object.fromEntries(Object.keys(fields).map((key) => [key, saved?.[key]]));
  throw new Error(`saved address never matched ${JSON.stringify(fields)}; last saw ${JSON.stringify(actual)}`);
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: !args.includes('--headed') });
const context = await browser.newContext();
let localVersion: string | undefined;
if (!deployed) {
  const code = (await build(buildOptions(widget))).outputFiles![0].text;
  localVersion = code.match(/checkout-widget-harness (\S+)/)?.[1];
  await injectBundle(context, storefront, () => code);
}
const page = await context.newPage();
// Only the harness's own errors count. Other page errors (B2B, Makeswift, etc.) aren't ours.
forwardConsole(page, (line) => /browser error: \[cwh/.test(line) && harnessErrors.push(line.trim()));

try {
  await check('checkout loads as guest', async () => {
    await ensureCart(page, storefront, productId);
    await page.goto(`${storefront}/checkout?cwh=on`);
    await continueAsGuest(page, 'cwh-smoke@example.com');
    await openShippingStep(page);
  });

  await check('widget mounts once on shipping step', async () => {
    await page.waitForSelector(host, { timeout: 15000 });
    await page.waitForTimeout(500);
    expect((await count(page)) === 1, `expected 1 host, found ${await count(page)}`);
    const status = await page.evaluate(() => window.cwh?.status());
    if (localVersion) expect(status?.version === localVersion, `running ${status?.version}, expected local build ${localVersion}`);
    return `harness ${status?.version}`;
  });

  await check('fill → checkout saves address and quotes shipping', async () => {
    const result = await page.evaluate((a) => window.cwh!.checkout.fillShippingAddress(a, { waitForSave: true }), ADDRESS);
    expect(result.ok, `fill incomplete: ${JSON.stringify(result)}`);
    expect(result.saved, 'no consignment save observed');
    // :visible, because a widget may hide some options.
    await page.waitForSelector('#checkout-shipping-options input[type="radio"]:visible', { timeout: 15000 });
    return `${await page.locator('#checkout-shipping-options input[type="radio"]:visible').count()} shipping options shown`;
  });

  await check('leaving the step unmounts; returning remounts once', async () => {
    // A store with "Default shipping option: None" and several options gets none selected, and Continue stays disabled.
    // Pick the first shown option, as a shopper would.
    await page.waitForTimeout(1000); // let checkout (or a widget) auto-select first
    const radios = page.locator('#checkout-shipping-options input[type="radio"]:visible');
    if (!(await radios.evaluateAll((els) => els.some((el) => (el as HTMLInputElement).checked)))) await radios.first().evaluate((el) => (el as HTMLInputElement).click());
    await page.waitForSelector('#checkout-shipping-continue:not([disabled])', { timeout: 15000 });
    await page.click('#checkout-shipping-continue');
    await page.waitForSelector('li.checkout-step--shipping:not(.checkout-step--current)', { timeout: 15000 });
    expect((await count(page)) === 0, 'host still present after leaving shipping step');
    await openShippingStep(page);
    await page.waitForSelector(host, { timeout: 15000 });
    await page.waitForTimeout(500);
    expect((await count(page)) === 1, `expected 1 host after remount, found ${await count(page)}`);
    const mounts = await page.evaluate((name) => window.cwh!.status().widgets.find((w) => w.name === name)?.mounts, widget);
    expect(mounts === 2, `expected 2 mounts, got ${mounts}`);
  });

  if (!widgetSmoke) {
    results.push({ name: `widget's own step`, ok: true, skipped: true, detail: `no ${widgetSmokeFile}, so the widget's UI wasn't exercised` });
  } else {
    await check(`widget's own step (${widgetSmokeFile})`, () =>
      widgetSmoke({ page, host: page.locator(host), address: ADDRESS, expectSavedAddress: (fields, timeout) => expectSavedAddress(page, fields, timeout) }),
    );
  }

  await check('?cwh=off disables the widget', async () => {
    await page.goto(`${storefront}/checkout?cwh=off`);
    await openShippingStep(page);
    await page.waitForTimeout(1500);
    expect((await count(page)) === 0, 'widget mounted despite ?cwh=off');
    await page.goto(`${storefront}/checkout?cwh=on`);
  });

  await check('no harness errors', async () => {
    expect(!harnessErrors.length, harnessErrors.join(' | '));
  });
} finally {
  await browser.close();
}

console.log(`\nsmoke: ${widget} (${deployed ? 'deployed via Script Manager' : 'local build'}) on ${storefront}`);
for (const r of results) console.log(`  ${r.skipped ? '-' : r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
